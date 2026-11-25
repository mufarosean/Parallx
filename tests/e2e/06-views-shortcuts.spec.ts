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
  test('pressing a tool in the column opens its list; pressing the open tool leaves the column open', async ({ window }) => {
    const sidebar = window.locator('[data-part-id="workbench.parts.sidebar"]');
    // The tools are the rows inside the column (the right-hand ribbon has icons of its own).
    const rows = sidebar.locator('button.activity-bar-item');
    const head = window.locator('.sidebar-header-label');

    // The column starts open on the first tool, and the tools are inside it.
    await expect(sidebar).toBeVisible({ timeout: 3000 });
    await expect(rows.nth(1)).toBeVisible({ timeout: 10000 });

    // The open tool's row again: the column stays (on the old rail this hid the sidebar,
    // which in a column would hide the tools with it).
    const open = sidebar.locator('button.activity-bar-item[aria-selected="true"]');
    await open.click();
    await window.waitForTimeout(300);
    await expect(sidebar).toBeVisible();

    // Another tool's row: the head names it and its row is the selected one.
    const otherId = await sidebar.locator('button.activity-bar-item[aria-selected="false"]').first().getAttribute('data-icon-id');
    const other = sidebar.locator(`button.activity-bar-item[data-icon-id="${otherId}"]`);
    const name = await other.getAttribute('aria-label');
    await other.click();
    await expect(head).toHaveText(name ?? '');
    await expect(other).toHaveAttribute('aria-selected', 'true');
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
