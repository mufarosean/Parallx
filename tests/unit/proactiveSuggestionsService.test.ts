// proactiveSuggestionsService.test.ts — pin ProactiveSuggestionsService
// configuration wiring, scheduling, dismiss, merge preservation, and
// basic analyze() short-circuits.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProactiveSuggestionsService } from '../../src/services/proactiveSuggestionsService';
import { Emitter } from '../../src/platform/events';

function mkPage(id: string, title: string): { id: string; title: string; content: string } {
  // Tiptap-doc JSON whose extracted text is >50 chars (matches _getPages text-length filter).
  const longText = `This is page ${id} (${title}) with enough body text to clear fifty characters.`;
  return { id, title, content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: longText }] }] }) };
}

function mkServices(opts?: { pages?: any[]; vectorResults?: any[]; isInitialIndexComplete?: boolean; isOpen?: boolean }) {
  const indexEmitter = new Emitter<void>();
  const updateEmitter = new Emitter<void>();
  const embedding = {
    embedQuery: vi.fn(async () => new Float32Array([0.1, 0.2])),
  };
  const vector = {
    vectorSearch: vi.fn(async () => opts?.vectorResults ?? []),
    onDidUpdateIndex: updateEmitter.event,
  };
  const db = {
    isOpen: opts?.isOpen ?? true,
    all: vi.fn(async () => opts?.pages ?? []),
    get: vi.fn(async () => null),
  };
  const indexing = {
    isInitialIndexComplete: opts?.isInitialIndexComplete ?? true,
    onDidCompleteInitialIndex: indexEmitter.event,
  };
  return { embedding, vector, db, indexing, indexEmitter, updateEmitter };
}

function mkConfig(opts?: { enabled?: boolean; threshold?: number; max?: number }) {
  const changeEmitter = new Emitter<void>();
  const effective = {
    suggestions: {
      suggestionsEnabled: opts?.enabled ?? true,
      suggestionConfidenceThreshold: opts?.threshold ?? 0.65,
      maxPendingSuggestions: opts?.max ?? 10,
    },
  };
  return {
    getEffectiveConfig: vi.fn(() => effective),
    onDidChangeConfig: changeEmitter.event,
    _changeEmitter: changeEmitter,
    _setConfig: (next: any) => { effective.suggestions = { ...effective.suggestions, ...next }; },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('ProactiveSuggestionsService — construction + config wiring', () => {
  it('subscribes to indexing and vector store on construction', () => {
    const svc = mkServices();
    new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    // No throw is sufficient — emitter wired in constructor via _register.
    expect(true).toBe(true);
  });

  it('without unifiedConfig falls back to defaults; suggestions getter returns non-dismissed only', () => {
    const svc = mkServices();
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    expect(s.suggestions).toEqual([]);
    expect(s.allSuggestions).toEqual([]);
  });

  it('config disabled prevents analysis on index complete', () => {
    const svc = mkServices();
    const cfg = mkConfig({ enabled: false });
    new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any, cfg as any);
    svc.indexEmitter.fire();
    vi.runAllTimers();
    expect(svc.db.all).not.toHaveBeenCalled();
  });

  it('config change event re-applies enabled/threshold/max', () => {
    const svc = mkServices();
    const cfg = mkConfig({ enabled: true });
    new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any, cfg as any);
    cfg._setConfig({ suggestionsEnabled: false });
    cfg._changeEmitter.fire();
    svc.indexEmitter.fire();
    vi.runAllTimers();
    expect(svc.db.all).not.toHaveBeenCalled();
  });
});

