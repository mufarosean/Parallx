// card-rules.js: a card written as rules (a voice "always", a quoted line, a
// reminder about how they talk) is read as such, as findings and never as a
// blocked save; a card written as tendencies and facts reads clean.
import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { readCard, cardNotes, cardFindingsMarkdown } from '../../ext/creations-ai/card-rules.js';

type Finding = { key: string; kind: string; label: string; line: string; fix: string };

const clean = {
  name: 'Marit Holm',
  personality: 'Warm, nosy and quick to laugh; she wants company and drives it off by talking too much.',
  voice: 'Warm and quick, a laugh under most of it.\nTalks fast, in long run-on sentences, and asks questions she answers herself.\nPlain island words; goes quiet now and then when the weather turns.',
  reminder: 'Marit has kept the Skerry Rock light alone since her husband left; her daughter Dana is in Bergen.',
};

describe('readCard', () => {
  it('a card of tendencies and facts reads clean', () => {
    expect(readCard(clean)).toEqual([]);
    expect(cardNotes(clean)).toEqual([]);
    expect(cardFindingsMarkdown([])).toBe('');
    expect(readCard(null)).toEqual([]);
  });

  it('a voice written as a rule, a quoted line, and a reminder about how they talk are each found with their fix', () => {
    const found = readCard({
      ...clean,
      voice: 'Slow, long pauses, Yiddish words his grandmother used.\nTells stories instead of opinions.\nMight say: \'Every lock wants to open.\'\nNever says: \'mate\' or \'literally\'.',
      reminder: 'Ilan answers with stories and objects, never with feelings.',
    });
    expect(found.map((f: Finding) => `${f.key}:${f.kind}`)).toEqual(['voice:rule', 'voice:quote', 'voice:quote', 'reminder:talk']);
    expect(found[0].line).toBe('Tells stories instead of opinions.');
    expect(found[0].fix).toMatch(/tendency with how often/);
    expect(found[1].fix).toMatch(/example dialogue/);
    expect(found[3].fix).toMatch(/fact to keep straight/);
  });

  it('a personality sentence that rules how they talk is found; one about temperament is not', () => {
    expect(readCard({ ...clean, personality: 'Gentle, stubborn. Never answers a question with less than a story.' }).map((f: Finding) => f.key)).toEqual(['personality']);
    expect(readCard({ ...clean, personality: 'Never forgives a debt. Gentle with children.' })).toEqual([]);
  });

  it('a reminder that is a fact about speech stays clean; one that rules it does not', () => {
    expect(readCard({ ...clean, reminder: 'Nora learnt English at nineteen and still counts in Spanish.' })).toEqual([]);
    expect(readCard({ ...clean, reminder: 'Nora never names her feelings; she counts, sorts and asks.' }).map((f: Finding) => f.kind)).toEqual(['talk']);
  });

  it('a catchphrase with how often is a tendency; the same phrase as a rule is a line to repeat', () => {
    expect(readCard({ ...clean, voice: 'Strained and quick.\nBursts and pauses.\nShowbiz slang.\nSays \'and that is the tragedy\' now and then, after a bit lands.' })).toEqual([]);
    expect(readCard({ ...clean, voice: 'Strained and quick.\nBursts and pauses.\nShowbiz slang.\nSays \'and that is the tragedy\' once or twice in a scene, after a bit lands.' })).toEqual([]);
    expect(readCard({ ...clean, voice: 'Strained and quick.\nBursts and pauses.\nShowbiz slang.\nSays \'and that is the tragedy\' every time a bit lands.' }).map((f: Finding) => f.kind)).toEqual(['quote']);
  });

  it('the findings read as Markdown with the line and the fix', () => {
    const md = cardFindingsMarkdown(readCard({ ...clean, voice: 'Clipped.\nCounts things out loud, always.\nPlain words.' }));
    expect(md).toMatch(/\*\*On the card\*\*/);
    expect(md).toMatch(/\*\*Voice as a rule\*\* \(voice\): "Counts things out loud, always\."/);
  });
});
