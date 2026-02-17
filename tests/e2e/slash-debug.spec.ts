/**
 * E2E test: Slash command block insertion + real user interaction.
 * Tests: creation, focus/blur layout stability, typing, placeholder behavior.
 */
import { test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';

test.describe('Block Interaction Tests', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  // Reusable setup: open workspace, create canvas page, return tiptap locator
  async function setupEditor(window: any, electronApp: any, wsPath: string) {
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
    return tiptap;
  }

  // Reusable: insert a block via slash command
  async function insertBlock(tiptap: any, window: any, command: string) {
    await tiptap.pressSequentially('/' + command, { delay: 80 });
    await window.waitForTimeout(1000);
    const menu = window.locator('.canvas-slash-menu');
    if (await menu.isVisible()) {
      await menu.locator('.canvas-slash-item').first().click();
    }
    await window.waitForTimeout(500);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // CALLOUT: insertion, focus/blur stability, typing
  // ═══════════════════════════════════════════════════════════════════════
  test('callout: no layout shift on focus/blur, typing works', async ({ window, electronApp }) => {
    const tiptap = await setupEditor(window, electronApp, wsPath);

    // Insert callout
    await insertBlock(tiptap, window, 'callout');

    // Callout should exist
    const callout = window.locator('.canvas-callout').first();
    await expect(callout).toBeVisible();

    // ── Measure bounding box WHILE focused (cursor inside callout) ──
    const boxFocused = await callout.boundingBox();
    console.log('Callout focused box:', JSON.stringify(boxFocused));
    await window.screenshot({ path: 'test-results/callout-focused.png' });

    // ── Click OUTSIDE the callout (on the trailing paragraph below) ──
    const trailingP = tiptap.locator('> p').last();
    await trailingP.click();
    await window.waitForTimeout(300);

    const boxBlurred = await callout.boundingBox();
    console.log('Callout blurred box:', JSON.stringify(boxBlurred));
    await window.screenshot({ path: 'test-results/callout-blurred.png' });

    // ── CORE ASSERTION: height should NOT change on blur ──
    expect(boxFocused).toBeTruthy();
    expect(boxBlurred).toBeTruthy();
    if (boxFocused && boxBlurred) {
      const heightDiff = Math.abs(boxFocused.height - boxBlurred.height);
      console.log(`Callout height shift: ${heightDiff}px (focused=${boxFocused.height}, blurred=${boxBlurred.height})`);
      expect(heightDiff).toBeLessThanOrEqual(2); // Max 2px tolerance
    }

    // ── Click BACK into callout, type text ──
    const calloutP = window.locator('.canvas-callout-content p').first();
    await calloutP.click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Hello callout');
    await window.waitForTimeout(300);

    const calloutText = await calloutP.textContent();
    expect(calloutText).toContain('Hello callout');

    // Placeholder should be gone after typing
    const htmlAfterType = await callout.innerHTML();
    expect(htmlAfterType).not.toContain('is-empty');

    await window.screenshot({ path: 'test-results/callout-typed.png' });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TO-DO: insertion, focus/blur stability, typing, checkbox toggle
  // ═══════════════════════════════════════════════════════════════════════
  test('todo: no layout shift on focus/blur, checkbox works', async ({ window, electronApp }) => {
    const tiptap = await setupEditor(window, electronApp, wsPath);

    // Insert todo
    await insertBlock(tiptap, window, 'to-do');

    const todoList = window.locator('ul[data-type="taskList"]').first();
    await expect(todoList).toBeVisible();

    // ── Measure FOCUSED ──
    const boxFocused = await todoList.boundingBox();
    console.log('Todo focused box:', JSON.stringify(boxFocused));
    await window.screenshot({ path: 'test-results/todo-focused.png' });

    // ── Click outside ──
    const trailingP = tiptap.locator('> p').last();
    await trailingP.click();
    await window.waitForTimeout(300);

    const boxBlurred = await todoList.boundingBox();
    console.log('Todo blurred box:', JSON.stringify(boxBlurred));
    await window.screenshot({ path: 'test-results/todo-blurred.png' });

    // ── CORE ASSERTION: no height shift ──
    expect(boxFocused).toBeTruthy();
    expect(boxBlurred).toBeTruthy();
    if (boxFocused && boxBlurred) {
      const heightDiff = Math.abs(boxFocused.height - boxBlurred.height);
      console.log(`Todo height shift: ${heightDiff}px (focused=${boxFocused.height}, blurred=${boxBlurred.height})`);
      expect(heightDiff).toBeLessThanOrEqual(2);
    }

    // ── Click back in, type text ──
    const todoP = window.locator('[data-type="taskList"] li > div p').first();
    await todoP.click();
    await window.waitForTimeout(200);
    await window.keyboard.type('Buy groceries');
    await window.waitForTimeout(300);

    const todoText = await todoP.textContent();
    expect(todoText).toContain('Buy groceries');
    await window.screenshot({ path: 'test-results/todo-typed.png' });

    // ── Click checkbox to toggle checked state ──
    const checkbox = window.locator('[data-type="taskList"] input[type="checkbox"]').first();
    await checkbox.click();
    await window.waitForTimeout(300);

    const li = window.locator('[data-type="taskList"] li').first();
    const checkedAttr = await li.getAttribute('data-checked');
    expect(checkedAttr).toBe('true');
    await window.screenshot({ path: 'test-results/todo-checked.png' });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // TOGGLE: insertion, focus/blur stability, typing, expand/collapse
  // ═══════════════════════════════════════════════════════════════════════
  test('toggle: no layout shift on focus/blur, expand/collapse works', async ({ window, electronApp }) => {
    const tiptap = await setupEditor(window, electronApp, wsPath);

    // Insert toggle
    await insertBlock(tiptap, window, 'toggle');

    const toggle = window.locator('[data-type="details"]').first();
    await expect(toggle).toBeVisible();

    // ── Measure FOCUSED (cursor should be in summary) ──
    const boxFocused = await toggle.boundingBox();
    console.log('Toggle focused box:', JSON.stringify(boxFocused));
    await window.screenshot({ path: 'test-results/toggle-focused.png' });

    // ── Click outside ──
    const trailingP = tiptap.locator('> p').last();
    await trailingP.click();
    await window.waitForTimeout(300);

    const boxBlurred = await toggle.boundingBox();
    console.log('Toggle blurred box:', JSON.stringify(boxBlurred));
    await window.screenshot({ path: 'test-results/toggle-blurred.png' });

    // ── CORE ASSERTION: no height shift ──
    expect(boxFocused).toBeTruthy();
    expect(boxBlurred).toBeTruthy();
    if (boxFocused && boxBlurred) {
      const heightDiff = Math.abs(boxFocused.height - boxBlurred.height);
      console.log(`Toggle height shift: ${heightDiff}px (focused=${boxFocused.height}, blurred=${boxBlurred.height})`);
      expect(heightDiff).toBeLessThanOrEqual(2);
    }

    // ── Type in summary ──
    const summary = window.locator('[data-type="details"] summary').first();
    await summary.click();
    await window.waitForTimeout(200);
    await window.keyboard.type('My toggle title');
    await window.waitForTimeout(300);

    const summaryText = await summary.textContent();
    expect(summaryText).toContain('My toggle title');
    await window.screenshot({ path: 'test-results/toggle-titled.png' });

    // ── Click toggle button to expand ──
    const toggleBtn = window.locator('[data-type="details"] > button').first();
    await toggleBtn.click();
    await window.waitForTimeout(500);

    // After expand, detailsContent should be visible (hidden attr removed)
    const content = window.locator('[data-type="detailsContent"]').first();
    const hiddenAttr = await content.getAttribute('hidden');
    console.log('detailsContent hidden attr after toggle:', hiddenAttr);
    // When open, hidden should be null (removed)
    await window.screenshot({ path: 'test-results/toggle-expanded.png' });

    // Check toggle has is-open class
    const toggleClass = await toggle.getAttribute('class');
    console.log('Toggle class after expand:', toggleClass);
  });
});
