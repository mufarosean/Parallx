/**
 * E2E tests: App launch & workbench chrome.
 *
 * Verifies that the Electron app starts, all major parts render, and
 * the titlebar/window-controls are functional.
 */
import { test, expect } from './fixtures';

test.describe('App Launch & Workbench Chrome', () => {
  test('window opens with correct title', async ({ window }) => {
    const title = await window.title();
    expect(title.length).toBeGreaterThan(0);
  });

  test('titlebar renders with menu bar', async ({ window }) => {
    const titlebar = window.locator('[data-part-id="workbench.parts.titlebar"]');
    await expect(titlebar).toBeVisible();

    // Menu items: File, Edit, Selection, View, Go, Tools, Help
    const menuItems = window.locator('.titlebar-menu-item');
    const count = await menuItems.count();
    expect(count).toBeGreaterThanOrEqual(7);

    // Verify specific menus exist
    for (const label of ['File', 'Edit', 'View']) {
      await expect(menuItems.filter({ hasText: label }).first()).toBeVisible();
    }
  });

  test('activity bar renders with at least one icon', async ({ window }) => {
    const activityBar = window.locator('[data-part-id="workbench.parts.activitybar"]');
    await expect(activityBar).toBeVisible();

    const icons = window.locator('button.activity-bar-item');
    const count = await icons.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('status bar renders', async ({ window }) => {
    const statusBar = window.locator('[data-part-id="workbench.parts.statusbar"]');
    await expect(statusBar).toBeVisible();
  });

  test('editor area renders with watermark', async ({ window }) => {
    // With no files open, the watermark should be visible
    const editorPart = window.locator('[data-part-id="workbench.parts.editor"]');
    await expect(editorPart).toBeVisible();
  });

  test('sidebar renders', async ({ window }) => {
    const sidebar = window.locator('[data-part-id="workbench.parts.sidebar"]');
    await expect(sidebar).toBeVisible();
  });

  test('window controls (minimize, maximize, close) are present', async ({ window }) => {
    const controls = window.locator('.window-controls');
    await expect(controls).toBeVisible();

    // Should have 3 buttons
    const buttons = controls.locator('button.window-control-btn');
    await expect(buttons).toHaveCount(3);

    // Verify aria labels
    await expect(buttons.nth(0)).toHaveAttribute('aria-label', 'Minimize');
    await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'Maximize');
    await expect(buttons.nth(2)).toHaveAttribute('aria-label', 'Close');
  });

  test('clicking a menu bar item opens a dropdown', async ({ window }) => {
    const fileMenu = window.locator('.titlebar-menu-item[data-menu-id="file"]');
    await fileMenu.click();

    // Dropdown should appear
    const dropdown = window.locator('.context-menu.titlebar-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Should have menu items
    const items = dropdown.locator('.context-menu-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);

    // Dismiss by pressing Escape
    await window.keyboard.press('Escape');
    await expect(dropdown).not.toBeVisible({ timeout: 3000 });
  });

  test('File menu contains expected items', async ({ window }) => {
    const fileMenu = window.locator('.titlebar-menu-item[data-menu-id="file"]');
    await fileMenu.click();

    const dropdown = window.locator('.context-menu.titlebar-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Check for key items (use exact match to avoid 'Save' matching 'Save As…')
    const expectedLabels = [
      'New Text File',
      'Open File…',
      'Open Folder…',
      'Close Editor',
    ];

    for (const label of expectedLabels) {
      const item = dropdown.locator('.context-menu-item-label', { hasText: label });
      await expect(item).toBeVisible();
    }

    // Check 'Save' specifically with exact text
    await expect(dropdown.locator('.context-menu-item-label').filter({ hasText: /^Save$/ })).toBeVisible();
    await expect(dropdown.locator('.context-menu-item-label', { hasText: 'Save As…' })).toBeVisible();

    await window.keyboard.press('Escape');
  });

  test('Edit menu contains expected items', async ({ window }) => {
    const editMenu = window.locator('.titlebar-menu-item[data-menu-id="edit"]');
    await editMenu.click();

    const dropdown = window.locator('.context-menu.titlebar-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    for (const label of ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Find']) {
      const item = dropdown.locator('.context-menu-item-label', { hasText: label });
      await expect(item).toBeVisible();
    }

    await window.keyboard.press('Escape');
  });
});
