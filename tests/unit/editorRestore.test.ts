// editorRestore.test.ts — every editor type must survive a restart.
//
// Written because a notebook open at quit did not come back. The cause was not
// in the notebook code at all: NotebookEditorInput.serialize() wrote its entry
// into the restored state correctly, but no deserializer was registered for its
// TYPE_ID, so the entry could not be turned back into an input and the tab was
// silently dropped. Seven other editor types were registered; the notebook was
// simply never added.
//
// The general lesson, which is why this test covers ALL types rather than just
// notebooks: serialize() and the deserializer registry are two halves of one
// contract, and nothing previously checked that they agree. A new editor type
// can ship a perfectly good serialize() and still lose the user's tab.

import { describe, it, expect, beforeAll } from 'vitest';
import {
  registerBuiltinEditorDeserializers,
  deserializeEditorInput,
} from '../../src/editor/editorInputDeserializer.js';
import { FileEditorInput } from '../../src/editor/panes/fileEditorInput.js';
import { PdfEditorInput } from '../../src/editor/panes/pdfEditorInput.js';
import { EpubEditorInput } from '../../src/editor/panes/epubEditorInput.js';
import { ImageEditorInput } from '../../src/editor/panes/imageEditorInput.js';
import { MarkdownPreviewInput } from '../../src/editor/panes/markdownPreviewInput.js';
import { NotebookEditorInput } from '../../src/editor/panes/notebook/notebookEditorInput.js';
import { URI } from '../../src/platform/uri.js';

/** Minimal stand-ins — deserialization must not touch disk. */
const fileService = {
  readFile: async () => ({ content: '', encoding: 'utf-8' }),
  writeFile: async () => undefined,
  showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
} as unknown as Parameters<typeof registerBuiltinEditorDeserializers>[0]['fileService'];

const textFileModelManager = {
  getOrCreate: () => ({ content: '', isDirty: false }),
} as unknown as Parameters<typeof registerBuiltinEditorDeserializers>[0]['textFileModelManager'];

beforeAll(() => {
  registerBuiltinEditorDeserializers({ fileService, textFileModelManager });
});

const NB_URI = process.platform === 'win32'
  ? 'file:///c:/work/ws/analysis.ipynb'
  : 'file:///work/ws/analysis.ipynb';

describe('notebook restore', () => {
  it('a serialized notebook can be turned back into an input', () => {
    // THE regression. Before the fix this returned null and the tab vanished.
    const restored = deserializeEditorInput(NotebookEditorInput.TYPE_ID, {
      uri: NB_URI,
      relativePath: 'analysis.ipynb',
    });
    expect(restored, 'no deserializer registered — the tab would be dropped on restart').not.toBeNull();
    expect(restored!.typeId).toBe(NotebookEditorInput.TYPE_ID);
  });

  it('round-trips through the exact shape serialize() writes', () => {
    // Guards against serialize() and the deserializer drifting apart, which is
    // how this broke in the first place.
    const original = NotebookEditorInput.create(URI.parse(NB_URI), fileService, 'analysis.ipynb');
    const entry = original.serialize();

    expect(entry.typeId).toBe(NotebookEditorInput.TYPE_ID);
    const restored = deserializeEditorInput(entry.typeId, entry.data as Record<string, unknown>);
    expect(restored).not.toBeNull();
    expect(restored!.name).toBe(original.name);
    // The workspace-relative description is what the tab tooltip shows.
    expect(restored!.description).toBe(original.description);
    // Identity must match, or reopening would create a duplicate tab.
    expect(original.matches(restored!)).toBe(true);
  });

  it('refuses a malformed entry instead of throwing during startup', () => {
    // A corrupt workspace-state.json must not take the whole restore down.
    expect(deserializeEditorInput(NotebookEditorInput.TYPE_ID, {})).toBeNull();
    expect(deserializeEditorInput(NotebookEditorInput.TYPE_ID, { uri: 42 })).toBeNull();
    expect(deserializeEditorInput(NotebookEditorInput.TYPE_ID, undefined)).toBeNull();
  });

  it('survives a missing relativePath', () => {
    const restored = deserializeEditorInput(NotebookEditorInput.TYPE_ID, { uri: NB_URI });
    expect(restored).not.toBeNull();
  });
});

describe('every registered editor type restores', () => {
  // A table rather than one test per type, so adding an editor without a
  // deserializer shows up as a failing row here.
  const cases: ReadonlyArray<[string, string, Record<string, unknown>]> = [
    ['file', FileEditorInput.TYPE_ID, { uri: 'file:///work/a.ts' }],
    ['pdf', PdfEditorInput.TYPE_ID, { uri: 'file:///work/a.pdf', page: 3 }],
    ['epub', EpubEditorInput.TYPE_ID, { uri: 'file:///work/a.epub' }],
    ['image', ImageEditorInput.TYPE_ID, { uri: 'file:///work/a.png' }],
    ['markdown preview', MarkdownPreviewInput.TYPE_ID, { uri: 'file:///work/a.md' }],
    ['notebook', NotebookEditorInput.TYPE_ID, { uri: NB_URI }],
  ];

  for (const [label, typeId, data] of cases) {
    it(`${label} restores from its serialized data`, () => {
      expect(deserializeEditorInput(typeId, data), `${label} has no deserializer`).not.toBeNull();
    });
  }

  it('an unregistered type id returns null rather than throwing', () => {
    expect(deserializeEditorInput('parallx.editor.doesNotExist', { uri: 'file:///x' })).toBeNull();
  });
});
