// settingsEditorInput.ts — EditorInput for the Settings UI
//
// Singleton editor input that opens the settings editor pane.
// Not associated with any file URI — it's a virtual document.
//
// VS Code reference:
//   src/vs/workbench/contrib/preferences/browser/settingsEditor2.ts

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';

export class SettingsEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.settings';

  private static _instance: SettingsEditorInput | undefined;

  /** Get or create the singleton instance. */
  static getInstance(): SettingsEditorInput {
    if (!SettingsEditorInput._instance || SettingsEditorInput._instance.isDisposed) {
      SettingsEditorInput._instance = new SettingsEditorInput();
    }
    return SettingsEditorInput._instance;
  }

  private constructor() {
    super('settings-editor');
  }

  get typeId(): string { return SettingsEditorInput.TYPE_ID; }
  get name(): string { return 'Settings'; }
  get description(): string { return ''; }
  get isDirty(): boolean { return false; }

  override matches(other: IEditorInput): boolean {
    return other instanceof SettingsEditorInput;
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
