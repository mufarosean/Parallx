// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: PROGRESS — the pure part
// ═══════════════════════════════════════════════════════════════════════════════
//
// Progress is a subject's units as bars: the questions of each unit by their
// Last Result, and beside them one bar for every tool that reports progress
// through the core's progress providers (problems, cards, whatever a tool
// counts). Everything counts in the same four states, best first: good,
// middling, poor, and the rest (not worked yet). This part is the arithmetic
// of that, with no database and no DOM: which unit a tool's group belongs to
// (by name, and by the names in Also Called), a question's state, the rows
// and totals the view shows, the order weakest first, and the names a screen
// reader speaks. 28-progress.js holds the live providers; 63-progress-view.js
// draws it.

const ST_PROGRESS_STATES = ['good', 'middling', 'poor', 'rest'];
/** Study's own words for the four states of a question. */
const ST_PROGRESS_WORDS = { good: 'Right', middling: 'Partly', poor: 'Wrong', rest: 'Not yet' };
/** A tool that gives no word for a state gets these. */
const ST_PROGRESS_PLAIN = { good: 'Good', middling: 'Middling', poor: 'Poor', rest: 'Not yet' };
/** The column of Units where he lists a unit's other names. It is his: Study only reads it. */
const ST_PROGRESS_ALSO = 'Also Called';
/** The id of Study's own kind beside the providers' ids. */
const ST_PROGRESS_QUESTIONS = 'questions';

/** A name as matching reads it: case, spaces, punctuation and accents aside. */
function stProgressFold(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** The names an Also Called cell lists: separated by commas (a semicolon or a new line does as well). */
function stProgressAliases(value) {
  if (value === null || value === undefined) return [];
  const text = Array.isArray(value) ? value.join(',') : String(value);
  return text.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean);
}

/**
 * Which unit each group of a tool belongs to: the unit whose name the
 * group's label equals (as stProgressFold reads names), else the unit that
 * lists the label in Also Called. `units` are [{ name, also }] in the Units
 * order; a name is matched before any Also Called, and the first unit wins a
 * name two units share. Returns { matched: one list of groups per unit,
 * unmatched: the groups no unit claims }, each in the order given.
 */
function stProgressMatch(units, groups) {
  const list = Array.isArray(units) ? units : [];
  const claim = new Map();
  list.forEach((u, i) => { const k = stProgressFold(u && u.name); if (k && !claim.has(k)) claim.set(k, i); });
  list.forEach((u, i) => { for (const a of stProgressAliases(u && u.also)) { const k = stProgressFold(a); if (k && !claim.has(k)) claim.set(k, i); } });
  const matched = list.map(() => []);
  const unmatched = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g) continue;
    const at = claim.get(stProgressFold(g.label));
    if (at === undefined) unmatched.push(g); else matched[at].push(g);
  }
  return { matched, unmatched };
}

/** A group's counts as [good, middling, poor, rest]: whole numbers, none below zero, the three never more than the total. */
function stProgressCountsOf(group) {
  const whole = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : 0; };
  const g = group || {};
  const total = whole(g.total);
  const good = Math.min(whole(g.good), total);
  const middling = Math.min(whole(g.middling), total - good);
  const poor = Math.min(whole(g.poor), total - good - middling);
  return [good, middling, poor, total - good - middling - poor];
}

const stProgressAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
const stProgressZero = () => [0, 0, 0, 0];

/**
 * A question's state from its Last Result cell: Right good, Partly middling,
 * Wrong poor (each in the database's own words too), nothing there the rest.
 * A checkbox or a number has no way to say "not answered", so unchecked (or
 * zero) is wrong only once the question was attempted.
 */
function stProgressQuestionState(value, attempted) {
  if (stSubjectMeansRight(value)) return 'good';
  if (value === false || value === 0) return attempted ? 'poor' : 'rest';
  if (typeof value !== 'string') return 'rest';
  const word = stSubjectFold(value);
  if (ST_SUBJECT_WORDS.partly.includes(word)) return 'middling';
  if (ST_SUBJECT_WORDS.wrong.includes(word)) return 'poor';
  return 'rest';
}

/**
 * A subject's questions by unit and state, counted from its Questions rows:
 * { units: [{ name, counts }], total, noUnit }, the units in the order the
 * rows first name them. A row naming two units counts in each and once in
 * the total; `noUnit` rows name none and count in the total only.
 */
function stProgressQuestions(rows, mapping, titleById, relation = false) {
  const m = mapping || {};
  const units = [];
  let total = stProgressZero();
  let noUnit = 0;
  for (const row of rows || []) {
    if (!row) continue;
    const v = row.values || {};
    const at = ST_PROGRESS_STATES.indexOf(stProgressQuestionState(v[m.lastResult], stSubjectNum(v[m.attempts]) > 0));
    const one = stProgressZero();
    one[at] = 1;
    total = stProgressAdd(total, one);
    const names = stSubjectUnitNames(v[m.unit], titleById, relation);
    if (!names.length) noUnit += 1;
    for (const name of names) {
      let u = units.find((x) => stSubjectSameName(x.name, name));
      if (!u) { u = { name, counts: stProgressZero() }; units.push(u); }
      u.counts = stProgressAdd(u.counts, one);
    }
  }
  return { units, total, noUnit };
}

/**
 * What the Progress view shows. `units` are [{ name, rowId, also }] in the
 * Units order; `questions` is stProgressQuestions' result; `providers` are
 * [{ id, kind, words, canOpen, groups }] as the tools report now. Returns
 * { rows, kinds, totals, unmatched, noUnit }:
 *   rows       one per unit: { name, rowId, kinds: [{ id, kind, words, counts,
 *              canOpen, groups: [{ group, counts }] }], all }, with a kind only
 *              when the unit has something in it; `all` is every kind together
 *   kinds      the kinds some unit has, questions first: [{ id, kind }]
 *   totals     one per kind: the questions over the whole subject, a tool's
 *              kind over its units' bars
 *   unmatched  per tool, the groups no unit claims: [{ id, kind, groups: [{ label, counts }] }]
 */
