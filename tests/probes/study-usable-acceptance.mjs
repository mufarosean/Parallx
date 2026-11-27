// @acceptance: Study is usable: a first question at once, nothing that kills a chapter, his to correct, more than PDFs, and the chat can see his work
// Written from the 21 statements below before the build, by a verifier that did
// not build it, and proved to fail on the app as it was (c06bc26). The builder
// does not edit this file: a check that is wrong is reported, not changed.
//
// What a person must see when the work is done (the phase number is the
// statement's number; PARALLX_PROBE_ONLY takes these numbers):
//
//   Getting to a first question
//    1  a session opens on its first question as soon as one is ready; more
//       arrive while he answers; the screen says how many are ready of how many
//       are planned
//    2  Stop while questions are being made keeps what is ready, and never says
//       nothing was ready when some were
//    3  while questions are being made the screen says what is happening, how
//       many are made, and the time elapsed
//    4  a garbled reply is tried again and never leaves a chapter dead; a
//       chapter the old code left dead comes back on the next start
//    5  every model call of one making asks for the same context size, and no
//       call carries a token cap
//    6  with no model: a message that says so, with a button that leads
//       somewhere useful, and no empty session and no stray tab, however often
//   In a session
//    7  after Explain, Enter moves to the next question (Explain is not asked again)
//    8  Previous shows the question before as it was, changes nothing, Next returns
//    9  a question can be marked to come back to; the mark survives a restart;
//       the marked ones can be studied as a set
//   10  he can overrule the grader both ways; the record and the mastery follow
//   11  he can edit a question's wording and answer; the edit is what he sees next
//   12  when grading fails his answer stays and can be graded again
//   13  a half-typed answer survives closing the tab and closing the app
//   14  Escape closes the setup sheet
//   15  the concept's name is not shown before he answers, and is shown after
//   16  no two questions in a row on the same concept (more than one concept)
//   17  Study Weak Spots is in the Study sidebar; with no history it says nothing
//       is answered yet, not that everything is clean
//   Sources
//   18  a .md and a .txt are offered by Add Material… and studied as a PDF is
//   19  Study This Document… is offered on a .md or .txt open in the editor
//   The chat
//   20  study_results and study_weak_spots return, for a missed question, the
//       question, his answer, the right answer and the source quote
//   21  Discuss in Chat on an answered question opens the chat with all of that
//
// How it runs. Every phase gets its own app, profile and workspace, so one
// failure hides nothing; phases 7 to 15, 17, 20 and 21 start from a copy of a
// workspace in which the app itself made a bank for one chapter. A scripted
// model stands in for the owner's (there is none here): it proves the plumbing,
// never the quality of a question. The mouse and the keys are real.
//
//   xvfb-run -a node tests/probes/study-usable-acceptance.mjs [outDir]
//   PARALLX_PROBE_ONLY=1,4,7-9   only those phases
//   PARALLX_PROBE_EXT=<folder>   load extensions from another folder (to run
//                                the checks against an older Study; said aloud)
//   PROBE_PDFS=<folder>          take the two fixture PDFs from there
//
// What the probe holds on to in the app (the builder keeps these, or the check
// that uses them fails):
//   - the visible Study pane is .st-root; a question is .st-card with its
//     wording in .st-card__q, its choices .st-opt (.st-opt__text; the chosen
//     wrong one gets st-opt--wrong, the right one st-opt--right), its typed
//     answer the card's textarea or input; the verdict is .st-fb.st-fb--show
//     with its words in .st-fb__text (st-fb--ok / st-fb--no); results .st-res
//   - the setup sheet is .st-sheet; chapters are role=option rows, Answer and
//     Mode are role=radio, its start button is named "…Start"
//   - the sidebar: .st-sb, .st-sb__it--material, .st-sb__it--session with
//     data-session-id; the workbench's More Actions… and its Add Material…;
//     a session's tab id ends in :study:session-<id>, the sheet's in :study:setup
//   - everything new is found by the name a person reads (label, title or
//     aria-label): Stop, Previous, Next, Check, Explain, Show Source,
//     Mark… / Marked, Overrule (or Mark as Right / Mark as Wrong), Edit…, Save,
//     Grade Again (or Try Again), Discuss in Chat, Study Weak Spots,
//     Study This Document…; "N of M ready"; an elapsed time such as 0:07 or 7 s
//   - the scripted model reads Study's prompts: the JSON keys the system line
//     names ("concepts", "questions", "settles", "defensible", "points",
//     "rubric"), [Page N] marks, the concept lines "- id N: title. summary …
//     Write: 2 mc, 1 short.", "Points to mark…" and "Student's answer:"
//   - Study's tables as they are, read as "the record": st_sections.mapped_at,
//     st_concepts (mastery, answers, misses, miss_streak), st_questions (stem,
//     answer, options_json, source_quote, concept_id), st_sessions,
//     st_session_items (status, chosen, typed), st_answers
//   - each start of the app here is a new browser origin (the renderer's port
//     changes), so what must survive a restart is kept in Study's database or
//     the workspace, not in localStorage
import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.resolve(process.argv[2] ?? path.join(REPO, 'test-results', 'study-usable-acceptance'));
const ELECTRON = path.join(REPO, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const EXT_DIR = process.env.PARALLX_PROBE_EXT ? path.resolve(process.env.PARALLX_PROBE_EXT) : path.join(REPO, 'ext');
const ONLY = (() => {
  const raw = String(process.env.PARALLX_PROBE_ONLY || '').trim();
  if (!raw) return null;
  const set = new Set();
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    const m = /^(\d+)-(\d+)$/.exec(part);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) set.add(i);
    else if (/^\d+$/.test(part)) set.add(Number(part));
  }
  return set;
})();
const PDF = 'Clark_2003_LDF_Curve_Fitting.pdf';
const NOTES = 'My reserving notes.md';
const TIPS = 'exam tips.txt';
const MAKING = new Set(['concepts', 'questions', 'support', 'distractor', 'rubric']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
async function until(fn, ms = 5000, step = 100) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() >= end) return null;
    await sleep(step);
  }
}

// ── The checks ────────────────────────────────────────────────────────────────
const results = []; // { id, label, ok, got }
function record(id, label, ok, got) {
  const detail = got === undefined ? '' : ` :: ${String(typeof got === 'string' ? got : JSON.stringify(got)).replace(/\s+/g, ' ').slice(0, 420)}`;
  console.log(`${ok ? '  ok ' : ' FAIL'} ${id} ${label}${ok && !detail ? '' : detail}`);
  results.push({ id, label, ok: !!ok });
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
// Two bookmarked PDFs from study-fixture-pdfs.py, and two text files whose
// passages sit far below the first screen, so "opens at the passage" can be seen.
const NOTE_LINES = [
  'The Bornhuetter-Ferguson method adds the expected unreported loss to the actual reported loss for each accident year.',
  'It is stable for immature years because the unreported part does not depend on the losses reported to date.',
  'The Benktander method is a credibility mix of the chain ladder estimate and the Bornhuetter-Ferguson estimate.',
  'The weight given to the chain ladder estimate equals the percentage of ultimate loss reported to date.',
];
const TIP_LINES = [
  'Berquist and Sherman adjust paid losses for changes in the rate at which claims are settled.',
  'Case reserves are restated to a common level of adequacy before the incurred triangle is developed.',
  'A diagnostic triangle of closed to reported counts shows whether the settlement rate has shifted.',
];
async function makeFixtures() {
  const dir = path.join(OUT, 'fixtures');
  await fs.mkdir(dir, { recursive: true });
  const from = process.env.PROBE_PDFS ? path.resolve(process.env.PROBE_PDFS) : '';
  if (from) {
    for (const f of await fs.readdir(from)) if (f.endsWith('.pdf')) await fs.copyFile(path.join(from, f), path.join(dir, f));
  } else {
    let made = null;
    for (const py of ['python3', 'python']) {
      made = spawnSync(py, [path.join(REPO, 'tests', 'probes', 'study-fixture-pdfs.py'), dir], { encoding: 'utf8' });
      if (made.status === 0) break;
    }
    if (!made || made.status !== 0) throw new Error(`study-fixture-pdfs.py failed (python3 with reportlab, or set PROBE_PDFS): ${made && (made.stderr || made.error)}`);
  }
  const filler = (n, word) => Array.from({ length: n }, (_, i) => `${word} ${i + 1}.`).join('\n');
  await fs.writeFile(path.join(dir, NOTES), ['# My reserving notes', '', filler(150, 'Margin note'), '', '## Bornhuetter-Ferguson', '', NOTE_LINES[0], NOTE_LINES[1], '', '## Benktander', '', NOTE_LINES[2], NOTE_LINES[3], ''].join('\n'));
  await fs.writeFile(path.join(dir, TIPS), [filler(110, 'Tip number'), '', ...TIP_LINES, ''].join('\n'));
  return dir;
}

/** A new profile under runs/<name>, and a workspace at `workspace` copied from `from`. */
async function newRoot(name, from, workspace = path.join(OUT, 'runs', name, 'workspace')) {
  const dir = path.join(OUT, 'runs', name);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'app', 'data'), { recursive: true });
  await fs.cp(from, workspace, { recursive: true });
  // No background indexing, suggestions or heartbeat: the probe is the only thing calling the model.
  await fs.mkdir(path.join(workspace, '.parallx'), { recursive: true });
  await fs.writeFile(path.join(workspace, '.parallx', 'ai-config.json'), JSON.stringify({ overrides: { indexing: { autoIndex: false, watchFiles: false }, suggestions: { suggestionsEnabled: false }, heartbeat: { enabled: false } } }));
  return { dir, workspace };
}

// ── The database, read as the app left it ────────────────────────────────────
function dbFile(workspace) { return path.join(workspace, '.parallx', 'extensions', 'study', 'data.db'); }
function dbAll(workspace, sql, params = []) {
  if (!existsSync(dbFile(workspace))) return [];
  const d = new DatabaseSync(dbFile(workspace), { readOnly: true });
  try { return d.prepare(sql).all(...params); } finally { d.close(); }
}
function dbOne(workspace, sql, params = []) { return dbAll(workspace, sql, params)[0] ?? null; }

