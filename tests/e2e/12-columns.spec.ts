/**
 * E2E tests: Column Layout
 *
 * Tests all column layout features from Milestone 6:
 *
 * 1. Slash menu creation — 2, 3, and 4 columns via slash menu
 * 2. Column structure — correct DOM and ProseMirror node structure
 * 3. Typing in columns — content can be entered and persists in each column
 * 4. Nesting prevention — column items hidden from slash menu inside a column
 * 5. Column resize — drag boundary to change widths, double-click to equalize
 * 6. Ctrl/Cmd+A inside column — selects column content, not entire doc
 * 7. Block action menu — shows "Columns" label on columnList blocks
 * 8. Delete columns — deleting a columnList via block action menu
 * 9. Unwrap columns — dissolves column layout into sequential blocks
 * 10. Backspace/Delete protection — prevents column structure destruction
 * 11. Auto-dissolve — removes columnList when only one column remains
 * 12. Alignment — column content aligns with top-level content (no offset)
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

  // Open Canvas sidebar
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });

  // Create a new page
  await page.locator('.canvas-sidebar-add-btn').click();
  await page.waitForSelector('.canvas-node', { timeout: 10_000 });

  // Open the page
  await page.locator('.canvas-node').first().click();
  await page.waitForSelector('.tiptap', { timeout: 10_000 });

  // Wait for tiptap to be fully ready
  await page.waitForTimeout(500);
}

/** Wait for the TipTap editor to be exposed on window (test mode). */
async function waitForEditor(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__tiptapEditor != null,
    { timeout: 10_000 },
  );
}

/** Set editor content and wait for it to render. */
async function setContent(page: Page, content: any[]): Promise<void> {
  await page.evaluate((c) => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) throw new Error('No TipTap editor');
    editor.commands.setContent({ type: 'doc', content: c });
  }, content);
  await page.waitForTimeout(300);
}

/** Get the full TipTap document JSON structure. */
async function getDocJSON(page: Page): Promise<any> {
  return page.evaluate(() => {
    const editor = (window as any).__tiptapEditor;
    if (!editor) return null;
    return editor.getJSON();
  });
}

/** Get simplified document structure as string array. */
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
        return `columnList:${cols}`;
      }
      return type;
    });
  });
}

/** Type a slash command and select from the slash menu. */
async function insertViaSlashMenu(page: Page, label: string): Promise<void> {
  await page.keyboard.type('/');
  await page.waitForSelector('.canvas-slash-menu', { timeout: 3_000 });

  // Type enough to filter
  const filterText = label.replace(/\s+/g, '').toLowerCase();
  for (const ch of filterText) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(50);
  }

  // Click the matching item
  const item = page.locator('.canvas-slash-item', { hasText: label });
  await expect(item).toBeVisible({ timeout: 3_000 });
  await item.click();
  await page.waitForTimeout(300);
}

/** Hover over a specific top-level block by index to trigger the drag handle. */
async function hoverBlockByIndex(page: Page, index: number): Promise<void> {
  const tiptap = page.locator('.tiptap');
  const blocks = tiptap.locator(':scope > *');
  const block = blocks.nth(index);
  await block.hover();
  await page.waitForTimeout(500);
}

/** Click the drag handle to open the block action menu. */
async function openBlockActionMenu(page: Page, blockIndex: number): Promise<void> {
  await hoverBlockByIndex(page, blockIndex);
  const dragHandle = page.locator('.drag-handle');
  await expect(dragHandle).toBeVisible({ timeout: 3_000 });
  await dragHandle.click({ force: true });
  await page.waitForTimeout(200);
}

// ═════════════════════════════════════════════════════════════════════════════

