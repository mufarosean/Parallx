// manifest.ts — the Worksheets tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

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
    menus: { 'menubar/tools': [{ command: 'worksheet.open', title: 'Worksheets' }] },
    commands: [
      { id: 'worksheet.open', title: 'Worksheets: Open Practice Items',
        aiInvocable: true, aiDescription: 'Open the practice items browser.' },
      { id: 'worksheet.openScratch', title: 'Worksheets: Open Scratch Sheet',
        aiInvocable: true, aiDescription: 'Open a blank exam-faithful practice sheet.' },
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
      { id: 'worksheet.openQuiz', title: 'Worksheets: Open Quiz',
        aiInvocable: false, aiDescription: 'Open a quiz by its id: an open one resumes, a finished one reviews.' },
    ],
    viewContainers: [
      { id: 'worksheet-container', title: 'Worksheets', icon: 'file-spreadsheet', location: 'sidebar' as const },
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
          'worksheet.idleMinutes': {
            type: 'number',
            default: 10,
            description: 'The study clock counts while a problem or the quiz is on screen. After this many minutes without any input the stretch is taken back, so a break with the tab up counts for nothing.',
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
