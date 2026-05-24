// autoTaggingService.test.ts — pin embedding-based tag propagation.
//
// Pins:
//   initialize(): no-op when db not open; otherwise creates page_tags table + 2 indexes
//     and is idempotent (second call → no extra DDL)
//   getPageTags: SELECT ordered by created_at, maps row→PageTag
//   addTag:
//     - existing-name returns existing tag_id (no duplicate INSERT, no event)
//     - new tag: INSERT OR IGNORE, fires onDidChangeTags with full tag list
//     - color fallback uses deterministic hash → consistent across calls for same name
//   removeTag: DELETE WHERE page_id+tag_id, fires onDidChangeTags
//   getAllTags: distinct by tag_name
//   suggestTags:
//     - returns [] when index incomplete (no init/embed/search)
//     - returns [] when page text missing
//     - excludes the target page itself + dedupes similar pageIds
//     - caps similar pages to 5
//     - skips already-applied tag names
//     - ranks by totalScore (similarity decay 1/(i+1)) desc; cap at 5; min frequency 1
//     - fires onDidSuggestTags when suggestions non-empty
//   autoTagOnSave: only applies suggestions with confidence > 0.5

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutoTaggingService, type PageTag } from '../../src/services/autoTaggingService';

class MockDb {
  isOpen = true;
  // Track raw rows for page_tags
  rows: Array<{ page_id: string; tag_id: string; tag_name: string; tag_color: string; created_at: string }> = [];
  pages: Record<string, { content: string; title: string }> = {};
  runCalls: Array<{ sql: string; params: any[] }> = [];

  async run(sql: string, params: any[] = []): Promise<void> {
    this.runCalls.push({ sql, params });
    if (sql.startsWith('INSERT OR IGNORE INTO page_tags')) {
      const [page_id, tag_id, tag_name, tag_color] = params;
      const exists = this.rows.find((r) => r.page_id === page_id && r.tag_id === tag_id);
      if (!exists) {
        this.rows.push({ page_id, tag_id, tag_name, tag_color, created_at: new Date(Date.now() + this.rows.length).toISOString() });
      }
    } else if (sql.startsWith('DELETE FROM page_tags')) {
      const [page_id, tag_id] = params;
      this.rows = this.rows.filter((r) => !(r.page_id === page_id && r.tag_id === tag_id));
    }
  }

  async get<T>(sql: string, params: any[] = []): Promise<T | undefined> {
    if (sql.includes('FROM page_tags WHERE page_id = ? AND tag_name = ?')) {
      const [page_id, tag_name] = params;
      const r = this.rows.find((r) => r.page_id === page_id && r.tag_name === tag_name);
      return (r ? { tag_id: r.tag_id } : undefined) as any;
    }
    if (sql.includes('FROM pages WHERE id = ? AND is_archived = 0')) {
      const [id] = params;
      const p = this.pages[id];
      return (p ? { content: p.content, title: p.title } : undefined) as any;
    }
    return undefined;
  }

  async all<T>(sql: string, params: any[] = []): Promise<T[]> {
    if (sql.includes('FROM page_tags WHERE page_id = ?')) {
      const [page_id] = params;
      return this.rows
        .filter((r) => r.page_id === page_id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((r) => ({ tag_id: r.tag_id, tag_name: r.tag_name, tag_color: r.tag_color })) as any;
    }
    if (sql.includes('SELECT DISTINCT tag_name')) {
      const map = new Map<string, { tag_id: string; tag_name: string; tag_color: string }>();
      for (const r of this.rows) {
        if (!map.has(r.tag_name)) {
          map.set(r.tag_name, { tag_id: r.tag_id, tag_name: r.tag_name, tag_color: r.tag_color });
        }
      }
      return [...map.values()].sort((a, b) => a.tag_name.localeCompare(b.tag_name)) as any;
    }
    return [] as any;
  }
}

function mkSvc(over: { indexComplete?: boolean; dbOpen?: boolean } = {}) {
  const db = new MockDb();
  if (over.dbOpen === false) db.isOpen = false;
  const embed = vi.fn(async () => [1]);
  const vectorSearch = vi.fn(async (): Promise<any[]> => []);
  const svc = new AutoTaggingService(
    { embedQuery: embed } as any,
    { vectorSearch } as any,
    db as any,
    { isInitialIndexComplete: over.indexComplete ?? true } as any,
  );
  return { svc, db, embed, vectorSearch };
}

function tipTap(t: string): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
}

