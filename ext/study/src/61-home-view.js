// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 61: HOME — what Study opens on
// ═══════════════════════════════════════════════════════════════════════════════
//
// One tab ('home', titled "Study"), the first thing he sees: what to do today
// across every subject (each line opens the thing to work on), where he
// stands (the days to each exam, this week done against planned), and the
// plan as a calendar of every subject, read by week or by month and changed
// in place: a day's work moved to another day (dragged, or from the day's
// menu by keys or a finger), a day taken off, the work pushed on to the next
// free day, its hours set. Every change is written to the plan's own Days
// database, where a day he changed is his from then on (13-plan-model.js).
// Nothing here is stored by Study: the page is drawn from the plans and the
// subjects as they are, and again whenever they change.

const ST_HOME_CELLS = ['Type', 'Phase', 'Work', 'Floor', 'Standard', 'Stretch'];
const ST_HOME_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ST_HOME_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Hours in words: "2.5 h", under a tenth of an hour in minutes. */
function stHomeHours(h) {
  const n = Number(h) || 0;
  if (n > 0 && n < 0.1) return `${Math.max(1, Math.round(n * 60))} min`;
  return `${stPlanH(n)} h`;
}

/** How a state of a kind is said on Home: the tool's own word for it, lower case. */
const ST_HOME_STATE_ORDER = ['poor', 'middling', 'rest'];

/**
 * What to work on today in a subject, from what he knows of it: every unit's
 * items that are wrong, then the ones half known, then the ones not worked
 * yet, the kinds (questions, problems, cards) mixed so the day is not one
 * tool. Each block names the unit, the kind, how many and in which state,
 * and what opens them. At most `max`.
 */
function stHomeBlocks(progress, max = 5) {
  if (!progress) return [];
  const all = [];
  for (const row of progress.rows) {
    for (const k of row.kinds) {
      ST_HOME_STATE_ORDER.forEach((state, rank) => {
        const n = k.counts[ST_PROGRESS_STATES.indexOf(state)] || 0;
        if (!n) return;
        const word = String((k.words && k.words[state]) || ST_PROGRESS_PLAIN[state]).toLowerCase();
        all.push({ unit: row.name, rowId: row.rowId, kindId: k.id, kind: k.kind, state, rank, n, word, canOpen: !!k.canOpen, groups: (k.groups || []).map((g) => g.group) });
      });
    }
  }
  // Worst state first; within a state the kinds take turns, each with its largest block first.
  const out = [];
  for (let rank = 0; rank < ST_HOME_STATE_ORDER.length && out.length < max; rank++) {
    const byKind = new Map();
    for (const b of all.filter((x) => x.rank === rank).sort((a, b) => b.n - a.n)) { const l = byKind.get(b.kindId) || []; l.push(b); byKind.set(b.kindId, l); }
    const lists = [...byKind.values()];
    for (let i = 0; lists.some((l) => l[i]) && out.length < max; i++) for (const l of lists) if (l[i] && out.length < max) out.push(l[i]);
  }
  return out;
}

const stHomeMonday = (iso) => stPlanAddDays(iso, -stPlanWeekdayIndex(iso));
const stHomeMonthStart = (iso) => `${iso.slice(0, 8)}01`;
function stHomeAddMonths(iso, n) {
  const y = Number(iso.slice(0, 4)); const m = Number(iso.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12); const mm = ((m % 12) + 12) % 12;
  return `${String(yy).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}-01`;
}

/**
 * Everything the page draws, from the subjects and plans as they are: a
 * subject per entry with its plan (the one whose exam is still to come), its
 * day today, how far it is ahead or behind, and its weakest units; and the
 * days of every plan by date.
 */
