// Worksheets — exam-faithful practice sheets.
//
// A generic substrate surface: bounded spreadsheet items with givens and
// solutions, for practicing under a target tool's constraints (first user:
// CAS Exam 7 / Pearson Athena — docs/research/CAS_Pearson_Spreadsheet_Environment.md).
//
// The Univer engine ships as a SEPARATE lazily-imported bundle
// (dist/renderer/worksheet-univer.js, built from ./univerHost.ts) so the main
// bundle never pays for it. Only univerHost.ts imports it; state.ts loads it.
//
// This file is the activation: it registers the panes, views, commands and
// blocks. The panes are in panes/ (one file each, plus dashboardPane and
// planPane); state.ts holds what they share, widgets.ts the controls they
// build, actions.ts the moves between tabs, chatReview.ts the chat hand-off.
//
// Pane lifecycle contract (see editor-pane-lifecycle memory): panes are
// DESTROYED and rebuilt on every same-group tab switch. Scratch-sheet state
// survives via an in-memory snapshot cache; item attempts persist to SQLite
// (autosave + capture on dispose), so nothing is lost either way.
//
// Athena fidelity notes: the real exam does NOT lock given cells — the heavy
// border fences them visually and Reset Sheet is the recovery path. We match
// that: no cell locking, a confirmed Reset, one sheet, no tabs.

import { listItems, getItem, onWorksheetDataChanged, attachWorksheetDatabase, listQuestionRows } from './worksheetData.js';
import { OPEN_QUIZ_COMMAND, START_ROSTER_COMMAND, startTodaysRoster } from './panes/rosterPane.js';
import { ADD_TAG_COMMAND, REMOVE_TAG_COMMAND } from './panes/tagEditor.js';
import { QUIZ_PAPER_COMMAND, REVIEW_PAPER_COMMAND, quizPaper, reviewPaper } from './panes/bankPane.js';
import { addItemTag, removeItemTag } from './tagData.js';
import { IDatabaseService } from '../../services/serviceTypes.js';
import { registerWorksheetChatTools } from './worksheetChat.js';
import { practiceBlock } from './worksheetPracticeBlock.js';
import { worksheetQuestionProvider } from './questionProvider.js';
import { registerQuestionProvider } from '../../services/questionProviders.js';
import { worksheetProgressProvider } from './progressProvider.js';
import { registerProgressProvider } from '../../services/progressProviders.js';
import { registerWorkProvider } from '../../services/workProviders.js';
import { registerWorksheetHomeCard } from './homeCard.js';
import { worksheetWorkProvider } from './workProvider.js';
import { SHEET_FILE_EXTENSION, sheetFilePathOf } from './sheetFile.js';
import { bringSheetForward, createSheetFilePane, exportOpenSheetFile, settleSheetFiles } from './panes/sheetFilePane.js';
import { ASK_COMMAND, FORMAT_COMMAND, MENU_COMMAND, askAboutSelection, formatCells, showSheetMenu } from './panes/sheetToolbar.js';
import { newSheet, sheetFileIconHtml, importPlanFromPath, openBuilderWith, openPastQuiz, openWorksheet, pickAndImportPlan, refreshFlashcardsOn } from './actions.js';
import { createPlacePane, isWorksheetPlace, worksheetPlacesContribution } from './worksheetPlaces.js';
import { readPendingRecipes } from './panes/bankPane.js';
import { createPracticeRunPane } from './panes/practiceRunPane.js';
import { createReviewPane } from './panes/reviewPane.js';
import { createSheetPane } from './panes/sheetPane.js';
import { createSidebarView } from './panes/sidebarView.js';
import { carryIdleMinutes, scratchCache, state, type ParallxApiLike, type ToolContextLike } from './state.js';
import './worksheet.css';

// ── Activation ──────────────────────────────────────────────────────────────

async function runMigrations(): Promise<void> {
  const electron = (window as {
    parallxElectron?: {
      database?: { isOpen(): Promise<{ isOpen: boolean }>; migrate(dir: string): Promise<{ error: { message: string } | null }> };
      appPath?: string; platform?: string;
    };
  }).parallxElectron;
  if (!electron?.database || !electron.appPath) {
    console.warn('[Worksheet] Cannot run migrations — database or appPath not available');
    return;
  }
  const status = await electron.database.isOpen();
  if (!status.isOpen) {
    console.warn('[Worksheet] Database not open — skipping migrations');
    return;
  }
  const sep = electron.platform === 'win32' ? '\\' : '/';
  const migrationsDir = [electron.appPath, 'src', 'built-in', 'worksheet', 'migrations'].join(sep);
  const result = await electron.database.migrate(migrationsDir);
  if (result.error) console.error('[Worksheet] Migration failed:', result.error.message);
}

