// iconPicker.ts — Reusable icon picker overlay
//
// Floating grid of icon buttons with optional search input and
// "Remove icon" button. Positioned near an anchor element,
// dismissed on outside click or Escape.
//
// VS Code reference: quick-pick overlay pattern adapted for icon selection.

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { layoutPopup } from './dom.js';
import './iconPicker.css';

// ─── Options ─────────────────────────────────────────────────────────────────

export interface IIconPickerOptions {
  /** Anchor element used for positioning the picker. */
  readonly anchor: HTMLElement;
  /** Icon IDs to show in the grid. */
  readonly icons: readonly string[];
  /**
   * Optional, larger pool of icon IDs used when the user types into the
   * search box.  If omitted, search filters from `icons`.  Set this to a
   * full catalog (e.g. all Lucide icons) when you want the default grid to
   * stay small for performance but searching to reach a wider set.
   */
  readonly searchPool?: readonly string[];
  /**
   * Renders an icon into an HTML string (e.g. returning an SVG string).
   * Called for each icon button in the grid.
   */
  readonly renderIcon: (iconId: string, size: number) => string;
  /** Whether to show the search input. Default: `true`. */
  readonly showSearch?: boolean;
  /** Whether to show a "Remove icon" button. Default: `false`. */
  readonly showRemove?: boolean;
  /** Icon size in pixels passed to `renderIcon`. Default: `22`. */
  readonly iconSize?: number;
  /**
   * When set, the picker shows a "Recently used" section above the grid
   * (only while not searching) and records each pick under this localStorage
   * key, so frequently-used icons surface without searching. The same key
   * shared across pickers gives one unified recents list; different keys keep
   * separate ones. No-op when localStorage is unavailable.
   */
  readonly recentStorageKey?: string;
  /** Max recent icons to keep and show. Default: `14` (two rows of 7). */
  readonly maxRecent?: number;
}

// ─── Recently-used persistence ─────────────────────────────────────────────────

/** Default cap on recent icons (two rows in the 7-column grid). */
const DEFAULT_MAX_RECENT = 14;

/**
 * Load recently-used icon IDs (most-recent first) from localStorage.
 * Defensive: returns `[]` if storage is unavailable or the value is malformed.
 */
export function loadRecentIcons(storageKey: string, cap: number = DEFAULT_MAX_RECENT): string[] {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, cap);
  } catch {
    return [];
  }
}

/**
 * Record `iconId` as most-recently-used: prepend, de-duplicate, cap, persist.
 * Defensive no-op if localStorage throws (private mode, quota, etc.) —
 * recents are a convenience and must never block icon selection.
 */
