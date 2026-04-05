// activityBarPart.ts — primary activity bar (M3 Capability 0.2 + Cap 2)
//
// Vertical icon strip on the far left of the workbench.
// Replaces the ad-hoc `div.activity-bar` created inline in workbench.ts.
// Participates in the horizontal grid with fixed 48px width.
//
// VS Code reference: src/vs/workbench/browser/parts/activitybar/activitybarPart.ts
// VS Code CSS: src/vs/workbench/browser/parts/activitybar/media/activitybarpart.css
//              src/vs/workbench/browser/parts/activitybar/media/activityaction.css
//
// VS Code DOM structure (Cap 2 research):
//   .part.activitybar
//     .content (flex column, justify: space-between)
//       .composite-bar
//         .monaco-action-bar [role=tablist]
//           .action-item [role=tab]
//             a.action-label (the icon)
//             .badge > .badge-content
//             .active-item-indicator
//       .global-activity (manage/accounts at bottom)
//
// VS Code CSS patterns:
//   - Active indicator: border-left 2px solid on .active-item-indicator::before
//   - Badge: absolute positioned, top-right, z-index 2
//   - Interaction: click inactive → show sidebar + switch. Click active → toggle sidebar.

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';
import { IDisposable, toDisposable } from '../platform/lifecycle.js';
import { $ } from '../ui/dom.js';
import { setupTooltip } from '../ui/tooltip.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ACTIVITY_BAR_WIDTH = 48;

const ACTIVITY_BAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: ACTIVITY_BAR_WIDTH,
  maximumWidth: ACTIVITY_BAR_WIDTH,
  minimumHeight: 0,
  maximumHeight: Number.POSITIVE_INFINITY,
};

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Describes an icon entry in the activity bar.
 */
export interface ActivityBarIconDescriptor {
  /** Unique identifier, typically a view container ID or view ID. */
  readonly id: string;
  /** Icon content — SVG string, emoji, or single-character fallback. */
  readonly icon: string;
  /** If true, icon is raw SVG markup rendered via innerHTML. */
  readonly isSvg?: boolean;
  /** Tooltip label. */
  readonly label: string;
  /** Whether this is a built-in icon or contributed by a tool. */
  readonly source: 'builtin' | 'contributed';
  /** Priority for ordering (lower = higher position). */
  readonly priority?: number;
}

/**
 * Event fired when an activity bar icon is clicked.
 */
export interface ActivityBarIconClickEvent {
  readonly iconId: string;
  readonly source: 'builtin' | 'contributed';
}

/**
 * Badge descriptor for an activity bar icon.
 * VS Code reference: compositeBarActions.ts — NumberBadge, IconBadge, ProgressBadge
 */
export interface ActivityBarBadge {
  /** Numeric count to display. Shows as number; max "99+". */
  readonly count?: number;
  /** Show a small dot instead of a count. */
  readonly dot?: boolean;
}

// ─── ActivityBarPart ─────────────────────────────────────────────────────────

export class ActivityBarPart extends Part {

  // ── DOM ──

  /** Unified container for all icons (builtin + contributed). */
  private _iconSection!: HTMLElement;

  /** Spacer that pushes bottom-aligned items down. */
  private _spacer!: HTMLElement;

  /** Container for bottom-aligned items (e.g., settings gear). */
  private _bottomSection!: HTMLElement;

  // ── State ──

  /** All registered icon descriptors, keyed by ID. */
  private readonly _icons = new Map<string, ActivityBarIconDescriptor>();

  /** The currently active (highlighted) icon ID. */
  private _activeIconId: string | undefined;

  /** Badge state per icon ID. */
  private readonly _badges = new Map<string, ActivityBarBadge>();

  /** Badge DOM elements per icon ID, for efficient updates. */
  private readonly _badgeElements = new Map<string, { badge: HTMLElement; content: HTMLElement }>();

  /** Index of the keyboard-focused item (roving tabindex). */
  private _focusedIndex = 0;

  /** Icon ID currently being dragged, if any. */
  private _draggedIconId: string | undefined;

  /** User-defined icon order (persisted). */
  private _iconOrder: string[] = [];

  // ── Events ──

