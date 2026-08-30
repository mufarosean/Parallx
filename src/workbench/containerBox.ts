// containerBox.ts — a view container, standing on its own in the grid
//
// Phase A, slice 2 (docs/FOUNDATION_MOUNTING.md). A container dragged out
// of a rail becomes a BOX: its own grid citizen with a small header (the
// drag grip, the title, a dock-back control) and the ViewContainer mounted
// beneath. Explorer beside a PDF, chat stacked under the flashcards —
// without evicting anything from the rails.
//
// The box's grid id is `container:<containerId>` — STABLE across restarts,
// which is what lets the persisted body tree hold floating boxes with no
// second persistence system. A box can exist EMPTY: on restore, a floating
// container whose tool has not activated yet gets a waiting shell that
// keeps its place in the tree, and the container is seated into it when it
// arrives — the same degrade-but-keep-the-spot philosophy as the surface
// placeholder.
//
// Icon rule (decided): a floating container keeps its icon in the PRIMARY
// (left) ribbon, where clicking it reveals the box.

import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import { Disposable } from '../platform/lifecycle.js';
import { CONTAINER_DRAG_TYPE } from '../platform/dragTypes.js';
import type { ContainerDragData } from '../platform/dragTypes.js';
import type { IGridView } from '../layout/gridView.js';
import { Orientation } from '../layout/layoutTypes.js';
import type { ViewContainer } from '../views/viewContainer.js';
import type { PartDropZone } from './partDrag.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { $ } from '../ui/dom.js';
import { resolveLegacyContainerId } from './workbenchContributionHandler.js';

export const CONTAINER_BOX_PREFIX = 'container:';

export function containerBoxViewId(containerId: string): string {
  return `${CONTAINER_BOX_PREFIX}${containerId}`;
}

export function containerIdFromBoxViewId(viewId: string): string | undefined {
  // Legacy ids resolve so a box floated before Retirement 4a (when Explorer
  // and Search were builtin containers under their view ids) still finds
  // its contributed container instead of waiting on an id nothing creates.
  return viewId.startsWith(CONTAINER_BOX_PREFIX)
    ? resolveLegacyContainerId(viewId.slice(CONTAINER_BOX_PREFIX.length))
    : undefined;
}

const HEADER_HEIGHT = 35; // matches PART_HEADER_HEIGHT_PX

export class ContainerBox extends Disposable implements IGridView {
  readonly id: string;
  readonly element: HTMLElement;

  private readonly _header: HTMLElement;
  private readonly _title: HTMLElement;
  private readonly _body: HTMLElement;
  private _container: ViewContainer | undefined;

  readonly minimumWidth = 150;
  readonly maximumWidth = Number.POSITIVE_INFINITY;
  readonly minimumHeight = 120;
  readonly maximumHeight = Number.POSITIVE_INFINITY;
  readonly snap = false;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  /** The header's ⋯ control (or a right-click on the header) asked for the
   *  placement menu, at these viewport coordinates. */
  private readonly _onDidRequestMenu = this._register(new Emitter<{ x: number; y: number }>());
  readonly onDidRequestMenu: Event<{ x: number; y: number }> = this._onDidRequestMenu.event;