function stHomeModel(today) {
  const subjects = stSubjectsShown().map((s, i) => {
    const { shown } = stPlansOfSubject(s.id, today);
    const st = shown && shown.synced && !shown.problem && shown.rules && Array.isArray(shown.days) ? shown : null;
    const out = { id: s.id, name: s.name, bankId: s.subject.bankId, hue: (i % 6) + 1, plan: null, waiting: !!shown && !st && !shown.problem, units: [] };
    const progress = stProgressOfSubject(s.id);
    out.blocks = stHomeBlocks(progress);
    if (progress) {
      out.units = stProgressWeakestFirst(progress.rows).slice(0, 3).map((r) => {
        const c = r.all || [0, 0, 0, 0];
        const total = c[0] + c[1] + c[2] + c[3];
        return { name: r.name, rowId: r.rowId, words: total ? `${c[0]} of ${total} right` : 'not started' };
      });
    } else out.units = s.units.slice(0, 3).map((u) => ({ name: u.name, rowId: u.rowId, words: u.total ? `${u.answered} of ${u.total} answered` : 'not started' }));
    if (st) {
      const done = st.done || new Map();
      const day = st.days.find((d) => d.date === today) || null;
      let plannedSoFar = 0; let doneSoFar = 0;
      for (const d of st.days) {
        if (d.date < today) plannedSoFar += d.planned;
        if (d.date <= today) doneSoFar += Number(done.get(d.date)) || 0;
      }
      out.plan = {
        id: st.plan.id, name: st.plan.name, exam: st.rules.exam, following: st.rules.following,
        daysLeft: stPlanDaysBetween(today, st.rules.exam),
        today: day ? { type: day.type, phase: day.phase, planned: day.planned, done: stPlanRound(Number(done.get(today)) || 0) } : null,
        behind: stPlanRound(plannedSoFar - (doneSoFar - (Number(done.get(today)) || 0))),
      };
    }
    return out;
  });
  const byDate = new Map();
  for (const s of subjects) {
    if (!s.plan) continue;
    const st = _stPlans.get(s.plan.id);
    for (const d of st.days) {
      const list = byDate.get(d.date) || [];
      list.push({ subject: s, planId: s.plan.id, date: d.date, type: d.type, phase: d.phase, planned: d.planned, done: st.done ? stPlanRound(Number(st.done.get(d.date)) || 0) : 0, edited: !!d.kept, past: d.date < today });
      byDate.set(d.date, list);
    }
  }
  return { today, subjects, byDate };
}

// ── Changing a day ──────────────────────────────────────────────────────────

/** A plan's Days rows by date, read now. */
async function stHomeDayRows(st) {
  const door = stSubjectDoor();
  if (!door) return null;
  const rows = await door.listRows(st.plan.daysDb);
  const map = new Map();
  for (const r of rows) { const date = stPlanDateOf(stPlanCell(r.values, 'Date')); if (date) map.set(date, r); }
  return { door, map };
}

const stHomeCellsOf = (row) => Object.fromEntries(ST_HOME_CELLS.map((c) => { const v = stPlanCell(row.values, c); return [c, v === undefined || v === '' ? null : v]; }));
const stHomeRestCells = () => ({ Type: 'Rest', Phase: null, Work: 0, Floor: 0, Standard: 0, Stretch: 0 });

/** Run a change to a plan's days after whatever the plan is doing; false when it could not be made. */
async function stHomeChange(planId, change) {
  const st = _stPlans.get(Number(planId));
  if (!st || st.problem || !st.synced) return false;
  let ok = false;
  await stPlanEnqueue(st, async () => {
    const got = await stHomeDayRows(st);
    if (!got) return;
    const updates = change(got.map, st) || [];
    if (!updates.length) return;
    stPlanLive(st);
    await got.door.updateRows(st.plan.daysDb, updates);
    ok = true;
  });
  return ok;
}

/** Two days change places: each takes the other's Type, Phase and hours. */
function stHomeMoveDay(planId, from, to) {
  if (from === to) return Promise.resolve(false);
  return stHomeChange(planId, (rows) => {
    const a = rows.get(from); const b = rows.get(to);
    if (!a || !b) return [];
    return [{ pageId: a.pageId, values: stHomeCellsOf(b) }, { pageId: b.pageId, values: stHomeCellsOf(a) }];
  });
}

