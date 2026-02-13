/**
 * Shared Playwright fixture that launches the Parallx Electron app.
 *
 * Every test file imports `test` and `expect` from here. The app is launched
 * once per test file (shared across tests within a describe block) so tests
 * run fast while still getting a fresh app per file.
 */
import { test as base, expect, type Page, type ElectronApplication } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

// ── Temp workspace helpers ──────────────────────────────────────────────────

/** Create a temporary workspace folder with sample files for testing. */
async function createTestWorkspace(): Promise<string> {
  const dir = path.join(os.tmpdir(), `parallx-test-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, 'docs'), { recursive: true });
  await fs.writeFile(path.join(dir, 'README.md'), '# Test Project\n\nHello world.\n');
  await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'console.log("hello");\n');
  await fs.writeFile(path.join(dir, 'src', 'utils.ts'), 'export function add(a: number, b: number) { return a + b; }\n');
  await fs.writeFile(path.join(dir, 'docs', 'guide.md'), '# Guide\n\nSome documentation.\n');
  return dir;
}

/** Recursively remove the temp directory. */
async function cleanupTestWorkspace(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch { /* best effort */ }
}

// ── Fixture types ───────────────────────────────────────────────────────────

type TestFixtures = {
  /** The Electron application instance. */
  electronApp: ElectronApplication;
  /** The main renderer page (first window). */
  window: Page;
  /** Path to a temporary workspace directory with sample files. */
  workspacePath: string;
};

// ── Build the fixture ───────────────────────────────────────────────────────

export const test = base.extend<TestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  workspacePath: async ({}, use) => {
    const dir = await createTestWorkspace();
    await use(dir);
    await cleanupTestWorkspace(dir);
  },

  electronApp: async ({}, use) => {
    const app = await electron.launch({
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        // Prevent persisted state from interfering with tests
        PARALLX_TEST_MODE: '1',
      },
    });
    await use(app);
    await app.close();
  },

  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    // Wait for the workbench to render
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 15_000 });
    await use(page);
  },
});

export { expect };
export { createTestWorkspace, cleanupTestWorkspace };

// ── Test hook helpers (work through __parallxTestHook exposed in test mode) ──

/** Add a workspace folder via the test hook. Returns true if the hook was available. */
export async function addWorkspaceFolder(page: Page, folderPath: string): Promise<boolean> {
  return page.evaluate((fp: string) => {
    const hook = (window as any).__parallxTestHook;
    if (!hook) return false;
    hook.addFolder(fp);
    return true;
  }, folderPath);
}

/** Execute a workbench command via the test hook. Returns true if the hook was available. */
export async function executeCommand(page: Page, commandId: string, ...args: any[]): Promise<boolean> {
  return page.evaluate(({ id, a }) => {
    const hook = (window as any).__parallxTestHook;
    if (!hook) return false;
    hook.executeCommand(id, ...a);
    return true;
  }, { id: commandId, a: args });
}

/** Get the number of workspace folders. */
export async function getFolderCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const hook = (window as any).__parallxTestHook;
    if (!hook) return 0;
    return hook.getFolders().length;
  });
}
