/**
 * E2E tests: File Editor — open, view content, edit, dirty state, save.
 *
 * These tests verify the full file editing lifecycle by opening a real file
 * from a workspace folder and interacting with the textarea editor pane.
 */
import { test, expect, createTestWorkspace, cleanupTestWorkspace, openFolderViaMenu } from './fixtures';
import path from 'path';
import fs from 'fs/promises';

test.describe('File Editor', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  /**
   * Helper: open the test workspace folder via real File menu interaction,
   * then open a specific file by clicking it in the explorer.
   */
  async function openWorkspaceAndFile(electronApp: any, window: any, fileName: string) {
    // Open folder via real File menu interaction (dialog IPC is mocked)
    await openFolderViaMenu(electronApp, window, wsPath);

    // If fileName is in a subfolder, we need to expand the folder first
    const parts = fileName.split('/');
    if (parts.length > 1) {
      // Expand the folder
      for (let i = 0; i < parts.length - 1; i++) {
        const folderNode = window.locator('.tree-node', { hasText: parts[i] }).first();
        const chevron = folderNode.locator('.tree-node-chevron');
        const text = await chevron.textContent();
        if (text === '▸') {
          await folderNode.click();
          await window.waitForTimeout(500);
        }
      }
    }

    // Click the target file
    const baseName = parts[parts.length - 1];
    const fileNode = window.locator('.tree-node .tree-node-label', { hasText: baseName }).first();
    await fileNode.click();

    // Wait for tab to appear
    const tab = window.locator('.editor-tab', { hasText: baseName });
    await expect(tab).toBeVisible({ timeout: 5000 });
    return baseName;
  }

  test('opening a file shows its content in the editor pane', async ({ window, electronApp }) => {
    await openWorkspaceAndFile(electronApp, window, 'README.md');

    // The editor pane should contain a textarea with the file content
    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    const content = await textarea.inputValue();
    expect(content).toContain('# Test Project');
    expect(content).toContain('Hello world.');
  });

  test('editing text marks the editor tab as dirty', async ({ window, electronApp }) => {
    await openWorkspaceAndFile(electronApp, window, 'README.md');

    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Type additional text
    await textarea.focus();
    await textarea.press('End');
    await textarea.type('\nNew line added by test.');

    // Tab should now show dirty indicator
    const tab = window.locator('.editor-tab', { hasText: 'README.md' });
    await expect(tab).toHaveClass(/editor-tab--dirty/, { timeout: 3000 });

    // The dirty dot (●) should be visible in the tab
    const dirtyDot = tab.locator('.editor-tab-dirty');
    await expect(dirtyDot).toBeVisible();
  });

  test('Ctrl+S saves the file and clears the dirty state', async ({ window, electronApp }) => {
    await openWorkspaceAndFile(electronApp, window, 'src/utils.ts');

    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });

    // Edit the content
    await textarea.focus();
    await textarea.press('End');
    await textarea.type('\n// saved by test');

    // Verify dirty
    const tab = window.locator('.editor-tab', { hasText: 'utils.ts' });
    await expect(tab).toHaveClass(/editor-tab--dirty/, { timeout: 3000 });

    // Save with Ctrl+S
    await window.keyboard.press('Control+s');

    // Dirty state should clear
    await expect(tab).not.toHaveClass(/editor-tab--dirty/, { timeout: 5000 });

    // Verify the file on disk was actually written
    const diskContent = await fs.readFile(path.join(wsPath, 'src', 'utils.ts'), 'utf-8');
    expect(diskContent).toContain('// saved by test');
  });

  test('opening multiple files shows multiple tabs', async ({ window, electronApp }) => {
    // Open first file
    await openWorkspaceAndFile(electronApp, window, 'README.md');

    // Open second file  
    const indexNode = window.locator('.tree-node .tree-node-label', { hasText: 'index.ts' }).first();

    // May need to expand src folder first
    const srcFolder = window.locator('.tree-node', { hasText: 'src' }).first();
    const chevron = srcFolder.locator('.tree-node-chevron');
    const chevronText = await chevron.textContent();
    if (chevronText === '▸') {
      await srcFolder.click();
      await window.waitForTimeout(500);
    }

    await indexNode.click();

    // Should now have at least 2 tabs
    const tabs = window.locator('.editor-tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('clicking a tab switches the active editor', async ({ window, electronApp }) => {
    // Ensure we have multiple tabs open — double-click to pin (not preview)
    await openWorkspaceAndFile(electronApp, window, 'README.md');

    // Double-click README to pin it
    const readmeNode = window.locator('.tree-node .tree-node-label', { hasText: 'README.md' }).first();
    await readmeNode.dblclick();
    await window.waitForTimeout(500);

    // Open another file (also pinned)
    const srcFolder = window.locator('.tree-node', { hasText: 'src' }).first();
    const chevron = srcFolder.locator('.tree-node-chevron');
    const chevronText = await chevron.textContent();
    if (chevronText === '▸') {
      await srcFolder.click();
      await window.waitForTimeout(500);
    }
    const indexNode = window.locator('.tree-node .tree-node-label', { hasText: 'index.ts' }).first();
    await indexNode.dblclick();
    await window.waitForTimeout(500);

    // Now click back to the README tab
    const readmeTab = window.locator('.editor-tab', { hasText: 'README' });
    await expect(readmeTab).toBeVisible({ timeout: 5000 });
    await readmeTab.click();

    // README tab should be active
    await expect(readmeTab).toHaveClass(/editor-tab--active/);

    // Textarea should show README content
    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 3000 });
    const content = await textarea.inputValue();
    expect(content).toContain('# Test Project');
  });

  test('closing a tab via the close button removes it', async ({ window, electronApp }) => {
    await openWorkspaceAndFile(electronApp, window, 'README.md');

    const tab = window.locator('.editor-tab', { hasText: 'README.md' });
    await expect(tab).toBeVisible();

    // Click the close button on the tab
    const closeBtn = tab.locator('.editor-tab-close');
    await closeBtn.click();

    // Tab should be gone (may take a moment for the dirty check dialog)
    await expect(tab).not.toBeVisible({ timeout: 5000 });
  });

  test('Ctrl+W closes the active editor tab', async ({ window, electronApp }) => {
    await openWorkspaceAndFile(electronApp, window, 'docs/guide.md');

    const tab = window.locator('.editor-tab', { hasText: 'guide.md' });
    await expect(tab).toBeVisible();

    // Press Ctrl+W
    await window.keyboard.press('Control+w');

    // Tab should close
    await expect(tab).not.toBeVisible({ timeout: 5000 });
  });
});
