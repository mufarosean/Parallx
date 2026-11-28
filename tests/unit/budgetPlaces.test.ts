// budgetPlaces.test.ts — Budget's screens as places (ext/budget/places.js):
// the address each section, Plan view and filter gets, the tab's name and
// the trail, the older build's tabs, and what the page records as it moves.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  placeOf, routeOf, txParamsOf, txFilterOf, txViewFor, routeForInstanceId, monthParam,
  budgetPlacesActivate, openBudgetPlace, onBudgetSection, COMMAND_ROUTES, SECTIONS,
// @ts-expect-error — JS module with no types
} from '../../ext/budget/places.js';

type Loc = { place: string; params?: Record<string, string> };
interface Reg {
  id: string; title: string; icon: string; editorType: string;
  places: { id: string; title: string }[];
  formerTabs: { editorType: string; placeOf(instanceId: string): Loc | undefined };
  titleOf(l: Loc): string;
  trailOf(l: Loc): { label: string; location?: Loc }[];
  createView(container: HTMLElement, host: { go(l: Loc): void; replace(l: Loc): void }): { show(l: Loc): unknown; dispose(): void };
}

function fakeApi() {
  const opened: unknown[] = [];
  const providers: string[] = [];
  let reg: Reg | undefined;
  const moves = new Set<(e: { tool: string; location: Loc }) => void>();
  let current: Loc | undefined;
  const api = {
    editors: { registerEditorProvider: (type: string) => { providers.push(type); return { dispose() {} }; }, openEditors: [], closeEditor: async () => {} },
    places: {
      register: (r: Reg) => { reg = r; return { dispose() {} }; },
      open: async (target: unknown, options?: unknown) => { opened.push(options ? [target, options] : target); return true; },
      addressOf: (tool: string, l: Loc) => `parallx://place/${tool}/${l.place}${l.params ? '?' + new URLSearchParams(l.params).toString() : ''}`,
      current: () => current,
      onDidMove: (fn: (e: { tool: string; location: Loc }) => void) => { moves.add(fn); return { dispose: () => moves.delete(fn) }; },
    },
  };
  return { api, opened, providers, reg: () => reg!, move: (tool: string, location: Loc) => { current = location; for (const fn of moves) fn({ tool, location }); }, setCurrent: (l: Loc) => { current = l; } };
}

const MONTH_NOW = '2026-11';

