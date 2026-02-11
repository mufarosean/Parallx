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
  /** Icon text (emoji, Unicode glyph, or single-character fallback). */
  readonly icon: string;
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

  /** Container for built-in icons (top section). */
  private _builtinSection!: HTMLElement;

  /** Separator between built-in and contributed icons. */
  private _separator: HTMLElement | undefined;

  /** Container for tool-contributed icons (middle section). */
  private _contributedSection!: HTMLElement;

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

  // ── Events ──

  private readonly _onDidClickIcon = this._register(new Emitter<ActivityBarIconClickEvent>());
  readonly onDidClickIcon: Event<ActivityBarIconClickEvent> = this._onDidClickIcon.event;

  private readonly _onDidChangeActiveIcon = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveIcon: Event<string | undefined> = this._onDidChangeActiveIcon.event;

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

    if (descriptor.source === 'builtin') {
      this._builtinSection.appendChild(btn);
    } else {
      this._ensureSeparator();
      this._contributedSection.appendChild(btn);
    }

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
    const section = descriptor.source === 'builtin' ? this._builtinSection : this._contributedSection;
    const btn = section.querySelector(`[data-icon-id="${iconId}"]`);
    btn?.remove();

    // Remove separator if no more contributed icons
    if (descriptor.source === 'contributed' && this._contributedSection.children.length === 0) {
      this._removeSeparator();
    }

    // If the removed icon was active, clear
    if (this._activeIconId === iconId) {
      this._activeIconId = undefined;
      this._onDidChangeActiveIcon.fire(undefined);
    }
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
    }

    this._activeIconId = iconId;

    // Apply active state to new
    if (iconId) {
      const next = this._findButton(iconId);
      next?.classList.add('active');
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
      els.badge.style.display = 'none';
      els.badge.classList.remove('activity-bar-badge--count', 'activity-bar-badge--dot');
      els.content.textContent = '';
      return;
    }

    this._badges.set(iconId, badge);

    if (badge.dot) {
      // Dot badge (like VS Code's IconBadge)
      els.badge.style.display = '';
      els.badge.classList.add('activity-bar-badge--dot');
      els.badge.classList.remove('activity-bar-badge--count');
      els.content.textContent = '';
    } else if (badge.count !== undefined && badge.count > 0) {
      // Count badge (like VS Code's NumberBadge)
      els.badge.style.display = '';
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

    // Built-in icons section (top)
    this._builtinSection = document.createElement('div');
    this._builtinSection.classList.add('activity-bar-builtin');
    container.appendChild(this._builtinSection);

    // Contributed icons section (below separator)
    this._contributedSection = document.createElement('div');
    this._contributedSection.classList.add('activity-bar-contributed');
    container.appendChild(this._contributedSection);

    // Spacer (pushes bottom section down)
    this._spacer = document.createElement('div');
    this._spacer.classList.add('activity-bar-spacer');
    container.appendChild(this._spacer);

    // Bottom section (settings gear, account, etc.)
    this._bottomSection = document.createElement('div');
    this._bottomSection.classList.add('activity-bar-bottom');
    container.appendChild(this._bottomSection);
  }

  protected override savePartData(): Record<string, unknown> | undefined {
    return {
      activeIconId: this._activeIconId,
    };
  }

  protected override restorePartData(data: Record<string, unknown>): void {
    const savedActive = data.activeIconId;
    if (typeof savedActive === 'string' && this._icons.has(savedActive)) {
      this.setActiveIcon(savedActive);
    }
  }

  // ── DOM helpers ──

  private _createIconButton(descriptor: ActivityBarIconDescriptor): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.classList.add('activity-bar-item');
    btn.dataset.iconId = descriptor.id;
    btn.title = descriptor.label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', descriptor.label);

    // Icon label (the emoji/glyph)
    const iconLabel = document.createElement('span');
    iconLabel.classList.add('activity-bar-icon-label');
    iconLabel.textContent = descriptor.icon;
    btn.appendChild(iconLabel);

    // Badge element (VS Code: .badge > .badge-content, absolute top-right)
    const badge = document.createElement('div');
    badge.classList.add('activity-bar-badge');
    badge.style.display = 'none'; // hidden until setBadge is called
    const badgeContent = document.createElement('span');
    badgeContent.classList.add('activity-bar-badge-content');
    badge.appendChild(badgeContent);
    btn.appendChild(badge);

    // Track badge elements for efficient updates
    this._badgeElements.set(descriptor.id, { badge, content: badgeContent });

    // Active item indicator (VS Code: .active-item-indicator with ::before border-left)
    const indicator = document.createElement('div');
    indicator.classList.add('activity-bar-active-indicator');
    btn.appendChild(indicator);

    btn.addEventListener('click', () => {
      this._onDidClickIcon.fire({
        iconId: descriptor.id,
        source: descriptor.source,
      });
    });

    return btn;
  }

  private _findButton(iconId: string): HTMLElement | null {
    return this.contentElement.querySelector(`[data-icon-id="${iconId}"]`);
  }

  private _ensureSeparator(): void {
    if (this._separator) return;
    this._separator = document.createElement('div');
    this._separator.classList.add('activity-bar-separator');
    // Insert separator before contributed section
    this.contentElement.insertBefore(this._separator, this._contributedSection);
  }

  private _removeSeparator(): void {
    if (this._separator) {
      this._separator.remove();
      this._separator = undefined;
    }
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
