// studio.js — Creations AI: the Character Studio pane.
//
// One column, three sections: the bar (name, status, actions, lineage),
// Make (concept or sources, the Twist, the dials, the model), the Sheet
// (one row per field, edited in place, each with Lock and Reroll), then
// Canon when there is one and Try A Line at the end. Autosaves; there is
// no Save button. Design and gates: docs/CREATIONS_AI.md, slice 1.
//
// Everything that is not DOM lives in studio-core.js and is unit-tested.
// This file is exercised by tests/unit/creationsStudioPane.test.ts with a
// stubbed model and file system.

import {
  STUDIO_FIELDS, STUDIO_KEYS, emptySheet, cleanSheet, cleanFieldValue,
  condenseText, formatWords,
  buildCanonMessages, buildTwistMessages, buildSheetMessages, buildFieldMessages, buildTryLineMessages,
  buildPitchMessages, parsePitches, pitchAsConcept, parseRelationshipLines, relationConcept,
  parseJsonLoose, extractCompletedFields, parseCanonFacts, parseTwistedCanon, canonCounts,
  sheetFromCharacter, characterFromSheet, lineageOf, stripDashes,
} from './studio-core.js';
import { createPortrait, updatePortrait, hueOf, PORTRAIT_HUES, createDots, CREATIONS_PARTS_CSS } from './portrait.js';

const STYLE_ID = 'creations-studio-styles';
const AUTOSAVE_MS = 800;
const DEFAULT_SOURCE_WORDS = 1500;

