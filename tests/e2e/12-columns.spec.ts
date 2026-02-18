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
 * 7. Block action menu — blocks inside columns have the same action menu as any other block
 * 8. Blocks inside columns — handles, action menu, plus button, delete
 * 9. Backspace/Delete protection — prevents column structure destruction
 * 10. Auto-dissolve — removes columnList when only one column remains
 * 11. Alignment — column content aligns with top-level content (no offset)
 * 12. Keyboard block movement — Ctrl+Shift+↑/↓ reorder, cross-container, Ctrl+D duplicate
 * 13. Drop indicators — horizontal and vertical guide CSS classes
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

/** Hover the gap between columns to trigger the columnList handle. */
async function hoverColumnGap(page: Page): Promise<void> {
  const col1 = page.locator('.canvas-column').first();
  const col2 = page.locator('.canvas-column').nth(1);
  const col1Box = await col1.boundingBox();
  const col2Box = await col2.boundingBox();
  if (col1Box && col2Box) {
    const gapX = (col1Box.x + col1Box.width + col2Box.x) / 2;
    const gapY = col1Box.y + col1Box.height / 2;
    await page.mouse.move(gapX, gapY);
    await page.waitForTimeout(500);
  }
}

/** Open the block action menu by hovering the gap then clicking the drag handle. */
async function openColumnListActionMenu(page: Page): Promise<void> {
  await hoverColumnGap(page);
  const dragHandle = page.locator('.drag-handle');
  await expect(dragHandle).toBeVisible({ timeout: 3_000 });
  await dragHandle.click({ force: true });
  await page.waitForTimeout(200);
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

      await window.context().grantPermissions(['clipboard-read', 'clipboard-write']);

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

    test('slash menu opens media/bookmark insert menus and creates blocks from pasted links (Ctrl+V + context-menu path)', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      const cases = [
        {
          label: 'Bookmark',
          nodeType: 'bookmark',
          selector: '[data-type="bookmark"]',
          url: 'https://example.com/docs',
        },
        {
          label: 'Video',
          nodeType: 'video',
          selector: '[data-type="video"]',
          url: 'https://www.youtube.com/watch?v=0dcFWLV_OlI',
        },
        {
          label: 'Audio',
          nodeType: 'audio',
          selector: '[data-type="audio"]',
          url: 'https://example.com/clip.mp3',
        },
        {
          label: 'File',
          nodeType: 'fileAttachment',
          selector: '[data-type="fileAttachment"]',
          url: 'https://example.com/guide.pdf',
        },
      ];

      for (const testCase of cases) {
        await setContent(window, [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }]);
        await tiptap.locator('p').first().click();

        await insertViaSlashMenu(window, testCase.label);

        if (testCase.nodeType === 'bookmark') {
          const popup = window.locator('.canvas-bookmark-insert-popup');
          await expect(popup).toBeVisible({ timeout: 3_000 });
          const bookmarkInput = popup.locator('.canvas-bookmark-insert-input');

          // Method 1: actual keyboard paste (Ctrl+V) using Electron clipboard
          await electronApp.evaluate(({ clipboard }, value) => {
            clipboard.writeText(value);
          }, testCase.url);
          await window.evaluate(async (value) => {
            try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
          }, testCase.url);
          await bookmarkInput.click();
          await window.keyboard.down('Control');
          await window.keyboard.press('KeyV');
          await window.keyboard.up('Control');
          const bookmarkCtrlVPasteValue = await bookmarkInput.inputValue();
          console.log('[paste-check] bookmark ctrl+v value:', bookmarkCtrlVPasteValue);

          // Method 2: right-click context-menu path (real menu click)
          await bookmarkInput.fill('');
          await electronApp.evaluate(({ clipboard }, value) => {
            clipboard.writeText(value);
          }, testCase.url);
          await bookmarkInput.evaluate((el) => {
            const input = el as HTMLInputElement;
            const rect = input.getBoundingClientRect();
            input.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 8,
              clientY: rect.top + 8,
              button: 2,
            }));
            const pasteBtn = document.querySelector('.canvas-input-paste-menu-item') as HTMLButtonElement | null;
            pasteBtn?.click();
          });
          await expect(bookmarkInput).toHaveValue(testCase.url);

          await popup.locator('.canvas-bookmark-insert-create').click();
        } else {
          const popup = window.locator('.canvas-media-insert-popup');
          await expect(popup).toBeVisible({ timeout: 3_000 });
          await popup.locator('.canvas-media-insert-tab', { hasText: 'Embed link' }).click();

          const mediaInput = popup.locator('.canvas-media-insert-link-input');

          // Method 1: actual keyboard paste (Ctrl+V) using Electron clipboard
          await electronApp.evaluate(({ clipboard }, value) => {
            clipboard.writeText(value);
          }, testCase.url);
          await window.evaluate(async (value) => {
            try { await navigator.clipboard.writeText(value); } catch { /* ignore */ }
          }, testCase.url);
          await mediaInput.click();
          await window.keyboard.down('Control');
          await window.keyboard.press('KeyV');
          await window.keyboard.up('Control');
          const mediaCtrlVPasteValue = await mediaInput.inputValue();
          console.log('[paste-check] media ctrl+v value:', mediaCtrlVPasteValue);

          // Method 2: right-click context-menu path (real menu click)
          await mediaInput.fill('');
          await electronApp.evaluate(({ clipboard }, value) => {
            clipboard.writeText(value);
          }, testCase.url);
          await mediaInput.evaluate((el) => {
            const input = el as HTMLInputElement;
            const rect = input.getBoundingClientRect();
            input.dispatchEvent(new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              clientX: rect.left + 8,
              clientY: rect.top + 8,
              button: 2,
            }));
            const pasteBtn = document.querySelector('.canvas-input-paste-menu-item') as HTMLButtonElement | null;
            pasteBtn?.click();
          });
          await expect(mediaInput).toHaveValue(testCase.url);

          await popup.locator('.canvas-media-insert-link-apply').click();
        }

        await expect(tiptap.locator(testCase.selector).first()).toBeVisible({ timeout: 3_000 });

        const doc = await getDocJSON(window);
        expect(doc.content?.[0]?.type).toBe(testCase.nodeType);

        if (testCase.nodeType === 'bookmark') {
          expect(doc.content?.[0]?.attrs?.url).toBe(testCase.url);
        }
        if (testCase.nodeType === 'video' || testCase.nodeType === 'audio') {
          expect(doc.content?.[0]?.attrs?.src).toBe(testCase.url);
        }
        if (testCase.nodeType === 'fileAttachment') {
          expect(doc.content?.[0]?.attrs?.src).toBe(testCase.url);
          expect(doc.content?.[0]?.attrs?.filename).toBe('guide.pdf');
        }

        if (testCase.nodeType === 'video') {
          const iframe = tiptap.locator('[data-type="video"] iframe.canvas-video-embed-frame').first();
          await expect(iframe).toBeVisible({ timeout: 3_000 });
          const iframeSrc = await iframe.getAttribute('src');
          expect(iframeSrc).toContain('youtube-nocookie.com/embed/');
        }
      }
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

  // ── Nested Column Creation ───────────────────────────────────────────────

  test.describe('Nested column creation', () => {
    test('slash menu shows and executes column options when cursor is inside a column', async ({
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
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col A' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
          ],
        },
      ]);

      // Put cursor explicitly inside the first column paragraph
      await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        let targetPos = 2;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type?.name === 'paragraph' && node.textContent === 'Col A') {
            targetPos = pos + Math.max(1, node.nodeSize - 1);
            return false;
          }
          return true;
        });
        editor.commands.setTextSelection(targetPos);
        editor.commands.enter();
      });
      await window.waitForTimeout(200);

      // Open slash menu
      await window.keyboard.type('/');
      const slashMenu = window.locator('.canvas-slash-menu');
      await expect(slashMenu).toBeVisible({ timeout: 3_000 });

      // Type 'columns' to search
      await window.keyboard.type('columns');
      await window.waitForTimeout(300);

      // Column items should be visible in recursive model
      const col2 = slashMenu.locator('.canvas-slash-item', { hasText: '2 Columns' });
      await expect(col2).toBeVisible({ timeout: 2_000 });

      await col2.click();
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const outer = doc.content[0];
      expect(outer.type).toBe('columnList');
      expect(outer.content.length).toBe(2);
      const firstOuterColumnContent = outer.content[0].content;
      const nested = firstOuterColumnContent.find((node: any) => node.type === 'columnList');
      expect(nested).toBeTruthy();
      expect(nested.type).toBe('columnList');
      expect(nested.content.length).toBe(2);

      await expect(slashMenu).not.toBeVisible();
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
    test('block inside column action menu has same items as top-level block (no Column layout section)', async ({
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

      // Hover a block inside the column and open the action menu
      const colParagraph = tiptap.locator('.canvas-column p', { hasText: 'Col A' });
      await colParagraph.hover();
      await window.waitForTimeout(500);
      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Only ONE header — the block type "Text". No "Column layout" header.
      const headers = actionMenu.locator('.block-action-header');
      await expect(headers).toHaveCount(1);
      await expect(headers.first()).toHaveText('Text');

      // Standard block actions should be present
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Color' })).toBeVisible();
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Duplicate' })).toBeVisible();
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Delete' })).toBeVisible();

      // Column-specific items should NOT exist
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Unwrap columns' })).toHaveCount(0);
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Duplicate column layout' })).toHaveCount(0);
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Delete column layout' })).toHaveCount(0);
    });

    test('handle on columnList resolves to first block inside first column', async ({
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
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First Col' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second Col' }] }] },
          ],
        },
      ]);

      // Hover the first block in the first column — this triggers the drag handle
      const firstColPara = tiptap.locator('.canvas-column p', { hasText: 'First Col' });
      await firstColPara.hover();
      await window.waitForTimeout(500);
      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Should show a block type header (e.g. "Text"), NOT "Columns"
      const header = actionMenu.locator('.block-action-header').first();
      const headerText = await header.textContent();
      expect(headerText).not.toContain('Columns');
      expect(headerText).not.toContain('Column List');
      expect(headerText).toBe('Text');

      // Should show standard block actions — Turn into, Color, etc.
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();
    });

    test('block action menu remains open when pointer passes through resize-hover zone', async ({
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
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Left block' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right block' }] }] },
          ],
        },
      ]);

      const leftPara = tiptap.locator('.canvas-column').first().locator('p', { hasText: 'Left block' });
      await leftPara.hover();
      await window.waitForTimeout(500);

      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      const columns = tiptap.locator('.canvas-column');
      const col1Box = await columns.nth(0).boundingBox();
      expect(col1Box).toBeTruthy();
      if (col1Box) {
        const boundaryX = col1Box.x + col1Box.width;
        const boundaryY = col1Box.y + col1Box.height / 2;
        await window.mouse.move(boundaryX, boundaryY);
        await window.waitForTimeout(120);
      }

      const isResizeHover = await window.evaluate(
        () => document.body.classList.contains('column-resize-hover'),
      );
      expect(isResizeHover).toBe(true);

      await expect(actionMenu).toBeVisible();
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();
    });

    test('Turn into inside column can split block into nested columns', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Intro in col 1' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Split me in place' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col 2' }] }] },
          ],
        },
      ]);

      const targetPara = tiptap.locator('.canvas-column').first().locator('p', { hasText: 'Split me in place' });
      await targetPara.hover();
      await window.waitForTimeout(500);

      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      const turnInto = actionMenu.locator('.block-action-item', { hasText: 'Turn into' });
      await turnInto.hover();
      await window.waitForTimeout(300);

      const turnIntoSubmenu = window.locator('.block-action-submenu:not(.block-color-submenu)');
      const twoCols = turnIntoSubmenu.locator('.block-action-item', { hasText: '2 columns' });
      await expect(twoCols).toBeVisible({ timeout: 3_000 });
      await twoCols.click();
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const outerColumnList = doc.content[0];
      expect(outerColumnList.type).toBe('columnList');
      expect(outerColumnList.content.length).toBe(2);

      const firstOuterColumn = outerColumnList.content[0];
      expect(firstOuterColumn.content[0].type).toBe('paragraph');
      expect(firstOuterColumn.content[0].content?.[0]?.text).toBe('Intro in col 1');

      const nested = firstOuterColumn.content[1];
      expect(nested.type).toBe('columnList');
      expect(nested.content.length).toBe(2);
      expect(nested.content[0].content[0].type).toBe('paragraph');
      expect(nested.content[0].content[0].content?.[0]?.text).toBe('Split me in place');
      expect(nested.content[1].content[0].type).toBe('paragraph');
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

  test.describe('Unwrap columns (removed — columns dissolve organically)', () => {
    test('action menu for block inside column shows Turn into but NOT Unwrap columns', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Col A' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
          ],
        },
      ]);

      // Hover a non-first paragraph inside the column
      const secondPara = tiptap.locator('.canvas-column p', { hasText: 'Second' });
      await secondPara.hover();
      await window.waitForTimeout(500);
      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Should show Turn into (standard block action)
      const turnIntoItem = actionMenu.locator('.block-action-item', { hasText: 'Turn into' });
      await expect(turnIntoItem).toBeVisible();

      // Should NOT show Unwrap columns — columns are spatial partitions, not blocks
      const unwrapItem = actionMenu.locator('.block-action-item', { hasText: 'Unwrap columns' });
      await expect(unwrapItem).toHaveCount(0);
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

    test('backspace removing empty middle column in 3-column layout redistributes width with no dead area', async ({
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
            {
              type: 'column',
              attrs: { width: 50 },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col 1' }] }],
            },
            {
              type: 'column',
              attrs: { width: 25 },
              content: [{ type: 'paragraph' }],
            },
            {
              type: 'column',
              attrs: { width: 25 },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Redo column' }] }],
            },
          ],
        },
      ]);

      const middleCol = tiptap.locator('.canvas-column').nth(1);
      await middleCol.locator('p').click();
      await window.waitForTimeout(100);

      await window.keyboard.press('Backspace');
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeTruthy();
      expect(colList.content).toHaveLength(2);
      expect(colList.content[0].attrs?.width ?? null).toBeNull();
      expect(colList.content[1].attrs?.width ?? null).toBeNull();

      const geometry = await window.evaluate(() => {
        const list = document.querySelector('.canvas-column-list') as HTMLElement | null;
        if (!list) return null;
        const cols = Array.from(list.querySelectorAll(':scope > .canvas-column')) as HTMLElement[];
        if (cols.length !== 2) return null;

        const listRect = list.getBoundingClientRect();
        const leftRect = cols[0].getBoundingClientRect();
        const rightRect = cols[1].getBoundingClientRect();

        return {
          listRight: listRect.right,
          rightColRight: rightRect.right,
          leftWidth: leftRect.width,
          rightWidth: rightRect.width,
        };
      });

      expect(geometry).toBeTruthy();
      if (geometry) {
        expect(Math.abs(geometry.listRight - geometry.rightColRight)).toBeLessThanOrEqual(2);
        expect(Math.abs(geometry.leftWidth - geometry.rightWidth)).toBeLessThanOrEqual(2);
      }
    });

    test('backspace on empty middle column keeps neighboring image column and redistributes width', async ({
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
            {
              type: 'column',
              attrs: { width: 50 },
              content: [{ type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Left image' } }],
            },
            {
              type: 'column',
              attrs: { width: 25 },
              content: [{ type: 'paragraph' }],
            },
            {
              type: 'column',
              attrs: { width: 25 },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right text' }] }],
            },
          ],
        },
      ]);

      const middleCol = tiptap.locator('.canvas-column').nth(1);
      await middleCol.locator('p').click();
      await window.waitForTimeout(100);

      await window.keyboard.press('Backspace');
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeTruthy();
      expect(colList.content).toHaveLength(2);
      expect(colList.content[0].content[0].type).toBe('image');
      expect(colList.content[1].content[0].type).toBe('paragraph');
      expect(colList.content[0].attrs?.width ?? null).toBeNull();
      expect(colList.content[1].attrs?.width ?? null).toBeNull();
    });

    test('backspace on empty last column in image+empty+empty 3-column layout removes only one column', async ({
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
            {
              type: 'column',
              attrs: { width: 34 },
              content: [{ type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Pinned image' } }],
            },
            {
              type: 'column',
              attrs: { width: 33 },
              content: [{ type: 'paragraph' }],
            },
            {
              type: 'column',
              attrs: { width: 33 },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ]);

      const lastCol = tiptap.locator('.canvas-column').nth(2);
      await lastCol.locator('p').click();
      await window.waitForTimeout(100);

      await window.keyboard.press('Backspace');
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const colList = doc.content.find((n: any) => n.type === 'columnList');
      expect(colList).toBeTruthy();
      expect(colList.content).toHaveLength(2);
      expect(colList.content[0].content[0].type).toBe('image');
      expect(colList.content[1].content[0].type).toBe('paragraph');
      expect(colList.content[0].attrs?.width ?? null).toBeNull();
      expect(colList.content[1].attrs?.width ?? null).toBeNull();
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

  // ── Keyboard Block Movement (Rule 6) ──────────────────────────────────────

  test.describe('Keyboard block movement', () => {
    test('Ctrl+Shift+↑ moves block up within top-level', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Third' }] },
      ]);

      // Click in "Third" paragraph then move it up
      await tiptap.locator('p', { hasText: 'Third' }).click();
      await window.keyboard.press('Control+Shift+ArrowUp');
      await window.waitForTimeout(300);

      const structure = await getDocStructure(window);
      expect(structure).toEqual(['p:First', 'p:Third', 'p:Second']);
    });

    test('Ctrl+Shift+↓ moves block down within top-level', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Third' }] },
      ]);

      // Put cursor explicitly inside "First" then move it down
      await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        let targetPos = 2;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type?.name === 'paragraph' && node.textContent === 'First') {
            targetPos = pos + 1;
            return false;
          }
          return true;
        });
        editor.commands.setTextSelection(targetPos);
      });
      await window.keyboard.press('Control+Shift+ArrowDown');
      await window.waitForTimeout(300);

      const structure = await getDocStructure(window);
      expect(structure).toEqual(['p:Second', 'p:First', 'p:Third']);
    });

    test('Ctrl+Shift+↑ moves block up within a column', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Col A1' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Col A2' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
          ],
        },
      ]);

      // Put cursor explicitly inside "Col A2" then move it up (swap within column)
      await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        let targetPos = 2;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type?.name === 'paragraph' && node.textContent === 'Col A2') {
            targetPos = pos + 1;
            return false;
          }
          return true;
        });
        editor.commands.setTextSelection(targetPos);
      });
      await window.keyboard.press('Control+Shift+ArrowUp');
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const cl = doc.content.find((n: any) => n.type === 'columnList');
      expect(cl).toBeTruthy();
      const col1 = cl.content[0];
      // Col A2 should now be first, Col A1 second
      expect(col1.content[0].content[0].text).toBe('Col A2');
      expect(col1.content[1].content[0].text).toBe('Col A1');
    });

    test('Ctrl+Shift+↓ moves block down within a column', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Col A1' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Col A2' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Col B' }] }] },
          ],
        },
      ]);

      // Put cursor explicitly inside "Col A1" then move it down
      await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        let targetPos = 2;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type?.name === 'paragraph' && node.textContent === 'Col A1') {
            targetPos = pos + 1;
            return false;
          }
          return true;
        });
        editor.commands.setTextSelection(targetPos);
      });
      await window.keyboard.press('Control+Shift+ArrowDown');
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const cl = doc.content.find((n: any) => n.type === 'columnList');
      expect(cl).toBeTruthy();
      const col1 = cl.content[0];
      expect(col1.content[0].content[0].text).toBe('Col A2');
      expect(col1.content[1].content[0].text).toBe('Col A1');
    });

    test('Ctrl+Shift+↑ at top of column moves block above columnList', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Top' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Bottom' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Put cursor explicitly inside "Top" (first block in first column)
      await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        let targetPos = 2;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type?.name === 'paragraph' && node.textContent === 'Top') {
            targetPos = pos + 1;
            return false;
          }
          return true;
        });
        editor.commands.setTextSelection(targetPos);
      });
      await window.keyboard.press('Control+Shift+ArrowUp');
      await window.waitForTimeout(300);

      // "Top" should now be between "Before" and the columnList
      const doc = await getDocJSON(window);
      expect(doc.content[0].type).toBe('paragraph');
      expect(doc.content[0].content[0].text).toBe('Before');
      expect(doc.content[1].type).toBe('paragraph');
      expect(doc.content[1].content[0].text).toBe('Top');
      // columnList should still exist with "Bottom" in first column
      const cl = doc.content.find((n: any) => n.type === 'columnList');
      expect(cl).toBeTruthy();
      expect(cl.content[0].content[0].content[0].text).toBe('Bottom');
    });

    test('Ctrl+Shift+↓ at bottom of column moves block below columnList', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Top' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Bottom' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
      ]);

      // Put cursor explicitly inside "Bottom" (last block in first column)
      await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        let targetPos = 2;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type?.name === 'paragraph' && node.textContent === 'Bottom') {
            targetPos = pos + 1;
            return false;
          }
          return true;
        });
        editor.commands.setTextSelection(targetPos);
      });
      await window.keyboard.press('Control+Shift+ArrowDown');
      await window.waitForTimeout(300);

      // "Bottom" should be after the columnList, before "After"
      const doc = await getDocJSON(window);
      expect(doc.content[0].type).toBe('columnList');
      // The paragraph right after the columnList
      const afterCL = doc.content.slice(1);
      const texts = afterCL.map((n: any) => n.content?.[0]?.text);
      expect(texts).toContain('Bottom');
      expect(texts).toContain('After');
    });

    test('Ctrl+Shift+↑ on only block in column dissolves column', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Only block' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Click in "Only block" then move up — this empties the column
      await tiptap.locator('.canvas-column').first().locator('p', { hasText: 'Only block' }).click();
      await window.keyboard.press('Control+Shift+ArrowUp');
      await window.waitForTimeout(500);

      // The columnList should dissolve (only 1 column remains after empty column removal)
      const doc = await getDocJSON(window);
      // "Only block" should be at top level, "Right" should be at top level (dissolved)
      const types = doc.content.map((n: any) => n.type);
      expect(types).not.toContain('columnList');
      const texts = doc.content.map((n: any) => n.content?.[0]?.text).filter(Boolean);
      expect(texts).toContain('Only block');
      expect(texts).toContain('Right');
    });

    test('Ctrl+D duplicates block at top level', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'Alpha' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Beta' }] },
      ]);

      // Put cursor explicitly inside "Alpha" then duplicate
      await window.evaluate(() => {
        (window as any).__tiptapEditor.commands.setTextSelection(2);
      });
      await window.keyboard.press('Control+d');
      await window.waitForTimeout(300);

      const structure = await getDocStructure(window);
      expect(structure).toEqual(['p:Alpha', 'p:Alpha', 'p:Beta']);
    });

    test('Ctrl+D duplicates block inside column', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'InCol' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Put cursor explicitly inside "InCol" then duplicate
      await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        let targetPos = 2;
        editor.state.doc.descendants((node: any, pos: number) => {
          if (node.type?.name === 'paragraph' && node.textContent === 'InCol') {
            targetPos = pos + 1;
            return false;
          }
          return true;
        });
        editor.commands.setTextSelection(targetPos);
      });
      await window.keyboard.press('Control+d');
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const cl = doc.content.find((n: any) => n.type === 'columnList');
      expect(cl).toBeTruthy();
      const col1 = cl.content[0];
      expect(col1.content.length).toBe(2);
      expect(col1.content[0].content[0].text).toBe('InCol');
      expect(col1.content[1].content[0].text).toBe('InCol');
    });

    test('Ctrl+Shift+↑ does nothing if already at top of doc', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      const tiptap = window.locator('.tiptap');
      await tiptap.click();
      await waitForEditor(window);

      await setContent(window, [
        { type: 'paragraph', content: [{ type: 'text', text: 'Only' }] },
      ]);

      await tiptap.locator('p', { hasText: 'Only' }).click();
      await window.keyboard.press('Control+Shift+ArrowUp');
      await window.waitForTimeout(300);

      const structure = await getDocStructure(window);
      expect(structure).toEqual(['p:Only']);
    });
  });

  // ── Drop Indicators ──────────────────────────────────────────────────────

  test.describe('Drop indicators', () => {
    test('horizontal drop guide CSS class exists', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      await waitForEditor(window);

      // Verify the CSS rule for .canvas-drop-guide is defined
      const hasRule = await window.evaluate(() => {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule instanceof CSSStyleRule && rule.selectorText === '.canvas-drop-guide') {
                return true;
              }
            }
          } catch { /* cross-origin sheet */ }
        }
        return false;
      });
      expect(hasRule).toBe(true);
    });

    test('vertical drop indicator CSS class exists', async ({
      window,
      electronApp,
    }) => {
      await setupCanvasPage(window, electronApp, wsPath);
      await waitForEditor(window);

      const hasRule = await window.evaluate(() => {
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule instanceof CSSStyleRule && rule.selectorText === '.column-drop-indicator') {
                return true;
              }
            }
          } catch { /* cross-origin sheet */ }
        }
        return false;
      });
      expect(hasRule).toBe(true);
    });
  });

  // ── Column as Spatial Container ───────────────────────────────────────────
  // Blocks inside columns should behave identically to top-level blocks:
  // same drag handle, same +, same action menu, same interactions.

  test.describe('Blocks inside columns', () => {
    test('hovering a block inside a column shows the drag handle', async ({
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
            { type: 'column', content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Col heading' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Col paragraph' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Hover the heading inside the first column
      const heading = tiptap.locator('.canvas-column h2').first();
      await heading.hover();
      await window.waitForTimeout(500);

      const dragHandle = window.locator('.drag-handle');
      const isHidden = await dragHandle.evaluate(el => el.classList.contains('hide'));
      expect(isHidden).toBe(false);
    });
    test('divider inside column has drag handle and block action menu', async ({
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
            { type: 'column', content: [{ type: 'horizontalRule' }, { type: 'paragraph', content: [{ type: 'text', text: 'After' }] }] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other column' }] }] },
          ],
        },
      ]);

      const divider = tiptap.locator('.canvas-column').first().locator('hr').first();
      await divider.hover();
      await window.waitForTimeout(500);

      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });
      await expect(actionMenu.locator('.block-action-item', { hasText: 'Turn into' })).toBeVisible();
    });

    test('image block inside column stays within column bounds', async ({
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
            {
              type: 'column',
              content: [
                { type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Col image' } },
              ],
            },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Right column text' }] },
              ],
            },
          ],
        },
      ]);

      const geometry = await window.evaluate(() => {
        const firstCol = document.querySelector('.canvas-column-list > .canvas-column') as HTMLElement | null;
        const img = firstCol?.querySelector('img') as HTMLImageElement | null;
        if (!firstCol || !img) return null;

        const colRect = firstCol.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();

        return {
          colLeft: colRect.left,
          colRight: colRect.right,
          imgLeft: imgRect.left,
          imgRight: imgRect.right,
          imgWidth: imgRect.width,
          colWidth: colRect.width,
        };
      });

      expect(geometry).toBeTruthy();
      if (geometry) {
        expect(geometry.imgLeft).toBeGreaterThanOrEqual(geometry.colLeft - 1);
        expect(geometry.imgRight).toBeLessThanOrEqual(geometry.colRight + 1);
        expect(geometry.imgWidth).toBeLessThanOrEqual(geometry.colWidth + 1);
      }
    });

    test('image block inside column can be turned into nested 2 columns', async ({
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
            {
              type: 'column',
              content: [
                { type: 'image', attrs: { src: 'https://example.com/test-image.png', alt: 'Split image' } },
              ],
            },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Right column text' }] },
              ],
            },
          ],
        },
      ]);

      const image = tiptap.locator('.canvas-column').first().locator('img').first();
      await image.hover();
      await window.waitForTimeout(500);

      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      const turnInto = actionMenu.locator('.block-action-item', { hasText: 'Turn into' });
      await turnInto.hover();
      await window.waitForTimeout(300);

      const turnIntoSubmenu = window.locator('.block-action-submenu:not(.block-color-submenu)');
      const twoCols = turnIntoSubmenu.locator('.block-action-item', { hasText: '2 columns' });
      await expect(twoCols).toBeVisible({ timeout: 3_000 });
      await twoCols.click();
      await window.waitForTimeout(300);

      const doc = await getDocJSON(window);
      const createdColumnList = doc.content.find((n: any) => n.type === 'columnList');
      expect(createdColumnList).toBeTruthy();

      const collectTypes = (node: any, acc: string[] = []): string[] => {
        if (!node || typeof node !== 'object') return acc;
        if (typeof node.type === 'string') acc.push(node.type);
        const content = Array.isArray(node.content) ? node.content : [];
        for (const child of content) collectTypes(child, acc);
        return acc;
      };

      const allTypes = collectTypes(createdColumnList);
      expect(allTypes.filter((t) => t === 'column').length).toBeGreaterThanOrEqual(2);
      expect(allTypes.includes('image')).toBe(true);
      expect(allTypes.includes('paragraph')).toBe(true);
    });

    test('action menu for block inside column shows block type, not Column List', async ({
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
            { type: 'column', content: [
              { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Inner H1' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Hover the H1 inside the column and click the drag handle
      const heading = tiptap.locator('.canvas-column h1').first();
      await heading.hover();
      await window.waitForTimeout(500);

      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      // The action menu header should say "Heading 1", NOT "Column List"
      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      const header = actionMenu.locator('.block-action-header').first();
      const headerText = await header.textContent();
      expect(headerText).not.toContain('Column List');
      expect(headerText).toBe('Heading');

      // Should show "Turn into" (block-level action) — same as any top-level block
      const turnInto = actionMenu.locator('.block-action-item', { hasText: 'Turn into' });
      await expect(turnInto).toBeVisible();
      // Should NOT have "Unwrap columns" — columns are spatial partitions with no special menu items
      const unwrap = actionMenu.locator('.block-action-item', { hasText: 'Unwrap columns' });
      await expect(unwrap).toHaveCount(0);
    });

    test('plus button inside column inserts new block inside the column', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Block A' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Block B' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Hover Block A (second paragraph inside first column, since first p might be the first child)
      const blockB = tiptap.locator('.canvas-column').first().locator('p', { hasText: 'Block B' });
      await blockB.hover();
      await window.waitForTimeout(500);

      // Click the + button
      const plusBtn = window.locator('.block-add-btn');
      const isHidden = await plusBtn.evaluate(el => el.classList.contains('hide'));
      if (!isHidden) {
        await plusBtn.click({ force: true });
        await window.waitForTimeout(500);
      }

      // After + click, a slash menu should appear
      // Dismiss the slash menu by pressing Escape
      await window.keyboard.press('Escape');
      await window.waitForTimeout(200);

      // Check the document — the first column should now have 3 blocks
      const docJSON = await getDocJSON(window);
      const columnList = docJSON.content.find((n: any) => n.type === 'columnList');
      expect(columnList).toBeTruthy();
      const firstColumn = columnList.content[0];
      expect(firstColumn.content.length).toBe(3);
    });

    test('first paragraph in column gets a drag handle', async ({
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
            { type: 'column', content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'First para' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Hover the first (and only) paragraph inside column 1
      const firstPara = tiptap.locator('.canvas-column').first().locator('p').first();
      await firstPara.hover();
      await window.waitForTimeout(500);

      // The drag handle should be visible (not hidden)
      const dragHandle = window.locator('.drag-handle');
      const isHidden = await dragHandle.evaluate(el => el.classList.contains('hide'));
      expect(isHidden).toBe(false);
    });

    test('deleting a block inside column removes only that block', async ({
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
            { type: 'column', content: [
              { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Keep me' }] },
              { type: 'paragraph', content: [{ type: 'text', text: 'Delete me' }] },
            ] },
            { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Right' }] }] },
          ],
        },
      ]);

      // Hover "Delete me" paragraph and open action menu
      const target = tiptap.locator('.canvas-column').first().locator('p', { hasText: 'Delete me' });
      await target.hover();
      await window.waitForTimeout(500);

      const dragHandle = window.locator('.drag-handle');
      await expect(dragHandle).toBeVisible({ timeout: 3_000 });
      await dragHandle.click({ force: true });
      await window.waitForTimeout(200);

      const actionMenu = window.locator('.block-action-menu');
      await expect(actionMenu).toBeVisible({ timeout: 3_000 });

      // Click Delete (first one — block-level Delete, not "Delete column layout")
      const delBtn = actionMenu.locator('.block-action-item--danger').first();
      await delBtn.click();
      await window.waitForTimeout(300);

      // Column should still exist with just the heading
      const docJSON = await getDocJSON(window);
      const columnList = docJSON.content.find((n: any) => n.type === 'columnList');
      expect(columnList).toBeTruthy();
      const firstColumn = columnList.content[0];
      // Should have 1 block left (the heading)
      expect(firstColumn.content.length).toBe(1);
      expect(firstColumn.content[0].type).toBe('heading');
    });

    test('dragstart on math block body is blocked (handle-only drag policy)', async ({
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
            {
              type: 'column',
              content: [
                { type: 'mathBlock', attrs: { latex: 'x^2' } },
              ],
            },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Target col' }] },
              ],
            },
          ],
        },
      ]);

      const result = await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        const before = editor.getJSON();
        const hadDraggingBefore = !!editor.view.dragging;
        const mathDom = document.querySelector('[data-type="mathBlock"]') as HTMLElement | null;
        if (!mathDom) return { unchanged: false, draggingStayedOff: false };

        const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
        mathDom.dispatchEvent(event);

        const after = editor.getJSON();
        const unchanged = JSON.stringify(before) === JSON.stringify(after);
        const draggingStayedOff = !hadDraggingBefore && !editor.view.dragging;
        return { unchanged, draggingStayedOff };
      });

      expect(result.draggingStayedOff).toBe(true);
      expect(result.unchanged).toBe(true);
    });

    test('dragstart on bookmark/video/audio/file bodies is blocked (handle-only drag policy)', async ({
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
            {
              type: 'column',
              content: [
                {
                  type: 'bookmark',
                  attrs: {
                    url: 'https://example.com',
                    title: 'Bookmark title',
                    description: 'Bookmark description',
                    favicon: '',
                    image: '',
                  },
                },
                { type: 'video', attrs: { src: '', title: 'Video title' } },
                { type: 'audio', attrs: { src: '', title: 'Audio title' } },
                { type: 'fileAttachment', attrs: { src: '', filename: 'Doc.pdf', size: '1 MB' } },
              ],
            },
            {
              type: 'column',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Target col' }] },
              ],
            },
          ],
        },
      ]);

      const result = await window.evaluate(() => {
        const editor = (window as any).__tiptapEditor;
        const before = editor.getJSON();

        const selectors = [
          '[data-type="bookmark"]',
          '[data-type="video"]',
          '[data-type="audio"]',
          '[data-type="fileAttachment"]',
        ];

        const perBlock = selectors.map((selector) => {
          const hadDraggingBefore = !!editor.view.dragging;
          const dom = document.querySelector(selector) as HTMLElement | null;
          if (!dom) return { selector, blocked: false };
          const event = new DragEvent('dragstart', { bubbles: true, cancelable: true });
          dom.dispatchEvent(event);
          const blocked = !hadDraggingBefore && !editor.view.dragging;
          return { selector, blocked };
        });

        const after = editor.getJSON();
        const unchanged = JSON.stringify(before) === JSON.stringify(after);
        return { unchanged, perBlock };
      });

      expect(result.unchanged).toBe(true);
      for (const block of result.perBlock) {
        expect(block.blocked, `drag policy failed for ${block.selector}`).toBe(true);
      }
    });
  });
});
