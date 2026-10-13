// openEditorsView.ts — the Open Editors view: the editors that are open, by
// group, each a row that opens it, with a close button.
//
// From the keyboard the rows are one list: the active row (or the first) is
// in the Tab order, Up/Down and Home/End move along it, Enter or Space opens
// a row's editor and Delete closes it. A re-render keeps focus on the same
// row. docs/ACCESSIBILITY.md, section 2.

import type { IDisposable } from '../../platform/lifecycle.js';
import { createList } from '../../ui/kit.js';
import { $ } from '../../ui/dom.js';
import { getFileTypeIcon } from '../../ui/iconRegistry.js';

interface OpenEditor {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly isDirty: boolean;
  readonly isActive: boolean;
  readonly groupId: string;
  readonly iconHtml?: string;
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

/** One row: an option of the list that opens its editor; its close button closes that editor. */
function createOpenEditorRow(editor: OpenEditor, indented: boolean, editors: IOpenEditorsHost): HTMLElement {
  const row = $('div');
  row.className = 'open-editors-item';
  if (indented) row.classList.add('open-editors-item--grouped');
  if (editor.isActive) row.classList.add('open-editors-item--active');
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', String(editor.isActive));
  row.dataset.editorId = editor.id;
  row.tabIndex = -1;

  // Dirty indicator
  if (editor.isDirty) {
    const dot = $('span');
    dot.className = 'open-editors-dirty';
    dot.title = 'Unsaved changes';
    row.appendChild(dot);
  }

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

  // Close button: this row's editor (it used to close whichever was active).
  const closeBtn = $('span');
  closeBtn.className = 'open-editors-close';
  closeBtn.textContent = '×';
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
      console.warn('[Explorer] focusEditor failed for', editor.name, err);
    });
  });

  return row;
}