// <model>
// The scripted model. It is registered in the renderer's language models
// service as provider "probe" with one model, "probe-model", and answers each
// Study prompt from the prompt itself, so making, the checks, grading and
// Explain all run for real. It tells the calls apart by the JSON keys the
// system line asks for, never by its wording. window.__probeModel holds the
// call log and the switches the phases flip (slow, garbled, failing).
function installProbeModel() {
  const svc = window.__parallx_workbench__?._services?.get?.({ id: 'ILanguageModelsService' });
  if (!svc?.registerProvider) return 'no models service';
  const M = (window.__probeModel = window.__probeModel || { calls: [], cfg: {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const words = (s) => s.replace(/[.,;:()]+/g, ' ').split(/\s+/).filter(Boolean);
  // Body sentences only: a heading line (numbered, no full stop) and a bare page number are dropped.
  const sentencesOf = (block) => block.split('\n').map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l) && !(/^\d+(\.\d+)*\.?\s/.test(l) && !/\.$/.test(l)) && !/^\d+$/.test(l))
    .join(' ').replace(/\s+/g, ' ').split(/(?<=[.])\s+(?=[A-Z])/).map((s) => s.trim())
    .filter((s) => s.split(' ').length >= 9 && /\.$/.test(s));
  const pagesOf = (material) => {
    const out = []; const re = /\[Page (\d+)\]([\s\S]*?)(?=\[Page \d+\]|$)/g; let m;
    while ((m = re.exec(material))) out.push({ page: Number(m[1]), text: m[2] });
    return out.length ? out : [{ page: 1, text: material }];
  };
  const pointsOf = (s) => {
    const parts = s.replace(/\.$/, '').split(/,\s+(?:and\s+|which\s+|with\s+)?|\s+and\s+|\.\s+/).map((p) => p.trim()).filter((p) => p.split(' ').length >= 3);
    return (parts.length ? parts : [s]).slice(0, 3).map((t, i) => ({ text: t, required: i < 2 }));
  };
  // The right answer, a wrong one and the quote are three different strings, none inside another.
  const rightOf = (summary) => `${summary.replace(/\.$/, '')}, as the text states.`;
  const wrongOf = (summary, n) => {
    const base = summary.replace(/\.$/, '');
    return [`${base}, but only for the latest accident year.`, `${base}, but only before trending to a common level.`, `${base}, but only for paid losses.`, `${base}, but only when premium is unknown.`].slice(0, n);
  };
  // A stem never carries the concept's title, and no two questions ever share
  // one (each ends in its own reference), so a card is known by its wording.
  let serial = 0;
  const ref = () => `(ref ${(Date.now() % 1679616).toString(36)}${(serial++).toString(36)})`;
  const STEMS = {
    mc: ['Which statement is correct about', 'Which of these does the reading say about', 'Pick the accurate statement on', 'Select what holds for'],
    short: ['In one or two sentences, what is said about', 'State briefly what holds for', 'Say in a sentence what is claimed about', 'Summarise the claim on'],
    essay: ['Explain what is said, and why it matters, about', 'Discuss the reasoning behind', 'Set out the argument on', 'Give the full case for'],
  };
  const info = { id: 'probe-model', displayName: 'Probe Model', family: 'probe', parameterSize: '1B', quantization: 'none', contextLength: 32768, capabilities: ['completion'] };

  function answerFor(kind, system, user, entry) {
    if (kind === 'concepts') {
      const material = user.includes('--- MATERIAL ---') ? user.split('--- MATERIAL ---').slice(1).join('\n') : user;
      const concepts = [];
      for (const p of pagesOf(material)) {
        sentencesOf(p.text).slice(0, 2).forEach((s, i) => concepts.push({
          title: `Idea ${p.page}${'abcd'[i]}: ${words(s).slice(1, 5).join(' ').toLowerCase()}`, summary: s, page: p.page, quote: s,
          essayWorthy: /\b(because|which is why|prefers|sum of|not only)\b/.test(s), quantitative: false, hasFormula: false, term: '',
        }));
      }
      return JSON.stringify({ concepts });
    }
    if (kind === 'questions') {
      const nOpts = Number((/questions have (\d+) options/i.exec(user) || [])[1]) || 4;
      const lines = [...user.matchAll(/^- id (\d+): (.*?)\. (.*?)(?: Taught (?:on|in|at) [a-z ]*?(\d+)\.)? Write: (.*?)\.?$/gm)];
      const questions = [];
      for (const m of lines) {
        const id = Number(m[1]); const summary = m[3].trim(); const page = Number(m[4]) || 1;
        const topic = `“${words(summary).slice(0, 7).join(' ')}…”`;
        for (const ask of m[5].split(',').map((x) => x.trim()).filter(Boolean)) {
          const [nStr, fmt] = ask.split(/\s+/); const n = Number(nStr) || 1;
          for (let k = 0; k < n; k++) {
            const lead = (STEMS[fmt] || [])[k] || `(${k + 1}) ${(STEMS[fmt] || ['Question on'])[0]}`;
            if (fmt === 'mc') {
              const options = [rightOf(summary), ...wrongOf(summary, nOpts - 1)];
              const r = (id + k) % options.length; [options[0], options[r]] = [options[r], options[0]];
              questions.push({ concept: id, format: 'mc', stem: `${lead} ${topic}? ${ref()}`, options, answer: r, explanation: `The text states it directly: ${summary}`, quote: summary, page, difficulty: 'medium' });
            } else if (fmt === 'short' || fmt === 'essay') {
              questions.push({ concept: id, format: fmt, stem: `${lead} ${topic}? ${ref()}`, answer: rightOf(summary), rubric: pointsOf(summary), explanation: summary, quote: summary, page });
            }
          }
        }
      }
      entry.stems = questions.map((q) => q.stem);
      return JSON.stringify({ questions });
    }
    if (kind === 'support') return JSON.stringify({ settles: true, reason: 'The quotation states the answer.' });
    if (kind === 'distractor') return JSON.stringify({ defensible: false, reason: 'It contradicts the quotation.' });
    if (kind === 'grade') {
      const answer = (user.split(/Student's answer:/i)[1] || '').toLowerCase();
      const block = (user.split(/Points to mark[^\n]*:/i)[1] || '').split(/Student's answer:/i)[0];
      const pts = block.split('\n').map((l) => l.trim()).filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, '').replace(/\s*\(supporting detail\)$/, ''));
      const points = (pts.length ? pts : ['']).map((p) => {
        const ws = p.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4);
        const hit = ws.filter((w) => answer.includes(w)).length;
        return { status: ws.length && hit / ws.length >= 0.6 ? 'hit' : hit > 0 ? 'partial' : 'miss', note: '' };
      });
      return JSON.stringify({ points, contradiction: false, note: points.every((p) => p.status === 'hit') ? '' : 'The answer leaves out part of what the text says.' });
    }
    if (kind === 'rubric') { const ref = (user.split(/answer:\n/i)[1] || user).split('\n')[0]; return JSON.stringify({ rubric: pointsOf(ref), contradictions: [] }); }
    if (kind === 'explain') return 'The quotation says this in so many words, so the right answer is the one that restates it.';
    return 'Understood.';
  }

  svc.registerProvider({
    id: 'probe', displayName: 'Probe', local: true,
    async listModels() { return [info]; }, async checkAvailability() { return { available: true }; }, async getModelInfo() { return info; },
    async *sendChatRequest(modelId, messages, options, signal) {
      const C = M.cfg || {};
      const text = (m) => (typeof m?.content === 'string' ? m.content : JSON.stringify(m?.content ?? ''));
      const system = messages.filter((m) => m.role === 'system').map(text).join('\n');
      const user = messages.filter((m) => m.role !== 'system').map(text).join('\n');
      const kind = /"concepts"\s*:/.test(system) ? 'concepts' : /"questions"\s*:/.test(system) ? 'questions'
        : /"settles"\s*:/.test(system) ? 'support' : /"defensible"\s*:/.test(system) ? 'distractor'
        : /"points"\s*:/.test(system) && /contradiction/.test(system) ? 'grade' : /"rubric"\s*:/.test(system) ? 'rubric'
        : /^You explain/.test(system) ? 'explain' : 'other';
      let opts = {}; try { opts = JSON.parse(JSON.stringify(options ?? {})); } catch { opts = { unreadable: true }; }
      const entry = { n: M.calls.length + 1, kind, t0: Date.now(), t1: 0, options: opts, numCtx: options?.numCtx, user: user.slice(0, 12000), all: kind === 'other' ? `${system}\n${user}` : '' };
      M.calls.push(entry);
      try {
        const wait = Number((C.delayByKind || {})[kind] ?? C.delayMs ?? 0);
        for (let waited = 0; waited < wait; waited += 25) { if (signal?.aborted) { entry.aborted = true; return; } await sleep(25); }
        if ((C.failKinds || []).includes(kind)) { entry.failed = true; throw new Error('The model backend returned an error (scripted by the probe).'); }
        let out = answerFor(kind, system, user, entry);
        const g = C.garble;
        if (g && g.left > 0 && (g.kinds || []).includes(kind)) {
          g.left -= 1; entry.garbled = g.mode;
          // Prose where JSON was asked, or JSON cut off inside its first object (nothing in it can be salvaged).
          out = g.mode === 'prose' ? 'Sure! Here are the things you asked for. First, the Cape Cod method is a reserving method. Second, it uses premium.' : out.slice(0, Math.min(46, Math.floor(out.length * 0.6)));
        }
        for (let i = 0; i < out.length; i += 200) { if (signal?.aborted) { entry.aborted = true; return; } yield { content: out.slice(i, i + 200), done: false }; }
        yield { content: '', done: true };
      } finally { entry.t1 = Date.now(); }
    },
  });
  svc.setActiveModel?.('probe-model');
  return 'ok';
}
// </model>

// What the probe reads off the page: the visible Study pane, a control by the
// name a person reads, the card on screen.
function installPageHelpers() {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const shown = (n) => !!n && n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== 'hidden';
  const CLICKABLE = 'button, [role="button"], [role="menuitem"], [role="option"], [role="radio"], [role="tab"], [role="checkbox"], [role="switch"], a[href], summary, input[type="checkbox"]';
  const scopeEl = (scope) => {
    // The Study pane he is looking at: with two side by side, the one in the active editor group.
    if (scope === 'root') { const roots = Array.from(document.querySelectorAll('.st-root')).filter(shown); return roots.find((r) => r.closest('.editor-group--active')) || roots[0] || null; }
    if (scope === 'sidebar') return document.querySelector('[data-part-id="workbench.parts.sidebar"]');
    if (scope === 'editor') return document.querySelector('[data-part-id="workbench.parts.editor"]');
    if (scope === 'chat') return Array.from(document.querySelectorAll('.parallx-chat-widget')).find(shown) || null;
    if (scope === 'body') return document.body;
    return Array.from(document.querySelectorAll(scope)).find(shown) || null;
  };
  // The name a person reads: the words on the control; its tooltip only when it shows no words (an icon).
  const namesOf = (n) => {
    const words = norm(n.textContent);
    return (words ? [n.getAttribute('aria-label'), words] : [n.getAttribute('aria-label'), n.getAttribute('title'), n.getAttribute('data-parallx-title')]).map(norm).filter(Boolean);
  };
  const point = (n) => {
    let r = n.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { n.scrollIntoView({ block: 'center', inline: 'nearest' }); r = n.getBoundingClientRect(); }
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
  window.__ap = {
    shown, scopeEl,
    has: (scope, sel) => { const s = scopeEl(scope); return !!s && Array.from(s.querySelectorAll(sel)).some(shown); },
    text: (scope) => { const s = scopeEl(scope); return s ? String(s.innerText || '') : ''; },
    /** Visible controls in `scope` whose name (label, text or title) matches. */
    find(scope, source, flags, sel) {
      const s = scopeEl(scope);
      if (!s) return [];
      const re = new RegExp(source, flags);
      const out = [];
      for (const n of s.querySelectorAll(sel || CLICKABLE)) {
        if (!shown(n)) continue;
        const name = namesOf(n).find((x) => re.test(x));
        if (name === undefined) continue;
        const pressed = n.getAttribute('aria-pressed') ?? n.getAttribute('aria-checked') ?? (n.tagName === 'INPUT' && n.type === 'checkbox' ? String(n.checked) : null);
        out.push({ ...point(n), name, disabled: !!n.disabled || n.getAttribute('aria-disabled') === 'true', pressed, id: n.getAttribute('data-px-id') || '', cls: String(n.className || '') });
      }
      return out;
    },
    /** The question on screen, or null. */
    card() {
      const r = scopeEl('root');
      const c = r && Array.from(r.querySelectorAll('.st-card')).find(shown);
      if (!c) return null;
      const fb = Array.from(r.querySelectorAll('.st-fb')).find((f) => f.classList.contains('st-fb--show') && shown(f)) || null;
      const field = Array.from(c.querySelectorAll('textarea, input[type="text"], input:not([type])')).find(shown) || null;
      return {
        stem: norm(c.querySelector('.st-card__q')?.innerText),
        format: c.dataset.format || '',
        options: Array.from(c.querySelectorAll('.st-opt')).filter(shown).map((o) => ({ ...point(o), text: norm((o.querySelector('.st-opt__text') || o).innerText), cls: String(o.className) })),
        field: field ? { ...point(field), value: field.value, disabled: !!field.disabled } : null,
        verdict: fb ? norm(fb.querySelector('.st-fb__text')?.innerText || fb.innerText).slice(0, 80) : '',
        fbClass: fb ? String(fb.className) : '',
        fbText: fb ? norm(fb.textContent) : '',
      };
    },
    /** Visible text fields anywhere, with what they hold (the edit form of phase 11). */
    fields() {
      return Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]')).filter(shown)
        .map((n) => ({ ...point(n), value: norm(n.value !== undefined ? n.value : n.innerText), inChat: !!n.closest('.parallx-chat-widget') }));
    },
    tabs: () => Array.from(document.querySelectorAll('.ui-tab')).map((t) => ({ id: t.getAttribute('data-tab-id') || '', active: t.classList.contains('ui-tab--active'), label: norm(t.querySelector('.ui-tab-label')?.textContent) })),
    notices: () => Array.from(document.querySelectorAll('.parallx-notification, .parallx-modal-box')).filter(shown).map((n) => norm(n.innerText)).join('\n'),
  };
  return true;
}

// ── One app ──────────────────────────────────────────────────────────────────
const pageErrors = [];
let shotN = 0;
async function launch(dir, workspace, { model = true } = {}) {
  const appRoot = path.join(dir, 'app');
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: workspace }));
  try { await fs.symlink(EXT_DIR, path.join(appRoot, 'ext'), 'junction'); } catch { /* already there */ }
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
  Object.assign(env, { PARALLX_TEST_MODE: '1', PARALLX_RENDERER_PORT: '0', PARALLX_APP_ROOT: appRoot, PARALLX_USER_DATA: path.join(appRoot, 'data', 'chromium-cache') });
  // Chromium refuses to run as root with its sandbox on (a container's user).
  const args = process.getuid?.() === 0 ? ['--no-sandbox', '.', '--mute-audio', '--disable-gpu'] : ['.', '--mute-audio', '--disable-gpu'];
  const app = await electron.launch({ executablePath: ELECTRON, args, cwd: REPO, env, timeout: 90_000 });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 120_000 });
  await page.waitForFunction(() => !!window.__parallx_workbench__?._services, null, { timeout: 60_000 });
  await page.waitForTimeout(1_200);
  const on = await page.evaluate(async () => { try { await window.__parallx_workbench__._services.get({ id: 'IToolEnablementService' }).setEnablement('parallx-community.study', true); return true; } catch (e) { return String(e); } });
  if (on !== true) throw new Error(`Study could not be turned on: ${on}`);
  // Study has finished starting once its last registration (the chat tools) is in.
  await page.waitForFunction(() => { try { return !!window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool('study_results'); } catch { return false; } }, null, { timeout: 60_000 });
  await page.waitForTimeout(600);
  await page.evaluate(installPageHelpers);
  if (model) { const r = await page.evaluate(installProbeModel); if (r !== 'ok') throw new Error(`scripted model not registered: ${r}`); }
  return { app, page };
}