describe('AutoTaggingService — initialize', () => {
  it('no-op when db not open', async () => {
    const { svc, db } = mkSvc({ dbOpen: false });
    await svc.initialize();
    expect(db.runCalls.length).toBe(0);
  });

  it('creates page_tags table + 2 indexes; idempotent on second call', async () => {
    const { svc, db } = mkSvc();
    await svc.initialize();
    const firstCount = db.runCalls.length;
    expect(firstCount).toBe(3);
    expect(db.runCalls[0].sql).toMatch(/CREATE TABLE IF NOT EXISTS page_tags/);
    expect(db.runCalls[1].sql).toMatch(/idx_page_tags_page/);
    expect(db.runCalls[2].sql).toMatch(/idx_page_tags_name/);
    await svc.initialize();
    expect(db.runCalls.length).toBe(firstCount);
  });
});

describe('AutoTaggingService — tag CRUD', () => {
  it('addTag inserts new tag, fires onDidChangeTags with full list', async () => {
    const { svc } = mkSvc();
    const events: { pageId: string; tags: PageTag[] }[] = [];
    svc.onDidChangeTags((e) => events.push(e));
    const t = await svc.addTag('p1', 'alpha');
    expect(t.name).toBe('alpha');
    expect(t.id.startsWith('tag_')).toBe(true);
    expect(events.length).toBe(1);
    expect(events[0].pageId).toBe('p1');
    expect(events[0].tags.map((x) => x.name)).toEqual(['alpha']);
  });

  it('addTag is idempotent for an existing name on the same page (no extra INSERT, no event)', async () => {
    const { svc, db } = mkSvc();
    const first = await svc.addTag('p1', 'alpha');
    const events: any[] = [];
    svc.onDidChangeTags((e) => events.push(e));
    const beforeInserts = db.runCalls.filter((c) => c.sql.startsWith('INSERT')).length;
    const second = await svc.addTag('p1', 'alpha');
    expect(second.id).toBe(first.id);
    expect(events.length).toBe(0);
    expect(db.runCalls.filter((c) => c.sql.startsWith('INSERT')).length).toBe(beforeInserts);
  });

  it('color fallback is deterministic for the same name', async () => {
    const { svc } = mkSvc();
    const a = await svc.addTag('p1', 'topic-x');
    const b = await svc.addTag('p2', 'topic-x');
    expect(a.color).toBe(b.color);
  });

  it('removeTag deletes + fires event', async () => {
    const { svc } = mkSvc();
    const t = await svc.addTag('p1', 'alpha');
    const events: any[] = [];
    svc.onDidChangeTags((e) => events.push(e));
    await svc.removeTag('p1', t.id);
    expect(events.length).toBe(1);
    expect(events[0].tags).toEqual([]);
  });

  it('getPageTags returns ordered list', async () => {
    const { svc } = mkSvc();
    await svc.addTag('p1', 'first');
    await svc.addTag('p1', 'second');
    const tags = await svc.getPageTags('p1');
    expect(tags.map((t) => t.name)).toEqual(['first', 'second']);
  });

  it('getAllTags returns distinct by name', async () => {
    const { svc } = mkSvc();
    await svc.addTag('p1', 'alpha');
    await svc.addTag('p2', 'alpha');
    await svc.addTag('p3', 'beta');
    const all = await svc.getAllTags();
    expect(all.map((t) => t.name).sort()).toEqual(['alpha', 'beta']);
  });
});

