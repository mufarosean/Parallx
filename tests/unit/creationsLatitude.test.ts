// Creations AI: latitude (ext/creations-ai/latitude.js), how tightly a chat
// holds a card. It frames only the ambiguous sections (Personality, Voice,
// Drives, Secrets), never the facts; the default is in Settings and a card
// may set its own; the roleplay prompt carries the framing under each card
// and the late anchor adds the off-card permission only at Open.

import { describe, it, expect } from 'vitest';
// @ts-expect-error — JS module with no types
import { LATITUDES, DEFAULT_LATITUDE, coerceLatitude, resolveLatitude, latitudeFraming, latitudeAnchor, latitudeItems } from '../../ext/creations-ai/latitude.js';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/creations-ai/main.js';

const { assembleContext } = __testables;

describe('the levels', () => {
  it('are Tight, Loose and Open, Loose by default, and anything else falls back', () => {
    expect(LATITUDES.map((l: any) => l.value)).toEqual(['tight', 'loose', 'open']);
    expect(DEFAULT_LATITUDE).toBe('loose');
    expect(coerceLatitude('OPEN')).toBe('open');
    expect(coerceLatitude('wild')).toBe('loose');
    expect(coerceLatitude('', '')).toBe('');
    expect(latitudeItems(true)[0]).toEqual({ value: '', label: 'Default' });
    expect(latitudeItems().map((i: any) => i.label)).toEqual(['Tight', 'Loose', 'Open']);
  });

  it('a card sets its own level, else the Settings default, else Loose', () => {
    expect(resolveLatitude({ rawData: { latitude: 'open' } }, { defaultLatitude: 'tight' })).toBe('open');
    expect(resolveLatitude({ latitude: 'tight' }, { defaultLatitude: 'open' })).toBe('tight');
    expect(resolveLatitude({ rawData: {} }, { defaultLatitude: 'open' })).toBe('open');
    expect(resolveLatitude(null, {})).toBe('loose');
  });
});

describe('the framing', () => {
  it('names only the ambiguous sections, never appearance or backstory', () => {
    for (const level of ['tight', 'loose', 'open']) {
      const line = latitudeFraming(level, 'Ada');
      expect(line).toContain("Ada's Personality, Voice, Drives and Secrets");
      expect(line).not.toMatch(/Appearance|Backstory|Relationships/);
    }
  });
  it('Tight is a script; Loose a tendency; Open adds the off-card choice and other people', () => {
    expect(latitudeFraming('tight', 'Ada')).toContain('as written, every turn');
    expect(latitudeFraming('loose', 'Ada')).toContain('as tendencies, not rules');
    expect(latitudeFraming('loose', 'Ada')).not.toContain('would not predict');
    const open = latitudeFraming('open', 'Ada');
    expect(open).toContain('where Ada started, not as limits');
    expect(open).toContain('what the card would not predict');
    expect(open).toContain('never announced as unlike Ada');
    expect(open).toContain('not the same with everyone');
  });
  it('the late anchor adds the permission only at Open', () => {
    expect(latitudeAnchor('tight', 'Ada')).toBe('');
    expect(latitudeAnchor('loose', 'Ada')).toBe('');
    expect(latitudeAnchor('open', 'Ada')).toContain('Ada may do what the card would not predict');
  });
});

describe('in the roleplay prompt', () => {
  const ada = { fileName: 'ada.json', frontmatter: { name: 'Ada' }, sections: { roleInstruction: 'Ada counts things.\n\n## Personality\nDry.', voiceAnchor: 'Short lines.' }, rawData: { latitude: 'open' } };
  const tom = { fileName: 'tom.json', frontmatter: { name: 'Tom' }, sections: { roleInstruction: 'Tom runs the bar.' }, rawData: {} };
  const history = [{ id: 'h1', author: 'user', name: 'Alex', content: 'Hello.' }];

  it('frames each card at its own level, the Settings default for the rest', () => {
    const out = assembleContext({ characters: [ada, tom], history, userMessage: 'Well?', contextWindow: 8192, userName: 'Alex', respondAs: 'ada.json', settings: { defaultLatitude: 'tight' } });
    const system = out.messages[0].content;
    expect(system).toContain("How to read Ada's Personality, Voice, Drives and Secrets: as where Ada started");
    expect(system).toContain("How to read Tom's Personality, Voice, Drives and Secrets: as written, every turn");
    // The framing sits under the card, inside its cast entry.
    expect(system.indexOf('Ada counts things.')).toBeLessThan(system.indexOf("How to read Ada's"));
  });

  it('the late anchor carries the Open permission for the speaker, and nothing extra at Loose', () => {
    const open = assembleContext({ characters: [ada], history, userMessage: 'Well?', contextWindow: 8192, userName: 'Alex', respondAs: 'ada.json', settings: {} });
    const late = open.messages.map((m: any) => m.content).join('\n');
    expect(late).toContain('Ada may do what the card would not predict: a choice, shown, never explained');
    const loose = assembleContext({ characters: [tom], history, userMessage: 'Well?', contextWindow: 8192, userName: 'Alex', respondAs: 'tom.json', settings: {} });
    expect(loose.messages.map((m: any) => m.content).join('\n')).not.toContain('would not predict');
  });
});
