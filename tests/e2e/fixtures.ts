/**
 * Shared Playwright fixtures for the Parallx Electron app.
 *
 * Two fixture flavors:
 *
 *   `test`       — per-test isolation. Each test() gets a fresh Electron
 *                   instance, launched and closed around that single test.
 *                   Best for workbench-chrome / explorer / tabs tests (01-08).
 *
 *   `sharedTest` — worker-scoped. One Electron instance stays alive for ALL
 *                   tests that import `sharedTest`. State accumulates between
 *                   tests, which catches real-world bugs like event listener
 *                   leaks, stale sidebar state, and memory growth.
 *                   Best for canvas / block-interaction tests (09-18+).
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

// ── Worker-scoped fixture (shared Electron instance) ────────────────────────
//
// One Electron app launched per worker (workers: 1 → one app for the entire
// test run of files that import sharedTest). State accumulates between tests
// exactly like a real user session.
// ─────────────────────────────────────────────────────────────────────────────

type SharedWorkerFixtures = {
  electronApp: ElectronApplication;
  window: Page;
  workspacePath: string;
};

export const sharedTest = base.extend<{}, SharedWorkerFixtures>({
  electronApp: [async ({}, use) => {
    const app = await electron.launch({
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PARALLX_TEST_MODE: '1',
      },
    });
    await use(app);
    await app.close();
  }, { scope: 'worker' }],

  window: [async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 15_000 });
    await use(page);
  }, { scope: 'worker' }],

  workspacePath: [async ({}, use) => {
    const dir = await createTestWorkspace();
    await use(dir);
    await cleanupTestWorkspace(dir);
  }, { scope: 'worker' }],
});

// ── Shared canvas helpers ───────────────────────────────────────────────────

/**
 * Set up a canvas page for testing.
 *
 * Idempotently opens the workspace folder and canvas sidebar, creates a
 * **new** page, opens it, and waits for TipTap to fully initialise.
 * Safe to call repeatedly in a shared instance — each call creates a fresh
 * page so tests don't collide with previous page content.
 */
export async function setupCanvasPage(
  page: Page,
  electronApp: ElectronApplication,
  wsPath: string,
): Promise<void> {
  await openFolderViaMenu(electronApp, page, wsPath);
  await page.waitForTimeout(1500);

  // Open Canvas sidebar if not already active
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });

  // Create a new page (appended at end of tree with highest sort_order)
  const beforeCount = await page.locator('.canvas-node').count();
  await page.locator('.canvas-sidebar-add-btn').click();
  await page.waitForFunction(
    (prev) => document.querySelectorAll('.canvas-node').length > prev,
    beforeCount,
    { timeout: 10_000 },
  );

  // Open the newly created page (last in sort order)
  await page.locator('.canvas-node').last().click();
  await page.waitForSelector('.tiptap', { timeout: 10_000 });

  // Wait for TipTap editor to be fully initialised
  await page.waitForFunction(
    () => (window as any).__tiptapEditor != null,
    { timeout: 10_000 },
  );
  await page.waitForTimeout(300);
}

/** Wait for the TipTap editor to be exposed on window (test mode). */
export async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__tiptapEditor != null,
    { timeout: 10_000 },
  );
}

/** Set TipTap editor content and wait for it to render. */
export async function setContent(page: Page, content: any[]): Promise<void> {
  await page.evaluate((c) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) throw new Error('No TipTap editor');
    editor.commands.setContent({ type: 'doc', content: c });
  }, content);
  await page.waitForTimeout(300);
}

/** Get simplified document structure as string array. */
export async function getDocStructure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return [];
    const json = editor.getJSON();
    return (json.content || []).map((node: any) => {
      const type = node.type;
      if (type === 'paragraph') return `p:${node.content?.[0]?.text || ''}`;
      if (type === 'heading') return `h${node.attrs?.level}:${node.content?.[0]?.text || ''}`;
      if (type === 'bulletList') return 'bulletList';
      if (type === 'orderedList') return 'orderedList';
      if (type === 'taskList') return 'taskList';
      if (type === 'blockquote') return 'blockquote';
      if (type === 'codeBlock') return 'codeBlock';
      if (type === 'callout') return 'callout';
      if (type === 'details') return 'details';
      if (type === 'mathBlock') return 'mathBlock';
      if (type === 'columnList') {
        const cols = (node.content || []).length;
        return `columnList:${cols}`;
      }
      return type;
    });
  });
}

/** Get the full TipTap document JSON. */
export async function getDocJSON(page: Page): Promise<any> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return null;
    return editor.getJSON();
  });
}

/** Hover over a specific block by index to trigger the drag handle. */
export async function hoverBlockByIndex(page: Page, index: number): Promise<void> {
  const tiptap = page.locator('.tiptap');
  const blocks = tiptap.locator(':scope > *');
  const block = blocks.nth(index);
  await block.hover();
  await page.waitForTimeout(500);
}

/** Click the drag handle to open the block action menu. */
export async function openBlockActionMenu(page: Page, blockIndex: number): Promise<void> {
  await hoverBlockByIndex(page, blockIndex);
  const dragHandle = page.locator('.drag-handle');
  await expect(dragHandle).toBeVisible({ timeout: 3_000 });
  await dragHandle.click({ force: true });
  await page.waitForTimeout(200);
}

/** Type a slash command and select from the slash menu. */
export async function insertViaSlashMenu(page: Page, label: string): Promise<void> {
  await page.keyboard.type('/');
  await page.waitForSelector('.canvas-slash-menu', { timeout: 3_000 });

  // Type enough to filter
  const filterText = label.replace(/\s+/g, '').toLowerCase();
  for (const ch of filterText) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(50);
  }

  // Click the matching item
  const item = page.locator('.canvas-slash-item', { hasText: label }).first();
  await expect(item).toBeVisible({ timeout: 3_000 });
  await item.click();
  await page.waitForTimeout(300);
}

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
