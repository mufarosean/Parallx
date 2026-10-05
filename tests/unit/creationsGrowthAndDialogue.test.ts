// Creations AI: a character grows inside one chat, and dialogue reads like
// people talking.
//
// The card is the start of a story; the thread's memory is its present. The
// prompt used to show both with no rule, so a character married on the card
// and divorced in the chat was either, turn by turn. The Timeline reached the
// model under one fit method only. And the owner retyped "how people talk"
// into every chat's standing note; it is a setting now, shipped with a
// default, in every roleplay and story prompt.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';
// @ts-expect-error — JS module with no types
import { buildBeatMessages, newStory } from '../../ext/creations-ai/story-core.js';

const { assembleContext, buildSystemPrompt, renderMemoryChannel, DEFAULT_DIALOGUE_RULES, DEFAULT_SETTINGS } = __testables;
const ada = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: 'Ada is married to Tom.' } };

describe('the card is the start, the memory is the present', () => {
  it('says so under Cast and under Conversation Memories when there is a memory', () => {
    const { prompt } = buildSystemPrompt({ characters: [ada], memoryContent: '**Relationship:**\n- Ada and Tom divorced.' });
    expect(prompt).toContain('## Cast\n\nThese are the characters as they were when this story began.');
    expect(prompt).toContain('where the two differ, the memory is the present');
    expect(prompt).toContain('## Conversation Memories\nWhat has happened in this chat so far.');
    expect(prompt.indexOf('Ada is married to Tom.')).toBeLessThan(prompt.indexOf('Ada and Tom divorced.'));
  });

  it('says nothing about it when the chat has no memory yet', () => {
    const { prompt } = buildSystemPrompt({ characters: [ada] });
    expect(prompt).toContain('## Cast\n\n### Ada');
    expect(prompt).not.toContain('when this story began');
    expect(prompt).not.toContain('Conversation Memories');
  });
});

describe('the Timeline rides with the memory', () => {
  it('puts the last lines of the Timeline, oldest first, after the facts', () => {
    const beats = Array.from({ length: 30 }, (_, i) => ({ text: `beat ${i + 1}` }));
    const out = renderMemoryChannel({ legacyMemory: 'my note', semantic: [{ text: 'Ada is left-handed.', category: 'trait' }], timeline: beats });
    expect(out.indexOf('my note')).toBeLessThan(out.indexOf('Ada is left-handed.'));
    expect(out.indexOf('Ada is left-handed.')).toBeLessThan(out.indexOf('Timeline (oldest first'));
    expect(out).not.toContain('- beat 10\n');
    expect(out).toContain('- beat 11\n');
    expect(out.trimEnd().endsWith('- beat 30')).toBe(true);
  });

  it('adds nothing when there are no beats', () => {
    expect(renderMemoryChannel({ semantic: [{ text: 'a fact', category: 'other' }], timeline: [] })).toBe('**Other:**\n- a fact');
  });
});

describe('dialogue rules', () => {
  it('ship with a default that is in every new settings file', () => {
    expect(DEFAULT_SETTINGS.dialogueRules).toBe(DEFAULT_DIALOGUE_RULES);
    expect(DEFAULT_DIALOGUE_RULES).toContain('Nobody names their own values or traits');
  });

  it('go into the roleplay prompt as How People Talk, from the settings, for every preset but none', () => {
    const withRules = assembleContext({ characters: [ada], history: [], userMessage: 'Hi', contextWindow: 8192, respondAs: 'ada.json', settings: { dialogueRules: '- Say the concrete thing.' } });
    expect(withRules.messages[0].content).toContain('## How People Talk\n- Say the concrete thing.');
    const none = assembleContext({ characters: [ada], history: [], userMessage: 'Hi', contextWindow: 8192, respondAs: 'ada.json', settings: { dialogueRules: '- Say the concrete thing.' }, writingPreset: 'none' });
    expect(none.messages[0].content).not.toContain('How People Talk');
  });

  it('an emptied setting means none, and no settings means none', () => {
    const emptied = assembleContext({ characters: [ada], history: [], userMessage: 'Hi', contextWindow: 8192, respondAs: 'ada.json', settings: { dialogueRules: '' } });
    expect(emptied.messages[0].content).not.toContain('How People Talk');
    const bare = assembleContext({ characters: [ada], history: [], userMessage: 'Hi', contextWindow: 8192, respondAs: 'ada.json' });
    expect(bare.messages[0].content).not.toContain('How People Talk');
  });

  it('go into the Story Writer\'s beat prompt too', () => {
    const story = newStory('s1');
    story.brief.premise = 'A boat arrives.';
    const [system] = buildBeatMessages({ story, dialogueRules: '- Say the concrete thing.' });
    expect(system.content).toContain('HOW PEOPLE TALK\n- Say the concrete thing.');
    const [plain] = buildBeatMessages({ story });
    expect(plain.content).not.toContain('HOW PEOPLE TALK');
  });
});