  constructor(readonly containerId: string, label: string) {
    super();
    this.id = containerBoxViewId(containerId);

    this.element = $('div');
    this.element.classList.add('container-box');
    // The generic drop machinery targets grid views by this attribute; a
    // box is as much a drop target as a part is.
    this.element.setAttribute('data-part-id', this.id);

    const card = $('div');
    card.classList.add('container-box-card');
    this.element.appendChild(card);

    this._header = $('div');
    this._header.classList.add('container-box-header');
    card.appendChild(this._header);

    this._title = $('span');
    this._title.classList.add('container-box-title');
    this._title.textContent = label.toUpperCase();
    this._header.appendChild(this._title);

    // A quiet ⋯ that shows on header hover, opening the placement menu
    // (return home, dock to a rail, move to an edge). The always-visible
    // dock-back arrow it replaces was one hardcoded action wearing chrome;
    // the menu is every way home in the place the hand already hovers.
    const menuBtn = $('button');
    menuBtn.classList.add('container-box-menu-btn');
    menuBtn.setAttribute('aria-label', 'More Actions');
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      this._onDidRequestMenu.fire({ x: r.left, y: r.bottom + 2 });
    });
    this._header.appendChild(menuBtn);

    // Right-click anywhere on the header opens the same menu — the box's
    // grip answers to right-click exactly like the parts' grips do.
    this._header.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._onDidRequestMenu.fire({ x: e.clientX, y: e.clientY });
    });

    // The header is the drag grip, same payload as an activity-bar icon —
    // drop it on a ribbon to dock, on another view to split beside it.
    this._header.draggable = true;
    this._header.classList.add('part-drag-handle');
    this._header.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(
        CONTAINER_DRAG_TYPE,
        JSON.stringify({ containerId } satisfies ContainerDragData),
      );
    });

    this._body = $('div');
    this._body.classList.add('container-box-body');
    card.appendChild(this._body);

    this._setWaiting(true);
  }

  get container(): ViewContainer | undefined {
    return this._container;
  }

  get isWaiting(): boolean {
    return this._container === undefined;
  }

  /** Mount a container into the box (the arrival of what the shell awaited). */
  seat(container: ViewContainer, label?: string): void {
    this._container = container;
    if (label) this._title.textContent = label.toUpperCase();
    this._body.appendChild(container.element);
    container.setVisible(true);
    this._setWaiting(false);
  }

  /** Take the container back out (for re-docking). The box becomes a shell. */
  unseat(): ViewContainer | undefined {
    const c = this._container;
    this._container = undefined;
    this._setWaiting(true);
    return c;
  }

  private _setWaiting(waiting: boolean): void {
    this.element.classList.toggle('container-box--waiting', waiting);
    if (waiting) {
      this._body.textContent = '';
      const note = $('div');
      note.classList.add('container-box-waiting-note');
      note.textContent = 'This view is loading. Its place is kept.';
      this._body.appendChild(note);
    } else {
      this._body.querySelector('.container-box-waiting-note')?.remove();
    }
  }

  /** Briefly flash the box — the reveal for its primary-ribbon icon. */
  reveal(): void {
    this.element.classList.remove('container-box--revealed');
    void this.element.offsetWidth;
    this.element.classList.add('container-box--revealed');
    this._body.querySelector<HTMLElement>('.view-container')?.focus?.();
  }

  layout(width: number, height: number, orientation: Orientation): void {
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
    // The container self-measures via its ResizeObserver; the direct call
    // makes the first paint immediate instead of one observer tick late.
    this._container?.layout(width, Math.max(0, height - HEADER_HEIGHT), orientation);
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('hidden', !visible);
  }

  toJSON(): object {
    return { id: this.id, type: 'container-box' };
  }

  override dispose(): void {
    // The ViewContainer is NOT ours to dispose — the contribution handler
    // owns container lifetime; the box is only ever a place it sits.
    this._container = undefined;
    this.element.remove();
    super.dispose();
  }
}

// ── Manager ─────────────────────────────────────────────────────────────────

