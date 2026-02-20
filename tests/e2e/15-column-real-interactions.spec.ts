/**
 * E2E Test: Column Real Interactions
 *
 * ONE canvas. Cumulative state. Labeled blocks for full traceability.
 * All drag operations go through the REAL GlobalDragHandle dragstart handler
 * and the REAL columnDropPlugin dragover/drop handlers — no bypassing.
 * Resize uses real mouse events. No keyboard shortcuts anywhere.
 *
 * Setup: Header + 3 columns × 5 blocks (C1-B1..C3-B5) + Footer
 * Each column gets a distinct background color for visual identification.
 *
 * Interactions tested (all on ONE page, cumulative state):
 *   Step 1: Verify initial state
 *   Step 2: Within C1 — reorder C1-B2 below C1-B4
 *   Step 3: Within C2 — reorder C2-B5 above C2-B1
 *   Step 4: Cross-column — C1-B1 from C1 to C2 below C2-B3
 *   Step 5: Extract — C3-B1 from C3 to top level above Footer
 *   Step 6: Resize columns with real mouse
 *   Step 7: Within C2 — reorder C2-B3 below C2-B1 (after cross-column move)
 *   Step 8: Final state verification — every block accounted for
 *
 * NOTE ON DRAG MECHANISM: Playwright cannot perform native HTML5 drag-and-drop
 * in Electron. We dispatch DragEvent on the REAL DOM elements:
 *   - dragstart on .drag-handle → GlobalDragHandle's handler runs, sets view.dragging
 *   - dragover on ProseMirror DOM → columnDropPlugin's handler shows indicator
 *   - drop on ProseMirror DOM → columnDropPlugin's handler executes transaction
 * All production code paths are exercised. The only synthetic part is event dispatch.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor, setContent } from './fixtures';
import type { Page, Locator } from '@playwright/test';

// ── Screenshot & logging ────────────────────────────────────────────────────

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/15-real-interactions/${name}.png` });
  console.log(`📸 ${name}`);
}

// ── Content helpers ─────────────────────────────────────────────────────────

function makeParagraph(text: string, bg?: string) {
  const node: any = { type: 'paragraph', content: [{ type: 'text', text }] };
  if (bg) node.attrs = { backgroundColor: bg };
  return node;
}

// ── Structure helpers ───────────────────────────────────────────────────────

/** Get column contents as arrays of text labels. */
async function getColumnContents(page: Page): Promise<string[][]> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    const json = editor.getJSON();
    const result: string[][] = [];
    for (const node of json.content || []) {
      if (node.type === 'columnList') {
        for (const col of node.content || []) {
          result.push(
            (col.content || []).map((b: any) => b.content?.[0]?.text || '?'),
          );
        }
      }
    }
    return result;
  });
}

/** Get top-level block names (columnList shown as [COLUMNS:N]). */
async function getTopLevel(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    const json = editor.getJSON();
    return (json.content || []).map((node: any) => {
      if (node.type === 'columnList') return `[COLUMNS:${(node.content || []).length}]`;
      return node.content?.[0]?.text || '(empty)';
    });
  });
}

/** Print full state to console — top-level blocks + column contents. */
async function logState(page: Page, label: string): Promise<void> {
  const top = await getTopLevel(page);
  const cols = await getColumnContents(page);
  console.log(`\n${label}`);
  console.log('  Top-level:', top);
  cols.forEach((c, i) => console.log(`  Column ${i + 1}:`, c));
}

// ── Drag helper ─────────────────────────────────────────────────────────────
//
// Dispatches DragEvent on real DOM elements, going through:
//   1. GlobalDragHandle's dragstart handler (sets view.dragging from selection)
//   2. columnDropPlugin's dragover handler (finds target, determines zone)
//   3. columnDropPlugin's drop handler (inserts content, deletes source)
//
// The block to drag is identified by text content within an optional scope
// (e.g. a specific column). The drop target is identified by coordinates.

