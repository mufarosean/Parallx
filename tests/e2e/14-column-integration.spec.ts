/**
 * E2E Integration Test: Real User Column Workflow
 *
 * ONE page. Cumulative state. Screenshots after every step.
 * Tests what the user expects to SEE, not what code returns.
 *
 * Flow: set up blocks → drag to create columns → try resize → add column →
 * try resize → extract → try resize → dissolve → re-create → resize.
 *
 * If any step corrupts state, ALL subsequent steps fail.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent } from './fixtures';
import type { Page } from '@playwright/test';

// ── Spec-specific helpers ───────────────────────────────────────────────────

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/14-integration/${name}.png` });
  console.log(`📸 ${name}`);
}

/** Spec-specific getDocStructure that shows background colors and column widths. */
async function getDocStructure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return [];
    return (editor.getJSON().content || []).map((node: any) => {
      if (node.type === 'paragraph') {
        const t = node.content?.[0]?.text || '(empty)';
        return node.attrs?.backgroundColor ? `p[bg]:${t}` : `p:${t}`;
      }
      if (node.type === 'columnList') {
        const cols = node.content || [];
        const desc = cols.map((col: any) => {
          const w = col.attrs?.width;
          const blocks = (col.content || []).map((b: any) => b.content?.[0]?.text || '?');
          return w != null ? `[w=${w}:${blocks}]` : `[${blocks}]`;
        }).join('');
        return `cols:${cols.length}${desc}`;
      }
      return node.type;
    });
  });
}

// ── Drag helpers (same synthetic approach as test-12, since Playwright
//    can't do native HTML5 drag in Electron) ─────────────────────────────

async function setupDrag(page: Page, blockIndex: number): Promise<void> {
  await page.evaluate((idx) => {
    const editor = (window as any).__tiptapEditor;
    const view = editor.view;
    const doc = view.state.doc;
    let pos = 0;
    for (let i = 0; i < idx; i++) pos += doc.child(i).nodeSize;
    editor.commands.setNodeSelection(pos);
    view.dragging = { slice: view.state.selection.content(), move: true };
  }, blockIndex);
}

async function setupDragFromColumn(page: Page, cli: number, ci: number, bi: number): Promise<void> {
  await page.evaluate(({ cli, ci, bi }) => {
    const editor = (window as any).__tiptapEditor;
    const view = editor.view;
    const doc = view.state.doc;
    let topPos = 0, count = 0; let clNode: any = null;
    for (let i = 0; i < doc.childCount; i++) {
      if (doc.child(i).type.name === 'columnList') {
        if (count === cli) { clNode = doc.child(i); break; }
        count++;
      }
      topPos += doc.child(i).nodeSize;
    }
    if (!clNode) throw new Error('No columnList');
    let colPos = topPos + 1;
    for (let i = 0; i < ci; i++) colPos += clNode.child(i).nodeSize;
    let blockPos = colPos + 1;
    for (let i = 0; i < bi; i++) blockPos += clNode.child(ci).child(i).nodeSize;
    editor.commands.setNodeSelection(blockPos);
    view.dragging = { slice: view.state.selection.content(), move: true };
  }, { cli, ci, bi });
}

async function dragoverAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const view = (window as any).__tiptapEditor.view;
    view.dom.dispatchEvent(new DragEvent('dragover', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
  }, { x, y });
}

async function dropAt(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const view = (window as any).__tiptapEditor.view;
    view.dom.dispatchEvent(new DragEvent('drop', { clientX: x, clientY: y, bubbles: true, cancelable: true }));
    view.dragging = null;
  }, { x, y });
}

// ── Measurement helpers ─────────────────────────────────────────────────

