/**
 * E2E tests: Column Drag-Drop
 *
 * Isolated test that launches the app ONCE and systematically verifies:
 *
 * 1. Zone detection — getZone returns left/right/above/below correctly
 * 2. Indicator rendering — vertical vs horizontal indicator appears
 * 3. Drop outcomes — columnList creation, column addition, block extraction
 *
 * Uses synthetic DragEvent dispatch + manual view.dragging setup so we
 * can precisely control coordinates without fighting HTML5 drag quirks.
 */
import { test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';
import type { Page, ElectronApplication } from '@playwright/test';

// ── Helpers ─────────────────────────────────────────────────────────────────

async function setupCanvasPage(
  page: Page,
  electronApp: ElectronApplication,
  wsPath: string,
): Promise<void> {
  await openFolderViaMenu(electronApp, page, wsPath);
  await page.waitForTimeout(2000);

  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });

  await page.locator('.canvas-sidebar-add-btn').click();
  await page.waitForSelector('.canvas-node', { timeout: 10_000 });
  await page.locator('.canvas-node').first().click();
  await page.waitForSelector('.tiptap', { timeout: 10_000 });
  await page.waitForTimeout(500);
}

async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__tiptapEditor != null,
    { timeout: 10_000 },
  );
}

async function setContent(page: Page, content: any[]): Promise<void> {
  await page.evaluate((c) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) throw new Error('No TipTap editor');
    editor.commands.setContent({ type: 'doc', content: c });
  }, content);
  await page.waitForTimeout(300);
}

async function getDocJSON(page: Page): Promise<any> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return null;
    return editor.getJSON();
  });
}

async function getDocStructure(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return [];
    const json = editor.getJSON();
    return (json.content || []).map((node: any) => {
      const type = node.type;
      if (type === 'paragraph') return `p:${node.content?.[0]?.text || ''}`;
      if (type === 'heading') return `h${node.attrs?.level}:${node.content?.[0]?.text || ''}`;
      if (type === 'columnList') {
        const cols = (node.content || []).length;
        const texts = (node.content || []).map((col: any) =>
          (col.content || []).map((b: any) => b.content?.[0]?.text || '').join(','),
        );
        return `columnList:${cols}[${texts.join('|')}]`;
      }
      return type;
    });
  });
}

// ── Drag simulation helpers ─────────────────────────────────────────────────

/**
 * Set up a drag from a specific block (by doc position) so that
 * view.dragging is set. Returns selection info.
 */
async function startDragFromBlock(page: Page, blockIndex: number): Promise<{ from: number; to: number }> {
  return page.evaluate((idx) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) throw new Error('No editor');
    const view = editor.view;
    const doc = view.state.doc;

    // Find the nth top-level block
    let pos = 0;
    for (let i = 0; i < idx; i++) {
      pos += doc.child(i).nodeSize;
    }

    // Create NodeSelection on this block
    editor.commands.setNodeSelection(pos);

    // Set view.dragging (mimics GlobalDragHandle's handleDragStart)
    const slice = view.state.selection.content();
    view.dragging = { slice, move: true };

    return { from: view.state.selection.from, to: view.state.selection.to };
  }, blockIndex);
}

/**
 * Dispatch a synthetic dragover event at specific coordinates.
 * Returns info about what happened (indicator state, zone, etc.).
 */
