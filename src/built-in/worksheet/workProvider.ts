// workProvider.ts — Worksheets' time and problems as work any tool can read
//
// The time is the ledger's (ws_study_time: seconds with a problem or the
// quiz's own screens showing, counted by the core's clock, by local day); the
// items are the problems worked and rated that day. Offered through the
// core's work-provider point (src/services/workProviders.ts): one entry per
// day and paper. Worksheets rates Easy, Medium and Hard, not right and wrong,
// so no entry says how many were right. Time on the quiz's own screens has no
// paper and is reported with no group. The mapping is pure and tested in
// tests/unit/worksheetWorkProvider.test.ts.

import type { IWorkEntry, IWorkProvider } from '../../services/workProviders.js';
import type { IWorkClockCredit } from '../../services/workClock.js';
import { addStudySeconds, allRows, onWorksheetDataChanged } from './worksheetData.js';
import { dayKey } from './progressInsights.js';
import { paperLabel } from './problemImport.js';

/** Seconds the ledger has for one day and paper ('' for the quiz's own screens). */
export interface WorkTimeRow { readonly day: string; readonly paper: string; readonly seconds: number }
/** A rating given here (not carried in from a workbook): the problem, its paper, and when. */
export interface WorkRatedRow { readonly itemId: number; readonly paper: string; readonly at: number }

/** One entry per day and paper: the ledger's minutes, and the problems rated that day, each once. Pure. */
export function worksheetWorkEntries(time: readonly WorkTimeRow[], rated: readonly WorkRatedRow[], dayOf: (ms: number) => string = dayKey): IWorkEntry[] {
  const by = new Map<string, { day: string; paper: string; seconds: number; items: Set<number> }>();
  const at = (day: string, paper: string) => {
    const key = `${day}\u0000${paper}`;
    let e = by.get(key);
    if (!e) { e = { day, paper, seconds: 0, items: new Set() }; by.set(key, e); }
    return e;
  };
  for (const t of time) at(String(t.day), String(t.paper ?? '')).seconds += Math.max(0, Number(t.seconds) || 0);
  for (const r of rated) if (Number(r.at) > 0) at(dayOf(Number(r.at)), String(r.paper ?? '')).items.add(Number(r.itemId));
  return [...by.values()]
    .filter((e) => e.seconds > 0 || e.items.size > 0)
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.paper.localeCompare(b.paper)))
    .map((e) => ({ day: e.day, groups: e.paper ? [{ group: e.paper, label: paperLabel(e.paper) }] : [], minutes: e.seconds / 60, items: e.items.size }));
}

// ── The ledger, written by the clock ────────────────────────────────────────

const _listeners = new Set<() => void>();
const emitWork = (): void => { for (const fn of _listeners) { try { fn(); } catch { /* a reader's own */ } } };

/** What a clock's `credit` does for a problem (or item 0, a quiz's own screens): the seconds go to the ledger, and readers of work are told. */
export function creditStudyTime(itemId: number, sessionId: () => string): (credits: readonly IWorkClockCredit[], final: boolean) => void {
  return (credits, final) => {
    void (async () => {
      for (const c of credits) await addStudySeconds(c.day, itemId, sessionId(), c.seconds).catch(() => {});
      // The last seconds of a sitting also tell the tool's own screens (the dashboard's day catches up).
      if (final) await addStudySeconds(dayKey(Date.now()), itemId, sessionId(), 0, true).catch(() => {});
      if (credits.length) emitWork();
    })();
  };
}

export function worksheetWorkProvider(): IWorkProvider {
  return {
    id: 'worksheets.problems',
    displayName: 'Worksheets',
    kind: 'Problems',
    toolId: 'parallx.worksheet',
    async work() {
      const [time, rated] = await Promise.all([
        allRows("SELECT t.day AS day, COALESCE(i.paper, '') AS paper, SUM(t.seconds) AS seconds FROM ws_study_time t LEFT JOIN ws_items i ON i.id = t.item_id GROUP BY t.day, COALESCE(i.paper, '')"),
        allRows("SELECT a.item_id AS item_id, a.updated_at AS at, COALESCE(i.paper, '') AS paper FROM ws_attempts a JOIN ws_items i ON i.id = a.item_id WHERE a.completed = 1 AND a.imported = 0 AND a.self_grade != ''"),
      ]);
      return worksheetWorkEntries(
        time.map((r) => ({ day: String(r.day), paper: String(r.paper ?? ''), seconds: Number(r.seconds ?? 0) })),
        rated.map((r) => ({ itemId: Number(r.item_id), paper: String(r.paper ?? ''), at: Number(r.at ?? 0) })),
      );
    },
    onDidChange(listener) {
      _listeners.add(listener);
      const data = onWorksheetDataChanged(listener);
      return { dispose: () => { _listeners.delete(listener); data.dispose(); } };
    },
  };
}