export function recordRecentIcon(storageKey: string, iconId: string, cap: number = DEFAULT_MAX_RECENT): void {
  if (!iconId) return;
  try {
    const current = loadRecentIcons(storageKey, cap);
    const next = [iconId, ...current.filter((id) => id !== iconId)].slice(0, cap);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// ─── IconPicker ──────────────────────────────────────────────────────────────

/**
 * A floating icon picker overlay.
 *
 * CSS classes (co-located in `iconPicker.css`):
 * - `.ui-icon-picker` — root overlay
 * - `.ui-icon-picker-search` — search input
 * - `.ui-icon-picker-remove` — remove button
 * - `.ui-icon-picker-content` — scrollable content area
 * - `.ui-icon-picker-grid` — icon grid
 * - `.ui-icon-picker-btn` — individual icon button
 * - `.ui-icon-picker-empty` — "no results" label
 *
 * Events:
 * - `onDidSelectIcon` — fired when an icon button is clicked (payload: icon ID)
 * - `onDidRemoveIcon` — fired when "Remove icon" is clicked
 * - `onDidDismiss` — fired when the picker is dismissed (outside click / Escape)
 *
 * Usage:
 * ```ts
 * const picker = new IconPicker(document.body, {
 *   anchor: myIconEl,
 *   icons: PAGE_ICON_IDS,
 *   renderIcon: (id, size) => svgIcon(id),
 *   showSearch: true,
 *   showRemove: true,
 * });
 * picker.onDidSelectIcon(id => { ... });
 * picker.onDidRemoveIcon(() => { ... });
 * // picker auto-disposes when dismissed.
 * ```
 */
export class IconPicker extends Disposable {

  // ── Events ──

  private readonly _onDidSelectIcon = this._register(new Emitter<string>());
  readonly onDidSelectIcon: Event<string> = this._onDidSelectIcon.event;

  private readonly _onDidRemoveIcon = this._register(new Emitter<void>());
  readonly onDidRemoveIcon: Event<void> = this._onDidRemoveIcon.event;

  private readonly _onDidDismiss = this._register(new Emitter<void>());
  readonly onDidDismiss: Event<void> = this._onDidDismiss.event;

  // ── DOM ──

  private readonly _el: HTMLElement;
  private _dismissed = false;

  /** The root DOM element of the picker overlay. */
  get element(): HTMLElement { return this._el; }

  constructor(_container: HTMLElement, private readonly _options: IIconPickerOptions) {
    super();

    const iconSize = _options.iconSize ?? 22;
    const showSearch = _options.showSearch !== false; // default true

    // Root overlay
    this._el = document.createElement('div');
    this._el.classList.add('ui-icon-picker');

    // Search input (optional)
    let searchInput: HTMLInputElement | null = null;
    if (showSearch) {
      searchInput = document.createElement('input');
      searchInput.type = 'text';
      searchInput.placeholder = 'Search icons\u2026';
      searchInput.classList.add('ui-icon-picker-search');
      this._el.appendChild(searchInput);
    }

    // Remove button (optional)
    if (_options.showRemove) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.classList.add('ui-icon-picker-remove');
      removeBtn.textContent = 'Remove Icon';
      removeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._onDidRemoveIcon.fire();
        this.dismiss();
      });
      this._el.appendChild(removeBtn);
    }

    // Scrollable content area
    const contentArea = document.createElement('div');
    contentArea.classList.add('ui-icon-picker-content');
    this._el.appendChild(contentArea);

    const recentStorageKey = _options.recentStorageKey;
    const maxRecent = _options.maxRecent ?? DEFAULT_MAX_RECENT;
    const pool = _options.searchPool ?? _options.icons;
    const poolSet = new Set(pool);

    // One icon button. Records the pick as recent (when enabled) on click.
    const buildButton = (id: string): HTMLButtonElement => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.classList.add('ui-icon-picker-btn');
      btn.title = id;
      btn.innerHTML = _options.renderIcon(id, iconSize);
      const svg = btn.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', String(iconSize));
        svg.setAttribute('height', String(iconSize));
      }
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (recentStorageKey) recordRecentIcon(recentStorageKey, id, maxRecent);
        this._onDidSelectIcon.fire(id);
        this.dismiss();
      });
      return btn;
    };

    const buildGrid = (ids: readonly string[]): HTMLElement => {
      const grid = document.createElement('div');
      grid.classList.add('ui-icon-picker-grid');
      for (const id of ids) grid.appendChild(buildButton(id));
      return grid;
    };

    const buildSectionLabel = (text: string): HTMLElement => {
      const label = document.createElement('div');
      label.classList.add('ui-icon-picker-section-label');
      label.textContent = text;
      return label;
    };

    // Render the content area. While searching, show a single grid of matches
    // from the full pool. Otherwise show the "Recently used" section (when
    // enabled and non-empty) above the default grid.
    const renderGrid = (filter?: string) => {
      contentArea.innerHTML = '';

      const normalized = filter?.toLowerCase();
      if (normalized) {
        const matches = pool.filter(id => id.includes(normalized));
        if (matches.length === 0) {
          const empty = document.createElement('div');
          empty.classList.add('ui-icon-picker-empty');
          empty.textContent = 'No matching icons.';
          contentArea.appendChild(empty);
          return;
        }
        contentArea.appendChild(buildGrid(matches));
        return;
      }

      if (recentStorageKey) {
        // Drop any recents no longer in the catalog so stale IDs don't render.
        const recents = loadRecentIcons(recentStorageKey, maxRecent).filter(id => poolSet.has(id));
        if (recents.length > 0) {
          contentArea.appendChild(buildSectionLabel('Recently used'));
          contentArea.appendChild(buildGrid(recents));
          contentArea.appendChild(buildSectionLabel('All icons'));
        }
      }
      contentArea.appendChild(buildGrid(_options.icons));
    };

    renderGrid();

    // Search handler
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput!.value.trim();
        renderGrid(q || undefined);
      });
    }

    // Mount at document.body to avoid `contain: layout` on ancestor
    // elements (e.g. `.part`, `.grid-branch`) that would shift the
    // `position: fixed` reference frame away from the viewport.
    document.body.appendChild(this._el);

    // Position near anchor, clamped to viewport
    this._positionNearAnchor();

    // Focus search if shown
    if (searchInput) {
      setTimeout(() => searchInput!.focus(), 0);
    }

    // Outside click to dismiss
    this._register(this._listenOutsideClick());

    // Escape to dismiss
    this._register(this._listenEscape());

    // Clean up DOM on dispose
    this._register(toDisposable(() => {
      if (this._el.parentNode) this._el.remove();
    }));
  }

  /** Programmatically dismiss the picker. */
  dismiss(): void {
    if (this._dismissed) return;
    this._dismissed = true;
    this._onDidDismiss.fire();
    this.dispose();
  }

  // ── Positioning ────────────────────────────────────────────────────────

  private _positionNearAnchor(): void {
    const anchorRect = this._options.anchor.getBoundingClientRect();
    layoutPopup(this._el, anchorRect, { position: 'below', gap: 4 });
  }

  // ── Dismiss listeners ──────────────────────────────────────────────────

  private _listenOutsideClick() {
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (this._el.contains(target)) return;
      if (this._options.anchor.contains(target)) return;
      this.dismiss();
    };

    const timerId = setTimeout(() => {
      document.addEventListener('mousedown', handler, true);
    }, 0);

    return toDisposable(() => {
      clearTimeout(timerId);
      document.removeEventListener('mousedown', handler, true);
    });
  }

  private _listenEscape() {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.dismiss();
      }
    };

    document.addEventListener('keydown', handler, true);
    return toDisposable(() => {
      document.removeEventListener('keydown', handler, true);
    });
  }
}
