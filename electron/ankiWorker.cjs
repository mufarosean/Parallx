// ankiWorker.cjs — parse an Anki export off the main process.
//
// Runs in a short-lived worker_thread for the same reason databaseWorker does:
// better-sqlite3 is synchronous, and a synchronous read on the Electron main
// process freezes every window for its duration (typing froze the last time
// this rule was broken). The worker parses one file, posts one result, exits.
//
// Two formats land here, so the Anki semantics live in ONE place:
//
//   .apkg — a zip holding the collection database. Two generations matter:
//       collection.anki2   — legacy schema 11. When an export ALSO contains
//                            collection.anki21, the .anki2 file is a STUB whose
//                            one note says "please update Anki" — reading it
//                            "works" and imports a single useless card, which is
//                            worse than an error. So .anki21 is preferred
//                            whenever present.
//       collection.anki21  — same schema, real data, written by Anki 2.1.
//       collection.anki21b — zstd-compressed, Anki 23+ "new format" exports.
//                            Not parseable here; the error tells the user the
//                            exact re-export checkbox that produces the legacy
//                            file.
//
//   .txt — Anki's "Notes in Plain Text" export. Tab-separated, optional
//       `#key:value` header lines, fields may be quoted with doubled-quote
//       escaping and contain literal newlines when quoted.
//
// Anki stores note fields as HTML and this app's cards are plain text, so
// fields are flattened: block tags become newlines, entities are decoded,
// `[sound:…]` and `<img>` are dropped and counted so the caller can say
// "N media items were skipped" instead of importing invisible references.

'use strict';

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const os = require('os');

/** Anki separates fields inside notes.flds with U+001F. */
const FIELD_SEP = '\x1f';

// ─── HTML → plain text ───────────────────────────────────────────────────────

// The named entities Anki content actually contains: the HTML basics plus the
// typographic/math/Greek set that web-pasted study material carries. Unknown
// names pass through literally rather than guessing.
const ENTITIES = {
  '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>',
  '&quot;': '"', '&#39;': "'", '&apos;': "'",
  '&mdash;': '—', '&ndash;': '–', '&rsquo;': '’', '&lsquo;': '‘',
  '&rdquo;': '”', '&ldquo;': '“', '&hellip;': '…', '&bull;': '•',
  '&middot;': '·', '&times;': '×', '&divide;': '÷', '&plusmn;': '±',
  '&deg;': '°', '&sup2;': '²', '&sup3;': '³', '&frac12;': '½',
  '&frac14;': '¼', '&frac34;': '¾', '&micro;': 'µ', '&sect;': '§',
  '&para;': '¶', '&copy;': '©', '&reg;': '®', '&trade;': '™',
  '&euro;': '€', '&pound;': '£', '&yen;': '¥', '&cent;': '¢',
  '&laquo;': '«', '&raquo;': '»', '&minus;': '−', '&ne;': '≠',
  '&le;': '≤', '&ge;': '≥', '&asymp;': '≈', '&infin;': '∞',
  '&sum;': '∑', '&prod;': '∏', '&radic;': '√', '&int;': '∫', '&part;': '∂',
  '&alpha;': 'α', '&beta;': 'β', '&gamma;': 'γ', '&delta;': 'δ',
  '&epsilon;': 'ε', '&theta;': 'θ', '&lambda;': 'λ', '&mu;': 'μ',
  '&pi;': 'π', '&rho;': 'ρ', '&sigma;': 'σ', '&tau;': 'τ', '&phi;': 'φ',
  '&chi;': 'χ', '&psi;': 'ψ', '&omega;': 'ω',
  '&Delta;': 'Δ', '&Sigma;': 'Σ', '&Omega;': 'Ω',
  '&rarr;': '→', '&larr;': '←', '&uarr;': '↑', '&darr;': '↓', '&harr;': '↔',
  '&rArr;': '⇒', '&lArr;': '⇐', '&hArr;': '⇔',
  '&prime;': '′', '&Prime;': '″', '&dagger;': '†', '&Dagger;': '‡',
  '&permil;': '‰', '&shy;': '', '&thinsp;': ' ', '&ensp;': ' ', '&emsp;': ' ',
};