/** What the manager needs from the workbench; kept narrow and testable. */
export interface ContainerBoxHost {
  undockContainer(containerId: string): { vc: ViewContainer; label: string } | undefined;
  dockContainer(containerId: string, vc: ViewContainer, rail: 'left' | 'right'): void;
  addFloatingView(view: IGridView, zone?: PartDropZone): void;
  removeFloatingView(viewId: string): void;
  moveFloating(viewId: string, zone: PartDropZone): void;
  /** Relocate a floating box to a window edge — the menu's move actions. */
  moveFloatingToEdge(viewId: string, orientation: Orientation, before: boolean): void;
  requestSave(): void;
  /** Route a box-menu choice through the command bus (origin 'menu'). */
  executeCommandFrom(origin: 'menu', commandId: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Owns the floating boxes: detach, move, dock back, reveal, and the waiting
 * shells that keep a restored box's place until its container's tool
 * activates.
 */
export class ContainerBoxManager extends Disposable {
  private readonly _boxes = new Map<string, ContainerBox>();

  constructor(private readonly _host: ContainerBoxHost) {
    super();
  }

  has(containerId: string): boolean {
    return this._boxes.has(containerId);
  }

  /** Every floating container, seated or waiting — for rail persistence. */
  floatingContainerIds(): readonly string[] {
    return [...this._boxes.keys()];
  }

  /**
   * The restore factory: a box shell for a `container:` leaf found in the
   * saved tree. Idempotent per container. The shell holds the spot; the
   * container seats when its tool arrives.
   */
  resolveShell(viewId: string): IGridView | undefined {
    const containerId = containerIdFromBoxViewId(viewId);
    if (!containerId) return undefined;
    return this._boxes.get(containerId) ?? this._createBox(containerId, containerId);
  }

  /**
   * Detach a DOCKED container into a floating box at the drop zone. If the
   * container already floats, this is a move of its box instead.
   */
  float(containerId: string, zone?: PartDropZone): boolean {
    const existing = this._boxes.get(containerId);
    if (existing && !existing.isWaiting) {
      if (zone && zone.kind !== 'dock') this._host.moveFloating(existing.id, zone);
      return true;
    }

    const undocked = this._host.undockContainer(containerId);
    if (!undocked) return false;

    let box = this._boxes.get(containerId);
    const isFreshBox = !box;
    if (!box) box = this._createBox(containerId, undocked.label);
    box.seat(undocked.vc, undocked.label);
    if (isFreshBox) {
      this._host.addFloatingView(box, zone && zone.kind !== 'dock' ? zone : undefined);
    }
    this._host.requestSave();
    return true;
  }

  private _seatingInProgress = false;

  /** Try to seat every waiting shell — called whenever containers register. */
  seatWaiting(): void {
    // Undocking fires the rails-changed event that calls back in here.
    if (this._seatingInProgress) return;
    this._seatingInProgress = true;
    try {
      for (const [containerId, box] of this._boxes) {
        if (!box.isWaiting) continue;
        const undocked = this._host.undockContainer(containerId);
        if (undocked) box.seat(undocked.vc, undocked.label);
      }
    } finally {
      this._seatingInProgress = false;
    }
  }

  /** Return a floating container to a rail; its box leaves the grid. */
  dock(containerId: string, rail: 'left' | 'right'): boolean {
    const box = this._boxes.get(containerId);
    if (!box) return false;
    const vc = box.unseat();
    this._host.removeFloatingView(box.id);
    this._boxes.delete(containerId);
    box.dispose();
    if (vc) this._host.dockContainer(containerId, vc, rail);
    this._host.requestSave();
    return true;
  }

  /** Move a floating container's box to a window edge (command surface). */
  moveToEdge(containerId: string, edge: 'left' | 'right' | 'bottom'): void {
    const box = this._boxes.get(containerId);
    if (!box) return;
    this._host.moveFloatingToEdge(
      box.id,
      edge === 'bottom' ? Orientation.Vertical : Orientation.Horizontal,
      edge === 'left',
    );
    this._host.requestSave();
  }

  /** The reveal behind a floating container's primary-ribbon icon. */
  reveal(containerId: string): boolean {
    const box = this._boxes.get(containerId);
    if (!box) return false;
    box.reveal();
    return true;
  }

  /** Grid drop routing: move an existing box, or detach at the zone. */
  handleContainerDrop(containerId: string, zone: PartDropZone): void {
    if (zone.kind === 'dock') return; // routed through handleDock
    const box = this._boxes.get(containerId);
    if (box) {
      this._host.moveFloating(box.id, zone);
      this._host.requestSave();
    } else {
      this.float(containerId, zone);
    }
  }

  /**
   * The saved tree replaced the layout: any box whose leaf did not survive
   * is homeless. A seated container goes back to the left rail rather than
   * vanishing; a waiting shell simply goes.
   */
  pruneAbsent(presentViewIds: ReadonlySet<string>): void {
    for (const [containerId, box] of [...this._boxes]) {
      if (presentViewIds.has(box.id)) continue;
      const vc = box.unseat();
      this._boxes.delete(containerId);
      box.dispose();
      if (vc) this._host.dockContainer(containerId, vc, 'left');
    }
  }

  /** Workspace switch: boxes go; containers were the handler's to dispose. */
  clearAll(): void {
    for (const [, box] of this._boxes) box.dispose();
    this._boxes.clear();
  }

  private _createBox(containerId: string, label: string): ContainerBox {
    const box = new ContainerBox(containerId, label);
    this._boxes.set(containerId, box);
    // The header's ⋯ (and right-click) opens the placement menu: the way
    // home first, then the rails, then the edges. A detached panel view's
    // home is the panel; a container's home is a rail.
    this._register(box.onDidRequestMenu(({ x, y }) => {
      const isPanelView = containerId.startsWith('panelview:');
      const items = isPanelView
        ? [{ id: 'dock-left', label: 'Return To Panel', group: '1_dock' }]
        : [
            { id: 'dock-left', label: 'Dock To Left Rail', group: '1_dock', order: 1 },
            { id: 'dock-right', label: 'Dock To Right Rail', group: '1_dock', order: 2 },
          ];
      const menu = ContextMenu.show({
        items: [
          ...items,
          { id: 'edge-left', label: 'Move To Left Edge', group: '2_move', order: 1 },
          { id: 'edge-right', label: 'Move To Right Edge', group: '2_move', order: 2 },
          { id: 'edge-bottom', label: 'Move To Bottom Edge', group: '2_move', order: 3 },
        ],
        anchor: { x, y },
      });
      // Every choice routes through the command bus (Phase B): one command
      // per operation, this menu supplying the target and parameter.
      const actions: Record<string, readonly [string, ...unknown[]]> = {
        'dock-left': ['workbench.action.container.dock', containerId, 'left'],
        'dock-right': ['workbench.action.container.dock', containerId, 'right'],
        'edge-left': ['workbench.action.container.moveToEdge', containerId, 'left'],
        'edge-right': ['workbench.action.container.moveToEdge', containerId, 'right'],
        'edge-bottom': ['workbench.action.container.moveToEdge', containerId, 'bottom'],
      };
      menu.onDidSelect(({ item }) => {
        const action = actions[item.id];
        if (action) void this._host.executeCommandFrom('menu', action[0], ...action.slice(1));
      });
    }));
    return box;
  }

  override dispose(): void {
    this.clearAll();
    super.dispose();
  }
}
