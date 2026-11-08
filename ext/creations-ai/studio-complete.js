// studio-complete.js — the Studio's pass over a sheet the model left short.
//
// A model told to write five sections often writes three, and a terse one
// writes each in a line. After a sheet or a rewrite, each structured field
// is measured against the structure and the section floor (fieldShortfall);
// what is missing or thin is asked for once, as a rewrite that keeps the
// rest word for word. Still short, the row says which sections and offers
// Complete. A field with no structure that is under its own floor
// (FIELD_WORDS) gets the notice and Expand, with no call of its own: a
// short overview is the user's to lengthen, one click. After a rewrite the
// user directed, only missing sections are added; a thin one may be what
// they asked for.
//
// `deps` is the Studio's own state and helpers, each a function so they can
// be handed over before they are all defined: { state, rows, structureFor,
// context, streamJson, resolveModel, setField, showUndo, rowError,
// clearRowError, setStatus, refreshStatus }.

import { STUDIO_KEYS, buildFieldMessages, cleanFieldValue, completionDirection, countWords, expansionDirection, fieldShortfall, FIELD_WORDS } from './studio-core.js';

export function createShortFieldPass(d) {
  const sheet = (key) => d.state().sheet[key];
  const locked = (key) => d.state().locks.has(key);

  /** What a field lacks against its structure and its floor; null when nothing. `grow` false counts only missing sections, never thin ones. */
  function shortfallOf(key, value = sheet(key), grow = true) {
    const lack = fieldShortfall(key, value, d.structureFor(key));
    if (!grow) lack.thin = [];
    return lack.missing.length || lack.thin.length || lack.short ? lack : null;
  }
  /** Whether `next` lacks less than the field does now: fewer sections missing, then fewer thin, then more words. */
  function lacksLess(key, next) {
    const a = fieldShortfall(key, next, d.structureFor(key));
    const b = fieldShortfall(key, sheet(key), d.structureFor(key));
    if (a.missing.length !== b.missing.length) return a.missing.length < b.missing.length;
    if (a.thin.length !== b.thin.length) return a.thin.length < b.thin.length;
    return b.short && countWords(next) > countWords(sheet(key));
  }
  function lackText(key, lack) {
    const label = d.rows()[key].label.toLowerCase();
    if (lack.short) return `The ${label} is short: ${countWords(sheet(key))} words, where at least ${FIELD_WORDS[key]} are asked for.`;
    const parts = [];
    if (lack.missing.length) parts.push(`Missing: ${lack.missing.join(', ')}.`);
    if (lack.thin.length) parts.push(`Thin: ${lack.thin.join(', ')}.`);
    return `Not every section came back in full. ${parts.join(' ')}`;
  }
  async function askFor(key, modelId, numCtx, direction) {
    const { parsed } = await d.streamJson(modelId, numCtx, buildFieldMessages(d.context(), d.state().sheet, key, direction));
    return parsed && typeof parsed[key] === 'string' ? cleanFieldValue(key, parsed[key]) : '';
  }

  /** `grow` false (after a rewrite the user directed) adds missing sections only. True when the field is whole. */
  async function completeField(key, modelId, numCtx, grow = true) {
    const rows = d.rows();
    const entry = d.structureFor(key);
    if (!rows[key] || locked(key)) return true;
    if (!entry) { if (grow) noteShort(key); return true; }
    let lack = shortfallOf(key, sheet(key), grow);
    if (!lack) { d.clearRowError(key); return true; }
    const r = rows[key];
    r.row.classList.add('cs-row--busy');
    d.setStatus(`Completing ${r.label.toLowerCase()}`, 'accent');
    try {
      const next = await askFor(key, modelId, numCtx, completionDirection(entry, lack.missing, lack.thin));
      // Taken only when it keeps what was there and adds something.
      if (next && lacksLess(key, next)) d.setField(key, next);
    } catch { /* the notice below says what is still missing */ }
    finally { r.row.classList.remove('cs-row--busy'); }
    lack = shortfallOf(key, sheet(key), grow);
    if (!lack) { d.clearRowError(key); return true; }
    d.rowError(key, lackText(key, lack), () => void completeFieldAgain(key), 'Complete');
    return false;
  }
  async function completeFieldAgain(key) {
    const state = d.state();
    if (state.busy) return;
    state.busy = true;
    try { const { modelId, numCtx } = await d.resolveModel(); await completeField(key, modelId, numCtx); }
    catch (err) { d.rowError(key, `Could not complete ${d.rows()[key].label.toLowerCase()}. ${err?.message || ''}`.trim(), () => void completeFieldAgain(key), 'Complete'); }
    finally { state.busy = false; d.refreshStatus(); }
  }
  /** A field with no structure under its floor: the notice and Expand. */
  function noteShort(key) {
    if (!d.rows()[key] || d.structureFor(key) || locked(key)) return;
    const lack = shortfallOf(key);
    if (!lack) { d.clearRowError(key); return; }
    d.rowError(key, lackText(key, lack), () => void expandField(key), 'Expand');
  }
  /** Expand asks once for the field at its full length, keeping its facts; Undo brings the short one back. */
  async function expandField(key) {
    const state = d.state();
    if (state.busy || locked(key)) return;
    const r = d.rows()[key];
    state.busy = true;
    r.row.classList.add('cs-row--busy');
    d.setStatus(`Expanding ${r.label.toLowerCase()}`, 'accent');
    try {
      const { modelId, numCtx } = await d.resolveModel();
      const next = await askFor(key, modelId, numCtx, expansionDirection(key));
      if (!next || !lacksLess(key, next)) throw new Error('nothing longer came back');
      state.undo.set(key, sheet(key));
      d.setField(key, next);
      d.showUndo(key);
      noteShort(key);
    } catch (err) {
      d.rowError(key, `Could not expand ${r.label.toLowerCase()}. ${err?.message || ''}`.trim(), () => void expandField(key), 'Expand');
    } finally {
      r.row.classList.remove('cs-row--busy');
      state.busy = false;
      d.refreshStatus();
    }
  }
  /** After a sheet: every structured field completed, every other field checked against its floor. */
  async function completeShort(modelId, numCtx) {
    for (const key of STUDIO_KEYS) await completeField(key, modelId, numCtx);
  }
  return { completeField, completeShort };
}