/** The day is a rest day: its work is dropped. */
function stHomeDayOff(planId, date) {
  return stHomeChange(planId, (rows) => { const r = rows.get(date); return r ? [{ pageId: r.pageId, values: stHomeRestCells() }] : []; });
}

/**
 * The day is taken off and its work pushed on: each day after it takes the
 * work of the day before, up to the next day with no hours, which takes the
 * last of it. With no free day before the exam, nothing is changed.
 */
function stHomePushDay(planId, date) {
  return stHomeChange(planId, (rows, st) => {
    const days = st.days.filter((d) => d.date >= date);
    const free = days.findIndex((d, i) => i > 0 && !(d.planned > 0));
    if (free < 1) return [];
    const span = days.slice(0, free + 1).map((d) => rows.get(d.date));
    if (span.some((r) => !r)) return [];
    const updates = [{ pageId: span[0].pageId, values: stHomeRestCells() }];
    for (let i = 1; i < span.length; i++) updates.push({ pageId: span[i].pageId, values: stHomeCellsOf(span[i - 1]) });
    return updates;
  });
}

/** The day's hours in the plan he follows are set to `hours` (study time at work first, as the day had it). */
function stHomeSetHours(planId, date, hours) {
  const want = Math.max(0, Math.round((Number(hours) || 0) * 100) / 100);
  return stHomeChange(planId, (rows, st) => {
    const r = rows.get(date);
    if (!r) return [];
    const cells = stHomeCellsOf(r);
    const work = Math.min(stPlanHours(cells.Work), want);
    const values = { ...cells, Work: work, [st.rules.following]: stPlanRound(want - work) };
    if (want > 0 && (!values.Type || values.Type === 'Rest')) values.Type = 'Study';
    if (!(want > 0)) values.Type = 'Rest';
    return [{ pageId: r.pageId, values }];
  });
}

/** Whether a day's work can be pushed on: a free day lies between it and the exam. */
function stHomeCanPush(planId, date) {
  const st = _stPlans.get(Number(planId));
  if (!st || !Array.isArray(st.days)) return false;
  return st.days.filter((d) => d.date >= date).findIndex((d, i) => i > 0 && !(d.planned > 0)) >= 1;
}

// ── The page ────────────────────────────────────────────────────────────────

function stOpenHome() {
  return stOpenPane({ view: 'home' });
}

/** The Home page on screen: what its commands reach (null while none is drawn). */
let _stHome = null;

/** Home's calendar: 'prev', 'next' or 'today'. */
function stCmdHomeShow(what) {
  if (!_stHome) return false;
  _stHome.show(String(what || ''));
  return true;
}

/** The menu of one subject's work on one day, opened at its button on Home. */
function stCmdHomeDay(planId, date) {
  if (!_stHome) return false;
  return _stHome.day(Number(planId) || 0, String(date || ''));
}

