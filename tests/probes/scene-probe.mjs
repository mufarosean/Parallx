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
import { PROJECT_ROOT, launchApp, cmd, sceneOf, flatten } from './scene.mjs';

const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), 'parallx-scene'));

/** One command per built-in that opens its main surface, in the design's step 5 order. */
const OPENERS = [
  'worksheet.open', 'planner.open', 'explorer.open', 'dashboard.open', 'settings.open',
  'welcome.openWelcome', 'agents.show', 'ai-settings.open', 'tools.showInstalled',
  'theme-editor.open', 'chat.show',
];

/** Ids the frame declares (design step 3); the probe fails when one is missing. */
const FRAME_IDS = [
  'titlebar.menu.file', 'workbench.action.closeWindow', 'activitybar.manage', 'activitybar.explorer-container',
  'editorGroup.tabs', 'status.workspace', 'status.notifications', 'settings', 'settings.search',
];

/** Ids a converted built-in declares (design step 5), checked after its surfaces open. */
const BUILTIN_IDS = {
  planner: ['planner.tab.today', 'planner.tab.tasks', 'planner.tab.calendar', 'planner.today.capture', 'planner.newEvent', 'planner.side.tasks'],
  worksheet: ['worksheet.side.home', 'worksheet.side.dashboard', 'worksheet.home.study-dashboard', 'worksheet.home.problem-bank', 'worksheet.home.quizzes', 'worksheet.home.campaign', 'worksheet.home.addProblems'],
};
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
    await page.waitForTimeout(1_500);
    const full = await sceneOf(page);
    await fs.writeFile(path.join(outDir, 'scene-full.json'), JSON.stringify(full, null, 2));
    const stats = check(full);
    console.log(`[full] surfaces=${stats.surfaces} controls=${stats.controls}`);

    // The frame (design step 3): the controls every feature hangs in, by id.
    const ids = new Set(flatten(full).map((n) => n.id));
    for (const id of FRAME_IDS) if (!ids.has(id)) stats.problems.push(`frame: no "${id}"`);
    for (const [tool, want] of Object.entries(BUILTIN_IDS)) for (const id of want) if (!ids.has(id)) stats.problems.push(`${tool}: no "${id}"`);
    // The task popover (design step 5, Planner): a surface with its fields and buttons.
    const task = await cmd(page, 'planner.newTask');
    await page.waitForTimeout(800);
    if (task === true) {
      const pop = new Set(flatten(await sceneOf(page)).map((n) => n.id));
      for (const id of ['planner.taskPopover', 'planner.task.title', 'planner.task.save']) if (!pop.has(id)) stats.problems.push(`planner: no "${id}" in the task popover`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
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
