// scene-probe.mjs: the scene of the running app, written as data.
//
// docs/SELF_DESCRIBING_UI_DESIGN.md section 6.4. Starts the hidden app on
// a throwaway workspace, writes <outDir>/scene.json from the scene at boot,
// opens each built-in's main surface by command and writes
// <outDir>/scene-full.json, then fails when a visible entry has no label or
// two entries share an id under one surface and instance. No model calls.
//
// Usage: node tests/probes/scene-probe.mjs <outDir>
// Requires `npm run build` first (the app loads dist/). In a container
// without a display: xvfb-run -a node tests/probes/scene-probe.mjs <outDir>

import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { PROJECT_ROOT, launchApp, cmd, sceneOf, flatten, click, openFile, tinyPdf } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-scene'));

/** One command per built-in that opens its main surface, in the design's step 5 order. */
const OPENERS = [
  'worksheet.open', 'planner.open', 'explorer.open', 'search.findInFiles', 'dashboard.open', 'settings.open',
  'welcome.openWelcome', 'agents.show', 'ai-settings.open', 'tools.showInstalled',
  'theme-editor.open', 'chat.show', 'workflows.new',
];

/** Ids the frame declares (design step 3); the probe fails when one is missing. */
const FRAME_IDS = [
  'titlebar.menu.file', 'workbench.action.closeWindow', 'activitybar.manage', 'activitybar.explorer-container',
  'editorGroup.tabs', 'status.workspace', 'status.notifications', 'settings', 'settings.search',
];

/** Ids a converted built-in declares (design step 5), checked after its surfaces open. */
const BUILTIN_IDS = {
  dashboard: ['dashboard.addWidget', 'dashboard.refreshAll', 'dashboard.schedule', 'dashboard.hideHeader', 'dashboard.side.new', 'dashboard.side.pages'],
  explorer: ['explorer.tree', 'explorer.openEditors'],
  search: ['search.query', 'search.replace', 'search.toggleReplace', 'search.match-case', 'search.results'],
  planner: ['planner.tab.today', 'planner.tab.tasks', 'planner.tab.calendar', 'planner.today.capture', 'planner.newEvent', 'planner.side.tasks'],
  worksheet: ['worksheet.side.home', 'worksheet.side.dashboard', 'worksheet.home.study-dashboard', 'worksheet.home.problem-bank', 'worksheet.home.quizzes', 'worksheet.home.campaign', 'worksheet.home.addProblems'],
  agents: ['agents.newRoutine', 'agents.openSettings', 'agents.tab', 'agents.showHistory'],
  chat: ['chat.input', 'chat.send', 'chat.addContext', 'chat.mode', 'chat.engine', 'chat.context', 'chat.newSession', 'chat.empty.commands'],
  workflows: ['workflows.editor.name', 'workflows.editor.runNow', 'workflows.editor.enabled', 'workflows.editor.add.trigger-schedule'],
  welcome: ['welcome.workbench.action.showCommands', 'welcome.settings.open', 'welcome.workbench.action.files.openFolder'],
  tools: ['tools.search', 'tools.install'],
  appearance: ['appearance.mode.dark', 'appearance.hue', 'appearance.themeName', 'appearance.saveTheme'],
};
/** Panel views shown by `workbench.view.show`, and an id each declares once its view is rendered. */
const PANEL_VIEWS = { 'view.terminal': 'terminal.input', 'view.activityLog': 'activityLog.filter.all', 'view.output': 'output.log', 'view.diagnostics': 'diagnostics.results', 'view.indexingLog': 'indexingLog.log' };
/** Ids present once a scratch sheet is open (`worksheet.openScratch`). */
const SCRATCH_IDS = ['worksheet.sheetTheme', 'worksheet.sheet.export'];

async function seed() {
  const stamp = Date.now();
  const appRoot = path.join(os.tmpdir(), `parallx-scene-root-${stamp}`);
  const ws = path.join(os.tmpdir(), `parallx-scene-ws-${stamp}`);
  await fs.mkdir(path.join(appRoot, 'data'), { recursive: true });
  await fs.mkdir(ws, { recursive: true });
  await fs.writeFile(path.join(appRoot, 'data', 'last-workspace.json'), JSON.stringify({ path: ws }));
  try { await fs.symlink(path.join(PROJECT_ROOT, 'ext'), path.join(appRoot, 'ext'), 'junction'); } catch { /* ok */ }
  await fs.writeFile(path.join(ws, 'alpha.md'), '# Alpha\n\nA note.\n');
  await fs.writeFile(path.join(ws, 'reading.pdf'), tinyPdf());
  return appRoot;
}