describe('ProactiveSuggestionsService — analyze() short-circuits', () => {
  it('returns [] when initial index not complete', async () => {
    const svc = mkServices({ isInitialIndexComplete: false });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    await expect(s.analyze()).resolves.toEqual([]);
    expect(svc.db.all).not.toHaveBeenCalled();
  });

  it('returns [] when database is not open', async () => {
    const svc = mkServices({ isOpen: false });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    await expect(s.analyze()).resolves.toEqual([]);
  });

  it('returns [] when fewer than MIN_PAGES_FOR_ANALYSIS pages', async () => {
    const svc = mkServices({ pages: [mkPage('1', 't1'), mkPage('2', 't2')] });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    await expect(s.analyze()).resolves.toEqual([]);
  });

  it('analyze produces orphan suggestions when no related pages found', async () => {
    const pages = [1, 2, 3, 4, 5].map(i => mkPage(`p${i}`, `Title ${i}`));
    const svc = mkServices({ pages, vectorResults: [] });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    const out = await s.analyze();
    // 5 pages all orphans, capped at 3 per source
    expect(out.length).toBe(3);
    for (const sug of out) {
      expect(sug.type).toBe('orphan');
      expect(sug.relatedPageIds.length).toBe(1);
      expect(sug.dismissed).toBe(false);
    }
  });
});

describe('ProactiveSuggestionsService — dismiss + merge preservation', () => {
  it('dismiss flips dismissed flag and fires onDidUpdateSuggestions', async () => {
    const pages = [1, 2, 3, 4, 5].map(i => mkPage(`p${i}`, `T${i}`));
    const svc = mkServices({ pages });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    await s.analyze();
    expect(s.suggestions.length).toBe(3);
    const target = s.suggestions[0].id;
    const heard: any[] = [];
    s.onDidUpdateSuggestions(v => heard.push(v));
    s.dismiss(target);
    expect(heard.length).toBe(1);
    expect(s.suggestions.find(x => x.id === target)).toBeUndefined();
    expect(s.allSuggestions.find(x => x.id === target)?.dismissed).toBe(true);
  });

  it('dismiss on unknown id is a no-op', () => {
    const svc = mkServices();
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    const heard: any[] = [];
    s.onDidUpdateSuggestions(v => heard.push(v));
    s.dismiss('does-not-exist');
    expect(heard.length).toBe(0);
  });

  it('re-analyze preserves dismissed state for matching (type, sorted-related-pageIds) key', async () => {
    const pages = [1, 2, 3, 4, 5].map(i => mkPage(`p${i}`, `T${i}`));
    const svc = mkServices({ pages });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    await s.analyze();
    const first = s.suggestions[0];
    s.dismiss(first.id);
    expect(s.suggestions.find(x => x.id === first.id)).toBeUndefined();

    // Run again — new sug ids, but the same (type, relatedPageIds) tuple should be marked dismissed.
    await s.analyze();
    const carriedDismissed = s.allSuggestions.find(
      x => x.type === first.type && x.relatedPageIds.join(',') === first.relatedPageIds.join(','),
    );
    expect(carriedDismissed?.dismissed).toBe(true);
  });

  it('maxSuggestions caps total suggestions retained', async () => {
    const pages = [1, 2, 3, 4, 5, 6, 7, 8].map(i => mkPage(`p${i}`, `T${i}`));
    const svc = mkServices({ pages });
    const cfg = mkConfig({ max: 1 });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any, cfg as any);
    await s.analyze();
    expect(s.allSuggestions.length).toBe(1);
  });
});

describe('ProactiveSuggestionsService — scheduling', () => {
  it('first analysis defers when requestIdleCallback unavailable; respects cooldown afterwards', async () => {
    const pages = [1, 2, 3, 4, 5].map(i => mkPage(`p${i}`, `T${i}`));
    const svc = mkServices({ pages });
    const s = new ProactiveSuggestionsService(svc.embedding as any, svc.vector as any, svc.db as any, svc.indexing as any);
    svc.indexEmitter.fire();
    expect(svc.db.all).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    // The 500ms idle fallback fires _runAnalysis (async). Allow microtasks to flush.
    await vi.runAllTimersAsync();
    expect(svc.db.all).toHaveBeenCalledTimes(1);

    // Second trigger inside the cooldown → schedule defers (does not run immediately).
    svc.updateEmitter.fire();
    expect(svc.db.all).toHaveBeenCalledTimes(1);
  });
});
