// Canvas assessment 2026-10-03, broken features: Save as Template produced an
// empty page (it saved the stored `{schemaVersion, doc}` envelope, not the doc).
import { describe, it, expect } from 'vitest';
import { saveUserCanvasTemplate, loadUserCanvasTemplates, templateDocFromPage } from '../../src/built-in/canvas/canvasTemplates';
import { encodeCanvasContentFromDoc } from '../../src/built-in/canvas/contentSchema';

function memoryApi() {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    files,
    api: {
      workspace: {
        workspaceFolders: [{ uri: 'file:///ws' }],
        fs: {
          async readFile(uri: string) { return { content: files.get(uri) ?? '', encoding: 'utf8' }; },
          async writeFile(uri: string, content: string) { files.set(uri, content); },
          async readdir(uri: string) {
            return [...files.keys()].filter((k) => k.startsWith(uri + '/')).map((k) => ({ name: k.slice(uri.length + 1), type: 1 }));
          },
          async exists(uri: string) { return dirs.has(uri) || files.has(uri) || [...files.keys()].some((k) => k.startsWith(uri + '/')); },
          async mkdir(uri: string) { dirs.add(uri); },
          async delete(uri: string) { files.delete(uri); },
        },
      },
    },
  };
}

const pageDoc = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, id: 'h1' }, content: [{ type: 'text', text: 'Agenda' }] },
    { type: 'paragraph', attrs: { id: 'p1' }, content: [{ type: 'text', text: 'Body text' }] },
    { type: 'pageBlock', attrs: { id: 'c1', pageId: 'child-1', title: 'Child' } },
    { type: 'columnList', content: [
      { type: 'column', content: [{ type: 'pageBlock', attrs: { pageId: 'child-2' } }] },
      { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
    ] },
  ],
};

describe('Save as Template', () => {
  it('a template saved from a page builds that page, not an empty one', async () => {
    const { api } = memoryApi();
    const stored = encodeCanvasContentFromDoc(pageDoc).storedContent;
    const doc = templateDocFromPage(stored);
    expect(doc).not.toBeNull();
    await saveUserCanvasTemplate(api, { name: 'Meeting', doc });
    const [tpl] = await loadUserCanvasTemplates(api);
    const built = tpl!.buildDoc() as any;
    expect(built.type).toBe('doc');
    expect(JSON.stringify(built)).toContain('Agenda');
    expect(JSON.stringify(built)).toContain('Body text');
  });

  it('leaves out sub-page cards (they belong to the source page) and block ids', () => {
    const doc = templateDocFromPage(encodeCanvasContentFromDoc(pageDoc).storedContent) as any;
    const json = JSON.stringify(doc);
    expect(json).not.toContain('pageBlock');
    expect(json).not.toContain('"id"');
    // A column whose only block was a card keeps an empty paragraph.
    expect(doc.content[2].content[0].content).toEqual([{ type: 'paragraph' }]);
  });

  it('a template file saved by the old code (an envelope) still loads its page', async () => {
    const { api, files } = memoryApi();
    files.set('file:///ws/.parallx/canvas-templates/old.json', JSON.stringify({
      id: 'old', name: 'Old', doc: { schemaVersion: 2, doc: pageDoc },
    }));
    const [tpl] = await loadUserCanvasTemplates(api);
    const built = tpl!.buildDoc() as any;
    expect(built.type).toBe('doc');
    expect(JSON.stringify(built)).toContain('Body text');
  });

  it('each new page gets its own copy of the template', async () => {
    const { api } = memoryApi();
    await saveUserCanvasTemplate(api, { name: 'T', doc: templateDocFromPage(encodeCanvasContentFromDoc(pageDoc).storedContent) });
    const [tpl] = await loadUserCanvasTemplates(api);
    const a = tpl!.buildDoc() as any;
    a.content.length = 0;
    expect((tpl!.buildDoc() as any).content.length).toBeGreaterThan(0);
  });

  it('an empty or unreadable page gives no template', () => {
    expect(templateDocFromPage('')).toBeNull();
    expect(templateDocFromPage('{not json')).toBeNull();
  });
});