/** The handle a phase works through. */
function makeSession({ dir, workspace }, opts) {
  const S = {
    dir, workspace, app: null, page: null, opts,
    async open() { const a = await launch(dir, workspace, opts); S.app = a.app; S.page = a.page; },
    async close() { try { await S.app?.close(); } catch { /* gone */ } S.app = null; S.page = null; },
    async relaunch(next = opts) { await S.close(); S.opts = next; const a = await launch(dir, workspace, next); S.app = a.app; S.page = a.page; },
    cmd: (id, ...args) => S.page.evaluate(async ({ id, args }) => {
      const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' });
      try { const r = await svc.executeCommand(id, ...args); return { ok: true, r: r === undefined ? null : (typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r) }; } catch (e) { return { ok: false, e: String((e && e.message) || e) }; }
    }, { id, args }),
    /** Start a command and do not wait for it: one that ends in a message only returns when the message goes. */
    run: (id, ...args) => { void S.page.evaluate(({ id, args }) => { void window.__parallx_workbench__._services.get({ id: 'ICommandService' }).executeCommand(id, ...args).catch(() => {}); }, { id, args }).catch(() => {}); },
    shot: async (name) => { try { const f = path.join(OUT, 'shots', `${String(++shotN).padStart(2, '0')}-${name}.png`); await S.page.screenshot({ path: f }); return f; } catch { return ''; } },
    text: (scope = 'root') => S.page.evaluate((scope) => window.__ap.text(scope), scope),
    has: (scope, sel) => S.page.evaluate(({ scope, sel }) => window.__ap.has(scope, sel), { scope, sel }),
    card: () => S.page.evaluate(() => window.__ap.card()),
    tabs: () => S.page.evaluate(() => window.__ap.tabs()),
    notices: () => S.page.evaluate(() => window.__ap.notices()),
    find: (scope, re, sel) => S.page.evaluate(({ scope, source, flags, sel }) => window.__ap.find(scope, source, flags, sel), { scope, source: re.source, flags: re.flags, sel }),
    /** Click, with the real mouse, the first enabled control in `scope` named like `re`. */
    async press(scope, re, sel) {
      const hit = (await S.find(scope, re, sel)).find((h) => !h.disabled);
      if (!hit) return null;
      await S.page.mouse.click(hit.x, hit.y);
      return hit;
    },
    click: (pt) => S.page.mouse.click(pt.x, pt.y),
    model: (cfg) => S.page.evaluate((cfg) => { window.__probeModel.cfg = cfg; }, cfg),
    installModel: async () => { const r = await S.page.evaluate(installProbeModel); if (r !== 'ok') throw new Error(`scripted model not registered: ${r}`); },
    calls: () => S.page.evaluate(() => (window.__probeModel ? window.__probeModel.calls : []).map((c) => ({ n: c.n, kind: c.kind, t0: c.t0, t1: c.t1, numCtx: c.numCtx, options: c.options, garbled: c.garbled || '', failed: !!c.failed, all: c.all }))),
    /** Resolves once the model has been left alone for `quiet` ms (true), or after `cap` ms (false). */
    async modelIdle(quiet = 2000, cap = 60_000) {
      const start = Date.now();
      return !!(await until(async () => {
        const calls = await S.calls();
        if (calls.some((x) => !x.t1)) return false;
        const last = calls.length ? Math.max(...calls.map((x) => x.t1)) : start;
        return Date.now() - Math.max(last, start) >= quiet;
      }, cap, 150));
    },
    all: (sql, params) => dbAll(S.workspace, sql, params),
    one: (sql, params) => dbOne(S.workspace, sql, params),
    /** The question on the card, from Study's own table (by its wording). */
    question(stem) {
      const rows = S.all('SELECT q.*, c.title AS concept_title FROM st_questions q LEFT JOIN st_concepts c ON c.id = q.concept_id');
      const want = norm(stem);
      const row = rows.find((q) => norm(q.stem) === want) || rows.find((q) => want && norm(q.stem).startsWith(want.slice(0, 48))) || null;
      if (!row) return null;
      let options = []; try { options = JSON.parse(row.options_json || '[]'); } catch { options = []; }
      const right = row.format === 'mc' ? norm(options[Number(row.answer)]) : norm(row.answer);
      return { ...row, options: options.map(norm), right, quote: norm(row.source_quote) };
    },
    newestSession: () => Number(dbOne(S.workspace, 'SELECT MAX(id) AS id FROM st_sessions')?.id) || 0,
  };
  return S;
}

function must(value, what) {
  if (!value) throw new Error(`could not find ${what}`);
  return value;
}

// ── Steps a person takes, shared by the phases ───────────────────────────────
async function showStudySidebar(S) {
  if (await S.page.evaluate(() => window.__ap.shown(document.querySelector('.st-sb')))) return true;
  await S.press('body', /^Study$/, '.activity-bar-item');
  return !!(await until(() => S.page.evaluate(() => window.__ap.shown(document.querySelector('.st-sb'))), 5000));
}
const sheetOpen = (S) => S.has('root', '.st-sheet');
/** The setup sheet for a file already in the workspace (the command takes the path; phase 18 uses the picker itself). */
async function openSheet(S, file = PDF) {
  S.run('study.addMaterial', path.join(S.workspace, file));
  const open = await until(() => sheetOpen(S), 12_000);
  if (!open) throw new Error(`the setup sheet did not open for ${file}: ${norm(await S.notices()).slice(0, 200)}`);
  await sleep(400);
}
const pressStart = async (S) => (await S.press('root', /./, '[data-px-id="study.setup.start"]')) || (await S.press('root', /^(make questions and )?start\b/i, 'button'));
/** Start from the sheet; returns the session it made (the newest one when Start made none of its own). */
async function startSession(S, { file = PDF, chapter = null, answer = null } = {}) {
  await openSheet(S, file);
  if (chapter) { must(await S.press('root', chapter, '[role="option"], .st-outline__o'), `the chapter ${chapter} on the sheet`); await sleep(250); }
  if (answer) { must(await S.press('root', new RegExp(`^${answer}$`), '[role="radio"]'), `the Answer choice ${answer}`); await sleep(250); }
  const before = S.newestSession();
  must(await pressStart(S), 'the Start button on the sheet');
  return (await until(() => { const n = S.newestSession(); return n > before ? n : null; }, 6000, 100)) || S.newestSession();
}
const answerable = (card) => !!card && !!card.stem && (card.options.length > 0 || !!card.field);
const waitCard = (S, ms = 20_000) => until(async () => { const c = await S.card(); return answerable(c) ? c : null; }, ms, 100);
/** The question on screen in session `id`'s own tab (another session's tab may be in front for a moment). */
const sessionCard = (S, id, ms = 20_000) => until(async () => {
  const mine = (await S.tabs()).find((t) => t.id.endsWith(`:study:session-${id}`));
  if (mine && !mine.active) return null;
  const c = await S.card();
  return answerable(c) ? c : null;
}, ms, 100);
/** The session's question, or null once the model has been left alone for `quiet` ms with none on screen. */
async function cardOrQuiet(S, id, { quiet = 3000, cap = 60_000 } = {}) {
  const start = Date.now();
  for (;;) {
    const card = await sessionCard(S, id, 250);
    if (card) return card;
    const calls = await S.calls();
    const last = calls.length ? Math.max(...calls.map((x) => x.t1)) : 0;
    if (!calls.some((x) => !x.t1) && Date.now() - Math.max(last, start) >= quiet) return null;
    if (Date.now() - start > cap) return null;
  }
}
/** Wait for the card to be a different question from `stem`. */
const waitOther = (S, stem, ms = 5000) => until(async () => { const c = await S.card(); return answerable(c) && c.stem !== stem ? c : null; }, ms, 80);
/** The verdict on the card, read once the answer has landed (Next is enabled) and a moment has passed, as it has for a person. */
async function waitVerdict(S, ms = 8000) {
  const seen = await until(async () => { const c = await S.card(); return c && c.verdict ? c : null; }, ms, 80);
  if (!seen) return null;
  await until(async () => (await S.find('root', /^Next\b/, 'button')).some((h) => !h.disabled), 3000, 80);
  await sleep(450);
  return (await S.card()) || seen;
}
async function chooseOption(S, card, text) {
  const opt = must(card.options.find((o) => o.text === text), `the option "${text.slice(0, 50)}…"`);
  await S.click(opt);
  return must(await waitVerdict(S), 'a verdict after choosing');
}
async function typeAnswer(S, card, text, { enter = true } = {}) {
  await S.click(must(card.field, 'the answer box'));
  await S.page.keyboard.type(text);
  if (enter) await S.page.keyboard.press('Enter');
}
async function pressNext(S, stem) {
  must(await until(() => S.press('root', /^Next\b/, 'button'), 4000), 'an enabled Next');
  return until(async () => { const c = await S.card(); return !c || c.stem !== stem ? (c || 'end') : null; }, 5000, 80);
}
/** Open a session from its row in the Study sidebar. */
async function reopenSession(S, id) {
  must(await showStudySidebar(S), 'the Study sidebar');
  const row = await until(() => S.press('sidebar', /./, `.st-sb__it--session[data-session-id="${id}"]`), 6000);
  must(row, `the session's row in the sidebar (data-session-id ${id})`);
  return waitCard(S, 12_000);
}
const NOTHING_READY = /before any question was ready|no questions? (could be|were|was|have been) made|nothing (was|is|has been) ready|no questions? (is|are|were|was) ready/i;
function readyOf(text) {
  const t = String(text || '').replace(/\s+/g, ' ');
  const m = /(\d+)\s*(?:of|\/|out of)\s*(\d+)\s*(?:questions?\s*)?(?:are\s*|is\s*)?(?:ready|made|written)\b/i.exec(t) || /\b(?:ready|made|written)\s*:?\s*(\d+)\s*(?:of|\/|out of)\s*(\d+)/i.exec(t);
  return m ? { ready: Number(m[1]), planned: Number(m[2]) } : null;
}
/** Every time-looking token of a text, in seconds: 0:07, 1:02:03, 7 s, 12 sec, 1 min 5 s. */
function elapsedIn(text) {
  const t = String(text || '');
  const out = [];
  for (const m of t.matchAll(/(?<![\d:.])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d:])/g)) out.push(m[3] !== undefined ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : Number(m[1]) * 60 + Number(m[2]));
  for (const m of t.matchAll(/(\d+)\s*(?:m|min|mins|minutes?)\s*(\d+)\s*(?:s|sec|secs|seconds?)\b/gi)) out.push(Number(m[1]) * 60 + Number(m[2]));
  for (const m of t.matchAll(/(?<![\d:.])(\d+)\s*(?:s|sec|secs|seconds?)\b/gi)) out.push(Number(m[1]));
  return out;
}

