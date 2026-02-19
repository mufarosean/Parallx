// statusBarPart.ts — bottom status information bar
//
// VS Code parity:
//   - `src/vs/workbench/browser/parts/statusbar/statusbarPart.ts`
//   - `src/vs/workbench/browser/parts/statusbar/statusbarModel.ts`
//   - `src/vs/workbench/browser/parts/statusbar/media/statusbarpart.css`
//
// DOM structure (matches VS Code):
//   .part.statusbar
//     .left-items.items-container     (flex, flex-grow: 1)
//       .statusbar-item.left
//         a.statusbar-item-label      (role="button", tabindex=-1)
//     .right-items.items-container    (flex, flex-direction: row-reverse)
//       .statusbar-item.right
//         a.statusbar-item-label
//
// Entries are sorted by priority within each alignment group.
// Higher priority = further left (for left items) or further right (for right items).

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { StatusBarAlignment, StatusBarEntry, StatusBarEntryAccessor } from '../services/serviceTypes.js';
import { Emitter, Event } from '../platform/events.js';
import { toDisposable } from '../platform/lifecycle.js';
import { $ } from '../ui/dom.js';

export { StatusBarAlignment };
export type { StatusBarEntry, StatusBarEntryAccessor };

/** Fixed status bar height — matches VS Code's `StatusbarPart.HEIGHT = 22`. */
export const STATUS_BAR_HEIGHT = 22;

const STATUSBAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 0,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: STATUS_BAR_HEIGHT,
  maximumHeight: STATUS_BAR_HEIGHT,
};

// ─── Internal view-model entry ───────────────────────────────────────────────

interface StatusBarViewModelEntry {
  readonly id: string;
  readonly alignment: StatusBarAlignment;
  readonly priority: number;
  entry: StatusBarEntry;
  container: HTMLElement;
  label: HTMLElement;
}

// ─── StatusBarPart ───────────────────────────────────────────────────────────

/**
 * Status bar part — occupies the bottom edge of the workbench.
 *
 * VS Code parity: entries are added via `addEntry()` returning an accessor,
 * not by hardcoding DOM elements. The shell and tools both use the same
 * `addEntry()` API to contribute entries.
 */
export class StatusBarPart extends Part {

  private _leftItemsContainer: HTMLElement | undefined;
  private _rightItemsContainer: HTMLElement | undefined;

  /** View-model entries keyed by ID. */
  private readonly _entries = new Map<string, StatusBarViewModelEntry>();

  /** Command handler — wired by workbench after construction. */
  private _commandExecutor: ((commandId: string) => void) | undefined;

  // ── Events ──

  private readonly _onDidAddEntry = this._register(new Emitter<StatusBarEntry>());
  readonly onDidAddEntry: Event<StatusBarEntry> = this._onDidAddEntry.event;

  private readonly _onDidRemoveEntry = this._register(new Emitter<string>());
  readonly onDidRemoveEntry: Event<string> = this._onDidRemoveEntry.event;

  /** Fired on right-click in the status bar area (context menu). */
  private readonly _onDidContextMenu = this._register(new Emitter<{ x: number; y: number }>());
  readonly onDidContextMenu: Event<{ x: number; y: number }> = this._onDidContextMenu.event;

  constructor() {
    super(
      PartId.StatusBar,
      'Status Bar',
      PartPosition.Bottom,
      STATUSBAR_CONSTRAINTS,
      true,
    );
  }

  // ── Command executor (wired by workbench) ──

  /**
   * Wire the command executor so entry clicks can execute commands.
   * In VS Code this is done via DI (`ICommandService`); here we use a
   * simple callback to avoid circular dependencies.
   */
  setCommandExecutor(executor: (commandId: string) => void): void {
    this._commandExecutor = executor;
  }

  // ── Entry management (contribution API) ──

  /**
   * Add a status bar entry. Returns an accessor to update or dispose it.
   *
   * VS Code parity: `IStatusbarEntryContainer.addEntry()`.
   */
  addEntry(entry: StatusBarEntry): StatusBarEntryAccessor {
    // Remove existing entry with same ID (update semantics)
    if (this._entries.has(entry.id)) {
      this._removeEntryElement(entry.id);
    }

    const priority = entry.priority ?? 0;

    // Create DOM: .statusbar-item > a.statusbar-item-label
    const itemContainer = $('div');
    itemContainer.className = 'statusbar-item';
    itemContainer.id = entry.id;
    itemContainer.classList.add(entry.alignment === StatusBarAlignment.Left ? 'left' : 'right');

    const label = $('a');
    label.className = 'statusbar-item-label';
    label.setAttribute('role', 'button');
    label.tabIndex = -1;
    this._applyEntryToLabel(label, entry);
    itemContainer.appendChild(label);

    // Click handler
    if (entry.command) {
      label.addEventListener('click', () => {
        if (entry.command && this._commandExecutor) {
          this._commandExecutor(entry.command);
        }
      });
    }

    // Store view-model entry
    const vmEntry: StatusBarViewModelEntry = {
      id: entry.id,
      alignment: entry.alignment,
      priority,
      entry,
      container: itemContainer,
      label,
    };
    this._entries.set(entry.id, vmEntry);

    // Append to correct container
    this._insertEntry(vmEntry);
    this._onDidAddEntry.fire(entry);

    // Return accessor
    return {
      update: (update) => {
        const existing = this._entries.get(entry.id);
        if (!existing) return;
        const updated: StatusBarEntry = {
          ...existing.entry,
          ...(update.text !== undefined ? { text: update.text } : {}),
          ...(update.tooltip !== undefined ? { tooltip: update.tooltip } : {}),
          ...(update.command !== undefined ? { command: update.command } : {}),
          ...(update.iconSvg !== undefined ? { iconSvg: update.iconSvg } : {}),
        };
        existing.entry = updated;
        this._applyEntryToLabel(existing.label, updated);

        // Re-wire click if command changed
        if (update.command !== undefined) {
          const newLabel = existing.label.cloneNode(false) as HTMLElement;
          this._applyEntryToLabel(newLabel, updated);
          if (updated.command) {
            newLabel.addEventListener('click', () => {
              if (updated.command && this._commandExecutor) {
                this._commandExecutor(updated.command);
              }
            });
          }
          existing.container.replaceChild(newLabel, existing.label);
          existing.label = newLabel;
        }
      },
      dispose: () => {
        this._removeEntryElement(entry.id);
      },
    };
  }

