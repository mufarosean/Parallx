// toolReadBeforeEdit.test.ts — M85 Slice C: read-before-edit enforcement
//
// One registry, two surfaces: fs_* tools (workspace files) and canvas_* tools
// (pages). Mutating tools refuse to run against a resource the session has
// never read; invocations without a session context fail open.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  markResourceSeen,
  wasResourceSeen,
  clearResourceRegistry,
  fileResourceKey,
  pageResourceKey,
  _resetResourceRegistryForTest,
} from '../../src/services/toolResourceRegistry';
import { createReadFileTool } from '../../src/built-in/chat/tools/fileTools';
import { createWriteFileTool, createEditFileTool } from '../../src/built-in/chat/tools/writeTools';
import { createBlockTools } from '../../src/built-in/canvas/ai/blockTools';
import { createEditPageTool } from '../../src/built-in/canvas/ai/pageTools';
import { encodeDocContent } from '../../src/built-in/canvas/ai/blockApi';
import type { IBuiltInToolFileSystem, IBuiltInToolFileWriter, IBuiltInToolDatabase } from '../../src/built-in/chat/chatTypes';
import type { ICancellationToken } from '../../src/services/chatTypes';

function token(): ICancellationToken {
  return { isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any };
}

const S1 = { sessionId: 'session-1' };

beforeEach(() => {
  _resetResourceRegistryForTest();
});

// ── Registry ────────────────────────────────────────────────────────────────

describe('toolResourceRegistry', () => {
  it('marks and reports seen resources per session', () => {
    markResourceSeen('s1', fileResourceKey('src/a.ts'));
    expect(wasResourceSeen('s1', fileResourceKey('src/a.ts'))).toBe(true);
    expect(wasResourceSeen('s2', fileResourceKey('src/a.ts'))).toBe(false);
    expect(wasResourceSeen('s1', fileResourceKey('src/b.ts'))).toBe(false);
  });

  it('normalizes file paths (slashes, case, leading ./)', () => {
    markResourceSeen('s1', fileResourceKey('src\\Sub\\File.TS'));
    expect(wasResourceSeen('s1', fileResourceKey('./src/sub/file.ts'))).toBe(true);
  });

  it('file and page keys never collide', () => {
    markResourceSeen('s1', fileResourceKey('abc'));
    expect(wasResourceSeen('s1', pageResourceKey('abc'))).toBe(false);
  });

  it('clearResourceRegistry drops a session', () => {
    markResourceSeen('s1', fileResourceKey('a.ts'));
    clearResourceRegistry('s1');
    expect(wasResourceSeen('s1', fileResourceKey('a.ts'))).toBe(false);
  });
});

// ── fs tools ────────────────────────────────────────────────────────────────

function makeFsMocks(files: Map<string, string>) {
  const fs: IBuiltInToolFileSystem = {
    workspaceRootName: 'ws',
    async readdir() { return []; },
    async readFileContent(p: string) {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return { content, type: 'text' as const, totalChars: content.length };
    },
    async exists(p: string) { return files.has(p); },
  };
  const writer: IBuiltInToolFileWriter = {
    async writeFile(p: string, c: string) { files.set(p, c); },
    isPathAllowed: () => true,
  };
  return { fs, writer };
}

describe('fs read-before-edit', () => {
  let files: Map<string, string>;
  let fs: IBuiltInToolFileSystem;
  let writer: IBuiltInToolFileWriter;

  beforeEach(() => {
    files = new Map([['notes.md', 'line one\nline two\nline three\nline four\nline five']]);
    ({ fs, writer } = makeFsMocks(files));
  });

  it('blocks fs_edit_file on an unread file', async () => {
    const edit = createEditFileTool(fs, writer);
    const result = await edit.handler({ path: 'notes.md', old_content: 'line two', new_content: 'LINE 2' }, token(), S1);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not read');
    expect(files.get('notes.md')).toContain('line two'); // untouched
  });

  it('fs_read_file unlocks the edit, and the result carries a verification snippet', async () => {
    const read = createReadFileTool(fs);
    const edit = createEditFileTool(fs, writer);

    const readResult = await read.handler({ path: 'notes.md' }, token(), S1);
    expect(readResult.isError).toBeFalsy();

    const result = await edit.handler({ path: 'notes.md', old_content: 'line two', new_content: 'LINE 2' }, token(), S1);
    expect(result.isError).toBeFalsy();
    expect(files.get('notes.md')).toContain('LINE 2');
    // Verification snippet: edited region + surrounding context with line numbers.
    expect(result.content).toContain('2| LINE 2');
    expect(result.content).toContain('1| line one');
    expect(result.content).toContain('3| line three');
  });

  it('fails open without a session context', async () => {
    const edit = createEditFileTool(fs, writer);
    const result = await edit.handler({ path: 'notes.md', old_content: 'line two', new_content: 'LINE 2' }, token());
    expect(result.isError).toBeFalsy();
  });

  it('blocks fs_write_file overwrite of an unread file, allows new-file creation', async () => {
    const write = createWriteFileTool(fs, writer);

    const overwrite = await write.handler({ path: 'notes.md', content: 'clobbered' }, token(), S1);
    expect(overwrite.isError).toBe(true);
    expect(overwrite.content).toContain('not read');
    expect(files.get('notes.md')).toContain('line one');

    const create = await write.handler({ path: 'fresh.md', content: 'new content' }, token(), S1);
    expect(create.isError).toBeFalsy();
    expect(files.get('fresh.md')).toBe('new content');
  });

  it('a write marks the file seen, unlocking subsequent edits', async () => {
    const write = createWriteFileTool(fs, writer);
    const edit = createEditFileTool(fs, writer);

    await write.handler({ path: 'fresh.md', content: 'alpha\nbeta' }, token(), S1);
    const result = await edit.handler({ path: 'fresh.md', old_content: 'beta', new_content: 'gamma' }, token(), S1);
    expect(result.isError).toBeFalsy();
    expect(files.get('fresh.md')).toBe('alpha\ngamma');
  });
});

