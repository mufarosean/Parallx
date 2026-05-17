import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Emitter } from '../../src/platform/events.js';
import {
  MindMapRefreshOrchestrator,
  type RefreshContext,
  type RefreshPass,
} from '../../src/services/mindMapRefreshOrchestrator.js';

interface MockDb {
  isOpen: boolean;
  // Maps for the tables we care about: refresh_pass_state and refresh_history.
  // semantic_graph_sources is also queried for change detection — we mock it
  // by intercepting SELECTs to it.
  semanticGraphSources: Map<string, string>; // key = type:id, value = content_hash
  refreshPassState: Map<string, string>;     // key = passId:type:id, value = last_processed_hash
  refreshHistory: Map<string, any>;          // key = refreshId, value = row

  run: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  all: ReturnType<typeof vi.fn>;
  runTransaction: ReturnType<typeof vi.fn>;
  onDidOpen: any;
  onDidClose: any;
}

function createMockDb(): MockDb {
  const onDidOpen = new Emitter<string>();
  const onDidClose = new Emitter<void>();
  const sources = new Map<string, string>();
  const passState = new Map<string, string>();
  const history = new Map<string, any>();

  const db: MockDb = {
    isOpen: true,
    semanticGraphSources: sources,
    refreshPassState: passState,
    refreshHistory: history,
    onDidOpen: onDidOpen.event,
    onDidClose: onDidClose.event,
    run: vi.fn(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      if (s.includes('CREATE TABLE') || s.includes('CREATE INDEX')) {
        return { changes: 0, lastInsertRowid: 0 };
      }
      if (s.includes('INSERT INTO refresh_history')) {
        const [id, started_at] = params as [string, string];
        history.set(id, {
          id,
          started_at,
          completed_at: null,
          status: 'running',
          sources_processed: 0,
          error_message: null,
        });
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (s.includes('UPDATE refresh_history')) {
        const [completed_at, status, sources_processed, error_message, id] = params as [string, string, number, string | null, string];
        const row = history.get(id);
        if (row) {
          row.completed_at = completed_at;
          row.status = status;
          row.sources_processed = sources_processed;
          row.error_message = error_message;
        }
        return { changes: 1, lastInsertRowid: 0 };
      }
      if (s.includes('INSERT OR REPLACE INTO refresh_pass_state')) {
        const [pass_id, source_type, source_id, last_processed_hash] = params as [string, string, string, string];
        passState.set(`${pass_id}:${source_type}:${source_id}`, last_processed_hash);
        return { changes: 1, lastInsertRowid: 0 };
      }
      return { changes: 0, lastInsertRowid: 0 };
    }),
    get: vi.fn(async () => null),
    all: vi.fn(async (sql: string, params?: unknown[]) => {
      const s = String(sql);
      // Change detection query
      if (s.includes('FROM semantic_graph_sources s') && s.includes('refresh_pass_state')) {
        const [passId] = params as [string];
        const result: any[] = [];
        for (const [key, hash] of sources.entries()) {
          const [type, id] = key.split(':');
          const last = passState.get(`${passId}:${type}:${id}`);
          if (last !== hash) {
            result.push({
              source_type: type,
              source_id: id,
              current_hash: hash,
              last_processed_hash: last ?? null,
            });
          }
        }
        return result;
      }
      if (s.includes('FROM refresh_history')) {
        const limit = (params as [number])?.[0] ?? 10;
        return Array.from(history.values())
          .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))
          .slice(0, limit);
      }
      return [];
    }),
    runTransaction: vi.fn(async () => []),
  };
  return db;
}

function makePass(overrides: Partial<RefreshPass> = {}): RefreshPass {
  return {
    id: 'test-pass',
    displayName: 'Test Pass',
    run: vi.fn(async (ctx: RefreshContext) => {
      for (const c of ctx.changedSources) {
        await ctx.markProcessed(c.sourceType, c.sourceId, c.currentHash);
      }
    }),
    ...overrides,
  };
}