describe('AutoTaggingService — suggestTags', () => {
  it('returns [] when initial index not complete (no embed/search)', async () => {
    const { svc, embed, vectorSearch } = mkSvc({ indexComplete: false });
    expect(await svc.suggestTags('p1')).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    expect(vectorSearch).not.toHaveBeenCalled();
  });

  it('returns [] when page text missing', async () => {
    const { svc, vectorSearch } = mkSvc();
    expect(await svc.suggestTags('missing')).toEqual([]);
    expect(vectorSearch).not.toHaveBeenCalled();
  });

  it('excludes target page, dedupes similar pageIds, caps to 5', async () => {
    const { svc, db, vectorSearch } = mkSvc();
    db.pages['p1'] = { title: 'P1', content: tipTap('hi') };
    // Add tags to several other pages
    for (const id of ['p2', 'p3', 'p4', 'p5', 'p6', 'p7']) {
      await svc.addTag(id, `tag-${id}`);
    }
    vectorSearch.mockResolvedValueOnce([
      { sourceType: 'page_block', sourceId: 'p1', score: 0.99 },  // self — excluded
      { sourceType: 'page_block', sourceId: 'p2', score: 0.9 },
      { sourceType: 'page_block', sourceId: 'p2', score: 0.85 }, // dupe
      { sourceType: 'page_block', sourceId: 'p3', score: 0.8 },
      { sourceType: 'page_block', sourceId: 'p4', score: 0.7 },
      { sourceType: 'page_block', sourceId: 'p5', score: 0.6 },
      { sourceType: 'page_block', sourceId: 'p6', score: 0.5 },
      { sourceType: 'page_block', sourceId: 'p7', score: 0.4 }, // beyond cap
    ]);
    const out = await svc.suggestTags('p1');
    // Up to 5 unique similar pages → up to 5 suggestions (each has a unique tag)
    expect(out.map((s) => s.tag.name).sort()).toEqual(['tag-p2', 'tag-p3', 'tag-p4', 'tag-p5', 'tag-p6']);
  });

  it('similarity decay ranks higher-position pages first', async () => {
    const { svc, db, vectorSearch } = mkSvc();
    db.pages['p1'] = { title: 'P1', content: tipTap('q') };
    await svc.addTag('p2', 'first-rank');
    await svc.addTag('p3', 'second-rank');
    vectorSearch.mockResolvedValueOnce([
      { sourceType: 'page_block', sourceId: 'p2', score: 0.5 },
      { sourceType: 'page_block', sourceId: 'p3', score: 0.9 }, // higher score but lower rank
    ]);
    const out = await svc.suggestTags('p1');
    expect(out[0].tag.name).toBe('first-rank'); // decay 1/1 vs 1/2
    expect(out[0].confidence).toBeCloseTo(1, 5);
    expect(out[1].confidence).toBeCloseTo(0.5, 5);
  });

  it('skips tags already applied to the target page', async () => {
    const { svc, db, vectorSearch } = mkSvc();
    db.pages['p1'] = { title: 'P1', content: tipTap('q') };
    await svc.addTag('p1', 'already');
    await svc.addTag('p2', 'already');
    await svc.addTag('p2', 'new');
    vectorSearch.mockResolvedValueOnce([{ sourceType: 'page_block', sourceId: 'p2', score: 0.9 }]);
    const out = await svc.suggestTags('p1');
    expect(out.map((s) => s.tag.name)).toEqual(['new']);
  });

  it('fires onDidSuggestTags when suggestions non-empty', async () => {
    const { svc, db, vectorSearch } = mkSvc();
    db.pages['p1'] = { title: 'P1', content: tipTap('q') };
    await svc.addTag('p2', 'a');
    vectorSearch.mockResolvedValueOnce([{ sourceType: 'page_block', sourceId: 'p2', score: 0.9 }]);
    const events: any[] = [];
    svc.onDidSuggestTags((e) => events.push(e));
    await svc.suggestTags('p1');
    expect(events.length).toBe(1);
    expect(events[0].pageId).toBe('p1');
    expect(events[0].suggestions.length).toBe(1);
  });

  it('does NOT fire onDidSuggestTags when suggestions empty', async () => {
    const { svc, db, vectorSearch } = mkSvc();
    db.pages['p1'] = { title: 'P1', content: tipTap('q') };
    vectorSearch.mockResolvedValueOnce([]);
    const events: any[] = [];
    svc.onDidSuggestTags((e) => events.push(e));
    await svc.suggestTags('p1');
    expect(events.length).toBe(0);
  });

  it('caps suggestions at 5', async () => {
    const { svc, db, vectorSearch } = mkSvc();
    db.pages['p1'] = { title: 'P1', content: tipTap('q') };
    // Page p2 has 7 tags
    for (let i = 0; i < 7; i++) await svc.addTag('p2', `tag${i}`);
    vectorSearch.mockResolvedValueOnce([{ sourceType: 'page_block', sourceId: 'p2', score: 0.9 }]);
    const out = await svc.suggestTags('p1');
    expect(out.length).toBe(5);
  });
});

describe('AutoTaggingService — autoTagOnSave', () => {
  it('applies suggestions whose confidence > 0.5; skips others', async () => {
    const { svc, db, vectorSearch } = mkSvc();
    db.pages['p1'] = { title: 'P1', content: tipTap('q') };
    await svc.addTag('p2', 'high');
    await svc.addTag('p3', 'low');
    vectorSearch.mockResolvedValueOnce([
      { sourceType: 'page_block', sourceId: 'p2', score: 0.9 }, // rank 0 → 1.0
      { sourceType: 'page_block', sourceId: 'p3', score: 0.9 }, // rank 1 → 0.5 → NOT >0.5
    ]);
    await svc.autoTagOnSave('p1');
    const applied = (await svc.getPageTags('p1')).map((t) => t.name);
    expect(applied).toEqual(['high']);
  });
});
