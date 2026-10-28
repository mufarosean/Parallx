// studio-sheet.js — Creations AI: the Studio's sheet, on its own. Its twelve
// fields, the sections folded into the chat's role instruction, an empty
// sheet, dash hygiene, and a character's sheet read back from its file.
// studio-core.js, studio-connections.js and character-find.js all read it,
// so it imports none of them (an external tool's imports must not cycle).

export const STUDIO_FIELDS = [
  { key: 'name', label: 'Name', rows: 1, hint: 'What they are called.' },
  { key: 'tagline', label: 'Tagline', rows: 1, hint: 'One line that says who they are, without the name.' },
  { key: 'description', label: 'Overview', rows: 5, hint: 'Who they are, their life and work, how they behave.' },
  { key: 'appearance', label: 'Appearance', rows: 4, hint: 'What they look like and what they wear.' },
  { key: 'personality', label: 'Personality', rows: 4, hint: 'Their temperament, how they treat people, the need under it.' },
  { key: 'voice', label: 'Voice', rows: 4, hint: 'How they speak in general: tone, rhythm, register.' },
  { key: 'backstory', label: 'Backstory', rows: 5, hint: 'Where they come from and the turning points that made them.' },
  { key: 'drives', label: 'Drives', rows: 3, hint: 'What they want, what they fear, what stands in the way.' },
  { key: 'secrets', label: 'Secrets', rows: 2, hint: 'What they hide, and from whom.' },
  { key: 'relationships', label: 'Relationships', rows: 3, hint: 'The people who matter to them and how things stand.' },
  { key: 'exampleDialogue', label: 'Example Dialogue', rows: 8, hint: 'Three exchanges. The chat imitates these more than anything else.' },
  { key: 'reminder', label: 'Reminder', rows: 2, hint: 'The one thing the chat must never forget about them.' },
];
export const STUDIO_KEYS = STUDIO_FIELDS.map((f) => f.key);

/** Sheet sections that are folded into the chat's role instruction, in order, with their headings. */
export const PORTRAIT_SECTIONS = [
  ['appearance', 'Appearance'],
  ['personality', 'Personality'],
  ['voice', 'Voice'],
  ['backstory', 'Background'],
  ['drives', 'Drives'],
  ['secrets', 'Secrets'],
  ['relationships', 'Relationships'],
];

export function emptySheet() {
  return Object.fromEntries(STUDIO_KEYS.map((k) => [k, '']));
}

/** Em and en dashes never reach a saved character (house rule, same as the chat). */
export function stripDashes(text) {
  if (!text) return text;
  return String(text)
    .replace(/(\d)\s*[—–]\s*(?=\d)/g, '$1-')
    .replace(/^[—–]+\s*/gm, '')
    .replace(/\s*[—–]+(?=["'”’)\]]|\s*$)/gm, '...')
    .replace(/\s*[—–]+\s*/g, ', ');
}

export function splitRoleInstruction(text) {
  const out = { description: '' };
  const src = String(text || '');
  const chunks = src.split(/^## +/m);
  out.description = chunks[0].trim();
  const byHeading = new Map(PORTRAIT_SECTIONS.map(([key, heading]) => [heading.toLowerCase(), key]));
  byHeading.set('backstory', 'backstory');
  for (const chunk of chunks.slice(1)) {
    const nl = chunk.indexOf('\n');
    const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim().toLowerCase();
    const body = nl < 0 ? '' : chunk.slice(nl + 1).trim();
    const key = byHeading.get(heading);
    if (key) out[key] = body;
    else out.description = `${out.description}\n\n## ${chunk.trim()}`.trim();
  }
  return out;
}

/**
 * The sheet for a character file. A Studio-made character carries its
 * sheet; any other (hand-written, imported, Forge-made) is read back out of
 * its role instruction so the same rows work on it.
 */
export function sheetFromCharacter(data) {
  const sheet = emptySheet();
  if (!data) return sheet;
  const saved = data.studio && data.studio.sheet;
  if (saved && typeof saved === 'object') {
    for (const k of STUDIO_KEYS) if (typeof saved[k] === 'string') sheet[k] = saved[k];
    if (!sheet.name) sheet.name = data.name || '';
    return sheet;
  }
  const split = splitRoleInstruction(data.roleInstruction || '');
  Object.assign(sheet, split);
  sheet.name = data.name || '';
  if (!sheet.voice && data.voiceAnchor) sheet.voice = data.voiceAnchor;
  sheet.exampleDialogue = data.exampleDialogue || '';
  sheet.reminder = data.reminder || '';
  return sheet;
}
