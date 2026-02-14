// editorGroupService.ts — manages editor group lifecycle
//
// Thin façade over EditorPart that exposes group operations to the
// service layer. Re-fires EditorPart events as service events.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { EditorPart } from '../parts/editorPart.js';
import { EditorGroupView } from '../editor/editorGroupView.js';
import { GroupDirection } from '../editor/editorTypes.js';
import type { IEditorGroupService } from './serviceTypes.js';

/**
 * Service that delegates group management to EditorPart.
 *
 * Created after EditorPart is initialised in the workbench lifecycle.
 */
export class EditorGroupService extends Disposable implements IEditorGroupService {

  private readonly _onDidActiveGroupChange = this._register(new Emitter<EditorGroupView>());
  readonly onDidActiveGroupChange: Event<EditorGroupView> = this._onDidActiveGroupChange.event;

  private readonly _onDidGroupCountChange = this._register(new Emitter<number>());
  readonly onDidGroupCountChange: Event<number> = this._onDidGroupCountChange.event;

  constructor(private readonly _editorPart: EditorPart) {
    super();

    // Forward EditorPart events
    this._register(this._editorPart.onDidActiveGroupChange((g) => this._onDidActiveGroupChange.fire(g)));
    this._register(this._editorPart.onDidGroupCountChange((n) => this._onDidGroupCountChange.fire(n)));
  }

  get activeGroup(): EditorGroupView | undefined {
    return this._editorPart.activeGroup;
  }

  get groups(): EditorGroupView[] {
    return this._editorPart.groups;
  }

  get groupCount(): number {
    return this._editorPart.groupCount;
  }

  getGroup(groupId: string): EditorGroupView | undefined {
    return this._editorPart.getGroup(groupId);
  }

  splitGroup(sourceGroupId: string, direction: GroupDirection): EditorGroupView | undefined {
    return this._editorPart.splitGroup(sourceGroupId, direction);
  }

  addGroup(referenceGroupId: string, direction: GroupDirection): EditorGroupView | undefined {
    return this._editorPart.addGroup(referenceGroupId, direction);
  }

  removeGroup(groupId: string): void {
    this._editorPart.removeGroup(groupId);
  }

  mergeGroup(sourceGroupId: string, targetGroupId: string): void {
    this._editorPart.mergeGroup(sourceGroupId, targetGroupId);
  }

  findGroup(direction: GroupDirection, sourceGroupId?: string): EditorGroupView | undefined {
    return this._editorPart.findGroup(direction, sourceGroupId);
  }

  activateGroup(groupId: string): void {
    this._editorPart.activateGroup(groupId);
  }
}