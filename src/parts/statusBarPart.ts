// statusBarPart.ts — bottom status information bar

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';
import { toDisposable } from '../platform/lifecycle.js';

const STATUSBAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 0,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 22,
  maximumHeight: 22,
};

/**
 * Status bar alignment for items.
 */
export enum StatusBarAlignment {
  Left = 'left',
  Right = 'right',
}

/**
 * Descriptor for a status bar entry.
 */
export interface StatusBarEntry {
  readonly id: string;
  readonly text: string;
  readonly alignment: StatusBarAlignment;
  readonly priority?: number;
  readonly tooltip?: string;
  readonly command?: string;
}

/**
 * Status bar part — occupies the bottom edge of the workbench.
 * Displays status information items aligned left and right.
 */
export class StatusBarPart extends Part {

  private _leftSlot: HTMLElement | undefined;
  private _rightSlot: HTMLElement | undefined;

  private readonly _entries = new Map<string, StatusBarEntry>();
  private readonly _entryElements = new Map<string, HTMLElement>();

  private readonly _onDidAddEntry = this._register(new Emitter<StatusBarEntry>());
  readonly onDidAddEntry: Event<StatusBarEntry> = this._onDidAddEntry.event;

  private readonly _onDidRemoveEntry = this._register(new Emitter<string>());
  readonly onDidRemoveEntry: Event<string> = this._onDidRemoveEntry.event;

  private readonly _onDidClickEntry = this._register(new Emitter<{ id: string; command: string }>());
  readonly onDidClickEntry: Event<{ id: string; command: string }> = this._onDidClickEntry.event;

  /** P2.8: Fired on right-click in the status bar area. */
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

  get leftSlot(): HTMLElement | undefined { return this._leftSlot; }
  get rightSlot(): HTMLElement | undefined { return this._rightSlot; }

  // ── Entry management ──

  addEntry(entry: StatusBarEntry): void {
    this._entries.set(entry.id, entry);

    const el = document.createElement('span');
    el.classList.add('statusbar-entry', `statusbar-entry-${entry.id}`);
    el.textContent = entry.text;
    if (entry.tooltip) {
      el.title = entry.tooltip;
    }
    if (entry.command) {
      el.setAttribute('role', 'button');
      el.addEventListener('click', () => {
        this._onDidClickEntry.fire({ id: entry.id, command: entry.command! });
      });
    }

    this._entryElements.set(entry.id, el);
    this._appendEntryToSlot(entry, el);
    this._onDidAddEntry.fire(entry);
  }

  updateEntry(id: string, update: Partial<Pick<StatusBarEntry, 'text' | 'tooltip'>>): void {
    const entry = this._entries.get(id);
    const el = this._entryElements.get(id);
    if (!entry || !el) { return; }

    // Update the stored entry to keep it in sync with the DOM
    const updated: StatusBarEntry = {
      ...entry,
      ...(update.text !== undefined ? { text: update.text } : {}),
      ...(update.tooltip !== undefined ? { tooltip: update.tooltip } : {}),
    };
    this._entries.set(id, updated);

    if (update.text !== undefined) {
      el.textContent = update.text;
    }
    if (update.tooltip !== undefined) {
      el.title = update.tooltip;
    }
  }

  removeEntry(id: string): void {
    const el = this._entryElements.get(id);
    if (el) {
      el.remove();
      this._entryElements.delete(id);
    }
    this._entries.delete(id);
    this._onDidRemoveEntry.fire(id);
  }

  getEntries(): readonly StatusBarEntry[] {
    return [...this._entries.values()];
  }

  // ── Part hooks ──

  protected override createContent(container: HTMLElement): void {
    container.classList.add('statusbar-content');

    this._leftSlot = document.createElement('div');
    this._leftSlot.classList.add('statusbar-left');
    container.appendChild(this._leftSlot);

    this._rightSlot = document.createElement('div');
    this._rightSlot.classList.add('statusbar-right');
    container.appendChild(this._rightSlot);

    // P2.8: Status bar context menu (right-click to hide items)
    const handler = (e: MouseEvent) => {
      e.preventDefault();
      this._onDidContextMenu.fire({ x: e.clientX, y: e.clientY });
    };
    container.addEventListener('contextmenu', handler);
    this._register(toDisposable(() => container.removeEventListener('contextmenu', handler)));
  }

  // ── Internals ──

  private _appendEntryToSlot(entry: StatusBarEntry, el: HTMLElement): void {
    const slot = entry.alignment === StatusBarAlignment.Left
      ? this._leftSlot
      : this._rightSlot;

    if (!slot) { return; }

    // Insert by priority (lower = earlier)
    const priority = entry.priority ?? 0;
    const children = Array.from(slot.children) as HTMLElement[];
    let inserted = false;
    for (const child of children) {
      const childId = child.classList.item(1)?.replace('statusbar-entry-', '');
      const childEntry = childId ? this._entries.get(childId) : undefined;
      if (childEntry && (childEntry.priority ?? 0) > priority) {
        slot.insertBefore(el, child);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      slot.appendChild(el);
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
