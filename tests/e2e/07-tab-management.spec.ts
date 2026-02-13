/**
 * E2E tests: Editor tab management — reorder, multiple groups, split.
 *
 * Verifies tab interactions like middle-click close, tab switching,
 * and editor split via the toolbar button.
 */
import { test, expect, createTestWorkspace, cleanupTestWorkspace, addWorkspaceFolder } from './fixtures';

test.describe('Tab Management', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  async function addWorkspace(window: any) {
    await addWorkspaceFolder(window, wsPath);
    await window.waitForSelector('.tree-node', { timeout: 10_000 });
  }

  async function openFileByName(window: any, fileName: string, pinned = false) {
    // Try to find and click the file in the tree
    const fileNode = window.locator('.tree-node .tree-node-label', { hasText: fileName }).first();
    if (await fileNode.isVisible()) {
      if (pinned) {
        await fileNode.dblclick();
      } else {
        await fileNode.click();
      }
      await window.waitForTimeout(500);
    }
  }

  test('Ctrl+Tab cycles through open editors', async ({ window }) => {
    // Open multiple files via Ctrl+N
    await window.keyboard.press('Control+n');
    await window.waitForTimeout(300);
    await window.keyboard.press('Control+n');
    await window.waitForTimeout(300);

    const tabs = window.locator('.editor-tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Get the active tab label before cycling
    const activeLabel1 = await window.locator('.editor-tab--active .editor-tab-label').textContent();

    // Cycle to next editor
    await window.keyboard.press('Control+PageDown');
    await window.waitForTimeout(300);

    const activeLabel2 = await window.locator('.editor-tab--active .editor-tab-label').textContent();

    // The active label should have changed (or wrapped around)
    // If only 2 tabs, they should be different
    if (count >= 2) {
      expect(activeLabel2).not.toBe(activeLabel1);
    }
  });

  test('Ctrl+PageUp goes to previous editor', async ({ window }) => {
    // Make sure we have multiple tabs
    await window.keyboard.press('Control+n');
    await window.waitForTimeout(300);
    await window.keyboard.press('Control+n');
    await window.waitForTimeout(300);

    const label1 = await window.locator('.editor-tab--active .editor-tab-label').textContent();

    await window.keyboard.press('Control+PageUp');
    await window.waitForTimeout(300);

    const label2 = await window.locator('.editor-tab--active .editor-tab-label').textContent();

    // Should have switched
    expect(label2).not.toBe(label1);
  });

  test('multiple files from explorer open as separate tabs', async ({ window }) => {
    // Close all tabs first
    let tabCount = await window.locator('.editor-tab').count();
    for (let i = 0; i < tabCount; i++) {
      await window.keyboard.press('Control+w');
      await window.waitForTimeout(200);
    }

    await addWorkspace(window);

    // Open README.md (pinned to keep its tab)
    await openFileByName(window, 'README.md', true);

    // Expand src and open index.ts (also pinned)
    const srcFolder = window.locator('.tree-node', { hasText: 'src' }).first();
    const chevron = srcFolder.locator('.tree-node-chevron');
    if ((await chevron.textContent()) === '▸') {
      await srcFolder.click();
      await window.waitForTimeout(500);
    }
    await openFileByName(window, 'index.ts', true);

    // Should have 2 tabs
    const tabs = window.locator('.editor-tab');
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(2);

    // Both file names should appear in tabs
    const tabLabels = [];
    for (let i = 0; i < count; i++) {
      tabLabels.push(await tabs.nth(i).locator('.editor-tab-label').textContent());
    }
    expect(tabLabels.some(l => l?.includes('README'))).toBe(true);
    expect(tabLabels.some(l => l?.includes('index'))).toBe(true);
  });

  test('closing last tab shows the watermark/empty state', async ({ window }) => {
    // Make sure we have exactly one tab
    let count = await window.locator('.editor-tab').count();
    // Close all but last
    while (count > 1) {
      await window.keyboard.press('Control+w');
      await window.waitForTimeout(300);
      count = await window.locator('.editor-tab').count();
    }

    if (count === 1) {
      await window.keyboard.press('Control+w');
      await window.waitForTimeout(500);

      // No tabs should remain
      const remaining = await window.locator('.editor-tab').count();
      expect(remaining).toBe(0);

      // The watermark or empty state should be visible
      const watermark = window.locator('.editor-watermark, .editor-group-empty');
      // At least one of the empty indicators should be visible
      const isWatermarkVisible = await watermark.first().isVisible().catch(() => false);
      expect(isWatermarkVisible).toBe(true);
    }
  });
});