// ── The phases ───────────────────────────────────────────────────────────────
const PHASES = [];
const phase = (n, title, base, checks, fn, opts = {}) => PHASES.push({ n, title, base, checks, fn, opts });

phase(1, 'A session opens on its first question as soon as one is ready', 'plain', {
  '1.1': 'the first question is answerable after no more model calls than it takes to make one question',
  '1.2': 'the screen says how many are ready of how many are planned',
  '1.3': 'more questions arrive while the first is still on screen',
  '1.4': 'he answers the first question while later ones are still being made',
}, async (S, c) => {
  await S.model({ delayMs: 450 });
  await startSession(S, { chapter: /Cape Cod/ });
  // The calls one question takes: the map, the writing call, and every check
  // that names the first question written. Counted from the model's own log.
  const look = () => S.page.evaluate(() => {
    const calls = window.__probeModel.calls;
    const qi = calls.findIndex((x) => x.kind === 'questions');
    const stem = qi >= 0 ? (calls[qi].stems || [])[0] || '' : '';
    let last = qi;
    if (stem) for (let j = qi + 1; j < calls.length; j++) if ((calls[j].kind === 'support' || calls[j].kind === 'distractor') && calls[j].user.includes(stem)) last = j;
    const card = window.__ap.card();
    return {
      oneQuestion: qi >= 0 ? last + 1 : 0, done: calls.filter((x) => x.t1 > 0).length, started: calls.length,
      doneSince: qi >= 0 ? calls.filter((x, j) => j > last && x.t1 > 0).length : 0,
      card: card && card.stem && (card.options.length || card.field) ? card : null,
    };
  });
  let at = null; let last = null;
  const end = Date.now() + 120_000;
  while (Date.now() < end) {
    last = await look();
    if (last.card) { at = last; break; }
    if (last.oneQuestion && last.doneSince >= 5) break; // the first question was ready five calls ago
    await sleep(60);
  }
  await S.shot('01-while-making');
  if (!at) {
    const why = `no question on screen after ${last ? last.done : 0} model calls; one question took ${last ? last.oneQuestion : '?'}`;
    c('1.1', false, why);
    for (const id of ['1.2', '1.3', '1.4']) c(id, false, 'no first question while questions were being made');
    return;
  }
  c('1.1', at.done <= at.oneQuestion + 1, { callsDoneWhenAnswerable: at.done, callsForOneQuestion: at.oneQuestion });
  const r1 = readyOf(await S.text());
  c('1.2', !!r1 && r1.ready >= 1 && r1.planned > r1.ready, r1 ?? norm(await S.text()).slice(0, 200));
  const rose = await until(async () => {
    const card = await S.card(); const r = readyOf(await S.text());
    return card && card.stem === at.card.stem && !card.verdict && r && r1 && r.ready > r1.ready ? r : null;
  }, 25_000, 150);
  c('1.3', !!rose, { first: r1, later: rose });
  const card = await S.card();
  const tAnswer = Date.now();
  if (card && card.options.length) await S.click(card.options[0]);
  else if (card && card.field) await typeAnswer(S, card, 'An answer typed while more are made.');
  const verdict = await waitVerdict(S, 10_000);
  await sleep(1500);
  const after = (await S.calls()).filter((x) => MAKING.has(x.kind) && x.t0 > tAnswer).length;
  c('1.4', !!verdict && after > 0, { verdict: verdict ? verdict.verdict : null, makingCallsAfterHisAnswer: after });
});

phase(2, 'Stop keeps what is ready', 'plain', {
  '2.1': 'Stop, pressed with questions ready, never says nothing was ready',
  '2.2': 'what was ready can be studied: he goes through exactly the questions that were ready',
  '2.3': 'after Stop the model is asked for nothing more',
}, async (S, c) => {
  await S.model({ delayMs: 250 });
  await startSession(S, { chapter: /Cape Cod/ });
  const kept = await until(() => { const n = Number(S.one('SELECT COUNT(*) AS n FROM st_questions')?.n) || 0; return n >= 2 ? n : null; }, 90_000, 150);
  must(kept, 'two questions kept while making');
  const stop = await S.press('root', /^Stop\b/i, 'button');
  const tStop = Date.now();
  if (!stop) { for (const id of ['2.1', '2.2', '2.3']) c(id, false, `no Stop button while questions were being made (${kept} were ready)`); return; }
  await S.modelIdle(1500, 20_000);
  await sleep(600);
  const text = norm(await S.text());
  const ready = Number(S.one('SELECT COUNT(*) AS n FROM st_questions')?.n) || 0;
  await S.shot('02-after-stop');
  c('2.1', !NOTHING_READY.test(text), `${ready} were ready; the screen: ${text.slice(0, 160)}`);
  // He goes through what the session holds: it is every question that was ready.
  const sid = S.newestSession();
  let card = await sessionCard(S, sid, 4000);
  const first = !!card;
  let studied = 0;
  while (card && studied < ready + 3) {
    if (card.options.length) await S.click(card.options[0]); else await typeAnswer(S, card, 'An answer to a question that was ready.');
    if (!(await waitVerdict(S, 10_000))) break;
    studied += 1;
    const nxt = await pressNext(S, card.stem).catch(() => null);
    card = nxt && nxt !== 'end' ? await S.card() : null;
  }
  c('2.2', first && studied === Math.min(ready, 20), { questionOnScreen: first, ready, studied });
  await sleep(3000);
  const late = (await S.calls()).filter((x) => MAKING.has(x.kind) && x.t0 > tStop + 2000);
  c('2.3', late.length === 0, late.map((x) => x.kind));
});

phase(3, 'While questions are being made the screen says what, how many and how long', 'plain', {
  '3.1': 'what is happening: the words change from finding the concepts to writing the questions',
  '3.2': 'how many are made: none at first, then the number kept',
  '3.3': 'the time elapsed is on screen and counts up',
}, async (S, c) => {
  await S.model({ delayByKind: { concepts: 5200 }, delayMs: 800 });
  await startSession(S, { chapter: /Cape Cod/ });
  const inFlight = (kind) => until(async () => { const calls = await S.calls(); const cur = calls[calls.length - 1]; return cur && cur.kind === kind && !cur.t1 ? cur : null; }, 30_000, 60);
  must(await inFlight('concepts'), 'the first model call');
  await sleep(700);
  const a1 = await S.text(); const tA1 = Date.now();
  await S.shot('03-finding-concepts');
  await sleep(3000);
  const a2 = await S.text(); const dt = (Date.now() - tA1) / 1000;
  must(await inFlight('questions'), 'the call that writes questions');
  await sleep(300);
  const b = await S.text();
  // The status words, without the numbers and the times that tick anyway.
  const lines = (t) => new Set(String(t).split('\n').map((l) => norm(l.replace(/\d+/g, ''))).filter((l) => l.split(' ').length >= 2));
  const la = lines(a1); const lb = lines(b);
  const onlyA = [...la].filter((l) => !lb.has(l)); const onlyB = [...lb].filter((l) => !la.has(l));
  c('3.1', onlyA.length > 0 && onlyB.length > 0, { whileFinding: onlyA.slice(0, 2), whileWriting: onlyB.slice(0, 2) });
  const r0 = readyOf(a1);
  const keptRow = await until(() => { const n = Number(S.one('SELECT COUNT(*) AS n FROM st_questions')?.n) || 0; return n >= 1 ? n : null; }, 60_000, 150);
  const seen = await until(async () => { const r = readyOf(await S.text()); return r && r.ready >= 1 ? r : null; }, 6000, 150);
  const keptNow = Number(S.one('SELECT COUNT(*) AS n FROM st_questions')?.n) || 0;
  await S.shot('03-some-made');
  c('3.2', !!r0 && r0.ready === 0 && !!seen && seen.ready <= keptNow && !!keptRow, { atFirst: r0, later: seen, keptInTheBank: keptNow });
  const e1 = elapsedIn(a1); const e2 = elapsedIn(a2);
  const counted = e1.some((x) => e2.some((y) => y > x && Math.abs((y - x) - dt) <= 1.6));
  c('3.3', counted, { secondsApart: Math.round(dt * 10) / 10, timesOnScreenFirst: e1, timesOnScreenLater: e2, screen: norm(a2).slice(0, 200) });
});

phase(4, 'A garbled reply never leaves a chapter dead', 'plain', {
  '4.1': 'prose where JSON was asked, on a chapter\'s first reply, is asked again without him doing anything',
  '4.2': 'that same start still ends with a question on screen',
  '4.3': 'after a start in which every reply was cut-off JSON, starting again on that chapter makes questions',
  '4.4': 'a chapter the old code left dead (mapped, with no concepts) makes questions on the next start',
}, async (S, c) => {
  // 4.1, 4.2: chapter 2, first reply is prose.
  await S.model({ garble: { kinds: ['concepts'], mode: 'prose', left: 1 } });
  let sid = await startSession(S, { chapter: /Growth Curves/ });
  let card = await cardOrQuiet(S, sid);
  let calls = await S.calls();
  const maps = calls.filter((x) => x.kind === 'concepts');
  await S.shot('04-after-prose');
  c('4.1', maps.length >= 2 && !!maps[0].garbled && maps.slice(1).some((x) => !x.garbled), { mapCalls: maps.map((x) => x.garbled || 'good'), allCalls: calls.length });
  c('4.2', !!card, card ? card.stem : norm(await S.text()).slice(0, 160));
  // 4.3: chapter 4, every reply of the first start is cut off; then the model is well again.
  const n0 = calls.length;
  await S.model({ garble: { kinds: ['concepts', 'questions'], mode: 'cut', left: 9999 } });
  await startSession(S, { chapter: /Variance/ });
  await until(async () => (await S.calls()).length > n0, 8000);
  await S.modelIdle(2500, 30_000);
  const firstTry = (await S.calls()).slice(n0);
  await S.model({});
  sid = await startSession(S, { chapter: /Variance/ });
  card = await cardOrQuiet(S, sid);
  const inCh4 = Number(S.one('SELECT COUNT(*) AS n FROM st_questions WHERE source_page BETWEEN 11 AND 14')?.n) || 0;
  await S.shot('04-after-cut-off');
  c('4.3', !!card && inCh4 > 0, { firstStartCalls: firstTry.length, secondStartCalls: (await S.calls()).length - n0 - firstTry.length, questionsOnThatChapter: inCh4, screen: card ? card.stem : norm(await S.text()).slice(0, 140) });
  // 4.4: the state the old code leaves, written as it writes it: the chapter's
  // section stamped as mapped, and not one concept on its pages.
  await S.close();
  const before = dbOne(S.workspace, 'SELECT (SELECT COUNT(*) FROM st_concepts WHERE page BETWEEN 1 AND 2) AS concepts, (SELECT mapped_at FROM st_sections WHERE page_from = 1) AS mapped');
  const d = new DatabaseSync(dbFile(S.workspace));
  try { d.prepare('UPDATE st_sections SET mapped_at = ? WHERE page_from = 1').run(Date.now() - 86_400_000); } finally { d.close(); }
  await S.open();
  await S.model({});
  sid = await startSession(S, { chapter: /Introduction/ });
  card = await cardOrQuiet(S, sid);
  const inCh1 = Number(S.one('SELECT COUNT(*) AS n FROM st_questions WHERE source_page BETWEEN 1 AND 2')?.n) || 0;
  await S.shot('04-dead-chapter');
  c('4.4', Number(before?.concepts) === 0 && !!card && inCh1 > 0, { conceptsBefore: before?.concepts, modelCalls: (await S.calls()).length, questionsOnThatChapter: inCh1, screen: card ? card.stem : norm(await S.text()).slice(0, 140) });
});

phase(5, 'One context size for a whole making, and no token cap', 'plain', {
  '5.1': 'every model call of one session\'s making asks for the same context size',
  '5.2': 'no model call carries a token cap',
}, async (S, c) => {
  await S.model({});
  await startSession(S, { chapter: /Cape Cod/ });
  const card = must(await waitCard(S, 90_000), 'a first question');
  await S.modelIdle(2500, 90_000);
  // One Explain as well, so the cap is looked for there too.
  if (card.options.length) { await S.click(card.options[0]); await waitVerdict(S); if (await S.press('root', /^Explain\b/, 'button')) await until(async () => (await S.calls()).some((x) => x.kind === 'explain' && x.t1), 6000); }
  const calls = await S.calls();
  const making = calls.filter((x) => MAKING.has(x.kind));
  const sizes = [...new Set(making.map((x) => (x.numCtx === undefined || x.numCtx === null ? 'none' : String(x.numCtx))))];
  c('5.1', making.length >= 6 && sizes.length === 1, { makingCalls: making.length, contextSizesAsked: sizes });
  const CAP = /^(max_?(new_?|output_?|completion_?)?tokens|num_?predict|max_?length)$/i;
  const capped = [];
  const scan = (o, kind, trail) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (CAP.test(k) && v !== undefined && v !== null && v !== 0) capped.push(`${kind}: ${trail}${k}=${v}`); scan(v, kind, `${trail}${k}.`); } };
  for (const x of calls) scan(x.options, x.kind, '');
  c('5.2', calls.length >= 6 && capped.length === 0, { calls: calls.length, kinds: [...new Set(calls.map((x) => x.kind))], capped: capped.slice(0, 4) });
});

