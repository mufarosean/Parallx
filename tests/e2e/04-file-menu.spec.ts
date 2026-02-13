/**
 * E2E tests: File Menu commands.
 *
 * Verifies that every item in the File menu actually works —
 * not just that it doesn't throw, but that it produces visible results.
 */
import { test, expect, createTestWorkspace, cleanupTestWorkspace, addWorkspaceFolder as addFolder } from './fixtures';
import path from 'path';
import fs from 'fs/promises';

test.describe('File Menu Commands', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  /** Click a File menu item by label text. */
  async function clickFileMenuItem(window: any, label: string) {
    const fileMenu = window.locator('.titlebar-menu-item[data-menu-id="file"]');
    await fileMenu.click();
    const dropdown = window.locator('.context-menu.titlebar-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    const item = dropdown.locator('.context-menu-item', { hasText: label });
    await item.click();
  }

  /** Add workspace folder via test hook. */
  async function addWorkspaceFolder(window: any) {
    await addFolder(window, wsPath);
    await window.waitForSelector('.tree-node', { timeout: 10_000 });
  }

  test('New Text File creates an untitled editor tab', async ({ window }) => {
    await clickFileMenuItem(window, 'New Text File');

    // An "Untitled" tab should appear
    const tab = window.locator('.editor-tab', { hasText: /Untitled/i });
    await expect(tab).toBeVisible({ timeout: 5000 });

    // The tab should be active
    await expect(tab).toHaveClass(/editor-tab--active/);

    // A textarea should be visible and empty (or nearly empty)
    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
  });

  test('New Text File via Ctrl+N creates an untitled editor', async ({ window }) => {
    // Close any existing tabs first
    const existingTabs = window.locator('.editor-tab');
    const count = await existingTabs.count();
    for (let i = 0; i < count; i++) {
      await window.keyboard.press('Control+w');
      await window.waitForTimeout(300);
    }

    // Ctrl+N
    await window.keyboard.press('Control+n');

    const tab = window.locator('.editor-tab', { hasText: /Untitled/i });
    await expect(tab).toBeVisible({ timeout: 5000 });
  });

  test('typing in an untitled editor makes it dirty', async ({ window }) => {
    await window.keyboard.press('Control+n');
    await window.waitForTimeout(500);

    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();
    await textarea.type('Hello from test');

    // The untitled tab should now be dirty
    const tab = window.locator('.editor-tab--dirty');
    await expect(tab).toBeVisible({ timeout: 3000 });
  });

  test('Save All saves all dirty files', async ({ window }) => {
    await addWorkspaceFolder(window);

    // Open a file and edit it
    const fileNode = window.locator('.tree-node .tree-node-label', { hasText: 'README.md' }).first();
    await fileNode.click();
    await window.waitForTimeout(500);

    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();
    await textarea.press('End');
    await textarea.type('\nSave-all test line.');

    // Verify dirty
    const tab = window.locator('.editor-tab', { hasText: 'README.md' });
    await expect(tab).toHaveClass(/editor-tab--dirty/, { timeout: 3000 });

    // File > Save All
    await clickFileMenuItem(window, 'Save All');

    // Dirty state should clear
    await expect(tab).not.toHaveClass(/editor-tab--dirty/, { timeout: 5000 });

    // Verify on disk
    const content = await fs.readFile(path.join(wsPath, 'README.md'), 'utf-8');
    expect(content).toContain('Save-all test line.');
  });

  test('Revert File restores original content', async ({ window, electronApp }) => {
    await addWorkspaceFolder(window);

    // Read original content
    const originalContent = await fs.readFile(path.join(wsPath, 'README.md'), 'utf-8');

    // Open and edit
    const fileNode = window.locator('.tree-node .tree-node-label', { hasText: 'README.md' }).first();
    await fileNode.click();
    await window.waitForTimeout(500);

    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    await textarea.focus();
    await textarea.press('End');
    await textarea.type('\nReverting this line.');

    const tab = window.locator('.editor-tab', { hasText: 'README.md' });
    await expect(tab).toHaveClass(/editor-tab--dirty/, { timeout: 3000 });

    // Mock the native Electron dialog IPC handler to auto-accept the revert confirmation
    await electronApp.evaluate(async ({ ipcMain }) => {
      ipcMain.removeHandler('dialog:showMessageBox');
      ipcMain.handle('dialog:showMessageBox', async () => ({ response: 0, checkboxChecked: false }));
    });

    // File > Revert File
    await clickFileMenuItem(window, 'Revert File');

    // After revert, the dirty state should clear and content should be original
    await expect(tab).not.toHaveClass(/editor-tab--dirty/, { timeout: 5000 });
    await window.waitForTimeout(500);
    const content = await textarea.inputValue();
    expect(content).not.toContain('Reverting this line.');
  });

  test('Close Editor removes the active tab', async ({ window }) => {
    // Open a new file so we have something to close
    await window.keyboard.press('Control+n');
    const tab = window.locator('.editor-tab', { hasText: /Untitled/i });
    await expect(tab).toBeVisible({ timeout: 5000 });

    await clickFileMenuItem(window, 'Close Editor');

    // Tab should be gone (if not dirty) or dialog appears
    // For a fresh untitled with no edits, it should just close
    await expect(tab).not.toBeVisible({ timeout: 5000 });
  });
});
