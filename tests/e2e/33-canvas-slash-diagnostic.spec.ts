/**
 * Canvas slash-menu + table-movement regression spec.
 *
 * Locks in the fixes shipped for the 2026-05-27 canvas bug report:
 *   - Slash-menu /table inserts a 3×3 table (header + 2 body rows).
 *   - Slash-menu /to-do inserts an empty task item whose placeholder
 *     renders on a single line (not character-per-line stacked vertically).
 *   - Mod-Shift-ArrowDown with the cursor inside a table cell selects
 *     the table and moves it past the following block. Catches both
 *     regression paths: (a) the storage wiring at canvasEditorProvider
 *     pointing at the extension-descriptor's storage instead of the
 *     editor's, and (b) `moveSelectedUp/Down` failing silently when no
 *     block was pre-selected.
 *
 * Screenshots go to `test-results/canvas-diagnostic/` for visual review
 * but the spec asserts structurally — no pixel comparisons.
 */
import { sharedTest as test, expect, setupCanvasPage, waitForEditor } from './fixtures';
import type { Page } from '@playwright/test';
import path from 'path';
import fs from 'fs/promises';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'test-results', 'canvas-diagnostic');

async function ensureScreenshotDir(): Promise<void> {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
}

async function snap(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `${name}.png`), fullPage: false });
}

async function dumpJson(page: Page): Promise<any> {
  return page.evaluate(() => {
    const ed = (window as any).__tiptapEditor;
    return ed ? ed.getJSON() : null;
  });
}

async function clearAndFocusEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const ed = (window as any).__tiptapEditor;
    if (!ed) return;
    ed.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
    ed.commands.focus('end');
  });
  await page.waitForTimeout(150);
}

async function clickIntoBody(page: Page): Promise<void> {
  const last = page.locator('.tiptap > *').last();
  await last.click();
  await page.waitForTimeout(100);
}

/**
 * Open the slash menu, type the filter, click the menu item by label.
 * Slash items are bound to `mousedown` (with preventDefault on mouseup),
 * so dispatching mousedown matches the user gesture the handler expects.
 */
async function insertViaSlashMenu(page: Page, filter: string, labelRegex: RegExp): Promise<void> {
  await clickIntoBody(page);
  await page.keyboard.type('/');
  await page.waitForSelector('.canvas-slash-menu', { state: 'visible', timeout: 5_000 });
  for (const ch of filter) {
    await page.keyboard.type(ch);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(200);
  const row = page.locator('.canvas-slash-item').filter({
    has: page.locator('.canvas-slash-label', { hasText: labelRegex }),
  }).first();
  await row.waitFor({ state: 'visible', timeout: 5_000 });
  await row.dispatchEvent('mousedown');
  await page.waitForTimeout(400);
}

test.describe('Canvas slash-menu + movement (2026-05-27 regression)', () => {

  test('slash /table inserts a 3×3 table', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await ensureScreenshotDir();
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await clearAndFocusEditor(page);

    await insertViaSlashMenu(page, 'table', /^table$/i);

    const json = await dumpJson(page);
    expect(json?.content?.[0]?.type).toBe('table');
    const tableNode = json.content[0];
    expect(tableNode.content).toHaveLength(3);
    // First row is header
    expect(tableNode.content[0].content[0].type).toBe('tableHeader');
    // Other rows are body cells
    expect(tableNode.content[1].content[0].type).toBe('tableCell');
    expect(tableNode.content[2].content[0].type).toBe('tableCell');

    expect(await page.locator('.tiptap table').count()).toBe(1);
    expect(await page.locator('.tiptap table th').count()).toBe(3);
    expect(await page.locator('.tiptap table td').count()).toBe(6);

    await snap(page, 'table-after-slash');
  });

  test('slash /to-do inserts a task item that renders on one line', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await ensureScreenshotDir();
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await clearAndFocusEditor(page);

    await insertViaSlashMenu(page, 'to-do', /to.?do/i);

    const json = await dumpJson(page);
    expect(json?.content?.[0]?.type).toBe('taskList');
    expect(json.content[0].content?.[0]?.type).toBe('taskItem');

    // The empty task item's inner paragraph wrapper must take the row's
    // remaining width — without `flex: 1 1 auto; min-width: 0;` on the div,
    // the placeholder "To-do" wraps one char per line. The DOM check: the
    // div wrapping the paragraph should have a non-zero width.
    const innerWidth = await page.evaluate(() => {
      const item = document.querySelector('.tiptap li');
      if (!item) return -1;
      const div = item.querySelector('div');
      if (!div) return -1;
      return div.getBoundingClientRect().width;
    });
    expect(innerWidth).toBeGreaterThan(50);

    await snap(page, 'todo-after-slash');
  });

  test('Mod-Shift-ArrowDown inside a table cell moves the table down', async ({
    window: page,
    electronApp,
    workspacePath,
  }) => {
    await ensureScreenshotDir();
    await setupCanvasPage(page, electronApp, workspacePath);
    await waitForEditor(page);
    await clearAndFocusEditor(page);

    await insertViaSlashMenu(page, 'table', /^table$/i);

    // Add a paragraph after the table to move past.
    await page.evaluate(() => {
      const ed = (window as any).__tiptapEditor;
      ed?.chain().focus('end').insertContent({
        type: 'paragraph',
        content: [{ type: 'text', text: 'AFTER-TABLE' }],
      }).run();
    });
    await page.waitForTimeout(200);

    const order = (j: any) =>
      (j?.content || []).map((n: any) =>
        n.type === 'paragraph' ? `p:${n.content?.[0]?.text || ''}` : n.type,
      );
    const before = order(await dumpJson(page));
    expect(before[0]).toBe('table');
    expect(before[1]).toBe('p:AFTER-TABLE');

    // Click into a cell and press the movement chord. No prior Escape needed
    // — `moveSelectedDown` bootstraps via selectAtCursor when nothing is
    // selected. This is the user's actual gesture: cursor in cell, press
    // the chord, expect the table to move.
    await page.locator('.tiptap table th, .tiptap table td').first().click();
    await page.waitForTimeout(100);
    const isMac = process.platform === 'darwin';
    await page.keyboard.press(isMac ? 'Meta+Shift+ArrowDown' : 'Control+Shift+ArrowDown');
    await page.waitForTimeout(300);

    const after = order(await dumpJson(page));
    // Table must have moved past AFTER-TABLE.
    const tableIdx = after.indexOf('table');
    const paraIdx = after.indexOf('p:AFTER-TABLE');
    expect(tableIdx).toBeGreaterThan(paraIdx);

    await snap(page, 'table-after-move');
  });
});
