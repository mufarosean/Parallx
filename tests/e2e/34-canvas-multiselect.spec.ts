/**
 * Canvas sidebar — multi-select regression spec (M81 P12).
 *
 * Verifies: shift-click extends selection, ctrl-click toggles, Delete key
 * bulk-archives, plain click clears the multi-selection. Catches the
 * obvious wiring regressions (anchor never set, click handler ignored,
 * selection class not applied, Delete using single-page wording).
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor } from './fixtures';
import type { Page } from '@playwright/test';

async function createPages(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    // The sidebar page-menu popup from a prior page creation can intercept
    // pointer events. Dismiss it first so the + button is clickable.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    await page.locator('.canvas-sidebar-add-btn').click({ force: true });
    const ctxMenu = page.locator('.context-menu');
    try {
      await ctxMenu.waitFor({ state: 'visible', timeout: 800 });
      await ctxMenu.locator('.context-menu-item', { hasText: 'New Page' }).click({ timeout: 3_000 });
    } catch { /* no menu */ }
    await page.waitForTimeout(200);
    // Dismiss the page-rename popup that auto-opens for the new page.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
  }
}

async function untitledRows(page: Page) {
  return page.locator('.canvas-tree-list .canvas-node[data-page-id]').filter({
    has: page.locator('.canvas-node-label', { hasText: /Untitled/i }),
  });
}

