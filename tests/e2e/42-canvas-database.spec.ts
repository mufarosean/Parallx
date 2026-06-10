/**
 * E2E: Canvas database system (Notion-style) — live UI verification.
 *
 * Creates a database from the sidebar's new-page menu, verifies the database
 * editor renders the researched anatomy (title, view tabs, Filter/Sort/New
 * toolbar, table with typed Status column), adds rows, edits a select cell,
 * switches to a board view, and opens a row as a page to see the
 * row-properties section.
 */
import { sharedTest as test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';

async function openCanvasSidebar(page: import('@playwright/test').Page): Promise<void> {
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });
}

test.describe('Canvas Databases', () => {
  test('create database → table view → rows → cells → board → row page', async ({ window, electronApp }) => {
    const workspacePath = await createTestWorkspace();
    test.setTimeout(120_000);
    await openFolderViaMenu(electronApp, window, workspacePath, { force: true });
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
    await expect(window.locator('.canvas-property-bar')).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.canvas-property-row__label', { hasText: 'Status' })).toBeVisible();
    await window.screenshot({ path: 'test-results/db-row-page.png', fullPage: true });

    // ── The database page shows in the sidebar tree (a database IS a page) ──
    await expect(window.locator('.canvas-node', { hasText: 'Untitled database' }).first()).toBeVisible();
  });

  test('legacy property migration: tags + custom values move into databases, backup written, property bar gone', async ({ window, electronApp }) => {
    const workspacePath = await createTestWorkspace();
    test.setTimeout(120_000);
    await openFolderViaMenu(electronApp, window, workspacePath, { force: true });
    await window.waitForTimeout(2000);
    await openCanvasSidebar(window);

    // Create a page and find its id.
    await window.locator('.canvas-sidebar-add-btn').click();
    await window.waitForSelector('.canvas-node', { timeout: 5_000 });
    const pageId = await window.locator('.canvas-node[role="treeitem"]').last().getAttribute('data-page-id');
    expect(pageId).toBeTruthy();

    // The legacy property bar must be GONE from regular pages.
    await window.locator(`.canvas-node[role="treeitem"][data-page-id="${pageId}"]`).first().click();
    await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });
    await expect(window.locator('.canvas-property-bar')).toHaveCount(0);

    // Seed LEGACY property data directly (the pre-database system's tables).
    // Unique ids: the shared test workspace persists across runs, so fixed PKs
    // would silently collide with rows from a previous run.
    await window.evaluate(async (pid) => {
      const db = (window as any).parallxElectron.database;
      const uid = () => `legacy-${Math.random().toString(36).slice(2)}`;
      await db.run(
        "INSERT OR IGNORE INTO property_definitions (name, type, config, sort_order) VALUES ('tags','tags','{\"options\":[{\"value\":\"work\",\"color\":\"rgba(125, 145, 235, 0.30)\"}]}',0)",
      );
      await db.run(
        "INSERT OR IGNORE INTO property_definitions (name, type, config, sort_order) VALUES ('priority','select','{}',1)",
      );
      await db.run(
        `INSERT INTO page_properties (id, page_id, key, value_type, value) VALUES ('${uid()}','${pid}','tags','tags','["work","deep"]')`,
      );
      await db.run(
        `INSERT INTO page_properties (id, page_id, key, value_type, value) VALUES ('${uid()}','${pid}','priority','select','"High"')`,
      );
    }, pageId);

    // Force the migration (support hook; normally runs once at activation).
    await window.evaluate(() => window.dispatchEvent(new CustomEvent('parallx:canvas-run-legacy-migration')));
    await window.waitForTimeout(2500);

    // The Tags + Migrated properties databases exist in the tree.
    await expect(window.locator('.canvas-node', { hasText: 'Tags' }).first()).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.canvas-node', { hasText: 'Migrated properties' }).first()).toBeVisible();

    // The tagged page is a ROW of the Tags database with its tags intact.
    await window.locator('.canvas-node', { hasText: 'Tags' }).first().click();
    const pane = window.locator('.canvas-db-pane');
    await expect(pane).toBeVisible({ timeout: 10_000 });
    await expect(pane.locator('.canvas-db-pill', { hasText: 'work' }).first()).toBeVisible({ timeout: 5_000 });
    await expect(pane.locator('.canvas-db-pill', { hasText: 'deep' }).first()).toBeVisible();

    // The page itself shows its database properties (membership groups).
    await window.locator(`.canvas-node[role="treeitem"][data-page-id="${pageId}"]`).first().click();
    await expect(window.locator('.canvas-property-bar')).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.canvas-prop-tag', { hasText: 'work' }).first()).toBeVisible();
    await window.screenshot({ path: 'test-results/db-migrated-page-panel.png', fullPage: true });

    // "Pages tagged X" popover opens from the pill (M85 parity).
    await window.locator('.canvas-prop-tag', { hasText: 'work' }).first().click();
    await expect(window.locator('.canvas-prop-value-popover')).toBeVisible({ timeout: 5_000 });

    // The backup JSON landed in the workspace.
    const fs = await import('fs/promises');
    const backups = await fs.readdir(`${workspacePath}/.parallx-backups`).catch(() => [] as string[]);
    expect(backups.some((f) => f.startsWith('legacy-properties-'))).toBe(true);
  });

  test('/database slash command creates a nested database with its card at the cursor', async ({ window, electronApp }) => {
    const workspacePath = await createTestWorkspace();
    test.setTimeout(120_000);
    await openFolderViaMenu(electronApp, window, workspacePath, { force: true });
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
