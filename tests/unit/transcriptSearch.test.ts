// transcriptSearch.test.ts — pin searchWorkspaceTranscripts behavior.

import { describe, it, expect, vi } from 'vitest';
import { searchWorkspaceTranscripts } from '../../src/services/transcriptSearch';

function mkFs(files: Record<string, string>) {
  const entries = Object.keys(files).map(name => ({ name, type: 'file' as const, size: files[name].length }));
  return {
    readdir: vi.fn(async () => entries),
    readFileContent: vi.fn(async (path: string) => {
      const name = path.replace('.parallx/sessions/', '');
      const c = files[name];
      if (c === undefined) throw new Error('ENOENT');
      return { content: c };
    }),
  };
}

const mkLine = (role: string, text: string) =>
  JSON.stringify({ type: 'message', message: { role, content: [{ type: 'text', text }] } });

describe('searchWorkspaceTranscripts', () => {
  it('returns empty array when sessions directory missing', async () => {
    const fs = { readdir: vi.fn(async () => { throw new Error('nope'); }), readFileContent: vi.fn() };
    const r = await searchWorkspaceTranscripts(fs as any, 'hello');
    expect(r).toEqual([]);
  });

  it('skips non-jsonl files and directories', async () => {
    const fs = {
      readdir: vi.fn(async () => [
        { name: 'a.txt', type: 'file', size: 10 },
        { name: 'sub', type: 'directory', size: 0 },
        { name: 'sess1.jsonl', type: 'file', size: 100 },
      ]),
      readFileContent: vi.fn(async () => ({ content: mkLine('user', 'apricot pancake recipe') })),
    };
    const r = await searchWorkspaceTranscripts(fs as any, 'apricot');
    expect(r.length).toBe(1);
    expect(r[0].sessionId).toBe('sess1');
    expect(fs.readFileContent).toHaveBeenCalledTimes(1);
  });

  it('filters by sessionId option', async () => {
    const fs = mkFs({
      'a.jsonl': mkLine('user', 'apricot pancake'),
      'b.jsonl': mkLine('user', 'apricot pancake'),
    });
    const r = await searchWorkspaceTranscripts(fs as any, 'apricot', { sessionId: 'b' });
    expect(r.map(x => x.sessionId)).toEqual(['b']);
  });

  it('drops files with no query-token matches; keeps partial', async () => {
    const fs = mkFs({
      'hit.jsonl': mkLine('user', 'apricot pancake breakfast'),
      'miss.jsonl': mkLine('user', 'totally unrelated lunch'),
    });
    const r = await searchWorkspaceTranscripts(fs as any, 'apricot pancake');
    expect(r.length).toBe(1);
    expect(r[0].sessionId).toBe('hit');
    expect(r[0].score).toBeGreaterThan(0);
  });

  it('skips empty/whitespace files', async () => {
    const fs = mkFs({ 'empty.jsonl': '   \n', 'real.jsonl': mkLine('user', 'apricot') });
    const r = await searchWorkspaceTranscripts(fs as any, 'apricot');
    expect(r.map(x => x.sessionId)).toEqual(['real']);
  });

  it('empty query token list still returns matching files with score=1', async () => {
    const fs = mkFs({
      'a.jsonl': mkLine('user', 'anything goes here'),
      'b.jsonl': mkLine('user', 'second session'),
    });
    // single-letter words are below the 3-char floor; "the" is a stopword
    const r = await searchWorkspaceTranscripts(fs as any, 'the a');
    expect(r.length).toBe(2);
    for (const item of r) expect(item.score).toBe(1);
  });

  it('sorts by score desc, then sourceId asc; respects topK (default 3)', async () => {
    const fs = mkFs({
      'z.jsonl': mkLine('user', 'apricot'), // 1/2
      'a.jsonl': mkLine('user', 'apricot pancake'), // 2/2
      'b.jsonl': mkLine('user', 'apricot pancake'), // 2/2
      'c.jsonl': mkLine('user', 'apricot pancake'), // 2/2
    });
    const r = await searchWorkspaceTranscripts(fs as any, 'apricot pancake');
    expect(r.length).toBe(3);
    // tied scores → alphabetical sourceId
    expect(r.map(x => x.sessionId)).toEqual(['a', 'b', 'c']);
  });

  it('honors topK option', async () => {
    const fs = mkFs({
      'a.jsonl': mkLine('user', 'apricot'),
      'b.jsonl': mkLine('user', 'apricot'),
    });
    const r = await searchWorkspaceTranscripts(fs as any, 'apricot', { topK: 1 });
    expect(r.length).toBe(1);
  });

  it('result has sourceId, contextPrefix, text, sessionId, score', async () => {
    const fs = mkFs({ 's.jsonl': mkLine('user', 'apricot pancake recipe') });
    const [r] = await searchWorkspaceTranscripts(fs as any, 'apricot');
    expect(r.sourceId).toBe('.parallx/sessions/s.jsonl');
    expect(r.contextPrefix).toBe('[Source: ".parallx/sessions/s.jsonl"]');
    expect(r.sessionId).toBe('s');
    expect(r.text).toContain('apricot pancake recipe');
    expect(r.score).toBeGreaterThan(0);
  });

  it('readFileContent failure on a file is swallowed and file skipped', async () => {
    const fs = {
      readdir: vi.fn(async () => [
        { name: 'bad.jsonl', type: 'file', size: 1 },
        { name: 'good.jsonl', type: 'file', size: 100 },
      ]),
      readFileContent: vi.fn(async (p: string) => {
        if (p.includes('bad')) throw new Error('boom');
        return { content: mkLine('user', 'apricot') };
      }),
    };
    const r = await searchWorkspaceTranscripts(fs as any, 'apricot');
    expect(r.map(x => x.sessionId)).toEqual(['good']);
  });
});