export function injectStudioStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
.cs { container-type: inline-size; max-width: 1180px; margin: 0 auto; padding: var(--px-space-4) var(--px-space-5) var(--px-space-8); display: flex; flex-direction: column; gap: var(--px-space-4); color: var(--px-text); font-family: var(--px-font-ui); box-sizing: border-box; }
.cs-hero { display: flex; align-items: center; gap: var(--px-space-4); padding-bottom: var(--px-space-4); border-bottom: 1px solid var(--px-divider); }
.cs-hero-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cs-portrait-btn { position: relative; flex: none; border: 0; background: none; padding: 0; cursor: pointer; border-radius: var(--px-radius-lg); }
.cs-portrait-btn:focus-visible { outline: none; box-shadow: var(--px-ring); }
.cs-portrait-edit { position: absolute; right: -4px; bottom: -4px; width: 20px; height: 20px; border-radius: var(--px-radius-full); border: 2px solid var(--px-bg); background: var(--px-bg-elevated); color: var(--px-text-secondary); display: inline-flex; align-items: center; justify-content: center; opacity: 0; transition: opacity var(--px-dur-fast) var(--px-ease); }
.cs-portrait-btn:hover .cs-portrait-edit, .cs-portrait-btn:focus-visible .cs-portrait-edit { opacity: 1; }
.cs-tagline { font-size: var(--px-text-md); color: var(--px-text-secondary); min-height: 1.4em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-tagline:empty::before { content: 'A tagline appears here once the sheet has one.'; color: var(--px-text-faint); }
.cs-cols { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: var(--px-space-5); align-items: start; }
.cs-main, .cs-side { display: flex; flex-direction: column; gap: var(--px-space-4); min-width: 0; }
.cs-side { position: sticky; top: var(--px-space-4); }
.cs-side .cs-section { border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); padding: var(--px-space-3); }
.cs-progress { height: 3px; border-radius: 2px; background: var(--px-surface-hover); overflow: hidden; display: none; }
.cs-progress > i { display: block; height: 100%; width: 0; background: var(--px-accent); transition: width var(--px-dur-base) var(--px-ease-out); }
.cs--writing .cs-progress { display: block; }
.cs-row-state { display: none; align-items: center; gap: 6px; font-size: var(--px-text-xs); font-weight: 400; color: var(--px-text-muted); }
.cs-row--queued .cs-row-state, .cs-row--writing .cs-row-state { display: inline-flex; }
.cs-row-skel { grid-area: text; display: none; flex-direction: column; gap: 8px; padding: 8px var(--px-space-2); }
.cs-row--queued .cs-row-skel { display: flex; }
.cs-row--queued .cs-row-text { display: none; }
.cs-row--queued { border-style: dashed; background: transparent; }
.cs-row--writing { border-color: var(--px-border-strong); }
.cs-try-you { align-self: flex-end; max-width: 85%; padding: 6px 10px; border-radius: 12px 12px 4px 12px; background: var(--px-accent-faint); font-size: var(--px-text-sm); }
.cs-try-you:empty { display: none; }
.cs-try-said { display: flex; gap: var(--px-space-2); align-items: flex-end; }
.cs-try-said:has(.cs-try-reply:empty) { display: none; }
.cs-try-thread { display: flex; flex-direction: column; gap: var(--px-space-2); }
@container (max-width: 860px) { .cs-cols { grid-template-columns: minmax(0, 1fr); } .cs-side { position: static; } }
.cs-bar { display: flex; align-items: center; gap: var(--px-space-2); flex-wrap: wrap; }
.cs-title { flex: 1 1 220px; min-width: 0; font-size: var(--px-text-xl); letter-spacing: -.01em; font-weight: 600; background: transparent; border: 0; border-bottom: 1px solid transparent; color: var(--px-text); padding: var(--px-space-1) 0; outline: none; font-family: inherit; }
.cs-title:hover { border-bottom-color: var(--px-border); }
.cs-title:focus { border-bottom-color: var(--px-accent); }
.cs-title::placeholder { color: var(--px-text-faint); font-weight: 500; }
.cs-chip { font-size: var(--px-text-xs); line-height: 18px; padding: 0 var(--px-space-2); border-radius: var(--px-radius-full); background: var(--px-bg-inset); color: var(--px-text-muted); white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
.cs-chip--accent { color: var(--px-accent-text); background: var(--px-accent-faint); }
.cs-chip--warn { color: var(--px-warning); background: var(--px-warning-soft); }
.cs-chip--danger { color: var(--px-danger); background: var(--px-danger-soft); }
.cs-chip--ok { color: var(--px-success); background: var(--px-bg-inset); }
.cs-actions { display: flex; gap: var(--px-space-2); flex-wrap: wrap; }
.cs-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--px-border); background: var(--px-bg-elevated); color: var(--px-text); font: inherit; cursor: pointer; white-space: nowrap; align-items: center; justify-content: center; box-sizing: border-box; height: var(--px-control-h); padding: 0 12px; border-radius: var(--px-radius-sm); font-size: var(--px-text-sm); line-height: 1; }
.cs-btn:hover { border-color: var(--px-border-strong); }
.cs-btn:disabled { opacity: .5; cursor: default; }
.cs-btn--primary { background: var(--px-accent); border-color: var(--px-accent); color: var(--px-text-on-accent); }
.cs-btn--primary:hover { background: var(--px-accent-hover); border-color: var(--px-accent-hover); }
.cs-btn--quiet { background: transparent; border-color: transparent; color: var(--px-text-muted); }
.cs-btn--quiet:hover { color: var(--px-text); background: var(--px-bg-inset); border-color: transparent; }
.cs-btn--small { padding: 2px var(--px-space-2); font-size: var(--px-text-xs); line-height: 18px; }
.cs-crumbs { display: flex; align-items: center; gap: var(--px-space-1); font-size: var(--px-text-sm); color: var(--px-text-muted); flex-wrap: wrap; }
.cs-crumb { background: none; border: 0; padding: 0; color: var(--px-accent-text); cursor: pointer; font: inherit; }
.cs-crumb:hover { text-decoration: underline; }
.cs-crumb--here { color: var(--px-text); cursor: default; text-decoration: none; }
.cs-crumb--here:hover { text-decoration: none; }
.cs-error { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); color: var(--px-danger); }
.cs-section { border-top: 1px solid var(--px-divider); padding-top: var(--px-space-3); }
.cs-section-head { display: flex; align-items: center; gap: var(--px-space-2); cursor: pointer; user-select: none; min-height: 24px; }
.cs-section-title { font-size: var(--px-text-sm); font-weight: 600; color: var(--px-text-secondary); }
.cs-section-meta { font-size: var(--px-text-xs); color: var(--px-text-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-section-chev { color: var(--px-text-muted); display: inline-flex; transition: transform .12s; }
.cs-section--closed .cs-section-chev { transform: rotate(-90deg); }
.cs-section-body { margin-top: var(--px-space-3); display: flex; flex-direction: column; gap: var(--px-space-3); }
.cs-section--closed .cs-section-body { display: none; }
.cs-modes { display: flex; gap: var(--px-space-1); }
.cs-mode { font-size: var(--px-text-xs); line-height: 20px; padding: 0 var(--px-space-2); border-radius: var(--px-radius-full); border: 1px solid var(--px-border); background: transparent; color: var(--px-text-muted); cursor: pointer; font-family: inherit; }
.cs-mode[aria-pressed="true"] { color: var(--px-accent-text); border-color: var(--px-accent); background: var(--px-accent-faint); }
.cs-field { display: flex; flex-direction: column; gap: var(--px-space-1); }
.cs-label { font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-secondary); }
.cs-textarea, .cs-input { width: 100%; box-sizing: border-box; background: var(--px-bg-inset); border: 1px solid var(--px-border); border-radius: var(--px-radius-sm); color: var(--px-text); font: inherit; font-size: var(--px-text-base); line-height: 1.5; padding: var(--px-space-2) var(--px-space-3); }
.cs-textarea { resize: none; overflow: hidden; min-height: 40px; field-sizing: content; }
.cs-textarea:focus, .cs-input:focus { outline: none; border-color: var(--px-accent); }
.cs-textarea::placeholder, .cs-input::placeholder { color: var(--px-text-faint); }
.cs-sources { display: flex; flex-direction: column; }
.cs-source { display: flex; align-items: center; gap: var(--px-space-2); padding: var(--px-space-2) 0; border-bottom: 1px solid var(--px-divider); font-size: var(--px-text-sm); flex-wrap: wrap; }
.cs-source-why { flex-basis: 100%; font-size: var(--px-text-xs); color: var(--px-danger); }
.cs-source-icon { color: var(--px-text-muted); display: inline-flex; flex: 0 0 auto; }
.cs-source-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cs-source-ref { color: var(--px-text-muted); font-size: var(--px-text-xs); margin-left: var(--px-space-1); }
.cs-add { display: flex; gap: var(--px-space-2); flex-wrap: wrap; }
.cs-inline { display: flex; gap: var(--px-space-2); align-items: flex-start; }
.cs-inline .cs-input, .cs-inline .cs-textarea { flex: 1; }
.cs-rows { display: flex; flex-direction: column; gap: var(--px-space-2); }
.cs-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: 'label acts' 'text text' 'steer steer' 'err err'; column-gap: var(--px-space-2); padding: var(--px-space-2) var(--px-space-3) var(--px-space-2); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); align-items: center; }
.cs-row-label { grid-area: label; font-size: var(--px-text-xs); font-weight: 600; color: var(--px-text-secondary); display: flex; align-items: center; gap: var(--px-space-2); min-width: 0; min-height: 24px; }
.cs-row-lock { color: var(--px-accent-text); background: var(--px-accent-faint); border-radius: var(--px-radius-full); padding: 0 7px; line-height: 18px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600; }
.cs-row-text { grid-area: text; width: 100%; box-sizing: border-box; background: transparent; border: 1px solid transparent; border-radius: var(--px-radius-sm); color: var(--px-text); font: inherit; font-size: var(--px-text-base); line-height: 1.5; padding: 6px var(--px-space-2); resize: none; overflow: hidden; min-height: 34px; field-sizing: content; }
.cs-row-text:hover { border-color: var(--px-border); }
.cs-row-text:focus { outline: none; border-color: var(--px-accent); background: var(--px-bg-inset); }
.cs-row-text::placeholder { color: var(--px-text-faint); }
.cs-row--busy .cs-row-text { opacity: .55; }
.cs-row-actions { grid-area: acts; display: flex; gap: 2px; opacity: 0; transition: opacity var(--px-dur-fast) var(--px-ease); }
.cs-row:hover .cs-row-actions, .cs-row:focus-within .cs-row-actions, .cs-row--locked .cs-row-actions, .cs-row--undo .cs-row-actions { opacity: 1; }
.cs-icon-btn { width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; border: 0; background: transparent; color: var(--px-text-muted); border-radius: var(--px-radius-xs); cursor: pointer; padding: 0; }
.cs-icon-btn:hover { background: var(--px-bg-inset); color: var(--px-text); }
.cs-icon-btn:disabled { opacity: .4; cursor: default; }
.cs-icon-btn[aria-pressed="true"] { color: var(--px-accent-text); }
.cs-row-steer { grid-area: steer; display: none; flex-direction: column; gap: var(--px-space-2); margin-top: var(--px-space-1); padding: var(--px-space-2); border-radius: var(--px-radius-md); background: var(--px-bg-inset); }
.cs-row--steer .cs-row-steer { display: flex; }
.cs-row--steer .cs-row-actions { opacity: 1; }
.cs-row-steer .cs-textarea { background: var(--px-bg-elevated); min-height: 34px; }
.cs-row-steer-foot { display: flex; align-items: center; gap: var(--px-space-2); }
.cs-row-steer-hint { flex: 1; font-size: var(--px-text-xs); color: var(--px-text-muted); }
.cs-row-error { grid-area: err; display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-xs); color: var(--px-danger); }
.cs-canon { display: flex; flex-direction: column; gap: 2px; }
.cs-fact { display: flex; gap: var(--px-space-2); font-size: var(--px-text-sm); line-height: 1.45; padding: 2px 0; cursor: pointer; }
.cs-fact-mark { width: 8px; height: 8px; border-radius: var(--px-radius-full); background: var(--px-divider); flex: 0 0 auto; margin-top: 7px; }
.cs-fact--changed .cs-fact-mark { background: var(--px-accent); }
.cs-pitches { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--px-space-3); }
.cs-pitch { display: flex; flex-direction: column; gap: var(--px-space-1); padding: var(--px-space-3); border: 1px solid var(--px-border); border-radius: var(--px-radius-lg); background: var(--px-bg-elevated); }
.cs-pitch--chosen { border-color: var(--px-accent); background: var(--px-accent-faint); }
.cs-pitch-name { font-weight: 600; font-size: var(--px-text-md); }
.cs-pitch-tag { color: var(--px-text-secondary); font-size: var(--px-text-sm); }
.cs-pitch-hook { font-size: var(--px-text-sm); line-height: 1.45; }
.cs-pitch-line { font-size: var(--px-text-sm); color: var(--px-text-muted); font-style: italic; line-height: 1.45; }
.cs-pitch-foot { display: flex; justify-content: flex-end; margin-top: auto; padding-top: var(--px-space-2); }
.cs-fact--added .cs-fact-mark { background: var(--px-success); }
.cs-fact--off { opacity: .45; text-decoration: line-through; }
.cs-fact-text { min-width: 0; }
.cs-fact-was { display: block; color: var(--px-text-muted); font-size: var(--px-text-xs); text-decoration: none; }
.cs-legend { display: flex; gap: var(--px-space-3); font-size: var(--px-text-xs); color: var(--px-text-muted); }
.cs-legend span { display: inline-flex; align-items: center; gap: 4px; }
.cs-legend i { width: 8px; height: 8px; border-radius: var(--px-radius-full); display: inline-block; background: var(--px-divider); }
.cs-legend i.changed { background: var(--px-accent); }
.cs-legend i.added { background: var(--px-success); }
.cs-try-reply { flex: 1; min-width: 0; background: var(--px-bg-inset); border: 1px solid var(--px-border); border-radius: 12px 12px 12px 4px; padding: var(--px-space-3); font-size: var(--px-text-base); line-height: 1.5; white-space: pre-wrap; min-height: 20px; }
.cs-try-reply:empty { display: none; }
.cs-dials { display: flex; flex-direction: column; gap: 6px; }
.cs-engine { display: flex; align-items: center; gap: var(--px-space-2); font-size: var(--px-text-sm); color: var(--px-text-muted); flex-wrap: wrap; }
.cs-hint { font-size: var(--px-text-xs); color: var(--px-text-muted); }
.cs-back { margin: var(--px-space-3) var(--px-space-5) 0; }
.cs-labelrow { display: flex; align-items: center; justify-content: space-between; gap: var(--px-space-2); }
${CREATIONS_PARTS_CSS}
`;
  document.head.appendChild(style);
}

const FIELD_SIZING = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('field-sizing', 'content');

const SOURCE_ICONS = { link: 'link', canvas: 'file-text', file: 'file', text: 'clipboard' };
/** One example direction per field, shown in the Rewrite box's placeholder. */
const STEER_EXAMPLES = {
  name: 'older, from the same town',
  tagline: 'wry, about the work',
  description: 'more about their daily life',
  appearance: 'older, practical clothes',
  personality: 'warmer and funnier',
  voice: 'more formal, fewer words',
  backstory: 'more detail on the war years and a brother',
  drives: 'make the fear about family',
  secrets: 'something smaller and more human',
  relationships: 'add a rival from work',
  exampleDialogue: 'more teasing, less guarded',
  reminder: 'about the temper',
};

/**
 * @param container host element
 * @param parallx the extension API
 * @param ctx { fs, workspaceUri, fileName?, from?, onCreated(fileName), openChat(fileName, name), openChatBehaviour(fileName), openCharacter(fileName), openNew(from) }
 * @param deps helpers lent by main.js: el, icon, tgSelect, loadSettings, saveSettings, saveCharacter, createCharacterJson,
 *             exportCharacterToMarkdown, ensureNestedDirs, generateId, scanCharacters, resolveUri, ctxPresets, forge
 */
export function renderStudioPane(container, parallx, ctx, deps) {
  injectStudioStyles();
  const { el, icon, tgSelect } = deps;
  const { fs, workspaceUri } = ctx;
  const root = el('div', 'cs');
  container.appendChild(root);

  const state = {
    fileName: ctx.fileName || null,
    base: null,
    sheet: emptySheet(),
    locks: new Set(),
    undo: new Map(),
    mode: 'concept',
    concept: '',
    sources: [],
    twist: '',
    canon: [],
    baseFacts: [],
    excluded: new Set(),
    dials: null,
    dialsTouched: false,
    // Pitches: several takes on the concept; `pitch` is the one the sheet was written from.
    pitches: [],
    pitch: null,
    parentId: null,
    parentName: '',
    busy: false,
    disposed: false,
    dirty: false,
    saveTimer: null,
    savedOnce: !!ctx.fileName,
    engine: { modelId: '', numCtx: 0 },
    hue: null,
  };
  const rows = {};

  // ── Bar ────────────────────────────────────────────────────────────────
  const bar = el('div', 'cs-bar');
  const title = el('input', 'cs-title');
  title.type = 'text';
  title.placeholder = 'Name';
  title.title = 'A name you give is kept when you Generate. Clear it to let the model choose one.';
  title.setAttribute('aria-label', 'Name');
  title.addEventListener('input', () => { setField('name', title.value, { fromTitle: true }); });
  const status = el('span', 'cs-chip', { text: 'Draft' });
  const actions = el('div', 'cs-actions');
  const chatBtn = button('Open Chat', 'message-circle', () => void openChat());
  chatBtn.title = 'Start a chat with this character';
  const exportBtn = button('Export As Markdown', 'file-down', () => void exportMarkdown());
  exportBtn.title = 'Save a Markdown copy of this character';
  const behaviourBtn = button('Chat Behaviour', 'sliders-horizontal', () => void openBehaviour());
  behaviourBtn.title = 'Writing preset, reply length, lorebooks, memory and the other chat settings';
  const twistAgainBtn = button('Twist Again', 'git-branch', () => void twistAgain());
  twistAgainBtn.title = 'A new character that starts from this one, with a new change';
  twistAgainBtn.style.display = 'none';
  actions.append(chatBtn, exportBtn, behaviourBtn, twistAgainBtn);
  bar.append(title, status, actions);
  // The hero: the portrait (click to change its colour), the name bar, the tagline.
  const hero = el('div', 'cs-hero');
  const portraitBtn = el('button', 'cs-portrait-btn');
  portraitBtn.type = 'button';
  portraitBtn.title = 'Change colour';
  portraitBtn.setAttribute('aria-label', 'Change colour');
  const portrait = createPortrait('', { size: 64 });
  portraitBtn.append(portrait, el('span', 'cs-portrait-edit', { html: icon('palette', 11) }));
  portraitBtn.addEventListener('click', () => pickHue());
  const heroText = el('div', 'cs-hero-text');
  const taglineLine = el('div', 'cs-tagline');
  heroText.append(bar, taglineLine);
  hero.append(portraitBtn, heroText);
  root.appendChild(hero);
  const crumbs = el('div', 'cs-crumbs');
  crumbs.style.display = 'none';
  root.appendChild(crumbs);
  const errorLine = el('div', 'cs-error');
  errorLine.style.display = 'none';
  root.appendChild(errorLine);
  const cols = el('div', 'cs-cols');
  const mainCol = el('div', 'cs-main');
  const sideCol = el('div', 'cs-side');
  cols.append(mainCol, sideCol);
  root.appendChild(cols);

  // ── Make ───────────────────────────────────────────────────────────────
  const make = section('Make', 'Concept, sources, a Twist, the dials.');
  mainCol.appendChild(make.root);
  const modes = el('div', 'cs-modes');
  const modeBtn = (key, label) => {
    const b = el('button', 'cs-mode', { text: label });
    b.setAttribute('aria-pressed', state.mode === key ? 'true' : 'false');
    b.addEventListener('click', (e) => { e.stopPropagation(); setMode(key); });
    return b;
  };
  const conceptMode = modeBtn('concept', 'From A Concept');
  const sourcesMode = modeBtn('sources', 'From Sources');
  modes.append(conceptMode, sourcesMode);
  make.head.insertBefore(modes, make.meta);

  const conceptField = el('div', 'cs-field');
  const conceptLabel = el('div', 'cs-label', { text: 'Concept' });
  const conceptArea = el('textarea', 'cs-textarea');
  conceptArea.rows = 3;
  conceptArea.placeholder = 'Describe them in your own words, e.g. "A retired forensic accountant who hears music in ledgers." Your words win over everything else.';
  conceptArea.addEventListener('input', () => { state.concept = conceptArea.value; autogrow(conceptArea); markDirty(); });
  const conceptHead = el('div', 'cs-labelrow');
  conceptHead.appendChild(conceptLabel);
  const conceptRoll = deps.tableRoll ? deps.tableRoll(conceptArea) : null;
  if (conceptRoll) conceptHead.appendChild(conceptRoll);
  conceptField.append(conceptHead, conceptArea);
  make.body.appendChild(conceptField);

  const sourcesField = el('div', 'cs-field');
  sourcesField.appendChild(el('div', 'cs-label', { text: 'Sources' }));
  const sourcesList = el('div', 'cs-sources');
  const sourcesHint = el('div', 'cs-hint', { text: 'A link, a canvas page, a file in this workspace, or pasted text. Fetched here, kept with the character.' });
  const addRow = el('div', 'cs-add');
  const inlineHost = el('div');
  addRow.append(
    smallButton('Add Link', 'link', () => showInline('link')),
    smallButton('Add Canvas Page', 'file-text', () => void addCanvasPage()),
    smallButton('Add File', 'file', () => void addFile()),
    smallButton('Add Text', 'clipboard', () => showInline('text')),
  );
  sourcesField.append(sourcesList, sourcesHint, addRow, inlineHost);
  make.body.appendChild(sourcesField);

  const twistField = el('div', 'cs-field');
  twistField.appendChild(el('div', 'cs-label', { text: 'Twist' }));
  const twistArea = el('textarea', 'cs-textarea');
  twistArea.rows = 2;
  twistArea.placeholder = 'What changes, e.g. "He never made it as an actor and works nights as a hotel security guard." Everything the change does not touch stays true to the sources.';
  twistArea.addEventListener('input', () => { state.twist = twistArea.value; autogrow(twistArea); markDirty(); });
  twistField.append(twistArea);
  make.body.appendChild(twistField);

  const dials = section('Dials', 'Personality, body, face and hair, clothing, story seeds. Only used once you touch them.', true);
  dials.root.classList.add('cs-dials-section');
  make.body.appendChild(dials.root);
  const dialsHost = el('div', 'cs-dials');
  dials.body.appendChild(dialsHost);
  const forgeControls = renderDials(dialsHost);

  const engine = el('div', 'cs-engine');
  engine.appendChild(el('span', null, { text: 'Model' }));
  const modelSelect = tgSelect(parallx, { layout: 'flex', onChange: (v) => { state.engine.modelId = v || ''; void persistEngine({ forgeModelId: v || '' }); } });
  engine.appendChild(modelSelect.element);
  engine.appendChild(el('span', null, { text: 'Context' }));
  const ctxSelect = tgSelect(parallx, {
    layout: 'ctx',
    title: 'Context window for Studio generations',
    items: (deps.ctxPresets || []).map((p) => ({ value: String(p.value), label: p.label })),
    onChange: (v) => { state.engine.numCtx = Number(v) || 0; void persistEngine({ forgeContextWindow: Number(v) || 0 }); },
  });
  engine.appendChild(ctxSelect.element);
  make.body.appendChild(engine);

  const makeActions = el('div', 'cs-actions');
  const diceBtn = button('Roll The Dice', 'dices', () => { void rollDice(); });
  diceBtn.title = 'Randomise every unlocked dial, and roll a want, a fear and a secret from your Character Seeds table';
  const genBtn = button('Generate', 'sparkles', () => void generate(), true);
  genBtn.title = 'Write the whole sheet. Locked rows stay as they are.';
  const pitchBtn = button('Pitch Ideas', 'lightbulb', () => void pitchIdeas());
  pitchBtn.title = 'Several different takes on the concept first; the sheet is written from the one you pick';
  makeActions.append(genBtn, pitchBtn, diceBtn);
  diceBtn.classList.add('cr-dice');
  make.body.appendChild(makeActions);
  const progress = el('div', 'cs-progress');
  const progressFill = el('i');
  progress.appendChild(progressFill);
  make.body.appendChild(progress);

  // ── Pitches ────────────────────────────────────────────────────────────
  const pitchesSec = section('Pitches', 'Pick one; the sheet is written from it.');
  pitchesSec.root.style.display = 'none';
  mainCol.appendChild(pitchesSec.root);
  const pitchList = el('div', 'cs-pitches');
  const pitchMore = smallButton('More Pitches', 'lightbulb', () => void pitchIdeas());
  pitchMore.title = 'Another set of takes';
  pitchesSec.body.append(pitchList, pitchMore);

  // ── Canon ──────────────────────────────────────────────────────────────
  const canon = section('Canon', '');
  canon.root.style.display = 'none';
  mainCol.appendChild(canon.root);
  const legend = el('div', 'cs-legend');
  legend.innerHTML = '<span><i></i>Kept</span><span><i class="changed"></i>Changed</span><span><i class="added"></i>Added</span><span>Click a fact to leave it out</span>';
  const canonList = el('div', 'cs-canon');
  canon.body.append(legend, canonList);

  // ── Sheet ──────────────────────────────────────────────────────────────
  const sheetSec = section('Sheet', 'Edit in place. Lock a row and nothing regenerates it.');
  mainCol.appendChild(sheetSec.root);
  const rowsHost = el('div', 'cs-rows');
  sheetSec.body.appendChild(rowsHost);
  for (const f of STUDIO_FIELDS) {
    if (f.key === 'name') continue; // the name is the title
    rowsHost.appendChild(sheetRow(f));
  }

  // ── Try A Line ─────────────────────────────────────────────────────────
  const trySec = section('Try A Line', 'Say something to them and hear the voice before you commit to it.');
  sideCol.appendChild(trySec.root);
  const tryRow = el('div', 'cs-inline');
  const tryInput = el('input', 'cs-input');
  tryInput.type = 'text';
  tryInput.placeholder = 'Say something to them';
  tryInput.setAttribute('aria-label', 'A line to the character');
  const tryBtn = button('Send', 'send', () => void tryLine());
  tryInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void tryLine(); } });
  tryRow.append(tryInput, tryBtn);
  const tryReply = el('div', 'cs-try-reply');
  const tryYou = el('div', 'cs-try-you');
  const trySaid = el('div', 'cs-try-said');
  const tryPortrait = createPortrait('', { size: 28 });
  trySaid.append(tryPortrait, tryReply);
  const tryThread = el('div', 'cs-try-thread');
  tryThread.append(tryYou, trySaid);
  trySec.body.append(tryThread, tryRow);

  // ── Helpers: DOM ───────────────────────────────────────────────────────
  function button(label, iconName, onClick, primary = false) {
    const b = el('button', `cs-btn${primary ? ' cs-btn--primary' : ''}`, { html: `${iconName ? icon(iconName, 14) : ''}<span>${label}</span>` });
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return b;
  }
  function smallButton(label, iconName, onClick) {
    const b = button(label, iconName, onClick);
    b.classList.add('cs-btn--small');
    return b;
  }
  function iconButton(iconName, hint, onClick) {
    const b = el('button', 'cs-icon-btn', { html: icon(iconName, 14) });
    b.title = hint;
    b.setAttribute('aria-label', hint);
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }
  function section(name, meta, closed = false) {
    const sroot = el('div', `cs-section${closed ? ' cs-section--closed' : ''}`);
    const head = el('div', 'cs-section-head');
    const chev = el('span', 'cs-section-chev', { html: icon('chevron-down', 14) });
    const t = el('span', 'cs-section-title', { text: name });
    const m = el('span', 'cs-section-meta', { text: meta });
    head.append(chev, t, m);
    const body = el('div', 'cs-section-body');
    sroot.append(head, body);
    head.addEventListener('click', () => sroot.classList.toggle('cs-section--closed'));
    return {
      root: sroot, head, body, meta: m, title: t,
      open: () => sroot.classList.remove('cs-section--closed'),
      close: () => sroot.classList.add('cs-section--closed'),
      setMeta: (text) => { m.textContent = text; },
    };
  }
  // Boxes size to their text with CSS field-sizing. Only where that is
  // missing is the height measured, and never while the box is hidden (a
  // hidden box measures 0 and would lock at one line).
  function autogrow(area) {
    if (FIELD_SIZING) { area.style.height = ''; return; }
    if (!area.offsetParent) return;
    area.style.height = 'auto';
    area.style.height = `${Math.max(area.scrollHeight, 34)}px`;
  }
  function paintPortrait() {
    const hue = hueOf({ name: state.sheet.name, hue: state.hue });
    updatePortrait(portrait, state.sheet.name, hue);
    updatePortrait(tryPortrait, state.sheet.name, hue);
  }
  function pickHue() {
    const show = parallx.ui?.showContextMenu;
    if (!show) return;
    show(portraitBtn, [
      { label: 'From The Name', checked: state.hue == null, onSelect: () => { state.hue = null; paintPortrait(); markDirty(); } },
      { separator: true },
      ...PORTRAIT_HUES.map((h) => ({ label: h.label, checked: state.hue === h.hue, onSelect: () => { state.hue = h.hue; paintPortrait(); markDirty(); } })),
    ], { anchorPosition: 'below' });
  }
  // While the sheet streams in: rows still to come shimmer, the next one says
  // Writing, each one that lands glows briefly. Cleared when the run ends.
  function beginWriting(keys) {
    root.classList.add('cs--writing');
    keys.forEach((k, i) => {
      const r = rows[k];
      if (!r) return;
      r.row.classList.add('cs-row--queued');
      r.state.replaceChildren(document.createTextNode(i === 0 ? 'Writing' : 'Up next'));
      if (i === 0) { r.row.classList.add('cs-row--writing'); r.state.appendChild(createDots()); }
    });
    progressFill.style.width = '0%';
  }
  function landRow(key, pending, total) {
    const r = rows[key];
    if (r) {
      r.row.classList.remove('cs-row--queued', 'cs-row--writing');
      r.state.replaceChildren();
      r.row.classList.remove('cr-fresh');
      void r.row.offsetWidth;
      r.row.classList.add('cr-fresh');
    }
    const next = pending.find((k) => rows[k]?.row.classList.contains('cs-row--queued'));
    if (next) {
      const n = rows[next];
      n.row.classList.add('cs-row--writing');
      n.state.replaceChildren(document.createTextNode('Writing'), createDots());
    }
    const done = total - pending.filter((k) => rows[k]?.row.classList.contains('cs-row--queued')).length;
    progressFill.style.width = `${Math.round((done / Math.max(total, 1)) * 100)}%`;
    setStatus(`Writing ${done} of ${total}`, 'accent');
  }
  function endWriting() {
    root.classList.remove('cs--writing');
    for (const k of Object.keys(rows)) {
      rows[k].row.classList.remove('cs-row--queued', 'cs-row--writing');
      rows[k].state.replaceChildren();
    }
  }
  function setStatus(text, tone = '') {
    status.textContent = text;
    status.className = `cs-chip${tone ? ` cs-chip--${tone}` : ''}`;
  }
  function showError(message, retry) {
    errorLine.replaceChildren();
    errorLine.appendChild(el('span', null, { text: message }));
    if (retry) errorLine.appendChild(smallButton('Try Again', 'refresh-cw', retry));
    errorLine.style.display = '';
  }
  function clearError() { errorLine.style.display = 'none'; errorLine.replaceChildren(); }

  function sheetRow(f) {
    const row = el('div', 'cs-row');
    row.dataset.key = f.key;
    const label = el('div', 'cs-row-label');
    label.appendChild(el('span', null, { text: f.label }));
    const lockMark = el('span', 'cs-row-lock', { html: `${icon('lock', 10)}<span>Kept</span>` });
    lockMark.title = 'Locked: Generate and Reroll leave it alone';
    lockMark.style.display = 'none';
    label.appendChild(lockMark);
    const rowState = el('span', 'cs-row-state');
    label.appendChild(rowState);
    label.title = f.hint || '';
    const area = el('textarea', 'cs-row-text');
    area.rows = f.rows;
    area.placeholder = f.hint || '';
    area.setAttribute('aria-label', f.label);
    area.addEventListener('input', () => { state.sheet[f.key] = area.value; autogrow(area); hideUndo(f.key); if (f.key === 'tagline') taglineLine.textContent = area.value.trim(); markDirty(); });
    const acts = el('div', 'cs-row-actions');
    const undoBtn = iconButton('undo-2', `Undo the last reroll of ${f.label.toLowerCase()}`, () => undoReroll(f.key));
    undoBtn.style.display = 'none';
    const lockBtn = iconButton('lock', `Lock ${f.label.toLowerCase()} so Generate and Reroll leave it alone`, () => toggleLock(f.key));
    lockBtn.setAttribute('aria-pressed', 'false');
    const rerollBtn = iconButton('refresh-cw', `Rewrite ${f.label.toLowerCase()}, with a direction if you like`, () => toggleSteer(f.key));
    rerollBtn.setAttribute('aria-expanded', 'false');
    acts.append(undoBtn, lockBtn, rerollBtn);
    // Relationships name people who do not exist yet: make one of them.
    if (f.key === 'relationships') {
      const makeBtn = iconButton('user-plus', 'Make one of these people a character of their own', () => void makeOneOfThem());
      makeBtn.classList.add('cs-make-them');
      acts.appendChild(makeBtn);
    }
    // The direction box: optional. Empty, Rewrite is a fresh take as before.
    const steer = el('div', 'cs-row-steer');
    const steerInput = el('textarea', 'cs-textarea');
    steerInput.rows = 1;
    steerInput.placeholder = `How should it change? e.g. "${STEER_EXAMPLES[f.key] || 'more detail, a different angle'}"`;
    steerInput.setAttribute('aria-label', `How the ${f.label.toLowerCase()} should change`);
    const steerGo = smallButton('Rewrite', 'sparkles', () => void reroll(f.key, steerInput.value));
    steerGo.classList.add('cs-btn--primary');
    const steerCancel = smallButton('Cancel', null, () => closeSteer(f.key));
    steerCancel.classList.add('cs-btn--quiet');
    steerInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); steerGo.click(); }
      if (e.key === 'Escape') { e.preventDefault(); closeSteer(f.key); rerollBtn.focus(); }
    });
    const steerFoot = el('div', 'cs-row-steer-foot');
    steerFoot.append(el('span', 'cs-row-steer-hint', { text: 'Optional. Leave it empty for a fresh take.' }), steerCancel, steerGo);
    steer.append(steerInput, steerFoot);
    const err = el('div', 'cs-row-error');
    err.style.display = 'none';
    const skel = el('div', 'cs-row-skel');
    skel.append(el('span', 'cr-skel'), el('span', 'cr-skel'));
    skel.children[0].style.width = '92%';
    skel.children[1].style.width = '64%';
    row.append(label, area, acts, steer, err, skel);
    rows[f.key] = { row, area, lockBtn, rerollBtn, undoBtn, lockMark, err, steer, steerInput, steerGo, label: f.label, state: rowState };
    return row;
  }
  function setField(key, value, opts = {}) {
    state.sheet[key] = value;
    if (key === 'name') {
      if (!opts.fromTitle) title.value = value;
      paintPortrait();
    } else if (rows[key]) {
      rows[key].area.value = value;
      autogrow(rows[key].area);
      if (key === 'tagline') taglineLine.textContent = value.trim();
    }
    if (!opts.silent) markDirty();
  }
  function fillSheet(sheet, { respectLocks = true, silent = false, skip = [] } = {}) {
    for (const k of STUDIO_KEYS) {
      if (respectLocks && state.locks.has(k)) continue;
      if (skip.includes(k)) continue;
      if (typeof sheet[k] !== 'string') continue;
      setField(k, sheet[k], { silent: true });
    }
    if (!silent) markDirty();
  }
  function toggleLock(key) {
    if (state.locks.has(key)) state.locks.delete(key); else state.locks.add(key);
    if (state.locks.has(key)) closeSteer(key);
    const r = rows[key];
    const on = state.locks.has(key);
    r.lockBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    r.lockMark.style.display = on ? '' : 'none';
    r.row.classList.toggle('cs-row--locked', on);
    r.rerollBtn.disabled = on;
    markDirty();
  }
  function showUndo(key) { rows[key].undoBtn.style.display = ''; rows[key].row.classList.add('cs-row--undo'); }
  function hideUndo(key) { if (!rows[key]) return; rows[key].undoBtn.style.display = 'none'; rows[key].row.classList.remove('cs-row--undo'); state.undo.delete(key); }
  function undoReroll(key) {
    if (!state.undo.has(key)) return;
    const prev = state.undo.get(key);
    hideUndo(key);
    setField(key, prev);
  }
  function rowError(key, message, retry) {
    const r = rows[key];
    r.err.replaceChildren();
    r.err.appendChild(el('span', null, { text: message }));
    if (retry) r.err.appendChild(smallButton('Try Again', 'refresh-cw', retry));
    r.err.style.display = '';
  }
  function toggleSteer(key) {
    const r = rows[key];
    if (!r || state.locks.has(key)) return;
    if (r.row.classList.contains('cs-row--steer')) { closeSteer(key); return; }
    r.row.classList.add('cs-row--steer');
    r.rerollBtn.setAttribute('aria-expanded', 'true');
    r.steerInput.focus();
  }
  function closeSteer(key) {
    const r = rows[key];
    if (!r) return;
    r.row.classList.remove('cs-row--steer');
    r.rerollBtn.setAttribute('aria-expanded', 'false');
  }
  function clearRowError(key) { rows[key].err.style.display = 'none'; rows[key].err.replaceChildren(); }
  function setMode(mode) {
    state.mode = mode;
    conceptMode.setAttribute('aria-pressed', mode === 'concept' ? 'true' : 'false');
    sourcesMode.setAttribute('aria-pressed', mode === 'sources' ? 'true' : 'false');
    sourcesField.style.display = mode === 'sources' ? '' : 'none';
    twistField.style.display = mode === 'sources' ? '' : 'none';
    pitchBtn.style.display = mode === 'sources' ? 'none' : '';
    conceptLabel.textContent = mode === 'sources' ? 'Direction' : 'Concept';
    conceptArea.placeholder = mode === 'sources'
      ? 'Optional. Who the sources are about and what to focus on, e.g. "Jackie Chan, the person, not the films."'
      : 'Describe them in your own words, e.g. "A retired forensic accountant who hears music in ledgers." Your words win over everything else.';
    markDirty();
  }

  // ── Dials: the Forge's controls, same state shape, so its spec builder works ──
  function renderDials(host) {
    const F = deps.forge;
    const d = {
      axes: Object.fromEntries(F.AXES.map((a) => [a.key, 50])),
      gender: F.RANDOM, build: F.RANDOM, bust: F.RANDOM, waist: F.RANDOM, hips: F.RANDOM, skin: F.RANDOM,
      hairColor: F.RANDOM, hairLength: F.RANDOM, eyeColor: F.RANDOM, clothing: F.RANDOM,
      age: 25, height: 67,
      name: '', hairStyle: '', features: '', clothingNotes: '', want: '', fear: '', secret: '', concept: '',
      locks: new Set(),
    };
    state.dials = d;
    const touched = () => { state.dialsTouched = true; markDirty(); };
    const lockFor = (key) => {
      const b = el('button', 'tg-forge-lock', { html: icon('lock', 12) });
      b.title = 'Lock this control so the dice leave it alone';
      b.addEventListener('click', () => { if (d.locks.has(key)) d.locks.delete(key); else d.locks.add(key); b.classList.toggle('tg-forge-lock--on', d.locks.has(key)); });
      return b;
    };
    const sectionTitle = (text) => host.appendChild(el('div', 'tg-forge-section', { text }));
    const sliders = {}; const selects = {}; const pickerLists = {}; const numeric = {}; const texts = {};
    sectionTitle('Personality');
    for (const axis of F.AXES) {
      const row = el('div', 'tg-forge-row');
      row.appendChild(el('span', 'tg-forge-row-label', { text: axis.label }));
      row.appendChild(el('span', 'tg-forge-row-end', { text: axis.low }));
      const s = el('input', 'tg-forge-slider'); s.type = 'range'; s.min = '0'; s.max = '100'; s.value = '50';
      s.addEventListener('input', () => { d.axes[axis.key] = Number(s.value); touched(); });
      sliders[axis.key] = s;
      row.append(s, el('span', 'tg-forge-row-end', { text: axis.high }), lockFor(axis.key));
      host.appendChild(row);
    }
    const pickerRow = (label, key, options) => {
      const row = el('div', 'tg-forge-row');
      row.appendChild(el('span', 'tg-forge-row-label', { text: label }));
      const sel = tgSelect(parallx, { layout: 'flex', items: [F.RANDOM, ...options].map((o) => ({ value: o, label: o })), value: d[key], onChange: (v) => { d[key] = v; touched(); } });
      selects[key] = sel; pickerLists[key] = options;
      row.append(sel.element, lockFor(key));
      host.appendChild(row);
    };
    const numericRow = (label, key, min, max, fmt) => {
      const row = el('div', 'tg-forge-row');
      row.appendChild(el('span', 'tg-forge-row-label', { text: label }));
      const s = el('input', 'tg-forge-slider'); s.type = 'range'; s.min = String(min); s.max = String(max); s.value = String(d[key]);
      const val = el('span', 'tg-forge-row-value', { text: fmt(d[key]) });
      s.addEventListener('input', () => { d[key] = Number(s.value); val.textContent = fmt(d[key]); touched(); });
      numeric[key] = { slider: s, val, min, max, fmt };
      row.append(s, val, lockFor(key));
      host.appendChild(row);
    };
    const textRow = (label, key, placeholder, lockable = false) => {
      const row = el('div', 'tg-forge-row tg-forge-row--text');
      row.appendChild(el('span', 'tg-forge-row-label', { text: label }));
      const inp = el('input', 'cs-input'); inp.type = 'text'; inp.placeholder = placeholder;
      inp.addEventListener('input', () => { d[key] = inp.value; touched(); });
      texts[key] = inp;
      row.appendChild(inp);
      if (lockable) row.appendChild(lockFor(key));
      host.appendChild(row);
    };
    sectionTitle('Body');
    pickerRow('Gender', 'gender', F.GENDERS);
    numericRow('Age', 'age', 18, 80, (v) => String(v));
    numericRow('Height', 'height', 56, 84, F.feetInches);
    pickerRow('Build', 'build', F.BUILDS);
    pickerRow('Bust / Chest', 'bust', F.BUSTS);
    pickerRow('Waist', 'waist', F.WAISTS);
    pickerRow('Hips / Thighs', 'hips', F.HIPS);
    pickerRow('Skin Tone', 'skin', F.SKINS);
    sectionTitle('Face And Hair');
    pickerRow('Hair Colour', 'hairColor', F.HAIR_COLORS);
    pickerRow('Hair Length', 'hairLength', F.HAIR_LENGTHS);
    textRow('Hair Style', 'hairStyle', 'Optional, e.g. a loose braid over one shoulder');
    pickerRow('Eye Colour', 'eyeColor', F.EYE_COLORS);
    textRow('Features', 'features', 'Optional: scars, tattoos, freckles, glasses');
    sectionTitle('Clothing');
    pickerRow('Style', 'clothing', F.CLOTHING);
    textRow('Notes', 'clothingNotes', 'Optional outfit preferences');
    sectionTitle('Story Seeds');
    textRow('Want', 'want', 'Optional: what they openly pursue. The dice roll one from your Character Seeds table.', true);
    textRow('Fear', 'fear', 'Optional: what they privately dread. The dice roll one too.', true);
    textRow('Secret', 'secret', 'Optional: what they hide. The dice roll one too.', true);
    return {
      roll() {
        for (const axis of F.AXES) { if (d.locks.has(axis.key)) continue; d.axes[axis.key] = Math.floor(Math.random() * 101); sliders[axis.key].value = String(d.axes[axis.key]); }
        for (const [key, list] of Object.entries(pickerLists)) { if (d.locks.has(key)) continue; d[key] = list[Math.floor(Math.random() * list.length)]; selects[key].value = d[key]; }
        for (const [key, meta] of Object.entries(numeric)) { if (d.locks.has(key)) continue; d[key] = meta.min + Math.floor(Math.random() * (meta.max - meta.min + 1)); meta.slider.value = String(d[key]); meta.val.textContent = meta.fmt(d[key]); }
        markDirty();
      },
      spec() {
        // The Studio's own name and concept travel separately; the dials only carry attributes.
        return F.buildSpec({ ...d, name: '', concept: '' }).spec;
      },
      /** Want, Fear and Secret from the seeds table, onto the controls. */
      setSeeds(seeds) {
        for (const key of ['want', 'fear', 'secret']) {
          if (typeof seeds[key] !== 'string' || !texts[key]) continue;
          d[key] = seeds[key];
          texts[key].value = seeds[key];
        }
      },
      /** Saved dials back onto the controls, so a reopened character regenerates with the same settings. */
      set(saved) {
        if (!saved || typeof saved !== 'object') return;
        for (const axis of F.AXES) {
          const v = Number(saved.axes && saved.axes[axis.key]);
          if (Number.isFinite(v)) { d.axes[axis.key] = v; sliders[axis.key].value = String(v); }
        }
        for (const key of Object.keys(pickerLists)) if (typeof saved[key] === 'string') { d[key] = saved[key]; selects[key].value = saved[key]; }
        for (const [key, meta] of Object.entries(numeric)) { const v = Number(saved[key]); if (Number.isFinite(v)) { d[key] = v; meta.slider.value = String(v); meta.val.textContent = meta.fmt(v); } }
        for (const [key, inp] of Object.entries(texts)) if (typeof saved[key] === 'string') { d[key] = saved[key]; inp.value = saved[key]; }
        d.locks = new Set(Array.isArray(saved.locks) ? saved.locks : []);
      },
    };
  }

  /** The dice: every unlocked dial, then Want, Fear and Secret from the seeds table (left alone when locked, or when there is no table). */
  async function rollDice() {
    forgeControls.roll();
    state.dialsTouched = true;
    dials.open();
    if (!deps.rollSeed) return;
    const seeds = {};
    for (const key of ['want', 'fear', 'secret']) {
      if (state.dials.locks.has(key)) continue;
      try { const v = await deps.rollSeed(key); if (v) seeds[key] = v; } catch { /* no seed for this one */ }
    }
    if (state.disposed || Object.keys(seeds).length === 0) return;
    forgeControls.setSeeds(seeds);
    markDirty();
  }

  // ── Sources ────────────────────────────────────────────────────────────
  function sourceRow(s) {
    const row = el('div', 'cs-source');
    row.dataset.id = s.id;
    row.appendChild(el('span', 'cs-source-icon', { html: icon(SOURCE_ICONS[s.kind] || 'file', 14) }));
    const t = el('span', 'cs-source-title', { text: s.title || s.ref || 'Source' });
    if (s.ref && s.ref !== s.title) t.appendChild(el('span', 'cs-source-ref', { text: s.ref }));
    t.title = s.ref || '';
    row.appendChild(t);
    const chip = el('span', `cs-chip${s.status === 'error' ? ' cs-chip--danger' : ''}`, { text: sourceChipText(s) });
    if (s.status === 'error' && s.error) chip.title = s.error;
    row.appendChild(chip);
    if (s.status === 'error' && s.error) row.appendChild(el('span', 'cs-source-why', { text: s.error }));
    row.appendChild(iconButton('x', 'Remove this source', () => removeSource(s.id)));
    return row;
  }
  /** The reason a source failed, in the user's words; a bare code is not a reason. */
  function sourceErrorText(err) {
    const m = String((err && err.message) || err || '').trim();
    if (!m || m === 'fetch failed') return 'The page could not be fetched.';
    if (m === 'empty' || m === 'empty page') return 'The page had no readable text.';
    if (m === 'empty file') return 'The file is empty.';
    if (/^Refusing non-HTTPS/i.test(m)) return 'Only https:// links can be fetched.';
    if (/^Host on egress blocklist|PRIVATE_IP|private address/i.test(m)) return 'This address is not allowed.';
    return m;
  }
  function sourceChipText(s) {
    if (s.status === 'fetching') return 'Fetching';
    if (s.status === 'error') return 'Could Not Fetch';
    if (s.condensed) return `${formatWords(s.words)} of ${formatWords(s.totalWords)}`;
    return formatWords(s.words);
  }
  function renderSources() {
    sourcesList.replaceChildren(...state.sources.map(sourceRow));
    sourcesHint.style.display = state.sources.length ? 'none' : '';
  }
  function removeSource(id) { state.sources = state.sources.filter((s) => s.id !== id); renderSources(); markDirty(); }
  async function sourceWordCap() {
    try { const s = await deps.loadSettings(fs, workspaceUri); return Number(s.studioSourceWords) > 0 ? Number(s.studioSourceWords) : DEFAULT_SOURCE_WORDS; } catch { return DEFAULT_SOURCE_WORDS; }
  }
  async function addSource(kind, title, ref, loader) {
    const s = { id: deps.generateId().slice(0, 8), kind, title, ref, text: '', words: 0, totalWords: 0, condensed: false, status: 'fetching' };
    state.sources.push(s);
    renderSources();
    try {
      const raw = await loader();
      const cap = await sourceWordCap();
      const c = condenseText(raw.text, cap);
      if (!c.text) throw new Error('empty');
      Object.assign(s, { title: raw.title || s.title, text: c.text, words: c.words, totalWords: c.totalWords, condensed: c.condensed, status: 'ready' });
      if (state.mode !== 'sources') setMode('sources');
    } catch (err) {
      s.status = 'error';
      s.error = sourceErrorText(err);
    }
    if (state.disposed) return;
    renderSources();
    markDirty();
  }
  function showInline(kind) {
    inlineHost.replaceChildren();
    const wrap = el('div', 'cs-inline');
    let input;
    if (kind === 'link') {
      input = el('input', 'cs-input'); input.type = 'url'; input.placeholder = 'https://';
      input.setAttribute('aria-label', 'Link');
    } else {
      input = el('textarea', 'cs-textarea'); input.rows = 4; input.placeholder = 'Paste the text here';
      input.setAttribute('aria-label', 'Pasted text');
    }
    const add = button('Add', 'plus', () => {
      const v = input.value.trim();
      if (!v) return;
      inlineHost.replaceChildren();
      if (kind === 'link') void addLink(v); else void addSource('text', `Pasted text (${formatWords(v.split(/\s+/).length)})`, '', async () => ({ title: '', text: v }));
    });
    const cancel = button('Cancel', 'x', () => inlineHost.replaceChildren());
    cancel.classList.add('cs-btn--quiet');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (kind === 'link' || e.ctrlKey || e.metaKey)) { e.preventDefault(); add.click(); } if (e.key === 'Escape') cancel.click(); });
    wrap.append(input, add, cancel);
    inlineHost.appendChild(wrap);
    input.focus();
  }
  async function addLink(url) {
    const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    let host = href;
    try { host = new URL(href).hostname.replace(/^www\./, ''); } catch { /* keep the raw text */ }
    await addSource('link', host, href, async () => {
      // One door to the web: Web Research's fetch, with its provenance seed,
      // egress bridge, sanitizer and caps. The Studio reads no page itself.
      let res = null;
      try { res = await parallx.commands.executeCommand('webResearch.fetchReadable', href); } catch { res = null; }
      if (res == null) throw new Error('Add Link needs the Web Research extension');
      if (!res.ok) throw new Error((res.error && res.error.message) || 'fetch failed');
      if (!res.text || !String(res.text).trim()) throw new Error('empty page');
      return { title: res.title || host, text: String(res.text) };
    });
  }
  async function addCanvasPage() {
    let pick = null;
    try { pick = await parallx.commands.executeCommand('canvas.pickPageLink'); } catch { pick = null; }
    if (!pick || !pick.uri) return;
    const pageId = String(pick.uri).split('/').pop();
    await addSource('canvas', pick.title || 'Canvas page', 'canvas page', async () => {
      const md = await parallx.commands.executeCommand('canvas.getPageMarkdown', pageId);
      if (typeof md !== 'string' || !md.trim()) throw new Error('empty page');
      return { title: pick.title || '', text: md };
    });
  }
  async function addFile() {
    let rel = null;
    try { rel = await parallx.window.showInputBox({ prompt: 'A text or Markdown file in this workspace', placeholder: 'notes/plot.md' }); } catch { rel = null; }
    if (!rel || !rel.trim()) return;
    const path = rel.trim().replace(/^[\\/]+/, '');
    await addSource('file', path.split(/[\\/]/).pop(), path, async () => {
      const { content } = await fs.readFile(deps.resolveUri(workspaceUri, path));
      if (!content || !String(content).trim()) throw new Error('empty file');
      return { title: '', text: String(content) };
    });
  }

  // ── Canon ──────────────────────────────────────────────────────────────
  function renderCanon() {
    if (!state.canon.length) { canon.root.style.display = 'none'; twistAgainBtn.style.display = 'none'; return; }
    canon.root.style.display = '';
    const c = canonCounts(state.canon);
    const bits = [`${c.total} facts`];
    if (c.changed) bits.push(`${c.changed} changed`);
    if (c.added) bits.push(`${c.added} added`);
    if (state.excluded.size) bits.push(`${state.excluded.size} left out`);
    canon.setMeta(bits.join(' · '));
    canonList.replaceChildren(...state.canon.map((f, i) => {
      const row = el('div', `cs-fact cs-fact--${f.status}${state.excluded.has(i) ? ' cs-fact--off' : ''}`);
      row.appendChild(el('span', 'cs-fact-mark'));
      const t = el('span', 'cs-fact-text', { text: f.text });
      if (f.status === 'changed' && f.was) t.appendChild(el('span', 'cs-fact-was', { text: `was: ${f.was}` }));
      row.appendChild(t);
      row.title = state.excluded.has(i) ? 'Left out. Click to use it again.' : 'Click to leave this fact out of the next generation.';
      row.addEventListener('click', () => { if (state.excluded.has(i)) state.excluded.delete(i); else state.excluded.add(i); renderCanon(); markDirty(); });
      return row;
    }));
    twistAgainBtn.style.display = state.fileName ? '' : 'none';
  }
  function activeFacts() { return state.canon.filter((_, i) => !state.excluded.has(i)).map((f) => f.text); }

  // ── Model ──────────────────────────────────────────────────────────────
  async function persistEngine(updates) {
    try { const cur = await deps.loadSettings(fs, workspaceUri); await deps.saveSettings(fs, workspaceUri, { ...cur, ...updates }); } catch (err) { console.warn('[Creations] engine pick not saved:', err); }
  }
  async function loadEngine() {
    try {
      const settings = await deps.loadSettings(fs, workspaceUri);
      const models = await parallx.lm.getModels();
      if (!models.length) modelSelect.setItems([{ value: '', label: 'No Models Available' }]);
      else {
        modelSelect.setItems(models.map((m) => ({ value: m.id, label: m.displayName || m.id })));
        const preferred = [settings.forgeModelId, settings.defaultModel].find((id) => id && models.some((m) => m.id === id));
        modelSelect.value = preferred || models[0].id;
      }
      ctxSelect.value = String(settings.forgeContextWindow || 0);
      state.engine.modelId = modelSelect.value || '';
      state.engine.numCtx = Number(ctxSelect.value) || 0;
    } catch (err) { console.warn('[Creations] model list failed:', err); }
  }
  async function resolveModel() {
    const settings = await deps.loadSettings(fs, workspaceUri);
    const models = await parallx.lm.getModels();
    const picked = state.engine.modelId || modelSelect.value || '';
    const modelId = (picked && models.some((m) => m.id === picked)) ? picked
      : (settings.defaultModel && models.some((m) => m.id === settings.defaultModel)) ? settings.defaultModel
        : models[0]?.id;
    if (!modelId) throw new Error('No model is available. Choose one in Settings.');
    const ctxPick = state.engine.numCtx || Number(ctxSelect.value) || 0;
    const numCtx = ctxPick > 0 ? ctxPick : (settings.defaultContextWindow || undefined);
    return { modelId, numCtx };
  }
  async function streamJson(modelId, numCtx, messages, onPartial, temperature = 0.9) {
    const stream = parallx.lm.sendChatRequest(modelId, messages, { temperature, think: false, format: 'json', numCtx });
    let raw = '';
    for await (const chunk of stream) {
      if (state.disposed) break;
      if (chunk && chunk.content) { raw += chunk.content; if (onPartial) onPartial(raw); }
    }
    return { raw, parsed: parseJsonLoose(raw) };
  }
  function context() {
    return {
      name: state.sheet.name.trim(),
      concept: state.mode === 'concept' ? pitchAsConcept(state.concept, state.pitch) : state.concept,
      canon: state.mode === 'sources' ? activeFacts() : [],
      spec: state.dialsTouched && forgeControls ? forgeControls.spec() : '',
      twist: state.mode === 'sources' ? state.twist : '',
    };
  }

  // ── Pitches ────────────────────────────────────────────────────────────
  function renderPitches() {
    if (!state.pitches.length) { pitchesSec.root.style.display = 'none'; return; }
    pitchesSec.root.style.display = '';
    pitchesSec.open();
    pitchList.replaceChildren(...state.pitches.map((p) => {
      const chosen = state.pitch && state.pitch.name === p.name && state.pitch.hook === p.hook;
      const card = el('div', `cs-pitch${chosen ? ' cs-pitch--chosen' : ''}`);
      if (p.name) card.appendChild(el('div', 'cs-pitch-name', { text: p.name }));
      if (p.tagline) card.appendChild(el('div', 'cs-pitch-tag', { text: p.tagline }));
      if (p.hook) card.appendChild(el('div', 'cs-pitch-hook', { text: p.hook }));
      if (p.contradiction) card.appendChild(el('div', 'cs-pitch-hook', { text: p.contradiction }));
      if (p.line) card.appendChild(el('div', 'cs-pitch-line', { text: `"${p.line.replace(/^["']|["']$/g, '')}"` }));
      const foot = el('div', 'cs-pitch-foot');
      const write = smallButton(chosen ? 'Written' : 'Write This One', 'sparkles', () => void generate(p));
      write.classList.add('cs-btn--primary');
      write.disabled = !!chosen;
      foot.appendChild(write);
      card.appendChild(foot);
      return card;
    }));
  }
  async function pitchIdeas() {
    if (state.busy) return;
    clearError();
    if (!state.concept.trim() && !state.dialsTouched) { showError('Write a concept, or roll the dice.'); return; }
    state.busy = true;
    pitchBtn.disabled = true;
    pitchMore.disabled = true;
    setStatus('Pitching', 'accent');
    try {
      const { modelId, numCtx } = await resolveModel();
      const spec = state.dialsTouched && forgeControls ? forgeControls.spec() : '';
      const { parsed } = await streamJson(modelId, numCtx, buildPitchMessages({ concept: state.concept, spec, name: state.sheet.name.trim() }), null, 1.0);
      const pitches = parsePitches(parsed);
      if (pitches.length === 0) throw new Error('The model returned no pitches. Try again, or pick another model.');
      state.pitches = pitches;
      state.pitch = null;
      renderPitches();
      pitchesSec.root.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    } catch (err) {
      showError(`Could not pitch: ${err?.message || String(err)}`, () => void pitchIdeas());
    } finally {
      state.busy = false;
      pitchBtn.disabled = false;
      pitchMore.disabled = false;
      refreshStatus();
    }
  }

  // ── Generate ───────────────────────────────────────────────────────────
  /** `pitch`: write the sheet from this take (Write This One); none: from the concept alone. */
  async function generate(pitch = null) {
    if (state.busy) return;
    clearError();
    state.pitch = pitch && typeof pitch === 'object' ? pitch : null;
    // A pitch names the character unless the user already did.
    if (state.pitch && state.pitch.name && !state.sheet.name.trim()) setField('name', state.pitch.name, { silent: true });
    renderPitches();
    const usable = state.sources.filter((s) => s.status === 'ready' && s.text);
    if (state.mode === 'sources' && usable.length === 0 && state.baseFacts.length === 0) {
      showError('Add at least one source, or switch to From A Concept.');
      return;
    }
    if (state.mode === 'concept' && !state.concept.trim() && !state.dialsTouched) {
      showError('Write a concept, or roll the dice.');
      return;
    }
    state.busy = true;
    genBtn.disabled = true;
    try {
      const { modelId, numCtx } = await resolveModel();
      if (state.mode === 'sources') {
        if (usable.length > 0) {
          setStatus('Extracting Canon', 'accent');
          const { parsed } = await streamJson(modelId, numCtx, buildCanonMessages(usable, state.concept), null, 0.3);
          state.baseFacts = parseCanonFacts(parsed);
          if (state.baseFacts.length === 0) throw new Error('Nothing could be read from the sources.');
        }
        state.canon = state.baseFacts.map((text) => ({ text, status: 'kept', was: '' }));
        state.excluded = new Set();
        if (state.twist.trim()) {
          setStatus('Applying Twist', 'accent');
          const { parsed } = await streamJson(modelId, numCtx, buildTwistMessages(state.baseFacts, state.twist), null, 0.5);
          state.canon = parseTwistedCanon(parsed, state.baseFacts);
        }
        renderCanon();
      }
      setStatus('Writing', 'accent');
      // The name has no lock button: a name that is there when you press
      // Generate is the name, and the prompt is told so. Clear it to let the
      // model choose.
      const keepName = !!state.sheet.name.trim();
      const filled = new Set();
      const pending = STUDIO_KEYS.filter((k) => k !== 'name' && rows[k] && !state.locks.has(k));
      beginWriting(pending);
      const { parsed } = await streamJson(modelId, numCtx, buildSheetMessages(context()), (raw) => {
        const done = extractCompletedFields(raw);
        for (const [k, v] of Object.entries(done)) {
          if (filled.has(k) || state.locks.has(k) || (k === 'name' && keepName)) continue;
          filled.add(k);
          setField(k, cleanFieldValue(k, v), { silent: true });
          if (pending.includes(k)) landRow(k, pending, pending.length);
        }
      });
      if (!parsed || typeof parsed.name !== 'string') throw new Error('The model did not return a character. Try again, or pick another model.');
      fillSheet(cleanSheet(parsed), { skip: keepName ? ['name'] : [] });
      for (const k of STUDIO_KEYS) hideUndo(k);
      renderPitches();
      make.close();
      sheetSec.open();
      scheduleSave(true);
    } catch (err) {
      showError(`Could not generate: ${err?.message || String(err)}`, () => void generate());
      refreshStatus();
    } finally {
      endWriting();
      state.busy = false;
      genBtn.disabled = false;
    }
  }
  async function reroll(key, direction = '') {
    if (state.busy || state.locks.has(key)) return;
    const r = rows[key];
    clearRowError(key);
    state.busy = true;
    r.row.classList.add('cs-row--busy');
    r.rerollBtn.disabled = true;
    r.steerGo.disabled = true;
    try {
      const { modelId, numCtx } = await resolveModel();
      const { parsed } = await streamJson(modelId, numCtx, buildFieldMessages(context(), state.sheet, key, direction));
      const next = parsed && typeof parsed[key] === 'string' ? cleanFieldValue(key, parsed[key]) : '';
      if (!next) throw new Error('nothing came back');
      state.undo.set(key, state.sheet[key]);
      setField(key, next);
      showUndo(key);
      // Done: the box closes and forgets the direction; Undo brings the old text back.
      r.steerInput.value = '';
      closeSteer(key);
    } catch (err) {
      rowError(key, `Could not rewrite ${r.label.toLowerCase()}. ${err?.message || ''}`.trim(), () => void reroll(key, direction));
    } finally {
      state.busy = false;
      r.row.classList.remove('cs-row--busy');
      r.rerollBtn.disabled = state.locks.has(key);
      r.steerGo.disabled = false;
    }
  }
  async function tryLine() {
    const line = tryInput.value.trim();
    if (!line || state.busy) return;
    if (!state.sheet.description && !state.sheet.personality && !state.sheet.voice) { tryReply.textContent = 'Give them a sheet first.'; return; }
    state.busy = true;
    tryBtn.disabled = true;
    tryReply.textContent = '';
    tryYou.textContent = line;
    try {
      const { modelId, numCtx } = await resolveModel();
      const stream = parallx.lm.sendChatRequest(modelId, buildTryLineMessages(state.sheet, line), { temperature: 0.85, think: false, numCtx });
      let text = '';
      for await (const chunk of stream) {
        if (state.disposed) break;
        if (chunk && chunk.content) { text += chunk.content; tryReply.textContent = stripDashes(text); }
      }
      if (!text.trim()) tryReply.textContent = 'No reply came back.';
    } catch (err) {
      tryReply.textContent = `Could not reply: ${err?.message || String(err)}`;
    } finally {
      state.busy = false;
      tryBtn.disabled = false;
    }
  }

  // ── Save ───────────────────────────────────────────────────────────────
  function studioBlock() {
    return {
      mode: state.mode,
      concept: state.concept,
      sources: state.sources.map((s) => ({ id: s.id, kind: s.kind, title: s.title, ref: s.ref, text: s.text, words: s.words, totalWords: s.totalWords, condensed: !!s.condensed, status: s.status === 'ready' ? 'ready' : 'error' })),
      twist: state.twist,
      canon: state.canon,
      baseFacts: state.baseFacts,
      excluded: [...state.excluded],
      locks: [...state.locks],
      dials: state.dialsTouched && state.dials ? { ...state.dials, locks: [...state.dials.locks] } : null,
      parentId: state.parentId || null,
      parentName: state.parentName || '',
      pitch: state.pitch || null,
    };
  }
  function markDirty() {
    if (state.disposed) return;
    state.dirty = true;
    scheduleSave();
  }
  function scheduleSave(now = false) {
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => { state.saveTimer = null; void save(); }, now ? 0 : AUTOSAVE_MS);
    refreshStatus();
  }
  function refreshStatus() {
    if (state.busy) return;
    if (!state.fileName && !state.sheet.name.trim()) { setStatus('Draft'); return; }
    if (state.dirty || state.saveTimer) { setStatus('Saving'); return; }
    setStatus('Saved', 'ok');
  }
  async function save() {
    if (state.disposed && !state.dirty) return;
    if (!state.sheet.name.trim() && !state.fileName) { state.dirty = false; refreshStatus(); return; }
    const created = !state.fileName;
    try {
      if (!state.base) state.base = deps.createCharacterJson({ initialMessages: '' });
      if (!state.fileName) state.fileName = `character-${deps.generateId().slice(0, 8)}.json`;
      const data = characterFromSheet(state.sheet, state.base, studioBlock());
      if (state.hue != null) data.hue = state.hue; else delete data.hue;
      await deps.ensureNestedDirs(fs, workspaceUri, ['.parallx', 'extensions', 'text-generator', 'characters']);
      await deps.saveCharacter(fs, workspaceUri, state.fileName, data);
      state.base = data;
      state.dirty = false;
      if (created) { state.savedOnce = true; try { await ctx.onCreated?.(state.fileName); } catch { /* the rail refresh is cosmetic */ } }
      else { try { await ctx.onSaved?.(state.fileName, state.sheet.name.trim()); } catch { /* the rail label is cosmetic */ } }
      renderCanon();
      void renderCrumbs();
    } catch (err) {
      showError(`Could not save: ${err?.message || String(err)}`, () => void save());
    }
    refreshStatus();
  }

  /** One of the people in Relationships, as a new character in the Studio, with the line as their concept. */
  async function makeOneOfThem() {
    const people = parseRelationshipLines(state.sheet.relationships);
    if (people.length === 0) { showError('Relationships has no "Name: who they are" line yet.'); return; }
    let person = people[0];
    if (people.length > 1) {
      let picked = null;
      try { picked = await parallx.window?.showQuickPick(people.map((p) => ({ label: p.name, description: p.note })), { placeholder: 'Who should get a character of their own?' }); } catch { picked = null; }
      if (!picked) return;
      person = people.find((p) => p.name === picked.label) || people[0];
    }
    if (!(await ensureSaved())) return;
    ctx.openNew?.({ concept: relationConcept(person, state.sheet), name: person.name, relatedTo: { fileName: state.fileName, name: state.sheet.name.trim() } });
  }

  // ── Bar actions ────────────────────────────────────────────────────────
  async function ensureSaved() {
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    if (!state.sheet.name.trim()) { showError('Give them a name first.'); title.focus(); return false; }
    await save();
    return !!state.fileName;
  }
  async function openChat() { if (await ensureSaved()) await ctx.openChat?.(state.fileName, state.sheet.name.trim()); }
  async function openBehaviour() { if (await ensureSaved()) await ctx.openChatBehaviour?.(state.fileName); }
  async function exportMarkdown() {
    const data = characterFromSheet(state.sheet, state.base || deps.createCharacterJson({}), studioBlock());
    await deps.exportCharacterToMarkdown(deps.createCharacterJson(data));
  }
  async function twistAgain() {
    if (!(await ensureSaved())) return;
    ctx.openNew?.({
      parentId: state.base?.id || null,
      parentName: state.sheet.name.trim(),
      sources: state.sources.filter((s) => s.status === 'ready').map((s) => ({ ...s })),
      baseFacts: activeFacts(),
      concept: state.concept,
    });
  }
  async function renderCrumbs() {
    crumbs.replaceChildren();
    crumbs.style.display = 'none';
    if (!state.parentId) return;
    let all = [];
    try { all = await deps.scanCharacters(fs, workspaceUri); } catch { all = []; }
    if (state.disposed) return;
    const byId = new Map(all.map((c) => [c.rawData?.id, { id: c.rawData?.id, name: c.frontmatter?.name || c.rawData?.name || '', fileName: c.fileName, studio: c.rawData?.studio }]));
    const selfId = state.base?.id;
    if (selfId && !byId.has(selfId)) byId.set(selfId, { id: selfId, name: state.sheet.name, fileName: state.fileName, studio: { parentId: state.parentId } });
    const chain = selfId ? lineageOf(byId, selfId) : [];
    if (chain.length < 2) {
      // The parent is known by name even when its file is gone.
      crumbs.append(el('span', null, { text: `From ${state.parentName || 'an earlier character'}` }));
      crumbs.style.display = '';
      return;
    }
    chain.forEach((c, i) => {
      if (i > 0) crumbs.appendChild(el('span', null, { html: icon('chevron-right', 12) }));
      const here = c.id === selfId;
      const b = el('button', `cs-crumb${here ? ' cs-crumb--here' : ''}`, { text: c.name || 'Unnamed' });
      if (!here) { b.title = 'Open this ancestor'; b.addEventListener('click', () => ctx.openCharacter?.(c.fileName)); }
      crumbs.appendChild(b);
    });
    crumbs.style.display = '';
  }

  // ── Load ───────────────────────────────────────────────────────────────
  async function load() {
    if (ctx.fileName) {
      try {
        const { content } = await fs.readFile(deps.resolveUri(workspaceUri, `${deps.extRoot}/characters/${ctx.fileName}`));
        state.base = JSON.parse(content);
      } catch (err) {
        showError(`Could not open this character: ${err?.message || String(err)}`);
        return;
      }
      const st = state.base.studio || {};
      state.hue = Number.isFinite(Number(state.base.hue)) && state.base.hue !== null && state.base.hue !== '' ? Number(state.base.hue) : null;
      state.sheet = sheetFromCharacter(state.base);
      state.mode = st.mode === 'sources' ? 'sources' : 'concept';
      state.concept = st.concept || '';
      state.sources = Array.isArray(st.sources) ? st.sources.map((s) => ({ ...s })) : [];
      state.twist = st.twist || '';
      state.canon = Array.isArray(st.canon) ? st.canon : [];
      state.baseFacts = Array.isArray(st.baseFacts) ? st.baseFacts : [];
      state.excluded = new Set(Array.isArray(st.excluded) ? st.excluded : []);
      state.parentId = st.parentId || null;
      state.parentName = st.parentName || '';
      state.pitch = st.pitch && typeof st.pitch === 'object' ? st.pitch : null;
      for (const k of Array.isArray(st.locks) ? st.locks : []) if (rows[k]) toggleLockSilently(k);
      if (st.dials && state.dials) { forgeControls.set(st.dials); state.dialsTouched = true; dials.setMeta('Set. Roll the dice or move a dial to change them.'); }
      make.close();
    } else if (ctx.from && ctx.from.relatedTo) {
      // One of another character's people: the line as the concept, their
      // name in the title, the Studio open for pitches or a sheet.
      state.concept = ctx.from.concept || '';
      state.sheet.name = ctx.from.name || '';
      state.mode = 'concept';
    } else if (ctx.from) {
      state.parentId = ctx.from.parentId || null;
      state.parentName = ctx.from.parentName || '';
      state.sources = (ctx.from.sources || []).map((s) => ({ ...s }));
      state.baseFacts = [...(ctx.from.baseFacts || [])];
      state.canon = state.baseFacts.map((text) => ({ text, status: 'kept', was: '' }));
      state.concept = ctx.from.concept || '';
      state.mode = 'sources';
    } else if (ctx.concept) {
      // Home's Make Character and Surprise Me: a concept to write from at once.
      state.concept = String(ctx.concept);
      state.mode = 'concept';
    }
    title.value = state.sheet.name;
    conceptArea.value = state.concept; autogrow(conceptArea);
    twistArea.value = state.twist; autogrow(twistArea);
    fillSheet(state.sheet, { respectLocks: false, silent: true });
    setModeSilently(state.mode);
    renderSources();
    renderCanon();
    state.dirty = false;
    refreshStatus();
    paintPortrait();
    await renderCrumbs();
    await loadEngine();
    if (ctx.autoGenerate && !ctx.fileName && state.concept.trim() && !state.disposed) { void generate(); return; }
    if (!ctx.fileName) title.focus();
  }
  function toggleLockSilently(key) {
    state.locks.add(key);
    const r = rows[key];
    r.lockBtn.setAttribute('aria-pressed', 'true');
    r.lockMark.style.display = '';
    r.row.classList.add('cs-row--locked');
    r.rerollBtn.disabled = true;
  }
  function setModeSilently(mode) {
    const wasDirty = state.dirty;
    const timer = state.saveTimer;
    setMode(mode);
    if (!wasDirty) { state.dirty = false; if (state.saveTimer && !timer) { clearTimeout(state.saveTimer); state.saveTimer = null; } }
  }

  void load();

  return {
    /** Forget unsaved edits: the file is being deleted, nothing must write it back. */
    abandon() {
      state.dirty = false;
      if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    },
    dispose() {
      state.disposed = true;
      if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
      if (state.dirty && (state.fileName || state.sheet.name.trim())) void save();
      root.remove();
    },
    /** For tests and probes. */
    __state: state,
  };
}
