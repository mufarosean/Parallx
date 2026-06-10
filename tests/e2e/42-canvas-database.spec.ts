/**
 * E2E: Canvas database system (Notion-style) — live UI verification.
 *
 * Creates a database from the sidebar's new-page menu, verifies the database
 * editor renders the researched anatomy (title, view tabs, Filter/Sort/New
 * toolbar, table with typed Status column), adds rows, edits a select cell,
 * switches to a board view, and opens a row as a page to see the
 * row-properties section.
 */
import { sharedTest as test, expect, openFolderViaMenu } from './fixtures';

async function openCanvasSidebar(page: import('@playwright/test').Page): Promise<void> {
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });
}

test.describe('Canvas Databases', () => {
  test('create database → table view → rows → cells → board → row page', async ({ window, electronApp, workspacePath }) => {
    test.setTimeout(120_000);
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);
    await openCanvasSidebar(window);

    // ── Create a database from the sidebar's new-page options menu ──
    await window.locator('.canvas-sidebar-add-menu-btn').click();
    await window.locator('.canvas-sidebar-add-popover-item', { hasText: 'Database' }).click();

    // The database editor opens: header, tabs, toolbar, table.
    const pane = window.locator('.canvas-db-pane');
    await expect(pane).toBeVisible({ timeout: 10_000 });
    await expect(pane.locator('.canvas-db-header__title')).toHaveText('Untitled database');
    await expect(pane.locator('.canvas-db-tab--active')).toContainText('Table');
    await expect(pane.locator('.canvas-db-newbtn')).toHaveText('New');
    // Seeded schema: Name + Status columns.
    await expect(pane.locator('.canvas-db-th', { hasText: 'Name' })).toBeVisible();
    await expect(pane.locator('.canvas-db-th', { hasText: 'Status' })).toBeVisible();

    // ── Add two rows via the + New row ──
    await pane.locator('.canvas-db-newrow__cell').click();
    await expect(pane.locator('.canvas-db-row')).toHaveCount(1, { timeout: 5_000 });
    await pane.locator('.canvas-db-newrow__cell').click();
    await expect(pane.locator('.canvas-db-row')).toHaveCount(2, { timeout: 5_000 });

    // ── Set the first row's Status via the select cell editor ──
    const firstStatusCell = pane.locator('.canvas-db-row').first().locator('.canvas-db-cell').nth(1);
    await firstStatusCell.locator('.canvas-db-cell__value').click();
    // The shared select editor renders a pill button; clicking it opens the
    // options dropdown; pick "Done".
    await firstStatusCell.locator('.canvas-prop-select').click();
    await window.locator('.canvas-prop-select-dropdown >> text=Done').first().click();
    await expect(pane.locator('.canvas-db-pill', { hasText: 'Done' }).first()).toBeVisible({ timeout: 5_000 });

    await window.screenshot({ path: 'test-results/db-table-view.png', fullPage: true });

    // ── Add a Board view and verify grouped columns ──
    await pane.locator('.canvas-db-tab--add').click();
    await window.locator('.canvas-db-menuitem', { hasText: 'Board' }).click();
    await expect(pane.locator('.canvas-db-board')).toBeVisible({ timeout: 5_000 });
    // Status options become board columns; the Done column holds our card.
    const doneCol = pane.locator('.canvas-db-board__col').filter({ has: window.locator('.canvas-db-pill', { hasText: 'Done' }) });
    await expect(doneCol.locator('.canvas-db-card')).toHaveCount(1);
    await window.screenshot({ path: 'test-results/db-board-view.png', fullPage: true });

    // ── Open a row as a page: the row-properties section renders ──
    await pane.locator('.canvas-db-tab', { hasText: 'Table' }).first().click();
    const firstRow = pane.locator('.canvas-db-row').first();
    await firstRow.hover();
    await firstRow.locator('.canvas-db-openbtn').click();
    await expect(window.locator('.canvas-db-rowprops')).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.canvas-db-rowprops__name', { hasText: 'Status' })).toBeVisible();
    await window.screenshot({ path: 'test-results/db-row-page.png', fullPage: true });

    // ── The database page shows in the sidebar tree (a database IS a page) ──
    await expect(window.locator('.canvas-node', { hasText: 'Untitled database' }).first()).toBeVisible();
  });

  test('/database slash command creates a nested database with its card at the cursor', async ({ window, electronApp, workspacePath }) => {
    test.setTimeout(120_000);
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);
    await openCanvasSidebar(window);

    // Create + open a regular page (remember its id — the tree will gain the
    // nested database node after the slash).
    const idsBefore = await window.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-page-id')).filter((id): id is string => !!id));
    await window.locator('.canvas-sidebar-add-btn').click();
    await window.waitForSelector('.canvas-node', { timeout: 5_000 });
    const idsAfter = await window.locator('.canvas-node[role="treeitem"]').evaluateAll((nodes) =>
      nodes.map((n) => n.getAttribute('data-page-id')).filter((id): id is string => !!id));
    const parentId = idsAfter.find((id) => !idsBefore.includes(id)) ?? idsAfter[idsAfter.length - 1];
    await window.locator(`.canvas-node[role="treeitem"][data-page-id="${parentId}"]`).first().click();
    await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });

    // Slash /database.
    const tiptap = window.locator('.tiptap').first();
    await tiptap.click();
    await window.keyboard.type('/database');
    const item = window.locator('.canvas-slash-item', { hasText: 'Database' }).first();
    await expect(item).toBeVisible({ timeout: 5_000 });
    await item.click();

    // The database editor opens (table view with the seeded schema)…
    await expect(window.locator('.canvas-db-pane')).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.canvas-db-th', { hasText: 'Status' })).toBeVisible();

    // …and the parent page got the database card at the cursor.
    await window.locator(`.canvas-node[role="treeitem"][data-page-id="${parentId}"]`).first().click();
    await expect(window.locator('.canvas-page-block')).toBeVisible({ timeout: 10_000 });
  });
});
