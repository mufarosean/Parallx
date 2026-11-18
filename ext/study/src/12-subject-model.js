// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: A SUBJECT'S RECORD — the pure part
// ═══════════════════════════════════════════════════════════════════════════════
//
// A subject is a canvas page with three canvas databases under it: Units,
// Questions and a Work Log. They are the person's own tables and they are the
// record: Study reads the rows, asks them, and writes each result back to its
// row. This part is the arithmetic of that, with no database and no DOM: which
// column of a database he already has plays which role, what a result is in
// the words its column uses, a unit's numbers counted from the rows, the
// units a folder proposes. 27-subjects.js does the reading and the writing.

/** What Study needs of a Questions database, in the order the mapping step shows them. */
const ST_SUBJECT_ROLES = ['answer', 'unit', 'attempts', 'correct', 'lastResult', 'lastAnswered'];
/** A role's name: its label on the mapping step, and the column added for it. */
const ST_SUBJECT_ROLE_LABELS = { answer: 'Answer', unit: 'Unit', attempts: 'Attempts', correct: 'Correct', lastResult: 'Last Result', lastAnswered: 'Last Answered' };
/** The columns of Units that Study works out; the person reads them. */
const ST_SUBJECT_KEPT = ['Questions', 'Answered', 'Right Last Time', 'Last Worked'];

/**
 * The columns of a subject's three databases (the title column, "Name", is
 * always there). `unitsDb` is the Units database a Unit column points at.
 */
function stSubjectColumns(unitsDb) {
  const unit = { name: 'Unit', type: 'relation', config: { databaseId: String(unitsDb || ''), synced: false } };
  const kept = (name, type) => ({ name, type, config: { computedBy: true } });
  return {
    units: [
      { name: 'Order', type: 'number' },
      { name: 'Weight', type: 'number' },
      kept('Questions', 'number'), kept('Answered', 'number'), kept('Right Last Time', 'number'), kept('Last Worked', 'date'),
    ],
    questions: [
      { name: 'Answer', type: 'text' },
      unit,
      { name: 'Kind', type: 'select', config: { options: ['Short', 'Essay'] } },
      { name: 'Source', type: 'url' },
      { name: 'Attempts', type: 'number' },
      { name: 'Correct', type: 'number' },
      { name: 'Last Result', type: 'select', config: { options: ['Right', 'Partly', 'Wrong'] } },
      { name: 'Last Answered', type: 'date' },
    ],
    log: [
      { name: 'Date', type: 'datetime' },
      { name: 'Minutes', type: 'number' },
      unit,
      { name: 'Tool', type: 'select', config: { options: ['Study'] } },
      { name: 'Kind', type: 'select', config: { options: ['Questions', 'Cards', 'Problems', 'Reading', 'Notes', 'Discussion'] } },
      { name: 'Items', type: 'number' },
      { name: 'Right', type: 'number' },
      { name: 'Confirmed', type: 'checkbox' },
      { name: 'Origin', type: 'select', config: { options: ['App', 'Manual', 'Import'] } },
    ],
  };
}

/** The column a role adds when the database has none for it. */
function stSubjectRoleColumn(role, unitsDb) {
  const name = ST_SUBJECT_ROLE_LABELS[role];
  return stSubjectColumns(unitsDb).questions.find((c) => c.name === name) || null;
}

