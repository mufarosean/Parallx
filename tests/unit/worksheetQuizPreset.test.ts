// @vitest-environment jsdom
// worksheetQuizPreset.test.ts — a set handed to the quiz builder (a paper's
// problems from another tool's bar, the Problem Bank's "Quiz These…", a band
// from the dashboard) is taken by the builder, whether it is made for it or
// already open, and is taken once.

import { describe, it, expect, vi, afterEach } from 'vitest';

const item = (id: number, paper: string) => ({
  id, title: `P${id}`, paper, source: 'rf', kind: 'quant', tags: '', quadrant: 0, attemptState: '', attemptCount: 0, seconds: 0, lastAttemptAt: 0,
  hasSheet: true, ratingImported: false, worked: false, starred: false, starredAt: 0, note: '', noteAt: 0,
});
const BANK = [item(1, 'clark'), item(2, 'clark'), item(3, 'clark'), item(4, 'mack1994'), item(5, 'mack1994'), item(6, 'friedland')];

vi.mock('../../src/built-in/worksheet/worksheetData.js', async (orig) => ({
  ...(await orig<object>()),
  listItems: vi.fn(async () => BANK),
}));

import { createPracticeConfigPane } from '../../src/built-in/worksheet/panes/practiceConfigPane.js';
import { openBuilderWith } from '../../src/built-in/worksheet/actions.js';
import { quizPresetListeners, state } from '../../src/built-in/worksheet/state.js';

const wait = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
let panes: { dispose(): void }[] = [];
afterEach(() => { for (const p of panes) p.dispose(); panes = []; state.quizPreset = null; state.api = null; document.body.innerHTML = ''; });

async function builder() {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const pane = createPracticeConfigPane(host);
  panes.push(pane);
  await wait(); await wait();
  return {
    host, pane,
    matching: () => host.querySelector('.ws-builder__count')!.textContent,
    from: () => [...host.querySelectorAll<HTMLElement>('[aria-label="From"] .px-chip, [aria-label="From"] button')].map((b) => b.textContent!.replace(/\s+/g, ' ').trim()).filter(Boolean),
    length: () => (host.querySelector('.ws-stepper__value') as HTMLInputElement).value,
    name: () => (host.querySelector('.ws-input') as HTMLInputElement).value,
  };
}

describe('the quiz builder and a set handed to it', () => {
  it('a builder made for a set opens on it, and the set is taken once', async () => {
    openBuilderWith({ ids: [1, 2], name: 'Clark Hard' });
    const b = await builder();
    expect([b.matching(), b.length(), b.name()]).toEqual(['2', '2', 'Clark Hard']);
    expect(b.from().join(' ')).toMatch(/Clark Hard/);
    expect(state.quizPreset).toBeNull();
    // The next builder starts clean.
    b.pane.dispose();
    const next = await builder();
    expect(next.matching()).toBe('6');
    expect(next.from()).toEqual([]);
  });

  it('a builder that is already open takes a new set in place of what it had chosen', async () => {
    openBuilderWith({ ids: [1, 2], name: 'Clark Hard' });
    const b = await builder();
    const opened = vi.fn(async () => {});
    state.api = { editors: { openEditor: opened } } as never;
    openBuilderWith({ ids: [4, 5, 6], name: 'Mack (1994) Not rated' });
    expect([b.matching(), b.length(), b.name()]).toEqual(['3', '3', 'Mack (1994) Not rated']);
    expect(b.from().join(' ')).toMatch(/Mack \(1994\) Not rated/);
    expect(b.from().join(' ')).not.toMatch(/Clark Hard/);
    // Taken once, by the builder that showed it, and its tab is brought forward.
    expect(state.quizPreset).toBeNull();
    expect(opened).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'practice' }));
    // A band from the dashboard replaces the set, it does not narrow it.
    openBuilderWith({ papers: ['clark'], state: 'unseen' });
    expect(b.matching()).toBe('3');
    expect(b.from()).toEqual([]);
    expect(b.host.querySelector('[role="radio"][aria-checked="true"]')!.textContent).toBe('Never tried');
  });

  it('a builder still reading the bank takes the set when it has, and one that is gone listens no more', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const pane = createPracticeConfigPane(host);
    openBuilderWith({ ids: [6], name: 'Friedland' });
    await wait(); await wait();
    expect(host.querySelector('.ws-builder__count')!.textContent).toBe('1');
    expect(state.quizPreset).toBeNull();
    pane.dispose();
    expect(quizPresetListeners.size).toBe(0);
  });
});
