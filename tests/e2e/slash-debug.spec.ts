/**
 * E2E test: Slash command block insertion & visual alignment verification.
 * Creates a canvas page, inserts toggle/callout/todo via slash commands,
 * captures screenshots and bounding box data for alignment audit.
 */
import { test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';

test.describe('Slash Command Block Insertion', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  test('toggle, callout, and todo render correctly', async ({ window, electronApp }) => {
    // Setup: open workspace → canvas sidebar → create & open a page
    await openFolderViaMenu(electronApp, window, wsPath);
    await window.waitForTimeout(2000);
    await window.locator('button.activity-bar-item[data-icon-id="canvas-container"]').click();
    await window.waitForSelector('.canvas-tree', { timeout: 10_000 });
    await window.locator('.canvas-sidebar-add-btn').click();
    await window.waitForSelector('.canvas-node', { timeout: 5_000 });
    await window.locator('.canvas-node').first().click();
    await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });
    const tiptap = window.locator('.tiptap');
    await expect(tiptap).toBeVisible({ timeout: 5_000 });
    await tiptap.click();
    await window.waitForTimeout(500);

    // Helper: type slash, click first menu item, return innerHTML
    async function executeSlash(command: string) {
      await tiptap.pressSequentially('/' + command, { delay: 80 });
      await window.waitForTimeout(1000);
      const menu = window.locator('.canvas-slash-menu');
      if (await menu.isVisible()) {
        await menu.locator('.canvas-slash-item').first().click();
      }
      await window.waitForTimeout(1000);
      return tiptap.innerHTML();
    }

    // Helper: clear editor
    async function clearEditor() {
      await window.keyboard.press('Control+a');
      await window.keyboard.press('Backspace');
      await window.waitForTimeout(500);
    }

    // ── Toggle List ──
    const toggleHTML = await executeSlash('toggle');
    console.log('\n========== TOGGLE LIST ==========');
    console.log('HTML:', toggleHTML);

    // Get toggle button and summary bounding boxes for alignment check
    const toggleBtnBox = await window.locator('[data-type="details"] > button').first().boundingBox();
    const summaryBox = await window.locator('[data-type="details"] summary').first().boundingBox();
    console.log('Toggle button box:', JSON.stringify(toggleBtnBox));
    console.log('Summary box:', JSON.stringify(summaryBox));

    await window.screenshot({ path: 'test-results/block-toggle.png' });

    // Structural checks
    expect(toggleHTML).toContain('data-type="details"');
    expect(toggleHTML).not.toMatch(/data-type="details"[^>]*data-placeholder="Type/);

    // Alignment: button vertical center should be near summary vertical center
    if (toggleBtnBox && summaryBox) {
      const btnCenterY = toggleBtnBox.y + toggleBtnBox.height / 2;
      const summCenterY = summaryBox.y + summaryBox.height / 2;
      const drift = Math.abs(btnCenterY - summCenterY);
      console.log(`Toggle alignment drift: ${drift}px (btn center=${btnCenterY}, summary center=${summCenterY})`);
      expect(drift).toBeLessThan(8); // button & text should be within 8px vertically
    }

    await clearEditor();

    // ── Callout ──
    const calloutHTML = await executeSlash('callout');
    console.log('\n========== CALLOUT ==========');
    console.log('HTML:', calloutHTML);

    const iconBox = await window.locator('.canvas-callout-emoji').first().boundingBox();
    const calloutTextBox = await window.locator('.canvas-callout-content p').first().boundingBox();
    console.log('Callout icon box:', JSON.stringify(iconBox));
    console.log('Callout text box:', JSON.stringify(calloutTextBox));

    await window.screenshot({ path: 'test-results/block-callout.png' });

    expect(calloutHTML).toContain('canvas-callout');
    expect(calloutHTML).not.toMatch(/canvas-callout[^>]*data-placeholder="Type/);

    // Alignment: icon center should be near first-line text center
    if (iconBox && calloutTextBox) {
      const iconCenterY = iconBox.y + iconBox.height / 2;
      const textCenterY = calloutTextBox.y + calloutTextBox.height / 2;
      const drift = Math.abs(iconCenterY - textCenterY);
      console.log(`Callout alignment drift: ${drift}px (icon center=${iconCenterY}, text center=${textCenterY})`);
      expect(drift).toBeLessThan(8);
    }

    await clearEditor();

    // ── To-Do List ──
    const todoHTML = await executeSlash('to-do');
    console.log('\n========== TO-DO LIST ==========');
    console.log('HTML:', todoHTML);

    const checkboxBox = await window.locator('[data-type="taskList"] input[type="checkbox"]').first().boundingBox();
    const todoTextBox = await window.locator('[data-type="taskList"] li > div p').first().boundingBox();
    console.log('Todo checkbox box:', JSON.stringify(checkboxBox));
    console.log('Todo text box:', JSON.stringify(todoTextBox));

    await window.screenshot({ path: 'test-results/block-todo.png' });

    expect(todoHTML).toContain('data-type="taskList"');
    expect(todoHTML).not.toMatch(/data-type="taskList"[^>]*data-placeholder="Type/);

    // Alignment: checkbox center should be near text center
    if (checkboxBox && todoTextBox) {
      const cbCenterY = checkboxBox.y + checkboxBox.height / 2;
      const textCenterY = todoTextBox.y + todoTextBox.height / 2;
      const drift = Math.abs(cbCenterY - textCenterY);
      console.log(`Todo alignment drift: ${drift}px (checkbox center=${cbCenterY}, text center=${textCenterY})`);
      expect(drift).toBeLessThan(8);
    }
  });
});