test.describe('Canvas sidebar multi-select', () => {

  test('shift-click extends, Delete archives the range', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    // setupCanvasPage already created one page; add three more so we have
    // at least four "Untitled" rows in the sidebar.
    await createPages(page, 3);
    await page.waitForTimeout(300);

    const rows = await untitledRows(page);
    const totalUntitled = await rows.count();
    expect(totalUntitled).toBeGreaterThanOrEqual(3);

    // Plain-click the first row to set the anchor.
    await rows.nth(0).click();
    await page.waitForTimeout(150);

    // Shift-click the third row.
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(150);

    // Three rows should now be highlighted.
    const highlighted = await page.locator('.canvas-tree-list .canvas-node--multi-selected').count();
    expect(highlighted).toBe(3);

    // Visual sanity check — the highlight must be *visible*, not just
    // a class with a transparent computed background. The first ship
    // missed this because the CSS variable I used was undefined.
    const computed = await rows.nth(1).evaluate((el) => {
      const cs = window.getComputedStyle(el);
      return { bg: cs.backgroundColor, shadow: cs.boxShadow };
    });
    expect(computed.bg).not.toBe('rgba(0, 0, 0, 0)');
    expect(computed.bg).not.toBe('transparent');

    // Capture a screenshot so we can eyeball the visualization.
    await page.screenshot({ path: 'test-results/canvas-diagnostic/multiselect-highlight.png', fullPage: false });

    // The plain-click target also keeps `.canvas-node--selected` (it's the
    // current editor page). That class should still be present on at least
    // one row — separate from the multi-select highlight.
    const activeSelected = await page.locator('.canvas-tree-list .canvas-node--selected').count();
    expect(activeSelected).toBeGreaterThanOrEqual(1);

    // Production code focuses the tree list on shift/ctrl click so the
    // tree's keydown handler receives Delete.
    await page.keyboard.press('Delete');

    // Click the "Move N to Trash" button in the notification toast.
    const confirmBtn = page.locator('.parallx-notification-action-btn', { hasText: /Move .* to Trash/i });
    await confirmBtn.first().waitFor({ state: 'visible', timeout: 5_000 });
    await confirmBtn.first().click();
    await page.waitForTimeout(500);

    const remaining = await (await untitledRows(page)).count();
    expect(remaining).toBe(totalUntitled - 3);
    expect(await page.locator('.canvas-tree-list .canvas-node--multi-selected').count()).toBe(0);
  });

  test('ctrl-click toggles individual rows', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await createPages(page, 2);
    await page.waitForTimeout(300);

    const rows = await untitledRows(page);
    await rows.nth(0).click();
    await page.waitForTimeout(100);

    const ctrlKey = process.platform === 'darwin' ? 'Meta' : 'Control';
    await rows.nth(2).click({ modifiers: [ctrlKey] });
    await page.waitForTimeout(100);

    // Anchor (0) is not added by ctrl-click. Only the ctrl-clicked row is in
    // the set. The plain-clicked row #0 is the active page (open in editor)
    // but NOT part of the multi-selection.
    const highlighted = await page.locator('.canvas-tree-list .canvas-node--multi-selected').count();
    expect(highlighted).toBe(1);

    // Ctrl-click the same row again → toggles off.
    await rows.nth(2).click({ modifiers: [ctrlKey] });
    await page.waitForTimeout(100);
    expect(await page.locator('.canvas-tree-list .canvas-node--multi-selected').count()).toBe(0);
  });

  test('bulk-delete prompt renders as a proper modal (screenshot)', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await createPages(page, 3);
    await page.waitForTimeout(300);

    const rows = await untitledRows(page);
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(150);

    // Open the bulk-delete confirm but DON'T dismiss it — we want to
    // snapshot the dialog itself.
    await page.keyboard.press('Delete');
    await page.locator('.parallx-notification--prompt').waitFor({ state: 'visible', timeout: 5_000 });
    await page.waitForTimeout(200);

    await page.screenshot({ path: 'test-results/canvas-diagnostic/bulk-delete-prompt.png', fullPage: false });

    // Verify visual hierarchy: at least one primary (danger) button and
    // one secondary cancel button.
    const danger = await page.locator('.parallx-notification-action-btn--danger').count();
    const secondary = await page.locator('.parallx-notification-action-btn--secondary').count();
    expect(danger).toBeGreaterThanOrEqual(1);
    expect(secondary).toBeGreaterThanOrEqual(1);

    // Backdrop should be present and clickable as a dismissal target.
    const backdrop = page.locator('.parallx-notification-prompts-container');
    await expect(backdrop).toBeVisible();

    // Cancel out cleanly.
    await page.locator('.parallx-notification-action-btn--secondary').click();
    await page.waitForTimeout(200);
  });

  test('plain click clears the multi-selection', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await createPages(page, 2);
    await page.waitForTimeout(300);

    const rows = await untitledRows(page);
    await rows.nth(0).click();
    await rows.nth(2).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(150);
    expect(await page.locator('.canvas-tree-list .canvas-node--multi-selected').count()).toBe(3);

    // Plain click on a different row clears multi-selection.
    await rows.nth(1).click();
    await page.waitForTimeout(150);
    expect(await page.locator('.canvas-tree-list .canvas-node--multi-selected').count()).toBe(0);
  });

  test('shift-click between two Untitleds in PAGES selects every page in the range', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await createPages(page, 8);
    await page.waitForTimeout(400);

    // Snapshot the IDs of every Untitled rendered in the PAGES section
    // (the one we care about — NOT recents/favorites). Use a structural
    // probe: the PAGES section's section element wraps these rows.
    const pagesSectionIds = await page.evaluate(() => {
      // The PAGES section header has class canvas-sidebar-section-header
      // and contains a label with text "PAGES". Walk to its sibling
      // canvas-tree (or whatever holds rows). The simplest stable probe:
      // get every .canvas-node with data-page-id that is NOT inside a
      // .canvas-sidebar-favorites and NOT inside a recents section.
      const rows = document.querySelectorAll('.canvas-tree-list .canvas-node[data-page-id]');
      const inFavorites = (el: Element) => el.closest('.canvas-sidebar-favorites') != null;
      const inRecents = (el: Element) => el.closest('.canvas-sidebar-recent, .canvas-recent-section') != null
        || el.classList.contains('canvas-recent-node');
      const inMainPages = (el: Element) => !inFavorites(el) && !inRecents(el);
      return Array.from(rows)
        .filter((el) => /Untitled/i.test(el.textContent || '') && inMainPages(el))
        .map((el) => (el as HTMLElement).dataset.pageId ?? '');
    });
    console.log(`PAGES-section Untitled count: ${pagesSectionIds.length}`);
    expect(pagesSectionIds.length).toBeGreaterThanOrEqual(5);

    // Click the first PAGES-section Untitled, then shift-click the last.
    // CRITICAL: the same page ID can render in both RECENT and PAGES
    // sections. We need to click the SPECIFIC copy that's in PAGES (the
    // section under the "Pages" header). The PAGES copies are inside
    // a different subtree than RECENT/FAVORITES; we restrict the
    // locator with :not() against the recents/favorites containers.
    const firstId = pagesSectionIds[0];
    const lastId = pagesSectionIds[pagesSectionIds.length - 1];
    const pagesRowFor = (id: string) =>
      page.locator(`.canvas-tree-list .canvas-node[data-page-id="${id}"]:not(.canvas-recent-node)`)
        .filter({ visible: true })
        .filter({ hasNot: page.locator('xpath=ancestor::*[contains(@class, "canvas-sidebar-favorites")]') })
        .last();

    await pagesRowFor(firstId).click();
    await page.waitForTimeout(200);
    await pagesRowFor(lastId).click({ modifiers: ['Shift'] });
    await page.waitForTimeout(250);

    // Diagnostic: how does the same page ID appear in multiple sections?
    const diag = await page.evaluate(({ firstId, lastId }) => {
      const allRows = Array.from(document.querySelectorAll<HTMLElement>('.canvas-tree-list .canvas-node[data-page-id]'));
      const allIds = allRows.map(el => el.dataset.pageId ?? '');
      const firstOccurrences = allIds.reduce<Record<string, number>>((acc, id) => { if (acc[id] === undefined) acc[id] = 0; acc[id]++; return acc; }, {});
      const dups = Object.entries(firstOccurrences).filter(([, n]) => n > 1).length;
      const anchorPositions = allIds.map((id, i) => id === firstId ? i : -1).filter(i => i >= 0);
      const targetPositions = allIds.map((id, i) => id === lastId ? i : -1).filter(i => i >= 0);
      return {
        totalRows: allIds.length,
        uniqueIds: Object.keys(firstOccurrences).length,
        duplicatedIds: dups,
        anchorIdPositions: anchorPositions,
        targetIdPositions: targetPositions,
      };
    }, { firstId, lastId });
    console.log('diag:', JSON.stringify(diag));

    // Dump every multi-selected ID for diagnosis.
    const highlightedIds = await page.evaluate(() => {
      const els = document.querySelectorAll('.canvas-tree-list .canvas-node--multi-selected');
      return Array.from(els).map((el) => (el as HTMLElement).dataset.pageId ?? '');
    });
    console.log(`highlighted count: ${highlightedIds.length}`);
    console.log(`PAGES-section IDs expected highlighted: ${pagesSectionIds.length}`);
    const missing = pagesSectionIds.filter((id) => !highlightedIds.includes(id));
    if (missing.length > 0) {
      console.log(`MISSING from highlight: ${missing.length} IDs`);
      console.log(`First missing index in pagesSectionIds: ${pagesSectionIds.indexOf(missing[0])}`);
    }

    // Assert: every PAGES-section Untitled in the range must be highlighted.
    expect(missing).toEqual([]);
  });
});
