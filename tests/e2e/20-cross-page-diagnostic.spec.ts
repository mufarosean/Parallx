/**
 * Diagnostic E2E test for cross-page block drag-and-drop.
 *
 * This test injects console.log instrumentation into the renderer
 * so we can watch exactly what happens at each stage:
 *   - dragover on .canvas-page-block
 *   - columnDropPlugin's drop handler
 *   - pageBlockNode's DOM drop handler
 *   - moveBlockToLinkedPage execution
 *   - source deletion
 *
 * Run ONLY this file:
 *   npx playwright test tests/e2e/20-cross-page-diagnostic.spec.ts --headed
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, getDocStructure } from './fixtures';
import type { Page } from '@playwright/test';

test.describe('Cross-Page DnD Diagnostic', () => {

  test('drag paragraph onto pageBlock — full trace', async ({ window: page, electronApp, workspacePath }) => {
    // ── 0. Collect all console messages from the renderer ──
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[DND-DIAG]') || text.startsWith('[Canvas]')) {
        consoleLogs.push(text);
        console.log(`  RENDERER: ${text}`);
      }
    });

    // ── 1. Setup: open workspace, open canvas, create root page ──
    console.log('\n[DND-DIAG] === Setting up canvas page ===');
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    console.log('[DND-DIAG] Canvas page ready');

    // Grab the currentPageId
    const parentPageId = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      // Walk up from editor to find currentPageId
      return (editor as any)?.options?.editorProps?.attributes?.['data-page-id']
        ?? document.querySelector('.canvas-editor-pane')?.getAttribute('data-page-id')
        ?? 'unknown';
    });
    console.log(`[DND-DIAG] Parent page ID: ${parentPageId}`);

    // ── 2. Create a pageBlock via /page slash command ──
    console.log('[DND-DIAG] Creating embedded page via /page...');
    const treeCountBefore = await page.locator('.canvas-node[role="treeitem"]').count();

    const tiptap = page.locator('.tiptap').first();
    await tiptap.click();
    await page.keyboard.type('/page');
    const slashMenu = page.locator('.canvas-slash-menu');
    await expect(slashMenu).toBeVisible({ timeout: 5_000 });
    const pageItem = slashMenu.locator('.canvas-slash-item').filter({
      has: page.locator('.canvas-slash-label', { hasText: /^Page$/ }),
    }).first();
    await expect(pageItem).toBeVisible({ timeout: 5_000 });
    await pageItem.click();

    // Wait for tree to show the new child page
    await expect(page.locator('.canvas-node[role="treeitem"]')).toHaveCount(treeCountBefore + 1, { timeout: 10_000 });
    console.log('[DND-DIAG] Child page created in tree');

    // /page auto-navigates to the child. Go back to parent.
    const parentNode = page.locator('.canvas-node[role="treeitem"]').first();
    await parentNode.click();
    await page.waitForSelector('.canvas-page-block-card', { timeout: 10_000 });
    await waitForEditor(page);
    console.log('[DND-DIAG] Back on parent page, pageBlock card visible');

    // Wait for save debounce to flush
    await page.waitForTimeout(1500);

    // ── 3. Type a source paragraph ABOVE the pageBlock ──
    // Click at the very start of the editor to place cursor at top
    await tiptap.click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Home');
    // Press Enter to create a new line at top, then move up
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('DRAG_ME_BLOCK');
    await page.waitForTimeout(500);

    // Verify doc state
    const docBefore = await getDocStructure(page);
    console.log(`[DND-DIAG] Doc BEFORE drag: ${JSON.stringify(docBefore)}`);

    // Verify pageBlock is present
    const pageBlockCount = await page.locator('.canvas-page-block').count();
    console.log(`[DND-DIAG] PageBlock count in DOM: ${pageBlockCount}`);
    expect(pageBlockCount).toBeGreaterThanOrEqual(1);

    // Verify DRAG_ME_BLOCK is present
    await expect(page.locator('.tiptap p', { hasText: 'DRAG_ME_BLOCK' })).toHaveCount(1);

    // ── 4. Inject diagnostic instrumentation ──
    console.log('[DND-DIAG] Injecting instrumentation...');
    await page.evaluate(() => {
      // Instrument the pageBlock's DOM event listeners
      const pageBlocks = document.querySelectorAll('.canvas-page-block');
      pageBlocks.forEach((pb, i) => {
        pb.addEventListener('dragover', (e) => {
          console.log(`[DND-DIAG] pageBlock[${i}] DOM dragover fired — defaultPrevented=${e.defaultPrevented}`);
        }, true); // capture phase to see it first
        pb.addEventListener('drop', (e) => {
          console.log(`[DND-DIAG] pageBlock[${i}] DOM drop fired — defaultPrevented=${e.defaultPrevented}, dataTransfer types=${(e as DragEvent).dataTransfer?.types}`);
        }, true);
      });

      // Instrument view.dragging to see if PM has a drag active
      const editor = (window as any).__tiptapEditor;
      if (editor) {
        const origDispatch = editor.view.dispatch.bind(editor.view);
        editor.view.dispatch = (...args: any[]) => {
          const tr = args[0];
          if (tr && tr.docChanged) {
            console.log(`[DND-DIAG] TR dispatched — docChanged=true, steps=${tr.steps?.length}`);
          }
          return origDispatch(...args);
        };
      }
    });

    // ── 5. Perform the drag: hover paragraph → grab handle → drag to pageBlock ──
    console.log('[DND-DIAG] Starting drag...');

    // Hover the DRAG_ME_BLOCK paragraph to trigger drag handle
    const paragraph = page.locator('.tiptap p', { hasText: 'DRAG_ME_BLOCK' }).first();
    await paragraph.scrollIntoViewIfNeeded();
    const paraBox = await paragraph.boundingBox();
    console.log(`[DND-DIAG] Paragraph bounds: ${JSON.stringify(paraBox)}`);

    await paragraph.hover({ force: true });
    await page.waitForTimeout(300);

    // Check if drag handle appears
    const dragHandle = page.locator('.drag-handle');
    const handleVisible = await dragHandle.isVisible().catch(() => false);
    console.log(`[DND-DIAG] Drag handle visible after hover: ${handleVisible}`);

    if (!handleVisible) {
      // Try hovering more precisely at the left edge of the paragraph
      if (paraBox) {
        await page.mouse.move(paraBox.x + 5, paraBox.y + paraBox.height / 2);
        await page.waitForTimeout(500);
        const handleVisible2 = await dragHandle.isVisible().catch(() => false);
        console.log(`[DND-DIAG] Drag handle visible after left-edge hover: ${handleVisible2}`);
      }
    }

    await expect(dragHandle).toBeVisible({ timeout: 5_000 });
    const handleBox = await dragHandle.boundingBox();
    console.log(`[DND-DIAG] Handle bounds: ${JSON.stringify(handleBox)}`);

    // Get pageBlock target bounds
    const pageBlockCard = page.locator('.canvas-page-block-card').first();
    const targetBox = await pageBlockCard.boundingBox();
    console.log(`[DND-DIAG] PageBlock card bounds: ${JSON.stringify(targetBox)}`);

    if (!handleBox || !targetBox) throw new Error('Missing bounds for drag source or target');

    const hx = handleBox.x + handleBox.width / 2;
    const hy = handleBox.y + handleBox.height / 2;
    const tx = targetBox.x + targetBox.width / 2;
    const ty = targetBox.y + targetBox.height / 2;

    console.log(`[DND-DIAG] Drag from (${hx}, ${hy}) → to (${tx}, ${ty})`);

    // Check view.dragging before the drag
    const draggingBefore = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      return !!editor?.view?.dragging;
    });
    console.log(`[DND-DIAG] view.dragging before mousedown: ${draggingBefore}`);

    // Perform the drag
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.waitForTimeout(100);

    // Check view.dragging after mousedown
    const draggingAfterDown = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      return {
        hasDragging: !!editor?.view?.dragging,
        sliceContent: editor?.view?.dragging?.slice?.content?.toJSON?.() ?? null,
      };
    });
    console.log(`[DND-DIAG] view.dragging after mousedown: ${JSON.stringify(draggingAfterDown)}`);

    // Move in steps toward the target
    const steps = 20;
    for (let i = 1; i <= steps; i++) {
      const progress = i / steps;
      const cx = hx + (tx - hx) * progress;
      const cy = hy + (ty - hy) * progress;
      await page.mouse.move(cx, cy);
      if (i === steps) {
        // At the end, check if we're over the pageBlock
        const overPageBlock = await page.evaluate(({x, y}) => {
          const el = document.elementFromPoint(x, y);
          const closest = el?.closest?.('.canvas-page-block');
          return {
            elementTag: el?.tagName,
            elementClass: el?.className?.toString?.()?.substring(0, 80),
            isOverPageBlock: !!closest,
            hasDropTarget: closest?.classList?.contains('canvas-page-block--drop-target') ?? false,
          };
        }, { x: cx, y: cy });
        console.log(`[DND-DIAG] At target position: ${JSON.stringify(overPageBlock)}`);
      }
      await page.waitForTimeout(30);
    }

    // Pause at target
    await page.waitForTimeout(200);

    // Check drag state right before drop
    const draggingBeforeDrop = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      return {
        hasDragging: !!editor?.view?.dragging,
        sliceContent: editor?.view?.dragging?.slice?.content?.toJSON?.() ?? null,
      };
    });
    console.log(`[DND-DIAG] view.dragging before drop: ${JSON.stringify(draggingBeforeDrop)}`);

    // Check if pageBlock has drop-target class
    const hasDropTargetClass = await page.locator('.canvas-page-block--drop-target').count();
    console.log(`[DND-DIAG] pageBlock has drop-target class: ${hasDropTargetClass > 0}`);

    // Drop
    console.log('[DND-DIAG] Releasing mouse (drop)...');
    await page.mouse.up();
    await page.waitForTimeout(1000);

    // ── 6. Check results ──
    const docAfter = await getDocStructure(page);
    console.log(`[DND-DIAG] Doc AFTER drag: ${JSON.stringify(docAfter)}`);

    const fullDocAfter = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      return editor?.getJSON?.();
    });
    console.log(`[DND-DIAG] Full doc JSON AFTER: ${JSON.stringify(fullDocAfter, null, 2)}`);

    // Check if the source block is still present
    const sourceStillPresent = await page.locator('.tiptap p', { hasText: 'DRAG_ME_BLOCK' }).count();
    console.log(`[DND-DIAG] DRAG_ME_BLOCK still in source page: ${sourceStillPresent > 0} (count: ${sourceStillPresent})`);

    // Print all collected console logs
    console.log('\n[DND-DIAG] === Collected renderer console logs ===');
    consoleLogs.forEach((l) => console.log(`  ${l}`));
    console.log('[DND-DIAG] === End renderer logs ===\n');

    // Now navigate to the child page to check if the block arrived
    console.log('[DND-DIAG] Opening child page to check if block arrived...');
    await page.locator('.canvas-page-block-card').first().click();
    await page.waitForSelector('.tiptap', { timeout: 10_000 });
    await page.waitForTimeout(500);

    const childDoc = await getDocStructure(page);
    console.log(`[DND-DIAG] Child page doc: ${JSON.stringify(childDoc)}`);

    const blockInChild = await page.locator('.tiptap p', { hasText: 'DRAG_ME_BLOCK' }).count();
    console.log(`[DND-DIAG] DRAG_ME_BLOCK in child page: ${blockInChild > 0} (count: ${blockInChild})`);

    // ── Assertions (these WILL fail if the move didn't work — that's the point) ──
    console.log('\n[DND-DIAG] === Final assertions ===');
    console.log(`[DND-DIAG] Source block removed from parent: ${sourceStillPresent === 0}`);
    console.log(`[DND-DIAG] Block arrived in child: ${blockInChild > 0}`);

    // Soft assertions so we see ALL output even if one fails
    expect.soft(sourceStillPresent, 'Source block should be removed from parent page').toBe(0);
    expect.soft(blockInChild, 'Block should appear in child page').toBeGreaterThan(0);
  });
});