describe('MindMapRefreshOrchestrator', () => {
  let db: MockDb;
  let orchestrator: MindMapRefreshOrchestrator;

  beforeEach(() => {
    db = createMockDb();
    orchestrator = new MindMapRefreshOrchestrator(db as any);
  });

  it('starts idle with no passes and no active refresh', () => {
    const status = orchestrator.getStatus();
    expect(status.isRefreshing).toBe(false);
    expect(status.activePassId).toBe(null);
    expect(orchestrator.getRegisteredPasses()).toHaveLength(0);
  });

  it('registerPass adds the pass and dispose removes it', () => {
    const pass = makePass();
    const disposable = orchestrator.registerPass(pass);
    expect(orchestrator.getRegisteredPasses()).toEqual([{ id: 'test-pass', displayName: 'Test Pass' }]);
    disposable.dispose();
    expect(orchestrator.getRegisteredPasses()).toHaveLength(0);
  });

  it('registering the same pass id twice replaces the prior registration', () => {
    const pass1 = makePass({ displayName: 'First' });
    const pass2 = makePass({ displayName: 'Second' });
    orchestrator.registerPass(pass1);
    orchestrator.registerPass(pass2);
    expect(orchestrator.getRegisteredPasses()).toEqual([{ id: 'test-pass', displayName: 'Second' }]);
  });

  it('preview reports per-pass changed source counts', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    db.refreshPassState.set('test-pass:page_block:a', 'hash-a'); // a is unchanged

    orchestrator.registerPass(makePass());
    const preview = await orchestrator.preview();
    expect(preview.perPass).toEqual([
      { passId: 'test-pass', displayName: 'Test Pass', sourcesChanged: 1 },
    ]);
    expect(preview.sourcesChanged).toBe(1);
  });

  it('preview returns null estimated seconds when not every pass provides estimateSecondsPerSource', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    orchestrator.registerPass(makePass({ id: 'p1', estimateSecondsPerSource: () => 5 }));
    orchestrator.registerPass(makePass({ id: 'p2' })); // no estimate
    const preview = await orchestrator.preview();
    expect(preview.estimatedSeconds).toBe(null);
  });

  it('preview returns summed estimated seconds when every pass provides estimates', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');
    orchestrator.registerPass(makePass({ id: 'p1', estimateSecondsPerSource: () => 5 }));
    orchestrator.registerPass(makePass({ id: 'p2', estimateSecondsPerSource: () => 10 }));
    const preview = await orchestrator.preview();
    // 2 changes × (5 + 10) seconds/source = 30
    expect(preview.estimatedSeconds).toBe(30);
  });

  it('startRefresh iterates passes in registration order and writes a history row', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');

    const order: string[] = [];
    orchestrator.registerPass(
      makePass({ id: 'p1', run: vi.fn(async () => { order.push('p1'); }) }),
    );
    orchestrator.registerPass(
      makePass({ id: 'p2', run: vi.fn(async () => { order.push('p2'); }) }),
    );

    const result = await orchestrator.startRefresh();
    expect(order).toEqual(['p1', 'p2']);
    expect(result.status).toBe('completed');

    const history = await orchestrator.getRefreshHistory(5);
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('completed');
    expect(history[0].refreshId).toBe(result.refreshId);
  });

  it('markProcessed updates refresh_pass_state so the next preview sees the source as unchanged', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');

    orchestrator.registerPass(makePass()); // default pass marks every changed source as processed
    await orchestrator.startRefresh();

    const preview = await orchestrator.preview();
    expect(preview.sourcesChanged).toBe(0);
  });

  it('cancelRefresh aborts mid-pass and the result reports cancelled status', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    db.semanticGraphSources.set('page_block:b', 'hash-b');

    let resolveAfterFirstPass: () => void = () => {};
    const firstPassRan = new Promise<void>((resolve) => { resolveAfterFirstPass = resolve; });

    orchestrator.registerPass(
      makePass({
        id: 'p1',
        run: async () => { resolveAfterFirstPass(); },
      }),
    );
    orchestrator.registerPass(
      makePass({
        id: 'p2',
        run: async () => {
          // Should not run after cancellation
          throw new Error('p2 should not have run');
        },
      }),
    );

    const refreshPromise = orchestrator.startRefresh();
    await firstPassRan;
    orchestrator.cancelRefresh();
    const result = await refreshPromise;
    expect(result.status).toBe('cancelled');
  });

  it('startRefresh rejects when a refresh is already running', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');

    let release: () => void = () => {};
    const releasePromise = new Promise<void>((resolve) => { release = resolve; });
    orchestrator.registerPass(
      makePass({
        id: 'slow',
        run: async () => { await releasePromise; },
      }),
    );

    const first = orchestrator.startRefresh();
    await expect(orchestrator.startRefresh()).rejects.toThrow(/already running/);
    release();
    await first;
  });

  it('emits onDidChangeStatus events when a refresh starts and ends', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');

    const statuses: boolean[] = [];
    const subscription = orchestrator.onDidChangeStatus((s) => statuses.push(s.isRefreshing));
    orchestrator.registerPass(makePass());

    await orchestrator.startRefresh();
    subscription.dispose();

    // Should have at least one true followed by a false
    expect(statuses.some((v) => v === true)).toBe(true);
    expect(statuses[statuses.length - 1]).toBe(false);
  });

  it('errors thrown by a pass mark the refresh as error and surface the message', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    orchestrator.registerPass(
      makePass({
        id: 'p1',
        run: async () => { throw new Error('boom'); },
      }),
    );

    const result = await orchestrator.startRefresh();
    expect(result.status).toBe('error');
    expect(result.errorMessage).toContain('boom');

    const history = await orchestrator.getRefreshHistory(5);
    expect(history[0].status).toBe('error');
    expect(history[0].errorMessage).toContain('boom');
  });

  it('getRefreshHistory caps to a sane limit even when called with a huge number', async () => {
    db.semanticGraphSources.set('page_block:a', 'hash-a');
    orchestrator.registerPass(makePass());
    await orchestrator.startRefresh();
    const history = await orchestrator.getRefreshHistory(10_000_000);
    // Mock doesn't actually cap, but the orchestrator should pass at most 100 to db.all.
    const lastAllCall = db.all.mock.calls[db.all.mock.calls.length - 1];
    expect(lastAllCall[1][0]).toBeLessThanOrEqual(100);
    expect(history.length).toBeGreaterThan(0);
  });
});