  private readonly _onDidClickIcon = this._register(new Emitter<ActivityBarIconClickEvent>());
  readonly onDidClickIcon: Event<ActivityBarIconClickEvent> = this._onDidClickIcon.event;

  private readonly _onDidChangeActiveIcon = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveIcon: Event<string | undefined> = this._onDidChangeActiveIcon.event;

  /**
   * Fired when the user right-clicks (context menu) an activity bar icon.
   * Payload includes the icon ID and the mouse position for anchor.
   */
  private readonly _onDidContextMenuIcon = this._register(new Emitter<{ iconId: string; x: number; y: number }>());
  readonly onDidContextMenuIcon: Event<{ iconId: string; x: number; y: number }> = this._onDidContextMenuIcon.event;

  private readonly _onDidChangeIconOrder = this._register(new Emitter<void>());
  readonly onDidChangeIconOrder: Event<void> = this._onDidChangeIconOrder.event;

  // ── Constructor ──

  constructor() {
    super(
      PartId.ActivityBar,
      'Activity Bar',
      PartPosition.Left,
      ACTIVITY_BAR_CONSTRAINTS,
      true,
    );
  }

  // ── Getters ──

  get activeIconId(): string | undefined {
    return this._activeIconId;
  }

  // ── Icon Management ──

  /**
   * Add an icon to the activity bar.
   * Built-in icons appear in the top section; contributed icons appear below the separator.
   */
  addIcon(descriptor: ActivityBarIconDescriptor): IDisposable {
    if (this._icons.has(descriptor.id)) {
      console.warn(`[ActivityBarPart] Icon "${descriptor.id}" already registered, skipping`);
      return { dispose: () => {} };
    }

    this._icons.set(descriptor.id, descriptor);
    const btn = this._createIconButton(descriptor);

    // If a saved icon order exists, insert at the correct position
    // instead of appending to the end. Icons not in the saved order
    // go to the end (after all known icons).
    const savedIdx = this._iconOrder.indexOf(descriptor.id);
    if (savedIdx >= 0) {
      // Find the first existing button whose saved index is greater
      const buttons = Array.from(this._iconSection.querySelectorAll<HTMLElement>('.activity-bar-item'));
      let inserted = false;
      for (const existing of buttons) {
        const existingIdx = this._iconOrder.indexOf(existing.dataset.iconId!);
        if (existingIdx < 0 || existingIdx > savedIdx) {
          this._iconSection.insertBefore(btn, existing);
          inserted = true;
          break;
        }
      }
      if (!inserted) {
        this._iconSection.appendChild(btn);
      }
    } else {
      this._iconSection.appendChild(btn);
    }

    // Keep roving tabindex in sync
    this._syncRovingTabindex();

    return toDisposable(() => {
      this.removeIcon(descriptor.id);
    });
  }

  /**
   * Remove an icon from the activity bar.
   */
  removeIcon(iconId: string): void {
    const descriptor = this._icons.get(iconId);
    if (!descriptor) return;

    this._icons.delete(iconId);
    this._badges.delete(iconId);
    this._badgeElements.delete(iconId);

    // Remove DOM element
    const btn = this._iconSection.querySelector(`[data-icon-id="${iconId}"]`);
    btn?.remove();

    // If the removed icon was active, clear
    if (this._activeIconId === iconId) {
      this._activeIconId = undefined;
      this._onDidChangeActiveIcon.fire(undefined);
    }

    // Keep roving tabindex in sync
    this._syncRovingTabindex();
  }

  /**
   * Set the active (highlighted) icon.
   */
  setActiveIcon(iconId: string | undefined): void {
    if (this._activeIconId === iconId) return;

    // Remove active state from previous
    if (this._activeIconId) {
      const prev = this._findButton(this._activeIconId);
      prev?.classList.remove('active');
      prev?.setAttribute('aria-selected', 'false');
    }

    this._activeIconId = iconId;

    // Apply active state to new
    if (iconId) {
      const next = this._findButton(iconId);
      next?.classList.add('active');
      next?.setAttribute('aria-selected', 'true');
    }

    this._onDidChangeActiveIcon.fire(iconId);
  }

