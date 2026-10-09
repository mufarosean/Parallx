// Creations AI: lorebooks in roleplay (ext/creations-ai/lore.js), 2026-10-09.
//
// The owner asked for the AI to respect a world's lore without all of it
// living in every prompt. Before: an entry came in only while a trigger word
// was in the last ten messages, matched as any substring ("rain" in "train");
// an entry without a triggers line was never sent (so a lorebook made from
// the template sent nothing), though Inspect said it was always on; what did
// not fire was invisible; an entry that overflowed was cut mid-sentence.
// Now every entry is in full or in a one-line index, keys match whole words,
// an entry stays a while after it was named, and nothing is cut.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { parseLorebook, keySaid, selectLore, renderLore, loreReport, DEFAULT_STICKY } from '../../ext/creations-ai/lore.js';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { assembleContext, chatLorebooks } = __testables;

const VALLEY = `---
name: The Valley
---

# The Valley

A river valley in the north, wet nine months of the year. The Ashbys have owned it for three hundred years.

## Blackstone Keep
triggers: blackstone, the keep
summary: the Ashby family's ruined fortress above the river
The keep burned in 1888. Its cellars still flood every spring, and nobody goes below after dark.

## Lord Ashby
priority: 8
Owns the valley and sells it a field at a time to pay his debts. He has not been to London in ten years.

## The Weir
anti: drought
sticky: 0
The weir below the mill is the only crossing in winter.

## The Hollow Folk
scope: character:Nell Hale
- They live under the hill.
- Only Nell has seen them.

## Rainfall
triggers: rain
It rains on the valley almost every day from September to May.
`;
const book = { fileName: 'valley.md', content: VALLEY };
const ada = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: 'Ada is a mathematician.' } };

describe('reading a lorebook', () => {
  it('takes the overview, each entry and its lines; without triggers an entry is called by its heading', () => {
    const entries = parseLorebook(VALLEY, 'valley.md');
    expect(entries.map((e: any) => e.heading)).toEqual(['The Valley', 'Blackstone Keep', 'Lord Ashby', 'The Weir', 'The Hollow Folk', 'Rainfall']);
    const [overview, keep, ashby, weir, folk] = entries;
    expect(overview).toMatchObject({ overview: true, scope: 'always', text: expect.stringMatching(/^A river valley in the north/) });
    expect(keep).toMatchObject({ keys: ['blackstone', 'the keep'], summary: 'the Ashby family\'s ruined fortress above the river', text: expect.stringMatching(/^The keep burned in 1888\./) });
    expect(ashby).toMatchObject({ keys: ['lord ashby'], priority: 8, summary: 'Owns the valley and sells it a field at a time to pay his debts.' });
    expect(weir).toMatchObject({ antiTriggers: ['drought'], sticky: 0 });
    expect(folk).toMatchObject({ scope: 'character:nell hale', summary: 'They live under the hill.' });
    // The frontmatter is not an entry.
    expect(entries.some((e: any) => e.text.includes('name: The Valley'))).toBe(false);
  });

  it('matches whole words, plurals and possessives, and a prefix when asked', () => {
    expect(keySaid('rain', 'It will rain tonight.')).toBe(true);
    expect(keySaid('rain', 'The train was late, my brain hurts.')).toBe(false);
    expect(keySaid('keep', 'The keeps of the north.')).toBe(true);
    expect(keySaid('lord ashby', "Lord  Ashby's dogs")).toBe(true);
    expect(keySaid('ash', 'She was ashamed.')).toBe(false);
    expect(keySaid('elf*', 'The elfin gate.')).toBe(true);
    expect(keySaid('elf*', 'Shelf.')).toBe(false);
    expect(keySaid('café', 'At the CAFÉ.')).toBe(true);
  });
});

describe('what a turn gets', () => {
  const msgs = (...t: string[]) => t;

  it('the overview always; an entry once its key is said, for a while after; the rest in brief', () => {
    const sel = selectLore([book], { messages: msgs('We ride for Blackstone at dawn.', ...Array(DEFAULT_STICKY).fill('...')) });
    const state = (h: string) => sel.find((x: any) => x.entry.heading === h).state;
    expect(state('The Valley')).toBe('always');
    expect(state('Blackstone Keep')).toBe('fired');
    expect(state('Lord Ashby')).toBe('index');
    expect(state('Rainfall')).toBe('index');
    // One message further and it is back to its line.
    const later = selectLore([book], { messages: msgs('We ride for Blackstone at dawn.', ...Array(DEFAULT_STICKY + 1).fill('...')) });
    expect(later.find((x: any) => x.entry.heading === 'Blackstone Keep').state).toBe('index');
    // An entry with no triggers line comes in when its name is said, in what is being sent now.
    expect(selectLore([book], { userText: 'Is Lord Ashby home?' }).find((x: any) => x.entry.heading === 'Lord Ashby')).toMatchObject({ state: 'fired', hits: ['lord ashby'], ago: 0 });
  });

  it('sticky 0 means only while said; an anti word hides it; a character scope needs that character', () => {
    const weir = (m: string[], u = '') => selectLore([book], { messages: m, userText: u }).find((x: any) => x.entry.heading === 'The Weir').state;
    expect(weir([], 'Cross at the weir.')).toBe('fired');
    expect(weir(['Cross at the weir.'], 'And then?')).toBe('index');
    expect(weir([], 'The weir in the drought.')).toBe('hidden');
    const folk = (names: string[]) => selectLore([book], { presentCharNames: names }).find((x: any) => x.entry.heading === 'The Hollow Folk').state;
    expect(folk(['Tom Hale'])).toBe('hidden');
    expect(folk(['Tom Hale', 'Nell Hale'])).toBe('always');
  });

  it('a template-made book sends its overview and every entry in brief (it sent nothing before)', () => {
    const template = __testables.LOREBOOK_TEMPLATE ?? null;
    const content = template || '# World\n\nThe overview.\n\n## Key Facts\n\n- Important fact about the world.';
    const r = renderLore(selectLore([{ fileName: 'new.md', content }], {}), Infinity);
    expect(r.text).not.toBe('');
    expect(r.full.length + r.brief.length).toBeGreaterThan(1);
  });
});

