// conceptLabProgress.test.ts — Concept Lab keeps, per workspace, the step
// each module is on and the predictions answered, and says where it stands.
import { describe, it, expect, beforeEach } from 'vitest';
// @ts-expect-error — JS module with no types
import { clNoteProgress, clProgress, clStanding, clStandingText, setProgressStore } from '../../ext/concept-lab/progress.js';

const mod = { id: 'brosius-line', story: [{ title: 'a' }, { title: 'b', predict: {} }, { title: 'c' }, { title: 'd', predict: {} }] };

describe('concept lab progress', () => {
  let saved: Map<string, unknown>;
  beforeEach(() => {
    saved = new Map();
    setProgressStore({ get: (k: string) => saved.get(k), update: async (k: string, v: unknown) => { saved.set(k, v); } });
  });

  it('remembers the step and answers, and which module was last', () => {
    clNoteProgress(mod, { storyIndex: 2, predictAnswers: { 1: 0 } });
    const p = clProgress();
    expect(p.last).toBe('brosius-line');
    expect(p.modules['brosius-line']).toMatchObject({ step: 2, answers: { 1: 0 } });
  });

  it('says where a module stands', () => {
    expect(clStandingText(clStanding(mod, undefined))).toBe('Not started');
    expect(clStandingText(clStanding(mod, { step: 2, answers: { 1: 0 } }))).toBe('Step 3 of 4, 1 of 2 predictions answered');
    const done = clStanding(mod, { step: 1, answers: { 1: 0, 3: 2 } });
    expect(done.done).toBe(true);
    expect(clStandingText(done)).toBe('Done, 2 of 2 predictions answered');
    expect(clStanding(mod, { step: 99, answers: {} }).step).toBe(3); // a step past the end (the module shrank) is its last
    const noPredicts = { id: 'x', story: [{ title: 'a' }, { title: 'b' }] };
    expect(clStandingText(clStanding(noPredicts, { step: 1, answers: {} }))).toBe('Done');
  });

  it('keeps nothing without a workspace, and reads bad data as none', () => {
    setProgressStore(null);
    clNoteProgress(mod, { storyIndex: 1, predictAnswers: {} });
    expect(clProgress()).toEqual({ last: null, modules: {} });
    setProgressStore({ get: () => 'garbage', update: async () => {} });
    expect(clProgress()).toEqual({ last: null, modules: {} });
  });
});
