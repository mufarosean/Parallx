// keybindingsEditorInput.ts — EditorInput for the Keybindings Viewer
//
// Singleton editor input that opens the keyboard shortcuts viewer pane.
// Not associated with any file URI — it's a virtual document.
//
// VS Code reference:
//   src/vs/workbench/services/preferences/browser/keybindingsEditorInput.ts

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';

export class KeybindingsEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.keybindings';

  private static _instance: KeybindingsEditorInput | undefined;

  /** Get or create the singleton instance. */
  static getInstance(): KeybindingsEditorInput {
    if (!KeybindingsEditorInput._instance || KeybindingsEditorInput._instance.isDisposed) {
      KeybindingsEditorInput._instance = new KeybindingsEditorInput();
    }
    return KeybindingsEditorInput._instance;
  }

  private constructor() {
    super('keybindings-editor');
  }

  get typeId(): string { return KeybindingsEditorInput.TYPE_ID; }
  get name(): string { return 'Keyboard Shortcuts'; }
  get description(): string { return ''; }
  get isDirty(): boolean { return false; }

  override matches(other: IEditorInput): boolean {
    return other instanceof KeybindingsEditorInput;
  }

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this.name,
      description: this.description,
      pinned: false,
      sticky: false,
    };
  }
}