function stProgressBuild({ units, questions, providers }) {
  const list = Array.isArray(units) ? units : [];
  const q = questions || { units: [], total: stProgressZero(), noUnit: 0 };
  const sum = (c) => c[0] + c[1] + c[2] + c[3];
  const rows = list.map((u) => {
    const own = q.units.find((x) => stSubjectSameName(x.name, u.name));
    const kinds = own && sum(own.counts) > 0 ? [{ id: ST_PROGRESS_QUESTIONS, kind: 'Questions', words: ST_PROGRESS_WORDS, counts: own.counts.slice(), canOpen: true, groups: [] }] : [];
    return { name: u.name, rowId: u.rowId, kinds, all: stProgressZero() };
  });
  const kinds = [];
  const totals = [];
  const unmatched = [];
  if (sum(q.total) > 0) {
    kinds.push({ id: ST_PROGRESS_QUESTIONS, kind: 'Questions' });
    totals.push({ id: ST_PROGRESS_QUESTIONS, kind: 'Questions', words: ST_PROGRESS_WORDS, counts: q.total.slice() });
  }
  for (const p of Array.isArray(providers) ? providers : []) {
    if (!p) continue;
    const m = stProgressMatch(list, p.groups);
    let total = stProgressZero();
    m.matched.forEach((groups, i) => {
      const parts = groups.map((g) => ({ group: String(g.group ?? ''), counts: stProgressCountsOf(g) })).filter((g) => sum(g.counts) > 0);
      if (!parts.length) return;
      const counts = parts.reduce((t, g) => stProgressAdd(t, g.counts), stProgressZero());
      rows[i].kinds.push({ id: p.id, kind: p.kind, words: p.words || {}, counts, canOpen: !!p.canOpen, groups: parts });
      total = stProgressAdd(total, counts);
    });
    if (sum(total) > 0) {
      kinds.push({ id: p.id, kind: p.kind });
      totals.push({ id: p.id, kind: p.kind, words: p.words || {}, counts: total });
    }
    const loose = m.unmatched.map((g) => ({ label: String(g.label || g.group || ''), counts: stProgressCountsOf(g) })).filter((g) => sum(g.counts) > 0);
    if (loose.length) unmatched.push({ id: p.id, kind: p.kind, groups: loose });
  }
  for (const row of rows) row.all = row.kinds.reduce((t, k) => stProgressAdd(t, k.counts), stProgressZero());
  return { rows, kinds, totals, unmatched, noUnit: Number(q.noUnit) || 0 };
}

/**
 * The rows weakest first: the lowest share of good over all a unit's items
 * first; units with nothing attempted come last. Equals keep their order.
 */
function stProgressWeakestFirst(rows) {
  const list = (rows || []).map((row, i) => {
    const c = row.all || stProgressZero();
    const total = c[0] + c[1] + c[2] + c[3];
    return { row, i, attempted: c[0] + c[1] + c[2] > 0, share: total ? c[0] / total : 0 };
  });
  return list.sort((a, b) => (Number(b.attempted) - Number(a.attempted)) || (a.attempted ? a.share - b.share : 0) || (a.i - b.i)).map((x) => x.row);
}

/** A state's word as a bar speaks it: lower case, and no comma (the name's own separator). */
function stProgressWord(words, state) {
  const own = words && typeof words[state] === 'string' ? words[state].trim() : '';
  return (own || ST_PROGRESS_PLAIN[state]).replace(/\s*,\s*/g, ' ').toLowerCase();
}

/** A bar's whole name: "Mack, Questions: 12 right, 3 partly, 2 wrong, 5 not yet". With no kind: "Mack: …". */
function stProgressBarName(owner, kind, counts, words) {
  const said = ST_PROGRESS_STATES.map((s, i) => `${counts[i]} ${stProgressWord(words, s)}`).join(', ');
  return `${owner}${kind ? `, ${kind}` : ''}: ${said}`;
}

/** One part's name: "Mack, Questions, wrong: 2. Study these" (the last sentence only when pressing it does something). */
function stProgressPartName(owner, kind, word, count, action = '') {
  return `${owner}, ${kind}, ${String(word).replace(/\s*,\s*/g, ' ').toLowerCase()}: ${count}${action ? `. ${action}` : ''}`;
}

/** "N of M": the three states together over all. */
function stProgressCountText(counts) {
  return `${counts[0] + counts[1] + counts[2]} of ${counts[0] + counts[1] + counts[2] + counts[3]}`;
}

/** The line for a tool's groups that match no unit: "Problems not matched to a unit: Brosius 6, Hürlimann 3". */
function stProgressUnmatchedText(kind, groups) {
  return `${kind} not matched to a unit: ${(groups || []).map((g) => `${g.label} ${g.counts[0] + g.counts[1] + g.counts[2] + g.counts[3]}`).join(', ')}`;
}

/**
 * The questions whose row is in `state` now. `rows` is the subject's rows by
 * page id, `names` its mapped column names. A question whose row is gone, a
 * state that is not one, or no rows to read: none.
 */
function stProgressFilterByResult(questions, rows, names, state) {
  if (!rows || !ST_PROGRESS_STATES.includes(state)) return [];
  const n = names || {};
  return (questions || []).filter((q) => {
    const row = rows.get(stProviderRefOf(q));
    if (!row) return false;
    const v = row.values || {};
    return stProgressQuestionState(v[n.lastResult], stSubjectNum(v[n.attempts]) > 0) === state;
  });
}
