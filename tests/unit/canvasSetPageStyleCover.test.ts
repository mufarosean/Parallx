// canvas_set_page_style — cover image path resolution
//
// User bug: AI tried to set a cover image using a workspace-relative path
// (e.g. "Skills/CoverImages/foo.png") and the canvas pane silently failed
// to render because the path was stored verbatim and the renderer's CSP
// blocks file:// and treats the string as relative to the document URL.
//
// Fix: the tool now resolves local paths to data: URLs before storing.
// These tests verify each accepted input shape behaves as expected.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSetPageStyleTool } from '../../src/built-in/chat/tools/pageTools';
import type { IBuiltInToolDatabase } from '../../src/built-in/chat/chatTypes';
import type { ICancellationToken, IChatTool } from '../../src/services/chatTypes';

const token = (): ICancellationToken => ({
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() { /* noop */ } }),
});

function makeDb(): {
  db: IBuiltInToolDatabase;
  updates: Array<{ sql: string; params: readonly unknown[] }>;
} {
  const updates: Array<{ sql: string; params: readonly unknown[] }> = [];
  const db: IBuiltInToolDatabase = {
    isOpen: true,
    async run(sql: string, params: readonly unknown[]) {
      updates.push({ sql, params: [...params] });
    },
    async all<T>() { return [] as T[]; },
    async get<T>(_sql: string, _params: readonly unknown[]) {
      return { id: 'page-1', title: 'Cover Test' } as unknown as T;
    },
  };
  return { db, updates };
}

function lastCoverParam(updates: Array<{ sql: string; params: readonly unknown[] }>): unknown {
  const u = updates[updates.length - 1]!;
  // Params end with: [...style values..., updated_at, pageId].
  // Find the cover_url position in the SQL.
  const cols = u.sql.match(/SET\s+(.+?)\s+WHERE/i)?.[1]?.split(',') ?? [];
  const coverIdx = cols.findIndex(c => c.includes('cover_url'));
  return u.params[coverIdx];
}

function installFakeElectron(
  readFile: (p: string, enc: string) => Promise<{
    encoding?: string;
    content?: string;
    error?: { message?: string; code?: string } | string;
  }>,
): void {
  (globalThis as any).window = { parallxElectron: { fs: { readFile } } };
}

function clearFakeElectron(): void {
  delete (globalThis as any).window;
}

