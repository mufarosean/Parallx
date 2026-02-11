// editorService.ts — manages editor opening and active editor tracking
//
// High-level service that coordinates editor opening/closing through the
// EditorPart. Tracks the active editor and fires change events.

import { Disposable, DisposableStore } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { EditorPart } from '../parts/editorPart.js';
import type { IEditorInput } from '../editor/editorInput.js';
import type { EditorOpenOptions } from '../editor/editorTypes.js';
import { EditorGroupChangeKind } from '../editor/editorTypes.js';
import type { IEditorService } from './serviceTypes.js';

/**
 * Service that wraps EditorPart for editor open/close operations.
 */
export class EditorService extends Disposable implements IEditorService {

  private readonly _onDidActiveEditorChange = this._register(new Emitter<IEditorInput | undefined>());
  readonly onDidActiveEditorChange: Event<IEditorInput | undefined> = this._onDidActiveEditorChange.event;

  /** Per-group model listener disposables (tracked for cleanup). */
  private readonly _groupListeners = this._register(new DisposableStore());

  constructor(private readonly _editorPart: EditorPart) {
    super();

    // Track active editor through active group changes
    this._register(this._editorPart.onDidActiveGroupChange((group) => {
      this._onDidActiveEditorChange.fire(group.model.activeEditor);
    }));

    // Also listen to within-group EditorActive changes (M1 fix)
    this._wireGroupListeners();
    this._register(this._editorPart.onDidGroupCountChange(() => {
      this._wireGroupListeners();
    }));
  }

  /**
   * Subscribe to EditorActive model events from every group so that
   * within-group tab switches fire onDidActiveEditorChange.
   */
  private _wireGroupListeners(): void {
    this._groupListeners.clear();
    for (const group of this._editorPart.groups) {
      this._groupListeners.add(
        group.model.onDidChange((e) => {
          if (e.kind === EditorGroupChangeKind.EditorActive) {
            this._onDidActiveEditorChange.fire(e.editor);
          }
        }),
      );
    }
  }

  get activeEditor(): IEditorInput | undefined {
    return this._editorPart.activeGroup?.model.activeEditor;
  }

  async openEditor(input: IEditorInput, options?: EditorOpenOptions, groupId?: string): Promise<void> {
    await this._editorPart.openEditor(input, options, groupId);
    // Note: onDidActiveEditorChange is fired by the group model listener.
  }

  async closeEditor(input?: IEditorInput, groupId?: string, force = false): Promise<boolean> {
    const group = groupId
      ? this._editorPart.getGroup(groupId)
      : this._editorPart.activeGroup;
    if (!group) return false;

    const previousActive = this.activeEditor;

    if (input) {
      const idx = group.model.editors.findIndex(e => e.id === input.id);
      if (idx < 0) return false;
      const closed = await group.closeEditor(idx, force);
      // M2 fix: only fire if the active editor actually changed
      if (closed && this.activeEditor !== previousActive) {
        this._onDidActiveEditorChange.fire(this.activeEditor);
      }
      return closed;
    }

    // Close active editor
    const activeIdx = group.model.activeIndex;
    if (activeIdx < 0) return false;
    const closed = await group.closeEditor(activeIdx, force);
    // The EditorActive event from _closeAt will be caught by _wireGroupListeners
    return closed;
  }
}