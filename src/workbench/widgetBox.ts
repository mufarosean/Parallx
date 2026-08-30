// widgetBox.ts — a widget standing alone in the grid: the smallest citizen.
//
// The workbench-widgets feature: ONE widget system, many hosts. Widget
// instances are dashboard rows on the reserved workbench page; this file
// is the workbench SEAT — a chromeless card in the body grid rendering
// the instance through the same registry, refresh scheduler, appearance,
// and AI delivery pipeline every dashboard uses. Moving a widget between
// hosts is a pageId flip with a stable id; moving it within the grid is
// a re-seat of the same DOM. Never re-instantiate.
//
// Drags ride the container pipeline exactly like detached panel views do:
// the grip stamps CONTAINER_DRAG_TYPE with the `widget:<instanceId>` view
// id, and the workbench routes ids by prefix. Rail docking is refused for
// widgets, so the drop machinery's fallback turns dock zones into beside
// splits on its own.

import { Emitter } from '../platform/events.js';
import type { Event } from '../platform/events.js';
import { Disposable, DisposableStore } from '../platform/lifecycle.js';
import { CONTAINER_DRAG_TYPE } from '../platform/dragTypes.js';
import type { ContainerDragData } from '../platform/dragTypes.js';
import type { IGridView } from '../layout/gridView.js';
import { Orientation } from '../layout/layoutTypes.js';
import type { PartDropZone } from './partDrag.js';
import { ContextMenu } from '../ui/contextMenu.js';
import { $ } from '../ui/dom.js';
import type { WorkbenchWidgetHost, DashboardWidgetRow, WidgetAppearance } from '../built-in/dashboard/dashboardTypes.js';
import type { WidgetContext, WidgetHandle } from '../api/bridges/dashboardBridge.js';

export const WIDGET_BOX_PREFIX = 'widget:';

export function widgetBoxViewId(instanceId: string): string {
  return `${WIDGET_BOX_PREFIX}${instanceId}`;
}

export function instanceIdFromWidgetViewId(viewId: string): string | undefined {
  return viewId.startsWith(WIDGET_BOX_PREFIX)
    ? viewId.slice(WIDGET_BOX_PREFIX.length)
    : undefined;
}

export class WidgetBox extends Disposable implements IGridView {
  readonly id: string;
  readonly element: HTMLElement;

  private readonly _card: HTMLElement;
  private readonly _body: HTMLElement;
  private _pending = true;

  readonly minimumWidth = 120;
  readonly maximumWidth = Number.POSITIVE_INFINITY;
  readonly minimumHeight = 80;
  readonly maximumHeight = Number.POSITIVE_INFINITY;
  readonly snap = false;

  private readonly _onDidChangeConstraints = this._register(new Emitter<void>());
  readonly onDidChangeConstraints: Event<void> = this._onDidChangeConstraints.event;

  /** The grip's ⋯ (or a right-click on the grip) asked for the menu. */
  private readonly _onDidRequestMenu = this._register(new Emitter<{ x: number; y: number }>());
  readonly onDidRequestMenu: Event<{ x: number; y: number }> = this._onDidRequestMenu.event;