// ── canvas tools ────────────────────────────────────────────────────────────

interface PageRow { id: string; title: string; content: string; revision: number; updated_at: string }

function makeCanvasDb(pages: PageRow[]): IBuiltInToolDatabase {
  return {
    isOpen: true,
    async get<T>(sql: string, params: unknown[] = []): Promise<T | null | undefined> {
      if (/FROM pages WHERE id = \?/.test(sql)) {
        return pages.find(p => p.id === params[0]) as T | undefined;
      }
      return undefined;
    },
    async all<T>(): Promise<T[]> { return []; },
    async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      if (/UPDATE pages SET content/.test(sql)) {
        const id = params.at(-1) as string;
        const target = pages.find(p => p.id === id);
        if (target) {
          target.content = params[0] as string;
          target.revision += 1;
        }
        return { changes: target ? 1 : 0 };
      }
      return { changes: 0 };
    },
  };
}

function docEnvelope(blocks: { id: string; text: string }[]): string {
  return encodeDocContent({
    type: 'doc',
    content: blocks.map(b => ({
      type: 'paragraph',
      attrs: { id: b.id },
      content: [{ type: 'text', text: b.text }],
    })),
  });
}

describe('canvas read-before-edit', () => {
  let pages: PageRow[];
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    pages = [{
      id: 'p1', title: 'Study Notes', revision: 1, updated_at: '2026-01-01',
      content: docEnvelope([{ id: 'a1', text: 'original' }]),
    }];
    db = makeCanvasDb(pages);
  });

  it('blocks canvas_edit_page on an unread page', async () => {
    const edit = createEditPageTool(db);
    const result = await edit.handler({ pageId: 'p1', markdown: '# clobber' }, token(), S1);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not read');
    expect(pages[0].revision).toBe(1); // untouched
  });

  it('blocks canvas_edit_block and canvas_insert_block_after on an unread page', async () => {
    const tools = createBlockTools(db);
    const editBlock = tools.find(t => t.name === 'canvas_edit_block')!;
    const insert = tools.find(t => t.name === 'canvas_insert_block_after')!;

    const r1 = await editBlock.handler({ pageId: 'p1', blockId: 'a1', newContent: 'x' }, token(), S1);
    expect(r1.isError).toBe(true);
    expect(r1.content).toContain('not read');

    const r2 = await insert.handler({ pageId: 'p1', anchorBlockId: 'a1', content: 'x' }, token(), S1);
    expect(r2.isError).toBe(true);
  });

  it('canvas_read_block marks the page, unlocking block edits and page edits', async () => {
    const tools = createBlockTools(db);
    const readBlock = tools.find(t => t.name === 'canvas_read_block')!;
    const editBlock = tools.find(t => t.name === 'canvas_edit_block')!;
    const editPage = createEditPageTool(db);

    const read = await readBlock.handler({ pageId: 'p1', blockId: 'a1' }, token(), S1);
    expect(read.isError).toBeFalsy();

    const r1 = await editBlock.handler({ pageId: 'p1', blockId: 'a1', newContent: 'edited' }, token(), S1);
    expect(r1.isError).toBeFalsy();

    const r2 = await editPage.handler({ pageId: 'p1', markdown: 'updated body' }, token(), S1);
    expect(r2.isError).toBeFalsy();
    expect(pages[0].revision).toBeGreaterThan(1);
  });

  it('canvas mutations fail open without a session context', async () => {
    const edit = createEditPageTool(db);
    const result = await edit.handler({ pageId: 'p1', markdown: 'no session' }, token());
    expect(result.isError).toBeFalsy();
  });
});
