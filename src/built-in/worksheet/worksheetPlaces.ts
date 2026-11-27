// Worksheets' places (services/places.ts): its screens share ONE tab, named
// for the screen; the core keeps the tab, the trail under the tabs, the
// address (parallx://place/worksheet/bank?filters=noted), Back and Forward,
// and where the keys land. A thing (a quiz being taken, a problem's sheet, a
// .sheet file, the Scratch Sheet) keeps a tab of its own (actions.ts).

import type { PlaceDefinition, PlaceLocation, PlaceView, PlaceViewHost, PlacesContribution } from '../../services/places.js';
import { recordXpCashout } from './worksheetData.js';
import { createDashboardPane } from './panes/dashboardPane.js';
import { createPlanPane } from './panes/planPane.js';
import { createBankPane } from './panes/bankPane.js';
import { createExcelImportPane } from './panes/excelImportPane.js';
import { createGeneratePane } from './panes/generatePane.js';
import { createLauncherPane } from './panes/launcherPane.js';
import { createPracticeConfigPane } from './panes/practiceConfigPane.js';
import { createQuizzesPane } from './panes/quizzesPane.js';
import { createSettingsPane } from './panes/settingsPane.js';
import { openBuilderWith, openPastQuiz, openQuizTab, openWorksheet, planActions, startQuizWith, studyFlashcards } from './actions.js';
import { getExamDate, getXpCashRate, state } from './state.js';
import { WS_PLACES_ID, isWorksheetPlace } from './worksheetConstants.js';

export { WS_PLACES_ID, isWorksheetPlace };

/** Worksheets' places; the first is where the tool opens. The ids are the instance ids its screen tabs had, so an older tab maps to its place. */
export const WORKSHEET_PLACES: readonly PlaceDefinition[] = [
  // Keep in step with isWorksheetPlace (worksheetConstants.ts).
  { id: 'home', title: 'Home' },
  { id: 'bank', title: 'Problem Bank' },
  { id: 'dashboard', title: 'Study Dashboard' },
  { id: 'plan', title: 'Campaign' },
  { id: 'quizzes', title: 'Quizzes' },
  { id: 'practice', title: 'New Quiz' },
  { id: 'excel-import', title: 'Import Workbook' },
  { id: 'create', title: 'Generate Items' },
  { id: 'settings', title: 'Worksheets Settings' },
];

/** What a place's pane is given: where it is, and how to say it moved by itself (a filter pressed). */
export interface WorksheetPlaceHost {
  readonly params: Readonly<Record<string, string>>;
  replace(params: Readonly<Record<string, string>>): void;
}

type Pane = { dispose(): void };

function dashboardPane(container: HTMLElement): Pane {
  return createDashboardPane(container, {
    openItem: (id, title) => void openWorksheet(`item:${id}`, title),
    startQuiz: (ids, startAt, name) => startQuizWith(ids, startAt, name),
    resumeQuiz: () => openQuizTab(),
    openQuiz: (id) => void openPastQuiz(id),
    renderIcon: (id, size) => { try { return state.api?.icons?.createIconHtml?.(id, size) ?? ''; } catch { return ''; } },
    configureQuiz: (preset) => openBuilderWith(preset),
    importWorkbook: () => void openWorksheet('excel-import', 'Import Workbook'),
    openSettings: () => void openWorksheet('settings', 'Worksheets Settings'),
    examDate: () => getExamDate(),
    xpCashRate: () => getXpCashRate(),
    cashOut: async (xp, cents) => {
      const dollars = (cents / 100).toFixed(2);
      const ok = await state.api?.window?.showConfirmModal?.({
        message: `Cash out ${xp} XP for $${dollars}?`,
        detail: 'Pay yourself, then this records it. The XP stays on your level; only what is left to cash out goes down.',
        confirmLabel: 'Cash Out',
      }) ?? true;
      if (!ok) return;
      await recordXpCashout(xp, cents);
      state.api?.activity?.note('cashed out', `${xp} XP for $${dollars}`);
    },
    get studyFlashcards() { return studyFlashcards(); },
  });
}

/** Draw one of Worksheets' places into `container`. Used by the one tab, and by an older screen tab that was not brought into it. */
export function createPlacePane(container: HTMLElement, place: string, host?: WorksheetPlaceHost): Pane {
  switch (place) {
    case 'bank': return createBankPane(container, host);
    case 'dashboard': return dashboardPane(container);
    case 'plan': return createPlanPane(container, planActions());
    case 'quizzes': return createQuizzesPane(container);
    case 'practice': return createPracticeConfigPane(container);
    case 'excel-import': return createExcelImportPane(container);
    case 'create': return createGeneratePane(container);
    case 'settings': return createSettingsPane(container);
    default: return createLauncherPane(container);
  }
}

/** Resolves once the page's kit title is drawn (a pane drawn after its data loads), or after a while regardless. */
function titleDrawn(container: HTMLElement, isStillWanted: () => boolean): Promise<void> {
  const has = () => !!container.querySelector('.px-page-header__title');
  if (has()) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { observer.disconnect(); clearTimeout(timer); resolve(); };
    const observer = new MutationObserver(() => { if (has() || !isStillWanted()) done(); });
    observer.observe(container, { childList: true, subtree: true });
    const timer = setTimeout(done, 4_000);
  });
}

class WorksheetPlaceView implements PlaceView {
  private _pane: Pane | undefined;
  private _shown: string | undefined;
  private _seq = 0;

  constructor(private readonly _container: HTMLElement, private readonly _host: PlaceViewHost) {}

  async show(location: PlaceLocation): Promise<void> {
    const seq = ++this._seq;
    const params = location.params ?? {};
    const key = `${location.place}?${JSON.stringify(params)}`;
    if (key !== this._shown || !this._pane) {
      this._pane?.dispose();
      this._container.replaceChildren();
      this._shown = key;
      const host: WorksheetPlaceHost = {
        params,
        replace: (next) => {
          const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== ''));
          this._shown = `${location.place}?${JSON.stringify(clean)}`;
          this._host.replace({ place: location.place, ...(Object.keys(clean).length ? { params: clean } : {}) });
        },
      };
      this._pane = createPlacePane(this._container, location.place, host);
    }
    await titleDrawn(this._container, () => seq === this._seq);
  }

  dispose(): void {
    this._seq++;
    this._pane?.dispose();
    this._pane = undefined;
  }
}

/** Worksheets' registration with the core's places. */
export function worksheetPlacesContribution(): PlacesContribution {
  return {
    id: WS_PLACES_ID,
    title: 'Worksheets',
    icon: 'calculator',
    editorType: 'worksheet.place',
    places: WORKSHEET_PLACES,
    // The older build opened a tab per screen, as a 'worksheet' editor named by its screen.
    formerTabs: { editorType: 'worksheet', placeOf: (instanceId) => (isWorksheetPlace(instanceId) ? { place: instanceId } : undefined) },
    createView: (container, host) => new WorksheetPlaceView(container, host),
  };
}
