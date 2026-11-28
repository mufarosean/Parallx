// @vitest-environment jsdom
// studyPlaces.test.ts — Study's places (ext/study/src/68-places.js) over the
// generated main.js: every screen an older build opened as a tab of its own
// ('home', 'progress-3', 'unit-3-r7', 'plan-2') maps to a place and back to
// the route that draws it; a session, a Learn page and the sheets stay things;
// the tab and the trail are named from the subject, the unit and the plan
// (`Study › Exam 7 › Mack`); a place goes to the places point, a thing to its
// own tab, and with no places point (an older host) a place opens a tab as before.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createUiApi } from '../../src/api/bridges/uiBridge.js';

type Any = Record<string, any>;
type Loc = { place: string; params?: Record<string, string> };

const NAMES = ['__testables', '_stSubjects', '_stPlans', 'stPlaceOfInstance', 'stPlaceOfRoute', 'stRouteOfPlace', 'stRouteInstanceId', 'stRouteFromInstanceId', 'registerPlaces', 'stOpenPane', 'stPlacesOn', 'stViewRenderer', 'renderSubject', '_emitDataChanged', 'stNoteSheetOpener', 'stRefocusSubjectOpener'];

function loadStudy(): Any {
  const src = readFileSync(join(__dirname, '../../ext/study/main.js'), 'utf8').replace(/^export\s+(?=(?:async\s+)?function|const|let)/gm, '');
  return new Function(`'use strict';\n${src}\nreturn { ${NAMES.map((x) => `${x}: typeof ${x} === 'undefined' ? undefined : ${x}`).join(', ')} };`)() as Any;
}

function withApi(S: Any, places: boolean) {
  const calls: Any = { open: [] as Any[], openEditor: [] as Any[] };
  let contribution: Any;
  const api: Any = {
    editors: { openEditors: [], openEditor: async (o: Any) => { calls.openEditor.push(o); }, focusEditor: async () => true },
    ui: {},
  };
  if (places) {
    api.places = {
      register: (c: Any) => { contribution = c; return { dispose() { /* gone */ } }; },
      open: async (target: Any, options?: Any) => { calls.open.push([target, options]); return true; },
      addressOf: (tool: string, l: Loc) => `parallx://place/${tool}/${l.place}${l.params ? `?${new URLSearchParams(l.params)}` : ''}`,
      current: () => undefined,
      onDidMove: () => ({ dispose() { /* gone */ } }),
    };
  }
  S.__testables.__setApi(api);
  const subs: Any[] = [];
  S.registerPlaces({ subscriptions: { push: (...d: Any[]) => subs.push(...d) } });
  return { calls, contribution: () => contribution, subs };
}

function seed(S: Any) {
  S._stSubjects.set(3, { subject: { id: 3, name: 'Exam 7' }, synced: true, unitRows: [{ pageId: 'r7', title: 'Mack', values: {} }, { pageId: 'r8', title: 'Clark', values: {} }], counts: { total: 0, answered: 0, units: [] } });
  S._stPlans.set(2, { plan: { id: 2, name: 'Sitting in May', subjectId: 3 } });
}

