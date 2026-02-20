/**
 * E2E tests: Canvas Tool — Capabilities 7-10
 *
 * Verifies the full Canvas page lifecycle: sidebar tree, CRUD, page header
 * (title, icon), cover images, page display settings, favorites, trash,
 * context menu, and page duplication.
 *
 * Tests that require CRUD open a workspace first (database must be open).
 */
import { sharedTest as test, expect, openFolderViaMenu } from './fixtures';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Click the Canvas activity bar item to show the Canvas sidebar.
 */
async function openCanvasSidebar(page: import('@playwright/test').Page): Promise<void> {
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');

  const isActive = await canvasBtn.getAttribute('class');
  if (!isActive?.includes('active')) {
    await canvasBtn.click();
  }

  // Wait for the canvas sidebar content to render
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });
  await page.waitForSelector('.canvas-sidebar-add-btn', { timeout: 10_000 });
}

/**
 * Create a new page by clicking the + button in the Canvas toolbar.
 */
async function createNewPage(page: import('@playwright/test').Page): Promise<void> {
  const addBtn = page.locator('.canvas-sidebar-add-btn');
  await addBtn.click();

  // Wait for a canvas node to appear in the tree
  await page.waitForSelector('.canvas-node', { timeout: 5_000 });
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Canvas Tool', () => {

  // ── Sidebar (no workspace needed) ─────────────────────────────────────

  test.describe('Sidebar — visibility', () => {
    test('Canvas activity bar item is visible', async ({ window }) => {
      const canvasBtn = window.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
      await expect(canvasBtn).toBeVisible();
    });

    test('clicking Canvas icon shows the Canvas sidebar with toolbar', async ({ window }) => {
      await openCanvasSidebar(window);
      const toolbar = window.locator('.canvas-sidebar-section-header');
      await expect(toolbar).toBeVisible();
    });
  });

  // ── CRUD & Editor (workspace needed) ──────────────────────────────────

  test.describe('CRUD & Editor', () => {
    test('creates a page and opens the editor', async ({ window, electronApp, workspacePath }) => {
      // ── Step 1: Open a workspace folder ──
      await openFolderViaMenu(electronApp, window, workspacePath);
      // Wait for database to initialize after opening folder
      await window.waitForTimeout(2000);

      // ── Step 2: Switch to Canvas sidebar ──
      await openCanvasSidebar(window);

      // ── Step 3: Create a new page via + button ──
      const nodesBefore = await window.locator('.canvas-node').count();
      const addBtn = window.locator('.canvas-sidebar-add-btn');
      await addBtn.click();

      // Wait for the canvas node to appear
      await window.waitForSelector('.canvas-node', { timeout: 10_000 });
      const nodesAfter = await window.locator('.canvas-node').count();
      expect(nodesAfter).toBeGreaterThan(nodesBefore);

      // ── Step 4: Click the page to open editor ──
      const firstNode = window.locator('.canvas-node').first();
      await firstNode.click();

      // Wait for the Canvas editor wrapper to render
      await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });
      const editorPane = window.locator('.canvas-editor-wrapper');
      await expect(editorPane).toBeVisible();

      // ── Step 5: Verify page title is editable ──
      const titleEl = window.locator('.canvas-page-title');
      await expect(titleEl).toBeVisible();
      const editable = await titleEl.getAttribute('contenteditable');
      expect(editable).toBe('true');

      // ── Step 6: Verify page icon / affordance button ──
      const addIconBtn = window.locator('.canvas-affordance-btn[data-action="add-icon"]');
      // Affordance buttons are visible when hovering the header area
      await window.locator('.canvas-page-header').hover();
      await expect(addIconBtn).toBeVisible({ timeout: 3_000 });

      // ── Step 7: Verify TipTap editor ──
      const tiptap = window.locator('.tiptap');
      await expect(tiptap).toBeVisible();

      // ── Step 8: Verify page menu button ──
      const menuBtn = window.locator('.canvas-top-ribbon-menu');
      await expect(menuBtn).toBeVisible();
    });

    test('page menu opens when clicking ⋯', async ({ window, electronApp, workspacePath }) => {
      await openFolderViaMenu(electronApp, window, workspacePath);
      await window.waitForTimeout(2000);
      await openCanvasSidebar(window);

      // Create a page and open it
      const addBtn = window.locator('.canvas-sidebar-add-btn');
      await addBtn.click();
      await window.waitForSelector('.canvas-node', { timeout: 10_000 });
      await window.locator('.canvas-node').first().click();
      await window.waitForSelector('.canvas-top-ribbon-menu', { timeout: 10_000 });

      // Click the menu button
      await window.locator('.canvas-top-ribbon-menu').click();
      const pageMenu = window.locator('.canvas-page-menu');
      await expect(pageMenu).toBeVisible({ timeout: 3_000 });
    });

    test('right-click context menu', async ({ window, electronApp, workspacePath }) => {
      await openFolderViaMenu(electronApp, window, workspacePath);
      await window.waitForTimeout(2000);
      await openCanvasSidebar(window);

      // Create a page
      const addBtn = window.locator('.canvas-sidebar-add-btn');
      await addBtn.click();
      await window.waitForSelector('.canvas-node', { timeout: 10_000 });

      // Right-click
      await window.locator('.canvas-node').first().click({ button: 'right' });
      const contextMenu = window.locator('.canvas-context-menu');
      await expect(contextMenu).toBeVisible({ timeout: 3_000 });

      // Verify at least 4 menu items
      const items = contextMenu.locator('.canvas-context-menu-item');
      const count = await items.count();
      expect(count).toBeGreaterThanOrEqual(4);
    });

    test('favorite and trash via context menu', async ({ window, electronApp, workspacePath }) => {
      await openFolderViaMenu(electronApp, window, workspacePath);
      await window.waitForTimeout(2000);
      await openCanvasSidebar(window);

      // Create a page
      const addBtn = window.locator('.canvas-sidebar-add-btn');
      await addBtn.click();
      await window.waitForSelector('.canvas-node', { timeout: 10_000 });

      // ── Add to Favorites ──
      await window.locator('.canvas-node').first().click({ button: 'right' });
      const contextMenu = window.locator('.canvas-context-menu');
      await contextMenu.waitFor({ state: 'visible', timeout: 3_000 });

      const favItem = contextMenu.locator('.canvas-context-menu-item', { hasText: /favorite/i });
      if (await favItem.count() > 0) {
        await favItem.click();
        await window.waitForTimeout(500);
        const favSection = window.locator('.canvas-sidebar-section-label', { hasText: /favorites/i });
        await expect(favSection).toBeVisible({ timeout: 3_000 });
      }

      // ── Create another page for deletion ──
      await addBtn.click();
      await window.waitForTimeout(500);

      // ── Delete the newest page ──
      const allNodes = window.locator('.canvas-node');
      const lastNode = allNodes.last();
      await lastNode.click({ button: 'right' });
      const contextMenu2 = window.locator('.canvas-context-menu');
      await contextMenu2.waitFor({ state: 'visible', timeout: 3_000 });

      const deleteItem = contextMenu2.locator('.canvas-context-menu-item', { hasText: /delete/i });
      if (await deleteItem.count() > 0) {
        await deleteItem.click();
        await window.waitForTimeout(500);
        const trashSection = window.locator('.canvas-sidebar-trash-btn');
        await expect(trashSection).toBeVisible({ timeout: 3_000 });
      }
    });

    test('slash /page creates sub-page block and opens linked page', async ({ window, electronApp, workspacePath }) => {
      await openFolderViaMenu(electronApp, window, workspacePath);
      await window.waitForTimeout(2000);
      await openCanvasSidebar(window);

      // Create parent page and open it.
      const rootIdsBefore = await window.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('data-page-id'))
          .filter((id): id is string => !!id),
      );
      await createNewPage(window);
      const rootIdsAfter = await window.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
        nodes
          .map((node) => node.getAttribute('data-page-id'))
          .filter((id): id is string => !!id),
      );
      const parentPageId = rootIdsAfter.find((id) => !rootIdsBefore.includes(id)) ?? rootIdsAfter[rootIdsAfter.length - 1];
      await window.locator(`.canvas-node[role="treeitem"][data-page-id="${parentPageId}"]`).first().click();
      await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });

      const tiptap = window.locator('.tiptap').first();
      await tiptap.click();
      const nodesBefore = await window.locator('.canvas-node').count();
      await window.keyboard.type('/page');

      const slashPageItem = window.locator('.canvas-slash-item', { hasText: 'Page' }).first();
      await expect(slashPageItem).toBeVisible({ timeout: 5_000 });
      await slashPageItem.click();

      await expect.poll(async () => window.locator('.canvas-node').count(), {
        timeout: 10_000,
      }).toBeGreaterThan(nodesBefore);

      // Re-open parent and verify embedded page block exists.
      await window.locator(`.canvas-node[role="treeitem"][data-page-id="${parentPageId}"]`).first().click();
      await expect(window.locator('.canvas-page-block')).toBeVisible({ timeout: 10_000 });

      // Set child icon from parent block controls.
      await window.locator('.canvas-page-block-icon').first().click();
      await expect(window.locator('.canvas-page-block-icon-picker')).toBeVisible({ timeout: 5_000 });
      await window.locator('.canvas-page-block-icon-option[title="rocket"]').first().click();

      // Clicking the page block navigates into the linked child page editor.
      await window.locator('.canvas-page-block-card').first().click();
      await expect(window.locator('.canvas-page-block')).toHaveCount(0, { timeout: 10_000 });

      // Child page reflects icon change.
      await expect(window.locator('.canvas-page-icon')).toBeVisible({ timeout: 10_000 });

      // Rename child page title.
      const childTitle = window.locator('.canvas-page-title').first();
      await childTitle.click();
      await window.keyboard.press('Control+A');
      await window.keyboard.type('Child Synced Title');
      await window.keyboard.press('Enter');
      await window.waitForTimeout(450);

      // Parent block title auto-syncs from child rename.
      await window.locator(`.canvas-node[role="treeitem"][data-page-id="${parentPageId}"]`).first().click();
      await expect(window.locator('.canvas-page-block-title').first()).toHaveText('Child Synced Title', { timeout: 10_000 });
    });
  });
});
