// untitledEditorInput.ts — EditorInput for new, unsaved files
//
// Represents an untitled document that hasn't been saved to disk yet.
// Content is held in memory. Save triggers save-as flow.
//
// VS Code reference:
//   src/vs/workbench/services/untitled/common/untitledTextEditorInput.ts

import { EditorInput, type IEditorInput } from '../../editor/editorInput.js';
import type { SerializedEditorEntry } from '../../editor/editorTypes.js';
import { Emitter, Event } from '../../platform/events.js';
import { URI } from '../../platform/uri.js';

// ─── Counter ─────────────────────────────────────────────────────────────────

let _untitledCounter = 1;

// ─── UntitledEditorInput ─────────────────────────────────────────────────────

export class UntitledEditorInput extends EditorInput {
  static readonly TYPE_ID = 'parallx.editor.untitled';

  private readonly _uri: URI;
  private readonly _name: string;
  private _content: string = '';
  private _hasTyped: boolean = false;

  private readonly _onDidChangeContent = this._register(new Emitter<string>());
  readonly onDidChangeContent: Event<string> = this._onDidChangeContent.event;

  // ── Factory ──

  static create(): UntitledEditorInput {
    const n = _untitledCounter++;
    return new UntitledEditorInput(n);
  }

  static createWithContent(content: string): UntitledEditorInput {
    const input = UntitledEditorInput.create();
    input._content = content;
    input._hasTyped = content.length > 0;
    if (input._hasTyped) {
      input.setDirty(true);
    }
    return input;
  }

  private constructor(n: number) {
    const id = `untitled-${n}`;
    super(id);
    this._name = `Untitled-${n}`;
    this._uri = URI.parse(`untitled://${id}`);
  }

  // ── Abstract implementations ──

  get typeId(): string {
    return UntitledEditorInput.TYPE_ID;
  }

  get name(): string {
    return this._name;
  }

  get description(): string {
    return '';
  }

  get uri(): URI {
    return this._uri;
  }

  get content(): string {
    return this._content;
  }

  get isDirty(): boolean {
    return this._hasTyped;
  }

  // ── Content Update ──

  updateContent(newContent: string): void {
    if (this._content === newContent) return;
    this._content = newContent;
    const wasDirty = this._hasTyped;
    this._hasTyped = newContent.length > 0;

    if (wasDirty !== this._hasTyped) {
      this.setDirty(this._hasTyped);
    }

    this._onDidChangeContent.fire(newContent);
  }

  // ── Save ──

  /**
   * Save triggers save-as flow. Returns the target URI or undefined if cancelled.
   */
  async save(): Promise<URI | undefined> {
    const electron = (globalThis as any).parallxElectron;
    if (!electron?.dialog?.saveFile) return undefined;

    const targetPath = await electron.dialog.saveFile({
      title: 'Save As',
      defaultPath: this._name,
    });

    if (!targetPath) return undefined;

    const targetUri = URI.file(targetPath);
    // Write content to disk via Electron IPC
    const electronFs = electron.fs;
    if (electronFs) {
      await electronFs.writeFile(targetUri.fsPath, this._content);
    }

    return targetUri;
  }

  // ── Revert ──

  async revert(): Promise<void> {
    // Untitled: revert clears content
    this._content = '';
    this._hasTyped = false;
    this.setDirty(false);
    this._onDidChangeContent.fire('');
  }

  // ── Close Confirmation ──

  override async confirmClose(): Promise<boolean> {
    if (!this._hasTyped) return true; // Empty untitled: close without prompt

    const electron = (globalThis as any).parallxElectron;
    if (electron?.dialog?.showMessageBox) {
      const result = await electron.dialog.showMessageBox({
        type: 'warning',
        message: `Do you want to save "${this._name}"?`,
        detail: 'Your changes will be lost if you don\'t save them.',
        buttons: ['Save', 'Don\'t Save', 'Cancel'],
        defaultId: 0,
        cancelId: 2,
      });

      if (result.response === 0) {
        // Save
        const saved = await this.save();
        return saved !== undefined;
      } else if (result.response === 1) {
        // Don't Save
        return true;
      } else {
        // Cancel
        return false;
      }
    }

    return true;
  }

  // ── Serialization ──

  serialize(): SerializedEditorEntry {
    return {
      inputId: this.id,
      typeId: this.typeId,
      name: this._name,
      pinned: true,
      sticky: false,
      data: {
        content: this._content,
      },
    };
  }
}
