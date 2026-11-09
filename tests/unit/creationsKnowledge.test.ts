// Creations AI: what a character knows. The model writing a turn held every
// card in the chat, the lore, the memories and the whole transcript, and
// wrote the character from all of it: a daughter who knew what her father
// told the chef in another room, a stranger who knew the other's past. Now
// the prompt draws the line between the writer's knowledge and the
// character's in every section: the other cards as the speaker knows those
// people, the lore and the memories addressed, and the rule stated twice.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';
// @ts-expect-error — JS module with no types
import { cardAsKnownBy, knowEachOther, namesPerson, characterSheet } from '../../ext/creations-ai/knowledge.js';
// @ts-expect-error — JS module with no types
import { composeRoleInstruction } from '../../ext/creations-ai/studio-core.js';

const { buildSystemPrompt, assembleContext } = __testables;

// A Studio-made character: the sheet on the file, the role instruction composed from it.
const card = (name: string, sheet: Record<string, string>) => ({
  fileName: `${name.toLowerCase()}.json`,
  frontmatter: { name },
  sections: { roleInstruction: composeRoleInstruction(sheet), reminder: sheet.reminder || '', exampleDialogue: sheet.exampleDialogue || '' },
  rawData: { name, studio: { sheet: { name, ...sheet } } },
});

const father = card('Henrik Voss', {
  description: 'Henrik runs the shipping office on Kelder Quay and comes home at seven.',
  appearance: 'Tall, grey at the temples, a navy coat he never buttons.',
  personality: 'Patient to a point, then sharp.',
  backstory: 'Grew up in Bergen; moved to the quay when Mia was three.',
  drives: 'Wants Mia to stay in school. Fears the office closing.',
  secrets: 'The office lost the Halvorsen contract last week; he has told no one.',
  relationships: 'Mia Voss: his daughter, sixteen, they argue about curfew.\nOskar Lind: his cook these four years.',
  reminder: 'Henrik hides that the contract is lost.',
});
const daughter = card('Mia Voss', {
  description: 'Mia is sixteen and spends evenings in her room with the door shut.',
  appearance: 'Small, dark fringe, her father\'s eyes, a hoodie two sizes up.',
  personality: 'Quick, guarded, funny when she forgets to be guarded.',
  backstory: 'Remembers Bergen only as a smell of rain.',
  drives: 'Wants to leave the quay. Fears being the one who stays.',
  secrets: 'She has applied to a school in Oslo without telling anyone.',
  relationships: 'Henrik Voss: her father. They argue about curfew.',
  exampleDialogue: '"Fine." "It is not fine, Dad."',
});
const chef = card('Oskar Lind', {
  description: 'Oskar cooks for the Voss house and keeps the kitchen as his own country.',
  appearance: 'Broad, burn-scarred forearms, an apron folded at the waist.',
  personality: 'Dry; says a thing once.',
  backstory: 'Cooked on trawlers until his knees gave out.',
  drives: 'Wants to open a place of his own.',
  secrets: 'He is leaving at the end of the month and has not said so.',
  relationships: 'Henrik Voss: his employer. He respects the man and not the house.',
});
const stranger = card('Beatrix Oyelaran', {
  description: 'Beatrix sells books from a boat.',
  appearance: 'Grey braids under a yellow hat, a crate of books on a trolley.',
  backstory: 'Left a university library in Lagos after a scandal nobody at the quay knows about.',
  secrets: 'The scandal was hers.',
  relationships: 'Dag Ruud: the harbour master, who owes her a favour.',
});

describe('who knows whom', () => {
  it('reads the Relationships field, by full or first name, in either direction', () => {
    expect(namesPerson(characterSheet(father), 'Mia Voss')).toBe(true);
    expect(namesPerson(characterSheet(father), 'Mia')).toBe(true);
    expect(namesPerson(characterSheet(chef), 'Mia Voss')).toBe(false);
    // The chef names the father; the father names the chef: known either way.
    expect(knowEachOther(characterSheet(chef), 'Oskar Lind', characterSheet(daughter), 'Mia Voss')).toBe(false);
    expect(knowEachOther(characterSheet(daughter), 'Mia Voss', characterSheet(father), 'Henrik Voss')).toBe(true);
    expect(knowEachOther(characterSheet(stranger), 'Beatrix Oyelaran', characterSheet(daughter), 'Mia Voss')).toBe(false);
  });

  it('a known person is given by overview, appearance, personality and background, never by drives or secrets', () => {
    const text = cardAsKnownBy('Mia Voss', characterSheet(daughter), 'Henrik Voss', characterSheet(father));
    expect(text).toContain('### Henrik Voss');
    expect(text).toContain('What Mia Voss knows of Henrik Voss.');
    expect(text).toContain('Henrik runs the shipping office');
    expect(text).toContain('## Appearance\nTall, grey at the temples');
    expect(text).toContain('## Personality\nPatient to a point');
    expect(text).toContain('## Background\nGrew up in Bergen');
    expect(text).not.toContain('Halvorsen');
    expect(text).not.toContain('Wants Mia to stay in school');
    expect(text).not.toContain('## Relationships');
  });

  it('a stranger is given by appearance alone', () => {
    const text = cardAsKnownBy('Mia Voss', characterSheet(daughter), 'Beatrix Oyelaran', characterSheet(stranger));
    expect(text).toContain('Mia Voss has not met Beatrix Oyelaran before this chat');
    expect(text).toContain('## Appearance\nGrey braids under a yellow hat');
    expect(text).not.toContain('sells books');
    expect(text).not.toContain('Lagos');
    expect(text).not.toContain('scandal');
    expect(text).not.toContain('Dag Ruud');
  });

  it('a hand-written card with no sections is read the same way', () => {
    const plain = { fileName: 'tom.json', frontmatter: { name: 'Tom' }, sections: { roleInstruction: 'Tom runs the bar.\n\n## Appearance\nBald, apron.\n\n## Secrets\nHe waters the gin.' } };
    const sheet = characterSheet(plain);
    expect(sheet.appearance).toBe('Bald, apron.');
    const text = cardAsKnownBy('Mia Voss', characterSheet(daughter), 'Tom', sheet);
    expect(text).toContain('Bald, apron.');
    expect(text).not.toContain('waters the gin');
  });
});