async function dragBlockByText(
  page: Page,
  blockText: string,
  targetX: number,
  targetY: number,
  scope?: Locator,
): Promise<{ ok: boolean; diag: string[] }> {
  const diag: string[] = [];

  // 1. Find and hover the block to make the drag handle appear
  const container = scope ?? page.locator('.tiptap');
  const block = container.locator('p', { hasText: blockText }).first();
  await block.scrollIntoViewIfNeeded();
  await block.hover({ force: true });
  await page.waitForTimeout(400);

  // 2. Verify the drag handle appeared
  const handle = page.locator('.drag-handle');
  const handleVisible = await handle.isVisible();
  if (!handleVisible) {
    diag.push('drag handle not visible');
    return { ok: false, diag };
  }
  const handleBox = await handle.boundingBox();
  if (!handleBox) {
    diag.push('no handle bounding box');
    return { ok: false, diag };
  }

  const hx = handleBox.x + handleBox.width / 2;
  const hy = handleBox.y + handleBox.height / 2;
  diag.push(`handle at (${Math.round(hx)}, ${Math.round(hy)})`);
  diag.push(`target at (${Math.round(targetX)}, ${Math.round(targetY)})`);

  // 3. Atomic drag operation: dragstart → dragover → drop → dragend
  //    All in ONE evaluate call to prevent any async state loss.
  //
  //    dragstart fires on the REAL drag handle element, which triggers
  //    GlobalDragHandle's handleDragStart → sets view.dragging.
  //
  //    dragover and drop fire on view.dom, going through ProseMirror's
  //    plugin handler pipeline → columnDropPlugin processes them.
  const result = await page.evaluate(({ hx, hy, tx, ty }) => {
    const info: string[] = [];

    // ── DRAGSTART on the real drag handle ──
    const handle = document.querySelector('.drag-handle') as HTMLElement;
    if (!handle) return { ok: false, info: ['no handle element'] };

    const dt = new DataTransfer();
    handle.dispatchEvent(new DragEvent('dragstart', {
      clientX: hx, clientY: hy,
      dataTransfer: dt,
      bubbles: true, cancelable: true,
    }));

    const view = (window as any).__tiptapEditor?.view;
    if (!view?.dragging) return { ok: false, info: ['dragstart: view.dragging not set'] };

    const sel = view.state.selection;
    info.push(`dragstart OK — selection ${sel.from}-${sel.to}`);
    const selNode = view.state.doc.nodeAt(sel.from);
    info.push(`selected: ${selNode?.type?.name} "${selNode?.textContent?.substring(0, 20)}"`);

    // Trace GlobalDragHandle's node resolution
    const lookX = hx + 50 + 24;  // what handleDragStart computes
    const foundEl = document.elementsFromPoint(lookX, hy).find((el: Element) =>
      el.parentElement?.matches?.('.ProseMirror') ||
      el.matches?.('li, p:not(:first-child), .canvas-column > p, pre, blockquote, h1, h2, h3, h4, h5, h6')
    ) as HTMLElement | undefined;
    if (foundEl) {
      const nr = foundEl.getBoundingClientRect();
      const pr = view.posAtCoords({ left: nr.left + 74, top: nr.top + 1 });
      info.push(`nodeDOMAtCoords found: <${foundEl.tagName}> "${foundEl.textContent?.substring(0, 15)}" at lookX=${Math.round(lookX)}`);
      info.push(`posAtCoords({left:${Math.round(nr.left + 74)}, top:${Math.round(nr.top + 1)}}) = ${JSON.stringify(pr)}`);
    } else {
      info.push(`nodeDOMAtCoords: nothing found at lookX=${Math.round(lookX)}`);
    }

    // ── DRAGOVER at target position ──
    const overEvt = new DragEvent('dragover', {
      clientX: tx, clientY: ty,
      bubbles: true, cancelable: true,
    });
    view.dom.dispatchEvent(overEvt);

    // Check indicator state to verify dragover handler ran
    const vert = document.querySelector('.column-drop-indicator') as HTMLElement;
    const horz = document.querySelector('.canvas-drop-guide') as HTMLElement;
    const vertVis = vert?.style?.display === 'block';
    const horzVis = horz?.style?.display === 'block';
    info.push(`dragover: vert=${vertVis}, horz=${horzVis}, prevented=${overEvt.defaultPrevented}`);

    if (!vertVis && !horzVis) {
      // Dragover didn't show any indicator — drop won't work
      info.push('dragover: NO indicator shown — activeTarget likely null');
    }

    // ── DROP at target position ──
    const docBefore = view.state.doc.content.size;
    const dropEvt = new DragEvent('drop', {
      clientX: tx, clientY: ty,
      bubbles: true, cancelable: true,
    });
    view.dom.dispatchEvent(dropEvt);

    const docAfter = view.state.doc.content.size;
    info.push(`drop: prevented=${dropEvt.defaultPrevented}, docSize ${docBefore}→${docAfter}`);

    // ── DRAGEND cleanup ──
    view.dom.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    view.dragging = null;
    view.dom.classList.remove('dragging');

    return { ok: dropEvt.defaultPrevented, info };
  }, { hx, hy, tx: targetX, ty: targetY });

  diag.push(...result.info);
  await page.waitForTimeout(300);

  return { ok: result.ok, diag };
}