function check(description) {
  const problems = [];
  const nodes = flatten(description);
  for (const n of nodes) {
    if (n.visible && !n.label) problems.push(`no label: ${n.kind} "${n.id}" under ${n.parent ?? 'the window'}`);
  }
  const seen = new Map();
  const walk = (node) => {
    const keys = new Map();
    for (const c of node.children ?? []) {
      const key = `${c.id}#${c.instance ?? ''}`;
      if (keys.has(key)) problems.push(`duplicate: "${c.id}" twice under ${node.id}`);
      keys.set(key, true);
      walk(c);
    }
  };
  for (const s of description.surfaces) {
    const key = `${s.id}#${s.instance ?? ''}`;
    if (seen.has(key)) problems.push(`duplicate: top-level surface "${s.id}" twice`);
    seen.set(key, true);
    walk(s);
  }
  return { nodes: nodes.length, surfaces: nodes.filter((n) => n.kind === 'surface').length, controls: nodes.filter((n) => n.kind !== 'surface').length, problems };
}

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const appRoot = await seed();
  const { app, page, errors } = await launchApp(appRoot);
  try {
    const boot = await sceneOf(page);
    await fs.writeFile(path.join(outDir, 'scene.json'), JSON.stringify(boot, null, 2));
    const bootStats = check(boot);
    console.log(`[boot] surfaces=${bootStats.surfaces} controls=${bootStats.controls}`);

    for (const id of OPENERS) {
      const r = await cmd(page, id);
      if (r !== true) console.log(`[open] ${id}: ${r}`);
      await page.waitForTimeout(700);
    }
    for (const viewId of Object.keys(PANEL_VIEWS)) {
      const r = await cmd(page, 'workbench.view.show', viewId);
      if (r !== true) console.log(`[open] ${viewId}: ${r}`);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1_500);
    const full = await sceneOf(page);
    await fs.writeFile(path.join(outDir, 'scene-full.json'), JSON.stringify(full, null, 2));
    const stats = check(full);
    console.log(`[full] surfaces=${stats.surfaces} controls=${stats.controls}`);

    // The frame (design step 3): the controls every feature hangs in, by id.
    const ids = new Set(flatten(full).map((n) => n.id));
    for (const id of FRAME_IDS) if (!ids.has(id)) stats.problems.push(`frame: no "${id}"`);
    for (const [tool, want] of Object.entries(BUILTIN_IDS)) for (const id of want) if (!ids.has(id)) stats.problems.push(`${tool}: no "${id}"`);
    for (const [viewId, id] of Object.entries(PANEL_VIEWS)) if (!ids.has(id)) stats.problems.push(`${viewId}: no "${id}"`);
    // Extensions (design step 7): turned on here, since the seeded workspace has none on; one id each once its surface opens.
    const EXTENSION_IDS = {
      'parallx.workspace-graph': ['workspaceGraph.open', ['workspaceGraph.search', 'workspaceGraph.refresh', 'workspaceGraph.viewMode']],
      'parallx.budget': ['budget.openTransactions', ['budget.tx.search', 'budget.tx.list', 'budget.tx.view.all', 'budget.month.prev', 'budget.addTransaction']],
    };
    await page.evaluate(async (ids) => {
      const svc = window.__parallx_workbench__?._services?.get?.({ id: 'IToolEnablementService' });
      for (const id of ids) { try { await svc?.setEnablement(id, true); } catch (e) { console.warn('enable', id, String(e)); } }
    }, Object.keys(EXTENSION_IDS));
    await page.waitForTimeout(3_000);
    for (const [ext, [open, want]] of Object.entries(EXTENSION_IDS)) {
      const r = await cmd(page, open);
      await page.waitForTimeout(1_500);
      if (r !== true) { stats.problems.push(`${ext}: ${open} did not run: ${r}`); continue; }
      const extIds = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of want) if (!extIds.has(id)) stats.problems.push(`${ext}: no "${id}"`);
    }
    // The settings editor (showing the appearance panel) is a centred overlay over everything; it closes on Escape, so the clicks below land.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Canvas (design step 5): a new page's chrome, by id.
    const newPage = await cmd(page, 'canvas.newPage');
    await page.waitForTimeout(1_500);
    if (newPage === true) {
      const pageIds = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of ['canvas.page.menu', 'canvas.page.favorite', 'canvas.page.addIcon', 'canvas.sidebar.tree', 'canvas.sidebar.newPage']) if (!pageIds.has(id)) stats.problems.push(`canvas: no "${id}" on a new page`);
    } else console.log(`[open] canvas.newPage: ${newPage}`);
    // AI settings (design step 5): the settings editor shows one panel at a time, so open the AI panel again and read it.
    const ai = await cmd(page, 'settings.open', 'ai');
    await page.waitForTimeout(800);
    if (ai === true) {
      const aiIds = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of ['aiSettings', 'aiSettings.search', 'aiSettings.nav.model', 'aiSettings.agent.add', 'aiSettings.mcp.add']) if (!aiIds.has(id)) stats.problems.push(`ai-settings: no "${id}"`);
      await page.keyboard.press('Escape'); // the settings editor is a centred overlay too
      await page.waitForTimeout(300);
    }
    // Agents (design step 5): the Routines tab's buttons, then the New Routine form as a surface.
    const routines = await cmd(page, 'agents.showRoutines');
    await page.waitForTimeout(800);
    if (routines === true) {
      const rt = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of ['agents.routines.new', 'workflows.new', 'agents.heartbeatSettings']) if (!rt.has(id)) stats.problems.push(`agents: no "${id}" on the Routines tab`);
    }
    const routine = await cmd(page, 'agents.newRoutine');
    await page.waitForTimeout(800);
    if (routine === true) {
      const form = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of ['agents.routineForm', 'agents.routineForm.name', 'agents.routineForm.day.mon', 'agents.routineForm.time', 'agents.routineForm.save']) if (!form.has(id)) stats.problems.push(`agents: no "${id}" in the New Routine form`);
      if (form.has('agents.routineForm.cancel')) await click(page, 'agents.routineForm.cancel');
      await page.waitForTimeout(300);
    }
    // The task popover (design step 5, Planner): a surface with its fields and buttons.
    const task = await cmd(page, 'planner.newTask');
    await page.waitForTimeout(800);
    if (task === true) {
      const pop = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of ['planner.taskPopover', 'planner.task.title', 'planner.task.save']) if (!pop.has(id)) stats.problems.push(`planner: no "${id}" in the task popover`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    // The PDF viewer (design step 5): its toolbar declared once a PDF is open.
    await openFile(page, 'reading.pdf');
    const pdfOpen = await page.waitForSelector('.pdf-editor-pane', { timeout: 20_000 }).then(() => true).catch(() => false);
    if (!pdfOpen) stats.problems.push('pdf: reading.pdf did not open');
    else {
      await page.waitForTimeout(1_500);
      const pdfIds = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of ['pdf.previousPage', 'pdf.page', 'pdf.nextPage', 'pdf.zoom', 'pdf.fit', 'pdf.find', 'pdf.panel', 'pdf.nightReading', 'pdf.more']) if (!pdfIds.has(id)) stats.problems.push(`pdf: no "${id}"`);
    }
    const scratch = await cmd(page, 'worksheet.openScratch');
    await page.waitForTimeout(2_500);
    if (scratch === true) {
      const after = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of SCRATCH_IDS) if (!after.has(id)) stats.problems.push(`worksheet: no "${id}" on the scratch sheet`);
    }
    const r = await cmd(page, 'workbench.action.quickOpen');
    await page.waitForTimeout(500);
    const quick = flatten(await sceneOf(page)).map((n) => n.id);
    if (r === true && (!quick.includes('quickAccess.input') || !quick.includes('quickAccess.list'))) stats.problems.push('frame: quick access opened without its input and list');
    await page.keyboard.press('Escape');
    for (const p of stats.problems) console.log(`[problem] ${p}`);
    for (const e of errors) console.log(`[error] ${e}`);
    if (stats.problems.length || bootStats.problems.length) process.exitCode = 1;
  } finally {
    await app.close().catch(() => {});
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
