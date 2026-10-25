// character-drafts.js — Creations' character tools: a refused character's
// draft, kept so a resend can carry only the fields that change (the chat
// replays a long tool argument cut short). Per workspace, at most 24, gone
// after an hour or once saved. Split out of main.js.

import { draftKey } from './character-tool-core.js';

const _characterDrafts = new Map();
const CHARACTER_DRAFT_TTL_MS = 60 * 60 * 1000;
const CHARACTER_DRAFT_MAX = 24;
/** `{ raw, tries }`: the draft and the saves in a row it has failed; null when there is none. */
export function takeCharacterDraft(workspaceUri, name) {
  const k = `${workspaceUri}|${draftKey(name)}`;
  const d = _characterDrafts.get(k);
  if (!d) return null;
  if (Date.now() - d.at > CHARACTER_DRAFT_TTL_MS) { _characterDrafts.delete(k); return null; }
  return d;
}
export function keepCharacterDraft(workspaceUri, raw, tries = 0) {
  const name = raw && raw.name;
  if (!name) return;
  const k = `${workspaceUri}|${draftKey(name)}`;
  _characterDrafts.delete(k);
  _characterDrafts.set(k, { raw, tries, at: Date.now() });
  while (_characterDrafts.size > CHARACTER_DRAFT_MAX) _characterDrafts.delete(_characterDrafts.keys().next().value);
}
export function dropCharacterDraft(workspaceUri, name) { _characterDrafts.delete(`${workspaceUri}|${draftKey(name)}`); }
export function clearCharacterDrafts() { _characterDrafts.clear(); }
