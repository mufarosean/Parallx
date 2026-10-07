// Study: review dense material without rereading it.
//
// Multiple-choice practice, typed and essay tests graded against the text,
// every question anchored to the page it came from, and only what was missed
// sent on to Flashcards. A material is a PDF, a canvas page or an imported
// question bank; a concept map per section is the unit of coverage and
// mastery; sessions draw from a bank that generation keeps topped up.
//
// Integration points (everything the host offers, used once each):
//   - api.database          per-extension SQLite (st_* tables)
//   - api.lm                concept maps, question writing, checks, grading
//   - api.commands          canvas.getPageMarkdown, questions.getRegistry,
//                           flashcards.addCards (only while it exists)
//   - api.editors           the study pane, openFileEditor for Show Source
//   - api.chat              the selection action, chat tools
//   - api.dashboard         the Weak Spots widget
//   - api.links             parallx://study/... deep links
//   - parallxElectron.document.extractText   PDF text and outline
//   - parallxElectron.python                 numeric checks
//
// ext/study/main.js is GENERATED: it is the concatenation, in filename order,
// of ext/study/src/*.js (node scripts/bundle-study.mjs writes it, and
// tests/unit/studyBundle.test.ts fails when it is stale). The parts share one
// module scope: no import, no export except in 90-activate.js. Function
// declarations hoist, const does not, so a part never runs code at load time
// beyond declaring things. Edit the parts, then run the bundler.
//
// Pure logic lives in 10-model.js and is exported through __testables so
// tests/unit/study*.test.ts can run it without a DOM, a model or a database.

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 0: SHARED HELPERS (every part may use these names)
// ═══════════════════════════════════════════════════════════════════════════════

/** The host api, bound in activate(). */
let _api = null;
/** api.database, bound in activate(). */
let _dbBridge = null;

/** The Flashcards database wrapper, copied: errors surface as thrown Errors
 *  with a prefix, so a failed statement never reads as an empty result. */
const db = {
  async run(sql, params = []) {
    const res = await _dbBridge.run(sql, params);
    if (res.error) throw new Error(`[ST-DB] ${res.error.message}`);
    return res;
  },
  async get(sql, params = []) {
    const res = await _dbBridge.get(sql, params);
    if (res.error) throw new Error(`[ST-DB] ${res.error.message}`);
    return res.row ?? null;
  },
  async all(sql, params = []) {
    const res = await _dbBridge.all(sql, params);
    if (res.error) throw new Error(`[ST-DB] ${res.error.message}`);
    return res.rows ?? [];
  },
};

/** The preload bridge (document extraction, python, fs). Copied from Flashcards. */
function electronBridge() {
  return globalThis.parallxElectron;
}

/** Make an element. Copied from Flashcards, with defaults so `el('div')` reads cleanly. */
function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== '') node.textContent = text;
  return node;
}

/** Icon html from the registry, '' when the api is not bound yet. */
function icon(id, size = 16) {
  try {
    if (_api?.icons?.createIconHtml) return _api.icons.createIconHtml(id, size);
  } catch { /* noop */ }
  return '';
}

/** A Study setting (the manifest's `study.*` keys, given without the prefix). */
function cfg(key, fallback) {
  try {
    const c = _api.workspace.getConfiguration('study');
    const v = c.get(String(key).replace(/^study\./, ''), fallback);
    return v === undefined ? fallback : v;
  } catch {
    return fallback;
  }
}

/** The clock, in one place, so the pure model can take `now` as an argument. */
function stNow() {
  return Date.now();
}

/** fsPath of the first workspace folder, or ''. */
function stWorkspaceRoot() {
  try {
    const uri = _api?.workspace?.workspaceFolders?.[0]?.uri;
    return uri ? stFsPathOf(uri) : '';
  } catch {
    return '';
  }
}

/** A file:// URI or a raw path, as an fs path. Copied from Flashcards (fcUriToFsPath). */
function stFsPathOf(uriOrPath) {
  if (!uriOrPath) return '';
  let p = String(uriOrPath);
  if (/^file:\/\//i.test(p)) {
    p = p.replace(/^file:\/\//i, '');
    try { p = decodeURIComponent(p); } catch { /* leave encoded on malformed input */ }
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1); // /D:/x → D:/x
  }
  return p;
}

/** An fs path as a file:// URI string (already a URI: returned as is). */
function stUriOf(fsPath) {
  const p = String(fsPath || '');
  if (!p) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return p;
  let norm = p.replace(/\\/g, '/');
  if (!norm.startsWith('/')) norm = '/' + norm;
  return 'file://' + encodeURI(norm).replace(/[?#]/g, (c) => encodeURIComponent(c));
}

/** Cut text to `max` characters with a trailing ellipsis. */
function stTruncate(text, max) {
  const s = String(text ?? '');
  const n = Math.max(1, Number(max) || 1);
  if (s.length <= n) return s;
  return s.slice(0, Math.max(0, n - 1)).replace(/\s+$/, '') + '…';
}

/** HTML-escape text for innerHTML. */
function stEsc(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The in-extension event bus. Events: 'data' (anything changed), 'route'
 * (pane navigation), 'run' (generation progress {runId, ...}), 'session'
 * (a session item was answered). `on` returns a dispose function that is
 * also an IDisposable, so it can go straight on context.subscriptions.
 */
const bus = (() => {
  const listeners = new Map();
  return {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      const set = listeners.get(event);
      set.add(fn);
      const dispose = () => { set.delete(fn); };
      dispose.dispose = dispose;
      return dispose;
    },
    emit(event, detail) {
      const set = listeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try { fn(detail); } catch (err) { console.error('[Study] listener failed', err); }
      }
    },
  };
})();

function _emitDataChanged() {
  bus.emit('data');
}

function onDataChanged(fn) {
  return bus.on('data', fn);
}

/** Question formats, and the ones answered by typing. */
const ST_FORMATS = ['mc', 'short', 'essay', 'numeric', 'formula', 'cloze'];
const ST_TYPED = new Set(['short', 'essay', 'numeric', 'formula', 'cloze']);

/** Ratings (the Flashcards scale) and time units. */
const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
const MIN = 60000, DAY = 86400000;

/** The px-study icon as inline svg (the manifest's, for openEditor iconHtml). */
const ST_ICON_HTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v13.5"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H20"/><path d="M9 9h6M9 13h4"/></svg>';