describe('in the prompt', () => {
  const characters = [father, daughter, chef];
  const sceneState = { location: 'the kitchen', present: ['Henrik Voss', 'Oskar Lind'] };

  it("the daughter's turn holds her own card whole and the others as she knows them", () => {
    const { prompt } = buildSystemPrompt({ characters, respondAs: 'mia voss.json', sceneState, loreContent: 'Kelder Quay is a fishing town.', memoryContent: '- Henrik asked Oskar for salmon.' });
    // Hers, whole.
    expect(prompt).toContain('applied to a school in Oslo');
    expect(prompt).toContain('"It is not fine, Dad."');
    // Her father, known: his ways, not his secret or his wants.
    expect(prompt).toContain('What Mia Voss knows of Henrik Voss.');
    expect(prompt).toContain('Patient to a point, then sharp.');
    expect(prompt).not.toContain('Halvorsen');
    expect(prompt).not.toContain('Wants Mia to stay in school');
    expect(prompt).not.toContain('Henrik hides that the contract is lost');
    // The chef, a stranger to her card: a face.
    expect(prompt).toContain('Mia Voss has not met Oskar Lind before this chat');
    expect(prompt).toContain('burn-scarred forearms');
    expect(prompt).not.toContain('leaving at the end of the month');
    expect(prompt).not.toContain('Cooked on trawlers');
    // The sections addressed, and the rule.
    expect(prompt).toContain('Present: Henrik Voss, Oskar Lind\nAnyone not listed is elsewhere and hears nothing said here.');
    expect(prompt).toContain('## World & Lore\nThe world as it is. Mia Voss knows the part of it a person in Mia Voss\'s place would know');
    expect(prompt).toContain('when the story began. Of this, Mia Voss knows what happened in Mia Voss\'s presence and what Mia Voss was told.');
    expect(prompt).toContain('- Mia Voss knows only what Mia Voss\'s own card holds and what this chat has shown or told Mia Voss.');
    expect(prompt.match(/- Mia Voss knows only[^\n]*/)![0]).not.toMatch(/[—–]/);
  });

  it("the father's turn knows the chef and the daughter, and not what they hide", () => {
    const { prompt } = buildSystemPrompt({ characters, respondAs: 'henrik voss.json' });
    expect(prompt).toContain('Halvorsen');
    expect(prompt).toContain('What Henrik Voss knows of Mia Voss.');
    expect(prompt).toContain('What Henrik Voss knows of Oskar Lind.');
    expect(prompt).not.toContain('Oslo');
    expect(prompt).not.toContain('leaving at the end of the month');
  });

  it('the Narrator and the user are not minds in the story: every card whole, no rule', () => {
    for (const respondAs of ['__narrator__', '__self__', null]) {
      const { prompt } = buildSystemPrompt({ characters, respondAs, sceneState, loreContent: 'Kelder Quay.', memoryContent: '- salmon.' });
      expect(prompt).toContain('Halvorsen');
      expect(prompt).toContain('Oslo');
      expect(prompt).toContain('leaving at the end of the month');
      expect(prompt).not.toContain('knows only what');
      expect(prompt).not.toContain('Anyone not listed is elsewhere');
      expect(prompt).not.toContain('The world as it is.');
    }
  });

  it('a chat with one character is unchanged but for the rule', () => {
    const { prompt } = buildSystemPrompt({ characters: [daughter], respondAs: 'mia voss.json' });
    expect(prompt).toContain('applied to a school in Oslo');
    expect(prompt).not.toContain('knows of');
    expect(prompt).toContain('- Mia Voss knows only what');
  });

  it('the late block repeats the rule, short', () => {
    const { messages } = assembleContext({ characters, respondAs: 'mia voss.json', history: [], userMessage: 'Dad knocks.', contextWindow: 8192 });
    const late = messages.filter((m: { role: string; content: string }) => m.role === 'system').pop()!.content as string;
    expect(late).toContain("Mia Voss knows only what Mia Voss's card holds and what this chat has shown or told Mia Voss; nothing else is in Mia Voss's head.");
  });
});
