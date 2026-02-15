/**
 * E2E tests: View toggles, keyboard shortcuts, and workspace commands.
 *
 * Verifies that toggle commands actually show/hide the correct parts,
 * and keyboard shortcuts trigger correct behavior.
 */
import { test, expect } from './fixtures';

test.describe('View Toggle Commands', () => {
  test('Ctrl+B toggles the sidebar', async ({ window }) => {
    const sidebar = window.locator('[data-part-id="workbench.parts.sidebar"]');

    const before = await sidebar.isVisible();

    await window.keyboard.press('Control+b');
    await window.waitForTimeout(500);

    const after = await sidebar.isVisible();
    expect(after).not.toBe(before);

    // Toggle back
    await window.keyboard.press('Control+b');
    await window.waitForTimeout(500);

    const restored = await sidebar.isVisible();
    expect(restored).toBe(before);
  });

  test('Toggle Panel shows/hides the panel area', async ({ window }) => {
    const panel = window.locator('[data-part-id="workbench.parts.panel"]');

    // Execute toggle panel via command palette
    await window.keyboard.press('Control+Shift+p');
    const input = window.locator('.command-palette-input');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.pressSequentially('Toggle Panel', { delay: 30 });
    await window.waitForTimeout(500);
    await window.locator('.command-palette-item').first().click();
    await window.waitForTimeout(500);

    const state1 = await panel.isVisible();

    // Toggle again
    await window.keyboard.press('Control+Shift+p');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.pressSequentially('Toggle Panel', { delay: 30 });
    await window.waitForTimeout(500);
    await window.locator('.command-palette-item').first().click();
    await window.waitForTimeout(500);

    const state2 = await panel.isVisible();

    // States should be different
    expect(state1).not.toBe(state2);
  });

  test('Toggle Status Bar shows/hides the status bar', async ({ window }) => {
    const statusBar = window.locator('[data-part-id="workbench.parts.statusbar"]');
    const before = await statusBar.isVisible();

    await window.keyboard.press('Control+Shift+p');
    const input = window.locator('.command-palette-input');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.pressSequentially('Toggle Status Bar', { delay: 30 });
    await window.waitForTimeout(500);
    await window.locator('.command-palette-item').first().click();
    await window.waitForTimeout(500);

    const after = await statusBar.isVisible();
    expect(after).not.toBe(before);

    // Restore
    await window.keyboard.press('Control+Shift+p');
    await expect(input).toBeVisible({ timeout: 3000 });
    await input.pressSequentially('Toggle Status Bar', { delay: 30 });
    await window.waitForTimeout(500);
    await window.locator('.command-palette-item').first().click();
    await window.waitForTimeout(500);
  });
});

test.describe('Activity Bar Interaction', () => {
  test('clicking an activity bar icon toggles the sidebar view', async ({ window }) => {
    const icons = window.locator('button.activity-bar-item');
    const count = await icons.count();

    if (count > 0) {
      const firstIcon = icons.first();
      const sidebar = window.locator('[data-part-id="workbench.parts.sidebar"]');

      // The sidebar starts visible (explorer is active by default).
      // Clicking the active icon should toggle the sidebar off.
      await expect(sidebar).toBeVisible({ timeout: 3000 });
      await firstIcon.click();
      await window.waitForTimeout(300);

      // Sidebar should now be hidden
      const hiddenAfterFirstClick = !(await sidebar.isVisible().catch(() => false));
      expect(hiddenAfterFirstClick).toBe(true);

      // Click the same icon again — should toggle sidebar back on
      await firstIcon.click();
      await window.waitForTimeout(300);

      await expect(sidebar).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe('Keyboard Shortcuts', () => {
  test('Ctrl+Shift+P opens command palette', async ({ window }) => {
    await window.keyboard.press('Control+Shift+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });
    await window.keyboard.press('Escape');
  });

  test('Ctrl+P opens quick access / file picker', async ({ window }) => {
    await window.keyboard.press('Control+p');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3000 });

    // The input should be empty (file picker mode, not commands)
    const input = window.locator('.command-palette-input');
    const value = await input.inputValue();
    expect(value).toBe('');

    await window.keyboard.press('Escape');
  });

  test('Ctrl+N creates a new untitled file', async ({ window }) => {
    // Count existing tabs
    const tabsBefore = await window.locator('.ui-tab').count();

    await window.keyboard.press('Control+n');
    await window.waitForTimeout(500);

    const tabsAfter = await window.locator('.ui-tab').count();
    expect(tabsAfter).toBe(tabsBefore + 1);

    // New tab should be active and say "Untitled"
    const activeTab = window.locator('.ui-tab--active');
    const label = await activeTab.locator('.ui-tab-label').textContent();
    expect(label).toMatch(/Untitled/i);
  });

  test('Ctrl+W closes the active tab', async ({ window }) => {
    // Ensure we have a tab
    await window.keyboard.press('Control+n');
    await window.waitForTimeout(300);
    const tabsBefore = await window.locator('.ui-tab').count();
    expect(tabsBefore).toBeGreaterThan(0);

    await window.keyboard.press('Control+w');
    await window.waitForTimeout(500);

    const tabsAfter = await window.locator('.ui-tab').count();
    expect(tabsAfter).toBe(tabsBefore - 1);
  });
});
