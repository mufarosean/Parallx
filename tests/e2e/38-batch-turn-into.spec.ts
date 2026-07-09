/**
 * E2E: box-select bullet rows → handle click → Turn into → Quote.
 *
 * Reproduces the reported failure "box selecting a set of bullet blocks and
 * turning them into anything else only applies the edit to 1 of them" in the
 * REAL app (unit tests of the menu batch path pass, so the break — if any —
 * lives in the marquee → handle-click → menu handoff that jsdom can't drive).
 *
 * The intermediate assertions bisect the chain:
 *   A. marquee → 3 rows carry .block-selected
 *   B. handle click → selection SURVIVES (guard must preserve multi-select)
 *      and the menu header says "3 blocks selected"
 *   C. Turn into → Quote → all 3 rows become blockquotes
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent } from './fixtures';

test.describe('Batch Turn Into via marquee + handle menu', () => {

  test('all box-selected bullet rows convert to quotes', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    page.on('console', (msg: any) => {
      const text = msg.text();
      if (/DIAG|Canvas|Invariant/i.test(text)) console.log(`  RENDERER: ${text}`);
    });

    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    await setContent(page, [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RowOne' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RowTwo' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RowThree' }] }] },
      ]},
    ]);
    await page.waitForTimeout(400);

    // ── A. Marquee over all three rows ──
    const coords = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')!;
      const pmRect = pm.getBoundingClientRect();
      const lis = pm.querySelectorAll('li');
      const first = lis[0]!.getBoundingClientRect();
      const last = lis[lis.length - 1]!.getBoundingClientRect();
      return {
        startX: pmRect.left + 5,
        startY: first.top + 2,
        endX: pmRect.right - 5,
        endY: last.bottom - 2,
      };
    });

    await page.mouse.move(coords.startX, coords.startY);
    await page.mouse.down();
    await page.mouse.move(coords.startX + 15, coords.startY + 10, { steps: 3 });
    await page.mouse.move(coords.endX, coords.endY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    const selectedAfterMarquee = await page.locator('.block-selected').count();
    console.log(`[BATCH-E2E] selected after marquee: ${selectedAfterMarquee}`);
    expect(selectedAfterMarquee).toBe(3);

    // ── B. Hover the middle row, click its drag handle ──
    const rowTwo = page.locator('.ProseMirror li', { hasText: 'RowTwo' });
    await rowTwo.hover();
    await page.waitForTimeout(200);
    const handle = page.locator('.drag-handle:not(.hide)');
    await expect(handle).toBeVisible({ timeout: 2_000 });
    await handle.click();
    await page.waitForTimeout(250);

    // The selection must SURVIVE the handle click (multi-select preserved).
    const selectedAfterHandleClick = await page.locator('.block-selected').count();
    console.log(`[BATCH-E2E] selected after handle click: ${selectedAfterHandleClick}`);

    const menu = page.locator('.block-action-menu');
    await expect(menu).toBeVisible({ timeout: 2_000 });
    const header = await menu.locator('.block-action-header').textContent();
    console.log(`[BATCH-E2E] menu header: "${header}"`);

    expect(selectedAfterHandleClick).toBe(3);
    expect(header).toContain('3 blocks');

    // ── C. Turn into → Quote ──
    const turnInto = menu.locator('.block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    const submenu = page.locator('.block-action-submenu');
    await expect(submenu).toBeVisible({ timeout: 2_000 });
    const quoteRow = submenu.locator('.block-action-item', { hasText: 'Quote' });
    // Menu rows act on mousedown.
    await quoteRow.dispatchEvent('mousedown');
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')!;
      return {
        quotes: pm.querySelectorAll('blockquote').length,
        listItems: pm.querySelectorAll('li').length,
        text: (pm as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      };
    });
    console.log(`[BATCH-E2E] result:`, JSON.stringify(result));

    expect(result.quotes).toBe(3);
    expect(result.listItems).toBe(0);
    expect(result.text).toContain('RowOne');
    expect(result.text).toContain('RowTwo');
    expect(result.text).toContain('RowThree');
  });

  test('nested selection: parent absorbs children (one highlight, whole subtree converts)', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    await setContent(page, [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'ParentRow' }] },
          { type: 'bulletList', content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ChildOne' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ChildTwo' }] }] },
          ]},
        ]},
      ]},
    ]);
    await page.waitForTimeout(400);

    // Marquee over the parent line AND the nested rows.
    const coords = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')!;
      const pmRect = pm.getBoundingClientRect();
      const lis = pm.querySelectorAll('li');
      const first = lis[0]!.getBoundingClientRect();
      const last = lis[lis.length - 1]!.getBoundingClientRect();
      return {
        startX: pmRect.left + 5,
        startY: first.top + 2,
        endX: pmRect.right - 5,
        endY: last.bottom - 2,
      };
    });
    await page.mouse.move(coords.startX, coords.startY);
    await page.mouse.down();
    await page.mouse.move(coords.startX + 15, coords.startY + 10, { steps: 3 });
    await page.mouse.move(coords.endX, coords.endY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(250);

    // Normalized: ONE selected unit (the parent, whose box spans the subtree)
    // — no stacked "overlap colour" from parent+children double-selection.
    const selected = await page.locator('.block-selected').count();
    console.log(`[BATCH-E2E:nested] selected after marquee: ${selected}`);
    expect(selected).toBe(1);

    // Click a NESTED row's handle — the containment guard must anchor the
    // menu on the selected PARENT, not collapse the selection to the child.
    const childRow = page.locator('.ProseMirror li', { hasText: 'ChildOne' }).last();
    await childRow.hover();
    await page.waitForTimeout(200);
    const handle = page.locator('.drag-handle:not(.hide)');
    await expect(handle).toBeVisible({ timeout: 2_000 });
    await handle.click();
    await page.waitForTimeout(250);

    const menu = page.locator('.block-action-menu');
    await expect(menu).toBeVisible({ timeout: 2_000 });

    const turnInto = menu.locator('.block-action-item', { hasText: 'Turn into' });
    await turnInto.hover();
    const submenu = page.locator('.block-action-submenu');
    await expect(submenu).toBeVisible({ timeout: 2_000 });
    await submenu.locator('.block-action-item', { hasText: 'Quote' }).dispatchEvent('mousedown');
    await page.waitForTimeout(400);

    const result = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')!;
      return {
        quotes: pm.querySelectorAll('blockquote').length,
        text: (pm as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      };
    });
    console.log(`[BATCH-E2E:nested] result:`, JSON.stringify(result));

    // The selected parent (with its whole subtree) became the quote —
    // everything the user visually selected is inside it.
    expect(result.quotes).toBe(1);
    expect(result.text).toContain('ParentRow');
    expect(result.text).toContain('ChildOne');
    expect(result.text).toContain('ChildTwo');
  });
});