phase(6, 'With no model, a message with a way on, and nothing left behind', 'plain', {
  '6.1': 'each try says there is no model',
  '6.2': 'the message has a button that leads somewhere useful (the model settings, or trying again)',
  '6.3': 'three tries leave no session row, no session record and no session tab',
}, async (S, c) => {
  const NO_MODEL = /no model|model (is|was)? ?(not|n't|un)\s?(available|running|found|reachable|installed|set|chosen|selected)|start the model|without a model/i;
  const USEFUL = /\b(settings|try again|retry)\b|\b(choose|pick|select|change|open|set up)\b.{0,14}\bmodel/i;
  const where = ['root', '.parallx-notifications-container', '.parallx-modal-box'];
  const usefulButton = async () => { for (const w of where) { const hit = (await S.find(w, USEFUL, 'button, [role="button"], a[href]')).find((h) => !h.disabled); if (hit) return hit; } return null; };
  const tries = [];
  for (let k = 0; k < 3; k++) {
    if (!(await sheetOpen(S))) {
      if (k === 0) await openSheet(S);
      else { must(await showStudySidebar(S), 'the Study sidebar'); must(await S.press('sidebar', /./, '.st-sb__it--material'), 'the material in the sidebar'); must(await until(() => sheetOpen(S), 8000), 'the setup sheet'); await sleep(400); }
    }
    must(await pressStart(S), 'the Start button on the sheet');
    await sleep(2500);
    await showStudySidebar(S);
    await sleep(300);
    const said = norm(`${await S.text()}\n${await S.notices()}`);
    const tabs = await S.tabs();
    tries.push({
      says: NO_MODEL.test(said), said: said.slice(0, 140), button: (await usefulButton())?.name || '',
      sessionTabs: tabs.filter((t) => /:study:session-/.test(t.id)).length, studyTabs: tabs.filter((t) => /:study:/.test(t.id)).length,
      rows: (await S.find('sidebar', /./, '.st-sb__it--session')).length, records: Number(S.one('SELECT COUNT(*) AS n FROM st_sessions')?.n) || 0,
    });
  }
  await S.shot('06-no-model');
  c('6.1', tries.every((t) => t.says), tries.map((t) => t.said));
  c('6.3', tries.every((t) => t.sessionTabs === 0 && t.studyTabs <= 1 && t.rows === 0 && t.records === 0), tries.map((t) => ({ sessionTabs: t.sessionTabs, studyTabs: t.studyTabs, sidebarRows: t.rows, records: t.records })));
  const btn = await usefulButton();
  if (!btn || !tries.every((t) => t.button)) { c('6.2', false, { buttonsSeenPerTry: tries.map((t) => t.button || 'none') }); return; }
  // Where it leads: trying again reaches a model that is there by now; anything
  // else opens a surface that talks about models.
  const snap = () => S.page.evaluate(() => ({ tabs: window.__ap.tabs().map((t) => `${t.id}${t.active ? '*' : ''}`).join('|'), overlays: Array.from(document.querySelectorAll('.parallx-modal-overlay, [role="dialog"], .context-menu')).filter(window.__ap.shown).length, text: document.body.innerText.length }));
  const before = await snap();
  let led = '';
  if (/try again|retry/i.test(btn.name)) {
    await S.installModel();
    await S.click(btn);
    if (await until(async () => (await S.calls()).length > 0, 8000)) led = 'the model was asked again';
  } else {
    await S.click(btn);
    await sleep(1800);
    const after = await snap();
    const moved = after.tabs !== before.tabs || after.overlays > before.overlays;
    const talks = /model/i.test(await S.page.evaluate(() => { const t = document.querySelector('.ui-tab--active'); const o = Array.from(document.querySelectorAll('.parallx-modal-overlay, [role="dialog"]')).filter(window.__ap.shown).pop(); const e = document.querySelector('[data-part-id="workbench.parts.editor"]'); return `${t ? t.textContent : ''} ${o ? o.innerText : ''} ${e ? e.innerText.slice(0, 4000) : ''}`; }));
    if (moved && talks) led = 'a surface about models opened';
  }
  await S.shot('06-where-the-button-leads');
  c('6.2', !!led, { button: btn.name, led: led || 'nowhere the probe could see' });
}, { model: false });

phase(7, 'After Explain, Enter moves on', 'bank', {
  '7.1': 'Enter after a click on Explain shows the next question',
  '7.2': 'the explanation was asked for once',
}, async (S, c) => {
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Choose' });
  const card = must(await sessionCard(S, mine), 'a first question');
  const q = must(S.question(card.stem), 'the question in the bank');
  await chooseOption(S, card, must(q.options.find((o) => o !== q.right), 'a wrong option'));
  must(await S.press('root', /^Explain\b/, 'button'), 'Explain');
  must(await until(async () => (await S.calls()).some((x) => x.kind === 'explain' && x.t1), 8000), 'the explanation');
  await sleep(500);
  await S.page.keyboard.press('Enter');
  const next = await waitOther(S, card.stem, 3500);
  await sleep(400);
  const explains = (await S.calls()).filter((x) => x.kind === 'explain').length;
  await S.shot('07-enter-after-explain');
  c('7.1', !!next, next ? next.stem : `still on: ${card.stem}`);
  c('7.2', explains === 1, { explainCalls: explains });
});

phase(8, 'Previous shows the question before, as it was', 'bank', {
  '8.1': 'Previous shows the question before with his answer and the verdict as they were',
  '8.2': 'nothing in the record changes, even when he clicks an answer there',
  '8.3': 'Next returns to the question he was on, still unanswered',
}, async (S, c) => {
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Choose' });
  const card1 = must(await sessionCard(S, mine), 'a first question');
  const q1 = must(S.question(card1.stem), 'the question in the bank');
  const his = must(q1.options.find((o) => o !== q1.right), 'a wrong option');
  const v1 = await chooseOption(S, card1, his);
  await pressNext(S, card1.stem);
  const card2 = must(await waitOther(S, card1.stem), 'the second question');
  const sid = mine;
  const record = () => JSON.stringify({
    answers: S.all('SELECT question_id, correct, rating, retried FROM st_answers WHERE session_id = ? ORDER BY id', [sid]),
    items: S.all('SELECT question_id, status, chosen, typed, retried FROM st_session_items WHERE session_id = ? ORDER BY ord', [sid]),
    concept: S.all('SELECT mastery, answers, misses, miss_streak, right_choose_at, right_type_at FROM st_concepts WHERE id = ?', [q1.concept_id]),
  });
  const before = record();
  const prev = await S.press('root', /^(previous|back)\b/i, 'button');
  if (!prev) { for (const id of ['8.1', '8.2', '8.3']) c(id, false, 'no Previous button on the session screen'); return; }
  const back = await until(async () => { const x = await S.card(); return x && x.stem === card1.stem ? x : null; }, 4000);
  await sleep(400);
  const shown = await S.card();
  await S.shot('08-previous');
  const hisRow = shown && shown.options.find((o) => o.text === his);
  const rightRow = shown && shown.options.find((o) => o.text === q1.right);
  c('8.1', !!back && !!shown && shown.verdict === v1.verdict && !!hisRow && /st-opt--wrong/.test(hisRow.cls) && !!rightRow && /st-opt--right/.test(rightRow.cls),
    { question: shown ? shown.stem : null, verdictWas: v1.verdict, verdictNow: shown ? shown.verdict : null, hisAnswerMarked: !!hisRow && /st-opt--wrong/.test(hisRow.cls) });
  if (rightRow) { await S.click(rightRow); await sleep(700); }
  c('8.2', !!back && record() === before, record() === before ? 'unchanged' : { before: before.slice(0, 180), after: record().slice(0, 180) });
  await S.press('root', /^Next\b/, 'button');
  const again = await until(async () => { const x = await S.card(); return x && x.stem === card2.stem ? x : null; }, 4000);
  c('8.3', !!back && !!again && !again.verdict, again ? { question: again.stem, verdict: again.verdict } : `not back on: ${card2.stem}`);
});

phase(9, 'A question can be marked to come back to', 'bank', {
  '9.1': 'a question can be marked, and the mark shows',
  '9.2': 'the mark is still there after the app is closed and opened',
  '9.3': 'the marked questions can be studied as a set: exactly those',
}, async (S, c) => {
  const MARK = /^(mark|flag|bookmark)\b|come back|revisit|for later/i;
  const UNMARK = /^(unmark|unflag|marked|flagged|remove (the )?(mark|flag))\b/i;
  const markControl = async () => (await S.find('root', MARK)).concat(await S.find('root', UNMARK)).find((h) => !/hide|right|wrong|correct/i.test(h.name)) || null;
  const isOn = (h) => !!h && (h.pressed === 'true' || UNMARK.test(h.name));
  const session = await startSession(S, { chapter: /Cape Cod/, answer: 'Choose' });
  const cards = [];
  let marked = false; let lastOn = false;
  for (let i = 0; i < 3; i++) {
    const card = must(await sessionCard(S, session), `question ${i + 1}`);
    cards.push(card);
    if (i !== 1) { // the first and the third are marked, the second is not
      const ctl = await markControl();
      if (!ctl) { for (const id of ['9.1', '9.2', '9.3']) c(id, false, 'no control on a question to mark it'); return; }
      await S.click(ctl);
      await sleep(500);
      lastOn = isOn(await markControl());
      marked = true;
    }
    if (i < 2) { await chooseOption(S, card, card.options[0].text); await pressNext(S, card.stem); }
  }
  await S.shot('09-marked');
  c('9.1', marked && lastOn, { markedTwo: marked, theMarkShows: lastOn });
  await sleep(800);
  await S.relaunch();
  const card3 = await reopenSession(S, session);
  const ctl3 = card3 ? await markControl() : null;
  c('9.2', !!card3 && card3.stem === cards[2].stem && isOn(ctl3), { backOnTheThirdQuestion: !!card3 && card3.stem === cards[2].stem, theMarkShows: isOn(ctl3) });
  // The set: from the sidebar, its More Actions, the session screen, or a Study command.
  const SET = /\bmarked\b|\bflagged\b|come back|revisit|for later/i;
  await showStudySidebar(S);
  let how = '';
  const inSidebar = (await S.find('sidebar', SET)).find((h) => h.pressed === null);
  if (inSidebar) { await S.click(inSidebar); how = `sidebar: ${inSidebar.name}`; }
  if (!how && await S.press('sidebar', /^More Actions/, 'button')) {
    await sleep(400);
    const item = await S.press('body', SET, '[role="menuitem"]');
    if (item) how = `More Actions: ${item.name}`; else await S.page.keyboard.press('Escape');
  }
  if (!how) { const onScreen = (await S.find('root', /\b(study|review|practice)\b.*\b(marked|flagged)\b|\b(marked|flagged)\b.*\b(questions|only|set)\b/i)).find((h) => h.pressed === null); if (onScreen) { await S.click(onScreen); how = `session screen: ${onScreen.name}`; } }
  if (!how) {
    const ids = await S.page.evaluate(() => { try { const svc = window.__parallx_workbench__._services.get({ id: 'ICommandService' }); const all = svc.getCommands ? svc.getCommands() : []; const list = all instanceof Map ? [...all.keys()] : Array.isArray(all) ? all.map((x) => (typeof x === 'string' ? x : x.id)) : []; return list.filter((id) => /^study\./.test(id) && /mark|flag|revisit|later/i.test(id)); } catch { return []; } });
    if (ids.length) { await S.cmd(ids[0]); how = `command: ${ids[0]}`; }
  }
  if (!how) { c('9.3', false, 'no way to study the marked questions in the sidebar, its More Actions, the session screen or a Study command'); return; }
  await sleep(800);
  if (await sheetOpen(S)) await pressStart(S);
  // The set is on screen once a new session shows a question, or this one moved off the third.
  const set = [];
  let card = await until(async () => {
    const newest = S.newestSession();
    const x = newest > session ? await sessionCard(S, newest, 300) : await S.card();
    return answerable(x) && (newest > session || x.stem !== cards[2].stem || x.stem === cards[0].stem) ? x : null;
  }, 10_000, 150);
  while (card && set.length < 6 && !set.includes(card.stem)) {
    set.push(card.stem);
    if (!card.verdict) { if (card.options.length) await S.click(card.options[0]); else await typeAnswer(S, card, 'A marked one.'); await waitVerdict(S); }
    const nxt = await pressNext(S, card.stem).catch(() => null);
    card = nxt && nxt !== 'end' ? await S.card() : null;
  }
  await S.shot('09-marked-set');
  const want = [cards[0].stem, cards[2].stem].sort();
  c('9.3', JSON.stringify([...set].sort()) === JSON.stringify(want), { how, marked: want.map((s) => s.slice(0, 60)), offered: set.map((s) => s.slice(0, 60)) });
});

phase(10, 'He can overrule the grader', 'bank', {
  '10.1': 'graded wrong, he says right: the answer is recorded right and the verdict on screen is right',
  '10.2': 'the concept follows: mastery goes up and the miss is no longer counted',
  '10.3': 'graded right, he says wrong: the answer is recorded wrong',
  '10.4': 'the concept follows: mastery goes down and a miss is counted',
}, async (S, c) => {
  const OVERRULE = /overrul|overrid|disagree|\bmark (it |this |as )*(right|correct|wrong|incorrect)|\bi was (right|wrong)|\bcount (it |this )?as\b|\bactually (right|wrong|correct)|\bchange (the )?verdict/i;
  const concept = (id) => S.one('SELECT mastery, answers, misses, miss_streak FROM st_concepts WHERE id = ?', [id]);
  const item = (sid, qid) => S.one('SELECT status, typed FROM st_session_items WHERE session_id = ? AND question_id = ?', [sid, qid]);
  const overrule = async (to) => {
    const ctl = (await S.find('root', OVERRULE)).find((h) => !h.disabled && (to === 'right' ? !/wrong|incorrect/i.test(h.name) : !/\b(right|correct)\b/i.test(h.name) || /wrong|incorrect/i.test(h.name)));
    if (!ctl) return '';
    await S.click(ctl);
    await sleep(500);
    // A menu or a dialog with the two verdicts: pick his.
    const pick = await S.press('body', to === 'right' ? /\b(right|correct)\b/i : /\b(wrong|incorrect|miss(ed)?)\b/i, '.context-menu [role="menuitem"], .parallx-modal-box button, .parallx-quickpick-row');
    await sleep(900);
    return `${ctl.name}${pick ? ` → ${pick.name}` : ''}`;
  };
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Type' });
  const sid = () => mine;
  // Graded wrong, he says right.
  const card1 = must(await sessionCard(S, mine), 'a first question');
  const q1 = must(S.question(card1.stem), 'the question in the bank');
  const c0 = concept(q1.concept_id);
  await typeAnswer(S, card1, 'This is a guess that says nothing useful.');
  const v1 = must(await waitVerdict(S), 'a verdict');
  must(await until(() => item(sid(), q1.id)?.status === 'wrong', 4000), `the grader marking the guess wrong (verdict "${v1.verdict}", recorded ${JSON.stringify(item(sid(), q1.id))})`);
  const cWrong = concept(q1.concept_id);
  const how1 = await overrule('right');
  await S.shot('10-overruled-right');
  if (!how1) { for (const id of ['10.1', '10.2', '10.3', '10.4']) c(id, false, `no way to overrule the verdict "${v1.verdict}"`); return; }
  const after1 = await S.card(); const cRight = concept(q1.concept_id);
  c('10.1', item(sid(), q1.id)?.status === 'right' && !!after1 && /st-fb--ok/.test(after1.fbClass), { how: how1, recorded: item(sid(), q1.id)?.status, verdictOnScreen: after1 ? after1.verdict : null });
  c('10.2', cRight.mastery > cWrong.mastery && cRight.misses === c0.misses && cRight.miss_streak === 0, { before: c0, gradedWrong: cWrong, afterHisVerdict: cRight });
  // Graded right, he says wrong.
  await pressNext(S, card1.stem);
  const card2 = must(await waitOther(S, card1.stem), 'the second question');
  const q2 = must(S.question(card2.stem), 'the second question in the bank');
  const d0 = concept(q2.concept_id);
  await typeAnswer(S, card2, q2.right);
  must(await waitVerdict(S), 'a verdict');
  must(await until(() => item(sid(), q2.id)?.status === 'right', 4000), 'the grader marking the model answer right');
  const dRight = concept(q2.concept_id);
  const how2 = await overrule('wrong');
  await S.shot('10-overruled-wrong');
  const after2 = await S.card(); const dWrong = concept(q2.concept_id);
  c('10.3', !!how2 && item(sid(), q2.id)?.status === 'wrong' && !!after2 && /st-fb--no/.test(after2.fbClass), { how: how2 || 'no control', recorded: item(sid(), q2.id)?.status, verdictOnScreen: after2 ? after2.verdict : null });
  c('10.4', !!how2 && dWrong.mastery < dRight.mastery && dWrong.misses === d0.misses + 1, { before: d0, gradedRight: dRight, afterHisVerdict: dWrong });
});

phase(11, 'He can edit a question', 'bank', {
  '11.1': 'a question\'s wording and answer can be edited, and the card shows the new wording at once',
  '11.2': 'the edit is kept in the bank',
  '11.3': 'after a restart the question comes up with his wording, and its answer is his',
}, async (S, c) => {
  const NEW_STEM = 'What does the Cape Cod method assume about the loss ratio, in his own words 7341?';
  const NEW_ANSWER = 'It assumes one stable expected loss ratio for every accident year, as edited 7341.';
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Type' });
  const card = must(await sessionCard(S, mine), 'a first question');
  const q = must(S.question(card.stem), 'the question in the bank');
  const sid = mine;
  const edit = await S.press('root', /^edit\b|\bedit (this |the )?question/i);
  if (!edit) { for (const id of ['11.1', '11.2', '11.3']) c(id, false, 'no Edit control on a question'); return; }
  await sleep(700);
  const fields = (await S.page.evaluate(() => window.__ap.fields())).filter((f) => !f.inChat);
  const stemField = fields.find((f) => f.value === norm(q.stem));
  const answerField = fields.find((f) => f.value === q.right);
  await S.shot('11-edit-form');
  if (!stemField || !answerField) { for (const id of ['11.1', '11.2', '11.3']) c(id, false, { editOpened: edit.name, fieldWithTheWording: !!stemField, fieldWithTheAnswer: !!answerField, fields: fields.map((f) => f.value.slice(0, 40)) }); return; }
  const fill = async (f, text) => { await S.click(f); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(text); };
  await fill(stemField, NEW_STEM);
  await fill(answerField, NEW_ANSWER);
  const save = (await S.press('body', /^(save|done|apply|update)\b/i, 'button')) || null;
  if (!save) await S.page.keyboard.press('Control+Enter');
  await sleep(900);
  const now = norm(await S.text());
  c('11.1', now.includes(NEW_STEM), { saved: save ? save.name : 'Ctrl+Enter', screen: now.slice(0, 200) });
  const row = S.one('SELECT stem, answer, options_json, format FROM st_questions WHERE id = ?', [q.id]);
  let keptAnswer = norm(row?.answer);
  if (row?.format === 'mc') { try { keptAnswer = norm(JSON.parse(row.options_json)[Number(row.answer)]); } catch { keptAnswer = ''; } }
  c('11.2', norm(row?.stem) === NEW_STEM && keptAnswer === NEW_ANSWER, { wording: row?.stem, answer: keptAnswer });
  await S.relaunch();
  const again = await reopenSession(S, sid);
  let fb = '';
  if (again && again.stem === NEW_STEM) { await typeAnswer(S, again, 'One loss ratio for all years.'); await waitVerdict(S); fb = await S.page.evaluate(() => (window.__ap.scopeEl('root')?.textContent || '').replace(/\s+/g, ' ')); }
  await S.shot('11-after-restart');
  c('11.3', !!again && again.stem === NEW_STEM && fb.includes(NEW_ANSWER), { wordingAfterRestart: again ? again.stem : null, hisAnswerShownAsTheAnswer: fb.includes(NEW_ANSWER) });
});

phase(12, 'When grading fails his answer is kept and can be graded again', 'bank', {
  '12.1': 'the model returns nonsense: his answer is still in the box and Grade Again grades it',
  '12.2': 'the model errors: his answer is still in the box and Grade Again grades it',
}, async (S, c) => {
  const AGAIN = /grade again|mark again|check again|try again|\bretry\b|re-?grade|re-?check|^check\b/i;
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Type' });
  const sid = () => mine;
  const one = async (id, breakIt, text) => {
    const card = must(await sessionCard(S, mine), 'a question');
    const q = must(S.question(card.stem), 'the question in the bank');
    const g0 = (await S.calls()).filter((x) => x.kind === 'grade').length;
    await S.model(breakIt);
    await typeAnswer(S, card, text);
    must(await until(async () => (await S.calls()).filter((x) => x.kind === 'grade' && x.t1).length > g0, 8000), 'the failed grading call');
    await sleep(900);
    await S.shot(`12-${id}-grading-failed`);
    const failed = await S.card();
    const still = !!failed && !!failed.field && norm(failed.field.value) === norm(text);
    await S.model({});
    const again = (await S.find('root', AGAIN, 'button')).find((h) => !h.disabled);
    let status = '';
    if (again) {
      await S.click(again);
      status = (await until(() => { const s = S.one('SELECT status, typed FROM st_session_items WHERE session_id = ? AND question_id = ?', [sid(), q.id]); return s && (s.status === 'right' || s.status === 'wrong') && norm(s.typed) === norm(text) ? s.status : null; }, 6000)) || '';
    }
    const graded = await S.card();
    c(id, still && !!again && !!status && !!graded && /st-fb--(ok|no)/.test(graded.fbClass), { answerStillInTheBox: still, button: again ? again.name : 'none', gradedAs: status || 'not graded', screen: failed ? failed.fbText.slice(0, 110) : '' });
    return card;
  };
  const first = await one('12.1', { garble: { kinds: ['grade'], mode: 'prose', left: 1 } }, 'The expected loss for each year is a constant loss ratio applied to on-level premium.');
  const moved = await pressNext(S, first.stem).catch(() => null);
  if (!moved || moved === 'end') { c('12.2', false, 'could not reach a second question'); return; }
  await one('12.2', { failKinds: ['grade'] }, 'Fewer parameters leave more degrees of freedom in the data.');
});

phase(13, 'A half-typed answer survives', 'bank', {
  '13.1': 'after the tab is closed and the session opened again, the half-typed answer is in the box',
  '13.2': 'after the app is closed and opened, it is still in the box',
}, async (S, c) => {
  const HALF = 'half an answer about the loss ratio and on-level';
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Type' });
  const card = must(await sessionCard(S, mine), 'a first question');
  const sid = mine;
  await typeAnswer(S, card, HALF, { enter: false });
  await sleep(500);
  must(await S.press('body', /./, '.ui-tab--active .ui-tab-close'), 'the tab\'s close button');
  await sleep(700);
  const closed = !(await S.tabs()).some((t) => t.id.endsWith(`:study:session-${sid}`));
  const back = await reopenSession(S, sid);
  await S.shot('13-after-tab-close');
  c('13.1', closed && !!back && back.stem === card.stem && !!back.field && back.field.value === HALF, { tabWasClosed: closed, sameQuestion: !!back && back.stem === card.stem, inTheBox: back && back.field ? back.field.value : null });
  // Whatever is in the box now is what must survive the app closing.
  let now = await S.card();
  if (now && now.field && now.field.value !== HALF) { await S.click(now.field); await S.page.keyboard.press('Control+A'); await S.page.keyboard.type(HALF); }
  await sleep(1300);
  await S.relaunch();
  now = await reopenSession(S, sid);
  await S.shot('13-after-app-close');
  c('13.2', !!now && now.stem === card.stem && !!now.field && now.field.value === HALF, { sameQuestion: !!now && now.stem === card.stem, inTheBox: now && now.field ? now.field.value : null });
});

phase(14, 'Escape closes the setup sheet', 'bank', {
  '14.1': 'Escape closes the sheet just opened from the sidebar',
  '14.2': 'Escape closes the sheet after a choice was made in it',
}, async (S, c) => {
  const openFromSidebar = async () => {
    must(await showStudySidebar(S), 'the Study sidebar');
    must(await until(() => S.press('sidebar', /./, '.st-sb__it--material'), 6000), 'the material in the sidebar');
    must(await until(() => sheetOpen(S), 8000), 'the setup sheet');
    await sleep(500);
  };
  const gone = async () => !(await sheetOpen(S)) && !(await S.tabs()).some((t) => t.id.endsWith(':study:setup'));
  await openFromSidebar();
  await S.page.keyboard.press('Escape');
  const first = await until(gone, 2000);
  await S.shot('14-after-escape');
  c('14.1', !!first, first ? 'closed' : 'the sheet is still open');
  if (!(await sheetOpen(S))) await openFromSidebar();
  must(await S.press('root', /^Type$/, '[role="radio"]'), 'the Answer choice Type');
  await sleep(300);
  await S.page.keyboard.press('Escape');
  const second = await until(gone, 2000);
  c('14.2', !!second, second ? 'closed' : 'the sheet is still open');
});

phase(15, 'The concept\'s name is not shown before he answers', 'bank', {
  '15.1': 'before he answers, the concept\'s name is nowhere on the session screen',
  '15.2': 'after he answers, it is shown',
}, async (S, c) => {
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Choose' });
  const card = must(await sessionCard(S, mine), 'a first question');
  const q = must(S.question(card.stem), 'the question in the bank');
  const title = norm(must(q.concept_title, 'the concept\'s name'));
  if (card.stem.includes(title) || card.options.some((o) => o.text.includes(title))) throw new Error('the fixture is wrong: the question itself carries the concept\'s name');
  await sleep(400);
  const before = norm(await S.text());
  await S.shot('15-before-answering');
  c('15.1', !before.includes(title), `concept "${title}"; the screen: ${before.slice(0, 120)}`);
  await chooseOption(S, card, card.options[0].text);
  await sleep(400);
  const after = norm(await S.text());
  await S.shot('15-after-answering');
  c('15.2', after.includes(title), `concept "${title}"; the screen: ${after.slice(0, 120)}`);
});

phase(16, 'No two questions in a row on the same concept', 'plain', {
  '16.1': 'a short chapter with four concepts, one of them with more questions: no two in a row on one concept',
}, async (S, c) => {
  await S.model({});
  await startSession(S, { chapter: /Introduction/ });
  must(await waitCard(S, 90_000), 'a first question');
  await S.modelIdle(2500, 90_000);
  // Every question is made by now; he goes through them as they come.
  const order = [];
  for (let i = 0; i < 30; i++) {
    const card = await waitCard(S, i ? 3000 : 8000);
    if (!card) break;
    const q = S.question(card.stem);
    order.push(q ? Number(q.concept_id) : -1);
    if (card.options.length) await S.click(card.options[0]); else await typeAnswer(S, card, 'Loss reserving estimates unpaid claims.');
    must(await waitVerdict(S, 10_000), 'a verdict');
    const nxt = await pressNext(S, card.stem);
    if (!nxt || nxt === 'end') break;
  }
  await S.shot('16-end-of-session');
  const concepts = new Set(order);
  const most = Math.max(0, ...[...concepts].map((id) => order.filter((x) => x === id).length));
  const possible = most <= Math.ceil(order.length / 2);
  let pairs = 0;
  for (let i = 1; i < order.length; i++) if (order[i] === order[i - 1]) pairs += 1;
  c('16.1', order.length >= 8 && !order.includes(-1) && concepts.size > 1 && possible && pairs === 0, { conceptOfEachQuestion: order.join(' '), concepts: concepts.size, inARowOnOneConcept: pairs });
});

phase(17, 'Weak Spots from the sidebar, and what it says with no history', 'bank', {
  '17.1': 'Study Weak Spots is in the Study sidebar (or its More Actions)',
  '17.2': 'with nothing answered it says nothing is answered yet, and does not say everything is clean',
}, async (S, c) => {
  const WEAK = /weak spots/i;
  must(await showStudySidebar(S), 'the Study sidebar');
  await sleep(500);
  let how = '';
  const direct = (await S.find('sidebar', WEAK)).find((h) => !h.disabled);
  if (direct) { await S.click(direct); how = `sidebar: ${direct.name}`; }
  else if (await S.press('sidebar', /^More Actions/, 'button')) {
    await sleep(400);
    const item = await S.press('body', WEAK, '[role="menuitem"]');
    if (item) how = `More Actions: ${item.name}`; else await S.page.keyboard.press('Escape');
  }
  await S.shot('17-sidebar');
  c('17.1', !!how, how || 'nothing named Weak Spots in the Study sidebar or its More Actions');
  // The message, by the way he can reach it today when the sidebar has no entry.
  if (!how) S.run('study.weakSpots');
  await sleep(1500);
  const said = norm(`${await S.notices()}\n${await S.text()}`);
  await S.shot('17-no-history');
  const NOT_YET = /(nothing|no questions?|none|not (a|one) (single )?question)[^.]{0,40}answered|not answered (any|a)\b|have ?n[o’']t answered|no answers? yet|answer (some|a few|a) questions? first|nothing[^.]{0,30}studied yet/i;
  c('17.2', NOT_YET.test(said) && !/\bclean\b/i.test(said), said.slice(0, 200) || 'nothing was said');
});

phase(18, 'A .md and a .txt are sources as a PDF is', 'plain', {
  '18.1': 'Add Material… offers the .md and the .txt in the workspace',
  '18.2': 'the .md can be studied: questions are made from it',
  '18.3': 'Show Source opens the .md at the passage',
  '18.4': 'the .txt can be studied: questions are made from it',
  '18.5': 'Show Source opens the .txt at the passage',
}, async (S, c) => {
  await S.model({});
  must(await showStudySidebar(S), 'the Study sidebar');
  const offered = async () => (await S.find('body', /./, '.parallx-quickpick-row, .parallx-quickpick-box [role="option"]')).map((h) => h.name);
  const openPicker = async () => {
    must(await S.press('sidebar', /^More Actions/, 'button'), 'More Actions… in the Study sidebar');
    await sleep(400);
    must(await S.press('body', /^Add Material/, '[role="menuitem"]'), 'Add Material… in More Actions');
    await sleep(900);
    // A menu of kinds first: take the one for files.
    if (!(await offered()).length) { await S.press('body', /file|document|notes|text|markdown|workspace/i, '.context-menu [role="menuitem"]'); await sleep(900); }
    return offered();
  };
  const names = await openPicker();
  await S.shot('18-add-material');
  const hasMd = names.some((n) => n.includes(NOTES)); const hasTxt = names.some((n) => n.includes(TIPS));
  c('18.1', hasMd && hasTxt, { offered: names.map((n) => n.slice(0, 40)) });
  const study = async (file, word, lines, ids, tag) => {
    // From the picker when it lists the file, else by the command with the path.
    let viaPicker = false;
    const row = (await S.find('body', new RegExp(file.replace(/[.]/g, '\\.')), '.parallx-quickpick-row, .parallx-quickpick-box [role="option"]'))[0];
    if (row) { await S.click(row); viaPicker = true; }
    else { await S.page.keyboard.press('Escape'); await sleep(300); S.run('study.addMaterial', path.join(S.workspace, file)); }
    const sheet = await until(async () => (await sheetOpen(S)) && new RegExp(word, 'i').test(await S.text()), 8000);
    if (!sheet) { c(ids[0], false, `no setup sheet for ${file} (${viaPicker ? 'picked in Add Material…' : 'asked for by its path'}): ${norm(await S.notices()).slice(0, 120)}`); c(ids[1], false, 'no question from that file'); return; }
    const before = S.newestSession();
    must(await pressStart(S), 'the Start button on the sheet');
    const sid = (await until(() => { const n = S.newestSession(); return n > before ? n : null; }, 6000, 100)) || S.newestSession();
    const card = await sessionCard(S, sid, 45_000);
    const q = card ? S.question(card.stem) : null;
    await S.shot(`18-${tag}-question`);
    c(ids[0], !!card && !!q && lines.includes(q.quote), card ? { question: card.stem, quote: q ? q.quote.slice(0, 70) : null } : norm(await S.text()).slice(0, 160));
    if (!card || !q) { c(ids[1], false, 'no question from that file'); return; }
    await S.modelIdle(1500, 30_000);
    if (card.options.length) await S.click(card.options[0]); else await typeAnswer(S, card, 'An answer to open the source.');
    must(await waitVerdict(S, 10_000), 'a verdict');
    must(await S.press('root', /^Show Source\b/, 'button'), 'Show Source');
    // The file's own editor, with the quoted line inside what is on screen: a
    // line of the code editor, the plain text editor's line (by its gutter
    // number), or a line of any other view of the file.
    const start = q.quote.slice(0, 44);
    const seen = await until(() => S.page.evaluate(({ start, file }) => {
      const part = document.querySelector('[data-part-id="workbench.parts.editor"]');
      const flat = (t) => String(t || '').replace(/\s+/g, ' ');
      if (!Array.from(document.querySelectorAll('.ui-tab')).some((t) => decodeURIComponent(t.getAttribute('data-tab-id') || '').toLowerCase().endsWith(file.toLowerCase()))) return null;
      const within = (n, box) => { const r = n.getBoundingClientRect(); return r.height > 0 && r.width > 0 && r.top >= box.top - 2 && r.bottom <= box.bottom + 2; };
      // A textarea editor: where the passage's first characters sit, measured in a copy of its text laid out as it is.
      for (const ta of part.querySelectorAll('textarea')) {
        if (!window.__ap.shown(ta) || ta.closest('.st-root')) continue;
        const index = ta.value.indexOf(start.slice(0, 30));
        if (index < 0) continue;
        const cs = getComputedStyle(ta);
        const copy = document.createElement('div');
        for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'tabSize', 'textIndent', 'wordSpacing', 'overflowWrap', 'wordBreak']) copy.style[k] = cs[k];
        Object.assign(copy.style, { position: 'absolute', left: '-99999px', top: '0', visibility: 'hidden', boxSizing: 'border-box', width: `${ta.clientWidth}px`, whiteSpace: /^pre$|nowrap/.test(cs.whiteSpace) ? 'pre' : 'pre-wrap' });
        copy.textContent = ta.value.slice(0, index);
        const here = document.createElement('span');
        here.textContent = ta.value.slice(index, index + 30);
        copy.appendChild(here);
        document.body.appendChild(copy);
        const top = here.offsetTop; const height = here.offsetHeight || 16;
        copy.remove();
        return top >= ta.scrollTop - 4 && top + height <= ta.scrollTop + ta.clientHeight + 4 ? 'a line of the text editor' : null;
      }
      for (const n of part.querySelectorAll('.cm-line, p, li, pre, td, blockquote')) {
        if (n.closest('.st-root') || n.closest('[aria-hidden="true"]') || !flat(n.textContent).includes(start)) continue;
        const pane = n.closest('.cm-scroller') || n.closest('.editor-pane') || part;
        if (window.__ap.shown(n) && within(n, pane.getBoundingClientRect())) return `a ${n.className ? String(n.className).split(' ')[0] : n.tagName.toLowerCase()} of the file's editor`;
      }
      return null;
    }, { start, file }), 6000, 200);
    await S.shot(`18-${tag}-source`);
    c(ids[1], !!seen, seen ? `the passage is on screen (${seen}): "${start}…"` : `the file's editor does not show "${start}…"`);
  };
  await study(NOTES, 'reserving notes', NOTE_LINES, ['18.2', '18.3'], 'md');
  const again = hasTxt ? await openPicker().catch(() => []) : [];
  if (!again.length && hasTxt) await S.page.keyboard.press('Escape');
  await study(TIPS, 'exam tips', TIP_LINES, ['18.4', '18.5'], 'txt');
});

