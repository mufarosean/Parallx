// @vitest-environment jsdom
// placesFormerTabs.test.ts — a tool that moved its screens onto the core's
// places (one tab) says which tabs its older build saved, one per screen:
// each comes back at startup as that place in the one tab, and two such
// tabs make one. A tab of the old type that is not a place restores as saved.

import { describe, expect, it } from 'vitest';
import { EditorsBridge, ToolEditorInput } from '../../src/api/bridges/editorsBridge';
import { createPlacesApi } from '../../src/api/bridges/placesBridge';
import { deserializeEditorInput } from '../../src/editor/editorInputDeserializer';
import { EditorGroupModel } from '../../src/editor/editorGroupModel';
import { admitRestoredEditor } from '../../src/workbench/restoreMerge';

describe('a tool\'s older screen tabs come back as its places', () => {
  const toolId = 'test.formertabs';
  const subscriptions: { dispose(): void }[] = [];
  const editors = new EditorsBridge(toolId, undefined, subscriptions);
  editors.registerEditorProvider('formertabs', { createEditorPane: () => ({ dispose() {} }) });
  const api = createPlacesApi(toolId, editors, undefined, undefined, subscriptions);
  const reg = api.register({
    id: 'formertabs', title: 'Former Tabs', icon: 'table', editorType: 'formertabs.place',
    places: [{ id: 'home', title: 'Home' }, { id: 'bank', title: 'Problem Bank' }],
    formerTabs: { editorType: 'formertabs', placeOf: (instanceId) => (instanceId === 'home' || instanceId === 'bank' ? { place: instanceId } : undefined) },
    createView: () => ({ show() {}, dispose() {} }),
  });
  const saved = (instanceId: string, name: string) => ({ inputId: `${toolId}:formertabs:${instanceId}`, instanceId, name, ownerToolId: toolId });

  it('a saved screen tab is the place in the one tab, named for it, at its address', () => {
    const input = deserializeEditorInput('formertabs', saved('bank', 'Problem Bank')) as ToolEditorInput;
    expect(input).toBeInstanceOf(ToolEditorInput);
    expect(input.typeId).toBe('formertabs.place');
    expect(input.instanceId).toBe('main');
    expect(input.place).toBe('parallx://place/formertabs/bank');
    expect(input.name).toBe('Problem Bank');
    expect(input.iconHtml).toBeTruthy();
  });

  it('two saved screen tabs are the same one tab (the editor area opens it once)', () => {
    const a = deserializeEditorInput('formertabs', saved('bank', 'Problem Bank'))!;
    const b = deserializeEditorInput('formertabs', saved('home', 'Worksheets'))!;
    expect(a.matches(b)).toBe(true);
  });

  it('a saved tab of the old type that is not a place restores as it was saved', () => {
    const input = deserializeEditorInput('formertabs', saved('item:7', 'RF Brosius 1')) as ToolEditorInput;
    expect(input.typeId).toBe('formertabs');
    expect(input.instanceId).toBe('item:7');
    expect(input.place).toBeUndefined();
  });

  it('with the places gone, the old tab restores as saved', () => {
    reg.dispose();
    const input = deserializeEditorInput('formertabs', saved('bank', 'Problem Bank')) as ToolEditorInput;
    expect(input.typeId).toBe('formertabs');
    expect(input.instanceId).toBe('bank');
  });
});

describe('two saved screen tabs that come back as one tab', () => {
  const toolId = 'test.formermerge';
  const subscriptions: { dispose(): void }[] = [];
  const editors = new EditorsBridge(toolId, undefined, subscriptions);
  editors.registerEditorProvider('formermerge', { createEditorPane: () => ({ dispose() {} }) });
  createPlacesApi(toolId, editors, undefined, undefined, subscriptions).register({
    id: 'formermerge', title: 'Merge', icon: 'table', editorType: 'formermerge.place',
    places: [{ id: 'home', title: 'Home' }, { id: 'bank', title: 'Problem Bank' }, { id: 'dashboard', title: 'Study Dashboard' }],
    formerTabs: { editorType: 'formermerge', placeOf: (instanceId) => ({ place: instanceId }) },
    createView: () => ({ show() {}, dispose() {} }),
  });
  const restore = (model: EditorGroupModel, instanceId: string, wasShowing: boolean, merged: Map<string, string>) => {
    const input = deserializeEditorInput('formermerge', { inputId: `${toolId}:formermerge:${instanceId}`, instanceId, name: instanceId, ownerToolId: toolId })!;
    return admitRestoredEditor(model, input, { typeId: 'formermerge', pinned: true, wasShowing }, merged);
  };

  it('the one that was showing says where the tab is', () => {
    const model = new EditorGroupModel();
    const merged = new Map<string, string>();
    restore(model, 'home', false, merged);
    restore(model, 'bank', true, merged);
    expect(model.count).toBe(1);
    expect((model.editors[0] as ToolEditorInput).place).toBe('parallx://place/formermerge/bank');
  });

  it('a tab already brought back in one group is not brought back in another', () => {
    const left = new EditorGroupModel();
    const right = new EditorGroupModel();
    const merged = new Map<string, string>();
    expect(restore(left, 'bank', true, merged)).toBe(true);
    expect(restore(right, 'dashboard', true, merged)).toBe(false);
    expect(left.count).toBe(1);
    expect(right.count).toBe(0);
  });

  it('an older save\'s split, which copies the left tab into the new group, still leaves one tab', () => {
    const left = new EditorGroupModel('left');
    const right = new EditorGroupModel('right');
    const merged = new Map<string, string>();
    restore(left, 'bank', true, merged);
    right.openEditor(left.editors[0]); // what splitting a group does with its active tab
    expect(restore(right, 'dashboard', true, merged)).toBe(false);
    expect(left.count).toBe(1);
    expect(right.count).toBe(0);
    expect((left.editors[0] as ToolEditorInput).place).toBe('parallx://place/formermerge/bank');
  });
});
