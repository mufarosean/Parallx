// latitude.js — Creations AI: how tightly the chat holds a character's card.
//
// A card distils a person into Personality, Voice, Drives and Secrets. The
// more a chat treats those as rules, the less the character reads as a
// person: every line performs a trait, every scene circles the secret. The
// owner cleared lines from every generated card to make room. Latitude is
// that room as a setting. It touches only what is ambiguous about a person
// (who they are, how they talk, what they want and hide); what is fact on
// the card (how they look, where they come from, who they know) is read as
// written at every level.
//
// Three levels. Tight: the card is a script. Loose: the card is a tendency;
// most of what they say is plain speech, the habits show now and then.
// Open: the card is where they started; when the moment gives them reason
// they may act against it, as a choice, shown and never explained, and
// they are not the same with everyone.
//
// The default lives in Settings; a character may set its own. Pure: the
// chat composes the prompt lines, the Studio draws the picker.

export const LATITUDES = [
  { value: 'tight', label: 'Tight', hint: 'The card is a script: every turn keeps to it.' },
  { value: 'loose', label: 'Loose', hint: 'The card is a tendency: most lines are plain speech; the habits show now and then.' },
  { value: 'open', label: 'Open', hint: 'The card is where they started: given a reason, they may act against it, as a choice.' },
];

export const DEFAULT_LATITUDE = 'loose';

/** Any stored value to a level; `fallback` for the unknown or empty. */
export function coerceLatitude(value, fallback = DEFAULT_LATITUDE) {
  const v = String(value || '').toLowerCase();
  return LATITUDES.some((l) => l.value === v) ? v : fallback;
}

/** A character's level: its own, else the Settings default, else Loose. */
export function resolveLatitude(character, settings) {
  const own = character && (character.latitude || (character.rawData && character.rawData.latitude));
  if (own) return coerceLatitude(own);
  return coerceLatitude(settings && settings.defaultLatitude);
}

const AMBIGUOUS = 'Personality, Voice, Drives and Secrets';

/**
 * The line under a character's card in the roleplay prompt: how to read
 * the ambiguous sections. The factual ones need no line.
 */
export function latitudeFraming(level, name) {
  const who = name || 'this character';
  switch (coerceLatitude(level)) {
    case 'tight':
      return `How to read ${who}'s ${AMBIGUOUS}: as written, every turn. What ${who} says and does keeps to them.`;
    case 'open':
      return [
        `How to read ${who}'s ${AMBIGUOUS}: as where ${who} started, not as limits. Most of what ${who} says is plain speech answering what was just said; the traits, the wants and what is hidden show now and then, never in every line and never named.`,
        `${who} is not the same with everyone: who is in the room changes how ${who} talks, and a scene can bring out a side the card does not list.`,
        `When this moment gives ${who} a reason, ${who} may say or do what the card would not predict: a choice made in the scene, shown and never explained, and never announced as unlike ${who}.`,
      ].join(' ');
    default:
      return `How to read ${who}'s ${AMBIGUOUS}: as tendencies, not rules. Most of what ${who} says is plain speech answering what was just said; the traits, the wants and what is hidden show now and then, never in every line and never named.`;
  }
}

/** What the late anchor adds for the speaker at this level ('' when nothing). */
export function latitudeAnchor(level, name) {
  const who = name || 'this character';
  if (coerceLatitude(level) !== 'open') return '';
  return ` Given a reason in this moment, ${who} may do what the card would not predict: a choice, shown, never explained.`;
}

/** The Settings and Studio choices: the three levels, with Default first when `withDefault`. */
export function latitudeItems(withDefault = false) {
  const items = LATITUDES.map((l) => ({ value: l.value, label: l.label }));
  return withDefault ? [{ value: '', label: 'Default' }, ...items] : items;
}