phase(19, 'Study This Document… on a .md or .txt in the editor', 'plain', {
  '19.0': '(already so) on a PDF, the editor\'s More Actions offers Study This Document…',
  '19.1': 'on a .md open in the editor, Study This Document… is offered and opens the sheet for it',
  '19.2': 'on a .txt open in the editor, Study This Document… is offered and opens the sheet for it',
}, async (S, c) => {
  const STUDY = /^Study This Document/;
  /** Offer found in the editor area: a control of that name, or an item of a More Actions menu there. */
  const offer = async (click) => {
    const direct = (await S.find('editor', STUDY)).find((h) => !h.disabled && !/st-/.test(h.cls));
    if (direct) { if (click) await S.click(direct); return `a control in the editor: ${direct.name}`; }
    for (const more of await S.find('editor', /^More Actions/)) {
      await S.click(more);
      await sleep(450);
      const item = (await S.find('body', STUDY, '[role="menuitem"]'))[0];
      if (item) { if (click) await S.click(item); else await S.page.keyboard.press('Escape'); return `More Actions: ${item.name}`; }
      await S.page.keyboard.press('Escape');
      await sleep(200);
    }
    return '';
  };
  const on = async (id, file, word, ready) => {
    await S.cmd('file.openFile', path.join(S.workspace, file));
    must(await until(async () => (await S.tabs()).some((t) => t.active && decodeURIComponent(t.id).toLowerCase().endsWith(file.toLowerCase())) && S.page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).some(window.__ap.shown), ready), 30_000), `the editor for ${file}`);
    await sleep(file.endsWith('.pdf') ? 2500 : 900);
    if (id === '19.0') { const how = await offer(false); c(id, !!how, how || 'not offered on the PDF'); return; }
    const how = await offer(true);
    const sheet = how ? await until(async () => (await sheetOpen(S)) && new RegExp(word, 'i').test(await S.text()), 8000) : null;
    await S.shot(`19-${file.split('.').pop()}`);
    c(id, !!how && !!sheet, how ? { offered: how, sheetForThatFile: !!sheet } : `not offered in the editor showing ${file}`);
    if (await sheetOpen(S)) await S.press('root', /^Cancel$/, 'button');
  };
  await on('19.0', PDF, 'Clark', '.pdf-toolbar');
  // A .md opens as a page since 2026-11-26 (his yes of 2026-11-27 to this change): the page's surface is what is waited for, the text editor still counting should a build open it there.
  await on('19.1', NOTES, 'reserving notes', '[data-px-surface="canvas"], .cm-content, .editor-pane textarea');
  await on('19.2', TIPS, 'exam tips', '.cm-content, .editor-pane textarea');
});