  constructor(readonly instanceId: string) {
    super();
    this.id = widgetBoxViewId(instanceId);

    this.element = $('div');
    this.element.classList.add('widget-box');
    this.element.setAttribute('data-part-id', this.id);

    this._card = $('div');
    this._card.classList.add('widget-box-card');
    this.element.appendChild(this._card);

    // The grip: a thin strip over the card's top edge, revealed on hover.
    // It is the drag handle AND the menu anchor — the same hand position
    // for both, nothing permanent over the widget's face.
    const grip = $('div');
    grip.classList.add('widget-box-grip', 'part-drag-handle');
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      if (!e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(
        CONTAINER_DRAG_TYPE,
        JSON.stringify({ containerId: this.id } satisfies ContainerDragData),
      );
    });
    const menuBtn = $('button');
    menuBtn.classList.add('widget-box-menu-btn');
    menuBtn.setAttribute('aria-label', 'More Actions');
    menuBtn.textContent = '⋯';
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const r = menuBtn.getBoundingClientRect();
      this._onDidRequestMenu.fire({ x: r.left, y: r.bottom + 2 });
    });
    grip.appendChild(menuBtn);
    grip.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._onDidRequestMenu.fire({ x: e.clientX, y: e.clientY });
    });
    this._card.appendChild(grip);

    this._body = $('div');
    this._body.classList.add('widget-box-body');
    this._card.appendChild(this._body);

    this.showWaiting();
  }

  /** The card element — where appearance customization applies. */
  get card(): HTMLElement {
    return this._card;
  }

  /** The render target the widget system draws into. */
  get body(): HTMLElement {
    return this._body;
  }

  /** True while nothing real is rendered (system/type/instance pending). */
  get isPending(): boolean {
    return this._pending;
  }

  /** Clear the body for a fresh mount. */
  clearBody(): void {
    this._body.textContent = '';
  }

  markMounted(): void {
    this._pending = false;
  }

  showWaiting(): void {
    this._pending = true;
    this._body.textContent = '';
    const note = $('div');
    note.classList.add('widget-box-waiting-note');
    note.textContent = 'This widget is loading. Its place is kept.';
    this._body.appendChild(note);
  }

  showMissing(): void {
    this._pending = true;
    this._body.textContent = '';
    const note = $('div');
    note.classList.add('widget-box-waiting-note');
    note.textContent = 'This widget no longer exists.';
    this._body.appendChild(note);
  }

  layout(width: number, height: number, _orientation: Orientation): void {
    this.element.style.width = `${width}px`;
    this.element.style.height = `${height}px`;
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('hidden', !visible);
  }

  toJSON(): object {
    return { id: this.id, type: 'widget-box' };
  }

  override dispose(): void {
    this.element.remove();
    super.dispose();
  }
}

// ── Manager ─────────────────────────────────────────────────────────────────