export async function activate(api: ParallxApiLike, context: ToolContextLike): Promise<void> {
  state.api = api;
  // Route SQL through the IDatabaseService tool bridge so worksheet writes
  // land on the unified data stream (STANDARDIZATION.md P2).
  if (api.services?.has(IDatabaseService)) {
    attachWorksheetDatabase(
      api.services.get<import('../../services/serviceTypes.js').IDatabaseService>(IDatabaseService).asBridge(),
    );
  }
  await runMigrations();
  void readPendingRecipes();
  await refreshFlashcardsOn();
  if (api.tools?.onDidChange) context.subscriptions.push(api.tools.onDidChange(() => void refreshFlashcardsOn()));

  context.subscriptions.push(
    api.editors.registerEditorProvider('worksheet', {
      createEditorPane: (container: HTMLElement, input?: { id?: string; instanceId?: string }) => {
        // Provenance contract: key on instanceId, never parse
        // the namespaced input.id.
        const instanceId = input?.instanceId ?? input?.id ?? 'home';
        // A screen is a place, drawn in Worksheets' one tab (worksheetPlaces.ts); an older
        // build's screen tab comes back there. One that still reaches here is drawn as it was.
        if (isWorksheetPlace(instanceId)) return createPlacePane(container, instanceId);
        if (instanceId === 'practice-run') return createPracticeRunPane(container, input as { setName?(name: string): void } | undefined);
        if (instanceId === 'review') return createReviewPane(container);
        const sheetFile = sheetFilePathOf(instanceId);
        if (sheetFile) return createSheetFilePane(container, sheetFile);
        return createSheetPane(container, instanceId);
      },
    }),
  );

  // Home, Problem Bank, Study Dashboard, Campaign, Quizzes, New Quiz and the rest are places: one tab,
  // named for the place, the trail under the tabs, an address each (parallx://place/worksheet/bank?filters=noted).
  if (api.places) context.subscriptions.push(api.places.register(worksheetPlacesContribution()));

  // A `.sheet` file in the workspace opens as a sheet of one's own, while this tool runs.
  if (api.editors.registerFileEditor) {
    context.subscriptions.push(api.editors.registerFileEditor('worksheet', { extensions: [SHEET_FILE_EXTENSION], iconHtml: sheetFileIconHtml() }));
  }
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.newSheet', (name?: unknown, folder?: unknown) => newSheet(name, folder)),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.exportSheet', () => exportOpenSheetFile()),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.bringSheetForward', (paneId?: unknown) => bringSheetForward(paneId)),
  );
  // The sheet's toolbar (panes/sheetToolbar.ts): each of its controls runs one of these three.
  context.subscriptions.push(api.commands.registerCommand(FORMAT_COMMAND, (action?: unknown) => formatCells(action)));
  context.subscriptions.push(api.commands.registerCommand(MENU_COMMAND, (name?: unknown) => showSheetMenu(name)));
  context.subscriptions.push(api.commands.registerCommand(ASK_COMMAND, () => askAboutSelection()));

  context.subscriptions.push(
    api.views.registerViewProvider('view.worksheet', {
      createView: (container: HTMLElement) => createSidebarView(container),
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('worksheet.open', () => openWorksheet('home', 'Home')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.openScratch', () => openWorksheet('scratch', 'Scratch Sheet')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.generate', () => openWorksheet('create', 'Generate Items')),
  );
  context.subscriptions.push(
    // Generate Items' source from the system's picker (its drop zone's keyboard way), or a path given.
    api.commands.registerCommand('worksheet.generateFromFile', async (filePath?: unknown) => {
      let path = typeof filePath === 'string' ? filePath : '';
      if (!path) {
        const dialog = (window as { parallxElectron?: { dialog?: { openFile?(opts: unknown): Promise<string[] | null> } } }).parallxElectron?.dialog;
        const res = await dialog?.openFile?.({ title: 'Choose a document', filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'epub', 'xlsx', 'xls', 'csv'] }] });
        path = Array.isArray(res) ? res[0] ?? '' : '';
        if (!path) return;
      }
      await openWorksheet('create', 'Generate Items');
      if (state.generatePaneHooks) void state.generatePaneHooks.loadPath(path);
      else state.pendingGeneratePath = path;
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.importExcel', async (filePath?: unknown) => {
      await openWorksheet('excel-import', 'Import Workbook');
      if (typeof filePath === 'string' && filePath) {
        if (state.importPaneHooks) void state.importPaneHooks.importPath(filePath);
        else state.pendingImportPath = filePath;
      }
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.practice', () => openWorksheet('practice', 'New Quiz')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.dashboard', () => openWorksheet('dashboard', 'Study Dashboard')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.quizzes', () => openWorksheet('quizzes', 'Quizzes')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.plan', () => openWorksheet('plan', 'Campaign')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.importPlan', async (filePath?: unknown) => {
      if (typeof filePath === 'string' && filePath) return importPlanFromPath(filePath);
      await pickAndImportPlan();
      return true;
    }),
  );
  context.subscriptions.push(
    api.commands.registerCommand(START_ROSTER_COMMAND, () => startTodaysRoster()),
  );
  context.subscriptions.push(
    api.commands.registerCommand(OPEN_QUIZ_COMMAND, (id?: unknown) => (typeof id === 'string' && id ? openPastQuiz(id) : undefined)),
  );
  context.subscriptions.push(
    api.commands.registerCommand(ADD_TAG_COMMAND, (id?: unknown, tag?: unknown) => (typeof id === 'number' && typeof tag === 'string' ? addItemTag(id, tag) : undefined)),
  );
  context.subscriptions.push(
    api.commands.registerCommand(REMOVE_TAG_COMMAND, (id?: unknown, tag?: unknown) => (typeof id === 'number' && typeof tag === 'string' ? removeItemTag(id, tag) : undefined)),
  );
  context.subscriptions.push(
    api.commands.registerCommand(REVIEW_PAPER_COMMAND, (paper?: unknown) => (typeof paper === 'string' && paper ? reviewPaper(paper) : undefined)),
  );
  context.subscriptions.push(
    api.commands.registerCommand(QUIZ_PAPER_COMMAND, (paper?: unknown) => (typeof paper === 'string' && paper ? quizPaper(paper) : undefined)),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.bank', () => openWorksheet('bank', 'Problem Bank')),
  );
  context.subscriptions.push(
    api.commands.registerCommand('worksheet.settings', () => openWorksheet('settings', 'Worksheets Settings')),
  );

  // The Practice Problems block for pages: offered only while Worksheets runs.
  if (api.canvas) {
    context.subscriptions.push(api.canvas.registerBlock(practiceBlock({
      listItems: () => listItems(),
      onDidChange: (listener) => onWorksheetDataChanged(listener),
      openProblem: (id, title) => void openWorksheet(`item:${id}`, title),
      openBank: () => void openWorksheet('bank', 'Problem Bank'),
    })));
  }

  // The essay and qualitative problems, for any tool that practises
  // questions (the core's generic question-provider seam).
  context.subscriptions.push(registerQuestionProvider(worksheetQuestionProvider({
    listRows: (limit) => listQuestionRows(limit),
    getItem: (id) => getItem(id),
    openItem: (id, title) => openWorksheet(`item:${id}`, title),
  })));

  // "Progress by paper", for any tool that shows progress (the core's generic
  // progress-provider seam); it goes with the tool when Worksheets is off.
  context.subscriptions.push(registerProgressProvider(worksheetProgressProvider({
    listItems: () => listItems(),
    onDidChange: (listener) => onWorksheetDataChanged(listener),
    openQuiz: (ids, name) => openBuilderWith({ ids, name }),
  })));

  // The time and the problems of each day and paper, for any tool that keeps a record of work (the core's
  // work-provider point); it goes with the tool when Worksheets is off, and the ledger stays.
  context.subscriptions.push(registerWorkProvider(worksheetWorkProvider()));
  // Home: the quiz left open, as one card.
  const homeCard = registerWorksheetHomeCard(api);
  if (homeCard) context.subscriptions.push(homeCard);
  void carryIdleMinutes();

  // The AI's read surface: bank/progress + the user's actual sheet work.
  registerWorksheetChatTools(api, context.subscriptions);
}

export async function deactivate(): Promise<void> {
  // Sheet files first, while the tool can still write: each live sheet saves, and every write on its way lands.
  await settleSheetFiles().catch(() => undefined);
  state.api = null;
  scratchCache.clear();
}
