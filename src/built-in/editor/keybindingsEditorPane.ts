// keybindingsEditorPane.ts — Keyboard Shortcuts viewer pane
//
// Shows a searchable table of all registered keybindings.
// VS Code reference: src/vs/workbench/contrib/preferences/browser/keybindingsEditor.ts
//
// The pane renders keybindings retrieved via the IKeybindingService, which is
// passed in via dependency injection from the workbench.

import './keybindingsEditorPane.css';

import { EditorPane } from '../../editor/editorPane.js';
import type { IEditorInput } from '../../editor/editorInput.js';
import { formatKeybindingForDisplay } from '../../contributions/keybindingContribution.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeybindingEntry {
  key: string;
  commandId: string;
  when?: string;
  source?: string;
}

export type KeybindingsProvider = () => readonly KeybindingEntry[];

// ─── Pane ────────────────────────────────────────────────────────────────────

export class KeybindingsEditorPane extends EditorPane {
  private _container: HTMLElement | undefined;
  private _searchInput: HTMLInputElement | undefined;
  private _tableBody: HTMLTableSectionElement | undefined;
  private _countLabel: HTMLElement | undefined;
  private _emptyMessage: HTMLElement | undefined;
  private _allEntries: KeybindingEntry[] = [];
  private _getKeybindings: KeybindingsProvider;

  constructor(getKeybindings: KeybindingsProvider) {
    super('keybindings-editor-pane');
    this._getKeybindings = getKeybindings;
  }

  // ── Build DOM ──

  protected override createPaneContent(container: HTMLElement): void {
    this._container = document.createElement('div');
    this._container.classList.add('keybindings-editor');

    // Header with search
    const header = document.createElement('div');
    header.classList.add('keybindings-editor-header');

    const title = document.createElement('h2');
    title.textContent = 'Keyboard Shortcuts';
    header.appendChild(title);

    this._searchInput = document.createElement('input');
    this._searchInput.type = 'text';
    this._searchInput.classList.add('keybindings-search-input');
    this._searchInput.placeholder = 'Type to search keybindings…';
    this._searchInput.addEventListener('input', () => this._filterTable());
    header.appendChild(this._searchInput);

    this._countLabel = document.createElement('span');
    this._countLabel.classList.add('keybindings-result-count');
    header.appendChild(this._countLabel);

    this._container.appendChild(header);

    // Table container
    const tableContainer = document.createElement('div');
    tableContainer.classList.add('keybindings-table-container');

    const table = document.createElement('table');
    table.classList.add('keybindings-table');

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    for (const label of ['Command', 'Keybinding', 'Source', 'When']) {
      const th = document.createElement('th');
      th.textContent = label;
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    this._tableBody = document.createElement('tbody');
    table.appendChild(this._tableBody);
    tableContainer.appendChild(table);

    // Empty message
    this._emptyMessage = document.createElement('div');
    this._emptyMessage.classList.add('keybindings-editor-empty');
    this._emptyMessage.textContent = 'No keybindings match your search.';
    this._emptyMessage.style.display = 'none';
    tableContainer.appendChild(this._emptyMessage);

    this._container.appendChild(tableContainer);
    container.appendChild(this._container);
  }

  // ── Render input ──

  protected override async renderInput(_input: IEditorInput): Promise<void> {
    this._allEntries = [...this._getKeybindings()];
    // Sort alphabetically by command
    this._allEntries.sort((a, b) => a.commandId.localeCompare(b.commandId));
    this._filterTable();
  }

  // ── Filter / render table rows ──

  private _filterTable(): void {
    if (!this._tableBody) return;

    const query = (this._searchInput?.value ?? '').toLowerCase().trim();
    const filtered = query
      ? this._allEntries.filter(
          (e) =>
            e.commandId.toLowerCase().includes(query) ||
            e.key.toLowerCase().includes(query) ||
            (e.source ?? '').toLowerCase().includes(query) ||
            (e.when ?? '').toLowerCase().includes(query),
        )
      : this._allEntries;

    // Render
    this._tableBody.innerHTML = '';

    for (const entry of filtered) {
      const row = document.createElement('tr');

      // Command
      const cmdCell = document.createElement('td');
      cmdCell.textContent = entry.commandId;
      cmdCell.title = entry.commandId;
      row.appendChild(cmdCell);

      // Keybinding (formatted)
      const keyCell = document.createElement('td');
      const keySpan = document.createElement('span');
      keySpan.classList.add('keybinding-key');
      keySpan.textContent = formatKeybindingForDisplay(entry.key);
      keyCell.appendChild(keySpan);
      row.appendChild(keyCell);

      // Source
      const sourceCell = document.createElement('td');
      sourceCell.textContent = entry.source ?? '';
      row.appendChild(sourceCell);

      // When clause
      const whenCell = document.createElement('td');
      whenCell.textContent = entry.when ?? '';
      whenCell.title = entry.when ?? '';
      row.appendChild(whenCell);

      this._tableBody.appendChild(row);
    }

    // Update count
    if (this._countLabel) {
      this._countLabel.textContent = query
        ? `${filtered.length} of ${this._allEntries.length}`
        : `${this._allEntries.length} keybindings`;
    }

    // Toggle empty message
    if (this._emptyMessage) {
      this._emptyMessage.style.display = filtered.length === 0 ? 'flex' : 'none';
    }
  }

  // ── Focus ──

  override focus(): void {
    this._searchInput?.focus();
  }

  // ── Clear ──

  protected override clearPaneContent(): void {
    if (this._tableBody) this._tableBody.innerHTML = '';
    if (this._searchInput) this._searchInput.value = '';
    this._allEntries = [];
  }
}
