// pageEditSignals.test.ts — editing a page wakes the heartbeat: one signal per
// page per ten minutes, the user's, not learned as a habit.
import { describe, it, expect } from 'vitest';
import { PAGE_EDIT_SIGNAL_GAP_MS, registerPageEditSignals } from '../../src/built-in/canvas/pageEditSignals';
import { normalizeAutonomySignal } from '../../src/services/autonomySignalService';

describe('page edits wake the heartbeat', () => {
  it('signals each page once per gap, as the user\'s ongoing work', () => {
    let fire: ((e: { pageId: string; page: { title: string } }) => void) | undefined;
    const sent: Record<string, unknown>[] = [];
    let t = 1_000_000;
    const d = registerPageEditSignals((fn) => { fire = fn as never; return { dispose() { fire = undefined; } }; }, (p) => sent.push(p), () => t);
    fire!({ pageId: 'a', page: { title: 'Clark notes' } });
    fire!({ pageId: 'a', page: { title: 'Clark notes' } }); // the same typing session
    fire!({ pageId: 'b', page: { title: '' } });
    t += PAGE_EDIT_SIGNAL_GAP_MS;
    fire!({ pageId: 'a', page: { title: 'Clark notes' } });
    expect(sent.map((s) => s.title)).toEqual(['edited page "Clark notes"', 'edited page "Untitled"', 'edited page "Clark notes"']);
    expect(normalizeAutonomySignal(sent[0])).toMatchObject({ source: 'canvas', kind: 'page-edited', actor: 'user', habit: false, severity: 'info' });
    d.dispose();
    expect(fire).toBeUndefined();
  });

  it('a signal that does not say habit: false may still be learned', () => {
    expect(normalizeAutonomySignal({ title: 'created page "X"', source: 'canvas' })).not.toHaveProperty('habit');
  });
});
