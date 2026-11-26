// manifest.ts — the Worksheets tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';
import { SHEET_ON_SCREEN_WHEN } from './worksheetConstants.js';

export const WORKSHEET_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.worksheet',
  name: 'Worksheets',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Practice sheets: bounded spreadsheet items with givens and solutions, faithful to a target exam tool\'s constraints.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    // In the Tools menu while Worksheets runs.
    menus: {
      'menubar/tools': [{ command: 'worksheet.open', title: 'Worksheets' }],
      // The palette offers the export only while there is a sheet file to export.
      commandPalette: [
        { command: 'worksheet.exportSheet', when: SHEET_ON_SCREEN_WHEN }, { command: 'worksheet.bringSheetForward', when: 'false' },
        // The toolbar's own: each needs the control it was pressed from (which act, which menu), so the palette does not list them.
        { command: 'worksheet.formatCells', when: 'false' }, { command: 'worksheet.showSheetMenu', when: 'false' },
      ],
      // Its sidebar's More Actions menu.
      'viewContainer/title': [
        { command: 'worksheet.newSheet', title: 'New Sheet…', group: '0_sheet', when: "activeViewContainer == 'worksheet-container'" },
        // Only while a sheet file is on screen (the key is the pane's): never an entry that answers "open one first".
        { command: 'worksheet.exportSheet', title: 'Export Sheet to Excel', group: '0_sheet', when: `activeViewContainer == 'worksheet-container' && ${SHEET_ON_SCREEN_WHEN}` },
        { command: 'worksheet.practice', title: 'Start Practice Session', group: '1_practice', when: "activeViewContainer == 'worksheet-container'" },
        { command: 'worksheet.generate', title: 'Generate Items', group: '2_items', when: "activeViewContainer == 'worksheet-container'" },
        { command: 'worksheet.bank', title: 'Open Problem Bank', group: '2_items', when: "activeViewContainer == 'worksheet-container'" },
        { command: 'worksheet.dashboard', title: 'Open Dashboard', group: '2_items', when: "activeViewContainer == 'worksheet-container'" },
        { command: 'worksheet.settings', title: 'Settings', group: '3_settings', when: "activeViewContainer == 'worksheet-container'" },
      ],
    },
    commands: [
      { id: 'worksheet.open', title: 'Worksheets: Open Practice Items',
        aiInvocable: true, aiDescription: 'Open the practice items browser.' },
      { id: 'worksheet.openScratch', title: 'Worksheets: Open Scratch Sheet',
        aiInvocable: true, aiDescription: 'Open a blank exam-faithful practice sheet.' },
      { id: 'worksheet.newSheet', title: 'Worksheets: New Sheet…',
        aiInvocable: true, aiDescription: 'Make a new spreadsheet file (.sheet) in the workspace and open it: every function, no size limit, saved as you work. Arguments: an optional name.' },
      { id: 'worksheet.bringSheetForward', title: 'Worksheets: Work on This Sheet',
        aiInvocable: false, aiDescription: 'The button on a sheet file that is waiting for another sheet: the other saves and waits, and this one becomes the live sheet. Not run by hand.' },
      { id: 'worksheet.exportSheet', title: 'Worksheets: Export Sheet to Excel',
        aiInvocable: false, aiDescription: 'Save a copy of the sheet file on screen as .xlsx, values and formulas. The system asks where to save it.' },
      { id: 'worksheet.formatCells', title: 'Worksheets: Format the Selected Cells',
        aiInvocable: false, aiDescription: 'One act on the selected cells of the sheet on screen, as its toolbar does it. Argument: an object naming the act, such as { do: "bold" }, { do: "numberFormat", pattern: "0.00%" }, { do: "fill", color: "#fcf3bf" }, { do: "sort", ascending: true } or { do: "freeze", what: "row" }.' },
      { id: 'worksheet.showSheetMenu', title: 'Worksheets: Open a Toolbar Menu',
        aiInvocable: false, aiDescription: 'Opens one of the sheet toolbar\'s menus under its button. Argument: number, textColor, fill, borders, align, sum, sort, freeze or more.' },
      { id: 'worksheet.askAboutSelection', title: 'Worksheets: Ask About the Selected Cells',
        aiInvocable: false, aiDescription: 'Attaches the selected cells of the sheet on screen to the chat, with nothing sent, so a question can be asked about them.' },
      { id: 'worksheet.generate', title: 'Worksheets: Generate Items',
        aiInvocable: true, aiDescription: 'Generate practice items from study material.' },
      { id: 'worksheet.generateFromFile', title: 'Worksheets: Generate Items From a File…',
        aiInvocable: false, aiDescription: 'Choose a document in the system file picker and load it as the source for Generate Items.' },
      { id: 'worksheet.importExcel', title: 'Worksheets: Import from Excel',
        aiInvocable: true, aiDescription: 'Import existing Excel practice workbooks (Item/Answer pairs or question-and-solution sheets) as practice items.' },
      { id: 'worksheet.practice', title: 'Worksheets: Start Practice Session',
        aiInvocable: true, aiDescription: 'Open the practice-session builder: filter the item bank by topic and history, pick a length, shuffle, and work the items as a quiz.' },
      { id: 'worksheet.bank', title: 'Worksheets: Open Problem Bank',
        aiInvocable: true, aiDescription: 'Open the Problem Bank: every problem by paper, with search and filters.' },
      { id: 'worksheet.settings', title: 'Worksheets: Settings',
        aiInvocable: false, aiDescription: 'Open Worksheets Settings: the campaign and the sheet appearance.' },
      { id: 'worksheet.dashboard', title: 'Worksheets: Open Dashboard',
        aiInvocable: true, aiDescription: 'Open the Problem Bank dashboard: attempted and score, progress by paper, the timeline, and what to work on next (due, struggling, weakest papers, quick wins).' },
      { id: 'worksheet.quizzes', title: 'Worksheets: Open Quizzes',
        aiInvocable: true, aiDescription: 'Open the Quizzes tab: every quiz, open and completed, to resume, rename, copy, reopen or delete.' },
      { id: 'worksheet.plan', title: 'Worksheets: Open Campaign',
        aiInvocable: true, aiDescription: 'Open the Campaign tab: the roster when one is set (a tag worked down day by day), else the study plan day by day, with each block, the exams and the rewards.' },
      { id: 'worksheet.importPlan', title: 'Worksheets: Import Plan…' },
      { id: 'worksheet.startRoster', title: "Worksheets: Start Today's Roster",
        aiInvocable: true, aiDescription: "Start or resume today's roster quiz: every problem with the roster's tag that is still starred, in a new order each day." },
      { id: 'worksheet.addTag', title: 'Worksheets: Add Tag to Problem',
        aiInvocable: false, aiDescription: 'Put a tag on a problem by its id. A tag picks out a set to search, quiz or make a roster of.' },
      { id: 'worksheet.removeTag', title: 'Worksheets: Remove Tag From Problem',
        aiInvocable: false, aiDescription: 'Take a tag the student added off a problem by its id.' },
      { id: 'worksheet.reviewPaper', title: 'Worksheets: Review a Paper',
        aiInvocable: false, aiDescription: 'Walk through one paper’s problems the Problem Bank shows, with work and solution. That paper only.' },
      { id: 'worksheet.quizPaper', title: 'Worksheets: Quiz a Paper…',
        aiInvocable: false, aiDescription: 'Open the quiz builder with one paper’s problems the Problem Bank shows. That paper only.' },
      { id: 'worksheet.openQuiz', title: 'Worksheets: Open Quiz',
        aiInvocable: false, aiDescription: 'Open a quiz by its id: an open one resumes, a finished one reviews.' },
    ],
    viewContainers: [
      { id: 'worksheet-container', title: 'Worksheets', icon: 'calculator', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.worksheet', name: 'Practice Items', defaultContainerId: 'worksheet-container' },
    ],
    editors: [{ typeId: 'worksheet', displayName: 'Practice Sheet' }],
    configuration: [
      {
        title: 'Worksheets',
        properties: {
          'worksheet.sheetAppearance': {
            type: 'string',
            enum: ['light', 'dark', 'app'],
            default: 'light',
            description: 'Theme for the practice-sheet surface, independent of the app theme. "light" matches the real exam tool (always-white sheet), "dark" pins the sheet dark, "app" follows the workbench light/dark mode. The Sheet Theme button on any open sheet flips between light and dark.',
          },
          'worksheet.displayDecimals': {
            type: 'string',
            enum: ['2', '4', '6', '8', 'full'],
            default: '4',
            description: 'How many decimals a cell without a number format shows. The stored value and the cell editor keep full precision, and a number format set on a cell always wins. "full" shows everything the engine keeps.',
          },
          'worksheet.examDate': {
            type: 'string',
            default: '',
            description: 'The exam date (YYYY-MM-DD). The Dashboard shows the days left to it. Empty when not set.',
          },
          'worksheet.xpCashRate': {
            type: 'number',
            default: 0,
            description: 'Dollars per 100 XP. Set it and the Dashboard shows what your XP and each reward are worth, and Cash Out records what you paid yourself. 0 turns it off.',
          },
        },
      },
    ],
  },
};
