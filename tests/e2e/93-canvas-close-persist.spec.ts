/**
 * E2E: Canvas close → reopen persistence (M86 "pipeline of truth").
 *
 * Drives the REAL editor through the close path that commitPageClose now owns:
 * create a page, type content, CLOSE the tab (→ CanvasEditorPane.dispose →
 * commitPageClose: flush + persist final content + checkpoint), then reopen the
 * page (→ fresh pane → _loadContent from the DB) and confirm the content
 * survived. Guards against the dispose change blanking or losing content.
 */
import { sharedTest as test, expect, openFolderViaMenu } from './fixtures';

async function openCanvasSidebar(page: import('@playwright/test').Page): Promise<void> {
  const canvasBtn = page.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
  const cls = await canvasBtn.getAttribute('class');
  if (!cls?.includes('active')) await canvasBtn.click();
  await page.waitForSelector('.canvas-tree', { timeout: 10_000 });
  await page.waitForSelector('.canvas-sidebar-add-btn', { timeout: 10_000 });
}

test.describe('Canvas — close/reopen persistence', () => {
  test('typed content survives closing the tab and reopening the page', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);
    await openCanvasSidebar(window);

    // ── Create + open a page ──
    await window.locator('.canvas-sidebar-add-btn').click();
    await window.waitForSelector('.canvas-node', { timeout: 10_000 });
    const node = window.locator('.canvas-node').first();
    await node.click();
    await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });

    // ── Type a unique marker into the body ──
    const tiptap = window.locator('.tiptap').first();
    await tiptap.click();
    const marker = `persist-marker-${Date.now()}`;
    await window.keyboard.type(marker);
    // Let the debounced auto-save settle so the tab closes cleanly.
    await window.waitForTimeout(900);

    // ── Close the editor tab (→ dispose → commitPageClose) ──
    const tab = window.locator('.editor-tab').first();
    await tab.hover();
    await tab.locator('.editor-tab-close').click({ force: true });
    await expect(window.locator('.canvas-editor-wrapper')).toHaveCount(0, { timeout: 5_000 });

    // ── Reopen the page (fresh pane reloads content from the DB) ──
    await node.click();
    await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });

    // ── The content survived the close → reopen round-trip ──
    await expect(window.locator('.tiptap').first()).toContainText(marker, { timeout: 10_000 });
  });
});
