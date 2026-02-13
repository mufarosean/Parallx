/**
 * E2E tests: Command Palette (Ctrl+Shift+P) and Quick Access (Ctrl+P).
 *
 * Verifies the palette opens, shows commands/files, accepts input,
 * and executing a selection produces the expected result.
 */
import { test, expect, createTestWorkspace, cleanupTestWorkspace, openFolderViaMenu } from './fixtures';

test.describe('Command Palette (Ctrl+Shift+P)', () => {
  test('opens with Ctrl+Shift+P', async ({ window }) => {
    await window.keyboard.press('Control+Shift+p');

    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    // Input should be focused and prefilled with >
    const input = window.locator('.command-palette-input');
    await expect(input).toBeVisible();
    const value = await input.inputValue();
    expect(value).toBe('>');
  });

  test('dismisses with Escape', async ({ window }) => {
    await window.keyboard.press('Control+Shift+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    await window.keyboard.press('Escape');
    await expect(overlay).not.toBeVisible({ timeout: 3000 });
  });

  test('shows command results when typing', async ({ window }) => {
    await window.keyboard.press('Control+Shift+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    // The input is prefilled with '>'. Clear and type '>sidebar' to search for sidebar commands.
    const input = window.locator('.command-palette-input');
    await input.fill('');
    await input.pressSequentially('>sidebar', { delay: 30 });

    // Results should appear
    const items = window.locator('.command-palette-item');
    await expect(items.first()).toBeVisible({ timeout: 5000 });

    // At least one result should mention "sidebar"
    const labels = window.locator('.command-palette-item-label');
    const count = await labels.count();
    let foundSidebar = false;
    for (let i = 0; i < count; i++) {
      const text = await labels.nth(i).textContent();
      if (text && text.toLowerCase().includes('sidebar')) {
        foundSidebar = true;
        break;
      }
    }
    expect(foundSidebar).toBe(true);

    await window.keyboard.press('Escape');
  });

  test('executing a command from the palette produces a visible effect', async ({ window }) => {
    // Toggle sidebar visibility: first check if sidebar is visible
    const sidebar = window.locator('[data-part-id="workbench.parts.sidebar"]');
    const wasVisible = await sidebar.isVisible();

    await window.keyboard.press('Control+Shift+p');
    const input = window.locator('.command-palette-input');
    // Clear and type full search including '>' prefix
    await input.fill('');
    await input.pressSequentially('>toggle primary sidebar', { delay: 30 });

    await window.waitForTimeout(500);
    const items = window.locator('.command-palette-item');
    await expect(items.first()).toBeVisible({ timeout: 5000 });
    await items.first().click();

    // Sidebar visibility should have toggled
    await window.waitForTimeout(500);
    const isNowVisible = await sidebar.isVisible();

    // The state should have changed
    if (wasVisible) {
      expect(isNowVisible).toBe(false);
    } else {
      expect(isNowVisible).toBe(true);
    }

    // Toggle it back if we hid it
    if (!isNowVisible) {
      await window.keyboard.press('Control+Shift+p');
      const input2 = window.locator('.command-palette-input');
      await input2.fill('');
      await input2.pressSequentially('>toggle primary sidebar', { delay: 30 });
      await window.waitForTimeout(500);
      await window.locator('.command-palette-item').first().click();
      await window.waitForTimeout(500);
    }
  });

  test('keyboard navigation with arrow keys selects items', async ({ window }) => {
    await window.keyboard.press('Control+Shift+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    // Wait for items
    const items = window.locator('.command-palette-item');
    await expect(items.first()).toBeVisible({ timeout: 3000 });

    // The first item should be selected by default
    const firstItem = items.first();
    await expect(firstItem).toHaveClass(/selected/);

    // Press Down to move to second item
    await window.keyboard.press('ArrowDown');
    const secondItem = items.nth(1);
    if (await secondItem.isVisible()) {
      await expect(secondItem).toHaveClass(/selected/, { timeout: 1000 });
      await expect(firstItem).not.toHaveClass(/selected/);
    }

    await window.keyboard.press('Escape');
  });
});

test.describe('Quick Access / File Picker (Ctrl+P)', () => {
  let wsPath: string;

  test.beforeAll(async () => {
    wsPath = await createTestWorkspace();
  });

  test.afterAll(async () => {
    await cleanupTestWorkspace(wsPath);
  });

  test('opens with Ctrl+P', async ({ window }) => {
    await window.keyboard.press('Control+p');

    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    // Input should be focused and empty (no > prefix)
    const input = window.locator('.command-palette-input');
    const value = await input.inputValue();
    expect(value).toBe('');

    await window.keyboard.press('Escape');
  });

  test('shows file results when workspace has folders', async ({ window, electronApp }) => {
    // Open workspace folder via real File menu interaction
    await openFolderViaMenu(electronApp, window, wsPath);
    await window.waitForTimeout(1000);

    await window.keyboard.press('Control+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    // Wait for file scanning to finish (need to wait past "Searching files…")
    const realItem = window.locator('.command-palette-item-label').filter({ hasNotText: /searching/i });
    await expect(realItem.first()).toBeVisible({ timeout: 10000 });

    // Should show file results
    const items = window.locator('.command-palette-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Should show files from our test workspace
    const labels = window.locator('.command-palette-item-label');
    const allLabels: string[] = [];
    for (let i = 0; i < await labels.count(); i++) {
      allLabels.push((await labels.nth(i).textContent()) ?? '');
    }

    // At least one of our test files should appear
    const hasTestFile = allLabels.some(l =>
      l.includes('README.md') || l.includes('index.ts') || l.includes('utils.ts') || l.includes('guide.md')
    );
    expect(hasTestFile).toBe(true);

    await window.keyboard.press('Escape');
  });

  test('typing filters file results', async ({ window, electronApp }) => {
    // Ensure folder is added (may already be added from previous test)
    await openFolderViaMenu(electronApp, window, wsPath);
    await window.waitForTimeout(500);

    await window.keyboard.press('Control+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    const input = window.locator('.command-palette-input');
    // Type filter text using pressSequentially to trigger input events
    await input.pressSequentially('utils', { delay: 50 });

    // Wait for scanning to finish and results to filter
    const realItem = window.locator('.command-palette-item-label').filter({ hasNotText: /searching/i });
    await expect(realItem.first()).toBeVisible({ timeout: 10000 });

    const items = window.locator('.command-palette-item');
    const count = await items.count();

    // Should have at least 1 result matching "utils"
    expect(count).toBeGreaterThan(0);

    // The first result should contain "utils"
    const firstLabel = await items.first().locator('.command-palette-item-label').textContent();
    expect(firstLabel?.toLowerCase()).toContain('utils');

    await window.keyboard.press('Escape');
  });

  test('selecting a file result opens it in the editor', async ({ window, electronApp }) => {
    // Ensure folder is added
    await openFolderViaMenu(electronApp, window, wsPath);
    await window.waitForTimeout(500);

    await window.keyboard.press('Control+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    const input = window.locator('.command-palette-input');
    // Search for a file unique to our test workspace (guide.md under docs/)
    await input.pressSequentially('guide', { delay: 50 });

    // Wait for scanning to finish
    const realItem = window.locator('.command-palette-item-label').filter({ hasNotText: /searching/i });
    await expect(realItem.first()).toBeVisible({ timeout: 10000 });

    // Click the first result
    const items = window.locator('.command-palette-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    await items.first().click();

    // An editor tab should open with guide
    const tab = window.locator('.editor-tab', { hasText: /guide/i });
    await expect(tab).toBeVisible({ timeout: 5000 });

    // Editor should show the file content
    const textarea = window.locator('.text-editor-pane textarea, .editor-pane-container textarea');
    await expect(textarea).toBeVisible({ timeout: 5000 });
    const content = await textarea.inputValue();
    expect(content).toContain('# Guide');
  });

  test('typing > in quick open switches to command mode', async ({ window }) => {
    await window.keyboard.press('Control+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    const input = window.locator('.command-palette-input');
    await input.pressSequentially('>', { delay: 50 });
    await window.waitForTimeout(500);

    // Should now show commands, not files
    const items = window.locator('.command-palette-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Items should have command-style labels (with categories)
    const categories = window.locator('.command-palette-item-category');
    const catCount = await categories.count();
    // Commands show categories like "View:", "Editor:", etc.
    expect(catCount).toBeGreaterThan(0);

    await window.keyboard.press('Escape');
  });
});
