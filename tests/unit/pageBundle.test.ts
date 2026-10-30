// pageBundle.test.ts — a page with its sub-pages as a .zip of Markdown files:
// `Name.md` beside a `Name/` folder of its sub-pages, names safe and unique,
// and links between the exported pages pointing at their files.

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { bundleFiles, collectPages, countPages, fileNameFor, relativeLink, zipBundle, type IBundleSource } from '../../src/built-in/canvas/export/pageBundle';
import { encodeCanvasContentFromDoc } from '../../src/built-in/canvas/contentSchema';
import type { IPage } from '../../src/built-in/canvas/canvasTypes';
import { markdownToTiptapJson } from '../../src/built-in/canvas/markdownImport';

const para = (...content: unknown[]) => ({ type: 'paragraph', content });
function page(id: string, title: string, parentId: string | null, blocks: unknown[] = []): IPage {
  return { id, title, parentId, isArchived: false, content: encodeCanvasContentFromDoc({ type: 'doc', content: blocks }).storedContent } as unknown as IPage;
}

function source(pages: IPage[]): IBundleSource {
  return {
    getPage: async (id) => pages.find((p) => p.id === id) ?? null,
    getChildren: async (id) => pages.filter((p) => p.parentId === id),
    getRootPages: async () => pages.filter((p) => p.parentId === null),
  };
}

const PAGES = [
  page('course', 'Exam 7: Notes', null, [
    para({ type: 'text', text: 'Start here.' }),
    { type: 'pageBlock', attrs: { id: 'b1', pageId: 'clark', title: 'Clark' } },
    { type: 'pageBlock', attrs: { id: 'b2', pageId: 'mack', title: 'Mack' } },
  ]),
  page('clark', 'Clark', 'course', [para({ type: 'text', text: 'See ' }, { type: 'text', text: 'Mack', marks: [{ type: 'link', attrs: { href: 'parallx-page:mack' } }] }, { type: 'text', text: ' and ' }, { type: 'text', text: 'elsewhere', marks: [{ type: 'link', attrs: { href: 'parallx-page:other' } }] })]),
  page('mack', 'Mack', 'course', [{ type: 'pageBlock', attrs: { id: 'b3', pageId: 'mackq', title: 'Questions' } }]),
  page('mackq', 'Questions', 'mack', [para({ type: 'text', text: 'Back to ' }, { type: 'text', text: 'the course', marks: [{ type: 'link', attrs: { href: 'parallx://canvas/page/course' } }] })]),
  page('dup', 'Clark', 'course'),
  page('other', 'Other', null),
];

describe('page bundle export', () => {
  it('names files safely', () => {
    expect(fileNameFor('Exam 7: Notes')).toBe('Exam 7_ Notes');
    expect(fileNameFor('a/b?.')).toBe('a_b_');
    expect(fileNameFor('   ')).toBe('Untitled');
  });

  it('links from one file to another relative to its folder', () => {
    expect(relativeLink('A.md', 'A/B.md')).toBe('A/B.md');
    expect(relativeLink('A/B/C.md', 'A.md')).toBe('../../A.md');
    expect(relativeLink('A/B.md', 'A/C (2).md')).toBe('C%20%282%29.md');
  });

  it('writes a page and its sub-pages, a folder beside each page that has some', async () => {
    const pages = await collectPages(source(PAGES), ['course']);
    expect(countPages(pages)).toBe(5);
    const files = bundleFiles(pages);
    expect([...files.keys()]).toEqual([
      'Exam 7_ Notes.md', 'Exam 7_ Notes/Clark.md', 'Exam 7_ Notes/Mack.md', 'Exam 7_ Notes/Mack/Questions.md', 'Exam 7_ Notes/Clark (2).md',
    ]);
    const top = files.get('Exam 7_ Notes.md')!;
    expect(top).toContain('# Exam 7: Notes');
    expect(top).toContain('[Clark](Exam%207_%20Notes/Clark.md)');
    expect(top).toContain('[Mack](Exam%207_%20Notes/Mack.md)');
    // The carrier stays, so the page reads back in with its sub-page blocks.
    const back = markdownToTiptapJson(top).content ?? [];
    expect(back.filter((b) => b.type === 'pageBlock').map((b) => b.attrs?.pageId)).toEqual(['clark', 'mack']);
    const clark = files.get('Exam 7_ Notes/Clark.md')!;
    expect(clark).toContain('[Mack](Mack.md)');
    expect(clark).toContain('(parallx-page:other)'); // not in the export: left as it was
    expect(files.get('Exam 7_ Notes/Mack/Questions.md')).toContain('[the course](../../Exam%207_%20Notes.md)');
  });

  it('exports every top-level page, and zips the files', async () => {
    const pages = await collectPages(source(PAGES), null);
    expect(pages.map((p) => p.title)).toEqual(['Exam 7: Notes', 'Other']);
    const files = bundleFiles(pages);
    expect(files.get('Exam 7_ Notes/Clark.md')).toContain('[elsewhere](../Other.md)');
    const zip = await JSZip.loadAsync(await zipBundle(files), { base64: true });
    expect(Object.keys(zip.files).filter((f) => !zip.files[f].dir).sort()).toEqual([...files.keys()].sort());
    expect(await zip.file('Other.md')!.async('string')).toBe(files.get('Other.md'));
  });
});
