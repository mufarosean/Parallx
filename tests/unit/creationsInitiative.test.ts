// @vitest-environment jsdom
// Creations AI: initiative (ext/creations-ai/initiative.js) and off-screen
// life (since-then.js). A character can open a chat from their own day;
// Auto-direct lets the director pick a note when the player wrote none,
// by latitude; and when the Narrator moves the story on, one line per
// character is proposed for the Timeline, kept or dropped before it lands.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { openingNote, pickDirection } from '../../ext/creations-ai/initiative.js';
import {
  sceneMovedOn, whoLivedThrough, buildSinceThenMessages, parseSinceThen, sinceThenLine, mountSinceThen, sinceThenCommand,
// @ts-expect-error — JS module with no types
} from '../../ext/creations-ai/since-then.js';

describe('a character opens', () => {
  it('asks for a first turn from the middle of their day, toward the player who has just arrived', () => {
    const note = openingNote('Ada', 'Alex');
    expect(note).toContain('where Ada is and what Ada is doing');
    expect(note).toContain('toward Alex, who has just arrived');
    expect(note).toContain('Nothing for Alex to have said yet');
  });
});

describe('auto-direct', () => {
  const groups = [
    { name: 'Ada', options: [{ kind: 'push', text: 'Asks him' }, { kind: 'complicate', text: 'Hides the letter' }, { kind: 'move', text: 'Leaves' }] },
    { name: 'Tom', options: [] },
  ];
  it('Tight takes the first kind; Loose and Open take any; nobody gets nothing', () => {
    expect(pickDirection(groups, 'Ada', { latitude: 'tight', random: () => 0.99 }).text).toBe('Asks him');
    expect(pickDirection(groups, 'ada', { latitude: 'loose', random: () => 0.5 }).text).toBe('Hides the letter');
    expect(pickDirection(groups, 'Ada', { latitude: 'open', random: () => 0.99 }).text).toBe('Leaves');
    expect(pickDirection(groups, 'Tom', { latitude: 'open' })).toBeNull();
    expect(pickDirection(groups, 'Vera', { latitude: 'open' })).toBeNull();
    expect(pickDirection(null, 'Ada')).toBeNull();
  });
});

describe('since then', () => {
  it('fires only when a known scene changes place or time', () => {
    expect(sceneMovedOn({ location: 'the kitchen', time: 'night' }, { location: 'the harbour', time: 'night' })).toBe(true);
    expect(sceneMovedOn({ location: 'the kitchen' }, { location: 'the kitchen', time: 'dawn' })).toBe(true);
    expect(sceneMovedOn({ location: 'the kitchen', time: 'night' }, { location: 'the kitchen', time: 'night', mood: 'tense' })).toBe(false);
    expect(sceneMovedOn({}, { location: 'the harbour' })).toBe(false);
    expect(sceneMovedOn(null, { location: 'x' })).toBe(false);
  });
  it('the cast present lived through it, else everyone, never the player\'s own character', () => {
    const cast = [{ name: 'Ada' }, { name: 'Tom' }, { name: 'Vera' }];
    expect(whoLivedThrough(cast, { present: ['tom', 'Vera'] }).map((c: any) => c.name)).toEqual(['Tom', 'Vera']);
    expect(whoLivedThrough(cast, { present: ['Nobody Here'] }).map((c: any) => c.name)).toEqual(['Ada', 'Tom', 'Vera']);
    expect(whoLivedThrough(cast, null, 'Tom').map((c: any) => c.name)).toEqual(['Ada', 'Vera']);
  });
  it('asks for one past-tense line per character as JSON and reads it back, dashes stripped', () => {
    const [system, user] = buildSinceThenMessages({
      cast: [{ name: 'Ada', drives: 'the ledger', relationships: 'Tom: brother' }, { name: 'Vera' }],
      before: { location: 'the kitchen', time: 'night' }, after: { location: 'the harbour', time: 'dawn, three days on' },
      memory: { facts: [{ text: 'Tom owes the bank.' }] }, lastTurn: 'Three days pass.',
    });
    expect(system.content).toContain('{"since": [{"name": "Ada", "line": "..."}, {"name": "Vera", "line": "..."}]}');
    expect(user.content).toContain('The scene was: the kitchen, night\nThe scene is now: the harbour, dawn, three days on');
    expect(user.content).toContain('Three days pass.');
    expect(user.content).toContain('- Ada: wants the ledger People: Tom: brother');
    expect(parseSinceThen('{"since":[{"name":"vera","line":"Sold the boat — at a loss."},{"name":"Ada","line":"  Wrote to Tom twice.  "}]}', ['Ada', 'Vera']))
      .toEqual([{ name: 'Ada', text: 'Wrote to Tom twice.' }, { name: 'Vera', text: 'Sold the boat, at a loss.' }]);
    expect(parseSinceThen('nothing', ['Ada'])).toEqual([]);
    expect(sinceThenLine('Ada', 'Wrote to Tom twice.')).toBe('Since then, Ada: Wrote to Tom twice.');
  });
  it('the proposal in the panel: a toggle per line, Apply keeps what is on, Dismiss writes nothing', () => {
    const host = document.createElement('div');
    const applied: any[] = [];
    let dismissed = 0;
    const toggles: { onChange: (v: boolean) => void }[] = [];
    const ui = {
      renderMarkdown: (md: string) => { const d = document.createElement('div'); d.textContent = md; return d; },
      createToggle: (c: HTMLElement, o: any) => { toggles.push(o); const l = document.createElement('label'); l.textContent = o.label; c.appendChild(l); return { element: l, checked: true, dispose() {} }; },
      createButton: (c: HTMLElement, o: any) => { const b = document.createElement('button'); b.textContent = o.label; b.dataset.command = `${o.command} ${JSON.stringify(o.args)}`; c.appendChild(b); return b; },
    };
    const mount = () => mountSinceThen(host, { threadId: 't1', lines: [{ name: 'Ada', text: 'Wrote to Tom.' }, { name: 'Vera', text: 'Sold the boat.' }], ui, onApply: (kept: any[]) => applied.push(kept), onDismiss: () => { dismissed++; } });
    mount();
    expect([...host.querySelectorAll('label')].map((l) => l.textContent)).toEqual(['Ada: Wrote to Tom.', 'Vera: Sold the boat.']);
    expect([...host.querySelectorAll('button')].map((b) => b.dataset.command)).toEqual(['textGenerator.chat.sinceThen.apply ["t1"]', 'textGenerator.chat.sinceThen.dismiss ["t1"]']);
    toggles[1].onChange(false);
    sinceThenCommand('apply', 't1');
    expect(applied).toEqual([[{ name: 'Ada', text: 'Wrote to Tom.' }]]);
    // A proposal is spent once acted on; a new mount is a new proposal.
    expect(sinceThenCommand('dismiss', 't1')).toBeUndefined();
    mount();
    sinceThenCommand('dismiss', 't1');
    expect(dismissed).toBe(1);
  });
});
