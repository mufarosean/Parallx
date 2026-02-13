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
import type { IEditorService, OpenEditorDescriptor } from './serviceTypes.js';

/**
 * Service that wraps EditorPart for editor open/close operations.
 */
export class EditorService extends Disposable implements IEditorService {

  private readonly _onDidActiveEditorChange = this._register(new Emitter<IEditorInput | undefined>());
  readonly onDidActiveEditorChange: Event<IEditorInput | undefined> = this._onDidActiveEditorChange.event;

  private readonly _onDidChangeOpenEditors = this._register(new Emitter<void>());
  readonly onDidChangeOpenEditors: Event<void> = this._onDidChangeOpenEditors.event;

  /** Per-group model listener disposables (tracked for cleanup). */
  private readonly _groupListeners = this._register(new DisposableStore());

  constructor(private readonly _editorPart: EditorPart) {
    super();

    // Track active editor through active group changes
    this._register(this._editorPart.onDidActiveGroupChange((group) => {
      this._onDidActiveEditorChange.fire(group.model.activeEditor);
      this._onDidChangeOpenEditors.fire();
    }));

    // Also listen to within-group EditorActive changes (M1 fix)
    this._wireGroupListeners();
    this._register(this._editorPart.onDidGroupCountChange(() => {
      this._wireGroupListeners();
      this._onDidChangeOpenEditors.fire();
    }));
  }

  /**
   * Subscribe to model events from every group so that:
   *  - within-group tab switches fire onDidActiveEditorChange
   *  - open/close/dirty/pin events fire onDidChangeOpenEditors
   */
  private _wireGroupListeners(): void {
    this._groupListeners.clear();
    for (const group of this._editorPart.groups) {
      this._groupListeners.add(
        group.model.onDidChange((e) => {
          if (e.kind === EditorGroupChangeKind.EditorActive) {
            // Only fire for the active group — non-active groups' tab
            // switches should not change the service-level "active editor".
            if (this._editorPart.activeGroup === group) {
              this._onDidActiveEditorChange.fire(e.editor);
            }
          }

          // Fire open-editors change for any structural/state change
          if (
            e.kind === EditorGroupChangeKind.EditorOpen ||
            e.kind === EditorGroupChangeKind.EditorClose ||
            e.kind === EditorGroupChangeKind.EditorMove ||
            e.kind === EditorGroupChangeKind.EditorActive ||
            e.kind === EditorGroupChangeKind.EditorDirty ||
            e.kind === EditorGroupChangeKind.EditorPin ||
            e.kind === EditorGroupChangeKind.EditorUnpin
          ) {
            this._onDidChangeOpenEditors.fire();
          }
        }),
      );
    }
  }

  get activeEditor(): IEditorInput | undefined {
    return this._editorPart.activeGroup?.model.activeEditor;
  }

  getOpenEditors(): OpenEditorDescriptor[] {
    const result: OpenEditorDescriptor[] = [];
    const activeGroupEditor = this._editorPart.activeGroup?.model.activeEditor;
    for (const group of this._editorPart.groups) {
      for (const editor of group.model.editors) {
        result.push({
          id: editor.id,
          name: editor.name,
          description: editor.description,
          isDirty: editor.isDirty,
          isActive: editor === activeGroupEditor && group === this._editorPart.activeGroup,
          groupId: group.model.id,
        });
      }
    }
    return result;
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
      // EditorActive is now always fired from the model (including when last
      // editor closes), so _wireGroupListeners handles the event. No need
      // for explicit fire here — it would cause a double-fire.
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