async function renderHome(host, route, ctx) {
  const ui = _api.ui;
  const page = ui.createBlock(host, 'div', { className: 'st-home' });
  const inner = ui.createBlock(page, 'div', { className: 'st-home__in' });
  const view = { mode: 'week', anchor: '' };
  let parts = [];
  let drawn = '';
  let first = true;
  let dragged = false;
  const chips = new Map();
  stProgressWant();

  const say = ui.createBlock(page, 'div', { className: 'st-sr', attrs: { role: 'status', 'aria-live': 'polite' } });
  const tell = (text) => { say.textContent = ''; say.textContent = text; };

  const act = async (run, done) => {
    try {
      const ok = await run();
      tell(ok ? done : 'Nothing was changed.');
    } catch (err) {
      if (!stIsStopped(err)) { console.warn('[Study] the day could not be changed:', err && err.message); tell('The day could not be changed.'); }
    }
  };

  const dayMenu = (anchor, item) => {
    const words = stPlanDateWords(item.date);
    const items = [
      { label: 'Move One Day Earlier', icon: 'arrow-left', disabled: item.past || stPlanAddDays(item.date, -1) < stPlanToday(), onSelect: () => void act(() => stHomeMoveDay(item.planId, item.date, stPlanAddDays(item.date, -1)), `${item.subject.name}: ${words} and the day before changed places.`) },
      { label: 'Move One Day Later', icon: 'arrow-right', disabled: item.past, onSelect: () => void act(() => stHomeMoveDay(item.planId, item.date, stPlanAddDays(item.date, 1)), `${item.subject.name}: ${words} and the day after changed places.`) },
      { label: 'Push to the Next Free Day', icon: 'chevrons-right', disabled: item.past || !(item.planned > 0) || !stHomeCanPush(item.planId, item.date), tooltip: 'This day is taken off and its work, and the work of the days after it, moves on a day, up to the next day with no hours.', onSelect: () => void act(() => stHomePushDay(item.planId, item.date), `${item.subject.name}: ${words} is a rest day and its work moved on.`) },
      { label: 'Take the Day Off', icon: 'moon', disabled: item.past || !(item.planned > 0), onSelect: () => void act(() => stHomeDayOff(item.planId, item.date), `${item.subject.name}: ${words} is a rest day.`) },
      { label: 'Set Hours…', icon: 'clock', disabled: item.past, onSelect: async () => {
        const typed = await _api.window.showInputBox({ title: `${item.subject.name}, ${words}`, prompt: `Hours in the ${_stPlans.get(item.planId)?.rules?.following || 'Standard'} plan`, value: String(item.planned || 0) });
        if (typed === undefined) return;
        const n = Number(String(typed).replace(',', '.'));
        if (!Number.isFinite(n) || n < 0 || n > 24) { tell('Hours are a number from 0 to 24.'); return; }
        await act(() => stHomeSetHours(item.planId, item.date, n), `${item.subject.name}: ${words} is ${stHomeHours(n)}.`);
      } },
      { separator: true },
      { label: 'Open Plan', icon: 'calendar', onSelect: () => void stOpenPlan(item.planId) },
    ];
    ui.showContextMenu(anchor, items, { anchorPosition: 'below' });
  };

  /** One subject's work on one day: a button (its menu), and something to drag to another day. */
  const chip = (cell, item, { detail }) => {
    const off = !(item.planned > 0);
    const hours = off ? (item.type && item.type !== 'Study' ? item.type : 'Rest') : stHomeHours(item.planned);
    const name = [item.subject.name, stPlanDateWords(item.date), off ? hours : `${hours} planned`, item.phase || '', item.done > 0 ? `${stHomeHours(item.done)} done` : '', item.edited ? 'changed by you' : ''].filter(Boolean).join(', ');
    const btn = ui.createButton(cell, { id: `study.home.day.${item.planId}.${item.date}`, label: item.subject.name, icon: 'circle', kind: 'ghost', size: 'sm', title: name, command: 'study.home.day', args: [item.planId, item.date] });
    btn.classList.add('st-home__chip', `st-home__chip--h${item.subject.hue}`);
    if (off) btn.classList.add('st-home__chip--off');
    if (item.past) btn.classList.add('st-home__chip--past');
    btn.setAttribute('aria-label', name);
    btn.setAttribute('aria-haspopup', 'menu');
    ui.createBlock(btn, 'span', { className: 'st-home__chiphours', text: item.done > 0 ? `${stHomeHours(item.done)} of ${stPlanH(item.planned)}` : hours });
    chips.set(`${item.planId}.${item.date}`, { btn, item });
    if (detail && item.phase && !off) ui.createBlock(cell, 'div', { className: 'st-home__chipphase', text: item.phase });
    if (!item.past) {
      parts.push(ui.onDragPress(btn, (down) => {
        if (down.button) return;
        const x0 = down.clientX; const y0 = down.clientY;
        let over = null; let moving = false;
        const cellAt = (x, y) => { const n = document.elementFromPoint(x, y); const c = n && n.closest ? n.closest('.st-home__cell') : null; return c && page.contains(c) && c.dataset.date && c.dataset.date >= stPlanToday() ? c : null; };
        const move = (e) => {
          if (!moving && Math.hypot(e.clientX - x0, e.clientY - y0) < 6) return;
          moving = true; btn.classList.add('st-home__chip--drag');
          const c = cellAt(e.clientX, e.clientY);
          if (c !== over) { if (over) over.classList.remove('st-home__cell--drop'); over = c; if (over) over.classList.add('st-home__cell--drop'); }
        };
        const up = () => {
          document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
          btn.classList.remove('st-home__chip--drag');
          if (over) over.classList.remove('st-home__cell--drop');
          if (!moving) return;
          dragged = true; setTimeout(() => { dragged = false; }, 0);  // the press that ended a drag opens no menu
          const to = over ? over.dataset.date : '';
          if (to && to !== item.date) void act(() => stHomeMoveDay(item.planId, item.date, to), `${item.subject.name}: ${stPlanDateWords(item.date)} and ${stPlanDateWords(to)} changed places.`);
        };
        document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
      }, { hold: true }));
    }
    return btn;
  };

  function paint() {
    if (ctx.disposed()) return;
    const today = stPlanToday();
    const m = stHomeModel(today);
    if (!view.anchor) view.anchor = today;
    const key = JSON.stringify([today, view, m.subjects, [...m.byDate]]);
    if (key === drawn) return;
    drawn = key;
    const active = document.activeElement;
    const focusedId = inner.contains(active) ? (active.closest('[data-px-id]') || active).getAttribute('data-px-id') : '';
    const scroll = page.scrollTop;
    for (const p of parts) { try { p.dispose(); } catch { /* noop */ } }
    parts = [];
    chips.clear();
    inner.replaceChildren();
    let order = 0;
    const settle = (node) => { if (first) { node.classList.add('px-settle'); node.style.setProperty('--px-i', String(order++)); } return node; };

    if (!m.subjects.length) {
      ui.createPageHeader(inner, { front: true, title: 'Study' });
      ui.createEmptyState(inner, { icon: 'px-study', headline: 'No subject yet.', hint: 'A subject holds what you study for one exam: its units, its questions, its plan and the record of your work.', action: { id: 'study.home.newSubject', label: 'New Subject…', command: 'study.newSubject' } });
      first = false;
      return;
    }

    // ── The head: the day, the hours it asks for, and the exam nearest.
    const planned = m.subjects.reduce((t, s) => t + (s.plan && s.plan.today ? s.plan.today.planned : 0), 0);
    const doneToday = m.subjects.reduce((t, s) => t + (s.plan && s.plan.today ? s.plan.today.done : 0), 0);
    const head = settle(ui.createBlock(inner, 'header', { className: 'st-home__head' }));
    const hours = planned > 0 ? stHomeHours(planned).replace(' h', planned === 1 ? ' hour' : ' hours') : 'a free day';
    ui.createPageHeader(head, { front: true, title: `Today, ${hours}`, subtitle: [stPlanDateWords(today, { year: true, long: true }), planned > 0 ? (doneToday > 0 ? `${stHomeHours(doneToday)} done so far` : 'nothing done yet') : ''].filter(Boolean).join(' · ') });
    const exams = m.subjects.filter((s) => s.plan && s.plan.daysLeft >= 0).sort((a, b) => a.plan.daysLeft - b.plan.daysLeft);
    if (exams.length) {
      const next = exams[0];
      const count = ui.createBlock(head, 'div', { className: 'st-home__count', attrs: { role: 'group', 'aria-label': `${next.plan.daysLeft} ${next.plan.daysLeft === 1 ? 'day' : 'days'} to the ${next.name} exam` } });
      ui.createBlock(count, 'span', { className: 'st-home__countn', text: String(next.plan.daysLeft) });
      ui.createBlock(count, 'span', { className: 'st-home__countw', text: `${next.plan.daysLeft === 1 ? 'day' : 'days'} to ${next.name}` });
    }

    // ── Today: a card per subject, each line opening the thing to work on.
    const todaySec = settle(ui.createBlock(inner, 'section', { className: 'st-home__today', attrs: { 'aria-label': 'Today' } }));
    for (const s of m.subjects) {
      const card = ui.createBlock(todaySec, 'section', { className: `st-home__card st-home__card--h${s.hue}`, attrs: { 'aria-label': s.name } });
      const top = ui.createBlock(card, 'div', { className: 'st-home__cardtop' });
      const names = ui.createBlock(top, 'div', { className: 'st-home__cardnames' });
      ui.createBlock(names, 'div', { className: 'st-home__cardname', text: s.name, attrs: { role: 'heading', 'aria-level': '2' } });
      let line = '';
      if (s.plan && s.plan.today) {
        const t = s.plan.today;
        line = t.planned > 0 ? [`${stHomeHours(t.planned)} planned`, t.phase, t.done > 0 ? `${stHomeHours(t.done)} done` : ''].filter(Boolean).join(' · ') : `${t.type && t.type !== 'Study' ? t.type : 'Rest'} day`;
      } else if (s.plan) line = s.plan.daysLeft < 0 ? 'The exam has passed.' : 'The plan has not started yet.';
      else if (s.waiting) line = 'Working out the plan…';
      else line = 'No plan yet.';
      ui.createBlock(names, 'div', { className: 'st-home__cardline', text: line });
      if (s.plan) {
        const b = s.plan.behind;
        const where = b > 0.25 ? { text: `${stHomeHours(b)} behind`, cls: 'behind' } : b < -0.25 ? { text: `${stHomeHours(-b)} ahead`, cls: 'ahead' } : { text: 'On track', cls: 'on' };
        ui.createBlock(top, 'span', { className: `st-home__where st-home__where--${where.cls}`, text: where.text, attrs: { title: `Hours done against the ${s.plan.following} plan, up to yesterday.` } });
      }
      if (s.plan && s.plan.today && s.plan.today.planned > 0) {
        const t = s.plan.today;
        const bar = ui.createBlock(card, 'div', { className: 'st-home__bar', attrs: { role: 'img', 'aria-label': `${stHomeHours(t.done)} of ${stHomeHours(t.planned)} done today` } });
        const fill = ui.createBlock(bar, 'span', { className: first ? 'px-fill-x' : '' });
        fill.style.width = `${Math.min(100, Math.round((t.done / t.planned) * 100))}%`;
      }
      const list = ui.createBlock(card, 'div', { className: 'st-home__work', attrs: { role: 'group', 'aria-label': `Work on, ${s.name}` } });
      if (s.blocks.length) {
        ui.createBlock(list, 'div', { className: 'st-home__worklabel', text: 'Work on today, the weakest first' });
        s.blocks.forEach((b, n) => {
          const kindWord = b.kind.toLowerCase();
          const what = `${b.n} ${b.n === 1 ? kindWord.replace(/s$/, '') : kindWord} ${b.word}`;
          const mine = b.kindId === ST_PROGRESS_QUESTIONS;
          const run = mine ? { command: 'study.studySubject', args: [s.id, b.unit, b.state] }
            : b.canOpen ? { command: 'study.openProgress', args: [s.id, { provider: b.kindId, groups: b.groups, state: b.state }] }
              : { command: 'study.openUnit', args: [s.id, b.rowId] };
          const row = ui.createButton(list, { id: `study.home.block.${s.id}.${n}`, label: b.unit, icon: 'play', kind: 'ghost', title: `Start: ${b.unit}, ${what}.`, ...run });
          row.classList.add('st-home__unit', `st-home__unit--${b.state}`);
          ui.createBlock(row, 'span', { className: 'st-home__unitwords', text: what });
        });
      } else {
        if (s.units.length) ui.createBlock(list, 'div', { className: 'st-home__worklabel', text: 'Nothing is wrong or waiting. Open a unit to go on.' });
        for (const u of s.units) {
          const row = ui.createButton(list, { id: `study.home.unit.${s.id}.${u.rowId}`, label: u.name, icon: 'book-open', kind: 'ghost', title: `Open ${u.name}: ${u.words}.`, command: 'study.openUnit', args: [s.id, u.rowId] });
          row.classList.add('st-home__unit');
          ui.createBlock(row, 'span', { className: 'st-home__unitwords', text: u.words });
        }
      }
      const acts = ui.createBlock(card, 'div', { className: 'st-home__acts' });
      ui.createButton(acts, { id: `study.home.study.${s.id}`, label: 'Study', icon: 'play', kind: 'primary', title: `Start a session on ${s.name}.`, command: 'study.open', args: [{ bankIds: [s.bankId] }] });
      ui.createButton(acts, { id: `study.home.progress.${s.id}`, label: 'Progress', icon: 'bar-chart-3', kind: 'ghost', title: `What you know of ${s.name}, unit by unit.`, command: 'study.openProgress', args: [s.id] });
      if (s.plan) ui.createButton(acts, { id: `study.home.plan.${s.id}`, label: 'Plan', icon: 'calendar', kind: 'ghost', title: `The rules of ${s.plan.name}: its week, its phases, the three plans.`, command: 'study.openPlan', args: [{ planId: s.plan.id }] });
      else if (!s.waiting) ui.createButton(acts, { id: `study.home.newPlan.${s.id}`, label: 'New Plan…', icon: 'calendar-plus', kind: 'ghost', command: 'study.newPlan', args: [s.id] });
    }

    // ── The plan, every subject on one calendar.
    if (m.byDate.size) {
      const cal = settle(ui.createBlock(inner, 'section', { className: 'st-home__cal', attrs: { 'aria-label': 'The plan' } }));
      const bar = ui.createBlock(cal, 'div', { className: 'st-home__calbar' });
      const week = view.mode === 'week';
      const start = week ? stHomeMonday(view.anchor) : stHomeMonthStart(view.anchor);
      const label = week
        ? stPlanSpanWords(start, stPlanAddDays(start, 6))
        : `${ST_HOME_MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`;
      ui.createBlock(bar, 'div', { className: 'st-home__calh', text: label, attrs: { role: 'heading', 'aria-level': '2', 'aria-live': 'polite' } });
      const nav = ui.createBlock(bar, 'div', { className: 'st-home__calnav' });
      ui.createIconButton(nav, { id: 'study.home.prev', icon: 'chevron-left', title: week ? 'The Week Before' : 'The Month Before', size: 'sm', command: 'study.home.show', args: ['prev'] });
      ui.createButton(nav, { id: 'study.home.today', label: 'Today', icon: 'calendar-check', kind: 'ghost', size: 'sm', title: 'Back to this week or month.', command: 'study.home.show', args: ['today'] });
      ui.createIconButton(nav, { id: 'study.home.next', icon: 'chevron-right', title: week ? 'The Week After' : 'The Month After', size: 'sm', command: 'study.home.show', args: ['next'] });
      parts.push(ui.createSegmented(bar, { id: 'study.home.mode', ariaLabel: 'Show the plan by', value: view.mode, items: [{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }], onChange: (value) => { view.mode = value; paint(); } }));

      const first1 = week ? start : stHomeMonday(start);
      const monthEnd = week ? '' : stPlanAddDays(stHomeAddMonths(start, 1), -1);
      const weeks = week ? 1 : Math.ceil((stPlanDaysBetween(first1, monthEnd) + 1) / 7);
      const grid = ui.createBlock(cal, 'div', { className: `st-home__grid st-home__grid--${view.mode}`, attrs: { role: 'grid', 'aria-label': label } });
      const heads = ui.createBlock(grid, 'div', { className: 'st-home__row st-home__row--head', attrs: { role: 'row' } });
      for (const d of ST_HOME_DAYS) ui.createBlock(heads, 'div', { className: 'st-home__dayname', text: d, attrs: { role: 'columnheader' } });
      let col = 0;
      for (let w = 0; w < weeks; w++) {
        const row = ui.createBlock(grid, 'div', { className: 'st-home__row', attrs: { role: 'row' } });
        for (let i = 0; i < 7; i++) {
          const date = stPlanAddDays(first1, w * 7 + i);
          const items = m.byDate.get(date) || [];
          const outside = !week && (date < start || date > monthEnd);
          const total = items.reduce((t, x) => t + x.planned, 0);
          const done = items.reduce((t, x) => t + x.done, 0);
          const exam = m.subjects.filter((s) => s.plan && s.plan.exam === date);
          const cell = ui.createBlock(row, 'div', { className: `st-home__cell${date === today ? ' st-home__cell--today' : ''}${date < today ? ' st-home__cell--past' : ''}${outside ? ' st-home__cell--outside' : ''}`, attrs: { role: 'gridcell', 'data-date': date, ...(date === today ? { 'aria-current': 'date' } : {}) } });
          const top = ui.createBlock(cell, 'div', { className: 'st-home__celltop' });
          ui.createBlock(top, 'span', { className: 'st-home__date', text: date === today ? `Today ${Number(date.slice(8))}` : String(Number(date.slice(8))), attrs: { 'aria-label': stPlanDateWords(date, { long: true }) } });
          if (total > 0 || done > 0) ui.createBlock(top, 'span', { className: 'st-home__sum', text: done > 0 ? `${stPlanH(done)} / ${stPlanH(total)} h` : `${stPlanH(total)} h` });
          if (week) {
            // The week's moment: a column of the day's hours done, filling against what was planned.
            const colBox = ui.createBlock(cell, 'div', { className: `st-home__col${total > 0 ? '' : ' st-home__col--rest'}`, attrs: { 'aria-hidden': 'true' } });
            if (total > 0 && done > 0) {
              const fill = ui.createBlock(colBox, 'span', { className: first ? 'px-fill-y' : '' });
              fill.style.height = `${Math.min(100, Math.round((done / total) * 100))}%`;
              fill.style.setProperty('--px-i', String(col));
            }
          }
          for (const s of exam) ui.createBlock(cell, 'div', { className: `st-home__exam st-home__chip--h${s.hue}`, text: `${s.name} exam` });
          for (const item of items) chip(cell, item, { detail: week });
          col++;
        }
      }
      ui.createBlock(cal, 'p', { className: 'st-home__hint', text: 'Press a day\'s work to move it, take the day off, push it on or set its hours. Drag it to another day to change places. A day you change stays as you left it.' });
    }

    first = false;
    page.scrollTop = scroll;
    if (focusedId) { const again = Array.from(inner.querySelectorAll('[data-px-id]')).find((n) => n.getAttribute('data-px-id') === focusedId); if (again) again.focus(); }
  }

  const home = {
    show(what) {
      const today = stPlanToday();
      const week = view.mode === 'week';
      const start = week ? stHomeMonday(view.anchor || today) : stHomeMonthStart(view.anchor || today);
      const n = what === 'prev' ? -1 : what === 'next' ? 1 : 0;
      view.anchor = n ? (week ? stPlanAddDays(start, 7 * n) : stHomeAddMonths(start, n)) : today;
      paint();
    },
    day(planId, date) {
      if (dragged) { dragged = false; return false; }
      const c = chips.get(`${planId}.${date}`);
      if (!c || !c.btn.isConnected) return false;
      dayMenu(c.btn, c.item);
      return true;
    },
  };
  _stHome = home;
  ctx.add({ dispose() { if (_stHome === home) _stHome = null; } });
  paint();
  ctx.add(onDataChanged(() => paint()));
  ctx.add(stAtEachNewDay(() => paint()));
  ctx.add({ dispose() { for (const p of parts) { try { p.dispose(); } catch { /* noop */ } } parts = []; } });
}
