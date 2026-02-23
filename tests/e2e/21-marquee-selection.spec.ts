/**
 * E2E tests: Marquee (lasso) block selection.
 *
 * Verifies the Notion-style drag-to-select:
 *   1. Click-drag on empty canvas space draws a selection box.
 *   2. Blocks overlapping the box receive `.block-selected` class on mouseup.
 *   3. Clicking empty space afterward clears the selection.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent } from './fixtures';

// Helper: get viewport coordinates that are safe for marquee dragging.
// Uses PM's left padding area (64px) as the X start to ensure
// _isBackgroundTarget matches the ProseMirror element.
async function getMarqueeCoords(page: any, blockIndices: { first: number; last: number }) {
  return page.evaluate(({ first, last }: { first: number; last: number }) => {
    const pm = document.querySelector('.ProseMirror');
    if (!pm) throw new Error('No ProseMirror element');
    const pmRect = pm.getBoundingClientRect();
    const blocks = pm.children;
    const firstBlock = blocks[first] as HTMLElement;
    const lastBlock = blocks[last] as HTMLElement;
    if (!firstBlock || !lastBlock) throw new Error(`Block ${first} or ${last} not found (${blocks.length} total)`);
    const firstRect = firstBlock.getBoundingClientRect();
    const lastRect = lastBlock.getBoundingClientRect();
    return {
      // Start: in PM's left padding, vertically just inside first target block
      startX: pmRect.left + 5,
      startY: firstRect.top + 2,
      // End: in PM's right padding, vertically just inside last target block
      endX: pmRect.right - 5,
      endY: lastRect.bottom - 2,
      // Debug info
      pmLeft: pmRect.left,
      pmTop: pmRect.top,
      pmWidth: pmRect.width,
      blockCount: blocks.length,
    };
  }, { first: blockIndices.first, last: blockIndices.last });
}

test.describe('Marquee Block Selection', () => {

  test('drag-select highlights overlapping blocks', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    // Capture renderer console for diagnostics
    page.on('console', (msg: any) => {
      const text = msg.text();
      if (text.includes('MARQUEE') || text.includes('SEL') || text.includes('TEST-DIAG') || text.includes('Canvas')) {
        console.log(`  RENDERER: ${text}`);
      }
    });

    // ── Setup: open canvas, create page with several blocks ──
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Beta' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Gamma' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Delta' }] },
    ]);
    await page.waitForTimeout(500); // let DOM settle

    // ── Verify no blocks are selected initially ──
    let selectedCount = await page.locator('.block-selected').count();
    expect(selectedCount).toBe(0);

    // ── Get safe coordinates ──
    const coords = await getMarqueeCoords(page, { first: 0, last: 3 });
    console.log('[MARQUEE-E2E] coords:', coords);

    // ── Inject mousedown target trace ──
    await page.evaluate(() => {
      const ec = document.querySelector('.canvas-editor-wrapper');
      ec?.addEventListener('mousedown', (e: Event) => {
        const t = e.target as HTMLElement;
        console.log('[TEST-DIAG] mousedown target class="' + t.className + '" tag=' + t.tagName);
      }, { once: true });
    });

    // ── Perform marquee drag ──
    await page.mouse.move(coords.startX, coords.startY);
    await page.mouse.down();
    // Move past activation threshold (5px)
    await page.mouse.move(coords.startX + 15, coords.startY + 15, { steps: 3 });
    // Drag to encompass all blocks
    await page.mouse.move(coords.endX, coords.endY, { steps: 8 });

    // ── Verify the marquee element is visible during drag ──
    const marquee = page.locator('.block-marquee');
    const marqueeVisible = await marquee.evaluate((el: HTMLElement) => {
      const style = getComputedStyle(el);
      return {
        display: style.display,
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
    });
    console.log('[MARQUEE-E2E] marquee during drag:', marqueeVisible);
    expect(marqueeVisible.display).toBe('block');
    expect(marqueeVisible.width).toBeGreaterThan(10);
    expect(marqueeVisible.height).toBeGreaterThan(10);

    // Release the mouse
    await page.mouse.up();
    await page.waitForTimeout(500);

    // ── Dump post-selection state ──
    const postState = await page.evaluate(() => {
      const selected = document.querySelectorAll('.block-selected');
      const pm = document.querySelector('.ProseMirror');
      return {
        selectedCount: selected.length,
        selectedTags: Array.from(selected).map(el => el.tagName + '.' + el.className.split(' ').slice(0, 2).join('.')),
        pmChildCount: pm?.children.length ?? 0,
      };
    });
    console.log('[MARQUEE-E2E] post-selection state:', postState);

    selectedCount = postState.selectedCount;
    expect(selectedCount).toBeGreaterThanOrEqual(3); // at least 3 of 4

    // ── Verify the marquee overlay is hidden after mouseup ──
    const marqueeHidden = await marquee.evaluate((el: HTMLElement) => getComputedStyle(el).display);
    expect(marqueeHidden).toBe('none');

    // ── Verify selection persists (no flicker) ──
    await page.waitForTimeout(500);
    const persistedCount = await page.locator('.block-selected').count();
    expect(persistedCount).toBe(selectedCount);
  });

  test('clicking empty area clears marquee selection', async ({
    window: page,
  }) => {
    await waitForEditor(page);

    // First, perform a marquee selection
    const coords = await getMarqueeCoords(page, { first: 0, last: 3 });

    await page.mouse.move(coords.startX, coords.startY);
    await page.mouse.down();
    await page.mouse.move(coords.startX + 15, coords.startY + 15, { steps: 3 });
    await page.mouse.move(coords.endX, coords.endY, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    let selectedCount = await page.locator('.block-selected').count();
    expect(selectedCount).toBeGreaterThan(0);

    // Click on PM background (below last block — in the 96px bottom padding)
    const pm = page.locator('.ProseMirror');
    const pmBox = await pm.boundingBox();
    expect(pmBox).toBeTruthy();
    await page.mouse.click(pmBox!.x + pmBox!.width / 2, pmBox!.y + pmBox!.height - 20);
    await page.waitForTimeout(300);

    // Selection should be cleared
    selectedCount = await page.locator('.block-selected').count();
    expect(selectedCount).toBe(0);
  });

  test('marquee selects only overlapping blocks, not all', async ({
    window: page,
  }) => {
    await waitForEditor(page);

    // Ensure fresh content
    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Top block' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Middle block' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bottom block' }] },
    ]);
    await page.waitForTimeout(500);

    // Drag only across the first block
    const coords = await getMarqueeCoords(page, { first: 0, last: 0 });

    await page.mouse.move(coords.startX, coords.startY);
    await page.mouse.down();
    await page.mouse.move(coords.startX + 15, coords.startY + 10, { steps: 3 });
    await page.mouse.move(coords.endX, coords.endY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Should select exactly 1 block
    const selectedCount = await page.locator('.block-selected').count();
    console.log(`[MARQUEE-E2E] Partial select count: ${selectedCount}`);
    expect(selectedCount).toBe(1);

    // The selected element should be the first block
    const pm = page.locator('.ProseMirror');
    const firstBlockSelected = await pm.locator(':scope > *').nth(0).evaluate(
      (el: HTMLElement) => el.classList.contains('block-selected'),
    );
    expect(firstBlockSelected).toBe(true);
  });
});
