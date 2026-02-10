// editorGroup.ts — barrel re-export for editor group subsystem
//
// Convenience module that re-exports the key editor group types
// so consumers can import from a single location.

export { EditorGroupModel } from './editorGroupModel.js';
export { EditorGroupView } from './editorGroupView.js';
export type { IEditorInput } from './editorInput.js';
export { EditorInput, PlaceholderEditorInput } from './editorInput.js';
export { EditorPane, PlaceholderEditorPane } from './editorPane.js';
export type { EditorPaneViewState, IEditorPane } from './editorPane.js';
export {
  EditorActivation,
  GroupDirection,
  EditorGroupChangeKind,
  EDITOR_TAB_DRAG_TYPE,
} from './editorTypes.js';
export type {
  EditorOpenOptions,
  EditorCloseOptions,
  SerializedEditorEntry,
  SerializedEditorGroup,
  EditorTabDragData,
  EditorGroupChangeEvent,
} from './editorTypes.js';