phase(20, 'The chat tools return his work, not only titles and counts', 'bank', {
  '20.1': 'study_results, for a choice he got wrong: the question, his answer, the right answer and the source quote',
  '20.2': 'study_weak_spots, for that missed concept: the same four',
  '20.3': 'study_results, for a typed answer graded wrong: the question, what he typed, the model answer and the source quote',
  '20.4': 'study_weak_spots, for that missed concept: the same four',
}, async (S, c) => {
  const tool = (name, args) => S.page.evaluate(async ({ name, args }) => {
    const t = window.__parallx_workbench__._services.get({ id: 'ILanguageModelToolsService' }).getTool(name);
    if (!t) return `no tool ${name}`;
    try { const r = await t.handler(args, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }); return String((r && r.content) || ''); } catch (e) { return `threw: ${e && e.message}`; }
  }, { name, args });
  const four = (content, parts) => { const t = norm(content); return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, t.includes(norm(v))])); };
  const all = (o) => Object.values(o).every(Boolean);
  // A choice, answered wrong.
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Choose' });
  const card1 = must(await sessionCard(S, mine), 'a first question');
  const q1 = must(S.question(card1.stem), 'the question in the bank');
  const his1 = must(q1.options.find((o) => o !== q1.right), 'a wrong option');
  await chooseOption(S, card1, his1);
  await sleep(500);
  const parts1 = { question: q1.stem, hisAnswer: his1, rightAnswer: q1.right, quote: q1.quote };
  const res1 = await tool('study_results', { sessionId: mine });
  const r1 = four(res1, parts1);
  c('20.1', all(r1), { has: r1, returned: norm(res1).slice(0, 220) });
  const weak1 = await tool('study_weak_spots', {});
  const w1 = four(weak1, parts1);
  c('20.2', all(w1), { has: w1, returned: norm(weak1).slice(0, 220) });
  // A typed answer, graded wrong.
  const TYPED = 'A typed guess that misses it, 5527.';
  const second = await startSession(S, { chapter: /Cape Cod/, answer: 'Type' });
  const card2 = must(await until(async () => { const x = await sessionCard(S, second, 300); return x && x.field && x.stem !== card1.stem ? x : null; }, 15_000), 'a typed question');
  const q2 = must(S.question(card2.stem), 'the typed question in the bank');
  await typeAnswer(S, card2, TYPED);
  must(await waitVerdict(S), 'a verdict');
  must(await until(() => S.one('SELECT status FROM st_session_items WHERE session_id = ? AND question_id = ?', [second, q2.id])?.status === 'wrong', 4000), 'the typed guess graded wrong');
  const parts2 = { question: q2.stem, hisAnswer: TYPED, modelAnswer: q2.right, quote: q2.quote };
  const res2 = await tool('study_results', { sessionId: second });
  const r2 = four(res2, parts2);
  c('20.3', all(r2), { has: r2, returned: norm(res2).slice(0, 220) });
  const weak2 = await tool('study_weak_spots', {});
  const w2 = four(weak2, parts2);
  c('20.4', all(w2), { has: w2, returned: norm(weak2).slice(0, 220) });
});