  /**
   * Check if an icon is registered.
   */
  hasIcon(iconId: string): boolean {
    return this._icons.has(iconId);
  }

  /**
   * Get all registered icon descriptors.
   */
  getIcons(): readonly ActivityBarIconDescriptor[] {
    return [...this._icons.values()];
  }

  // ── Badge Management ──

  /**
   * Set or clear a badge on an activity bar icon.
   *
   * VS Code reference: CompositeBarActionViewItem.updateActivity()
   * - NumberBadge → shows count (max "99+")
   * - IconBadge → shows dot indicator
   * - ProgressBadge → shows progress (not implemented in Parallx yet)
   *
   * @param iconId The icon to badge.
   * @param badge The badge descriptor, or `undefined` to clear.
   */
  setBadge(iconId: string, badge: ActivityBarBadge | undefined): void {
    const els = this._badgeElements.get(iconId);
    if (!els) return;

    if (!badge || (!badge.count && !badge.dot)) {
      // Clear badge
      this._badges.delete(iconId);
      els.badge.classList.add('badge-hidden');
      els.badge.classList.remove('activity-bar-badge--count', 'activity-bar-badge--dot');
      els.content.textContent = '';
      return;
    }

    this._badges.set(iconId, badge);

    if (badge.dot) {
      // Dot badge (like VS Code's IconBadge)
      els.badge.classList.remove('badge-hidden');
      els.badge.classList.add('activity-bar-badge--dot');
      els.badge.classList.remove('activity-bar-badge--count');
      els.content.textContent = '';
    } else if (badge.count !== undefined && badge.count > 0) {
      // Count badge (like VS Code's NumberBadge)
      els.badge.classList.remove('badge-hidden');
      els.badge.classList.add('activity-bar-badge--count');
      els.badge.classList.remove('activity-bar-badge--dot');
      els.content.textContent = badge.count > 99 ? '99+' : String(badge.count);
    }
  }

  /**
   * Get the current badge for an icon, or `undefined` if none.
   */
  getBadge(iconId: string): ActivityBarBadge | undefined {
    return this._badges.get(iconId);
  }

  // ── Part overrides ──

  protected override createContent(container: HTMLElement): void {
    container.classList.add('activity-bar');
    // VS Code: .monaco-action-bar [role=tablist] on the vertical action bar
    container.setAttribute('role', 'tablist');
    container.setAttribute('aria-orientation', 'vertical');
    container.setAttribute('aria-label', 'Active View Switcher');

    // Unified icons section (builtin + contributed in one list)
    this._iconSection = $('div');
    this._iconSection.classList.add('activity-bar-icons');
    container.appendChild(this._iconSection);

    // Accept drops anywhere in the icon section to suppress the 🚫 cursor
    this._iconSection.addEventListener('dragover', (e) => {
      if (this._draggedIconId) e.preventDefault();
    });

    // Spacer (pushes bottom section down)
    this._spacer = $('div');
    this._spacer.classList.add('activity-bar-spacer');
    container.appendChild(this._spacer);

    // Bottom section (settings gear, account, etc.)
    this._bottomSection = $('div');
    this._bottomSection.classList.add('activity-bar-bottom');
    container.appendChild(this._bottomSection);

    // Keyboard navigation — VS Code ActionBar pattern (vertical orientation)
    this._register(
      (() => {
        const handler = (e: KeyboardEvent) => this._onKeyDown(e);
        container.addEventListener('keydown', handler);
        return toDisposable(() => container.removeEventListener('keydown', handler));
      })(),
    );
  }

  protected override savePartData(): Record<string, unknown> | undefined {
    return {
      activeIconId: this._activeIconId,
      iconOrder: this._iconOrder,
    };
  }

  protected override restorePartData(data: Record<string, unknown>): void {
    // Restore icon order first, then active icon
    if (Array.isArray(data.iconOrder)) {
      this._iconOrder = data.iconOrder as string[];
      this._applyIconOrder();
    }

    const savedActive = data.activeIconId;
    if (typeof savedActive === 'string' && this._icons.has(savedActive)) {
      this.setActiveIcon(savedActive);
    }
  }

  // ── Keyboard navigation ──
  // VS Code pattern: ActionBar with vertical orientation (Up/Down/Home/End/Enter/Space)
  // Roving tabindex: only the focused item has tabIndex=0, all others -1.