async function dispatchDragover(page: Page, x: number, y: number): Promise<{
  vertVisible: boolean;
  horzVisible: boolean;
  vertTop: string;
  vertLeft: string;
  vertHeight: string;
  horzTop: string;
  horzLeft: string;
  horzWidth: string;
  hasDragging: boolean;
  findTargetResult: string;
}> {
  return page.evaluate(({ cx, cy }) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return {
      vertVisible: false, horzVisible: false,
      vertTop: '', vertLeft: '', vertHeight: '',
      horzTop: '', horzLeft: '', horzWidth: '',
      hasDragging: false, findTargetResult: 'no editor',
    };
    const view = editor.view;

    // Dispatch synthetic dragover
    const event = new DragEvent('dragover', {
      clientX: cx,
      clientY: cy,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(event);

    // Read indicator state
    const vertEl = document.querySelector('.column-drop-indicator') as HTMLElement;
    const horzEl = document.querySelector('.canvas-drop-guide') as HTMLElement;

    // Also check what elementsFromPoint returns at this position
    const elements = document.elementsFromPoint(cx, cy);
    const elementInfo = elements.slice(0, 5).map(e => {
      const he = e as HTMLElement;
      return `${he.tagName}.${he.className?.split?.(' ')?.[0] || ''}`;
    }).join(' > ');

    return {
      vertVisible: vertEl?.style.display === 'block',
      horzVisible: horzEl?.style.display === 'block',
      vertTop: vertEl?.style.top || '',
      vertLeft: vertEl?.style.left || '',
      vertHeight: vertEl?.style.height || '',
      horzTop: horzEl?.style.top || '',
      horzLeft: horzEl?.style.left || '',
      horzWidth: horzEl?.style.width || '',
      hasDragging: !!view.dragging,
      findTargetResult: elementInfo,
    };
  }, { cx: x, cy: y });
}

/**
 * Dispatch a synthetic drop event at specific coordinates.
 * Returns whether the drop was handled by our plugin.
 */
async function dispatchDrop(page: Page, x: number, y: number, altKey = false): Promise<boolean> {
  return page.evaluate(({ cx, cy, alt }) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return false;
    const view = editor.view;

    const event = new DragEvent('drop', {
      clientX: cx,
      clientY: cy,
      bubbles: true,
      cancelable: true,
      altKey: alt,
    });
    view.dom.dispatchEvent(event);

    // Clear view.dragging after drop
    view.dragging = null;

    return true;
  }, { cx: x, cy: y, alt: altKey });
}

/** Get bounding rect for a top-level block by index. */
async function getBlockRect(page: Page, index: number): Promise<{
  left: number; top: number; right: number; bottom: number;
  width: number; height: number;
}> {
  return page.evaluate((idx) => {
    const blocks = document.querySelectorAll('.tiptap > *');
    const block = blocks[idx] as HTMLElement;
    if (!block) throw new Error(`No block at index ${idx}`);
    const r = block.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, index);
}

/** Get bounding rect for a block inside a column. */
async function getColumnBlockRect(page: Page, colListIndex: number, colIndex: number, blockIndex: number): Promise<{
  left: number; top: number; right: number; bottom: number;
  width: number; height: number;
}> {
  return page.evaluate(({ cli, ci, bi }) => {
    const colLists = document.querySelectorAll('.tiptap > [data-type="columnList"]');
    const colList = colLists[cli] as HTMLElement;
    if (!colList) throw new Error(`No columnList at index ${cli}`);
    const columns = colList.querySelectorAll(':scope > .canvas-column');
    const col = columns[ci] as HTMLElement;
    if (!col) throw new Error(`No column at index ${ci}`);
    const blocks = col.querySelectorAll(':scope > *');
    const block = blocks[bi] as HTMLElement;
    if (!block) throw new Error(`No block at index ${bi} in column ${ci}`);
    const r = block.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, { cli: colListIndex, ci: colIndex, bi: blockIndex });
}

/** Clear drag state (call between scenarios). */
async function clearDrag(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return;
    const view = editor.view;
    view.dragging = null;

    // Hide indicators
    const vert = document.querySelector('.column-drop-indicator') as HTMLElement;
    const horz = document.querySelector('.canvas-drop-guide') as HTMLElement;
    if (vert) vert.style.display = 'none';
    if (horz) horz.style.display = 'none';
  });
}

// ═════════════════════════════════════════════════════════════════════════════

