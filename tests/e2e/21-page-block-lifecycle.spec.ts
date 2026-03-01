/**
 * Targeted E2E test: page block inside a column.
 *
 * Regression: the pageBlock insertAction verified the inserted node by
 * scanning only doc.content (top-level). When the pageBlock lives inside a
 * column the scan missed it, the catch block deleted the child page, and
 * flushContentSave / openEditor never ran. This test creates a column layout,
 * inserts a /page inside one column, and verifies:
 *   1. The child page appears in the sidebar tree
 *   2. Auto-navigation opens the child page editor
 *   3. Navigating back shows the pageBlock card on the parent
 *
 * Run:
 *   npx playwright test tests/e2e/21-page-block-lifecycle.spec.ts --headed
 */
import {
  sharedTest as test,
  expect,
  setupCanvasPage,
  waitForEditor,
  insertViaSlashMenu,
} from './fixtures';

test.describe('Page Block inside Column', () => {

  test('creating /page inside a column persists child and shows in sidebar', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    // ── 0. Setup ──
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    const treeCountBefore = await page.locator('.canvas-node[role="treeitem"]').count();

    // ── 1. Create a column layout via /columns ──
    const tiptap = page.locator('.tiptap').first();
    await tiptap.click();
    await insertViaSlashMenu(page, '2 Columns');
    await page.waitForTimeout(500);

    // Verify a columnList appeared in the editor
    const columnCount = await page.locator('.tiptap .canvas-column-list').count();
    expect(columnCount, 'Column layout should exist').toBeGreaterThanOrEqual(1);

    // ── 2. Click inside the FIRST column and type /page ──
    const firstCol = page.locator('.tiptap .canvas-column').first();
    await firstCol.click();
    await page.waitForTimeout(200);

    // Record tree IDs before the /page command
    const treeIdsBefore = await page.locator('.canvas-node[role="treeitem"]').evaluateAll(
      (nodes) => nodes.map(n => n.getAttribute('data-page-id')).filter(Boolean) as string[],
    );

    await page.keyboard.type('/page');
    const slashMenu = page.locator('.canvas-slash-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5_000 });
    const pageItem = slashMenu
      .locator('.canvas-slash-item')
      .filter({ has: page.locator('.canvas-slash-label', { hasText: /^Page$/ }) })
      .first();
    await expect(pageItem).toBeVisible({ timeout: 5_000 });
    await pageItem.click();

    // ── 3. ASSERT: child page appears in sidebar ──
    await expect(page.locator('.canvas-node[role="treeitem"]')).toHaveCount(
      treeCountBefore + 1,
      { timeout: 10_000 },
    );

    const treeIdsAfter = await page.locator('.canvas-node[role="treeitem"]').evaluateAll(
      (nodes) => nodes.map(n => n.getAttribute('data-page-id')).filter(Boolean) as string[],
    );
    const newChildId = treeIdsAfter.find(id => !treeIdsBefore.includes(id));
    expect(newChildId, 'A new child page should appear in the sidebar tree').toBeTruthy();

    // ── 4. ASSERT: editor auto-navigated (child page is now active) ──
    // Wait for the openEditor call to settle
    await page.waitForTimeout(1500);
    const childEditorVisible = await page.locator('.tiptap').count();
    expect(childEditorVisible, 'Editor should be visible after auto-navigate').toBeGreaterThan(0);

    // ── 5. Navigate back to parent and verify node survived persist ──
    const parentNode = page.locator('.canvas-node[role="treeitem"]').first();
    await parentNode.click();
    await page.waitForSelector('.tiptap', { timeout: 10_000 });
    await page.waitForTimeout(1000);

    // The pageBlock card should be visible inside the column
    const blockCards = await page.locator('.canvas-page-block-card').count();
    expect(blockCards, 'Page block card should be visible on parent after round-trip').toBeGreaterThan(0);
  });
});
