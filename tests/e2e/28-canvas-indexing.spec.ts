import { test, expect, setupCanvasPage } from './fixtures';

async function openIndexingPanel(page: import('@playwright/test').Page): Promise<void> {
  const panel = page.locator('[data-part-id="workbench.parts.panel"]');
  if (!(await panel.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+J');
    await expect(panel).toBeVisible({ timeout: 10_000 });
  }

  const indexingTab = panel.locator('.view-tab[data-view-id="view.indexingLog"]');
  await expect(indexingTab).toBeVisible({ timeout: 10_000 });
  await indexingTab.click();

  await expect(panel.locator('.indexing-log-container')).toBeVisible({ timeout: 10_000 });
}

test.describe('Canvas incremental indexing', () => {
  test('typing in a canvas page produces a new indexing log entry', async ({ window, electronApp, workspacePath }) => {
    await setupCanvasPage(window, electronApp, workspacePath);

    const title = window.locator('.canvas-page-title');
    await title.click();
    await title.fill('Incremental Indexing Page');
    await window.keyboard.press('Enter');
    await window.waitForTimeout(4_000);

    await openIndexingPanel(window);

    const indexingView = window.locator('[data-part-id="workbench.parts.panel"] .indexing-log-container');
    const clearBtn = indexingView.locator('.indexing-log-toolbar-btn[title="Clear log"]');
    await clearBtn.click();

    await expect(indexingView.locator('.indexing-log-row')).toHaveCount(0);
    await expect(indexingView.locator('.indexing-log-count--total')).toHaveText('Total: 0');

    const editor = window.locator('.canvas-tiptap-editor');
    await window.evaluate(() => {
      const editor = (window as any).__tiptapEditor;
      if (!editor) throw new Error('No TipTap editor');
      editor.commands.focus('end');
    });
    await window.waitForTimeout(150);
    await window.keyboard.type('hello incremental indexing');

    await expect(editor).toContainText('incremental indexing');

    await expect.poll(async () => {
      return window.evaluate(async () => {
        const result = await (window as any).parallxElectron.database.get(
          'SELECT content FROM pages WHERE title = ?',
          ['Incremental Indexing Page'],
        );
        return result.row?.content ?? null;
      });
    }, {
      timeout: 5_000,
      intervals: [250, 500, 1000],
    }).toContain('incremental indexing');

    await expect.poll(async () => {
      return window.evaluate(async () => {
        const result = await (window as any).parallxElectron.database.get(
          `SELECT im.indexed_at as indexedAt
             FROM pages p
             LEFT JOIN indexing_metadata im
               ON im.source_type = 'page_block'
              AND im.source_id = p.id
            WHERE p.title = ?`,
          ['Incremental Indexing Page'],
        );
        return result.row?.indexedAt ?? null;
      });
    }, {
      timeout: 10_000,
      intervals: [250, 500, 1000],
    }).not.toBeNull();

    await expect.poll(async () => {
      return indexingView.locator('.indexing-log-row').count();
    }, {
      timeout: 10_000,
      intervals: [250, 500, 1000],
    }).toBe(1);

    await expect(indexingView.locator('.indexing-log-count--indexed')).toHaveText('Indexed: 1');
    await expect(indexingView.locator('.indexing-log-name')).toContainText('Incremental Indexing Page');
  });
});