/** What the manager needs from the workbench grid layer; narrow, testable. */
export interface WidgetBoxHost {
  addFloatingView(view: IGridView, zone?: PartDropZone): void;
  removeFloatingView(viewId: string): void;
  moveFloating(viewId: string, zone: PartDropZone): void;
  moveFloatingToEdge(viewId: string, orientation: Orientation, before: boolean): void;
  requestSave(): void;
  /** Route a box-menu choice through the command bus (origin 'menu'). */
  executeCommandFrom(origin: 'menu', commandId: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Owns the standalone widget seats: place, move, render through the
 * widget system, delete. Instances belong to the system (dashboard rows
 * on the reserved workbench page); a box is only ever a place one sits.
 * The system connects late — the dashboard tool activates after the tree
 * restores — so every box is born waiting and fills on connection.
 */
export class WidgetBoxManager extends Disposable {
  private readonly _boxes = new Map<string, WidgetBox>();
  private readonly _mounts = new Map<string, { store: DisposableStore; handle: WidgetHandle; row: DashboardWidgetRow }>();
  private readonly _listeners = this._register(new DisposableStore());
  private readonly _systemListeners = this._register(new DisposableStore());
  private _system: WorkbenchWidgetHost | undefined;

  constructor(private readonly _host: WidgetBoxHost) {
    super();
  }

  get system(): WorkbenchWidgetHost | undefined {
    return this._system;
  }

  has(instanceId: string): boolean {
    return this._boxes.has(instanceId);
  }

  /** Wire the widget system once it exists (dashboard tool activation). */
  connectSystem(system: WorkbenchWidgetHost): void {
    if (this._system) return;
    this._system = system;
    this._systemListeners.add(system.onDidChangeTypes(() => this.rerenderPending()));
    this._systemListeners.add(system.onDidChangeData((e) => {
      if (!e.widgetId) return;
      const box = this._boxes.get(e.widgetId);
      if (!box) return;
      if (e.kind === 'widget-cache' || e.kind === 'widget-status') {
        this._reflectRow(box);
      } else if (e.kind === 'widget-updated') {
        // Config or appearance changed (the dashboard drawer, an AI edit) —
        // remount so the widget rebuilds against the new config.
        this._mount(box);
      }
    }));
    this.rerenderPending();
  }

  /**
   * The restore factory: a box for a `widget:` leaf found in a saved
   * tree. Renders when the system, instance and type all exist; keeps
   * the seat as a waiting shell otherwise.
   */
  resolveShell(viewId: string): IGridView | undefined {
    const instanceId = instanceIdFromWidgetViewId(viewId);
    if (!instanceId) return undefined;
    return this._boxes.get(instanceId) ?? this._createBox(instanceId);
  }

  /** Seat an instance as a new standalone cell at the zone. */
  place(instanceId: string, zone?: PartDropZone): void {
    if (this._boxes.has(instanceId)) return;
    const box = this._createBox(instanceId);
    this._host.addFloatingView(box, zone && zone.kind !== 'dock' ? zone : undefined);
    this._host.requestSave();
  }

  /**
   * Adopt a widget that lives on a DASHBOARD: flip its row to the
   * workbench page (same instance id), seat it at the right edge.
   */
  async adopt(widgetId: string): Promise<boolean> {
    const system = this._system;
    if (!system) return false;
    const row = await system.adoptInstance(widgetId);
    if (!row) return false;
    if (!this._boxes.has(widgetId)) {
      const box = this._createBox(widgetId);
      this._host.addFloatingView(box);
      this._host.moveFloatingToEdge(box.id, Orientation.Horizontal, false);
    }
    this._host.requestSave();
    return true;
  }

  /** Grid drop routing for `widget:` ids — always a move of the box. */
  handleDrop(viewId: string, zone: PartDropZone): void {
    if (zone.kind === 'dock') return; // widgets refuse rails; fallback handled upstream
    this._host.moveFloating(viewId, zone);
    this._host.requestSave();
  }

  /** Delete the widget: seat AND instance. The inverse of creation. */
  async removeWidget(instanceId: string): Promise<void> {
    this._dropSeat(instanceId);
    await this._system?.removeInstance(instanceId);
    this._host.requestSave();
  }

  /** A restored tree replaced the layout: drop boxes whose leaf did not
   *  survive. Instances persist — only seats are tree-bound. */
  pruneAbsent(presentViewIds: ReadonlySet<string>): void {
    for (const [instanceId, box] of [...this._boxes]) {
      if (presentViewIds.has(box.id)) continue;
      this._unmount(instanceId);
      this._boxes.delete(instanceId);
      box.dispose();
    }
  }

  /** Fill every waiting seat that can fill now — the system connected, or
   *  a widget type registered late. */
  rerenderPending(): void {
    for (const [, box] of this._boxes) {
      if (box.isPending) this._mount(box);
    }
  }

  clearAll(): void {
    for (const [instanceId, box] of this._boxes) {
      this._unmount(instanceId);
      box.dispose();
    }
    this._boxes.clear();
  }

  // ── Mounting ──────────────────────────────────────────────────────────

  private _createBox(instanceId: string): WidgetBox {
    const box = new WidgetBox(instanceId);
    this._boxes.set(instanceId, box);
    this._listeners.add(box.onDidRequestMenu(({ x, y }) => this._showMenu(box, x, y)));
    this._mount(box);
    return box;
  }

  private _mount(box: WidgetBox): void {
    const system = this._system;
    if (!system) {
      box.showWaiting();
      return;
    }
    void system.getInstance(box.instanceId).then((row) => {
      // The box may have been re-seated or removed while the row loaded.
      if (this._boxes.get(box.instanceId) !== box || box.isDisposed) return;
      if (!row) {
        this._unmount(box.instanceId);
        box.showMissing();
        return;
      }
      const reg = system.getWidgetType(row.widgetTypeId);
      if (!reg) {
        // Type not registered yet — its tool activates later; the
        // onDidChangeTypes listener re-runs this mount.
        this._unmount(box.instanceId);
        box.showWaiting();
        return;
      }

      this._unmount(box.instanceId);
      const store = new DisposableStore();
      const configEmitter = new Emitter<unknown>();
      store.add(configEmitter);

      const ctx: WidgetContext<unknown> = {
        instanceId: row.id,
        pageId: row.pageId,
        config: row.config,
        api: system.api,
        cachedOutput: row.cachedOutput,
        errorMessage: row.errorMessage,
        mode: 'background',
        initiator: 'autonomous',
        onDidChangeConfig: configEmitter.event,
        requestRefresh: () => void system.refreshWidget(row.id),
        setCachedOutput: (output) => void system.setCachedOutput(row.id, output),
        setError: (message) => void system.setError(row.id, message),
        clearError: () => void system.clearError(row.id),
      };

      box.clearBody();
      let handle: WidgetHandle;
      try {
        handle = reg.createWidget
          ? (reg.createWidget as (c: HTMLElement, ctx: WidgetContext<unknown>) => WidgetHandle)(box.body, ctx)
          : this._markdownHandle(box.body, row.cachedOutput);
      } catch (err) {
        store.dispose();
        box.showMissing();
        console.error(`[WidgetBox] createWidget failed for "${row.widgetTypeId}":`, err);
        return;
      }
      store.add(handle);
      this._mounts.set(box.instanceId, { store, handle, row });
      system.applyAppearance(box.card, row.appearance);
      box.markMounted();

      // The row's interval/cron policy runs on the REAL scheduler —
      // manual policies no-op inside schedule().
      void system.scheduleWidget(row.id);
    });
  }

  /** Cache/status changed: hand the widget its new output/error in place. */
  private _reflectRow(box: WidgetBox): void {
    const system = this._system;
    const mount = this._mounts.get(box.instanceId);
    if (!system || !mount) return;
    void system.getInstance(box.instanceId).then((row) => {
      if (!row || this._mounts.get(box.instanceId) !== mount) return;
      mount.handle.renderError?.(row.errorMessage);
      if (mount.handle.refreshFromCache) {
        mount.handle.refreshFromCache(row.cachedOutput);
      } else if (!('createWidget' in (system.getWidgetType(row.widgetTypeId) ?? {}))
        || !system.getWidgetType(row.widgetTypeId)?.createWidget) {
        // Markdown-mode widget: re-render the body from the new cache.
        box.clearBody();
        box.body.appendChild(system.renderMarkdown(row.cachedOutput ?? ''));
      }
    });
  }

  /** The built-in renderer for `renderMode: 'markdown'` widget types. */
  private _markdownHandle(body: HTMLElement, cachedOutput: string | null): WidgetHandle {
    const render = (markdown: string | null): void => {
      body.textContent = '';
      const content = $('div');
      content.classList.add('widget-box-markdown');
      const system = this._system;
      if (system) content.appendChild(system.renderMarkdown(markdown ?? ''));
      else content.textContent = markdown ?? '';
      body.appendChild(content);
    };
    render(cachedOutput);
    return {
      refreshFromCache: (output) => render(output),
      dispose: () => { body.textContent = ''; },
    };
  }

  private _unmount(instanceId: string): void {
    const mount = this._mounts.get(instanceId);
    if (!mount) return;
    this._mounts.delete(instanceId);
    this._system?.cancelSchedule(instanceId);
    mount.store.dispose();
  }

  private _dropSeat(instanceId: string): void {
    const box = this._boxes.get(instanceId);
    if (!box) return;
    this._unmount(instanceId);
    this._boxes.delete(instanceId);
    this._host.removeFloatingView(box.id);
    box.dispose();
  }

  private _showMenu(box: WidgetBox, x: number, y: number): void {
    const canRefresh = (() => {
      const system = this._system;
      if (!system) return false;
      // Row lookup is async; offer Refresh whenever the mount is live —
      // the system decides whether the type actually refreshes.
      return this._mounts.has(box.instanceId);
    })();
    // Content placement submenu — the current mode is marked so the menu
    // reads as the radio group it is.
    const current = this._mounts.get(box.instanceId)?.row.appearance.contentAlign ?? 'start';
    const alignLabel = (label: string, value: string): string =>
      current === value ? `${label} (Current)` : label;

    const items = [
      ...(canRefresh
        ? [{ id: 'workbench.action.widget.refresh', label: 'Refresh Widget', group: '0_refresh' }]
        : []),
      ...(this._mountedTypeReg(box.instanceId)?.configSchema
        ? [{ id: 'workbench.action.widget.openSettings', label: 'Widget Settings…', group: '1_look', order: -1 }]
        : []),
      ...(this._mounts.has(box.instanceId)
        ? [{ id: 'workbench.action.widget.editAppearance', label: 'Edit Appearance…', group: '1_look', order: 0 }]
        : []),
      {
        id: 'align', label: 'Align Content', group: '1_look', order: 1,
        submenu: [
          { id: 'align-start', label: alignLabel('Top Left', 'start') },
          { id: 'align-start-padded', label: alignLabel('Top Left With Margin', 'start-padded') },
          { id: 'align-center', label: alignLabel('Centered', 'center') },
        ],
      },
      { id: 'edge-left', label: 'Move To Left Edge', group: '1_move', order: 1 },
      { id: 'edge-right', label: 'Move To Right Edge', group: '1_move', order: 2 },
      { id: 'edge-bottom', label: 'Move To Bottom Edge', group: '1_move', order: 3 },
      // The non-destructive exit first: the widget leaves the workbench
      // but lives on, back on the dashboard it came from.
      { id: 'workbench.action.widget.returnToDashboard', label: 'Return To Dashboard', group: '2_remove', order: 1 },
      { id: 'workbench.action.widget.remove', label: 'Remove Widget', group: '2_remove', order: 2 },
    ];
    const menu = ContextMenu.show({ items, anchor: { x, y } });
    // Item ids ARE command ids (the Phase B menu contract); the args map
    // supplies each command's target. The align radios are the documented
    // exception — one command, three parameterizations — so their item ids
    // stay semantic and map to the same command with different arguments.
    const iid = box.instanceId;
    const actions: Record<string, readonly [string, ...unknown[]]> = {
      'workbench.action.widget.refresh': ['workbench.action.widget.refresh', iid],
      'workbench.action.widget.openSettings': ['workbench.action.widget.openSettings', iid],
      'workbench.action.widget.editAppearance': ['workbench.action.widget.editAppearance', iid],
      'workbench.action.widget.returnToDashboard': ['workbench.action.widget.returnToDashboard', iid],
      'workbench.action.widget.remove': ['workbench.action.widget.remove', iid],
      'align-start': ['workbench.action.widget.setContentAlign', iid, 'start'],
      'align-start-padded': ['workbench.action.widget.setContentAlign', iid, 'start-padded'],
      'align-center': ['workbench.action.widget.setContentAlign', iid, 'center'],
      'edge-left': ['workbench.action.widget.moveToEdge', iid, 'left'],
      'edge-right': ['workbench.action.widget.moveToEdge', iid, 'right'],
      'edge-bottom': ['workbench.action.widget.moveToEdge', iid, 'bottom'],
    };
    menu.onDidSelect(({ item }) => {
      const action = actions[item.id];
      if (action) void this._host.executeCommandFrom('menu', action[0], ...action.slice(1));
    });
  }

  private _mountedTypeReg(instanceId: string) {
    const mount = this._mounts.get(instanceId);
    if (!mount || !this._system) return undefined;
    return this._system.getWidgetType(mount.row.widgetTypeId);
  }

  /**
   * The non-destructive inverse of adoption: the widget goes back to the
   * dashboard it came from — or the default page when home is gone or it
   * was born in the workbench. The SEAT leaves the grid; the instance,
   * its config, look, and schedule all live on.
   */
  async returnToDashboard(instanceId: string): Promise<boolean> {
    const system = this._system;
    if (!system) return false;
    const pageId = await system.returnInstanceToDashboard(instanceId);
    if (!pageId) return false;
    this._dropSeat(instanceId);
    this._host.requestSave();
    return true;
  }

  /**
   * Open the shared settings drawer on a seated widget — the SAME editor
   * a dashboard card gets, fields from the type's configSchema, saved
   * through the system. The widget-updated event remounts with the new
   * config.
   */
  private _openSettings(box: WidgetBox): void {
    const system = this._system;
    const mount = this._mounts.get(box.instanceId);
    const reg = this._mountedTypeReg(box.instanceId);
    if (!system || !mount || !reg?.configSchema) return;
    system.openSettingsDrawer({
      typeReg: reg,
      config: mount.row.config as Record<string, unknown>,
      onSave: (next) => system.updateConfig(box.instanceId, next),
      showError: (message) => console.error('[WidgetBox] settings save failed:', message),
    });
  }

  /**
   * Open the shared appearance drawer on a seated widget — the SAME
   * editor a dashboard card gets (background, border, title, alignment),
   * previewing live on this box's card and saving through the system.
   * The widget-updated event remounts the seat with the saved look.
   */
  private _openAppearance(box: WidgetBox): void {
    const system = this._system;
    const mount = this._mounts.get(box.instanceId);
    if (!system || !mount) return;
    const reg = system.getWidgetType(mount.row.widgetTypeId);
    system.openAppearanceDrawer({
      card: box.card,
      appearance: mount.row.appearance,
      defaultTitle: reg?.displayName ?? mount.row.widgetTypeId,
      onSave: (next) => system.updateAppearance(box.instanceId, next),
      showError: (message) => console.error('[WidgetBox] appearance save failed:', message),
    });
  }

  /**
   * Persist a content-placement choice into the instance's appearance —
   * the same record the border/look customization lives in, so it follows
   * the widget between hosts. The widget-updated event remounts the seat.
   */
  async setContentAlign(
    instanceId: string,
    contentAlign: NonNullable<WidgetAppearance['contentAlign']>,
  ): Promise<void> {
    const system = this._system;
    if (!system) return;
    const row = await system.getInstance(instanceId);
    if (!row) return;
    await system.updateAppearance(instanceId, { ...row.appearance, contentAlign });
  }

  // ── Command surface (SYSTEM_INTEGRITY.md Phase B) ─────────────────────────
  // Id-based public forms of every box-menu operation, so the layout
  // commands can drive a seat without holding the box.

  /** Ask the system to refresh a seated widget's content. */
  refreshWidget(instanceId: string): void {
    void this._system?.refreshWidget(instanceId);
  }

  /** Open the settings drawer on a seated widget. */
  openSettings(instanceId: string): void {
    const box = this._boxes.get(instanceId);
    if (box) this._openSettings(box);
  }

  /** Open the appearance drawer on a seated widget. */
  openAppearance(instanceId: string): void {
    const box = this._boxes.get(instanceId);
    if (box) this._openAppearance(box);
  }

  /** Move a seated widget's box to a window edge. */
  moveToEdge(instanceId: string, edge: 'left' | 'right' | 'bottom'): void {
    const box = this._boxes.get(instanceId);
    if (!box) return;
    this._host.moveFloatingToEdge(
      box.id,
      edge === 'bottom' ? Orientation.Vertical : Orientation.Horizontal,
      edge === 'left',
    );
    this._host.requestSave();
  }

  override dispose(): void {
    this.clearAll();
    super.dispose();
  }
}