test.describe('Column Drag-Drop', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  test('zone detection, indicators, and drop outcomes', async ({
    window: page,
    electronApp,
  }) => {
    await setupCanvasPage(page, electronApp, wsPath);
    await waitForEditor(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 1: Zone detection — LEFT edge of top-level block
    // Expected: vertical indicator on left side of target
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 1: dragover LEFT edge of top-level block ═══');

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bravo' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Charlie' }] },
    ]);

    // Drag Alpha (block 0) towards Bravo (block 1)
    await startDragFromBlock(page, 0);

    const bravoRect = await getBlockRect(page, 1);
    console.log('Bravo rect:', JSON.stringify(bravoRect));

    // Target: 10px from left edge, vertically centered
    const s1 = await dispatchDragover(page, bravoRect.left + 10, bravoRect.top + bravoRect.height / 2);
    console.log('S1 result:', JSON.stringify(s1));

    // EXPECTED: vertical indicator visible, horizontal hidden
    expect(s1.hasDragging).toBe(true);
    expect(s1.vertVisible).toBe(true);
    expect(s1.horzVisible).toBe(false);

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 2: Zone detection — RIGHT edge of top-level block
    // Expected: vertical indicator on right side of target
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 2: dragover RIGHT edge of top-level block ═══');

    await startDragFromBlock(page, 0);

    // Target: 10px from right edge
    const s2 = await dispatchDragover(page, bravoRect.right - 10, bravoRect.top + bravoRect.height / 2);
    console.log('S2 result:', JSON.stringify(s2));

    expect(s2.hasDragging).toBe(true);
    expect(s2.vertVisible).toBe(true);
    expect(s2.horzVisible).toBe(false);

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 3: Zone detection — ABOVE target block
    // Expected: horizontal indicator above target
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 3: dragover ABOVE top-level block ═══');

    await startDragFromBlock(page, 0);

    // Target: center X, near top
    const s3 = await dispatchDragover(
      page,
      bravoRect.left + bravoRect.width / 2,
      bravoRect.top + 5,
    );
    console.log('S3 result:', JSON.stringify(s3));

    expect(s3.hasDragging).toBe(true);
    expect(s3.horzVisible).toBe(true);
    expect(s3.vertVisible).toBe(false);
    expect(Math.abs(parseFloat(s3.horzWidth) - bravoRect.width)).toBeLessThanOrEqual(2);

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 4: Zone detection — BELOW target block
    // Expected: horizontal indicator below target
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 4: dragover BELOW top-level block ═══');

    await startDragFromBlock(page, 0);

    const s4 = await dispatchDragover(
      page,
      bravoRect.left + bravoRect.width / 2,
      bravoRect.bottom - 5,
    );
    console.log('S4 result:', JSON.stringify(s4));

    expect(s4.hasDragging).toBe(true);
    expect(s4.horzVisible).toBe(true);
    expect(s4.vertVisible).toBe(false);
    expect(Math.abs(parseFloat(s4.horzWidth) - bravoRect.width)).toBeLessThanOrEqual(2);

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 5: Drop on LEFT creates columnList
    // Expected: Alpha and Bravo wrapped in a 2-column layout
    //   [Alpha (dragged) | Bravo (target)]
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 5: DROP on LEFT creates columnList ═══');

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bravo' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Charlie' }] },
    ]);

    await startDragFromBlock(page, 0);
    const bravoRect5 = await getBlockRect(page, 1);

    // Dragover to set activeTarget
    await dispatchDragover(page, bravoRect5.left + 10, bravoRect5.top + bravoRect5.height / 2);

    // Drop
    await dispatchDrop(page, bravoRect5.left + 10, bravoRect5.top + bravoRect5.height / 2);

    const structure5 = await getDocStructure(page);
    console.log('S5 doc structure:', JSON.stringify(structure5));

    // Expected: columnList with [Alpha|Bravo], then Charlie
    // (Alpha dragged to LEFT of Bravo → Alpha goes LEFT, Bravo goes RIGHT)
    expect(structure5.length).toBe(2);
    expect(structure5[0]).toContain('columnList:2');
    expect(structure5[0]).toContain('Alpha');
    expect(structure5[0]).toContain('Bravo');
    expect(structure5[1]).toBe('p:Charlie');

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 6: Drop on RIGHT creates columnList
    // Expected: Bravo and Alpha wrapped in a 2-column layout
    //   [Bravo (target) | Alpha (dragged)]
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 6: DROP on RIGHT creates columnList ═══');

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bravo' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Charlie' }] },
    ]);

    await startDragFromBlock(page, 0);
    const bravoRect6 = await getBlockRect(page, 1);

    await dispatchDragover(page, bravoRect6.right - 10, bravoRect6.top + bravoRect6.height / 2);
    await dispatchDrop(page, bravoRect6.right - 10, bravoRect6.top + bravoRect6.height / 2);

    const structure6 = await getDocStructure(page);
    console.log('S6 doc structure:', JSON.stringify(structure6));

    // Expected: columnList with [Bravo|Alpha], then Charlie
    expect(structure6.length).toBe(2);
    expect(structure6[0]).toContain('columnList:2');
    expect(structure6[0]).toContain('Bravo');
    expect(structure6[0]).toContain('Alpha');
    expect(structure6[1]).toBe('p:Charlie');

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 7: Drop ABOVE reorders blocks
    // Expected: Alpha moves above Bravo → [Alpha, Bravo, Charlie]
    //   (same order since Alpha is already above)
    //   Test with Charlie dragged above Bravo instead
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 7: DROP ABOVE reorders blocks ═══');

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bravo' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Charlie' }] },
    ]);

    // Drag Charlie (block 2) above Bravo (block 1)
    await startDragFromBlock(page, 2);
    const bravoRect7 = await getBlockRect(page, 1);

    await dispatchDragover(
      page,
      bravoRect7.left + bravoRect7.width / 2,
      bravoRect7.top + 5,
    );
    await dispatchDrop(
      page,
      bravoRect7.left + bravoRect7.width / 2,
      bravoRect7.top + 5,
    );

    const structure7 = await getDocStructure(page);
    console.log('S7 doc structure:', JSON.stringify(structure7));

    // Expected: [Alpha, Charlie, Bravo]
    expect(structure7).toEqual(['p:Alpha', 'p:Charlie', 'p:Bravo']);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 8: Zone detection for block INSIDE a column
    // Current bug: preventLeftRight blocks left/right for blocks in columns,
    // but drop handler correctly handles adding columns to existing columnList.
    // Expected: left/right SHOULD work for blocks inside columns.
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 8: dragover INSIDE existing column ═══');

    await setContent(page, [
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            attrs: { width: null },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'ColA' }] },
            ],
          },
          {
            type: 'column',
            attrs: { width: null },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'ColB' }] },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Outside' }] },
    ]);

    // Drag Outside (top-level block after columnList) towards ColA
    // First get the Outside block position (it's the second top-level node)
    const outsidePos = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      const doc = editor.view.state.doc;
      let pos = 0;
      for (let i = 0; i < doc.childCount - 1; i++) {
        pos += doc.child(i).nodeSize;
      }
      return pos;
    });

    // Select and drag the Outside block
    await page.evaluate((pos) => {
      const editor = (window as any).__tiptapEditor;
      const view = editor.view;
      editor.commands.setNodeSelection(pos);
      const slice = view.state.selection.content();
      view.dragging = { slice, move: true };
    }, outsidePos);

    const colARect = await getColumnBlockRect(page, 0, 0, 0);
    console.log('ColA rect:', JSON.stringify(colARect));

    // Target: left edge of ColA block
    const s8l = await dispatchDragover(page, colARect.left + 10, colARect.top + colARect.height / 2);
    console.log('S8 LEFT result:', JSON.stringify(s8l));

    // BUG CHECK: Does left/right work for blocks inside columns?
    // Current code has preventLeftRight=true for blocks inside columns.
    // This test documents the expected vs actual behavior.
    console.log('S8 LEFT: vertVisible =', s8l.vertVisible, '(expected: true)');
    console.log('S8 LEFT: horzVisible =', s8l.horzVisible, '(expected: false)');

    // We EXPECT vertical indicator (left/right should work to add a new column)
    // But current code prevents this — this test will FAIL, documenting the bug.
    expect(s8l.vertVisible).toBe(true);
    expect(s8l.horzVisible).toBe(false);

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 9: dragover on a columnList node itself
    // Expected: only above/below (no left/right — can't nest columns)
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 9: dragover on columnList node ═══');

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Top' }] },
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            attrs: { width: null },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Left' }] },
            ],
          },
          {
            type: 'column',
            attrs: { width: null },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Right' }] },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Bottom' }] },
    ]);

    await startDragFromBlock(page, 0);

    // Get the gap between columns (columnList area not inside any column)
    const gapCoords = await page.evaluate(() => {
      const cols = document.querySelectorAll('.canvas-column');
      if (cols.length < 2) throw new Error('Need at least 2 columns');
      const col1 = cols[0].getBoundingClientRect();
      const col2 = cols[1].getBoundingClientRect();
      // Gap center between col1's right and col2's left
      return {
        x: (col1.right + col2.left) / 2,
        y: (col1.top + col1.bottom) / 2,
      };
    });

    // Dragover on the gap between columns → findTarget resolves to columnList
    const s9 = await dispatchDragover(page, gapCoords.x, gapCoords.y);
    console.log('S9 result:', JSON.stringify(s9));

    // columnList targets should only allow above/below
    expect(s9.vertVisible).toBe(false);
    expect(s9.horzVisible).toBe(true);

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 10: Extract block from column by dropping outside
    // Expected: block moves to top level, column dissolves if only 1 left
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 10: Extract block from column ═══');

    await setContent(page, [
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            attrs: { width: null },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'InCol' }] },
            ],
          },
          {
            type: 'column',
            attrs: { width: null },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Keep' }] },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Below' }] },
    ]);

    // Drag InCol (first block in first column) below the Below block
    const inColPos = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      const doc = editor.view.state.doc;
      // columnList > column > paragraph("InCol")
      // doc[0] = columnList, doc[0].child(0) = column, doc[0].child(0).child(0) = paragraph
      const colList = doc.child(0); // columnList
      const col = colList.child(0); // first column
      // pos of first paragraph in first column:
      // 0 (before columnList) + 1 (inside columnList) + 1 (inside column) = 2
      return 2; // position of the paragraph inside the first column
    });

    await page.evaluate((pos) => {
      const editor = (window as any).__tiptapEditor;
      const view = editor.view;
      editor.commands.setNodeSelection(pos);
      const slice = view.state.selection.content();
      view.dragging = { slice, move: true };
    }, inColPos);

    const belowRect = await getBlockRect(page, 1);

    // Dragover below the "Below" block
    await dispatchDragover(
      page,
      belowRect.left + belowRect.width / 2,
      belowRect.bottom - 5,
    );
    await dispatchDrop(
      page,
      belowRect.left + belowRect.width / 2,
      belowRect.bottom - 5,
    );

    // Wait for auto-dissolve
    await page.waitForTimeout(300);

    const structure10 = await getDocStructure(page);
    console.log('S10 doc structure:', JSON.stringify(structure10));

    // After extracting InCol, the first column has 0 blocks → column removed.
    // Only 1 column remains → columnAutoDissolve kicks in → columnList dissolves.
    // Expected: [Keep, Below, InCol]
    expect(structure10).toEqual(['p:Keep', 'p:Below', 'p:InCol']);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 11: Debug — verify view.dragging state persists during drag
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 11: view.dragging persistence check ═══');

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
    ]);

    await startDragFromBlock(page, 0);

    const debugInfo = await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      const view = editor.view;
      return {
        hasDragging: !!view.dragging,
        sliceSize: view.dragging?.slice?.content?.size ?? -1,
        selectionFrom: view.state.selection.from,
        selectionTo: view.state.selection.to,
        selectionType: view.state.selection.constructor.name,
      };
    });
    console.log('S11 debug:', JSON.stringify(debugInfo));

    expect(debugInfo.hasDragging).toBe(true);
    expect(debugInfo.sliceSize).toBeGreaterThan(0);
    expect(debugInfo.selectionType).toContain('NodeSelection');

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 12: Debug — verify findTarget returns a block at precise coords
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 12: findTarget resolution check ═══');

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'One' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Two' }] },
    ]);

    const twoRect = await getBlockRect(page, 1);

    // Check what elementsFromPoint returns at different X positions
    const edgeTest = await page.evaluate(({ rect }) => {
      const results: { x: number; elements: string[]; }[] = [];

      // Test at left edge (rx=0), 10px in, 25px in, 50px in, center
      const testXOffsets = [0, 5, 10, 25, 50, rect.width / 2];

      for (const xOff of testXOffsets) {
        const x = rect.left + xOff;
        const y = rect.top + rect.height / 2;
        const elements = document.elementsFromPoint(x, y);
        results.push({
          x: xOff,
          elements: elements.slice(0, 5).map(e => {
            const he = e as HTMLElement;
            const tag = he.tagName?.toLowerCase() || '?';
            const cls = he.className?.toString().split?.(' ')?.[0] || '';
            const dt = he.dataset?.type || '';
            return `${tag}${cls ? '.' + cls : ''}${dt ? '[' + dt + ']' : ''}`;
          }),
        });
      }
      return results;
    }, { rect: twoRect });

    console.log('S12 element detection at various X offsets:');
    for (const r of edgeTest) {
      console.log(`  rx=${r.x}: ${r.elements.join(' > ')}`);
    }

    await clearDrag(page);

    // ═══════════════════════════════════════════════════════════════════════
    // SCENARIO 13: Background-colored blocks — drop-create columns + resize
    // Reproduces the exact user scenario from the screenshot.
    // ═══════════════════════════════════════════════════════════════════════

    console.log('\n═══ SCENARIO 13: BG-colored blocks → drop-create + resize ═══');

    await setContent(page, [
      {
        type: 'paragraph',
        attrs: { backgroundColor: 'rgba(100,50,150,0.3)' },
        content: [{ type: 'text', text: 'This is 1 Column' }],
      },
      {
        type: 'paragraph',
        attrs: { backgroundColor: 'rgba(150,130,50,0.3)' },
        content: [{ type: 'text', text: 'Column 2' }],
      },
    ]);

    // Drag first block to left of second
    await startDragFromBlock(page, 0);
    const colTarget = await getBlockRect(page, 1);
    await dispatchDragover(page, colTarget.left + 10, colTarget.top + colTarget.height / 2);
    await dispatchDrop(page, colTarget.left + 10, colTarget.top + colTarget.height / 2);
    await page.waitForTimeout(300);

    // Inspect DOM structure and alignment
    const bgColInfo = await page.evaluate(() => {
      const colList = document.querySelector('.canvas-column-list');
      if (!colList) return { error: 'no columnList' };
      const cols = Array.from(colList.querySelectorAll(':scope > .canvas-column')) as HTMLElement[];
      if (cols.length < 2) return { error: `only ${cols.length} columns` };

      const clRect = colList.getBoundingClientRect();

      const colsInfo = cols.map((col, i) => {
        const rect = col.getBoundingClientRect();
        const fc = col.firstElementChild as HTMLElement;
        const fcRect = fc?.getBoundingClientRect();
        const fcCS = fc ? window.getComputedStyle(fc) : null;
        return {
          idx: i,
          colRect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height), right: Math.round(rect.right) },
          childTag: fc?.tagName,
          childText: fc?.textContent,
          childHasBG: fc?.style.backgroundColor ? true : false,
          childBG: fc?.style.backgroundColor || 'none',
          childPadding: fcCS?.padding,
          childMargin: fcCS?.margin,
          childRect: fcRect ? { top: Math.round(fcRect.top), left: Math.round(fcRect.left), width: Math.round(fcRect.width), height: Math.round(fcRect.height) } : null,
          // Check after pseudo element
          hasAfterPseudo: i < cols.length - 1, // only non-last columns
          afterRight: col.style.cssText,
        };
      });

      // Measure the gap between columns
      const gap = cols.length >= 2 ? Math.round(cols[1].getBoundingClientRect().left - cols[0].getBoundingClientRect().right) : 0;

      return {
        columnListRect: { left: Math.round(clRect.left), width: Math.round(clRect.width), top: Math.round(clRect.top), height: Math.round(clRect.height) },
        gap,
        topAligned: cols[0].getBoundingClientRect().top === cols[1].getBoundingClientRect().top,
        topDiff: Math.round(cols[1].getBoundingClientRect().top - cols[0].getBoundingClientRect().top),
        columns: colsInfo,
      };
    });
    console.log('BG-colored column info:', JSON.stringify(bgColInfo, null, 2));

    // Test actual resize: simulate mousemove near the boundary
    const resizeBoundary = await page.evaluate(() => {
      const cols = Array.from(document.querySelectorAll('.canvas-column-list > .canvas-column')) as HTMLElement[];
      if (cols.length < 2) return { error: 'not enough columns' };
      const col1Rect = cols[0].getBoundingClientRect();
      const col2Rect = cols[1].getBoundingClientRect();
      const boundaryX = (col1Rect.right + col2Rect.left) / 2;
      const boundaryY = (col1Rect.top + col1Rect.bottom) / 2;
      return { boundaryX, boundaryY, col1Right: col1Rect.right, col2Left: col2Rect.left };
    });
    console.log('Resize boundary:', JSON.stringify(resizeBoundary));

    // Simulate mousemove at the boundary to trigger resize cursor
    await page.mouse.move(resizeBoundary.boundaryX, resizeBoundary.boundaryY);
    await page.waitForTimeout(200);

    const hasResizeCursor = await page.evaluate(() => {
      return document.body.classList.contains('column-resize-hover');
    });
    console.log('Resize cursor active at boundary:', hasResizeCursor);
    expect(hasResizeCursor).toBe(true);

    // Now simulate an actual resize drag
    const col1WidthBefore = await page.evaluate(() => {
      const col = document.querySelector('.canvas-column') as HTMLElement;
      return Math.round(col.getBoundingClientRect().width);
    });

    await page.mouse.down();
    await page.mouse.move(resizeBoundary.boundaryX + 50, resizeBoundary.boundaryY, { steps: 5 });
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(200);

    const col1WidthAfter = await page.evaluate(() => {
      const col = document.querySelector('.canvas-column') as HTMLElement;
      return Math.round(col.getBoundingClientRect().width);
    });

    console.log(`Resize: col1 width ${col1WidthBefore}px → ${col1WidthAfter}px (delta: ${col1WidthAfter - col1WidthBefore}px)`);
    expect(col1WidthAfter).toBeGreaterThan(col1WidthBefore);

    console.log('\n═══ ALL SCENARIOS COMPLETE ═══');
  });

  test('moves top-level block into a column that contains an image', async ({
    window: page,
    electronApp,
  }) => {
    await setupCanvasPage(page, electronApp, wsPath);
    await waitForEditor(page);

    await setContent(page, [
      { type: 'paragraph', content: [{ type: 'text', text: 'Move into image column' }] },
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            content: [
              { type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Target image' } },
            ],
          },
          {
            type: 'column',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Right col' }] },
            ],
          },
        ],
      },
    ]);

    await startDragFromBlock(page, 0);
    const targetRect = await getColumnBlockRect(page, 0, 1, 0);

    await dispatchDragover(
      page,
      targetRect.left + targetRect.width / 2,
      targetRect.top + 6,
    );
    await dispatchDrop(
      page,
      targetRect.left + targetRect.width / 2,
      targetRect.top + 6,
    );
    await page.waitForTimeout(300);

    const doc = await getDocJSON(page);
    const topLevel = doc.content ?? [];
    const columnListNode = topLevel.find((n: any) => n.type === 'columnList');
    expect(columnListNode).toBeTruthy();

    const collectNodes = (node: any, acc: any[] = []): any[] => {
      if (!node || typeof node !== 'object') return acc;
      acc.push(node);
      const content = Array.isArray(node.content) ? node.content : [];
      for (const child of content) collectNodes(child, acc);
      return acc;
    };

    const nestedNodes = collectNodes(columnListNode);
    const hasImage = nestedNodes.some((n) => n.type === 'image');
    const movedInsideColumnList = nestedNodes.some((n) => n.type === 'paragraph' && n.content?.[0]?.text === 'Move into image column');
    const movedStillTopLevel = topLevel.some((n: any) => n.type === 'paragraph' && n.content?.[0]?.text === 'Move into image column');

    expect(hasImage).toBe(true);
    expect(movedInsideColumnList).toBe(true);
    expect(movedStillTopLevel).toBe(false);
  });

  test('moves paragraph out of a column that also contains an image', async ({
    window: page,
    electronApp,
  }) => {
    await setupCanvasPage(page, electronApp, wsPath);
    await waitForEditor(page);

    await setContent(page, [
      {
        type: 'columnList',
        content: [
          {
            type: 'column',
            content: [
              { type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Sticky image' } },
              { type: 'paragraph', content: [{ type: 'text', text: 'Move me out' }] },
            ],
          },
          {
            type: 'column',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Right keep' }] },
            ],
          },
        ],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'Below target' }] },
    ]);

    await page.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      if (!editor) throw new Error('No editor');
      const view = editor.view;
      const doc = view.state.doc;

      let targetPos = -1;
      doc.descendants((node: any, pos: number) => {
        if (node.type.name === 'paragraph' && node.textContent === 'Move me out') {
          targetPos = pos;
          return false;
        }
        return true;
      });

      if (targetPos < 0) throw new Error('Move me out paragraph not found');

      editor.commands.setNodeSelection(targetPos);
      const slice = view.state.selection.content();
      view.dragging = { slice, move: true };
    });

    const belowRect = await getBlockRect(page, 1);
    await dispatchDragover(
      page,
      belowRect.left + belowRect.width / 2,
      belowRect.bottom - 4,
    );
    await dispatchDrop(
      page,
      belowRect.left + belowRect.width / 2,
      belowRect.bottom - 4,
    );
    await page.waitForTimeout(300);

    const doc = await getDocJSON(page);
    expect(doc.content[0].type).toBe('columnList');

    const firstColumn = doc.content[0].content[0];
    expect(firstColumn.content).toHaveLength(1);
    expect(firstColumn.content[0].type).toBe('image');

    const movedTopLevelParagraph = doc.content[2];
    expect(movedTopLevelParagraph.type).toBe('paragraph');
    expect(movedTopLevelParagraph.content?.[0]?.text).toBe('Move me out');
  });

  test('shows below drop zone and inserts under non-text blocks inside columns', async ({
    window: page,
    electronApp,
  }) => {
    await setupCanvasPage(page, electronApp, wsPath);
    await waitForEditor(page);

    const cases: Array<{ label: string; targetType: string; targetNode: any }> = [
      {
        label: 'callout',
        targetType: 'callout',
        targetNode: {
          type: 'callout',
          attrs: { emoji: 'lightbulb' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Callout target' }] }],
        },
      },
      {
        label: 'image',
        targetType: 'image',
        targetNode: { type: 'image', attrs: { src: 'https://example.com/special-target.png', alt: 'Special target image' } },
      },
      {
        label: 'mathBlock',
        targetType: 'mathBlock',
        targetNode: { type: 'mathBlock', attrs: { latex: 'x^2 + y^2 = z^2' } },
      },
      {
        label: 'video',
        targetType: 'video',
        targetNode: { type: 'video', attrs: { src: '', title: 'Video target' } },
      },
    ];

    for (const scenario of cases) {
      await setContent(page, [
        { type: 'paragraph', content: [{ type: 'text', text: 'Drag me below target' }] },
        {
          type: 'columnList',
          content: [
            {
              type: 'column',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left column' }] }],
            },
            {
              type: 'column',
              content: [scenario.targetNode],
            },
          ],
        },
      ]);

      await startDragFromBlock(page, 0);
      const targetRect = await getColumnBlockRect(page, 0, 1, 0);
      const dragoverResult = await dispatchDragover(
        page,
        targetRect.left + targetRect.width / 2,
        targetRect.bottom - 2,
      );

      expect(dragoverResult.horzVisible).toBe(true);
      expect(dragoverResult.vertVisible).toBe(false);

      await dispatchDrop(
        page,
        targetRect.left + targetRect.width / 2,
        targetRect.bottom - 2,
      );
      await page.waitForTimeout(300);

      const verification = await page.evaluate((targetType) => {
        const editor = (window as any).__tiptapEditor;
        if (!editor) throw new Error('No editor');
        const doc = editor.getJSON();
        const columnList = (doc.content || []).find((node: any) => node.type === 'columnList');
        if (!columnList) throw new Error('No columnList found');

        const secondColumnContent = columnList.content?.[1]?.content || [];
        const targetIndex = secondColumnContent.findIndex((node: any) => node.type === targetType);
        const movedIndex = secondColumnContent.findIndex(
          (node: any) => node.type === 'paragraph' && node.content?.[0]?.text === 'Drag me below target',
        );

        return {
          targetIndex,
          movedIndex,
          secondColumnTypes: secondColumnContent.map((node: any) => node.type),
          secondColumnTexts: secondColumnContent.map((node: any) => node.content?.[0]?.text || ''),
          topLevelTypes: (doc.content || []).map((node: any) => node.type),
        };
      }, scenario.targetType);

      expect(verification.targetIndex, `${scenario.label} target missing: ${JSON.stringify(verification)}`).toBeGreaterThanOrEqual(0);
      expect(verification.movedIndex, `${scenario.label} moved block missing: ${JSON.stringify(verification)}`).toBeGreaterThan(verification.targetIndex);
    }
  });
});
