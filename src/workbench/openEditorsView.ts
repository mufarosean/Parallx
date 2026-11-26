// openEditorsView.ts — Open: the editors that are open, by group, a fixture
// of the column under the tools whatever tool is open. Each row opens its
// editor and carries its icon, its name, the live word its editor set
// ("p. 214", "24 due"), a dot while it is unsaved, and a close mark.
//
// From the keyboard the rows are one list: the active row (or the first) is
// in the Tab order, Up/Down and Home/End move along it, Enter or Space opens
// a row's editor and Delete closes it. A re-render keeps focus on the same
// row. docs/ACCESSIBILITY.md, section 2.

import type { IDisposable } from '../platform/lifecycle.js';
import { createList } from '../ui/kit.js';
import { $ } from '../ui/dom.js';
import { createIconElement, getFileTypeIcon } from '../ui/iconRegistry.js';

interface OpenEditor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDirty: boolean;
  readonly isActive: boolean;
  readonly groupId: string;
  readonly iconHtml?: string;
  /** The editor's live word, when it set one. */
  readonly status?: string;
}

/** What the view needs from the editors API. */
export interface IOpenEditorsHost {
  readonly openEditors: readonly OpenEditor[];
  onDidChangeOpenEditors(listener: () => void): IDisposable;
  focusEditor(editorId: string): Promise<boolean>;
  closeEditor(editorId: string): Promise<boolean>;
}

export function createOpenEditorsView(container: HTMLElement, editors: IOpenEditorsHost, setCount: (count: number) => void): IDisposable {
  container.classList.add('open-editors-view');
  // The rows are the open tabs again, down the column: a tab list, like the
  // strip over the editor, so each row is a tab and the one in front is selected.
  container.setAttribute('role', 'tablist');
  container.setAttribute('aria-orientation', 'vertical');
  const rows = () => Array.from(container.querySelectorAll<HTMLElement>('.open-editors-item'));
  // The open editors as one scene entry: the active one is its selection.
  const entry = createList(container, { id: 'explorer.openEditors', label: 'Open Editors', rows, selected: () => rows().filter((r) => r.classList.contains('open-editors-item--active')).map((r) => r.textContent?.trim() ?? '') });

  const onKeydown = (e: KeyboardEvent): void => {
    const all = rows();
    const at = all.indexOf(document.activeElement as HTMLElement);
    if (at < 0) return;
    const to = ({ ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[e.key];
    if (to !== undefined) all[Math.max(0, Math.min(all.length - 1, to))].focus();
    else if (e.key === 'Enter' || e.key === ' ') all[at].click();
    else if (e.key === 'Delete') void editors.closeEditor(all[at].dataset.editorId ?? '');
    else return;
    e.preventDefault();
  };
  container.addEventListener('keydown', onKeydown);

  const render = (): void => {
    const hadFocus = (document.activeElement as HTMLElement | null)?.closest?.('.open-editors-item')?.getAttribute('data-editor-id');
    renderOpenEditors(container, editors, setCount);
    const all = rows();
    const stop = all.find((r) => r.classList.contains('open-editors-item--active')) ?? all[0];
    if (stop) stop.tabIndex = 0;
    // The list shows six rows: the editor in front is always among them.
    all.find((r) => r.classList.contains('open-editors-item--active'))?.scrollIntoView?.({ block: 'nearest' });
    if (hadFocus) all.find((r) => r.dataset.editorId === hadFocus)?.focus();
  };
  render();
  const sub = editors.onDidChangeOpenEditors(render);

  return {
    dispose() {
      sub.dispose();
      container.removeEventListener('keydown', onKeydown);
      entry.dispose();
    },
  };
}

function renderOpenEditors(container: HTMLElement, editors: IOpenEditorsHost, setCount: (count: number) => void): void {
  container.innerHTML = '';
  const open = editors.openEditors;
  setCount(open.length);
  if (open.length === 0) {
    const placeholder = $('div');
    placeholder.className = 'open-editors-placeholder';
    placeholder.textContent = 'No open editors.';
    container.appendChild(placeholder);
    return;
  }

  // Group editors by group ID (preserving order)
  const grouped = new Map<string, OpenEditor[]>();
  for (const editor of open) {
    if (!grouped.has(editor.groupId)) grouped.set(editor.groupId, []);
    grouped.get(editor.groupId)!.push(editor);
  }

  const multipleGroups = grouped.size > 1;
  let groupIndex = 0;
  for (const [, groupEditors] of grouped) {
    groupIndex++;
    // Show group header when there are multiple groups (VS Code parity)
    if (multipleGroups) {
      const header = $('div');
      header.className = 'open-editors-group-header';
      header.textContent = `Group ${groupIndex}`;
      container.appendChild(header);
    }
    for (const editor of groupEditors) container.appendChild(createOpenEditorRow(editor, multipleGroups, editors));
  }
}

/** One row: a tab of the list that opens its editor; its close mark closes that editor. */
function createOpenEditorRow(editor: OpenEditor, indented: boolean, editors: IOpenEditorsHost): HTMLElement {
  const row = $('div');
  row.className = 'open-editors-item';
  if (indented) row.classList.add('open-editors-item--grouped');
  if (editor.isActive) row.classList.add('open-editors-item--active');
  row.setAttribute('role', 'tab');
  row.setAttribute('aria-selected', String(editor.isActive));
  row.dataset.editorId = editor.id;
  row.tabIndex = -1;

  // Icon: prefer the editor's own pre-rendered icon (canvas pages,
  // databases, etc.); otherwise derive from filename extension (PDFs,
  // text files, …) and fall through to the generic file icon.
  const icon = $('span');
  icon.className = 'open-editors-icon';
  if (editor.iconHtml) {
    icon.innerHTML = editor.iconHtml;
  } else {
    const extMatch = editor.name.match(/\.([a-zA-Z0-9]+)$/);
    icon.innerHTML = getFileTypeIcon(extMatch ? extMatch[1] : '');
  }
  row.appendChild(icon);

  // Label
  const label = $('span');
  label.className = 'open-editors-label';
  label.textContent = editor.name;
  if (editor.description) label.title = editor.description;
  row.appendChild(label);

  // Its live word, then the unsaved dot: what the tab strip cannot say.
  if (editor.status) {
    const status = $('span');
    status.className = 'open-editors-status';
    status.textContent = editor.status;
    row.appendChild(status);
  }
  if (editor.isDirty) {
    const dot = createIconElement('circle', 8);
    dot.classList.add('open-editors-dirty');
    dot.setAttribute('role', 'img');
    dot.setAttribute('aria-label', 'Unsaved changes');
    row.appendChild(dot);
  }

  // Close button: this row's editor. Delete on the row closes it from the
  // keyboard, so the mark is kept out of the row's spoken name.
  const closeBtn = $('span');
  closeBtn.className = 'open-editors-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-hidden', 'true');
  closeBtn.title = 'Close';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void editors.closeEditor(editor.id);
  });
  row.appendChild(closeBtn);

  // Click → focus that editor by id (it is already open), not by
  // re-resolving a URI: a non-file editor's description is not a URI, and
  // that path opened a blank text editor after a restart.
  row.addEventListener('click', () => {
    editors.focusEditor(editor.id).catch((err) => {
      console.warn('[Open] focusEditor failed for', editor.name, err);
    });
  });

  return row;
}