/** Get bounding box of a paragraph by text within a scope. */
async function getBlockBox(page: Page, text: string, scope?: Locator) {
  const container = scope ?? page.locator('.tiptap');
  return container.locator('p', { hasText: text }).first().boundingBox();
}

// ═════════════════════════════════════════════════════════════════════════════

test.describe('Column Real Interactions', () => {

  test('3-col × 5-block: reorder within, cross-column move, extract, resize', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);

    // ── Colors for visual traceability in screenshots ──
    const c1Bg = 'rgba(200,100,100,0.15)';  // reddish
    const c2Bg = 'rgba(100,180,100,0.15)';  // greenish
    const c3Bg = 'rgba(100,100,200,0.15)';  // bluish

    // ── Create initial state: Header, 3 columns × 5 labeled blocks, Footer ──
    await setContent(page, [
      makeParagraph('Header'),
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            content: [
              makeParagraph('C1-B1', c1Bg),
              makeParagraph('C1-B2', c1Bg),
              makeParagraph('C1-B3', c1Bg),
              makeParagraph('C1-B4', c1Bg),
              makeParagraph('C1-B5', c1Bg),
            ],
          },
          {
            type: 'column',
            content: [
              makeParagraph('C2-B1', c2Bg),
              makeParagraph('C2-B2', c2Bg),
              makeParagraph('C2-B3', c2Bg),
              makeParagraph('C2-B4', c2Bg),
              makeParagraph('C2-B5', c2Bg),
            ],
          },
          {
            type: 'column',
            content: [
              makeParagraph('C3-B1', c3Bg),
              makeParagraph('C3-B2', c3Bg),
              makeParagraph('C3-B3', c3Bg),
              makeParagraph('C3-B4', c3Bg),
              makeParagraph('C3-B5', c3Bg),
            ],
          },
        ],
      },
      makeParagraph('Footer'),
    ]);

    // Column locators (re-evaluated on each use)
    const colList = page.locator('.canvas-column-list').first();
    const col1 = colList.locator('.canvas-column').nth(0);
    const col2 = colList.locator('.canvas-column').nth(1);
    const col3 = colList.locator('.canvas-column').nth(2);

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Verify initial state
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 1: Verify initial state ═══');
    await logState(page, 'Initial:');

    let cols = await getColumnContents(page);
    expect(cols).toHaveLength(3);
    expect(cols[0]).toEqual(['C1-B1', 'C1-B2', 'C1-B3', 'C1-B4', 'C1-B5']);
    expect(cols[1]).toEqual(['C2-B1', 'C2-B2', 'C2-B3', 'C2-B4', 'C2-B5']);
    expect(cols[2]).toEqual(['C3-B1', 'C3-B2', 'C3-B3', 'C3-B4', 'C3-B5']);

    let topLevel = await getTopLevel(page);
    expect(topLevel).toEqual(['Header', '[COLUMNS:3]', 'Footer']);

    await shot(page, '01-initial');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Within C1 — drag C1-B2 below C1-B4
    // Expected C1: [C1-B1, C1-B3, C1-B4, C1-B2, C1-B5]
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 2: Within C1 — C1-B2 → below C1-B4 ═══');

    let targetBox = await getBlockBox(page, 'C1-B4', col1);
    expect(targetBox).toBeTruthy();

    // Debug: check what's at the target coordinates
    const targetX = targetBox!.x + targetBox!.width / 2;
    const targetY = targetBox!.y + targetBox!.height * 0.75;
    const elemDebug = await page.evaluate(({ x, y }) => {
      const els = document.elementsFromPoint(x, y);
      return els.slice(0, 8).map(el => ({
        tag: el.tagName,
        cls: (el as HTMLElement).className?.substring(0, 40),
        txt: el.textContent?.substring(0, 20),
        parent: el.parentElement?.className?.substring(0, 40),
      }));
    }, { x: targetX, y: targetY });
    console.log('  Target coords:', Math.round(targetX), Math.round(targetY));
    console.log('  Elements at target:', JSON.stringify(elemDebug, null, 2));

    // Debug: check what GlobalDragHandle's logic would resolve to
    const handleBox2 = await page.locator('.drag-handle').boundingBox();
    if (handleBox2) {
      const posDebug = await page.evaluate(({ hx, hy }) => {
        const view = (window as any).__tiptapEditor.view;
        // GlobalDragHandle does: elementsFromPoint(clientX + 74, clientY)
        const lookX = hx + 50 + 24;
        const lookY = hy;
        const node = document.elementsFromPoint(lookX, lookY).find((el: Element) =>
          el.parentElement?.matches?.('.ProseMirror') ||
          el.matches?.('li, p:not(:first-child), .canvas-column > p, pre, blockquote, h1, h2, h3, h4, h5, h6')
        );
        const nodeTag = node?.tagName;
        const nodeText = node?.textContent?.substring(0, 20);

        // Then posAtCoords at node's rect + 74
        let posResult = null;
        if (node) {
          const nr = node.getBoundingClientRect();
          posResult = view.posAtCoords({ left: nr.left + 74, top: nr.top + 1 });
        }

        // Then calcNodePos equivalent
        let calcResult = null;
        if (posResult?.inside != null && posResult.inside >= 0) {
          const $p = view.state.doc.resolve(posResult.inside);
          calcResult = {
            inside: posResult.inside,
            depth: $p.depth,
            beforeDepth: $p.depth > 1 ? $p.before($p.depth) : posResult.inside,
            nodeAtCalc: null as string | null,
          };
          const nodeAtPos = view.state.doc.nodeAt(calcResult.beforeDepth);
          calcResult.nodeAtCalc = nodeAtPos?.type?.name + '(' + nodeAtPos?.nodeSize + ')';
        }

        return { lookX: Math.round(lookX), lookY: Math.round(lookY), nodeTag, nodeText, posResult, calcResult };
      }, { hx: handleBox2.x + handleBox2.width / 2, hy: handleBox2.y + handleBox2.height / 2 });
      console.log('  GlobalDragHandle resolution debug:', JSON.stringify(posDebug, null, 2));
    }

    // Drop in the lower half of C1-B4 → "below" zone
    let drag = await dragBlockByText(
      page, 'C1-B2',
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height * 0.75,
      col1,
    );
    console.log('  drag:', drag.diag);
    expect(drag.ok).toBe(true);

    await logState(page, 'After step 2:');
    cols = await getColumnContents(page);
    expect(cols[0]).toEqual(['C1-B1', 'C1-B3', 'C1-B4', 'C1-B2', 'C1-B5']);
    // C2 and C3 unchanged
    expect(cols[1]).toEqual(['C2-B1', 'C2-B2', 'C2-B3', 'C2-B4', 'C2-B5']);
    expect(cols[2]).toEqual(['C3-B1', 'C3-B2', 'C3-B3', 'C3-B4', 'C3-B5']);
    await shot(page, '02-c1-reorder');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Within C2 — drag C2-B5 above C2-B1
    // Expected C2: [C2-B5, C2-B1, C2-B2, C2-B3, C2-B4]
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 3: Within C2 — C2-B5 → above C2-B1 ═══');

    targetBox = await getBlockBox(page, 'C2-B1', col2);
    expect(targetBox).toBeTruthy();
    // Drop in the upper quarter of C2-B1 → "above" zone
    drag = await dragBlockByText(
      page, 'C2-B5',
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height * 0.25,
      col2,
    );
    console.log('  drag:', drag.diag);
    expect(drag.ok).toBe(true);

    await logState(page, 'After step 3:');
    cols = await getColumnContents(page);
    expect(cols[0]).toEqual(['C1-B1', 'C1-B3', 'C1-B4', 'C1-B2', 'C1-B5']);
    expect(cols[1]).toEqual(['C2-B5', 'C2-B1', 'C2-B2', 'C2-B3', 'C2-B4']);
    expect(cols[2]).toEqual(['C3-B1', 'C3-B2', 'C3-B3', 'C3-B4', 'C3-B5']);
    await shot(page, '03-c2-reorder');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: Cross-column — drag C1-B1 from C1 to C2, below C2-B3
    // Expected C1: [C1-B3, C1-B4, C1-B2, C1-B5] (4 blocks)
    // Expected C2: [C2-B5, C2-B1, C2-B2, C2-B3, C1-B1, C2-B4] (6 blocks)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 4: Cross-column — C1-B1 → C2 below C2-B3 ═══');

    targetBox = await getBlockBox(page, 'C2-B3', col2);
    expect(targetBox).toBeTruthy();
    // Hover C1-B1 in col1, drop at lower half of C2-B3 in col2
    drag = await dragBlockByText(
      page, 'C1-B1',
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height * 0.75,
      col1,
    );
    console.log('  drag:', drag.diag);
    expect(drag.ok).toBe(true);

    await logState(page, 'After step 4:');
    cols = await getColumnContents(page);
    expect(cols[0]).toEqual(['C1-B3', 'C1-B4', 'C1-B2', 'C1-B5']);
    expect(cols[1]).toEqual(['C2-B5', 'C2-B1', 'C2-B2', 'C2-B3', 'C1-B1', 'C2-B4']);
    expect(cols[2]).toEqual(['C3-B1', 'C3-B2', 'C3-B3', 'C3-B4', 'C3-B5']);
    await shot(page, '04-cross-column');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Extract — drag C3-B1 from C3 to top level, above Footer
    // Expected C3: [C3-B2, C3-B3, C3-B4, C3-B5] (4 blocks)
    // Expected top: [Header, [COLUMNS:3], C3-B1, Footer]
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 5: Extract — C3-B1 → top level above Footer ═══');

    const footerBlock = page.locator('.tiptap > p', { hasText: 'Footer' });
    targetBox = await footerBlock.boundingBox();
    expect(targetBox).toBeTruthy();
    // Hover C3-B1 in col3, drop at upper quarter of Footer (= "above" zone)
    drag = await dragBlockByText(
      page, 'C3-B1',
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height * 0.25,
      col3,
    );
    console.log('  drag:', drag.diag);
    expect(drag.ok).toBe(true);

    await logState(page, 'After step 5:');
    cols = await getColumnContents(page);
    expect(cols[0]).toEqual(['C1-B3', 'C1-B4', 'C1-B2', 'C1-B5']);
    expect(cols[1]).toEqual(['C2-B5', 'C2-B1', 'C2-B2', 'C2-B3', 'C1-B1', 'C2-B4']);
    expect(cols[2]).toEqual(['C3-B2', 'C3-B3', 'C3-B4', 'C3-B5']);
    topLevel = await getTopLevel(page);
    expect(topLevel).toEqual(['Header', '[COLUMNS:3]', 'C3-B1', 'Footer']);
    await shot(page, '05-extracted');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Resize columns with real mouse
    // Drag the boundary between C1 and C2 to the right by 60px
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 6: Resize columns ═══');

    const boundary = await page.evaluate(() => {
      const list = document.querySelector('.canvas-column-list') as HTMLElement;
      const cols = list?.querySelectorAll('.canvas-column') as NodeListOf<HTMLElement>;
      if (!cols || cols.length < 2) return null;
      const leftR = cols[0].getBoundingClientRect();
      const rightR = cols[1].getBoundingClientRect();
      return {
        x: (leftR.right + rightR.left) / 2,
        y: leftR.top + leftR.height / 2,
        leftWidth: Math.round(leftR.width),
        rightWidth: Math.round(rightR.width),
      };
    });
    console.log('  Boundary before resize:', boundary);
    expect(boundary).toBeTruthy();

    // Move to boundary → check resize cursor activates
    await page.mouse.move(boundary!.x, boundary!.y);
    await page.waitForTimeout(200);
    const cursorActive = await page.evaluate(
      () => document.body.classList.contains('column-resize-hover'),
    );
    console.log('  column-resize-hover active:', cursorActive);
    expect(cursorActive).toBe(true);

    // Real mouse drag: down → move right 60px → up
    await page.mouse.down();
    await page.mouse.move(boundary!.x + 60, boundary!.y, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(300);

    // Verify widths changed
    const afterResize = await page.evaluate(() => {
      const list = document.querySelector('.canvas-column-list') as HTMLElement;
      const cols = list?.querySelectorAll('.canvas-column') as NodeListOf<HTMLElement>;
      if (!cols || cols.length < 2) return null;
      return {
        leftWidth: Math.round(cols[0].getBoundingClientRect().width),
        rightWidth: Math.round(cols[1].getBoundingClientRect().width),
      };
    });
    console.log('  After resize:', afterResize);
    expect(afterResize).toBeTruthy();
    expect(afterResize!.leftWidth).toBeGreaterThan(boundary!.leftWidth);
    expect(afterResize!.rightWidth).toBeLessThan(boundary!.rightWidth);
    console.log(
      `  C1 width: ${boundary!.leftWidth}px → ${afterResize!.leftWidth}px (+${afterResize!.leftWidth - boundary!.leftWidth}px)`,
    );

    // Content should be unchanged after resize
    cols = await getColumnContents(page);
    expect(cols[0]).toEqual(['C1-B3', 'C1-B4', 'C1-B2', 'C1-B5']);
    expect(cols[1]).toEqual(['C2-B5', 'C2-B1', 'C2-B2', 'C2-B3', 'C1-B1', 'C2-B4']);
    expect(cols[2]).toEqual(['C3-B2', 'C3-B3', 'C3-B4', 'C3-B5']);
    await shot(page, '06-resized');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Within C2 — drag C2-B3 below C2-B1 (reorder after cross-column)
    // Tests that within-column reorder still works after cross-column moves
    // Expected C2: [C2-B5, C2-B1, C2-B3, C2-B2, C1-B1, C2-B4]
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 7: Within C2 — C2-B3 → below C2-B1 ═══');

    targetBox = await getBlockBox(page, 'C2-B1', col2);
    expect(targetBox).toBeTruthy();
    drag = await dragBlockByText(
      page, 'C2-B3',
      targetBox!.x + targetBox!.width / 2,
      targetBox!.y + targetBox!.height * 0.75,
      col2,
    );
    console.log('  drag:', drag.diag);
    expect(drag.ok).toBe(true);

    await logState(page, 'After step 7:');
    cols = await getColumnContents(page);
    expect(cols[1]).toEqual(['C2-B5', 'C2-B1', 'C2-B3', 'C2-B2', 'C1-B1', 'C2-B4']);
    await shot(page, '07-c2-reorder-after-cross');

    // ═══════════════════════════════════════════════════════════════════════
    // STEP 8: Final state — every block accounted for
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══ STEP 8: Final state ═══');
    await logState(page, 'Final:');

    // Top-level structure
    topLevel = await getTopLevel(page);
    expect(topLevel).toEqual(['Header', '[COLUMNS:3]', 'C3-B1', 'Footer']);

    // All column contents
    cols = await getColumnContents(page);
    expect(cols).toHaveLength(3);
    expect(cols[0]).toEqual(['C1-B3', 'C1-B4', 'C1-B2', 'C1-B5']);          // C1: 4 blocks
    expect(cols[1]).toEqual(['C2-B5', 'C2-B1', 'C2-B3', 'C2-B2', 'C1-B1', 'C2-B4']); // C2: 6 blocks
    expect(cols[2]).toEqual(['C3-B2', 'C3-B3', 'C3-B4', 'C3-B5']);          // C3: 4 blocks

    // Block accounting: all 15 original column blocks + 2 top-level = 17
    const allColumnBlocks = cols.flat();
    const allBlocks = [...topLevel.filter(t => !t.startsWith('[')), ...allColumnBlocks];
    console.log(`  Total blocks: ${allBlocks.length} (expected 17)`);
    console.log('  All blocks:', allBlocks.sort());
    expect(allBlocks).toHaveLength(17);

    // Verify every original block appears exactly once
    const expected = [
      'Header', 'Footer',
      'C1-B1', 'C1-B2', 'C1-B3', 'C1-B4', 'C1-B5',
      'C2-B1', 'C2-B2', 'C2-B3', 'C2-B4', 'C2-B5',
      'C3-B1', 'C3-B2', 'C3-B3', 'C3-B4', 'C3-B5',
    ].sort();
    expect(allBlocks.sort()).toEqual(expected);

    await shot(page, '08-final');
    console.log('\n═══ ALL STEPS COMPLETE — every block accounted for ═══');
  });
});
