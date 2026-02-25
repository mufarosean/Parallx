/**
 * E2E tests: Column Block Handle Hover
 *
 * Validates that the drag handle remains visible and interactive when the
 * user hovers a block inside a column and then moves the mouse leftward
 * toward the handle.  This is a regression test for the bug where handles
 * disappear mid-hover for column-internal blocks.
 *
 * Test pattern follows 12-columns.spec.ts:
 *   • setupCanvasPage + setContent for column layout
 *   • element.hover() without force:true for initial hover
 *   • page.mouse.move() for incremental leftward movement (simulates user)
 *   • .hide class check (JS-side) + toBeVisible (Playwright assertion)
 *   • dragHandle.click({ force: true }) for action menu verification
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent } from './fixtures';

// ═══════════════════════════════════════════════════════════════════════════

test.describe('Column Block Handle Hover', () => {

  test('handle stays visible when moving from first-column block toward handle', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    // Set up 2-column layout with content (same pattern as 12-columns tests)
    await setContent(window, [
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Column one text that is long enough to hover' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Second block in first column' }] },
          ] },
          { type: 'column', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Column two text' }] },
          ] },
        ],
      },
    ]);

    // ── Step 1: Hover the first paragraph in the first column ──
    const colParagraph = tiptap.locator('.canvas-column p', { hasText: 'Column one text' });
    await colParagraph.hover();
    await window.waitForTimeout(500);

    // ── Step 2: Verify the drag handle appeared ──
    const dragHandle = window.locator('.drag-handle');
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });

    const isHidden = await dragHandle.evaluate(el => el.classList.contains('hide'));
    expect(isHidden).toBe(false);

    // ── Step 3: Get positions for incremental mouse movement ──
    const handleBox = await dragHandle.boundingBox();
    const blockBox = await colParagraph.boundingBox();
    expect(handleBox).toBeTruthy();
    expect(blockBox).toBeTruthy();
    if (!handleBox || !blockBox) return;

    // Handle should be to the left of the block
    expect(handleBox.x).toBeLessThan(blockBox.x);

    // ── Step 4: Move mouse incrementally from block toward the handle ──
    // Simulates the user moving their cursor leftward from the block text
    // toward the drag handle, exactly as described in the bug report.
    const startX = blockBox.x + 5;
    const endX = handleBox.x + handleBox.width / 2;
    const y = blockBox.y + blockBox.height / 2;
    const steps = 8;
    const dx = (endX - startX) / steps;

    for (let i = 0; i <= steps; i++) {
      const currentX = startX + dx * i;
      await window.mouse.move(currentX, y);
      await window.waitForTimeout(80);

      // Handle must NOT be hidden by JS at any step
      const hidden = await dragHandle.evaluate(el => el.classList.contains('hide'));
      expect(hidden, `Handle .hide at step ${i} (x=${Math.round(currentX)})`).toBe(false);
    }

    // ── Step 5: Move directly onto the handle and verify it's visible ──
    await window.mouse.move(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await window.waitForTimeout(200);
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });
  });

  test('handle stays visible for top-level block (baseline)', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: 'First paragraph with enough text to hover' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraph' }] },
    ]);

    // Hover the first top-level paragraph
    const firstPara = tiptap.locator(':scope > p').first();
    await firstPara.hover();
    await window.waitForTimeout(500);

    const dragHandle = window.locator('.drag-handle');
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });

    const handleBox = await dragHandle.boundingBox();
    const blockBox = await firstPara.boundingBox();
    expect(handleBox).toBeTruthy();
    expect(blockBox).toBeTruthy();
    if (!handleBox || !blockBox) return;

    // Move from block's left edge toward handle center
    const startX = blockBox.x + 5;
    const endX = handleBox.x + handleBox.width / 2;
    const y = blockBox.y + blockBox.height / 2;
    const steps = 8;
    const dx = (endX - startX) / steps;

    for (let i = 0; i <= steps; i++) {
      const currentX = startX + dx * i;
      await window.mouse.move(currentX, y);
      await window.waitForTimeout(80);

      const hidden = await dragHandle.evaluate(el => el.classList.contains('hide'));
      expect(hidden, `Handle .hide at step ${i} (x=${Math.round(currentX)})`).toBe(false);
    }
  });

  test('handle appears for second-column block', async ({
    window,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    const tiptap = window.locator('.tiptap');
    await tiptap.click();
    await waitForEditor(window);

    // 2-column layout — verify the handle shows for second column blocks
    await setContent(window, [
      {
        type: 'columnList',
        content: [
          { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column A content' }] }] },
          { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column B paragraph for hover testing' }] }] },
        ],
      },
    ]);

    // Hover the paragraph in the second column
    const colBPara = tiptap.locator('.canvas-column p', { hasText: 'Column B paragraph' });
    await colBPara.hover();
    await window.waitForTimeout(500);

    const dragHandle = window.locator('.drag-handle');
    await expect(dragHandle).toBeVisible({ timeout: 3_000 });

    const handleBox = await dragHandle.boundingBox();
    const blockBox = await colBPara.boundingBox();
    expect(handleBox).toBeTruthy();
    expect(blockBox).toBeTruthy();
    if (!handleBox || !blockBox) return;

    // Handle should be left of the block
    expect(handleBox.x).toBeLessThan(blockBox.x);
  });
});
