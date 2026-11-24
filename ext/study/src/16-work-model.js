// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: THE WORK LOG'S ROWS FROM OTHER WORK — the pure part
// ═══════════════════════════════════════════════════════════════════════════════
//
// A subject's Work Log is the one record of the work done on it, and the
// plan's Done is the sum of its Minutes by day. A session writes its own row
// (27-subjects.js). Everything else reaches the Work Log from a report: the
// tools in which he works say what each day's work came to through the core's
// work providers (api.work: minutes, items and right, by local day and group),
// and Study's own clocks say what he read and discussed. This part is the
// arithmetic of turning a report into rows, with no database and no DOM:
// which unit a report's group is (the matching Progress uses: the unit's name,
// then Also Called), the one row a tool, a unit and a day come to, the cells
// Study writes for it, whether a row is still as Study wrote it (a row he
// changed is his from then on), and where a subject's minutes came from for
// today and the week. 32-work.js reads the reports and writes the rows.

/** The cells of a Work Log row that Study writes from a report, in the table's order. */
const ST_WORK_CELLS = ['Date', 'Minutes', 'Unit', 'Tool', 'Kind', 'Items', 'Right', 'Confirmed', 'Origin'];
/** Study's own two kinds of work that are not a session, each counted by a clock of its own. */
const ST_WORK_READING = 'Reading';
const ST_WORK_DISCUSSION = 'Discussion';

/**
 * Which unit a piece of work belongs to: the unit that claims the first of
 * its groups any unit claims (a card's tags come before its deck, so a tag's
 * unit wins over the deck's). `units` are [{ name, also }] in the Units
 * order. Returns the unit's place in `units`, or -1 when no unit claims any.
 */
function stWorkUnitIndex(units, groups) {
  const list = (Array.isArray(groups) ? groups : []).filter((g) => g && typeof g === 'object');
  const { matched } = stProgressMatch(units, list);
  let best = -1;
  let at = Infinity;
  matched.forEach((mine, i) => { for (const g of mine) { const k = list.indexOf(g); if (k < at) { at = k; best = i; } } });
  return best;
}

/** Minutes as the Work Log holds them: whole, to the nearest. */
const stWorkMinutes = (minutes) => { const n = Math.round(Number(minutes) || 0); return n > 0 ? n : 0; };

/**
 * What a source's report comes to for a subject: one row per unit and local
 * day. `source` is { id, tool, kind }; `entries` are the report ({ day,
 * groups, minutes, items, right? }, or { day, unitRow, minutes } for Study's
 * own clocks, which know the unit); `units` are [{ name, rowId, also }].
 * Work for a group no unit claims is in no row. Returns
 * [{ key, source, tool, kind, unitRow, unit, day, minutes, items, right }]
 * (`right` null when the source never says), a row that would hold no minute
 * and no item left out.
 */
function stWorkWanted(source, entries, units) {
  const by = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(String(e.day || ''))) continue;
    const unit = e.unitRow !== undefined ? units.find((u) => u.rowId === e.unitRow) : units[stWorkUnitIndex(units, e.groups)];
    if (!unit) continue;
    const key = `${source.id}\u0000${unit.rowId}\u0000${e.day}`;
    let w = by.get(key);
    if (!w) { w = { key, source: source.id, tool: source.tool, kind: source.kind, unitRow: unit.rowId, unit: unit.name, day: e.day, minutes: 0, items: 0, right: null }; by.set(key, w); }
    w.minutes += Math.max(0, Number(e.minutes) || 0);
    w.items += Math.max(0, Math.floor(Number(e.items) || 0));
    if (e.right !== undefined && e.right !== null) w.right = (w.right || 0) + Math.max(0, Math.floor(Number(e.right) || 0));
  }
  return [...by.values()].map((w) => ({ ...w, minutes: stWorkMinutes(w.minutes) })).filter((w) => w.minutes > 0 || w.items > 0);
}

/** The row Study writes for one tool, unit and day: its title and its cells by column name. */
function stWorkRowValues(want) {
  return {
    title: `${want.tool} · ${want.unit}`,
    values: {
      Date: `${want.day}T00:00`,
      Minutes: want.minutes,
      Unit: [want.unitRow],
      Tool: want.tool,
      Kind: want.kind,
      Items: want.items,
      Right: want.right === null || want.right === undefined ? null : want.right,
      Confirmed: true,
      Origin: 'App',
    },
  };
}

