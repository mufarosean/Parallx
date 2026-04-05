/**
 * Diagnostic test: Launch into Exam 7 workspace, then Open Folder to Personal Workspace.
 * Captures console logs, screenshots, and state at each step.
 */
import { test as base, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const INITIAL_WORKSPACE = String.raw`C:\Users\mchit\OneDrive\Documents\Actuarial Science\Exams\Exam 7 - April 2026`;
const TARGET_WORKSPACE = String.raw`D:\Documents\Parallx Workspaces\Personal Workspace`;

const test = base.extend<{ electronApp: ElectronApplication; window: Page }>({
  electronApp: async ({}, use) => {
    // Seed last-workspace.json to point at the initial workspace
    const lastWsPath = path.join(PROJECT_ROOT, 'data', 'last-workspace.json');
    const backup = await fs.readFile(lastWsPath, 'utf-8').catch(() => null);

    await fs.writeFile(lastWsPath, JSON.stringify({ path: INITIAL_WORKSPACE }));
    console.log('[TEST] Seeded last-workspace.json →', INITIAL_WORKSPACE);

    const app = await electron.launch({
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: { ...process.env, PARALLX_TEST_MODE: '1' },
    });

    await use(app);

    // Restore backup
    if (backup) {
      await fs.writeFile(lastWsPath, backup);
    }
    try { await app.close(); } catch { /* */ }
  },

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 30_000 });
    await use(page);
  },
});

test('open folder: Exam 7 → Personal Workspace', async ({ electronApp, window: page }) => {
  const logs: string[] = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs.push(text);
  });

  // Step 1: Verify we launched into the initial workspace
  await page.waitForTimeout(3000); // let restore settle
  await page.screenshot({ path: 'test-results/01-initial-workspace.png' });

  const titleText = await page.locator('[data-part-id="workbench.parts.titlebar"]').textContent();
  console.log('[TEST] Title after launch:', titleText);

  // Check explorer tree for folders
  const explorerItems = await page.locator('.tree-item-label').allTextContents();
  console.log('[TEST] Explorer items after launch:', explorerItems.slice(0, 10));

  // Step 2: Call openFolder programmatically (bypass dialog)
  console.log('[TEST] Calling openFolder →', TARGET_WORKSPACE);
  
  // We can't use the dialog, so call it directly via evaluate
  const openResult = await page.evaluate(async (targetPath) => {
    try {
      // Access the workbench instance
      const wb = (window as any).__parallx_workbench__;
      if (!wb) return { error: 'No __parallx_workbench__ on window' };
      
      if (typeof wb.openFolder !== 'function') return { error: 'openFolder is not a function' };

      // Don't await — it will reload the page
      wb.openFolder(targetPath);
      return { ok: true };
    } catch (e: any) {
      return { error: e.message };
    }
  }, TARGET_WORKSPACE);

  console.log('[TEST] openFolder result:', openResult);

  if ((openResult as any)?.error) {
    // Try via command system instead
    console.log('[TEST] Trying via executeCommand...');
    
    // Check if there's another way to access it
    const altResult = await page.evaluate(async (targetPath) => {
      try {
        // Try the Workbench static/singleton
        const w = (window as any).__parallx_workbench__;
        if (w) {
          // Log state
          return {
            state: w._state,
            switching: w._switching,
            hasFolders: w._workspace?.folders?.length,
            workspaceName: w._workspace?.name,
            methods: Object.getOwnPropertyNames(Object.getPrototypeOf(w)).filter(m => m.includes('open') || m.includes('switch') || m.includes('folder')),
          };
        }
        return { error: 'No workbench' };
      } catch (e: any) {
        return { error: e.message };
      }
    }, TARGET_WORKSPACE);
    console.log('[TEST] Workbench introspection:', altResult);
  }

  // Wait for possible reload
  try {
    await page.waitForEvent('close', { timeout: 5000 }).catch(() => {});
  } catch { /* page might reload instead of close */ }

  // After reload: wait for the new page
  let newPage: Page;
  try {
    newPage = await electronApp.firstWindow();
    await newPage.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 30_000 });
  } catch (e) {
    console.log('[TEST] Failed to get window after reload:', e);
    
    // Dump all console logs
    console.log('\n=== CONSOLE LOGS ===');
    for (const l of logs) console.log(l);
    return;
  }

  // Capture new console
  const logs2: string[] = [];
  newPage.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    logs2.push(text);
  });

  await newPage.waitForTimeout(5000); // let restore settle
  await newPage.screenshot({ path: 'test-results/02-after-open-folder.png' });

  const titleAfter = await newPage.locator('[data-part-id="workbench.parts.titlebar"]').textContent();
  console.log('[TEST] Title after open folder:', titleAfter);

  const explorerAfter = await newPage.locator('.tree-item-label').allTextContents();
  console.log('[TEST] Explorer items after open:', explorerAfter.slice(0, 10));

  // Read last-workspace.json to confirm it was updated
  const lastWs = await newPage.evaluate(async () => {
    try {
      const bridge = (window as any).parallxElectron?.storage;
      const appPath = (window as any).parallxElectron?.appPath;
      if (!bridge || !appPath) return { error: 'No bridge/appPath' };
      const result = await bridge.readJson(`${appPath}/data/last-workspace.json`);
      return result;
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log('[TEST] last-workspace.json after reload:', lastWs);

  // Read workspace state to see what got loaded
  const wsState = await newPage.evaluate(async () => {
    try {
      const bridge = (window as any).parallxElectron?.storage;
      const result = await bridge.readJson(String.raw`D:\Documents\Parallx Workspaces\Personal Workspace\.parallx\workspace-state.json`);
      if (result.data) {
        const parsed = JSON.parse((result.data as any).workbench || '{}');
        return {
          version: (result.data as any).version,
          hasIdentity: !!parsed.identity,
          identityName: parsed.identity?.name,
          foldersCount: parsed.folders?.length,
          folders: parsed.folders?.map((f: any) => f.name),
        };
      }
      return { data: null, error: result.error };
    } catch (e: any) {
      return { error: e.message };
    }
  });
  console.log('[TEST] Target workspace state:', wsState);

  // Dump logs
  console.log('\n=== PRE-RELOAD CONSOLE LOGS ===');
  for (const l of logs.filter(l => l.includes('Workbench') || l.includes('workspace') || l.includes('error') || l.includes('Error'))) {
    console.log(l);
  }
  console.log('\n=== POST-RELOAD CONSOLE LOGS ===');
  for (const l of logs2.filter(l => l.includes('Workbench') || l.includes('workspace') || l.includes('error') || l.includes('Error'))) {
    console.log(l);
  }
});
