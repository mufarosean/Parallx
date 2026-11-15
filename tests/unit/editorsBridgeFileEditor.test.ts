// editorsBridgeFileEditor.test.ts — a running tool claims a file type
// (editors.registerFileEditor): a file with that extension resolves to the
// tool's editor, carrying its path; with the claim gone, it resolves to
// nothing and the core opens the file as it always would. The claim is an
// entry in the core's one registry of file types (EditorResolverService),
// not a second list beside it.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorsBridge, FILE_INSTANCE_PREFIX, setFileEditorRegistry, ToolEditorInput } from '../../src/api/bridges/editorsBridge';
import { EditorResolverPriority, EditorResolverService } from '../../src/services/editorResolverService';
import type { IEditorInput } from '../../src/editor/editorInput';
import { URI } from '../../src/platform/uri';

/** The core's registry of file types, as the workbench makes it. */
let registry: EditorResolverService;
beforeEach(() => { registry = new EditorResolverService(); setFileEditorRegistry(registry); });
afterEach(() => { setFileEditorRegistry(undefined); registry.dispose(); });
/** What a file opens in, asked of the core's registry alone. */
const resolveToolFileEditor = (uri: URI): IEditorInput | undefined => registry.resolveInput(uri);

const provider = { createEditorPane: () => ({ dispose() {} }) };
let n = 0;
/** A bridge for a tool with one editor type; names are unique so tests do not meet in the module's registry. */
function tool() {
  const id = `test.tool${++n}`;
  const typeId = `test.editor${n}`;
  const subscriptions: { dispose(): void }[] = [];
  const bridge = new EditorsBridge(id, undefined, subscriptions);
  bridge.registerEditorProvider(typeId, provider);
  return { id, typeId, bridge, subscriptions };
}

