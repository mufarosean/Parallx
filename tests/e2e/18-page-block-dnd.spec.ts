import { test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';
import type { Page, ElectronApplication } from '@playwright/test';

async function setupCanvasPage(page: Page, electronApp: ElectronApplication, wsPath: string): Promise<void> {
  await openFolderViaMenu(electronApp, page, wsPath);
  await page.waitForTimeout(1500);

  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) {
    await canvasBtn.click();
  }

  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });
  await page.locator('.canvas-sidebar-add-btn').click();
  await page.waitForSelector('.canvas-node[role="treeitem"]', { timeout: 10_000 });
  await page.locator('.canvas-node[role="treeitem"]').first().click();
  await page.waitForSelector('.tiptap', { timeout: 10_000 });
  await page.waitForFunction(() => (window as any).__tiptapEditor != null, { timeout: 10_000 });
  await page.waitForTimeout(300);
}

async function dragParagraphToPageBlock(page: Page, paragraphText: string): Promise<void> {
  const paragraph = page.locator('.tiptap p', { hasText: paragraphText }).first();
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.hover({ force: true });
  await page.waitForTimeout(150);

  const handle = page.locator('.drag-handle');
  await expect(handle).toBeVisible({ timeout: 5_000 });
  const handleBox = await handle.boundingBox();
  const targetBox = await page.locator('.canvas-page-block-card').first().boundingBox();

  if (!handleBox || !targetBox) throw new Error('Missing drag handle or page block target bounds');

  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;

  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(tx, ty, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(450);
}

test.describe('Page Block Drag-Drop', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  test('dropping a paragraph onto page block performs true move (no duplicate left in parent)', async ({ window: page, electronApp }) => {
    await setupCanvasPage(page, electronApp, wsPath);

    const rootIdsBefore = await page.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-page-id'))
        .filter((id): id is string => !!id),
    );

    // Create a deterministic parent page at root.
    await page.locator('.canvas-sidebar-add-btn').click();
    await page.waitForTimeout(300);

    const rootIdsAfter = await page.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-page-id'))
        .filter((id): id is string => !!id),
    );

    const parentPageId = rootIdsAfter.find((id) => !rootIdsBefore.includes(id)) ?? rootIdsAfter[rootIdsAfter.length - 1];
    expect(parentPageId).toBeTruthy();

    await page.locator(`.canvas-node[role="treeitem"][data-page-id="${parentPageId}"]`).first().click();
    await page.waitForSelector('.tiptap', { timeout: 10_000 });

    // Create embedded subpage via slash command in this parent page.
    const treeIdsBeforeSlash = await page.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-page-id'))
        .filter((id): id is string => !!id),
    );
    const treeCountBeforeSlash = treeIdsBeforeSlash.length;

    const tiptap = page.locator('.tiptap').first();
    await tiptap.click();
    await page.keyboard.type('/page');
    const slashMenu = page.locator('.canvas-slash-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5_000 });
    const pageItem = slashMenu.locator('.canvas-slash-item').filter({ has: page.locator('.canvas-slash-label', { hasText: /^Page$/ }) }).first();
    await expect(pageItem).toBeVisible({ timeout: 5_000 });
    await pageItem.click();
    await expect(page.locator('.tiptap p', { hasText: '/page' })).toHaveCount(0, { timeout: 5_000 });
    await expect(page.locator('.canvas-node[role="treeitem"]')).toHaveCount(treeCountBeforeSlash + 1, { timeout: 10_000 });

    const treeIdsAfterSlash = await page.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-page-id'))
        .filter((id): id is string => !!id),
    );
    const childPageId = treeIdsAfterSlash.find((id) => !treeIdsBeforeSlash.includes(id));
    expect(childPageId).toBeTruthy();

    // Re-open parent page (slash action auto-opens child).
    await page.locator(`.canvas-node[role="treeitem"][data-page-id="${parentPageId}"]`).first().click();
    await page.waitForSelector('.canvas-page-block-card', { timeout: 10_000 });

    // Guard against stale '/page' autosave overwrite: wait for debounce flush and re-open parent.
    await page.waitForTimeout(1200);
    await page.locator('.canvas-page-block-card').first().click();
    await page.waitForSelector('.tiptap', { timeout: 10_000 });
    await page.locator(`.canvas-node[role="treeitem"][data-page-id="${parentPageId}"]`).first().click();
    await page.waitForSelector('.canvas-page-block-card', { timeout: 10_000 });
    await expect(page.locator('.tiptap p', { hasText: '/page' })).toHaveCount(0);

    // Add a source paragraph block we will drag into the embedded page block.
    await tiptap.click();
    await page.keyboard.type('Move Source Block');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Tail Block');
    await page.waitForTimeout(300);

    const parentBeforeBytes = await page.screenshot({ fullPage: false });

    await dragParagraphToPageBlock(page, 'Move Source Block');

    // Verify source block was removed from parent page (true move, not copy).
    await expect(page.locator('.tiptap p', { hasText: 'Move Source Block' })).toHaveCount(0);
    await expect(page.locator('.tiptap p', { hasText: 'Tail Block' })).toHaveCount(1);

    // Open embedded child page and verify moved block now exists there.
    await page.locator('.canvas-page-block-card').first().click();
    await page.waitForSelector('.tiptap', { timeout: 10_000 });
    await expect(page.locator('.tiptap p', { hasText: 'Move Source Block' })).toHaveCount(1, { timeout: 10_000 });

    // Return to parent and capture post-move state there as well.
    await page.locator(`.canvas-node[role="treeitem"][data-page-id="${parentPageId}"]`).first().click();
    await page.waitForSelector('.tiptap', { timeout: 10_000 });
    const parentAfterBytes = await page.screenshot({ fullPage: false });
    expect(parentBeforeBytes.equals(parentAfterBytes)).toBe(false);

    await expect(page.locator('.tiptap p', { hasText: 'Move Source Block' })).toHaveCount(0);
  });
});
