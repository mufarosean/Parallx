// openDocumentWriter.test.ts — one writer per file.
//
// Written because the assistant wrote files straight to disk while an editor had
// them open. That makes two writers for the same bytes: the model's copy goes
// stale, the user sees nothing change, and the editor's next save silently
// overwrites what was written.
//
// TextFileModel already DETECTED this — handleExternalChange() sets a conflicted
// flag when the model is dirty — but nothing in the app subscribes to
// onDidChangeConflicted or reads isConflicted, so the conflict was recorded and
// never surfaced and the clobber happened anyway.
//
// These tests pin the rule that removes the second writer rather than reconciling
// the two.

import { describe, it, expect, vi } from 'vitest';
import { writeThroughOpenDocument, isDocumentOpen } from '../../src/services/openDocumentWriter.js';
import { URI } from '../../src/platform/uri.js';

const FILE = URI.parse('file:///work/ws/notes.md');

function makeModel(opts: { disposed?: boolean } = {}) {
  const state = { content: 'on disk', updated: [] as string[], saves: 0 };
  return {
    state,
    model: {
      get isDisposed() { return opts.disposed ?? false; },
      updateContent(next: string) { state.updated.push(next); state.content = next; },
      async save() { state.saves++; },
    },
  };
}

function makeManager(models: Record<string, unknown>) {
  return {
    get: (uri: URI) => models[uri.toString()],
  } as never;
}

function makeFileService() {
  const written: Array<{ uri: string; content: string }> = [];
  return {
    written,
    service: {
      writeFile: async (uri: URI, content: string) => { written.push({ uri: uri.toString(), content }); },
    } as never,
  };
}

describe('writeThroughOpenDocument', () => {
  it('writes through the open document instead of the file', async () => {
    // THE rule. Writing the file here is what silently loses work.
    const { model, state } = makeModel();
    const fsvc = makeFileService();
    await writeThroughOpenDocument(makeManager({ [FILE.toString()]: model }), fsvc.service, FILE, 'from the assistant');

    expect(state.updated, 'the open document must receive the content').toEqual(['from the assistant']);
    expect(state.saves, 'and be saved through its own path').toBe(1);
    expect(fsvc.written, 'the file must NOT be written behind the editor').toEqual([]);
  });

  it('writes the file when nothing has it open', async () => {
    const fsvc = makeFileService();
    await writeThroughOpenDocument(makeManager({}), fsvc.service, FILE, 'hello');
    expect(fsvc.written).toEqual([{ uri: FILE.toString(), content: 'hello' }]);
  });

  it('creates parent directories only on the disk path', async () => {
    // The open-document path has nothing to create — the file already exists.
    const ensure = vi.fn(async () => {});
    const { model } = makeModel();
    const fsvc = makeFileService();

    await writeThroughOpenDocument(makeManager({ [FILE.toString()]: model }), fsvc.service, FILE, 'x', ensure);
    expect(ensure).not.toHaveBeenCalled();

    await writeThroughOpenDocument(makeManager({}), fsvc.service, FILE, 'x', ensure);
    expect(ensure).toHaveBeenCalledOnce();
  });

  it('falls back to disk when the model is disposed', async () => {
    // A disposed model is not rendering anything; writing through it would go
    // nowhere.
    const { model } = makeModel({ disposed: true });
    const fsvc = makeFileService();
    await writeThroughOpenDocument(makeManager({ [FILE.toString()]: model }), fsvc.service, FILE, 'x');
    expect(fsvc.written).toHaveLength(1);
  });

  it('falls back to disk when there is no model manager at all', async () => {
    const fsvc = makeFileService();
    await writeThroughOpenDocument(undefined, fsvc.service, FILE, 'x');
    expect(fsvc.written).toHaveLength(1);
  });

  it('does not touch a different file that happens to be open', async () => {
    const other = URI.parse('file:///work/ws/other.md');
    const { model, state } = makeModel();
    const fsvc = makeFileService();
    await writeThroughOpenDocument(makeManager({ [other.toString()]: model }), fsvc.service, FILE, 'x');
    expect(state.updated).toEqual([]);
    expect(fsvc.written).toHaveLength(1);
  });

  it('overwrites unsaved editor changes rather than diverging silently', async () => {
    // The user has unsaved edits and the assistant writes. Previously: the file
    // changed under them, nothing was shown, and their next save clobbered it.
    // Now the content lands in the document they are looking at — visible, and
    // recoverable with undo, because it went through the editor.
    const { model, state } = makeModel();
    state.content = 'the user was typing this';
    const fsvc = makeFileService();

    await writeThroughOpenDocument(makeManager({ [FILE.toString()]: model }), fsvc.service, FILE, 'assistant version');

    expect(state.content).toBe('assistant version');
    expect(fsvc.written).toEqual([]);
  });
});

describe('isDocumentOpen', () => {
  it('reports an open document', () => {
    const { model } = makeModel();
    expect(isDocumentOpen(makeManager({ [FILE.toString()]: model }), FILE)).toBe(true);
  });

  it('reports a disposed model as not open', () => {
    const { model } = makeModel({ disposed: true });
    expect(isDocumentOpen(makeManager({ [FILE.toString()]: model }), FILE)).toBe(false);
  });

  it('reports an untracked file as not open', () => {
    expect(isDocumentOpen(makeManager({}), FILE)).toBe(false);
  });
});