describe('the lore in the prompt', () => {
  it('in full what came up, by priority; everything else as one line; never cut mid-entry', () => {
    const sel = selectLore([book], { userText: 'Lord Ashby rode to Blackstone in the rain.' });
    const all = renderLore(sel, Infinity);
    expect(all.text).toMatch(/^These are facts of this world\. Never contradict them/);
    expect(all.full.map((x: any) => x.entry.heading)).toEqual(['Lord Ashby', 'The Valley', 'Blackstone Keep', 'Rainfall']);
    expect(all.text).toContain('### Blackstone Keep\nThe keep burned in 1888.');
    expect(all.text).toContain('Also in this world, in brief (the details come in when the story reaches them):\n- The Weir: The weir below the mill is the only crossing in winter.');
    // The Hollow Folk are for Nell's chats only: not even in brief.
    expect(all.text).not.toContain('Hollow Folk');
    // Short of room: whole entries or their line, never a cut one.
    const tight = renderLore(sel, 160);
    expect(tight.full.length).toBeLessThan(all.full.length);
    for (const x of tight.full) expect(tight.text).toContain(`### ${x.entry.heading}\n${x.entry.text}`);
    expect(tight.brief.some((x: any) => x.state === 'fired')).toBe(true);
    expect(Math.ceil(tight.text.length / 4)).toBeLessThanOrEqual(160);
    const report = loreReport(sel, tight);
    expect(report.some((l: string) => /^IN FULL  \[valley\.md\] Lord Ashby  \(said: lord ashby\)$/.test(l))).toBe(true);
    expect(report.some((l: string) => /^IN BRIEF \[valley\.md\] .* \(no room in full\)$/.test(l))).toBe(true);
    expect(report).toContain('HIDDEN   [valley.md] The Hollow Folk  (nell hale is not in this chat)');
    expect(report.find((l: string) => l.includes('The Weir'))).toBe('IN BRIEF [valley.md] The Weir  (comes in full when someone says: the weir)');
  });

  it('reaches the system prompt through assembleContext, packed against the lane it really gets', () => {
    const sel = selectLore([book], { userText: 'Blackstone again.' });
    const out = assembleContext({ characters: [ada], history: [], userMessage: 'Blackstone again.', contextWindow: 8192, respondAs: 'ada.json', loreSelection: sel });
    const sys = out.messages[0].content;
    expect(sys).toContain('## World & Lore\nThese are facts of this world.');
    expect(sys).toContain('### Blackstone Keep\nThe keep burned in 1888.');
    expect(sys).toContain('- Lord Ashby: Owns the valley');
    expect(out.loreRender.full.map((x: any) => x.entry.heading)).toContain('Blackstone Keep');
    // A big memory takes most of the lane: lore falls back to its lines and says so, but nothing is cut.
    const crowded = assembleContext({ characters: [ada], history: [], userMessage: 'Blackstone again.', contextWindow: 2048, respondAs: 'ada.json', loreSelection: sel, memoryContent: 'x '.repeat(4000), settings: { tokenBudgetLore: 10 } });
    const text = crowded.loreRender.text;
    for (const x of crowded.loreRender.full) expect(text).toContain(`### ${x.entry.heading}\n${x.entry.text}`);
    if (crowded.loreRender.brief.some((x: any) => x.state !== 'index') || crowded.loreRender.left) {
      expect(crowded.warnings.join('\n')).toMatch(/Lore lane is \d+t: /);
    }
  });

  it('a group chat uses every character\'s books, the first character\'s first, each once', () => {
    const books = [{ fileName: 'a.md', content: '' }, { fileName: 'b.md', content: '' }, { fileName: 'c.md', content: '' }];
    const chars = [{ rawData: { lorebookFiles: ['b.md'] } }, { rawData: { lorebookFiles: ['a.md', 'b.md'] } }, { rawData: {} }];
    expect(chatLorebooks(chars, books).map((b: any) => b.fileName)).toEqual(['b.md', 'a.md']);
    expect(chatLorebooks([{ rawData: {} }], books)).toEqual([]);
  });
});