  /**
   * Get all tab-role buttons in DOM order.
   */
  private _getAllButtons(): HTMLButtonElement[] {
    return Array.from(
      this.contentElement.querySelectorAll<HTMLButtonElement>('.activity-bar-item'),
    );
  }

  /**
   * Handle keydown on the activity-bar container.
   */
  private _onKeyDown(e: KeyboardEvent): void {
    const buttons = this._getAllButtons();
    if (buttons.length === 0) return;

    let handled = true;

    switch (e.key) {
      case 'ArrowDown':
        this._focusRelative(buttons, 1);
        break;
      case 'ArrowUp':
        this._focusRelative(buttons, -1);
        break;
      case 'Home':
        this._focusAt(buttons, 0);
        break;
      case 'End':
        this._focusAt(buttons, buttons.length - 1);
        break;
      case 'Enter':
      case ' ':
        // Activate the focused item
        buttons[this._focusedIndex]?.click();
        break;
      default:
        handled = false;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /**
   * Move focus by `delta` positions (wrapping).
   */
  private _focusRelative(buttons: HTMLButtonElement[], delta: number): void {
    const len = buttons.length;
    const next = (this._focusedIndex + delta + len) % len;
    this._focusAt(buttons, next);
  }

  /**
   * Focus the button at `index` and update roving tabindex.
   */
  private _focusAt(buttons: HTMLButtonElement[], index: number): void {
    // Remove tabindex from previous
    const prev = buttons[this._focusedIndex];
    if (prev) prev.tabIndex = -1;

    this._focusedIndex = index;

    const next = buttons[index];
    if (next) {
      next.tabIndex = 0;
      next.focus();
    }
  }

  /**
   * Synchronise roving tabindex after buttons are added/removed.
   * Ensures exactly one button has tabIndex=0.
   */
  private _syncRovingTabindex(): void {
    const buttons = this._getAllButtons();
    // Clamp index
    if (this._focusedIndex >= buttons.length) {
      this._focusedIndex = Math.max(0, buttons.length - 1);
    }
    buttons.forEach((btn, i) => {
      btn.tabIndex = i === this._focusedIndex ? 0 : -1;
    });
  }

  // ── DOM helpers ──

  private _createIconButton(descriptor: ActivityBarIconDescriptor): HTMLButtonElement {
    const btn = $('button');
    btn.classList.add('activity-bar-item');
    btn.dataset.iconId = descriptor.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', descriptor.label);
    btn.setAttribute('aria-selected', 'false');
    // Roving tabindex: new buttons start at -1; _syncRovingTabindex sets the first to 0
    btn.tabIndex = -1;

    // Icon label (SVG or text glyph)
    const iconLabel = $('span');
    iconLabel.classList.add('activity-bar-icon-label');
    if (descriptor.isSvg) {
      iconLabel.innerHTML = descriptor.icon;
    } else {
      iconLabel.textContent = descriptor.icon;
    }
    btn.appendChild(iconLabel);

    // Badge element (VS Code: .badge > .badge-content, absolute top-right)
    const badge = $('div');
    badge.classList.add('activity-bar-badge', 'badge-hidden'); // hidden until setBadge is called
    const badgeContent = $('span');
    badgeContent.classList.add('activity-bar-badge-content');
    badge.appendChild(badgeContent);
    btn.appendChild(badge);

    // Track badge elements for efficient updates
    this._badgeElements.set(descriptor.id, { badge, content: badgeContent });

    // Active item indicator (VS Code: .active-item-indicator with ::before border-left)
    const indicator = $('div');
    indicator.classList.add('activity-bar-active-indicator');
    btn.appendChild(indicator);

    // Custom themed tooltip (replaces native title attribute)
    setupTooltip(btn, descriptor.label, { placement: 'right' });

    btn.addEventListener('click', () => {
      this._onDidClickIcon.fire({
        iconId: descriptor.id,
        source: descriptor.source,
      });
    });

    // P2.7: Context menu on right-click
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._onDidContextMenuIcon.fire({
        iconId: descriptor.id,
        x: e.clientX,
        y: e.clientY,
      });
    });

    // ── Drag & drop reordering ──
    btn.draggable = true;

    btn.addEventListener('dragstart', (e) => {
      this._draggedIconId = descriptor.id;
      btn.classList.add('activity-bar-item--dragging');
      e.dataTransfer!.effectAllowed = 'move';
    });

    btn.addEventListener('dragover', (e) => {
      if (!this._draggedIconId || this._draggedIconId === descriptor.id) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';

      // Clear all indicators first.
      this.contentElement.querySelectorAll('.activity-bar-drop-before, .activity-bar-drop-after')
        .forEach(el => el.classList.remove('activity-bar-drop-before', 'activity-bar-drop-after'));

      // Normalize: always use drop-after on the upper item so each gap
      // has exactly one indicator line. Only use drop-before when there
      // is no previous sibling (top edge of first icon).
      const rect = btn.getBoundingClientRect();
      const inTopHalf = e.clientY < rect.top + rect.height / 2;
      if (inTopHalf) {
        const prev = btn.previousElementSibling as HTMLElement | null;
        if (prev?.classList.contains('activity-bar-item')) {
          prev.classList.add('activity-bar-drop-after');
        } else {
          btn.classList.add('activity-bar-drop-before');
        }
      } else {
        btn.classList.add('activity-bar-drop-after');
      }
    });

    btn.addEventListener('dragleave', (e) => {
      // Ignore dragleave when moving to a child element inside this button
      if (btn.contains(e.relatedTarget as Node)) return;
      btn.classList.remove('activity-bar-drop-before', 'activity-bar-drop-after');
    });

    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      btn.classList.remove('activity-bar-drop-before', 'activity-bar-drop-after');
      if (!this._draggedIconId || this._draggedIconId === descriptor.id) return;

      const draggedBtn = this._findButton(this._draggedIconId);
      if (!draggedBtn) return;

      const rect = btn.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) {
        this._iconSection.insertBefore(draggedBtn, btn);
      } else {
        this._iconSection.insertBefore(draggedBtn, btn.nextSibling);
      }

