// Text Generator: the character markdown card written by Export As Markdown
// must come back unchanged through the scanner's .md import path.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const {
  serializeCharacterMd,
  migrateCharacterMdToJson,
  parseCharacterMd,
  createCharacterJson,
  characterExportFileName,
  formatFrontmatterValue,
} = __testables;

const forgeBody = [
  'A sharp Victorian mathematician.',
  '',
  '## Appearance',
  'Dark curls, ink-stained fingers.',
  '',
  '## Personality',
  'Curious, dry, relentless.',
  '',
  '## Voice',
  'Clipped sentences.',
].join('\n');

const source = createCharacterJson({
  name: 'Ada: The Analyst #1',
  roleInstruction: forgeBody,
  voiceAnchor: 'Clipped sentences. Never says "basically".',
  exampleDialogue: '[USER]: Hello\n[AI]: Good evening.',
  reminder: 'Ada never breaks character.',
  userReminder: 'Keep replies short.',
  userDescription: 'A student of hers.',
  initialMessages: '[AI]: Come in, sit down.',
  temperature: 0.55,
  maxTokensPerMessage: 400,
  writingPreset: 'custom',
  pov: 'second',
  extendedMemory: true,
  userName: 'Charles',
});

const ROUND_TRIP_KEYS = [
  'name', 'roleInstruction', 'voiceAnchor', 'reminder',
  'userReminder', 'userDescription', 'initialMessages', 'temperature',
  'maxTokensPerMessage', 'writingPreset', 'pov', 'extendedMemory', 'userName',
];

describe('character markdown export', () => {
  it('round-trips every field through the markdown card', () => {
    const md = serializeCharacterMd(source);
    const back = migrateCharacterMdToJson(md, 'ada.md');
    for (const key of ROUND_TRIP_KEYS) {
      expect(back[key], key).toEqual(source[key]);
    }
    expect(back.exampleDialogue).toBe('');
  });

  it('keeps the body headings and quotes risky frontmatter values', () => {
    const md = serializeCharacterMd(source);
    expect(md.startsWith('---\nname: "Ada: The Analyst #1"\n')).toBe(true);
    expect(md).toContain('\n## Appearance\n');
    expect(md).toContain('\n## Voice\nClipped sentences.\n');
    expect(md).toContain('\n## Voice Anchor\n');
    expect(md).toContain('\n## User Reminder\n');
    expect(md).not.toContain('Example Dialogue');
  });

  it('omits defaults and empty sections', () => {
    const md = serializeCharacterMd(createCharacterJson({ name: 'Plain', roleInstruction: 'Just a body.', initialMessages: '' }));
    expect(md).toBe('---\nname: Plain\n---\n\nJust a body.\n');
  });

  it('still reads the legacy card layout', () => {
    const legacy = [
      '---', 'name: Old Card', 'temperature: 0.9', '---',
      'Be helpful.', '',
      '## Reminder', 'Stay in character.', '',
      '## Initial Messages', '[AI]: Hi.', '',
      '## Example Dialogue', '[USER]: Yo', '[AI]: Hey.', '',
    ].join('\n');
    const parsed = parseCharacterMd(legacy, 'old.md');
    expect(parsed.sections.roleInstruction).toBe('Be helpful.');
    expect(parsed.sections.reminder).toBe('Stay in character.');
    expect(parsed.initialMessages[0].content).toBe('Hi.');
    expect(parsed.sections.exampleDialogue).toBe('[USER]: Yo\n[AI]: Hey.');
    expect(migrateCharacterMdToJson(legacy, 'old.md').temperature).toBe(0.9);
  });

  it('quotes values the frontmatter parser would otherwise misread', () => {
    expect(formatFrontmatterValue('Plain Name')).toBe('Plain Name');
    expect(formatFrontmatterValue('1984')).toBe('"1984"');
    expect(formatFrontmatterValue('true')).toBe('"true"');
    expect(formatFrontmatterValue('Says "hi"')).toBe("'Says \"hi\"'");
    expect(formatFrontmatterValue(0.7)).toBe('0.7');
  });

  it('names the file after the character', () => {
    expect(characterExportFileName('Ada: The Analyst #1')).toBe('ada-the-analyst-1.md');
    expect(characterExportFileName('')).toBe('character.md');
  });
});
