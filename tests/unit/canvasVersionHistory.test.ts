/**
 * Canvas page version history — checkpoint capture (dedupe), retention prune,
 * and non-destructive restore. Drives CanvasDataService against an in-memory DB
 * that models the `pages` + `page_revisions` tables.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import {
  setGlobalSettingsRegistry,
  type ISettingsRegistryService,
} from '../../src/services/settingsRegistryService';

function doc(text: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
}

function makePageRow(id: string, content: string): Record<string, unknown> {
  return {
    id, parent_id: null, title: 'Page', icon: null, content,
    content_schema_version: 2, revision: 1, sort_order: 1, is_archived: 0,
    cover_url: null, cover_y_offset: 0.5, font_family: 'default',
    full_width: 0, small_text: 0, is_locked: 0, is_favorited: 0,
    created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
  };
}

interface RevRow {
  id: string; page_id: string; content: string; content_schema_version: number;
  title: string | null; source: string; created_at: string; seq: number;
}

function createMockDb() {
  const pages = new Map<string, Record<string, unknown>>();
  const revisions: RevRow[] = [];
  let seq = 0;

  const newest = (pageId: string): RevRow[] =>
    revisions.filter((r) => r.page_id === pageId).sort((a, b) => b.seq - a.seq);

  const get = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT \* FROM pages WHERE id = \?/i.test(sql)) {
      return { error: null, row: pages.get(params[0] as string) ?? null };
    }
    if (/SELECT content FROM page_revisions WHERE page_id = \? ORDER BY/i.test(sql)) {
      const list = newest(params[0] as string);
      return { error: null, row: list.length ? { content: list[0].content } : null };
    }
    if (/FROM page_revisions WHERE id = \?/i.test(sql)) {
      const r = revisions.find((x) => x.id === params[0]);
      return { error: null, row: r ?? null };
    }
    return { error: null, row: null };
  });

  const all = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/FROM page_revisions WHERE page_id = \? ORDER BY/i.test(sql)) {
      return { error: null, rows: newest(params[0] as string) };
    }
    return { error: null, rows: [] };
  });

  const run = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^INSERT INTO page_revisions/i.test(sql)) {
      const [id, page_id, content, csv, title, source] = params as [string, string, string, number, string | null, string];
      revisions.push({ id, page_id, content, content_schema_version: csv, title, source, created_at: new Date(Date.now() + seq).toISOString(), seq: seq++ });
      return { error: null, changes: 1 };
    }
    if (/^DELETE FROM page_revisions\s+WHERE page_id = \?\s+AND id NOT IN/i.test(sql)) {
      const pageId = params[0] as string;
      const limit = params[params.length - 1] as number;
      const keep = new Set(newest(pageId).slice(0, limit).map((r) => r.id));
      for (let i = revisions.length - 1; i >= 0; i--) {
        if (revisions[i].page_id === pageId && !keep.has(revisions[i].id)) revisions.splice(i, 1);
      }
      return { error: null, changes: 1 };
    }
    if (/^UPDATE pages SET .*content = \?/is.test(sql)) {
      // params: [content, schemaVersion, id] or [content, schemaVersion, id, expectedRevision]
      // (updated_at/revision are SQL literals). The optimistic-concurrency guard
      // appends `AND revision = ?`; a mismatch = 0 rows changed (conflict).
      const content = params[0];
      const schemaVersion = params[1];
      const id = params[2] as string;
      const expectedRevision = /revision = \?/i.test(sql) ? (params[3] as number) : undefined;
      const row = pages.get(id);
      if (!row) return { error: null, changes: 0 };
      if (expectedRevision !== undefined && (row.revision as number) !== expectedRevision) {
        return { error: null, changes: 0 };
      }
      row.content = content;
      row.content_schema_version = schemaVersion;
      row.revision = (row.revision as number) + 1;
      return { error: null, changes: 1 };
    }
    return { error: null, changes: 0 };
  });

  return { pages, revisions, mock: { get, all, run, runTransaction: vi.fn(async () => ({ error: null, results: [] })) } };
}

describe('CanvasDataService — version history', () => {
  let env: ReturnType<typeof createMockDb>;
  let service: CanvasDataService;

  beforeEach(() => {
    env = createMockDb();
    env.pages.set('p1', makePageRow('p1', doc('original')));
    (globalThis as any).window = { parallxElectron: { database: env.mock } };
    service = new CanvasDataService();
  });

  afterEach(() => {
    service.dispose();
    setGlobalSettingsRegistry(undefined);
    delete (globalThis as any).window;
  });

  it('captures a checkpoint for an edited page on flush', async () => {
    await service.updatePage('p1', { content: doc('v1') });
    await service.flushCheckpoints();
    const revs = await service.listPageRevisions('p1');
    expect(revs).toHaveLength(1);
    expect(revs[0].source).toBe('user');
  });

  it('dedupes — no new checkpoint when content is unchanged since the last one', async () => {
    await service.updatePage('p1', { content: doc('same') });
    await service.flushCheckpoints();
    await service.updatePage('p1', { content: doc('same') }); // marks dirty again, identical content
    await service.flushCheckpoints();
    expect(await service.listPageRevisions('p1')).toHaveLength(1);
  });

  it('captures a new checkpoint when content changes', async () => {
    await service.updatePage('p1', { content: doc('a') });
    await service.flushCheckpoints();
    await service.updatePage('p1', { content: doc('b') });
    await service.flushCheckpoints();
    expect(await service.listPageRevisions('p1')).toHaveLength(2);
  });

  it('attributes AI writes (notifyExternalPageMutation) to the "ai" source', async () => {
    await service.updatePage('p1', { content: doc('ai-wrote-this') });
    await service.notifyExternalPageMutation('p1', 'updated');
    await service.flushCheckpoints();
    const revs = await service.listPageRevisions('p1');
    expect(revs[0].source).toBe('ai');
  });

  it('prunes to the configured maxPerPage', async () => {
    setGlobalSettingsRegistry({
      getSchema: () => ({}) as never,
      getValue: () => 2,
    } as unknown as ISettingsRegistryService);

    for (const t of ['a', 'b', 'c']) {
      await service.updatePage('p1', { content: doc(t) });
      await service.flushCheckpoints();
    }
    expect(await service.listPageRevisions('p1')).toHaveLength(2); // oldest pruned
  });

  it('a stale debounced editor save does not clobber a newer AI content write', async () => {
    // Repro for the "AI creates a page → close → reopen → content gone" bug:
    // a freshly-opened page queues a debounced save of its (placeholder) doc,
    // then an AI tool streams the real body in; the stale debounce must NOT
    // overwrite it just because it fires last. Typing would reschedule with
    // real content — which is why the bug "only happens without typing".
    vi.useFakeTimers();
    try {
      await service.getPage('p1');                                  // editor loads → base = 'original'
      service.scheduleContentSave('p1', doc('stale editor doc'));   // debounce queued
      await service.updatePage('p1', { content: doc('AI streamed body'), editSource: 'ai' });
      expect(env.pages.get('p1')!.content).toContain('AI streamed body');

      await vi.advanceTimersByTimeAsync(2000);                      // debounce fires

      expect(env.pages.get('p1')!.content).toContain('AI streamed body');
      expect(env.pages.get('p1')!.content).not.toContain('stale editor doc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('still saves a genuine edit when no competing write landed', async () => {
    vi.useFakeTimers();
    try {
      await service.getPage('p1');                                  // base = 'original'
      service.scheduleContentSave('p1', doc('user typed this'));
      await vi.advanceTimersByTimeAsync(2000);
      expect(env.pages.get('p1')!.content).toContain('user typed this');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a background auto-save cannot silently blank a page that holds real content', async () => {
    // Backstop for the "AI page content vanishes on close/reopen" bug: a stale or
    // never-populated editor doc (e.g. an embed still on the empty placeholder)
    // must not persist an empty doc over the page's real content.
    vi.useFakeTimers();
    try {
      await service.getPage('p1');                                   // content = 'original'
      service.scheduleContentSave('p1', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));
      await vi.advanceTimersByTimeAsync(2000);
      expect(env.pages.get('p1')!.content).toContain('original');    // NOT blanked
    } finally {
      vi.useRealTimers();
    }
  });

  it('restores a prior revision and snapshots the (uncaptured) current state first — non-destructive', async () => {
    await service.updatePage('p1', { content: doc('first') });
    await service.flushCheckpoints();
    const [firstRev] = await service.listPageRevisions('p1');

    // Edit to 'second' but DON'T checkpoint it yet (uncaptured live work).
    await service.updatePage('p1', { content: doc('second') });

    const reloads: string[] = [];
    service.onRequestContentReload((id) => reloads.push(id));

    await service.restorePageRevision('p1', firstRev.id);

    // Page content reverted to the 'first' revision (and away from 'second').
    expect(env.pages.get('p1')!.content).toContain('first');
    expect(env.pages.get('p1')!.content).not.toContain('second');
    // The pre-restore 'second' state was snapshotted as a 'restore' checkpoint,
    // so the restore is undoable — no data lost.
    const revs = await service.listPageRevisions('p1');
    expect(revs.some((r) => r.source === 'restore')).toBe(true);
    const contents = await Promise.all(revs.map((r) => service.getPageRevision(r.id)));
    expect(contents.some((c) => c?.content.includes('second'))).toBe(true);
    // Open editor was asked to reload.
    expect(reloads).toContain('p1');
  });

  // ── Close-commit pipeline (the "pipeline of truth") ──────────────────────

  it('commitPageClose persists the editor final content as the latest version AND checkpoints it', async () => {
    await service.getPage('p1'); // editor loads → base = 'original'
    await service.commitPageClose('p1', doc('final content at close'));

    // Persisted to the pages table as the latest content.
    expect(env.pages.get('p1')!.content).toContain('final content at close');
    // And snapshotted into version history.
    const revs = await service.listPageRevisions('p1');
    expect(revs).toHaveLength(1);
    const rev = await service.getPageRevision(revs[0].id);
    expect(rev?.content).toContain('final content at close');
  });

  it('commitPageClose refuses to blank a populated page with a stale/empty editor doc', async () => {
    await service.updatePage('p1', { content: doc('real content') });
    await service.commitPageClose('p1', JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }));
    expect(env.pages.get('p1')!.content).toContain('real content'); // NOT blanked
  });

  it('an AI edit is checkpointed immediately — surviving a close before the interval tick', async () => {
    // The headline "AI edits a page → close → reopen → blank" repro: the AI
    // write must land in history WITHOUT waiting for the interval checkpoint.
    await service.updatePage('p1', { content: doc('AI authored body'), editSource: 'ai' });
    await service.notifyExternalPageMutation('p1', 'updated');

    // No flushCheckpoints() — the checkpoint must already exist.
    const revs = await service.listPageRevisions('p1');
    expect(revs).toHaveLength(1);
    expect(revs[0].source).toBe('ai');

    // User closes the page handing back the AI content; it survives.
    await service.commitPageClose('p1', doc('AI authored body'));
    const page = await service.getPage('p1');
    expect(page!.content).toContain('AI authored body');
  });

  it('a restored revision survives a subsequent page close', async () => {
    await service.updatePage('p1', { content: doc('v1') });
    await service.flushCheckpoints();
    const [rev1] = await service.listPageRevisions('p1');

    await service.updatePage('p1', { content: doc('v2') });
    await service.restorePageRevision('p1', rev1.id);
    expect(env.pages.get('p1')!.content).toContain('v1');

    // Editor reloaded v1; user closes handing v1 back — it stays restored.
    await service.commitPageClose('p1', doc('v1'));
    expect(env.pages.get('p1')!.content).toContain('v1');
    expect(env.pages.get('p1')!.content).not.toContain('v2');
  });
});
