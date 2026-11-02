// card-rules.js — reads a character card for the lines that make the chat
// perform the card instead of the person: a Voice or Personality written as a
// rule for every line ("always", "never", "instead of"), a quoted line that
// then gets said scene after scene, and a Reminder that says how they talk
// rather than what to keep straight. Findings, never errors: the Studio shows
// them under Test Drive before any model call, the chat's character tool
// notes them, and a save is never blocked. The chat already reads a habit as
// a tendency; a card written as one gives it less to fight.

const ABSOLUTE = /\b(always|never|only ever|every time|in every (line|reply|sentence|turn)|constantly|all the time|instead of|cannot help|can't help|without fail|at every opportunity|whenever (she|he|they) can)\b/i;
const QUOTE_LABEL = /^\s*(might say|never says|says|catchphrase|signature (line|phrase)|typical line)\s*:/i;
const QUOTED = /["“”]|(^|[\s(:])'[^'\n]{3,}'(?=[\s).,;!?]|$)/;
const TALK = /\b(speak|speaks|talk|talks|say|says|answer|answers|answering|replies|reply|ask|asks|name|names|voice|sound|sounds|tone|word|words|sentence|sentences|question|questions|story|stories|metaphor|metaphors|phrase|phrases|accent|dialect|feeling|feelings|joke|jokes|count|counts)\b/i;

const FIX_RULE = 'Say it as a tendency with how often, so the chat can leave it out of a reply: "tells a story now and then, when a question gets too close."';
const FIX_QUOTE = 'Cut the line from Voice; a sample line belongs in the example dialogue, where it is one of three and not a rule.';
const FIX_TALK = 'Make the Reminder a fact to keep straight (who they are to someone, what they hide, where things stand). How they talk is Voice, as a tendency.';

const lines = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
const short = (line) => (line.length > 90 ? `${line.slice(0, 87).trimEnd()}...` : line);

/**
 * What on the card reads as a rule the chat will obey in every line.
 * Returns [{ key, kind, label, line, fix }], in card order; [] for a card
 * written as tendencies and facts.
 */
export function readCard(sheet) {
  const found = [];
  const s = sheet && typeof sheet === 'object' ? sheet : {};
  for (const line of lines(s.voice)) {
    if (QUOTE_LABEL.test(line) || QUOTED.test(line)) found.push({ key: 'voice', kind: 'quote', label: 'A line to repeat', line: short(line), fix: FIX_QUOTE });
    else if (ABSOLUTE.test(line)) found.push({ key: 'voice', kind: 'rule', label: 'Voice as a rule', line: short(line), fix: FIX_RULE });
  }
  for (const line of lines(s.personality)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (ABSOLUTE.test(sentence) && TALK.test(sentence)) found.push({ key: 'personality', kind: 'rule', label: 'Personality as a rule for how they talk', line: short(sentence), fix: FIX_RULE });
    }
  }
  for (const line of lines(s.reminder)) {
    if (TALK.test(line) && (ABSOLUTE.test(line) || /\b(with|in|through|by)\s+(stories|questions|metaphors|silence|jokes)\b/i.test(line))) found.push({ key: 'reminder', kind: 'talk', label: 'Reminder about how they talk', line: short(line), fix: FIX_TALK });
  }
  return found;
}

/** The same findings as one note per line, for the character tool's check. */
export function cardNotes(sheet) {
  return readCard(sheet).map((f) => `${f.key} ${f.label.toLowerCase()}: "${f.line}". ${f.fix}`);
}

/** The findings as Markdown for the Studio: a heading, one bullet per line, the fix under it. */
export function cardFindingsMarkdown(findings) {
  if (!findings.length) return '';
  const out = ['**On the card**: lines the chat will obey in every reply.', ''];
  for (const f of findings) out.push(`- **${f.label}** (${f.key}): "${f.line}"  \n  ${f.fix}`);
  return out.join('\n');
}
