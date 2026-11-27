// restoreMerge.ts — a saved tab that a tool now restores under another
// editor type (editorsBridge's restore redirect: an older build's screen
// tabs, now places in the tool's one tab) can come back as the same tab as
// another saved one. Then the one that was showing gives the tab its place,
// and a tab already brought back in another group is not brought back twice.

import { ToolEditorInput } from '../api/bridges/editorsBridge.js';
import type { IEditorInput } from '../editor/editorInput.js';
import type { EditorGroupModel } from '../editor/editorGroupModel.js';
import { EditorActivation } from '../editor/editorTypes.js';

/** Put a restored tab in its group's model. False when it is not put there (it came back in another group already). */
export function admitRestoredEditor(
  model: EditorGroupModel, input: IEditorInput, saved: { readonly typeId: string; readonly pinned: boolean; readonly wasShowing: boolean }, merged: Set<string>,
): boolean {
  if (input instanceof ToolEditorInput && input.typeId !== saved.typeId) {
    const here = model.indexOf(input);
    if (here < 0 && merged.has(input.id)) return false;
    // Two saved tabs are this one tab: the one that was showing says where it is.
    if (here >= 0 && saved.wasShowing) void model.closeEditor(here);
    merged.add(input.id);
  }
  model.openEditor(input, { pinned: saved.pinned, activation: EditorActivation.Restore });
  return true;
}
