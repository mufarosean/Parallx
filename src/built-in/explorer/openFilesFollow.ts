// openFilesFollow.ts — an open file follows what the Explorer does to it.
//
// A file editor's tab is described by its file's path (text, PDF, image, and
// a tool's editor for a file type it claimed). When the Explorer deletes a
// file its tab closes; when it renames or moves one, the tab is closed and
// opened again under the new path, so nothing goes on saving to the old one.

interface OpenEditor { readonly id: string; readonly description: string; readonly isDirty: boolean }
export interface EditorsForFollow {
  readonly openEditors: readonly OpenEditor[];
  closeEditor(editorId: string): Promise<boolean>;
  openFileEditor(path: string): Promise<void>;
}

const slashes = (p: string): string => p.replace(/\\/g, '/');
const fold = (p: string): string => slashes(p).toLowerCase();
const under = (editor: OpenEditor, path: string, isFolder: boolean): boolean => {
  const at = fold(editor.description);
  const from = fold(path);
  return at === from || (isFolder && at.startsWith(`${from}/`));
};

/** Close the tabs of a deleted file, or of every file under a deleted folder. */
export function closeEditorsOf(editors: EditorsForFollow, path: string, isFolder: boolean): void {
  for (const editor of editors.openEditors) {
    if (under(editor, path, isFolder)) editors.closeEditor(editor.id).catch(() => {});
  }
}

/**
 * After a rename or a move: each open file under the old path is closed and
 * opened again under the new one. A tab with unsaved changes is left as it
 * is, so closing it never drops or questions the work in it.
 */
export async function reopenEditorsOf(editors: EditorsForFollow, oldPath: string, newPath: string, isFolder: boolean): Promise<void> {
  const from = slashes(oldPath);
  for (const editor of [...editors.openEditors]) {
    if (editor.isDirty || !under(editor, oldPath, isFolder)) continue;
    const target = slashes(newPath) + slashes(editor.description).slice(from.length);
    try {
      if (await editors.closeEditor(editor.id)) await editors.openFileEditor(target);
    } catch (err) { console.warn('[Explorer] an open file did not follow its rename:', err); }
  }
}