test.describe('Column Layout', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  // ── Slash Menu Column Creation ────────────────────────────────────────────

  test.describe('Slash menu creation', () => {
    test('slash menu shows 2, 3, and 4 column options', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Clear content and type /
      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      ]);
      await tiptap.locator('p').first().click();
      await window.keyboard.type('/');
      await window.waitForSelector('.canvas-slash-menu', { timeout: 3_000 });

      // Type 'columns' to filter
      await window.keyboard.type('columns');
      await window.waitForTimeout(200);

      // All three column options should be visible
      const menu = window.locator('.canvas-slash-menu');
      const col2 = menu.locator('.canvas-slash-item', { hasText: '2 Columns' });
      const col3 = menu.locator('.canvas-slash-item', { hasText: '3 Columns' });
      const col4 = menu.locator('.canvas-slash-item', { hasText: '4 Columns' });

      await expect(col2).toBeVisible({ timeout: 2_000 });
      await expect(col3).toBeVisible({ timeout: 2_000 });
      await expect(col4).toBeVisible({ timeout: 2_000 });

      // Close slash menu
      await window.keyboard.press('Escape');
    });

    test('inserting 2 Columns creates a columnList with 2 columns', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      ]);
      await tiptap.locator('p').first().click();

      await insertViaSlashMenu(window, '2 Columns');

      // Verify DOM: a .canvas-column-list with 2 .canvas-column children
      const columnList = tiptap.locator('.canvas-column-list');
      await expect(columnList).toBeVisible({ timeout: 3_000 });

      const columns = columnList.locator('.canvas-column');
      await expect(columns).toHaveCount(2);

      // Verify ProseMirror structure
      const doc = await getDocJSON(window);
      const colListNode = doc.content.find((n: any) => n.type === 'columnList');
      expect(colListNode).toBeTruthy();
      expect(colListNode.content).toHaveLength(2);
      expect(colListNode.content[0].type).toBe('column');
      expect(colListNode.content[1].type).toBe('column');
    });

    test('inserting 3 Columns creates a columnList with 3 columns', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      ]);
      await tiptap.locator('p').first().click();

      await insertViaSlashMenu(window, '3 Columns');

      const columnList = tiptap.locator('.canvas-column-list');
      await expect(columnList).toBeVisible({ timeout: 3_000 });

      const columns = columnList.locator('.canvas-column');
      await expect(columns).toHaveCount(3);
    });

    test('inserting 4 Columns creates a columnList with 4 columns', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      ]);
      await tiptap.locator('p').first().click();

      await insertViaSlashMenu(window, '4 Columns');

      const columnList = tiptap.locator('.canvas-column-list');
      await expect(columnList).toBeVisible({ timeout: 3_000 });

      const columns = columnList.locator('.canvas-column');
      await expect(columns).toHaveCount(4);
    });
  });

  // ── Typing in Columns ─────────────────────────────────────────────────────

  test.describe('Content in columns', () => {
    test('can type text into each column', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Insert a 2-column layout programmatically
      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph' }] },
            { type: 'column', content: [{ type: 'paragraph' }] },
          ],
        },
      ]);

      // Click into the first column and type
      const columns = tiptap.locator('.canvas-column');
      await columns.nth(0).locator('p').click();
      await window.keyboard.type('Left column text');
      await window.waitForTimeout(200);

      // Click into the second column and type
      await columns.nth(1).locator('p').click();
      await window.keyboard.type('Right column text');
      await window.waitForTimeout(200);

      // Verify content via ProseMirror
      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeTruthy();

      const col1Text = colList.content[0].content[0].content?.[0]?.text;
      const col2Text = colList.content[1].content[0].content?.[0]?.text;
      expect(col1Text).toBe('Left column text');
      expect(col2Text).toBe('Right column text');
    });

    test('columns render as flex layout with equal widths by default', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ],
        },
      ]);

      const columnList = tiptap.locator('.canvas-column-list');
      await expect(columnList).toBeVisible({ timeout: 3_000 });

      // Verify flex display
      const display = await columnList.evaluate(el => getComputedStyle(el).display);
      expect(display).toBe('flex');

      // Both columns should have roughly equal widths (flex: 1)
      const columns = columnList.locator('.canvas-column');
      const col1Box = await columns.nth(0).boundingBox();
      const col2Box = await columns.nth(1).boundingBox();
      expect(col1Box).toBeTruthy();
      expect(col2Box).toBeTruthy();
      if (col1Box && col2Box) {
        // Widths should be within 5% of each other
        const ratio = col1Box.width / col2Box.width;
        expect(ratio).toBeGreaterThan(0.9);
        expect(ratio).toBeLessThan(1.1);
      }
    });

    test('columns with explicit width attributes render at those widths', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Set 70/30 split
      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', attrs: { width: 70 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wide' }] }] },
            { type: 'column', attrs: { width: 30 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Narrow' }] }] },
          ],
        },
      ]);

      const columns = tiptap.locator('.canvas-column');
      const col1Box = await columns.nth(0).boundingBox();
      const col2Box = await columns.nth(1).boundingBox();
      expect(col1Box).toBeTruthy();
      expect(col2Box).toBeTruthy();
      if (col1Box && col2Box) {
        // The first column should be roughly 2.3x wider than the second
        const ratio = col1Box.width / col2Box.width;
        expect(ratio).toBeGreaterThan(1.5);
      }
    });
  });

  // ── Nesting Prevention ────────────────────────────────────────────────────

  test.describe('Nesting prevention', () => {
    test('slash menu hides column options when cursor is inside a column', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Insert a 2-column layout
      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph' }] },
            { type: 'column', content: [{ type: 'paragraph' }] },
          ],
        },
      ]);

      // Click inside the first column
      const firstCol = tiptap.locator('.canvas-column').first();
      await firstCol.locator('p').click();
      await window.waitForTimeout(200);

      // Open slash menu
      await window.keyboard.type('/');
      await window.waitForSelector('.canvas-slash-menu', { timeout: 3_000 });

      // Type 'columns' to search
      await window.keyboard.type('columns');
      await window.waitForTimeout(300);

      // Column items should NOT be visible
      const menu = window.locator('.canvas-slash-menu');
      const colItems = menu.locator('.canvas-slash-item', { hasText: /Columns/ });
      const count = await colItems.count();
      expect(count).toBe(0);

      // Close slash menu
      await window.keyboard.press('Escape');
    });

    test('slash menu shows column options when cursor is outside columns', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Regular paragraph — cursor is at top level
      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: '' }] },
      ]);
      await tiptap.locator('p').first().click();

      await window.keyboard.type('/');
      await window.waitForSelector('.canvas-slash-menu', { timeout: 3_000 });
      await window.keyboard.type('columns');
      await window.waitForTimeout(300);

      // Column items SHOULD be visible
      const menu = window.locator('.canvas-slash-menu');
      const col2 = menu.locator('.canvas-slash-item', { hasText: '2 Columns' });
      await expect(col2).toBeVisible({ timeout: 2_000 });

      await window.keyboard.press('Escape');
    });
  });

  // ── Column Resize ─────────────────────────────────────────────────────────

  test.describe('Column resize', () => {
    test('dragging column boundary changes column widths', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Insert 2-column layout with equal widths
      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      const columnList = tiptap.locator('.canvas-column-list');
      await expect(columnList).toBeVisible({ timeout: 3_000 });

      const columns = columnList.locator('.canvas-column');
      const col1Box = await columns.nth(0).boundingBox();
      const col2Box = await columns.nth(1).boundingBox();
      expect(col1Box).toBeTruthy();
      expect(col2Box).toBeTruthy();

      if (col1Box && col2Box) {
        // Initial widths should be roughly equal
        const initialRatio = col1Box.width / col2Box.width;
        expect(initialRatio).toBeGreaterThan(0.8);
        expect(initialRatio).toBeLessThan(1.2);

        // Find the boundary between columns (midpoint of right edge of col1 and left edge of col2)
        const boundaryX = col1Box.x + col1Box.width;
        const boundaryY = col1Box.y + col1Box.height / 2;

        // Drag the boundary 80px to the right
        await window.mouse.move(boundaryX, boundaryY);
        await window.mouse.down();
        await window.mouse.move(boundaryX + 80, boundaryY, { steps: 10 });
        await window.mouse.up();
        await window.waitForTimeout(300);

        // After resize, left column should be wider than right
        const newCol1Box = await columns.nth(0).boundingBox();
        const newCol2Box = await columns.nth(1).boundingBox();
        expect(newCol1Box).toBeTruthy();
        expect(newCol2Box).toBeTruthy();
        if (newCol1Box && newCol2Box) {
          // Left column should now be noticeably wider
          expect(newCol1Box.width).toBeGreaterThan(newCol2Box.width);
        }
      }
    });

    test('double-clicking column boundary equalizes column widths', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Insert 2-column layout with unequal widths
      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', attrs: { width: 70 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wide' }] }] },
            { type: 'column', attrs: { width: 30 }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Narrow' }] }] },
          ],
        },
      ]);

      const columnList = tiptap.locator('.canvas-column-list');
      await expect(columnList).toBeVisible({ timeout: 3_000 });
      const columns = columnList.locator('.canvas-column');

      // Verify initially unequal
      const col1Box = await columns.nth(0).boundingBox();
      const col2Box = await columns.nth(1).boundingBox();
      expect(col1Box).toBeTruthy();
      expect(col2Box).toBeTruthy();
      if (col1Box && col2Box) {
        expect(col1Box.width).toBeGreaterThan(col2Box.width * 1.5);
      }

      // Double-click the boundary
      if (col1Box && col2Box) {
        const boundaryX = col1Box.x + col1Box.width;
        const boundaryY = col1Box.y + col1Box.height / 2;
        await window.mouse.dblclick(boundaryX, boundaryY);
        await window.waitForTimeout(300);

        // After double-click, widths should be equal (null attrs → flex: 1)
        const newCol1Box = await columns.nth(0).boundingBox();
        const newCol2Box = await columns.nth(1).boundingBox();
        expect(newCol1Box).toBeTruthy();
        expect(newCol2Box).toBeTruthy();
        if (newCol1Box && newCol2Box) {
          const ratio = newCol1Box.width / newCol2Box.width;
          expect(ratio).toBeGreaterThan(0.9);
          expect(ratio).toBeLessThan(1.1);
        }
      }
    });

    test('column width has a minimum of 10%', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      const columnList = tiptap.locator('.canvas-column-list');
      await expect(columnList).toBeVisible({ timeout: 3_000 });
      const columns = columnList.locator('.canvas-column');

      const col1Box = await columns.nth(0).boundingBox();
      const listBox = await columnList.boundingBox();
      expect(col1Box).toBeTruthy();
      expect(listBox).toBeTruthy();

      if (col1Box && listBox) {
        const boundaryX = col1Box.x + col1Box.width;
        const boundaryY = col1Box.y + col1Box.height / 2;

        // Try to drag the boundary far to the right (would make right column < 10%)
        await window.mouse.move(boundaryX, boundaryY);
        await window.mouse.down();
        // Drag almost to the right edge of the container
        await window.mouse.move(listBox.x + listBox.width - 10, boundaryY, { steps: 20 });
        await window.mouse.up();
        await window.waitForTimeout(300);

        // Right column should still have at least ~10% width
        const newCol2Box = await columns.nth(1).boundingBox();
        expect(newCol2Box).toBeTruthy();
        if (newCol2Box && listBox) {
          const minPercent = (newCol2Box.width / listBox.width) * 100;
          expect(minPercent).toBeGreaterThanOrEqual(8); // Allow small rounding tolerance
        }
      }
    });
  });

  // ── Keyboard Shortcuts ────────────────────────────────────────────────────

  test.describe('Keyboard shortcuts', () => {
    test('Ctrl+A inside a column selects only column content', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      // Insert 2 columns with distinct content, and a paragraph outside
      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'Outside text' }] },
        {
          type: 'columnList',
          content: [
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Column 1 line 1' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Column 1 line 2' }] },
              ],
            },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Column 2 content' }] },
              ],
            },
          ],
        },
      ]);

      // Click into the first column
      const firstCol = tiptap.locator('.canvas-column').first();
      await firstCol.locator('p').first().click();
      await window.waitForTimeout(200);

      // Press Ctrl+A (or Cmd+A on Mac)
      await window.keyboard.press('Control+a');
      await window.waitForTimeout(200);

      // Get the selection range
      const selection = await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        if (!editor) return null;
        const { from, to } = editor.state.selection;
        const selectedText = editor.state.doc.textBetween(from, to, '\n');
        return { from, to, selectedText };
      });

      expect(selection).toBeTruthy();
      if (selection) {
        // Should contain column 1 content but NOT "Outside text" or "Column 2 content"
        expect(selection.selectedText).toContain('Column 1 line 1');
        expect(selection.selectedText).toContain('Column 1 line 2');
        expect(selection.selectedText).not.toContain('Outside text');
        expect(selection.selectedText).not.toContain('Column 2 content');
      }
    });
  });

  // ── Block Action Menu ─────────────────────────────────────────────────────

  test.describe('Block action menu', () => {
    test('block action menu shows "Columns" label for columnList blocks', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col A' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
          ],
        },
      ]);

      // Hover over the columnList block (index 0 — it's the only top-level block)
      await openBlockActionMenu(window, 0);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Header should show "Columns"
      const header = actionMenu.locator('.block-action-header');
      await expect(header).toHaveText('Columns');
    });

    test('deleting a columnList via action menu removes it from document', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before columns' }] },
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'X' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Y' }] }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After columns' }] },
      ]);

      // Open action menu on the columnList (it's at index 1)
      await openBlockActionMenu(window, 1);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Click Delete
      const deleteBtn = actionMenu.locator('.block-action-item', { hasText: 'Delete' });
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();
      await window.waitForTimeout(300);

      // Verify columnList is gone
      const structure = await getDocStructure(window);
      expect(structure).not.toContain(expect.stringMatching(/columnList/));
      // The two paragraphs should remain
      expect(structure.find(s => s.includes('Before columns'))).toBeTruthy();
      expect(structure.find(s => s.includes('After columns'))).toBeTruthy();
    });

    test('duplicating a columnList creates a copy below', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dup test' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dup test 2' }] }] },
          ],
        },
      ]);

      await openBlockActionMenu(window, 0);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      const dupBtn = actionMenu.locator('.block-action-item', { hasText: 'Duplicate' });
      await expect(dupBtn).toBeVisible();
      await dupBtn.click();
      await window.waitForTimeout(300);

      // Should now have 2 columnLists
      const structure = await getDocStructure(window);
      const columnLists = structure.filter(s => s.startsWith('columnList'));
      expect(columnLists.length).toBe(2);
    });
  });

  // ── Column DOM Structure ──────────────────────────────────────────────────

  test.describe('DOM structure', () => {
    test('columnList has correct data-type and class attributes', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph' }] },
            { type: 'column', content: [{ type: 'paragraph' }] },
          ],
        },
      ]);

      // Check columnList attributes
      const colList = tiptap.locator('[data-type="columnList"]');
      await expect(colList).toBeVisible({ timeout: 3_000 });
      await expect(colList).toHaveClass(/canvas-column-list/);

      // Check column attributes
      const cols = colList.locator('[data-type="column"]');
      await expect(cols).toHaveCount(2);
      await expect(cols.nth(0)).toHaveClass(/canvas-column/);
      await expect(cols.nth(1)).toHaveClass(/canvas-column/);
    });

    test('columns are isolating — Enter inside column stays in column', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First line' }] }] },
            { type: 'column', content: [{ type: 'paragraph' }] },
          ],
        },
      ]);

      // Click at end of "First line" in column 1
      const firstCol = tiptap.locator('.canvas-column').first();
      await firstCol.locator('p').click();
      await window.keyboard.press('End');
      await window.waitForTimeout(100);

      // Press Enter to create new paragraph inside the column
      await window.keyboard.press('Enter');
      await window.keyboard.type('Second line');
      await window.waitForTimeout(200);

      // Verify both paragraphs are inside column 1
      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeTruthy();
      const col1 = colList.content[0];
      expect(col1.content.length).toBeGreaterThanOrEqual(2);
      expect(col1.content[0].content?.[0]?.text).toBe('First line');
      expect(col1.content[1].content?.[0]?.text).toBe('Second line');
    });
  });

  // ── Resize Cursor Feedback ────────────────────────────────────────────────

  test.describe('Resize cursor feedback', () => {
    test('hovering near column boundary shows col-resize cursor class', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
          ],
        },
      ]);

      const columns = tiptap.locator('.canvas-column');
      const col1Box = await columns.nth(0).boundingBox();
      expect(col1Box).toBeTruthy();

      if (col1Box) {
        // Move mouse to the boundary between columns
        const boundaryX = col1Box.x + col1Box.width;
        const boundaryY = col1Box.y + col1Box.height / 2;
        await window.mouse.move(boundaryX, boundaryY);
        await window.waitForTimeout(200);

        // Body should have the resize hover class
        const hasClass = await window.evaluate(
          () => document.body.classList.contains('column-resize-hover'),
        );
        expect(hasClass).toBe(true);

        // Move mouse away from boundary
        await window.mouse.move(col1Box.x + 20, col1Box.y + 20);
        await window.waitForTimeout(200);

        const hasClassAfter = await window.evaluate(
          () => document.body.classList.contains('column-resize-hover'),
        );
        expect(hasClassAfter).toBe(false);
      }
    });
  });

  // ── Unwrap Columns ────────────────────────────────────────────────────────

  test.describe('Unwrap columns', () => {
    test('block action menu shows "Unwrap columns" instead of "Turn into" for columnList', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col A' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
          ],
        },
      ]);

      await openBlockActionMenu(window, 0);
      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Should show "Unwrap columns" instead of "Turn into"
      const unwrapItem = actionMenu.locator('.block-action-item', { hasText: 'Unwrap columns' });
      await expect(unwrapItem).toBeVisible();

      const turnIntoItem = actionMenu.locator('.block-action-item', { hasText: 'Turn into' });
      await expect(turnIntoItem).not.toBeVisible();
    });

    test('unwrap columns extracts all content as sequential blocks', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
        {
          type: 'columnList',
          content: [
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Col1 Line1' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Col1 Line2' }] },
              ],
            },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Col2 Line1' }] },
              ],
            },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ]);

      // Open action menu on the columnList (index 1)
      await openBlockActionMenu(window, 1);
      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Click Unwrap columns
      const unwrapItem = actionMenu.locator('.block-action-item', { hasText: 'Unwrap columns' });
      await unwrapItem.click();
      await window.waitForTimeout(300);

      // Verify: columnList is gone, content is now sequential blocks
      const structure = await getDocStructure(window);
      expect(structure).not.toContain(expect.stringMatching(/columnList/));
      expect(structure.find(s => s.includes('Before'))).toBeTruthy();
      expect(structure.find(s => s.includes('Col1 Line1'))).toBeTruthy();
      expect(structure.find(s => s.includes('Col1 Line2'))).toBeTruthy();
      expect(structure.find(s => s.includes('Col2 Line1'))).toBeTruthy();
      expect(structure.find(s => s.includes('After'))).toBeTruthy();
    });
  });

  // ── Backspace / Delete Protection ─────────────────────────────────────────

  test.describe('Backspace and Delete protection', () => {
    test('backspace at start of column does not destroy column structure', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column A' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column B' }] }] },
          ],
        },
      ]);

      // Click at the very start of the first column's text
      const firstCol = tiptap.locator('.canvas-column').first();
      await firstCol.locator('p').click();
      await window.keyboard.press('Home');
      await window.waitForTimeout(100);

      // Press Backspace multiple times
      await window.keyboard.press('Backspace');
      await window.keyboard.press('Backspace');
      await window.waitForTimeout(200);

      // Column structure should still exist
      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeTruthy();
      expect(colList.content.length).toBe(2);
      // Text "Column A" should still be intact (cursor was at start)
      expect(colList.content[0].content[0].content?.[0]?.text).toBe('Column A');
    });

    test('delete at end of column does not merge with next column', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col A' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
          ],
        },
      ]);

      // Click at the end of Col A
      const firstCol = tiptap.locator('.canvas-column').first();
      await firstCol.locator('p').click();
      await window.keyboard.press('End');
      await window.waitForTimeout(100);

      // Press Delete multiple times
      await window.keyboard.press('Delete');
      await window.keyboard.press('Delete');
      await window.waitForTimeout(200);

      // Both columns should still exist with their text
      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeTruthy();
      expect(colList.content.length).toBe(2);
    });

    test('backspace on empty column in 2-column layout dissolves to single block', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph' }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Kept content' }] }] },
          ],
        },
      ]);

      // Click into the empty first column
      const firstCol = tiptap.locator('.canvas-column').first();
      await firstCol.locator('p').click();
      await window.waitForTimeout(100);

      // Press Backspace — should dissolve the empty column
      await window.keyboard.press('Backspace');
      await window.waitForTimeout(300);

      // columnList should be dissolved — "Kept content" should be top-level
      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeFalsy(); // No more columnList
      const hasKeptContent = doc.content.some((n: any) =>
        n.type === 'paragraph' && n.content?.[0]?.text === 'Kept content'
      );
      expect(hasKeptContent).toBe(true);
    });
  });

  // ── Content Alignment ─────────────────────────────────────────────────────

  test.describe('Content alignment', () => {
    test('column content aligns with top-level content (no indentation offset)', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'Top-level paragraph' }] },
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column text' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second col' }] }] },
          ],
        },
      ]);

      // Get left edge of top-level paragraph
      const topPara = tiptap.locator(':scope > p').first();
      const topBox = await topPara.boundingBox();

      // Get left edge of first column's paragraph
      const colPara = tiptap.locator('.canvas-column').first().locator('p');
      const colBox = await colPara.boundingBox();

      expect(topBox).toBeTruthy();
      expect(colBox).toBeTruthy();

      if (topBox && colBox) {
        // Column content should start at the same X as top-level content
        // Allow 2px tolerance for sub-pixel rendering
        expect(Math.abs(topBox.x - colBox.x)).toBeLessThanOrEqual(2);
      }
    });

    test('columns have visible gap between them', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        {
          type: 'columnList',
          content: [
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      const columns = tiptap.locator('.canvas-column');
      const col1Box = await columns.nth(0).boundingBox();
      const col2Box = await columns.nth(1).boundingBox();
      expect(col1Box).toBeTruthy();
      expect(col2Box).toBeTruthy();

      if (col1Box && col2Box) {
        // Gap between columns (right edge of col1 to left edge of col2)
        const gap = col2Box.x - (col1Box.x + col1Box.width);
        // Should have a visible gap (at least 10px)
        expect(gap).toBeGreaterThanOrEqual(10);
      }
    });
  });
});