async function getBlockRect(page: Page, index: number) {
  return page.evaluate((i) => {
    const el = document.querySelectorAll('.tiptap > *')[i] as HTMLElement;
    if (!el) throw new Error(`No block at ${i}`);
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, index);
}

async function getColumnBoundary(page: Page, colListIndex: number, leftIndex: number) {
  return page.evaluate(({ cli, li }) => {
    const lists = document.querySelectorAll('.tiptap > [data-type="columnList"]');
    const list = lists[cli] as HTMLElement;
    if (!list) return null;
    const cols = Array.from(list.querySelectorAll(':scope > .canvas-column')) as HTMLElement[];
    const left = cols[li], right = cols[li + 1];
    if (!left || !right) return null;
    const lr = left.getBoundingClientRect(), rr = right.getBoundingClientRect();
    return {
      x: (lr.right + rr.left) / 2,
      y: (lr.top + lr.bottom) / 2,
      leftWidth: Math.round(lr.width),
      rightWidth: Math.round(rr.width),
      gap: Math.round(rr.left - lr.right),
    };
  }, { cli: colListIndex, li: leftIndex });
}

async function getColBlockRect(page: Page, cli: number, ci: number, bi: number) {
  return page.evaluate(({ cli, ci, bi }) => {
    const lists = document.querySelectorAll('.tiptap > [data-type="columnList"]');
    const cols = lists[cli]?.querySelectorAll(':scope > .canvas-column');
    const blocks = cols?.[ci]?.querySelectorAll(':scope > *');
    const el = blocks?.[bi] as HTMLElement;
    if (!el) throw new Error(`No block at col[${ci}][${bi}]`);
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, { cli, ci, bi });
}

/**
 * Attempt a resize drag. Returns whether it worked (width changed).
 * This is what the USER does: move mouse to gap → hold → drag → release.
 */
async function tryResize(page: Page, colListIndex: number, leftIndex: number, deltaX: number): Promise<{
  cursorActivated: boolean;
  widthBefore: number;
  widthAfter: number;
  worked: boolean;
}> {
  const b = await getColumnBoundary(page, colListIndex, leftIndex);
  if (!b) return { cursorActivated: false, widthBefore: 0, widthAfter: 0, worked: false };

  // Move to boundary
  await page.mouse.move(b.x, b.y);
  await page.waitForTimeout(150);
  const cursorActivated = await page.evaluate(() => document.body.classList.contains('column-resize-hover'));

  // Drag
  await page.mouse.down();
  await page.mouse.move(b.x + deltaX, b.y, { steps: 8 });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Measure result
  const bAfter = await getColumnBoundary(page, colListIndex, leftIndex);
  const widthAfter = bAfter?.leftWidth ?? b.leftWidth;

  return {
    cursorActivated,
    widthBefore: b.leftWidth,
    widthAfter,
    worked: deltaX > 0 ? widthAfter > b.leftWidth : widthAfter < b.leftWidth,
  };
}

// ═════════════════════════════════════════════════════════════════════════════

test.describe('Column Integration — Real User Workflow', () => {

  test('full session: drag → resize → extend → resize → extract → resize → dissolve → recreate → resize', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    // ═══ STEP 1: Create blocks (mix of plain and background-colored) ═══
    console.log('\n═══ STEP 1: Initial content ═══');
    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', attrs: { backgroundColor: 'rgba(100,50,150,0.3)' },
        content: [{ type: 'text', text: 'Purple Note' }] },
      { type: 'paragraph', attrs: { backgroundColor: 'rgba(150,130,50,0.3)' },
        content: [{ type: 'text', text: 'Olive Note' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Regular' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Footer' }] },
    ]);
    let doc = await getDocStructure(page);
    console.log('Initial:', doc);
    expect(doc).toHaveLength(5);
    await shot(page, '01-initial');

    // ═══ STEP 2: Drag Olive to LEFT of Purple → create 2-column ═══
    console.log('\n═══ STEP 2: Create 2-column via drag ═══');
    const purpleRect = await getBlockRect(page, 1);
    await setupDrag(page, 2); // Olive
    // A left-strip column drop takes a deliberate sideways move: come in
    // from the middle of the block first.
    await dragoverAt(page, purpleRect.left + purpleRect.width / 2, purpleRect.top + purpleRect.height / 2);
    await dragoverAt(page, purpleRect.left + 15, purpleRect.top + purpleRect.height / 2);
    await shot(page, '02-indicator-visible');
    await dropAt(page, purpleRect.left + 15, purpleRect.top + purpleRect.height / 2);
    await page.waitForTimeout(400);
    doc = await getDocStructure(page);
    console.log('After drop:', doc);
    expect(doc.some(s => s.startsWith('cols:2'))).toBe(true);
    await shot(page, '03-2-columns-created');

    // ═══ STEP 3: RESIZE — the user's primary complaint ═══
    console.log('\n═══ STEP 3: Resize drop-created columns ═══');
    let resize = await tryResize(page, 0, 0, 60);
    console.log('Resize #1:', resize);
    await shot(page, '04-after-resize-1');
    expect(resize.cursorActivated).toBe(true);
    expect(resize.worked).toBe(true);

    // ═══ STEP 4: Drag Regular into columns → 3 columns ═══
    console.log('\n═══ STEP 4: Add 3rd column ═══');
    const col1Block = await getColBlockRect(page, 0, 1, 0); // Purple in col 1
    await setupDrag(page, 2); // Regular is now at top-level index 2
    await dragoverAt(page, col1Block.right - 15, col1Block.top + col1Block.height / 2);
    await shot(page, '05-indicator-for-3rd-col');
    await dropAt(page, col1Block.right - 15, col1Block.top + col1Block.height / 2);
    await page.waitForTimeout(400);
    doc = await getDocStructure(page);
    console.log('After 3rd col:', doc);
    expect(doc.some(s => s.startsWith('cols:3'))).toBe(true);
    await shot(page, '06-3-columns');

    // ═══ STEP 5: Resize 3-col (boundary 0↔1) ═══
    console.log('\n═══ STEP 5: Resize 3-col (0↔1) ═══');
    resize = await tryResize(page, 0, 0, 40);
    console.log('Resize 0↔1:', resize);
    await shot(page, '07-after-resize-0-1');
    expect(resize.cursorActivated).toBe(true);
    expect(resize.worked).toBe(true);

    // ═══ STEP 6: Resize 3-col (boundary 1↔2) ═══
    console.log('\n═══ STEP 6: Resize 3-col (1↔2) ═══');
    resize = await tryResize(page, 0, 1, -30);
    console.log('Resize 1↔2:', resize);
    await shot(page, '08-after-resize-1-2');
    expect(resize.cursorActivated).toBe(true);
    expect(resize.worked).toBe(true);

    // ═══ STEP 7: Double-click boundary to equalize ═══
    console.log('\n═══ STEP 7: Double-click equalize ═══');
    const bdbl = await getColumnBoundary(page, 0, 0);
    if (bdbl) {
      await page.mouse.dblclick(bdbl.x, bdbl.y);
      await page.waitForTimeout(300);
    }
    await shot(page, '09-after-equalize');

    // ═══ STEP 8: Extract from column (3→2) ═══
    console.log('\n═══ STEP 8: Extract block from column ═══');
    await setupDragFromColumn(page, 0, 2, 0);
    // Target: below Footer (below last block in doc)
    const footerRect = await getBlockRect(page, 2); // Footer
    await dragoverAt(page, footerRect.left + footerRect.width / 2, footerRect.bottom + 20);
    await dropAt(page, footerRect.left + footerRect.width / 2, footerRect.bottom + 20);
    await page.waitForTimeout(400);
    doc = await getDocStructure(page);
    console.log('After extract:', doc);
    expect(doc.some(s => s.startsWith('cols:2'))).toBe(true);
    await shot(page, '10-after-extraction');

    // ═══ STEP 9: Resize after extraction ═══
    console.log('\n═══ STEP 9: Resize after extraction ═══');
    resize = await tryResize(page, 0, 0, 50);
    console.log('Resize post-extract:', resize);
    await shot(page, '11-resize-after-extraction');
    expect(resize.cursorActivated).toBe(true);
    expect(resize.worked).toBe(true);

    // ═══ STEP 10: Dissolve (extract last block from 1 column) ═══
    console.log('\n═══ STEP 10: Dissolve ═══');
    await setupDragFromColumn(page, 0, 1, 0);
    const titleRect = await getBlockRect(page, 0);
    await dragoverAt(page, titleRect.left + titleRect.width / 2, titleRect.top - 5);
    await dropAt(page, titleRect.left + titleRect.width / 2, titleRect.top - 5);
    await page.waitForTimeout(500);
    doc = await getDocStructure(page);
    console.log('After dissolve:', doc);
    expect(doc.some(s => s === 'p[bg]:Purple Note')).toBe(true);
    expect(doc.some(s => s.startsWith('cols:'))).toBe(false);
    await shot(page, '12-dissolved');

    // ═══ STEP 11: Re-create columns from scratch ═══
    console.log('\n═══ STEP 11: Re-create columns ═══');
    const lastIdx = doc.length - 1;
    const prevRect = await getBlockRect(page, lastIdx - 1);
    await setupDrag(page, lastIdx);
    // A left-strip column drop takes a deliberate sideways move: come in
    // from the middle of the block first.
    await dragoverAt(page, prevRect.left + prevRect.width / 2, prevRect.top + prevRect.height / 2);
    await dragoverAt(page, prevRect.left + 15, prevRect.top + prevRect.height / 2);
    await dropAt(page, prevRect.left + 15, prevRect.top + prevRect.height / 2);
    await page.waitForTimeout(400);
    doc = await getDocStructure(page);
    console.log('Re-created:', doc);
    expect(doc.some(s => s.startsWith('cols:2'))).toBe(true);
    await shot(page, '13-re-created');

    // ═══ STEP 12: Resize the re-created columns ═══
    console.log('\n═══ STEP 12: Resize re-created columns ═══');
    resize = await tryResize(page, 0, 0, -40);
    console.log('Resize re-created:', resize);
    await shot(page, '14-resize-re-created');
    expect(resize.cursorActivated).toBe(true);
    expect(resize.worked).toBe(true);

    // ═══ STEP 13: Rapid back-and-forth resize ═══
    console.log('\n═══ STEP 13: Rapid resize ═══');
    resize = await tryResize(page, 0, 0, 80);
    console.log('→ Right:', resize.worked);
    expect(resize.worked).toBe(true);
    resize = await tryResize(page, 0, 0, -60);
    console.log('← Left:', resize.worked);
    expect(resize.worked).toBe(true);
    resize = await tryResize(page, 0, 0, 30);
    console.log('→ Right:', resize.worked);
    expect(resize.worked).toBe(true);
    await shot(page, '15-rapid-resize');

    // ═══ STEP 14: Edit text inside column, then resize ═══
    console.log('\n═══ STEP 14: Edit then resize ═══');
    const editTarget = await getColBlockRect(page, 0, 0, 0);
    await page.mouse.click(editTarget.left + 10, editTarget.top + editTarget.height / 2);
    await page.waitForTimeout(200);
    await page.keyboard.press('End');
    await page.keyboard.type(' — edited');
    await page.waitForTimeout(200);
    await page.mouse.click(10, 10); // click away
    await page.waitForTimeout(200);

    resize = await tryResize(page, 0, 0, 35);
    console.log('Resize after edit:', resize);
    await shot(page, '16-after-edit-resize');
    expect(resize.cursorActivated).toBe(true);
    expect(resize.worked).toBe(true);

    // Final
    doc = await getDocStructure(page);
    console.log('\n═══ FINAL:', doc, '═══');
    await shot(page, '17-final');
    console.log('\n═══ ALL STEPS COMPLETE ═══');
  });
});