describe("Study's places", () => {
  it('each screen an older build gave a tab of its own is a place, drawn by the route that drew that tab', () => {
    const S = loadStudy();
    const cases: [string, Loc][] = [
      ['home', { place: 'home' }],
      ['progress-3', { place: 'progress', params: { subject: '3' } }],
      ['unit-3-r7', { place: 'unit', params: { subject: '3', unit: 'r7' } }],
      ['plan-2', { place: 'plan', params: { plan: '2' } }],
    ];
    for (const [id, at] of cases) {
      expect(S.stPlaceOfInstance(id), id).toEqual(at);
      expect(S.stRouteInstanceId(S.stRouteOfPlace(at)), id).toBe(id);
    }
  });

  it('things keep tabs of their own: a session, a Learn page, the sheets', () => {
    const S = loadStudy();
    for (const id of ['session-5', 'learn-1-0', 'setup', 'new-subject', 'new-plan-3', '']) expect(S.stPlaceOfInstance(id), id).toBeUndefined();
    for (const view of ['session', 'results', 'review', 'generating', 'learn', 'setup', 'newSubject', 'newPlan']) expect(S.stPlaceOfRoute({ view, sessionId: 1 }), view).toBeNull();
    const { contribution } = withApi(S, true);
    expect(contribution().editorType).toBe('study-place');
    expect(contribution().formerTabs.editorType).toBe('study');
    expect(contribution().formerTabs.placeOf('session-5')).toBeUndefined();
    expect(contribution().formerTabs.placeOf('unit-3-r7')).toEqual({ place: 'unit', params: { subject: '3', unit: 'r7' } });
  });

  it('an address it cannot read goes Home, never to a place with no id', () => {
    const S = loadStudy();
    expect(S.stRouteOfPlace({ place: 'unit', params: { subject: 'x', unit: 'r7' } })).toEqual({ view: 'home' });
    expect(S.stRouteOfPlace({ place: 'plan' })).toEqual({ view: 'home' });
    expect(S.stRouteOfPlace({ place: 'nowhere' })).toEqual({ view: 'home' });
  });

  it('the tab is named for the place and the trail names the subject and the unit', () => {
    const S = loadStudy();
    seed(S);
    const { contribution } = withApi(S, true);
    const c = contribution();
    const unit = { place: 'unit', params: { subject: '3', unit: 'r7' } };
    expect(c.titleOf(unit)).toBe('Mack');
    expect(c.trailOf(unit).map((s: Any) => s.label)).toEqual(['Exam 7', 'Mack']);
    expect(c.trailOf(unit)[0].location).toEqual({ place: 'subject', params: { subject: '3' } });
    expect(c.trailOf({ place: 'progress', params: { subject: '3' } }).map((s: Any) => s.label)).toEqual(['Exam 7', 'Progress']);
    expect(c.titleOf({ place: 'plan', params: { plan: '2' } })).toBe('Sitting in May');
    expect(c.trailOf({ place: 'plan', params: { plan: '2' } }).map((s: Any) => s.label)).toEqual(['Exam 7', 'Sitting in May']);
    expect(c.titleOf({ place: 'weak' })).toBe('Weak Spots');
    expect(c.trailOf({ place: 'marked' }).map((s: Any) => s.label)).toEqual(['Marked']);
    // Not read yet (a tab back with the app before Study read its subjects): a plain name, renamed once read.
    expect(c.titleOf({ place: 'unit', params: { subject: '9', unit: 'r1' } })).toBe('Unit');
  });

  it('a place goes to the places point, a thing to its own tab', async () => {
    const S = loadStudy();
    const { calls } = withApi(S, true);
    await S.stOpenPane({ view: 'unit', subjectId: 3, rowId: 'r7' });
    expect(calls.open.at(-1)[0]).toEqual({ tool: 'study', place: 'unit', params: { subject: '3', unit: 'r7' } });
    expect(calls.openEditor).toHaveLength(0);
    await S.stOpenPane({ view: 'session', sessionId: 5 });
    expect(calls.openEditor.at(-1)).toMatchObject({ typeId: 'study', instanceId: 'session-5' });
    expect(calls.open).toHaveLength(1);
  });

  it('on a host with no places point a place opens a tab of its own, as before', async () => {
    const S = loadStudy();
    const { calls } = withApi(S, false);
    expect(S.stPlacesOn()).toBe(false);
    await S.stOpenPane({ view: 'progress', subjectId: 3 });
    expect(calls.openEditor.at(-1)).toMatchObject({ typeId: 'study', instanceId: 'progress-3' });
  });

  it('turned off, the places are off with it', () => {
    const S = loadStudy();
    const { subs } = withApi(S, true);
    expect(S.stPlacesOn()).toBe(true);
    for (const d of subs) d.dispose();
    expect(S.stPlacesOn()).toBe(false);
  });

  it('every view a route names has its drawing', () => {
    const S = loadStudy();
    for (const view of ['home', 'subject', 'progress', 'plan', 'unit', 'weak', 'marked', 'setup', 'newSubject', 'newPlan', 'generating', 'session', 'results', 'review', 'learn']) {
      expect(typeof S.stViewRenderer(view), view).toBe('function');
    }
    expect(S.stViewRenderer('constructor')).toBeNull();
  });

  it("a subject's page drawn before Study read the subject gets its count and its menu once it is read", async () => {
    const S = loadStudy();
    const { subs } = withApi(S, false);
    S.__testables.__setApi({ editors: { openEditors: [] }, ui: createUiApi() });
    S._stSubjects.set(3, { subject: { id: 3, name: 'Exam 7' }, synced: false, unitRows: [], counts: { total: 0, answered: 0, units: [] } });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const disposables: Any[] = [];
    await S.renderSubject(host, { view: 'subject', subjectId: 3 }, { add: (d: Any) => disposables.push(d), disposed: () => false, rerender: () => {} });
    expect(host.querySelector('.px-page-header__title')?.textContent).toBe('Exam 7');
    expect(host.querySelector('.px-page-header__subtitle')).toBeNull();
    const title = host.querySelector<HTMLElement>('.px-page-header__title')!;
    title.tabIndex = -1;
    title.focus();
    S._stSubjects.set(3, { subject: { id: 3, name: 'Exam 7' }, synced: true, unitRows: [{ pageId: 'r7', title: 'Mack', values: {} }], counts: { total: 10, answered: 4, units: [{ name: 'Mack', total: 10, answered: 4 }] } });
    S._emitDataChanged();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.querySelector('.px-page-header__subtitle')?.textContent).toBe('4 of 10 questions answered');
    // The keys stay on the title the header was drawn with again.
    expect(document.activeElement?.classList.contains('px-page-header__title')).toBe(true);
    for (const d of [...disposables, ...subs]) { try { typeof d === 'function' ? d() : d.dispose(); } catch { /* gone */ } }
    host.remove();
  });

  it('a sheet closed with nothing started brings back the tab it was opened from, not the tab beside it', async () => {
    const S = loadStudy();
    const focused: string[] = [];
    const openEditors = [{ id: 'parallx-community.study:study-place:main', isActive: true }, { id: 'core:database:worklog', isActive: false }];
    S.__testables.__setApi({ editors: { get openEditors() { return openEditors; }, focusEditor: async (id: string) => { focused.push(id); } } });
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    S.stNoteSheetOpener();
    // The sheet's tab closed and the editor brought forward the tab beside it: his is behind, its button hidden.
    openEditors[0].isActive = false; openEditors[1].isActive = true;
    opener.blur();
    S.stRefocusSubjectOpener();
    await new Promise((r) => setTimeout(r, 150));
    expect(focused).toEqual(['parallx-community.study:study-place:main']);
    opener.remove();
  });
});