const stSubjectFold = (s) => String(s ?? '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();

/** What a column's name must look like for each role, best first, and the types it may have. */
const ST_SUBJECT_GUESS = {
  answer: { types: ['text'], names: [/^(the )?(model|reference|correct|ideal|sample|full|right) answers?$/, /^answers?$/, /answer/, /^solutions?$/, /solution|response|explanation/] },
  unit: { types: ['select', 'status', 'text', 'relation', 'tags'], names: [/^units?$/, /^(paper|chapter|topic|reading|module|lesson|section|part|week)s?$/, /unit|paper|chapter|topic|reading|module|lesson/, /^(category|subject|area)$/] },
  attempts: { types: ['number'], names: [/^(times )?attempt(s|ed)?$/, /attempt/, /^(tries|times (asked|seen|answered|tried))$/, /tries|asked|seen/] },
  correct: { types: ['number'], names: [/^(times )?(correct|right)$/, /correct|right/, /^(wins|hits|score)$/] },
  lastResult: { types: ['select', 'status', 'checkbox', 'text'], names: [/^last (result|outcome|grade|mark|verdict)$/, /^(result|outcome|verdict)$/, /result|outcome/, /^(got it|correct|right|passed|known)\??$/] },
  lastAnswered: { types: ['date', 'datetime'], names: [/^last (answered|attempt(ed)?|asked|studied|seen|reviewed|worked|practi[cs]ed|tried)( on| at)?$/, /^(answered|reviewed|studied|attempted)( on| at)?$/, /last|answered|reviewed|studied/] },
};

/**
 * Which column of a database plays each role, guessed from the columns'
 * names and types: { answer, unit, attempts, correct, lastResult,
 * lastAnswered }, each a column's name or '' (nothing fits: a column is
 * added). A column is used once; the title column is the question itself.
 */
function stSubjectGuessMapping(columns) {
  const cols = (Array.isArray(columns) ? columns : []).filter((c) => c && c.type !== 'title' && c.name);
  const used = new Set();
  const out = {};
  for (const role of ST_SUBJECT_ROLES) {
    const rule = ST_SUBJECT_GUESS[role];
    let hit = null;
    for (const re of rule.names) {
      hit = cols.find((c) => !used.has(c.name) && rule.types.includes(c.type) && re.test(stSubjectFold(c.name)));
      if (hit) break;
    }
    out[role] = hit ? hit.name : '';
    if (hit) used.add(hit.name);
  }
  return out;
}

const ST_SUBJECT_WORDS = {
  right: ['right', 'correct', 'yes', 'pass', 'passed', 'true', 'got it', 'good', 'known', 'done'],
  partly: ['partly', 'partial', 'partially', 'half', 'almost', 'close', 'part right'],
  wrong: ['wrong', 'incorrect', 'no', 'fail', 'failed', 'false', 'miss', 'missed', 'bad', 'unknown', 'not yet'],
};

/** An option of a select meaning `result`, in the database's own word; '' when it has none. */
function stSubjectOptionFor(column, result) {
  const raw = column && column.config && Array.isArray(column.config.options) ? column.config.options : [];
  const options = raw.map((o) => String(o && typeof o === 'object' ? (o.value ?? o.name ?? '') : o)).filter(Boolean);
  const words = ST_SUBJECT_WORDS[result] || [];
  for (const w of words) {
    const hit = options.find((o) => stSubjectFold(o) === w);
    if (hit) return hit;
  }
  return '';
}

/**
 * A result ('right' | 'partly' | 'wrong') as the value its column takes: a
 * checkbox is checked when right; a select that already has words meaning
 * right and wrong gets those (partly, with no word of its own there, is
 * not right); anything else gets Right, Partly, Wrong.
 */
function stSubjectResultCell(column, result) {
  const type = column ? column.type : '';
  if (type === 'checkbox') return result === 'right';
  if (type === 'number') return result === 'right' ? 1 : 0;
  const plain = result === 'right' ? 'Right' : result === 'partly' ? 'Partly' : 'Wrong';
  if (type === 'select' || type === 'status') {
    const own = stSubjectOptionFor(column, result);
    if (own) return own;
    // His words for right and wrong, and none for partly: partly is his word for wrong.
    if (result === 'partly' && stSubjectOptionFor(column, 'right') && stSubjectOptionFor(column, 'wrong') && stSubjectOptionFor(column, 'right') !== 'Right') return stSubjectOptionFor(column, 'wrong');
  }
  return plain;
}

/** Does a stored Last Result mean the question was right last time? */
function stSubjectMeansRight(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ST_SUBJECT_WORDS.right.includes(stSubjectFold(value));
}

/** A session item's final verdict as a result, '' while it has none (pending, a Test answer not marked yet, skipped). */
function stSubjectResultOfItem(item) {
  const status = item ? item.status : '';
  if (status === 'right') return 'right';
  if (status !== 'wrong') return '';
  const v = item.verdict;
  return v && !v.overruled && Number(v.rating) === 2 ? 'partly' : 'wrong';
}

/**
 * The units a cell names: the text or the option itself, each tag, or the
 * titles of the Units rows a relation points at (`titleById`, by row page id).
 * With `relation` (the unit column is a relation) an id that names no row
 * (the row was deleted) names no unit, instead of becoming one called by its id.
 */
function stSubjectUnitNames(value, titleById, relation = false) {
  const list = Array.isArray(value) ? value : (value === null || value === undefined || value === '' ? [] : [value]);
  const out = [];
  for (const v of list) {
    const id = v && typeof v === 'object' ? String(v.id ?? v.pageId ?? '') : String(v);
    const known = !!titleById && titleById.has(id);
    if (relation && !known) continue;
    let name = known ? titleById.get(id) : (v && typeof v === 'object' ? (v.title ?? v.name ?? v.value ?? '') : v);
    name = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const stSubjectNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const stSubjectSameName = (a, b) => stSubjectFold(a) === stSubjectFold(b);

/**
 * A subject's numbers, counted from its Questions rows as they are now:
 * { total, answered, units: [{ name, total, answered, right, lastWorked }] }
 * with the units in the order the rows first name them. Answered is
 * Attempts over zero; right is what the Last Result means; last worked is
 * the latest Last Answered. A row naming no unit counts in the totals only.
 */
function stSubjectCounts(rows, mapping, titleById, relation = false) {
  const m = mapping || {};
  const units = [];
  let total = 0, answered = 0;
  for (const row of rows || []) {
    if (!row) continue;
    const v = row.values || {};
    const isAnswered = stSubjectNum(v[m.attempts]) > 0;
    const isRight = stSubjectMeansRight(v[m.lastResult]);
    const when = typeof v[m.lastAnswered] === 'string' ? v[m.lastAnswered].slice(0, 10) : '';
    total += 1;
    if (isAnswered) answered += 1;
    for (const name of stSubjectUnitNames(v[m.unit], titleById, relation)) {
      let u = units.find((x) => stSubjectSameName(x.name, name));
      if (!u) { u = { name, total: 0, answered: 0, right: 0, lastWorked: '' }; units.push(u); }
      u.total += 1;
      if (isAnswered) u.answered += 1;
      if (isRight) u.right += 1;
      if (when > u.lastWorked) u.lastWorked = when;
    }
  }
  return { total, answered, units };
}

/**
 * What Study must write into Units so its kept columns say what `counts`
 * says: [{ pageId, values }] for the rows that differ, naming only the cells
 * that differ and only columns the database has (`columnNames`).
 */
function stSubjectUnitChanges(unitRows, counts, columnNames) {
  const has = (name) => (columnNames || []).some((c) => stSubjectSameName(c, name));
  const out = [];
  for (const row of unitRows || []) {
    const c = ((counts && counts.units) || []).find((u) => stSubjectSameName(u.name, row.title)) || { total: 0, answered: 0, right: 0, lastWorked: '' };
    const want = { Questions: c.total, Answered: c.answered, 'Right Last Time': c.right, 'Last Worked': c.lastWorked };
    const values = {};
    for (const [name, value] of Object.entries(want)) {
      if (!has(name)) continue;
      const now = (row.values || {})[name];
      if (name === 'Last Worked') {
        const have = typeof now === 'string' ? now.slice(0, 10) : '';
        // A unit never worked keeps an empty cell; a date is never taken away by a count.
        if (value && have !== value) values[name] = value;
      } else if (now === undefined || now === null || now === '' || Number(now) !== value) values[name] = value;
    }
    if (Object.keys(values).length) out.push({ pageId: row.pageId, values });
  }
  return out;
}

/** A cell as the text of a question or an answer. */
function stSubjectText(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(stSubjectText).filter(Boolean).join(', ');
  if (typeof value === 'object') return String(value.title ?? value.name ?? value.value ?? '');
  return String(value);
}

/**
 * The Questions rows as question-provider items, one per row with a title:
 * { ref: the row's page id, question, answer, unit, kind }. The kind is the
 * row's Kind when it says Essay, else short.
 */
function stSubjectItems(rows, mapping, titleById, relation = false) {
  const m = mapping || {};
  const out = [];
  for (const row of rows || []) {
    const question = String((row && row.title) || '').trim();
    if (!row || !row.pageId || !question) continue;
    const v = row.values || {};
    out.push({
      ref: String(row.pageId),
      question,
      answer: stSubjectText(v[m.answer]).trim(),
      unit: stSubjectUnitNames(v[m.unit], titleById, relation)[0] || '',
      kind: /essay|long/i.test(stSubjectText(v.Kind)) ? 'essay' : 'short',
    });
  }
  return out;
}

/** File endings a unit is proposed from. */
const ST_SUBJECT_SOURCE_EXTS = ['pdf', 'md', 'markdown', 'txt'];

/**
 * The units a sources folder proposes, from its listing ([{ name, type }],
 * type 2 a folder): one per subfolder when it has any, else one per .pdf,
 * .md, .markdown or .txt file (named without the ending, once), in name
 * order with numbers read as numbers. Dot names are left out.
 */
function stSubjectUnitsFromListing(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.name && !String(e.name).startsWith('.'));
  const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  const folders = list.filter((e) => e.type === 2).map((e) => String(e.name));
  if (folders.length) return folders.sort(byName);
  const names = [];
  for (const e of list) {
    const m = /^(.+)\.([^.]+)$/.exec(String(e.name));
    if (!m || !ST_SUBJECT_SOURCE_EXTS.includes(m[2].toLowerCase())) continue;
    if (!names.some((n) => stSubjectSameName(n, m[1]))) names.push(m[1].trim());
  }
  return names.sort(byName);
}

const stSubjectPad = (n) => String(n).padStart(2, '0');
/** A moment as the date in his own day: "YYYY-MM-DD". */
function stSubjectLocalDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${stSubjectPad(d.getMonth() + 1)}-${stSubjectPad(d.getDate())}`;
}
/** A moment as a canvas datetime: "YYYY-MM-DDTHH:mm", local. */
function stSubjectLocalDateTime(ts) {
  const d = new Date(ts);
  return `${stSubjectLocalDate(ts)}T${stSubjectPad(d.getHours())}:${stSubjectPad(d.getMinutes())}`;
}

/** A session's own time as Work Log minutes: rounded up, at least one. */
function stSubjectMinutes(seconds) {
  return Math.max(1, Math.ceil((Number(seconds) || 0) / 60));
}

/**
 * A session's Work Log row: { title, values }, or null while nothing is
 * answered. Items counts every answer given (a Test answer waiting to be
 * marked too); Right the ones right. `unitRowIds` are the Units rows worked.
 */
function stSubjectLogValues(session, items, unitRowIds) {
  const given = (items || []).filter((i) => i && (i.status === 'right' || i.status === 'wrong' || i.status === 'answered'));
  if (!given.length) return null;
  return {
    title: String((session && session.name) || 'Study'),
    values: {
      Date: stSubjectLocalDateTime(Number(session && session.startedAt) || 0),
      Minutes: stSubjectMinutes(session && session.seconds),
      Unit: (unitRowIds || []).slice(),
      Tool: 'Study',
      Kind: 'Questions',
      Items: given.length,
      Right: given.filter((i) => i.status === 'right').length,
      Confirmed: true,
      Origin: 'App',
    },
  };
}