  /**
   * Legacy compat: update an entry by ID (used by workbench before accessor pattern).
   */
  updateEntry(id: string, update: Partial<Pick<StatusBarEntry, 'text' | 'tooltip'>>): void {
    const vm = this._entries.get(id);
    if (!vm) return;
    const updated: StatusBarEntry = {
      ...vm.entry,
      ...(update.text !== undefined ? { text: update.text } : {}),
      ...(update.tooltip !== undefined ? { tooltip: update.tooltip } : {}),
    };
    vm.entry = updated;
    this._applyEntryToLabel(vm.label, updated);
  }

  /**
   * Remove an entry by ID.
   */
  removeEntry(id: string): void {
    this._removeEntryElement(id);
  }

  /**
   * Get all current entries (sorted by alignment then priority).
   */
  getEntries(): readonly StatusBarEntry[] {
    return [...this._entries.values()]
      .sort((a, b) => b.priority - a.priority)
      .map(vm => vm.entry);
  }

  // ── Part hooks ──

  protected override createContent(container: HTMLElement): void {
    // VS Code: .left-items.items-container and .right-items.items-container
    this._leftItemsContainer = $('div');
    this._leftItemsContainer.className = 'left-items items-container';
    container.appendChild(this._leftItemsContainer);

    this._rightItemsContainer = $('div');
    this._rightItemsContainer.className = 'right-items items-container';
    container.appendChild(this._rightItemsContainer);

    // Context menu (right-click)
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      this._onDidContextMenu.fire({ x: e.clientX, y: e.clientY });
    };
    container.addEventListener('contextmenu', handler);
    this._register(toDisposable(() => container.removeEventListener('contextmenu', handler)));
  }

  // ── Internals ──

  /**
   * Apply entry text/tooltip to the label element.
   * VS Code parses `$(icon-name)` via `StatusBarCodiconLabel` — in M3
   * we render them as plain text (matching milestone spec).
   */
  private _applyEntryToLabel(label: HTMLElement, entry: StatusBarEntry): void {
    // Build content: optional SVG icon + text
    label.textContent = '';
    if (entry.iconSvg) {
      const iconSpan = $('span');
      iconSpan.className = 'statusbar-item-icon';
      iconSpan.innerHTML = entry.iconSvg;
      // Size the SVG to match status bar font size
      const svg = iconSpan.querySelector('svg');
      if (svg) {
        svg.setAttribute('width', '14');
        svg.setAttribute('height', '14');
        svg.style.display = 'block';
      }
      label.appendChild(iconSpan);
    }
    if (entry.text) {
      const textSpan = $('span');
      textSpan.className = 'statusbar-item-text';
      textSpan.textContent = entry.text;
      label.appendChild(textSpan);
    }
    if (entry.tooltip) {
      label.title = entry.tooltip;
    } else {
      label.removeAttribute('title');
    }
    // Cursor style: pointer for clickable entries (VS Code parity)
    if (entry.command) {
      label.style.cursor = 'pointer';
    } else {
      label.style.cursor = 'default';
    }
  }

  /**
   * Insert a view-model entry into the correct container, sorted by priority.
   *
   * VS Code parity: left items sorted highest-priority first (left-to-right).
   * Right items use `flex-direction: row-reverse`, so we also insert
   * highest-priority first — CSS reversal means they appear rightmost.
   */
  private _insertEntry(vmEntry: StatusBarViewModelEntry): void {
    const target = vmEntry.alignment === StatusBarAlignment.Left
      ? this._leftItemsContainer
      : this._rightItemsContainer;
    if (!target) return;

    // Collect same-alignment entries sorted by priority descending
    const siblings = [...this._entries.values()]
      .filter(e => e.alignment === vmEntry.alignment && e.id !== vmEntry.id)
      .sort((a, b) => b.priority - a.priority);

    // Find insert position: before the first sibling with lower priority
    let insertBefore: HTMLElement | null = null;
    for (const sib of siblings) {
      if (sib.priority < vmEntry.priority) {
        insertBefore = sib.container;
        break;
      }
    }

    if (insertBefore) {
      target.insertBefore(vmEntry.container, insertBefore);
    } else {
      target.appendChild(vmEntry.container);
    }
  }

  /**
   * Remove an entry's DOM and view-model record.
   */
  private _removeEntryElement(id: string): void {
    const vm = this._entries.get(id);
    if (vm) {
      vm.container.remove();
      this._entries.delete(id);
      this._onDidRemoveEntry.fire(id);
    }
  }
}

export const statusBarPartDescriptor: PartDescriptor = {
  id: PartId.StatusBar,
  name: 'Status Bar',
  position: PartPosition.Bottom,
  defaultVisible: true,
  constraints: STATUSBAR_CONSTRAINTS,
  factory: () => new StatusBarPart(),
};
