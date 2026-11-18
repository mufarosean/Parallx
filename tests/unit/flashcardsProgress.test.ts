// flashcardsProgress.test.ts — Flashcards' cards as progress any tool can show.
//
// ext/flashcards/progress.js: a card's state is its last rating (Good or Easy
// good, Hard middling, Again poor, never reviewed the rest); the groups are
// every tag and every deck; the provider registers through the core command
// with a retry and leaves with the extension.

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — JS module with no types
import { FC_PROGRESS_WORDS, FC_PROGRESS_SQL, fcProgressState, fcProgressGroups, fcProgressProvider, fcWithRegistry } from '../../ext/flashcards/progress.js';
import { registerProgressProvider, listProgressProviders, progressCounts } from '../../src/services/progressProviders.js';

type Row = { tags: string; deck_id: number; deck_name: string; last_rating: number | null };
const row = (tags: string, deck: [number, string], last: number | null): Row => ({ tags, deck_id: deck[0], deck_name: deck[1], last_rating: last });
const MAIN: [number, string] = [1, 'Exam 7 Cards'];
const VENTER: [number, string] = [2, 'VENTER'];

describe('fcProgressState', () => {
  it('reads the last rating: 4 Easy and 3 Good are good, 2 Hard middling, 1 Again poor, none the rest', () => {
    expect([4, 3, 2, 1, null, undefined, 0, 'x'].map(fcProgressState)).toEqual(['good', 'good', 'middling', 'poor', 'rest', 'rest', 'rest', 'rest']);
  });
});

describe('fcProgressGroups', () => {
  const rows = [
    row('mack', MAIN, 3), row('mack', MAIN, 4), row('mack', MAIN, 2), row('mack', MAIN, 1), row('mack', MAIN, null),
    row('clark, Mack', MAIN, 3), row('', MAIN, null),
    row('', VENTER, 1), row('', VENTER, 1), row('', VENTER, 2), row('', VENTER, null),
  ];
  const groups = fcProgressGroups(rows);
  const of = (label: string) => groups.find((g: { label: string }) => g.label === label);

  it('has a group for every tag and every deck, tags first, each in name order', () => {
    expect(groups.map((g: { group: string }) => g.group)).toEqual(['tag:clark', 'tag:mack', 'deck:1', 'deck:2']);
    expect(groups.map((g: { label: string }) => g.label)).toEqual(['clark', 'mack', 'Exam 7 Cards', 'VENTER']);
  });

  it('counts a tag whatever its case, and a card in each of its tags', () => {
    expect(of('mack')).toEqual({ group: 'tag:mack', label: 'mack', total: 6, good: 3, middling: 1, poor: 1 });
    expect(of('clark')).toEqual({ group: 'tag:clark', label: 'clark', total: 1, good: 1, middling: 0, poor: 0 });
  });

  it('counts a deck over all its cards', () => {
    expect(of('VENTER')).toEqual({ group: 'deck:2', label: 'VENTER', total: 4, good: 0, middling: 1, poor: 2 });
    expect(progressCounts(of('VENTER'))).toEqual([0, 1, 2, 1]);
    expect(of('Exam 7 Cards').total).toBe(7);
  });

  it('gives nothing for no cards', () => {
    expect(fcProgressGroups([])).toEqual([]);
    expect(fcProgressGroups(null)).toEqual([]);
  });
});

describe('the query', () => {
  it('takes each card\'s latest review, and leaves out suspended cards and archived decks', () => {
    expect(FC_PROGRESS_SQL).toMatch(/ORDER BY reviewed_at DESC, id DESC/);
    expect(FC_PROGRESS_SQL).toMatch(/c\.suspended = 0/);
    expect(FC_PROGRESS_SQL).toMatch(/d\.archived = 0/);
  });
});

describe('fcProgressProvider', () => {
  const make = () => {
    const listeners = new Set<() => void>();
    const all = vi.fn(async () => [row('mack', MAIN, 3), row('mack', MAIN, null)]);
    const provider = fcProgressProvider({ all, onDidChange: (l: () => void) => { listeners.add(l); return { dispose: () => { listeners.delete(l); } }; } });
    return { provider, listeners, all };
  };

  it('is a provider of Cards in Flashcards\' own words, with no open (it has no screen for cards by last rating)', async () => {
    const { provider, all } = make();
    expect(provider.id).toBe('flashcards.cards');
    expect(provider.displayName).toBe('Cards');
    expect(provider.toolId).toBe('parallx-community.flashcards');
    expect(provider.words).toEqual(FC_PROGRESS_WORDS);
    expect(FC_PROGRESS_WORDS).toEqual({ good: 'Good or Easy', middling: 'Hard', poor: 'Again', rest: 'Not reviewed' });
    expect(provider.open).toBeUndefined();
    expect(await provider.groups()).toEqual([
      { group: 'tag:mack', label: 'mack', total: 2, good: 1, middling: 0, poor: 0 },
      { group: 'deck:1', label: 'Exam 7 Cards', total: 2, good: 1, middling: 0, poor: 0 },
    ]);
    expect(all).toHaveBeenCalledWith(FC_PROGRESS_SQL);
  });

  it('passes on the data change and is accepted by the core registry', () => {
    const { provider, listeners } = make();
    const heard = vi.fn();
    const sub = provider.onDidChange(heard);
    for (const l of listeners) l();
    expect(heard).toHaveBeenCalledOnce();
    sub.dispose();
    expect(listeners.size).toBe(0);
    const reg = registerProgressProvider(provider);
    expect(listProgressProviders().some((p) => p.id === 'flashcards.cards')).toBe(true);
    reg.dispose();
  });
});

describe('fcWithRegistry', () => {
  const tick = () => new Promise<void>((r) => setTimeout(r, 0));

  it('hands over the registry the command returns', async () => {
    const registry = { register: vi.fn() };
    const api = { commands: { executeCommand: vi.fn(async () => registry) } };
    const use = vi.fn();
    fcWithRegistry(api, 'progress.getRegistry', () => true, use);
    await tick();
    expect(api.commands.executeCommand).toHaveBeenCalledWith('progress.getRegistry');
    expect(use).toHaveBeenCalledWith(registry);
  });

  it('tries again while the command is not there yet, six times in all, and never once the extension is off', async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const api = { commands: { executeCommand: vi.fn(async () => { calls += 1; throw new Error('no such command'); }) } };
      const use = vi.fn();
      fcWithRegistry(api, 'progress.getRegistry', () => true, use);
      for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(2000);
      expect(calls).toBe(6);
      expect(use).not.toHaveBeenCalled();

      calls = 0;
      let live = true;
      fcWithRegistry(api, 'progress.getRegistry', () => live, use);
      await vi.advanceTimersByTimeAsync(0);
      live = false;
      for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(2000);
      expect(calls).toBe(1);

      // Turned off while the command was answering: nothing is handed over.
      live = false;
      const late = { commands: { executeCommand: vi.fn(async () => ({ register: vi.fn() })) } };
      fcWithRegistry(late, 'progress.getRegistry', () => live, use);
      await vi.advanceTimersByTimeAsync(0);
      expect(use).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});

describe('ext/flashcards/main.js', () => {
  it('registers the provider through the core command, into its subscriptions', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const main = readFileSync(resolve(__dirname, '../../ext/flashcards/main.js'), 'utf8');
    expect(main).toMatch(/fcWithRegistry\(_api, 'progress\.getRegistry'/);
    expect(main).toMatch(/context\.subscriptions\.push\(registry\.register\(fcProgressProvider\(/);
  });
});