      this._persistIconOrder();
      this._syncRovingTabindex();
    });

    btn.addEventListener('dragend', () => {
      btn.classList.remove('activity-bar-item--dragging');
      // Clean up any lingering indicators
      this.contentElement.querySelectorAll('.activity-bar-drop-before, .activity-bar-drop-after')
        .forEach(el => el.classList.remove('activity-bar-drop-before', 'activity-bar-drop-after'));
      this._draggedIconId = undefined;
    });

    return btn;
  }

  private _findButton(iconId: string): HTMLElement | null {
    return this.contentElement.querySelector(`[data-icon-id="${iconId}"]`);
  }

  /** Snapshot current DOM order into _iconOrder for persistence. */
  private _persistIconOrder(): void {
    const buttons = this._getAllButtons();
    this._iconOrder = buttons
      .map(b => b.dataset.iconId!)
      .filter(id => id && id !== 'manage-gear');
    this._onDidChangeIconOrder.fire();
  }

  /** Reorder DOM to match _iconOrder (called on restore). */
  private _applyIconOrder(): void {
    if (!this._iconSection) return;
    const buttons = Array.from(this._iconSection.querySelectorAll<HTMLButtonElement>('.activity-bar-item'));
    const ordered = buttons.sort((a, b) => {
      const ai = this._iconOrder.indexOf(a.dataset.iconId!);
      const bi = this._iconOrder.indexOf(b.dataset.iconId!);
      const aIdx = ai >= 0 ? ai : Infinity;
      const bIdx = bi >= 0 ? bi : Infinity;
      return aIdx - bIdx;
    });
    for (const btn of ordered) {
      this._iconSection.appendChild(btn);
    }
    this._syncRovingTabindex();
  }
}

// ─── Part Descriptor ─────────────────────────────────────────────────────────

export const activityBarPartDescriptor: PartDescriptor = {
  id: PartId.ActivityBar,
  name: 'Activity Bar',
  position: PartPosition.Left,
  defaultVisible: true,
  constraints: ACTIVITY_BAR_CONSTRAINTS,
  factory: () => new ActivityBarPart(),
};
