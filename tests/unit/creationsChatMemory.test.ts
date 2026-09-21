// Creations AI: the roleplay thread's memory file and the verbatim retrieval
// that replaces the summariser (ext/creations-ai/chat-memory.js).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { renderMemoryMarkdown, parseMemoryMarkdown, isMemoryMarkdown, mergeMemory, memoryFromLegacy, rankExcerpts, earlierBlock } from '../../ext/creations-ai/chat-memory.js';

const parts = {
  facts: [
    { category: 'place', text: 'The scene is a parking garage under the Corinthia, level two.' },
    { category: 'relationship', text: 'Saul does not trust Mara.' },
    { category: 'nonsense', text: 'The van has no plates.' },
  ],
  beats: [{ text: 'Saul locks the stairwell door.' }, { text: 'Mara hides behind the pillar.' }],
  notes: 'Keep the dog alive.',
};

describe('the memory file', () => {
  it('renders facts by group, the timeline in order, and notes, and reads itself back exactly', () => {
    const md = renderMemoryMarkdown(parts);
    expect(md.startsWith('# Memory\n')).toBe(true);
    expect(md).toContain('### Places\n- The scene is a parking garage under the Corinthia, level two.');
    expect(md).toContain('### Other\n- The van has no plates.');
    expect(md).toContain('## Timeline\n\n- Saul locks the stairwell door.\n- Mara hides behind the pillar.');
    expect(md).toContain('## Notes\n\nKeep the dog alive.');
    expect(isMemoryMarkdown(md)).toBe(true);
    const back = parseMemoryMarkdown(md);
    // Grouped on the way out, so the order follows the groups: relationships, then places, then other.
    expect(back.facts).toEqual([
      { category: 'relationship', text: 'Saul does not trust Mara.' },
      { category: 'place', text: 'The scene is a parking garage under the Corinthia, level two.' },
      { category: 'other', text: 'The van has no plates.' },
    ]);
    expect(back.beats).toEqual(parts.beats);
    expect(back.notes).toBe('Keep the dog alive.');
  });
  it('is the source of truth: a line the user removes stays removed, a line they add is read', () => {
    const md = renderMemoryMarkdown(parts)
      .replace('- Saul does not trust Mara.\n', '')
      .replace('## Timeline', '### Places\n- The exit ramp is chained shut.\n\n## Timeline');
    const back = parseMemoryMarkdown(md);
    expect(back.facts.map((f: any) => f.text)).toEqual(['The scene is a parking garage under the Corinthia, level two.', 'The van has no plates.', 'The exit ramp is chained shut.']);
    expect(back.facts.find((f: any) => f.text.startsWith('The exit ramp'))?.category).toBe('place');
    const merged = mergeMemory(back, { facts: [{ category: 'relationship', text: 'Saul does not trust Mara.' }, { category: 'place', text: 'the scene is a PARKING GARAGE under the Corinthia, level two' }], beats: [{ text: 'Mara hides behind the pillar.' }, { text: 'The van starts.' }] });
    expect(merged.facts.map((f: any) => f.text)).toContain('Saul does not trust Mara.');
    expect(merged.facts.filter((f: any) => /parking garage/i.test(f.text))).toHaveLength(1);
    expect(merged.beats.map((b: any) => b.text)).toEqual(['Saul locks the stairwell door.', 'Mara hides behind the pillar.', 'The van starts.']);
  });
  it('renders an empty memory honestly and reads free text as notes', () => {
    const md = renderMemoryMarkdown({});
    expect(md).toContain('## Facts\n\n(nothing yet)');
    expect(parseMemoryMarkdown(md)).toEqual({ facts: [], beats: [], notes: '' });
    expect(isMemoryMarkdown('just some notes')).toBe(false);
    expect(parseMemoryMarkdown('just some notes')).toEqual({ facts: [], beats: [], notes: 'just some notes' });
  });
  it('builds itself once from the old free text and the two JSON logs', () => {
    const m = memoryFromLegacy({ notes: 'old notes', semantic: [{ text: 'Saul is a guard.', category: 'trait' }, { bad: true }], episodic: [{ summary: 'They met.' }, { text: 'They fought.' }] });
    expect(m.notes).toBe('old notes');
    expect(m.facts).toEqual([{ category: 'trait', text: 'Saul is a guard.' }]);
    expect(m.beats.map((b: any) => b.text)).toEqual(['They met.', 'They fought.']);
  });
});

describe('quoting earlier turns', () => {
  const turns = [
    { turn: 1, name: 'Narrator', content: 'The parking garage smelled of oil. Saul checked the stairwell door.' },
    { turn: 2, name: 'Mara', content: 'I brought the keys to the van. The plates are gone.' },
    { turn: 3, name: 'Saul', content: 'We wait for the boat. Nobody leaves.' },
    { turn: 4, name: 'Narrator', content: 'A long silence, the kind that fills a room.' },
  ];
  it('pulls the turns that share names, places and objects with what is said now, in story order', () => {
    const got = rankExcerpts(turns, 'Mara, where are the keys to the van? Is the garage door locked?', 2);
    expect(got.map((t: any) => t.turn)).toEqual([1, 2]);
    expect(rankExcerpts(turns, 'hello there', 3)).toEqual([]);
    expect(rankExcerpts([], 'keys', 3)).toEqual([]);
  });
  it('writes the block the model gets: the timeline tail, the quoted turns with numbers, and the rule against inventing', () => {
    const block = earlierBlock({ beats: parts.beats, excerpts: rankExcerpts(turns, 'the van keys', 1) });
    expect(block.startsWith('[Earlier in the story.')).toBe(true);
    expect(block).toContain('Timeline so far:\n- Saul locks the stairwell door.\n- Mara hides behind the pillar.');
    expect(block).toContain('(turn 2, Mara) I brought the keys to the van. The plates are gone.');
    expect(block).toContain('do not invent it');
    expect(block.endsWith(']')).toBe(true);
    expect(block).not.toMatch(/[—–]/);
    const clipped = earlierBlock({ excerpts: [{ turn: 9, name: 'N', content: 'word '.repeat(400) }], maxExcerptChars: 50 });
    expect(clipped).toContain('...');
    expect(clipped.length).toBeLessThan(500);
  });
});
