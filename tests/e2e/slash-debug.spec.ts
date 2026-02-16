/**
 * E2E test: Slash command block insertion verification.
 * Creates a canvas page, executes slash commands for toggle, callout, and todo,
 * then verifies the rendered HTML doesn't have misplaced placeholder text.
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

  test('toggle, callout, and todo render without stale placeholder text', async ({ window, electronApp }) => {
    // Setup: open workspace, canvas sidebar, create & open a page
    await openFolderViaMenu(electronApp, window, wsPath);
    await window.waitForTimeout(2000);
    const canvasBtn = window.locator('button.activity-bar-item[data-icon-id="canvas-container"]');
    await canvasBtn.click();
    await window.waitForSelector('.canvas-tree', { timeout: 10_000 });
    await window.locator('.canvas-sidebar-add-btn').click();
    await window.waitForSelector('.canvas-node', { timeout: 5_000 });
    await window.locator('.canvas-node').first().click();
    await window.waitForSelector('.canvas-editor-wrapper', { timeout: 10_000 });
    const tiptap = window.locator('.tiptap');
    await expect(tiptap).toBeVisible({ timeout: 5_000 });
    await tiptap.click();
    await window.waitForTimeout(500);

    // Helper: type slash command and click the first menu item
    async function executeSlash(command: string) {
      await tiptap.pressSequentially('/' + command, { delay: 80 });
      await window.waitForTimeout(1000);
      const menu = window.locator('.canvas-slash-menu');
      if (await menu.isVisible()) {
        await menu.locator('.canvas-slash-item').first().click();
      }
      await window.waitForTimeout(1000);
      return await tiptap.innerHTML();
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
    await window.screenshot({ path: 'test-results/slash-toggle.png' });

    // Verify: the details wrapper should NOT have "Type '/' for commands..." placeholder
    expect(toggleHTML).not.toMatch(/data-type="details"[^>]*data-placeholder="Type/);
    // Verify: details node is present
    expect(toggleHTML).toContain('data-type="details"');

    await clearEditor();

    // ── Callout ──
    const calloutHTML = await executeSlash('callout');
    console.log('\n========== CALLOUT ==========');
    console.log('HTML:', calloutHTML);
    await window.screenshot({ path: 'test-results/slash-callout.png' });

    // Verify: callout wrapper should NOT have slash placeholder
    expect(calloutHTML).toContain('canvas-callout');
    expect(calloutHTML).not.toMatch(/canvas-callout[^>]*data-placeholder="Type/);

    await clearEditor();

    // ── To-Do List ──
    const todoHTML = await executeSlash('to-do');
    console.log('\n========== TO-DO LIST ==========');
    console.log('HTML:', todoHTML);
    await window.screenshot({ path: 'test-results/slash-todo.png' });

    // Verify: taskList/taskItem wrapper should NOT have slash placeholder
    expect(todoHTML).toContain('data-type="taskList"');
    expect(todoHTML).not.toMatch(/data-type="taskList"[^>]*data-placeholder="Type/);
    expect(todoHTML).not.toMatch(/data-type="taskItem"[^>]*data-placeholder="Type/);
  });
});