describe('Budget places', () => {
  let f: ReturnType<typeof fakeApi>;
  let pages: { shown: unknown[]; nav: { go(s: string, v?: string | null, p?: Record<string, string>): void; replace(s: string, v?: string | null, p?: Record<string, string>): void } }[];
  let hostCalls: { go: Loc[]; replace: Loc[] };

  beforeEach(() => {
    f = fakeApi();
    pages = [];
    hostCalls = { go: [], replace: [] };
    budgetPlacesActivate(f.api, {
      createPage: (_c: HTMLElement, nav: never) => {
        const page = { shown: [] as unknown[], nav };
        pages.push(page);
        return { show: (...a: unknown[]) => { page.shown.push(a); }, dispose() {}, saveViewState: () => undefined, restoreViewState() {} };
      },
      currentMonth: () => MONTH_NOW,
    });
  });

  it('registers one tool, Budget, on its own tab type, keeping the older type for its saved tabs', () => {
    const r = f.reg();
    expect(r.id).toBe('budget');
    expect(r.title).toBe('Budget');
    expect(r.icon).toBe('px-budget');
    expect(r.editorType).toBe('budget.place');
    expect(r.formerTabs.editorType).toBe('budget.editor');
    expect(f.providers).toEqual(['budget.editor']);
    expect(r.places.map((p) => p.id)).toEqual(['overview', 'review', 'transactions', 'plan', 'worth', 'rules', 'categories', 'sync-log', 'import-export']);
  });

  it('names the tab for the place, and on Plan for its view; the trail names the view after Plan', () => {
    const r = f.reg();
    expect(r.titleOf({ place: 'worth' })).toBe('Net Worth and Goals');
    expect(r.titleOf({ place: 'sync-log' })).toBe('Sync Log');
    expect(r.titleOf({ place: 'plan' })).toBe('Limits');
    expect(r.titleOf({ place: 'plan', params: { view: 'bills' } })).toBe('Bills');
    expect(r.trailOf({ place: 'plan', params: { view: 'bills' } })).toEqual([
      { label: 'Plan', location: { place: 'plan' } },
      { label: 'Bills', location: { place: 'plan', params: { view: 'bills' } } },
    ]);
    expect(r.trailOf({ place: 'rules' })).toEqual([{ label: 'Merchants and Rules', location: { place: 'rules' } }]);
  });

  it('puts a Plan view in the address, Limits (the default) left out', () => {
    expect(placeOf('plan', 'bills')).toEqual({ place: 'plan', params: { view: 'bills' } });
    expect(placeOf('plan', 'budgets')).toEqual({ place: 'plan' });
    expect(placeOf('plan', 'nonsense')).toEqual({ place: 'plan' });
    expect(placeOf('plan', null, { view: 'reconcile', account: 'a1' })).toEqual({ place: 'plan', params: { view: 'reconcile', account: 'a1' } });
    expect(placeOf('syncLog')).toEqual({ place: 'sync-log' });
    expect(routeOf({ place: 'plan', params: { view: 'trends' } })).toEqual({ section: 'plan', view: 'trends', params: { view: 'trends' } });
    expect(routeOf({ place: 'import-export' }).section).toBe('importExport');
  });

  it('every command lands on a section the places know', () => {
    for (const [section] of Object.values(COMMAND_ROUTES as Record<string, string[]>)) expect((SECTIONS as { id: string }[]).some((s) => s.id === section)).toBe(true);
  });

  it('carries Transactions\' filters in the address and back, the month we are in left out', () => {
    const p = txParamsOf({ categoryId: 'c9', monthKey: '2026-10', type: 'spend' });
    expect(p).toEqual({ view: 'spend', month: '2026-10', category: 'c9' });
    expect(txParamsOf({ monthKey: MONTH_NOW, type: 'all' })).toEqual({});
    expect(txParamsOf({ monthKey: MONTH_NOW, type: 'transfer', aiTyped: true })).toEqual({ view: 'transfer', ai: '1' });
    expect(txParamsOf({ view: 'spend', only: 'fee', merchant: '  Blue  ', dayYmd: '2026-11-03', accountId: 'a2' }))
      .toEqual({ view: 'spend', only: 'fee', q: 'Blue', day: '2026-11-03', account: 'a2' });
    const back = txFilterOf({ view: 'spend', only: 'fee', month: '2026-10', category: 'c9', q: 'Blue', ai: '1' });
    expect(txViewFor(back)).toBe('spend');
    expect(back).toMatchObject({ type: 'fee', monthKey: '2026-10', categoryId: 'c9', merchant: 'Blue', aiTyped: true });
    expect(txViewFor(txFilterOf({ view: 'review' }))).toBe('review');
    expect(txViewFor(txFilterOf({}))).toBe('all');
    expect(txFilterOf({ month: 'October', day: 'x' })).toEqual({ type: 'all' });
    expect(monthParam(MONTH_NOW)).toBeUndefined();
    expect(monthParam('2026-09')).toBe('2026-09');
  });

  it('brings every older tab back as its place: the one-tab build (budget:main) as Overview, the section tabs as theirs', () => {
    const { placeOf: former } = f.reg().formerTabs;
    expect(former('budget:main')).toEqual({ place: 'overview' });
    expect(former('budget:dashboard')).toEqual({ place: 'overview' });
    expect(former('budget:recurring')).toEqual({ place: 'plan', params: { view: 'bills' } });
    expect(former('budget:budgets')).toEqual({ place: 'plan' });
    expect(former('budget:goals')).toEqual({ place: 'worth' });
    expect(former('budget:reviewQueue')).toEqual({ place: 'review' });
    expect(former('budget:transactions')).toEqual({ place: 'transactions' });
    expect(routeForInstanceId('budget:syncLog')).toEqual(['syncLog']);
  });

  it('opens a section through the places point, in the one tab or a tab of its own', async () => {
    await openBudgetPlace('plan', 'bills');
    await openBudgetPlace('transactions', null, { view: 'spend' }, { newTab: true });
    expect(f.opened).toEqual([
      { tool: 'budget', place: 'plan', params: { view: 'bills' } },
      [{ tool: 'budget', place: 'transactions', params: { view: 'spend' } }, { newTab: true }],
    ]);
  });

  it('the view draws the section a place is, and sends the page\'s moves and changes to the core', () => {
    const host = { go: (l: Loc) => hostCalls.go.push(l), replace: (l: Loc) => hostCalls.replace.push(l) };
    const view = f.reg().createView({} as HTMLElement, host);
    view.show({ place: 'plan', params: { view: 'reconcile', account: 'a1' } });
    expect(pages[0].shown).toEqual([['plan', 'reconcile', { view: 'reconcile', account: 'a1' }]]);
    pages[0].nav.go('syncLog');
    pages[0].nav.replace('plan', 'bills', {});
    pages[0].nav.replace('transactions', undefined, { view: 'spend', month: '2026-10' });
    expect(hostCalls.go).toEqual([{ place: 'sync-log' }]);
    expect(hostCalls.replace).toEqual([{ place: 'plan', params: { view: 'bills' } }, { place: 'transactions', params: { view: 'spend', month: '2026-10' } }]);
  });

  it('tells the column where the tab is, then each move of Budget alone', () => {
    const heard: (string | null)[] = [];
    f.setCurrent({ place: 'plan', params: { view: 'bills' } });
    const off = onBudgetSection((s: string | null) => heard.push(s));
    f.move('budget', { place: 'sync-log' });
    f.move('planner', { place: 'today' });
    f.move('budget', { place: 'worth' });
    off.dispose();
    f.move('budget', { place: 'rules' });
    expect(heard).toEqual(['plan', 'syncLog', 'worth']);
  });
});