describe('canvas_set_page_style — coverUrl resolution', () => {
  let tool: IChatTool;
  let updates: Array<{ sql: string; params: readonly unknown[] }>;

  beforeEach(() => {
    const made = makeDb();
    updates = made.updates;
    tool = createSetPageStyleTool(made.db, undefined, 'C:/workspace');
  });

  it('http(s) URL: stored verbatim', async () => {
    installFakeElectron(vi.fn());
    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'https://example.com/img.png' } }, token());
    expect(r.isError).toBeFalsy();
    expect(lastCoverParam(updates)).toBe('https://example.com/img.png');
    clearFakeElectron();
  });

  it('data: URL: stored verbatim', async () => {
    installFakeElectron(vi.fn());
    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'data:image/png;base64,iVBORw0K' } }, token());
    expect(r.isError).toBeFalsy();
    expect(lastCoverParam(updates)).toBe('data:image/png;base64,iVBORw0K');
    clearFakeElectron();
  });

  it('linear-gradient: stored verbatim (back-compat with the picker)', async () => {
    installFakeElectron(vi.fn());
    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'linear-gradient(180deg, #abc, #def)' } }, token());
    expect(r.isError).toBeFalsy();
    expect(lastCoverParam(updates)).toBe('linear-gradient(180deg, #abc, #def)');
    clearFakeElectron();
  });

  it('empty string: stored as null (clear cover)', async () => {
    installFakeElectron(vi.fn());
    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: '' } }, token());
    expect(r.isError).toBeFalsy();
    expect(lastCoverParam(updates)).toBeNull();
    clearFakeElectron();
  });

  it('workspace-relative path: joins with workspaceRoot and converts to data URL', async () => {
    const readFile = vi.fn(async (path: string) => {
      expect(path).toContain('Skills');
      expect(path).toContain('CoverImages');
      expect(path).toContain('foo.png');
      return { encoding: 'base64', content: 'AAAA' };
    });
    installFakeElectron(readFile);

    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'Skills/CoverImages/foo.png' } }, token());
    expect(r.isError).toBeFalsy();
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(lastCoverParam(updates)).toBe('data:image/png;base64,AAAA');
    clearFakeElectron();
  });

  it('absolute path: read as-is, no workspace join', async () => {
    const readFile = vi.fn(async (path: string) => {
      expect(path).toBe('C:/somewhere/icon.jpg');
      return { encoding: 'base64', content: 'BBBB' };
    });
    installFakeElectron(readFile);

    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'C:/somewhere/icon.jpg' } }, token());
    expect(r.isError).toBeFalsy();
    expect(lastCoverParam(updates)).toBe('data:image/jpeg;base64,BBBB');
    clearFakeElectron();
  });

  it('file:// URL: strips prefix and reads the absolute path', async () => {
    const readFile = vi.fn(async (path: string) => {
      expect(path).toBe('C:/somewhere/pic.gif');
      return { encoding: 'base64', content: 'CCCC' };
    });
    installFakeElectron(readFile);

    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'file:///C:/somewhere/pic.gif' } }, token());
    expect(r.isError).toBeFalsy();
    expect(lastCoverParam(updates)).toBe('data:image/gif;base64,CCCC');
    clearFakeElectron();
  });

  it('local path with unsupported extension: errors with a helpful message, no write', async () => {
    const readFile = vi.fn();
    installFakeElectron(readFile);

    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'Skills/CoverImages/foo.exe' } }, token());
    expect(r.isError).toBe(true);
    expect(r.content).toContain('does not look like an image');
    expect(readFile).not.toHaveBeenCalled();
    expect(updates.length).toBe(0);
    clearFakeElectron();
  });

  it('IPC read failure: errors with the underlying message, no write', async () => {
    installFakeElectron(async () => ({ error: { message: 'ENOENT', code: 'ENOENT' } }));

    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'Skills/missing.png' } }, token());
    expect(r.isError).toBe(true);
    expect(r.content).toContain('ENOENT');
    expect(updates.length).toBe(0);
    clearFakeElectron();
  });

  it('oversized image: rejected with size message, no write', async () => {
    const tooBig = 'A'.repeat(8_000_000); // ~8 MB encoded > 5 MB raw cap
    installFakeElectron(async () => ({ encoding: 'base64', content: tooBig }));

    const r = await tool.handler({ pageId: 'page-1', style: { coverUrl: 'Skills/big.png' } }, token());
    expect(r.isError).toBe(true);
    expect(r.content).toContain('too large');
    expect(updates.length).toBe(0);
    clearFakeElectron();
  });

  it('no workspace root + relative path: clear error, no IPC call', async () => {
    const noRootTool = createSetPageStyleTool(makeDb().db, undefined, undefined);
    const readFile = vi.fn();
    installFakeElectron(readFile);

    const r = await noRootTool.handler({ pageId: 'page-1', style: { coverUrl: 'Skills/foo.png' } }, token());
    expect(r.isError).toBe(true);
    expect(r.content).toContain('no workspace root');
    expect(readFile).not.toHaveBeenCalled();
    clearFakeElectron();
  });

  it('icon update remains unaffected by coverUrl logic', async () => {
    installFakeElectron(vi.fn());
    const r = await tool.handler({ pageId: 'page-1', style: { icon: '🎨' } }, token());
    expect(r.isError).toBeFalsy();
    const u = updates[updates.length - 1]!;
    const iconIdx = u.sql.match(/SET\s+(.+?)\s+WHERE/i)?.[1]?.split(',').findIndex(c => c.includes('icon = ')) ?? -1;
    expect(u.params[iconIdx]).toBe('🎨');
    clearFakeElectron();
  });
});
