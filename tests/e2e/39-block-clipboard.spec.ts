/**
 * E2E: block copy/paste via keyboard — click a block's handle, Ctrl+C,
 * click somewhere else, Ctrl+V → the block is duplicated there.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent } from './fixtures';

test.describe('Block clipboard', () => {

  test('handle-select → Ctrl+C → click elsewhere → Ctrl+V duplicates the block', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'CopyMe' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Middle' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Landing' }] },
    ]);
    await page.waitForTimeout(400);

    // Hover the first paragraph → click its handle (selects + opens menu).
    const copySource = page.locator('.ProseMirror p', { hasText: 'CopyMe' });
    await copySource.hover();
    await page.waitForTimeout(200);
    const handle = page.locator('.drag-handle:not(.hide)');
    await expect(handle).toBeVisible({ timeout: 2_000 });
    await handle.click();
    await page.waitForTimeout(200);

    // Close the action menu; the block selection survives.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
    const selected = await page.locator('.block-selected').count();
    console.log(`[CLIP-E2E] selected before copy: ${selected}`);
    expect(selected).toBe(1);

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);

    // Click into the LAST paragraph (clears block selection, sets the caret).
    await page.locator('.ProseMirror p', { hasText: 'Landing' }).click();
    await page.waitForTimeout(200);

    await page.keyboard.press('Control+v');
    await page.waitForTimeout(300);

    const text = await page.evaluate(() =>
      (document.querySelector('.ProseMirror') as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
    );
    console.log(`[CLIP-E2E] result text: "${text}"`);
    expect(text).toContain('CopyMe Middle Landing CopyMe');
  });

  test('box-select rows → Ctrl+C → Ctrl+V pastes all rows after the selection', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    await setContent(page, [
      { type: 'bulletList', content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RowA' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RowB' }] }] },
      ]},
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ]);
    await page.waitForTimeout(400);

    // Marquee over both rows.
    const coords = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')!;
      const pmRect = pm.getBoundingClientRect();
      const lis = pm.querySelectorAll('li');
      const first = lis[0]!.getBoundingClientRect();
      const last = lis[lis.length - 1]!.getBoundingClientRect();
      return { startX: pmRect.left + 5, startY: first.top + 2, endX: pmRect.right - 5, endY: last.bottom - 2 };
    });
    await page.mouse.move(coords.startX, coords.startY);
    await page.mouse.down();
    await page.mouse.move(coords.startX + 15, coords.startY + 8, { steps: 3 });
    await page.mouse.move(coords.endX, coords.endY, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(await page.locator('.block-selected').count()).toBe(2);

    await page.keyboard.press('Control+c');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => {
      const pm = document.querySelector('.ProseMirror')!;
      return {
        rows: pm.querySelectorAll('li').length,
        text: (pm as HTMLElement).innerText.replace(/\s+/g, ' ').trim(),
      };
    });
    console.log(`[CLIP-E2E] rows result:`, JSON.stringify(result));
    expect(result.rows).toBe(4);
    expect(result.text).toContain('RowA RowB RowA RowB After');
  });
});
