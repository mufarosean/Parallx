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

// ── Real-UI helpers for E2E tests ───────────────────────────────────────────
//
// These helpers drive the actual user-facing UI (menus, clicks, keyboard).
// The ONLY thing mocked is the native OS dialog response — Playwright cannot
// interact with OS-level dialogs, so we intercept the Electron IPC handler
// for `dialog:openFolder` to return a predetermined path. Everything else
// (menu clicks, command dispatch, workspace-service updates, explorer tree
// rendering) goes through the real production code path.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a folder through the real File → "Open Folder…" menu interaction.
 *
 * Mocks only the native dialog IPC response (which is un-automatable),
 * then clicks File → Open Folder… exactly as a user would.
 *
 * @param force  When true, always drive the menu even if tree nodes exist
 *               (needed for folder-replacement tests). Defaults to false.
 */
export async function openFolderViaMenu(
  electronApp: ElectronApplication,
  page: Page,
  folderPath: string,
  { force = false }: { force?: boolean } = {},
): Promise<void> {
  if (!force) {
    // If the folder is already loaded, skip re-opening for efficiency.
    const existingNodes = await page.locator('.tree-node').count();
    if (existingNodes > 0) return;
  }

  // ── Mock the native dialog IPC handler ──
  // The native OS dialog (`dialog.showOpenDialog`) cannot be driven by
  // Playwright, so we intercept the IPC channel to return our test path.
  await electronApp.evaluate(({ ipcMain }, fp) => {
    ipcMain.removeHandler('dialog:openFolder');
    ipcMain.handle('dialog:openFolder', async () => [fp]);
  }, folderPath);

  // ── Drive the real UI: File → Open Folder… ──
  const fileMenu = page.locator('.titlebar-menu-item[data-menu-id="file"]');
  await fileMenu.click();

  const dropdown = page.locator('.context-menu.titlebar-dropdown');
  await dropdown.waitFor({ state: 'visible', timeout: 3000 });

  const openFolderItem = dropdown.locator('.context-menu-item', { hasText: 'Open Folder' });
  await openFolderItem.click();

  // ── Wait for the explorer tree to populate ──
  await page.waitForSelector('.tree-node', { timeout: 10_000 });
}