phase(21, 'Discuss in Chat', 'bank', {
  '21.1': 'an answered question has a Discuss in Chat action, and it opens the app\'s chat',
  '21.2': 'the question, his answer, the right answer and the source quote are carried into the chat',
}, async (S, c) => {
  const mine = await startSession(S, { chapter: /Cape Cod/, answer: 'Choose' });
  const card = must(await sessionCard(S, mine), 'a first question');
  const q = must(S.question(card.stem), 'the question in the bank');
  const his = must(q.options.find((o) => o !== q.right), 'a wrong option');
  await chooseOption(S, card, his);
  await sleep(400);
  const n0 = (await S.calls()).length;
  const discuss = await S.press('root', /discuss (this |it )?in (the )?chat|discuss.{0,12}chat|ask (in |the )?chat|chat about/i);
  if (!discuss) { c('21.1', false, 'no Discuss in Chat on an answered question'); c('21.2', false, 'nothing was carried: there is no action'); return; }
  const chat = await until(() => S.page.evaluate(() => { const w = window.__ap.scopeEl('chat'); return w && w.getBoundingClientRect().width > 100 ? true : null; }), 6000);
  await sleep(1200);
  await S.shot('21-chat');
  c('21.1', !!chat, { action: discuss.name, chatOpen: !!chat });
  // What the chat holds: what is on its screen, and what its model is sent.
  const input = await S.page.evaluate(() => { const w = window.__ap.scopeEl('chat'); const t = w && w.querySelector('textarea'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, value: t.value }; });
  if (chat && input && !(await S.calls()).slice(n0).some((x) => x.kind === 'other')) {
    await S.click(input);
    if (!norm(input.value)) await S.page.keyboard.type('Why was my answer wrong?');
    await S.page.keyboard.press('Enter');
    await until(async () => (await S.calls()).slice(n0).some((x) => x.kind === 'other' && x.t1), 10_000);
  }
  const onScreen = chat ? await S.page.evaluate(() => { const w = window.__ap.scopeEl('chat'); return `${w.innerText}\n${Array.from(w.querySelectorAll('textarea')).map((t) => t.value).join('\n')}`; }) : '';
  const sent = (await S.calls()).slice(n0).filter((x) => x.kind === 'other').map((x) => x.all).join('\n');
  const held = norm(`${onScreen}\n${sent}`);
  const has = { question: held.includes(norm(q.stem)), hisAnswer: held.includes(his), rightAnswer: held.includes(q.right), quote: held.includes(q.quote) };
  await S.shot('21-chat-after');
  c('21.2', !!chat && Object.values(has).every(Boolean), { has, sentToTheChatModel: sent.length > 0 });
});

// ── The bank the session phases start from: made by the app, once ────────────
// A material is known by its file's path, so the phases that start from the
// bank all run on the one workspace path it was made in, put back from a
// snapshot before each of them.
const BANK_WORKSPACE = path.join(OUT, 'runs', 'bank-workspace');
let bankSnapshot = null;
async function bankBase(fixtures) {
  if (bankSnapshot) return bankSnapshot;
  const S = makeSession(await newRoot('bank-made', fixtures, BANK_WORKSPACE), { model: true });
  await S.open();
  try {
    await S.model({});
    await startSession(S, { chapter: /Cape Cod/ });
    must(await waitCard(S, 120_000), 'a question while preparing the bank');
    await S.modelIdle(2500, 120_000);
    const n = Number(S.one('SELECT COUNT(*) AS n FROM st_questions WHERE source_page BETWEEN 7 AND 10')?.n) || 0;
    if (n < 12) throw new Error(`the bank for the Cape Cod chapter holds ${n} questions, too few to start from`);
    // Leave no session open and no Study tab to be restored: each phase starts its own.
    if (await S.press('root', /^End Session$/, 'button')) { await sleep(500); await S.press('body', /^End Session$/, '.parallx-modal-box button'); await sleep(900); }
    for (let i = 0; i < 4 && (await S.tabs()).some((t) => /:study:/.test(t.id) && t.active); i++) { await S.press('body', /./, '.ui-tab--active .ui-tab-close'); await sleep(500); }
    await sleep(600);
    console.log(`[probe] bank prepared by the app: ${n} questions on the Cape Cod chapter`);
  } finally { await S.close(); }
  const snapshot = path.join(OUT, 'runs', 'bank-snapshot');
  await fs.cp(BANK_WORKSPACE, snapshot, { recursive: true });
  bankSnapshot = snapshot;
  return bankSnapshot;
}

async function main() {
  await fs.mkdir(path.join(OUT, 'shots'), { recursive: true });
  await fs.rm(path.join(OUT, 'runs'), { recursive: true, force: true });
  if (process.env.PARALLX_PROBE_EXT) console.log(`[probe] EXTENSIONS ARE LOADED FROM ${EXT_DIR}, not from this repository's ext/`);
  const fixtures = await makeFixtures();
  const t0 = Date.now();
  for (const p of PHASES) {
    if (ONLY && !ONLY.has(p.n)) continue;
    console.log(`\n── ${p.n}. ${p.title}`);
    const tp = Date.now();
    const done = new Set();
    const c = (id, ok, got) => { if (done.has(id)) return; done.add(id); record(id, p.checks[id] ?? '(unnamed check)', ok, got); };
    let S = null;
    let stopped = '';
    try {
      const name = `phase-${String(p.n).padStart(2, '0')}`;
      S = makeSession(p.base === 'bank' ? await newRoot(name, await bankBase(fixtures), BANK_WORKSPACE) : await newRoot(name, fixtures), { model: p.opts.model !== false });
      await S.open();
      await p.fn(S, c);
    } catch (err) {
      stopped = String((err && err.message) || err).split('\n')[0].slice(0, 300);
      if (S && S.page) await S.shot(`${String(p.n).padStart(2, '0')}-stopped`);
    } finally {
      if (S) await S.close();
      // The bank's workspace as this phase left it, kept beside its profile.
      if (S && p.base === 'bank') await fs.rename(BANK_WORKSPACE, path.join(S.dir, 'workspace-after')).catch(() => {});
    }
    // A check the phase never reached has not passed.
    for (const id of Object.keys(p.checks)) if (!done.has(id)) c(id, false, stopped ? `not reached: ${stopped}` : 'not reached');
    console.log(`   (${Math.round((Date.now() - tp) / 1000)} s)`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n[probe] page errors: ${pageErrors.length}`);
  for (const e of [...new Set(pageErrors)].slice(0, 8)) console.log(`   ${e}`);
  console.log(`[probe] ${results.length} checks: ${results.length - failed.length} ok, ${failed.length} FAIL${failed.length ? ` (${failed.map((r) => r.id).join(' ')})` : ''}`);
  console.log(`[probe] ${Math.round((Date.now() - t0) / 1000)} s; screenshots in ${path.join(OUT, 'shots')}`);
  process.exitCode = failed.length ? 1 : 0;
}
main().catch((err) => { console.log(`[probe] FAIL the probe itself stopped: ${err && err.stack ? err.stack : err}`); process.exitCode = 1; });
