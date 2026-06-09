import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';

// ── Minimal in-memory DatabaseBridge backing a single page row ──
// Enough to exercise getPage + the external-mutation reload contract that the
// live editor depends on. Mirrors the bridge shape the data service reads from
// window.parallxElectron.database.
function makeBridge(initial: { id: string; content: string; revision: number }) {
  const row: Record<string, unknown> = {
    id: initial.id, parent_id: null, title: 'T', icon: null,
    content: initial.content, content_schema_version: 1, revision: initial.revision,
    sort_order: 1, is_archived: 0, cover_url: null, cover_y_offset: 0.5,
    font_family: 'default', full_width: 0, small_text: 0, is_locked: 0, is_favorited: 0,
    created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
  };
  return {
    row,
    async get(sql: string, params?: unknown[]) {
      if (/FROM pages WHERE id = \?/i.test(sql)) {
        return { error: null, row: params?.[0] === row.id ? { ...row } : null };
      }
      return { error: null, row: null };
    },
    async run() { return { error: null, changes: 1 }; },
    async all() { return { error: null, rows: [] as Record<string, unknown>[] }; },
    async runTransaction() { return { error: null, results: [] as unknown[] }; },
  };
}

const OLD = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"old"}]}]}';
const NEW = '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"AI wrote this"}]}]}';

let bridge: ReturnType<typeof makeBridge>;
let svc: CanvasDataService;

beforeEach(() => {
  bridge = makeBridge({ id: 'p1', content: OLD, revision: 1 });
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.parallxElectron = { database: bridge };
  svc = new CanvasDataService();
});
afterEach(() => { svc.dispose(); });

describe('Canvas live-reload contract (AI edit → open editor reload)', () => {
  it('fires onRequestContentReload for the right page, and a fresh getPage returns the AI content', async () => {
    const reloads: string[] = [];
    svc.onRequestContentReload((id) => reloads.push(id));

    // Simulate the AI tool's raw-db write: new content + revision bump.
    bridge.row.content = NEW;
    bridge.row.revision = 2;
    await svc.notifyExternalPageMutation('p1', 'updated');

    // The open editor IS told to reload, for the right page id.
    expect(reloads).toEqual(['p1']);
    // And a fresh read returns the AI's content (no stale cache, no desync).
    const page = await svc.getPage('p1');
    expect(page?.content).toBe(NEW);
    expect(page?.revision).toBe(2);
  });

  it('requests a reload ONLY for updated (never created/deleted)', async () => {
    const reloads: string[] = [];
    svc.onRequestContentReload((id) => reloads.push(id));
    await svc.notifyExternalPageMutation('p1', 'created');
    await svc.notifyExternalPageMutation('p1', 'deleted');
    expect(reloads).toEqual([]);
  });
});