/** A cell as Study compares it: what he sees, whatever way the table stores it. */
function stWorkCellKey(name, value) {
  if (name === 'Date') return typeof value === 'string' ? value.trim().slice(0, 16) : '';
  if (name === 'Minutes' || name === 'Items' || name === 'Right') return value === null || value === undefined || value === '' ? null : Number(value);
  if (name === 'Unit') return (Array.isArray(value) ? value : value ? [value] : []).map((v) => (v && typeof v === 'object' ? String(v.id ?? v.pageId ?? '') : String(v))).sort();
  if (name === 'Confirmed') return value === true || value === 1;
  return String(Array.isArray(value) ? value.join(', ') : value ?? '').trim();
}

/** Do two sets of cells say the same, over the cells named in `a`? */
function stWorkSame(a, b) {
  return Object.keys(a || {}).every((name) => JSON.stringify(stWorkCellKey(name, (a || {})[name])) === JSON.stringify(stWorkCellKey(name, stPlanCell(b, name))));
}

/**
 * What to do with one row Study wants, given what it remembers of the row
 * (`rec`: { rowId, written, pending, his }, or null when it never wrote one)
 * and the row as the table has it now (`row`, or null when it is not there):
 *   'add'     no row was ever written for this tool, unit and day
 *   'none'    the row says what the tool says, or the row is his
 *   'update'  the row is as Study wrote it and the tool says something new:
 *             `values` are the cells to write
 *   'his'     he changed the row, or took it out: it is never touched again
 *             and no second row is made
 * `values` are the cells Study would write (stWorkRowValues, the columns the
 * table has).
 */
function stWorkDecide(values, rec, row) {
  if (!rec) return { act: 'add' };
  if (rec.his) return { act: 'none' };
  if (stWorkSame(values, rec.written)) return { act: 'none' };
  if (!row) return { act: 'his' };
  // As Study wrote it, or as it was about to write it when a write was cut short: still Study's.
  const untouched = stWorkSame(rec.written, row.values) || (rec.pending && stWorkSame(rec.pending, row.values));
  if (!untouched) return { act: 'his' };
  const changed = Object.fromEntries(Object.entries(values).filter(([name, v]) => JSON.stringify(stWorkCellKey(name, v)) !== JSON.stringify(stWorkCellKey(name, stPlanCell(row.values, name)))));
  return Object.keys(changed).length ? { act: 'update', values: changed } : { act: 'none', settle: true };
}

/** Minutes as a person reads them: "25 min", "1 h", "1 h 5 min". */
function stWorkTimeWords(minutes) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

/**
 * Where a subject's minutes came from, from its Work Log's rows: for today
 * and for the week of today (Monday to Sunday, as the plan counts weeks), by
 * the row's Kind (its Tool when it has no Kind, "Other" when it has
 * neither). `localDate` turns a moment with a zone into the person's date.
 * Returns { rows: [{ name, today, week }] (the kinds with minutes this week,
 * the table's own kinds first, in its order), today, week } in minutes.
 */
function stWorkBreakdown(logRows, today, localDate = null) {
  const monday = stPlanAddDays(today, -stPlanWeekdayIndex(today));
  const sunday = stPlanAddDays(monday, 6);
  const by = new Map();
  let allToday = 0;
  let allWeek = 0;
  for (const r of logRows || []) {
    const v = (r && r.values) || {};
    const raw = stPlanCell(v, 'Date');
    const zoned = typeof raw === 'string' && /T.*(Z|[+-]\d{2}:?\d{2})$/.test(raw);
    const date = zoned && localDate ? localDate(raw) : stPlanDateOf(raw);
    const minutes = stPlanHours(stPlanCell(v, 'Minutes'));
    if (!date || !minutes || date < monday || date > sunday) continue;
    const name = stWorkCellKey('Kind', stPlanCell(v, 'Kind')) || stWorkCellKey('Tool', stPlanCell(v, 'Tool')) || 'Other';
    let k = by.get(name.toLowerCase());
    if (!k) { k = { name, today: 0, week: 0 }; by.set(name.toLowerCase(), k); }
    k.week += minutes;
    allWeek += minutes;
    if (date === today) { k.today += minutes; allToday += minutes; }
  }
  const order = ['questions', 'problems', 'cards', 'reading', 'discussion', 'notes'];
  const place = (k) => { const i = order.indexOf(k.name.toLowerCase()); return i < 0 ? order.length : i; };
  const rows = [...by.values()].sort((a, b) => (place(a) - place(b)) || a.name.localeCompare(b.name));
  return { rows, today: allToday, week: allWeek, monday, sunday };
}