/**
 * Flatten Anki's field HTML to the plain text this app stores.
 * Returns the text plus how many media references were dropped.
 */
function htmlToText(html) {
  let media = 0;
  let s = String(html ?? '');

  s = s.replace(/\[sound:[^\]]*\]/gi, () => { media++; return ''; });
  s = s.replace(/<img\b[^>]*>/gi, () => { media++; return ''; });

  // Math BEFORE the generic tag strip, or the delimiters are lost and bare
  // LaTeX leaks into the card as prose. Anki writes MathJax two ways: legacy
  // \( \) / \[ \] delimiters in the field text, and <anki-mathjax> elements
  // since 2.1.50. Both become the $-delimiters this app's renderer speaks.
  s = s.replace(/<anki-mathjax\b[^>]*\bblock\s*=\s*"?true"?[^>]*>([\s\S]*?)<\/anki-mathjax>/gi, (_m, tex) => `$$${tex}$$`);
  s = s.replace(/<anki-mathjax\b[^>]*>([\s\S]*?)<\/anki-mathjax>/gi, (_m, tex) => `$${tex}$`);
  s = s.replace(/\\\[/g, '$$$$').replace(/\\\]/g, '$$$$');
  s = s.replace(/\\\(/g, '$').replace(/\\\)/g, '$');

  // Block-level boundaries become newlines BEFORE tags are stripped, so
  // "<div>a</div><div>b</div>" reads as two lines rather than "ab".
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/(div|p|li|tr|h[1-6]|blockquote|pre)>/gi, '\n');
  s = s.replace(/<li\b[^>]*>/gi, '• ');
  s = s.replace(/<[^>]+>/g, '');

  // Decimal AND hex numeric references, plus the named table. fromCodePoint
  // throws on out-of-range values, so both numeric branches fall back to the
  // literal text rather than crashing the whole import on one bad entity.
  s = s.replace(/&#[xX][0-9a-fA-F]+;|&#\d+;|&[a-zA-Z][a-zA-Z0-9]*;/g, (m) => {
    if (m in ENTITIES) return ENTITIES[m];
    const dec = /^&#(\d+);$/.exec(m);
    if (dec) { try { return String.fromCodePoint(Number(dec[1])); } catch { return m; } }
    const hex = /^&#[xX]([0-9a-fA-F]+);$/.exec(m);
    if (hex) { try { return String.fromCodePoint(parseInt(hex[1], 16)); } catch { return m; } }
    return m;
  });

  // Collapse the whitespace HTML flattening leaves behind, preserving
  // intentional line structure.
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { text: s, media };
}

// ─── Cloze rendering ─────────────────────────────────────────────────────────

const CLOZE_RE = /\{\{c(\d+)::((?:[^:}]|:(?!:)|\}(?!\}))*?)(?:::((?:[^}]|\}(?!\}))*?))?\}\}/g;

/**
 * Render one cloze card the way Anki does.
 *
 * A note "The {{c1::heart}} pumps {{c2::blood}}" produces one card per cloze
 * index. Card ord N hides deletion N+1 (showing its hint when present) and
 * REVEALS every other deletion — hiding them all would turn one prompt into
 * several and make the card unanswerable.
 */
function renderCloze(text, ord) {
  const target = ord + 1;
  const front = text.replace(CLOZE_RE, (_m, idx, answer, hint) =>
    Number(idx) === target ? (hint ? `[${hint}]` : '[…]') : answer);
  const back = text.replace(CLOZE_RE, (_m, _idx, answer) => answer);
  return { front, back };
}

/** True when a model (notetype) is Anki's cloze type. */
function isClozeModel(model) {
  return Number(model?.type) === 1;
}

// ─── Template rendering ──────────────────────────────────────────────────────
//
// cards.ord is a TEMPLATE ordinal, not a direction flag. A notetype can have
// any number of templates, each rendering different fields; guessing
// "ord 0 = forward, ord 1 = swapped" duplicates every ord>=2 card and invents
// swaps that don't exist. So when the model carries its templates (every
// export written by real Anki does), the card is rendered mechanically from
// tmpl.qfmt/afmt — a Mustache subset — and the heuristic survives only as the
// fallback for template-less exports.