describe('a tool claims a file type', () => {
  it('resolves a claimed file to the tool editor, with the path as its instance', () => {
    const t = tool();
    const claim = t.bridge.registerFileEditor(t.typeId, { extensions: ['.ledger'], iconHtml: '<svg></svg>' });
    const uri = URI.file('/work/Finances/Budget 2026.ledger');
    const input = resolveToolFileEditor(uri) as ToolEditorInput;
    expect(input).toBeInstanceOf(ToolEditorInput);
    expect(input.typeId).toBe(t.typeId);
    expect(input.ownerToolId).toBe(t.id);
    expect(input.name).toBe('Budget 2026.ledger');
    expect(input.instanceId).toBe(`${FILE_INSTANCE_PREFIX}${uri.fsPath}`);
    expect(input.iconHtml).toBe('<svg></svg>');
    // The same file resolves to the same tab id, so it opens once.
    expect((resolveToolFileEditor(uri) as ToolEditorInput).id).toBe(input.id);
    claim.dispose();
  });

  it('takes the extension without its dot and in any case', () => {
    const t = tool();
    const claim = t.bridge.registerFileEditor(t.typeId, { extensions: ['GRID'] });
    expect(resolveToolFileEditor(URI.file('/a/b.Grid'))).toBeDefined();
    expect(resolveToolFileEditor(URI.file('/a/b.grid.txt'))).toBeUndefined();
    expect(resolveToolFileEditor(URI.file('/a/grid'))).toBeUndefined();
    expect(resolveToolFileEditor(URI.file('/a/.grid'))).toBeUndefined();
    claim.dispose();
  });

  it('lets go when the claim is disposed, as when the tool is turned off', () => {
    const t = tool();
    t.bridge.registerFileEditor(t.typeId, { extensions: ['.tally'] });
    expect(resolveToolFileEditor(URI.file('/a/x.tally'))).toBeDefined();
    for (const d of t.subscriptions) d.dispose();
    expect(resolveToolFileEditor(URI.file('/a/x.tally'))).toBeUndefined();
  });

  it('refuses a claim for an editor type the tool has not registered', () => {
    const t = tool();
    expect(() => t.bridge.registerFileEditor('someone.elses', { extensions: ['.x'] })).toThrow(/no editor provider/);
  });

  it('does not let a second tool take an extension a running tool holds, nor every file', () => {
    const first = tool();
    const second = tool();
    const claim = first.bridge.registerFileEditor(first.typeId, { extensions: ['.pair'] });
    second.bridge.registerFileEditor(second.typeId, { extensions: ['.pair', '.*', '.'] });
    expect((resolveToolFileEditor(URI.file('/a/x.pair')) as ToolEditorInput).ownerToolId).toBe(first.id);
    expect(resolveToolFileEditor(URI.file('/a/readme.md'))).toBeUndefined();
    claim.dispose();
    for (const d of second.subscriptions) d.dispose();
  });

  it('is an entry in the core\'s one registry, there while the tool runs and gone after', () => {
    const t = tool();
    expect(registry.getRegistrations()).toHaveLength(0);
    const claim = t.bridge.registerFileEditor(t.typeId, { extensions: ['.ledger'] });
    expect(registry.getRegistrations().map((r) => r.extensions)).toEqual([['.ledger']]);
    expect(registry.findRegistration(URI.file('/a/x.ledger'))?.id).toBe(`${t.id}:${t.typeId}`);
    claim.dispose();
    expect(registry.getRegistrations()).toHaveLength(0);
  });

  it('comes before a core reader of the same type, and leaves every other file to the core', () => {
    const core = { id: 'core.text' } as unknown as IEditorInput;
    const reader = { id: 'core.reader' } as unknown as IEditorInput;
    registry.registerEditor({ id: 'text', name: 'Text', extensions: ['.*'], priority: EditorResolverPriority.Builtin, createInput: () => core, createPane: () => { throw new Error('no pane is made to resolve an input'); } });
    registry.registerEditor({ id: 'reader', name: 'Reader', extensions: ['.ledger'], priority: EditorResolverPriority.Default, createInput: () => reader, createPane: () => { throw new Error('no pane is made to resolve an input'); } });
    const t = tool();
    expect(registry.resolveInput(URI.file('/a/x.ledger'))).toBe(reader);
    const claim = t.bridge.registerFileEditor(t.typeId, { extensions: ['.ledger'] });
    expect(registry.resolveInput(URI.file('/a/x.ledger'))).toBeInstanceOf(ToolEditorInput);
    expect(registry.resolveInput(URI.file('/a/x.md'))).toBe(core);
    claim.dispose();
    expect(registry.resolveInput(URI.file('/a/x.ledger'))).toBe(reader);
  });

  it('a claim made before the registry exists is entered when it does, and follows a new one', () => {
    setFileEditorRegistry(undefined);
    const t = tool();
    const claim = t.bridge.registerFileEditor(t.typeId, { extensions: ['.early'] });
    expect(registry.resolveInput(URI.file('/a/x.early'))).toBeUndefined();
    setFileEditorRegistry(registry);
    expect(registry.resolveInput(URI.file('/a/x.early'))).toBeInstanceOf(ToolEditorInput);
    const next = new EditorResolverService();
    setFileEditorRegistry(next);
    expect(registry.resolveInput(URI.file('/a/x.early'))).toBeUndefined();
    expect(next.resolveInput(URI.file('/a/x.early'))).toBeInstanceOf(ToolEditorInput);
    claim.dispose();
    expect(next.resolveInput(URI.file('/a/x.early'))).toBeUndefined();
    next.dispose();
  });

  it('describes its tab by the file\'s path, as every file editor does, so the Explorer can find it', () => {
    const t = tool();
    const claim = t.bridge.registerFileEditor(t.typeId, { extensions: ['.ledger'] });
    const uri = URI.file('/work/Finances/Budget 2026.ledger');
    expect(registry.resolveInput(uri)?.description).toBe(uri.fsPath);
    claim.dispose();
  });
});
