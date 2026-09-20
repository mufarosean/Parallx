// Creations AI: the Story Writer's pure half (ext/creations-ai/story-core.js).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import * as story from '../../ext/creations-ai/story-core.js';

const { emptyBrief, newStory, castEntryFromCharacter, castBlock, briefBlock, beatsForContext, buildBeatMessages, buildMemoryMessages, cleanBeat, storyMarkdown, storyFileName, storyWords, BEAT_LENGTHS } = story;

const beat = (id: string, text: string, chapterId = 'ch-1') => ({ id, text, chapterId, instruction: '', createdAt: 1 });

describe('shapes', () => {
  it('starts a story with a brief, one chapter and no memory', () => {
    const s = newStory('story-1', 5);
    expect(s).toMatchObject({ id: 'story-1', title: '', chapters: [{ id: 'ch-1', title: 'Chapter 1' }], beats: [], memory: '', createdAt: 5 });
    expect(emptyBrief()).toMatchObject({ pov: 'third-limited', tense: 'past', beatLength: 'medium', cast: [] });
  });
  it('takes a cast entry from a character file, clipped, from the Studio sheet or the role instruction', () => {
    const c = castEntryFromCharacter('character-a.json', {
      name: 'Ada', roleInstruction: 'Ada counts everything.\n\nSecond paragraph.\n\n## Voice\nShort lines.\n\n## Drives\nWants order.',
      studio: undefined,
    });
    expect(c).toEqual({ fileName: 'character-a.json', name: 'Ada', tagline: '', portrait: 'Ada counts everything.', voice: 'Short lines.', drives: 'Wants order.' });
    const long = castEntryFromCharacter('b.json', { name: 'B', roleInstruction: 'word '.repeat(300) });
    expect(long.portrait.length).toBeLessThanOrEqual(600);
    expect(long.portrait.endsWith('...')).toBe(true);
  });
});

describe('prompts', () => {
  const s = newStory('s');
  s.title = 'The Light';
  s.brief = { ...emptyBrief(), premise: 'A keeper who cannot swim.', genre: 'quiet drama', setting: 'Skerry Rock, 1890', style: 'spare', pov: 'first', tense: 'present', authorsNote: 'No storms until chapter three.', beatLength: 'short',
    cast: [{ fileName: 'a.json', name: 'Ada', tagline: 'counts everything', portrait: 'Ada keeps the light.', voice: 'Short lines.', drives: '' }] };
  s.beats = [beat('b1', 'First beat text.'), beat('b2', 'Second beat text.')];
  s.memory = 'Ada has lit the lamp once.';

  it('puts the brief, the cast, the note, the memory and the recent beats in front of the writer', () => {
    const [system, user] = buildBeatMessages({ story: s, instruction: 'the boat arrives' });
    expect(system.content).toContain('Premise: A keeper who cannot swim.');
    expect(system.content).toContain('first person');
    expect(system.content).toContain('present tense');
    expect(system.content).toContain(`about ${BEAT_LENGTHS[0].words} words`);
    expect(system.content).toContain('Ada, counts everything\nAda keeps the light.\nVoice: Short lines.');
    expect(system.content).toContain("AUTHOR'S NOTE (holds for every beat)\nNo storms until chapter three.");
    expect(system.content).toContain('STORY MEMORY');
    expect(user.content).toContain('First beat text.\nSecond beat text.');
    expect(user.content).toContain('Write the next beat.\nDirection for this beat: the boat arrives');
    expect(system.content + user.content).not.toMatch(/[—–]/);
  });
  it('opens the story when there are no beats, and rewrites a beat without showing it as the past', () => {
    const fresh = { ...s, beats: [] };
    const [, open] = buildBeatMessages({ story: fresh });
    expect(open.content).toContain('This beat opens it');
    const [, rewrite] = buildBeatMessages({ story: s, mode: 'rewrite', target: s.beats[1], instruction: 'slower' });
    expect(rewrite.content).toContain('REWRITE THIS BEAT');
    expect(rewrite.content).toContain('Second beat text.');
    expect(rewrite.content).toContain('How it should change: slower');
    expect(rewrite.content.indexOf('Second beat text.')).toBeGreaterThan(rewrite.content.indexOf('First beat text.'));
    expect(rewrite.content.split('Second beat text.').length).toBe(2);
  });
  it('keeps only the most recent beats inside the budget', () => {
    const beats = [beat('1', 'a'.repeat(4000)), beat('2', 'b'.repeat(4000)), beat('3', 'c'.repeat(4000))];
    expect(beatsForContext(beats, 9000).map((b) => b.id)).toEqual(['2', '3']);
    expect(beatsForContext(beats, 100).map((b) => b.id)).toEqual(['3']);
    expect(beatsForContext(beats, 9000, '3').map((b) => b.id)).toEqual(['1', '2']);
  });
  it('asks for the memory as JSON with the existing memory and the new beats', () => {
    const [system, user] = buildMemoryMessages(s, 1);
    expect(system.content).toContain('{"memory": "..."}');
    expect(user.content).toContain('EXISTING MEMORY:\nAda has lit the lamp once.');
    expect(user.content).toContain('NEW BEATS SINCE THEN:\n\nSecond beat text.');
    expect(user.content).not.toContain('First beat text.');
  });
});

describe('output', () => {
  it('cleans a beat and exports the story as Markdown by chapter', () => {
    expect(cleanBeat('## Beat 3\nShe paused — then went on.\n\n\n\nEnd.')).toBe('She paused, then went on.\n\nEnd.');
    const s = newStory('s');
    s.title = 'The Light';
    s.chapters = [{ id: 'ch-1', title: 'Chapter 1' }, { id: 'ch-2', title: 'The Boat' }];
    s.beats = [beat('1', 'One.'), beat('2', 'Two.'), beat('3', 'Three.', 'ch-2')];
    expect(storyMarkdown(s)).toBe('# The Light\n\n## Chapter 1\n\nOne.\n\nTwo.\n\n## The Boat\n\nThree.\n');
    expect(storyFileName(s)).toBe('the-light.md');
    expect(storyWords(s)).toBe(3);
  });
});
