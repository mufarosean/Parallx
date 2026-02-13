/**
 * E2E tests: Explorer sidebar with a real workspace folder.
 *
 * Opens a temp folder, verifies the file tree renders correctly,
 * expand/collapse works, and clicking a file opens it in the editor.
 */
import { test, expect, createTestWorkspace, cleanupTestWorkspace, addWorkspaceFolder } from './fixtures';

test.describe('Explorer Sidebar', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  test('opening a folder shows the explorer tree', async ({ window }) => {
    // Add workspace folder via test hook
    await addWorkspaceFolder(window, wsPath);

    // Wait for the explorer tree to populate
    await window.waitForSelector('.tree-node', { timeout: 10_000 });

    // Verify root nodes appear — should have at minimum the root folder
    const treeNodes = window.locator('.tree-node');
    const count = await treeNodes.count();
    expect(count).toBeGreaterThan(0);
  });

  test('tree shows folders and files with correct icons', async ({ window }) => {
    // Add workspace folder
    await addWorkspaceFolder(window, wsPath);
    // Wait for tree to be populated
    await window.waitForSelector('.tree-node', { timeout: 10_000 });

    // Check that folder icon (📁) and file icon (📄) are present
    const folderIcons = window.locator('.tree-node-icon:has-text("📁")');
    const fileIcons = window.locator('.tree-node-icon:has-text("📄")');

    // We created: src/ docs/ (folders) + README.md (file at root)
    const folderCount = await folderIcons.count();
    const fileCount = await fileIcons.count();
    expect(folderCount).toBeGreaterThanOrEqual(1); // at least src or docs
    expect(fileCount).toBeGreaterThanOrEqual(1); // at least README.md
  });

  test('clicking a folder expands to show children', async ({ window }) => {
    await addWorkspaceFolder(window, wsPath);
    await window.waitForSelector('.tree-node', { timeout: 10_000 });
    // Find a collapsed directory (chevron ▸)
    const collapsedDir = window.locator('.tree-node:has(.tree-node-chevron:has-text("▸"))').first();
    const dirCount = await window.locator('.tree-node:has(.tree-node-chevron:has-text("▸"))').count();

    if (dirCount > 0) {
      // Get the label text to use as stable locator after re-render
      const label = await collapsedDir.locator('.tree-node-label').textContent();
      const beforeCount = await window.locator('.tree-node').count();
      await collapsedDir.click();

      // Wait for children to load (async readdir + re-render)
      await window.waitForTimeout(1000);

      // The same folder (by name) should now show expanded chevron
      const folderNode = window.locator('.tree-node', { hasText: label! }).first();
      await expect(folderNode.locator('.tree-node-chevron')).toHaveText('▾', { timeout: 5000 });

      // More tree nodes should be visible
      const newCount = await window.locator('.tree-node').count();
      expect(newCount).toBeGreaterThan(beforeCount);
    }
  });

  test('clicking an expanded folder collapses it', async ({ window }) => {
    await addWorkspaceFolder(window, wsPath);
    await window.waitForSelector('.tree-node', { timeout: 10_000 });
    // Expand a folder first
    const collapsedDir = window.locator('.tree-node:has(.tree-node-chevron:has-text("▸"))').first();
    const folderLabel = await collapsedDir.locator('.tree-node-label').textContent();
    await collapsedDir.click();
    await window.waitForTimeout(1000);

    // Find the expanded folder by its label
    const expandedFolder = window.locator('.tree-node', { hasText: folderLabel! }).first();
    await expect(expandedFolder.locator('.tree-node-chevron')).toHaveText('▾', { timeout: 5000 });

    const beforeCount = await window.locator('.tree-node').count();

    // Click it to collapse
    await expandedFolder.click();
    await window.waitForTimeout(500);

    // Re-locate by name — chevron should show collapsed
    const collapsedFolder = window.locator('.tree-node', { hasText: folderLabel! }).first();
    await expect(collapsedFolder.locator('.tree-node-chevron')).toHaveText('▸', { timeout: 5000 });

    // Less tree nodes should be visible
    const afterCount = await window.locator('.tree-node').count();
    expect(afterCount).toBeLessThan(beforeCount);
  });

  test('clicking a file opens it in the editor', async ({ window }) => {
    await addWorkspaceFolder(window, wsPath);
    await window.waitForSelector('.tree-node', { timeout: 10_000 });
    // Find a file node (has 📄 icon, not a directory)
    const fileNodes = window.locator('.tree-node:has(.tree-node-icon:has-text("📄"))');
    const count = await fileNodes.count();
    expect(count).toBeGreaterThan(0);

    // Click the first file
    const firstFile = fileNodes.first();
    const fileName = await firstFile.locator('.tree-node-label').textContent();
    await firstFile.click();

    // Wait for an editor tab to appear with the file name
    const tab = window.locator('.editor-tab', { hasText: fileName! });
    await expect(tab).toBeVisible({ timeout: 5000 });

    // The tab should be active
    await expect(tab).toHaveClass(/editor-tab--active/);
  });

  test('double-clicking a file pins it (not preview)', async ({ window }) => {
    await addWorkspaceFolder(window, wsPath);
    await window.waitForSelector('.tree-node', { timeout: 10_000 });
    // Find a file node
    const fileNodes = window.locator('.tree-node:has(.tree-node-icon:has-text("📄"))');
    const count = await fileNodes.count();

    if (count >= 2) {
      // Double-click the second file
      const secondFile = fileNodes.nth(1);
      const fileName = await secondFile.locator('.tree-node-label').textContent();
      await secondFile.dblclick();

      // Tab should appear and NOT be in preview (italic) mode
      const tab = window.locator('.editor-tab', { hasText: fileName! });
      await expect(tab).toBeVisible({ timeout: 5000 });
      // Preview tabs have the class editor-tab--preview; pinned tabs don't
      await expect(tab).not.toHaveClass(/editor-tab--preview/);
    }
  });

  test('selecting a tree node highlights it', async ({ window }) => {
    await addWorkspaceFolder(window, wsPath);
    await window.waitForSelector('.tree-node', { timeout: 10_000 });
    const treeNodes = window.locator('.tree-node');
    const count = await treeNodes.count();

    if (count > 0) {
      const node = treeNodes.first();
      await node.click();

      // Node should have the selected class
      await expect(node).toHaveClass(/tree-node--selected/);
    }
  });
});