/** Card-level template specials that are not note content. */
const SPECIAL_FIELDS = new Set(['Tags', 'Type', 'Deck', 'Subdeck', 'Card', 'CardFlag', 'Flags', 'FrontSide']);

/** Field name → raw HTML value for one note, aligned by fld.ord. */
function buildFieldMap(model, fields) {
  const map = new Map();
  if (Array.isArray(model?.flds)) {
    for (const f of model.flds) {
      const idx = Number(f?.ord);
      if (Number.isInteger(idx) && idx >= 0) map.set(String(f.name), String(fields[idx] ?? ''));
    }
  }
  return map;
}

/**
 * Evaluate {{#Field}}…{{/Field}} (show when non-empty) and {{^Field}}…{{/Field}}
 * (show when empty) sections, innermost-first so nesting resolves naturally.
 * This is what makes "Basic (optional reversed card)" work: its Add Reverse
 * marker field only ever appears as a section guard, never as content.
 */
function renderSections(s, fieldMap) {
  // The name capture is trimmed by the surrounding \s*, and the closing tag
  // re-matches it with its own \s* tolerance — Anki trims tag keys, so
  // "{{#Add Reverse }}…{{/Add Reverse}}" must pair up. A byte-exact
  // backreference would leave such a pair unmatched and the guard would
  // silently become "always show".
  const SECTION_RE = /\{\{([#^])\s*([^}]+?)\s*\}\}((?:(?!\{\{[#^\/])[\s\S])*?)\{\{\/\s*\2\s*\}\}/;
  let prev;
  do {
    prev = s;
    s = s.replace(SECTION_RE, (_m, kind, name, body) => {
      const on = String(fieldMap.get(name) ?? '').trim() !== '';
      return (kind === '#' ? on : !on) ? body : '';
    });
  } while (s !== prev);
  return s;
}

/**
 * Render one side of a card from its template format string.
 *
 * Substitutions:
 *   {{Field}} and filter chains {{filter:…:Field}} — the field's raw HTML.
 *   {{cloze:Field}} — the field cloze-rendered for this card's ord
 *                     (masked on the front, revealed on the back).
 *   {{type:Field}}  — a typing box in Anki: nothing on the front (the box is
 *                     not content), the answer on the back.
 *   {{FrontSide}}   — dropped: this app shows front and back as separate
 *                     surfaces, so repeating the question inside the back
 *                     (Anki's default afmt does) would duplicate it.
 *   Specials (Tags, Deck, …) and unknown fields — dropped.
 *
 * Returns raw HTML; the caller flattens with htmlToText.
 */
function renderTemplate(fmt, fieldMap, { side = 'front', ord = 0 } = {}) {
  let s = renderSections(String(fmt ?? ''), fieldMap);
  s = s.replace(/\{\{([^{}]+)\}\}/g, (m, inner) => {
    inner = inner.trim();
    // A stray section tag that renderSections couldn't pair (malformed template).
    if (inner.startsWith('#') || inner.startsWith('^') || inner.startsWith('/')) return '';
    const parts = inner.split(':').map((p) => p.trim());
    const name = parts[parts.length - 1];
    const filters = parts.slice(0, -1);
    if (SPECIAL_FIELDS.has(name)) return '';
    if (!fieldMap.has(name)) return '';
    const value = fieldMap.get(name);
    // `type` must win over `cloze`: {{type:cloze:Text}} is a typing box, and
    // letting the cloze branch render it would print the whole question a
    // second time. Its back contribution is the target deletion's answer —
    // what Anki's answer-comparison line shows.
    if (filters.includes('type')) {
      if (side === 'front') return '';
      if (filters.includes('cloze')) {
        const answers = [];
        CLOZE_RE.lastIndex = 0;
        let m;
        while ((m = CLOZE_RE.exec(value)) !== null) {
          if (Number(m[1]) === ord + 1) answers.push(m[2]);
        }
        CLOZE_RE.lastIndex = 0;
        return answers.join(', ');
      }
      return value;
    }
    if (filters.includes('cloze')) {
      const r = renderCloze(value, ord);
      return side === 'front' ? r.front : r.back;
    }
    return value; // text:/hint:/furigana-style filters all reduce to the value here
  });
  return s;
}

// ─── .apkg ───────────────────────────────────────────────────────────────────

function parseApkg(filePath, tmpDirHint) {
  // Lazy requires: both load native/heavyweight code, and the worker should
  // fail with a real message if either is missing rather than at spawn.
  const AdmZip = require('adm-zip');
  const Database = require('better-sqlite3');

  const zip = new AdmZip(filePath);
  const names = new Set(zip.getEntries().map((e) => e.entryName));

  // Prefer .anki21: when both exist the .anki2 is a "please update" stub.
  const dbName = names.has('collection.anki21') ? 'collection.anki21'
    : names.has('collection.anki2') ? 'collection.anki2'
      : null;

  if (!dbName) {
    if (names.has('collection.anki21b')) {
      throw new Error(
        'This deck uses Anki\'s new export format, which Parallx cannot read yet. '
        + 'In Anki: File → Export → check "Support older Anki versions", then import that file.',
      );
    }
    throw new Error('No Anki collection found inside this file. Is it a .apkg export?');
  }

  // better-sqlite3 opens paths, not buffers — extract to a temp file. When the
  // bridge supplied the directory it also owns deletion (a timeout terminate()
  // skips this function's finally, so worker-side cleanup alone would leak the
  // extracted collection); the finally below still handles the normal path.
  const tmpDir = tmpDirHint
    ? (fs.mkdirSync(tmpDirHint, { recursive: true }), tmpDirHint)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'parallx-anki-'));

  try {
    // adm-zip returns null (not a throw) on a bad CRC or truncated entry —
    // turn that into an actionable message, not a writeFileSync TypeError.
    const collectionBytes = zip.readFile(dbName);
    if (!collectionBytes) {
      throw new Error('The collection inside this file is unreadable. The download may be corrupt or incomplete; re-export or re-download the deck.');
    }
    const dbPath = path.join(tmpDir, dbName);
    fs.writeFileSync(dbPath, collectionBytes);
    const db = new Database(dbPath, { readonly: true });
    try {
      const col = db.prepare('SELECT decks, models FROM col LIMIT 1').get();
      if (!col) throw new Error('The Anki collection is empty.');
      const deckNames = new Map();   // did -> name
      for (const [id, d] of Object.entries(JSON.parse(col.decks))) {
        // Anki nests decks with "::" in the name; keep it — it reads fine.
        deckNames.set(String(id), String(d.name ?? `Deck ${id}`));
      }
      const models = new Map();      // mid -> model
      for (const [id, m] of Object.entries(JSON.parse(col.models))) {
        models.set(String(id), m);
      }

      const notes = new Map();       // nid -> { flds, tags, mid }
      for (const n of db.prepare('SELECT id, flds, tags, mid FROM notes').iterate()) {
        notes.set(String(n.id), n);
      }

      const decks = new Map();       // name -> cards[]
      let mediaSkipped = 0;
      let cardCount = 0;

      for (const c of db.prepare('SELECT nid, did, ord FROM cards').iterate()) {
        const note = notes.get(String(c.nid));
        if (!note) continue;
        const fields = String(note.flds).split(FIELD_SEP);
        const model = models.get(String(note.mid));
        const tmpls = Array.isArray(model?.tmpls) ? model.tmpls : null;
        const hasTemplates = !!(tmpls && tmpls.length > 0 && Array.isArray(model?.flds) && model.flds.length > 0);

        // A cloze card whose deletion index no longer exists in the note (the
        // note was edited after card generation; Anki keeps the stale row
        // until Tools → Empty Cards) would render front === back — an
        // unanswerable junk card. Anki never shows these; neither do we.
        if (model && isClozeModel(model)
          && !new RegExp(`\\{\\{c${Number(c.ord) + 1}::`).test(String(note.flds))) {
          continue;
        }

        let front, back;
        if (hasTemplates) {
          // Cloze models have ONE template and use ord as the deletion index;
          // standard models use ord to pick which template renders the card.
          const tmpl = isClozeModel(model)
            ? tmpls[0]
            : tmpls.find((t) => Number(t?.ord) === Number(c.ord));
          if (!tmpl) continue; // template deleted — Anki would not show this card
          const fieldMap = buildFieldMap(model, fields);
          const fr = htmlToText(renderTemplate(tmpl.qfmt, fieldMap, { side: 'front', ord: c.ord }));
          const bk = htmlToText(renderTemplate(tmpl.afmt, fieldMap, { side: 'back', ord: c.ord }));
          mediaSkipped += fr.media + bk.media;
          front = fr.text; back = bk.text;
          // An empty rendered question is Anki's own "empty card" condition —
          // it never shows such a card, so importing it would add noise.
          if (!front.trim()) continue;
        } else if (model && isClozeModel(model)) {
          // Template-less cloze fallback: the cloze field is the first one
          // carrying a {{cN::}} marker (custom notetypes put e.g. a Title
          // field before the text); everything else joins the back as Extra.
          let clozeIdx = fields.findIndex((f) => /\{\{c\d+::/.test(String(f)));
          if (clozeIdx < 0) clozeIdx = 0;
          const flat = htmlToText(fields[clozeIdx] ?? '');
          mediaSkipped += flat.media;
          ({ front, back } = renderCloze(flat.text, c.ord));
          const extraParts = fields
            .filter((_f, i) => i !== clozeIdx)
            .map((f) => { const r = htmlToText(f); mediaSkipped += r.media; return r.text; })
            .filter(Boolean);
          if (extraParts.length) back = `${back}\n\n${extraParts.join('\n\n')}`;
        } else {
          // Template-less standard fallback: ord 0 = forward, ord 1 = the
          // stock reversed direction. Any higher ord would only duplicate the
          // forward card (there is no template to say otherwise) — skip it.
          if (Number(c.ord) >= 2) continue;
          const flat = fields.map((f) => { const r = htmlToText(f); mediaSkipped += r.media; return r.text; });
          const a = flat[0] ?? '';
          const b = flat.slice(1).filter(Boolean).join('\n\n');
          if (Number(c.ord) === 1) { front = flat[1] ?? ''; back = a; }
          else { front = a; back = b; }
        }

        if (!front.trim() && !back.trim()) continue;

        const tags = String(note.tags ?? '').trim().split(/\s+/).filter(Boolean);
        const deckName = deckNames.get(String(c.did)) ?? 'Imported';
        if (!decks.has(deckName)) decks.set(deckName, []);
        decks.get(deckName).push({ front, back, tags });
        cardCount++;
      }

      return {
        ok: true,
        decks: [...decks.entries()].map(([name, cards]) => ({ name, cards })),
        cardCount,
        mediaSkipped,
        source: dbName,
      };
    } finally {
      db.close();
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* temp cleanup is best-effort */ }
  }
}

// ─── Anki "Notes in Plain Text" (.txt) ───────────────────────────────────────

/**
 * Split one line of Anki TSV, honouring quoted fields.
 *
 * Anki quotes a field when it contains tabs, quotes or newlines, and escapes
 * quotes by doubling them. A quoted field can therefore span lines — the
 * caller feeds the whole file, not line fragments.
 */
function parseAnkiTxt(content, { defaultSep = '\t' } = {}) {
  const headers = {};
  const lines = String(content).replace(/^﻿/, '');

  let i = 0;
  // Header lines: "#separator:tab" etc. Only at the very top.
  const headerRe = /^#([a-z ]+):(.*)$/gim;
  let bodyStart = 0;
  for (const line of lines.split('\n')) {
    const m = /^#([a-z _-]+):(.*)$/i.exec(line.trim());
    if (m) { headers[m[1].trim().toLowerCase()] = m[2].trim(); bodyStart += line.length + 1; }
    else break;
  }
  void headerRe; void i;

  const sep = headers['separator'] === 'semicolon' ? ';'
    : headers['separator'] === 'comma' ? ','
      : headers['separator'] === 'tab' ? '\t'
        : defaultSep;
  const isHtml = headers['html'] !== 'false';
  const body = lines.slice(bodyStart);

  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let p = 0; p < body.length; p++) {
    const ch = body[p];
    if (inQuotes) {
      if (ch === '"') {
        if (body[p + 1] === '"') { field += '"'; p++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[p + 1] === '\n') p++;
      if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
      field = ''; row = [];
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // Column layout depends on export options: guid / notetype / deck columns
  // are declared in the headers when present.
  const guidCol = headers['guid column'] ? Number(headers['guid column']) - 1 : -1;
  const noteTypeCol = headers['notetype column'] ? Number(headers['notetype column']) - 1 : -1;
  const deckCol = headers['deck column'] ? Number(headers['deck column']) - 1 : -1;
  const tagsCol = headers['tags column'] ? Number(headers['tags column']) - 1 : -1;
  const meta = new Set([guidCol, noteTypeCol, deckCol, tagsCol].filter((n) => n >= 0));

  const decks = new Map();
  let mediaSkipped = 0;
  let cardCount = 0;

  for (const r of rows) {
    if (r.length === 0 || (r.length === 1 && !r[0].trim())) continue;
    const content_ = r.filter((_v, idx) => !meta.has(idx));
    if (content_.length === 0) continue;

    const noteType = noteTypeCol >= 0 ? (r[noteTypeCol] ?? '') : '';
    const deckName = deckCol >= 0 && r[deckCol] ? r[deckCol] : 'Imported';
    const tags = tagsCol >= 0 && r[tagsCol]
      ? r[tagsCol].trim().split(/\s+/).filter(Boolean)
      : [];

    const flatten = (v) => {
      if (!isHtml) return { text: String(v ?? '').trim(), media: 0 };
      return htmlToText(v);
    };

    if (/cloze/i.test(noteType) || CLOZE_RE.test(content_[0] ?? '')) {
      CLOZE_RE.lastIndex = 0;
      const flat = flatten(content_[0] ?? '');
      mediaSkipped += flat.media;
      // One card per distinct cloze index, as Anki generates.
      const indices = new Set();
      let m;
      while ((m = CLOZE_RE.exec(flat.text)) !== null) indices.add(Number(m[1]));
      CLOZE_RE.lastIndex = 0;
      const extra = flatten(content_[1] ?? '');
      mediaSkipped += extra.media;
      for (const idx of [...indices].sort((a, b) => a - b)) {
        const { front, back } = renderCloze(flat.text, idx - 1);
        if (!decks.has(deckName)) decks.set(deckName, []);
        decks.get(deckName).push({ front, back: extra.text ? `${back}\n\n${extra.text}` : back, tags });
        cardCount++;
      }
      continue;
    }

    const flat = content_.map((f) => { const x = flatten(f); mediaSkipped += x.media; return x.text; });
    const front = flat[0] ?? '';
    const back = flat.slice(1).filter(Boolean).join('\n\n');
    if (!front.trim() && !back.trim()) continue;
    if (!decks.has(deckName)) decks.set(deckName, []);
    decks.get(deckName).push({ front, back, tags });
    cardCount++;
  }

  return {
    ok: true,
    decks: [...decks.entries()].map(([name, cards]) => ({ name, cards })),
    cardCount,
    mediaSkipped,
    source: 'txt',
  };
}

// ─── Entry ───────────────────────────────────────────────────────────────────

function readAnkiFile(filePath, tmpDirHint) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.apkg' || ext === '.colpkg') return parseApkg(filePath, tmpDirHint);
  if (ext === '.txt' || ext === '.tsv' || ext === '.csv') {
    // A bare .csv (Excel export, no Anki headers) is comma-separated; Anki's
    // own .txt is tab. A #separator header always wins over this default.
    return parseAnkiTxt(fs.readFileSync(filePath, 'utf8'), {
      defaultSep: ext === '.csv' ? ',' : '\t',
    });
  }
  throw new Error(`Not an Anki export: "${path.basename(filePath)}". Expected .apkg or .txt.`);
}

if (parentPort) {
  try {
    parentPort.postMessage(readAnkiFile(workerData.filePath, workerData.tmpDir));
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
}

// Exported for the ELECTRON_RUN_AS_NODE verification harness, which exercises
// the parsing directly — vitest cannot load better-sqlite3 (Electron ABI).
module.exports = { htmlToText, renderCloze, renderTemplate, buildFieldMap, parseAnkiTxt, parseApkg, readAnkiFile };
