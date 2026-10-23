// initiative.js — Creations AI: turns the player did not have to steer.
//
// Two kinds. A character can open: a note that asks for a first turn from
// their own life, as if the player had just arrived, so a chat need not
// start with the player's line. And when the player sends a message with no
// director's note, the director can choose one itself (Auto-direct, a
// per-chat toggle): the options it would have offered the next speaker,
// one picked for them. Latitude decides the pick: Tight takes the first
// kind (Push: they act on what they want); Loose and Open take any. The
// note rides the turn as a typed one would, so the player sees what was
// chosen. Pure; the chat makes the calls.

/** The note for a character's opening turn. */
export function openingNote(name, userName) {
  const who = name || 'the character';
  const you = userName || 'the player';
  return `Opens the scene: where ${who} is and what ${who} is doing, in the middle of their own day, then the first thing ${who} says or does toward ${you}, who has just arrived, from ${who}'s own wants. Nothing for ${you} to have said yet.`;
}

/**
 * One option for `name` out of the director's groups, by latitude:
 * { kind, label, text, then } or null when there is none.
 */
export function pickDirection(groups, name, { latitude = 'loose', random = Math.random } = {}) {
  const low = String(name || '').toLowerCase();
  const group = (Array.isArray(groups) ? groups : []).find((g) => g && String(g.name || '').toLowerCase() === low);
  const options = group && Array.isArray(group.options) ? group.options.filter((o) => o && o.text) : [];
  if (!options.length) return null;
  const i = latitude === 'tight' ? 0 : Math.min(options.length - 1, Math.floor(random() * options.length));
  return options[i];
}
