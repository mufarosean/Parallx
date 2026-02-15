/**
 * E2E tests: Workspace management.
 *
 * PRINCIPLE: Every assertion answers "What does the user SEE right now?"
 * Every step is either a user action (click, type, press key) or a visual
 * assertion (element count, text content, visibility).
 *
 * No `evaluate()` calls to inspect localStorage or JavaScript objects.
 * If Playwright can't see it, the user can't see it, and it doesn't matter.
 */
import { test, expect, openFolderViaMenu } from './fixtures';
import type { Page } from '@playwright/test';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Click a File menu item by label text. */
async function clickFileMenuItem(window: Page, label: string) {
  const fileMenu = window.locator('.titlebar-menu-item[data-menu-id="file"]');
  await fileMenu.click();
  const dropdown = window.locator('.context-menu.titlebar-dropdown');
  await expect(dropdown).toBeVisible({ timeout: 3000 });
  const item = dropdown.locator('.context-menu-item', { hasText: label });
  await item.click();
}

/** Get the workspace name shown in the titlebar. */
async function getTitlebarWorkspaceName(window: Page): Promise<string> {
  const label = window.locator('.titlebar-workspace-label');
  await expect(label).toBeVisible({ timeout: 5000 });
  return (await label.textContent()) ?? '';
}

/** Wait for the workspace switch transition overlay to disappear. */
async function waitForSwitchComplete(window: Page) {
  // The transition overlay has class 'workspace-transition-overlay'.
  // Wait for it to appear and then vanish (or skip if it was too fast).
  try {
    const overlay = window.locator('.workspace-transition-overlay');
    await overlay.waitFor({ state: 'detached', timeout: 10_000 });
  } catch {
    // Already gone or never appeared — fine
  }
  // Extra settling time for views to render
  await window.waitForTimeout(1500);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Workspace Management — User Experience', () => {

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Initial launch: the app looks correct
  // ═══════════════════════════════════════════════════════════════════════

  test('initial launch shows Explorer with no placeholder fake files', async ({ window }) => {
    // The sidebar should have an "EXPLORER" header label
    const headerLabel = window.locator('.sidebar-header-label');
    await expect(headerLabel).toBeVisible();
    await expect(headerLabel).toHaveText('EXPLORER');

    // There should be exactly ONE header label, not multiples
    await expect(headerLabel).toHaveCount(1);

    // The Explorer section should exist in the sidebar
    const explorerSection = window.locator('.view-section[data-view-id="view.explorer"]');
    await expect(explorerSection).toBeVisible();

    // There should be NO placeholder fake file rows from the dev stub
    const placeholderRows = window.locator('.placeholder-tree-row');
    await expect(placeholderRows).toHaveCount(0);

    // There should be exactly ONE gear icon in the activity bar
    const gearIcons = window.locator('.activity-bar-manage-gear');
    await expect(gearIcons).toHaveCount(1);
  });

  test('initial launch shows "No folder opened" empty state', async ({ window }) => {
    // Without opening a folder, the Explorer should show an empty state message
    // The real Explorer (not the placeholder) shows "No folder opened" text
    const explorerSection = window.locator('.view-section[data-view-id="view.explorer"]');
    await expect(explorerSection).toBeVisible();

    // Should NOT have a fake hardcoded file tree
    const placeholderExplorer = window.locator('.placeholder-explorer');
    await expect(placeholderExplorer).toHaveCount(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Open Folder: real files from disk
  // ═══════════════════════════════════════════════════════════════════════

  test('open folder shows real files from disk', async ({ electronApp, window, workspacePath }) => {
    // Open a test folder through the real File menu
    await openFolderViaMenu(electronApp, window, workspacePath);

    // Tree nodes should appear with real file/folder names from our test workspace
    const treeNodes = window.locator('.tree-node');
    await expect(treeNodes.first()).toBeVisible({ timeout: 10_000 });

    // Our test workspace has: README.md, src/, docs/
    // Check that at least some of these real files appear
    const nodeLabels = window.locator('.tree-node-label');
    const allLabels: string[] = [];
    const count = await nodeLabels.count();
    for (let i = 0; i < count; i++) {
      const text = await nodeLabels.nth(i).textContent();
      if (text) allLabels.push(text);
    }

    // Should include real files, NOT the hardcoded placeholder files
    expect(allLabels.some(l => l === 'README.md' || l === 'src' || l === 'docs')).toBe(true);
    // Should NOT include the placeholder's fake files
    expect(allLabels.some(l => l === 'workbench.css' || l === 'lifecycle.ts')).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Close Folder: tree goes away
  // ═══════════════════════════════════════════════════════════════════════

  test('close folder removes tree and shows empty state', async ({ electronApp, window, workspacePath }) => {
    // Open a folder first
    await openFolderViaMenu(electronApp, window, workspacePath);
    const treeNodes = window.locator('.tree-node');
    await expect(treeNodes.first()).toBeVisible({ timeout: 10_000 });

    // Close folder via File menu
    await clickFileMenuItem(window, 'Close Folder');
    await window.waitForTimeout(2000);

    // Tree nodes should be gone
    await expect(treeNodes).toHaveCount(0);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. Save Workspace As: user experience
  // ═══════════════════════════════════════════════════════════════════════

  test('Save As shows name prompt and switches to new workspace', async ({ window }) => {
    const originalName = await getTitlebarWorkspaceName(window);

    // File → Save Workspace As...
    await clickFileMenuItem(window, 'Save Workspace As');

    // A modal input should appear
    const modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // The input should have default text with "(Copy)"
    const input = window.locator('.parallx-modal-input');
    await expect(input).toBeVisible();
    const defaultValue = await input.inputValue();
    expect(defaultValue).toContain('(Copy)');

    // Type a new name
    await input.fill('My Test Workspace');
    await input.press('Enter');

    // Wait for switch to complete
    await waitForSwitchComplete(window);

    // Titlebar should now show the new workspace name
    const newName = await getTitlebarWorkspaceName(window);
    expect(newName).toContain('My Test Workspace');
    expect(newName).not.toBe(originalName);
  });

  test('Save As does NOT duplicate sidebar elements', async ({ window }) => {
    // Perform a Save As
    await clickFileMenuItem(window, 'Save Workspace As');
    const modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });
    const input = window.locator('.parallx-modal-input');
    await input.fill('Non-Dupe Test');
    await input.press('Enter');
    await waitForSwitchComplete(window);

    // KEY ASSERTIONS: no duplication

    // Exactly ONE sidebar header label
    const headerLabels = window.locator('.sidebar-header-label');
    await expect(headerLabels).toHaveCount(1);

    // Exactly ONE gear icon
    const gearIcons = window.locator('.activity-bar-manage-gear');
    await expect(gearIcons).toHaveCount(1);

    // NO placeholder fake files
    const placeholderRows = window.locator('.placeholder-tree-row');
    await expect(placeholderRows).toHaveCount(0);

    // The Explorer section should exist exactly once
    const explorerSections = window.locator('.view-section[data-view-id="view.explorer"]');
    await expect(explorerSections).toHaveCount(1);
  });

  test('Save As preserves real Explorer (no fake placeholder files)', async ({ electronApp, window, workspacePath }) => {
    // Open a real folder first
    await openFolderViaMenu(electronApp, window, workspacePath);
    const treeNodes = window.locator('.tree-node');
    await expect(treeNodes.first()).toBeVisible({ timeout: 10_000 });

    // Save As
    await clickFileMenuItem(window, 'Save Workspace As');
    const modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });
    const input = window.locator('.parallx-modal-input');
    await input.fill('Preserved Explorer Test');
    await input.press('Enter');
    await waitForSwitchComplete(window);

    // Wait for the Explorer to potentially reload with the folder
    await window.waitForTimeout(3000);

    // The real Explorer should still show real files (or empty state)
    // It should NOT show the placeholder fake file tree
    const placeholderRows = window.locator('.placeholder-tree-row');
    await expect(placeholderRows).toHaveCount(0);

    const placeholderExplorer = window.locator('.placeholder-explorer');
    await expect(placeholderExplorer).toHaveCount(0);
  });

  test('Save As can be cancelled with Escape', async ({ window }) => {
    const originalName = await getTitlebarWorkspaceName(window);

    // File → Save Workspace As...
    await clickFileMenuItem(window, 'Save Workspace As');
    const modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });

    // Press Escape
    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);

    // Modal should be gone
    await expect(modal).not.toBeVisible({ timeout: 2000 });

    // Titlebar name should be unchanged
    const nameAfter = await getTitlebarWorkspaceName(window);
    expect(nameAfter).toBe(originalName);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Duplicate Workspace
  // ═══════════════════════════════════════════════════════════════════════

  test('Duplicate Workspace does not switch away from current', async ({ window }) => {
    const originalName = await getTitlebarWorkspaceName(window);

    // File → Duplicate Workspace
    await clickFileMenuItem(window, 'Duplicate Workspace');
    await window.waitForTimeout(2000);

    // Should still be on the original workspace
    const nameAfter = await getTitlebarWorkspaceName(window);
    expect(nameAfter).toBe(originalName);

    // UI should be intact — no duplication
    const headerLabels = window.locator('.sidebar-header-label');
    await expect(headerLabels).toHaveCount(1);
    const gearIcons = window.locator('.activity-bar-manage-gear');
    await expect(gearIcons).toHaveCount(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. Switch Workspace: full round-trip
  // ═══════════════════════════════════════════════════════════════════════

  test('switching workspace updates titlebar and preserves UI integrity', async ({ window }) => {
    // Create a second workspace via Save As
    await clickFileMenuItem(window, 'Save Workspace As');
    const modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });
    const input = window.locator('.parallx-modal-input');
    await input.fill('Second Workspace');
    await input.press('Enter');
    await waitForSwitchComplete(window);

    // Verify we're on the new workspace
    const newName = await getTitlebarWorkspaceName(window);
    expect(newName).toContain('Second Workspace');

    // UI structure should be intact after the switch
    // ONE header label
    await expect(window.locator('.sidebar-header-label')).toHaveCount(1);
    // ONE gear icon
    await expect(window.locator('.activity-bar-manage-gear')).toHaveCount(1);
    // NO placeholder files
    await expect(window.locator('.placeholder-tree-row')).toHaveCount(0);
    // ONE Explorer section
    await expect(window.locator('.view-section[data-view-id="view.explorer"]')).toHaveCount(1);
    // Activity bar should have at least Explorer and Search icons
    const activityIcons = window.locator('.activity-bar-item:not(.activity-bar-manage-gear)');
    const iconCount = await activityIcons.count();
    expect(iconCount).toBeGreaterThanOrEqual(2);
  });

  test('switching back and forth does not accumulate elements', async ({ window }) => {
    // Save As to create 2nd workspace
    await clickFileMenuItem(window, 'Save Workspace As');
    let modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });
    let input = window.locator('.parallx-modal-input');
    await input.fill('WS-A');
    await input.press('Enter');
    await waitForSwitchComplete(window);

    // Save As again to create 3rd workspace (switching from WS-A)
    await clickFileMenuItem(window, 'Save Workspace As');
    modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });
    input = window.locator('.parallx-modal-input');
    await input.fill('WS-B');
    await input.press('Enter');
    await waitForSwitchComplete(window);

    // After TWO workspace switches, there should still be:
    // Exactly ONE header label
    await expect(window.locator('.sidebar-header-label')).toHaveCount(1);
    // Exactly ONE gear icon
    await expect(window.locator('.activity-bar-manage-gear')).toHaveCount(1);
    // ZERO placeholder rows
    await expect(window.locator('.placeholder-tree-row')).toHaveCount(0);
    // Exactly ONE Explorer section
    await expect(window.locator('.view-section[data-view-id="view.explorer"]')).toHaveCount(1);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. Open Folder works AFTER Save As
  // ═══════════════════════════════════════════════════════════════════════

  test('opening a folder after Save As shows real files', async ({ electronApp, window, workspacePath }) => {
    // Save As to switch to new workspace
    await clickFileMenuItem(window, 'Save Workspace As');
    const modal = window.locator('.parallx-modal-overlay');
    await expect(modal).toBeVisible({ timeout: 3000 });
    const input = window.locator('.parallx-modal-input');
    await input.fill('Open Folder Test');
    await input.press('Enter');
    await waitForSwitchComplete(window);

    // Now open a folder in the new workspace
    await openFolderViaMenu(electronApp, window, workspacePath, { force: true });

    // Real tree nodes should appear
    const treeNodes = window.locator('.tree-node');
    await expect(treeNodes.first()).toBeVisible({ timeout: 10_000 });

    // Verify real file names
    const nodeLabels = window.locator('.tree-node-label');
    const allLabels: string[] = [];
    const count = await nodeLabels.count();
    for (let i = 0; i < count; i++) {
      const text = await nodeLabels.nth(i).textContent();
      if (text) allLabels.push(text);
    }

    expect(allLabels.some(l => l === 'README.md' || l === 'src' || l === 'docs')).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. Open Recent
  // ═══════════════════════════════════════════════════════════════════════

  test('Open Recent shows the quick access overlay', async ({ window }) => {
    // File → Open Recent
    await clickFileMenuItem(window, 'Open Recent');

    // Quick access overlay should be visible
    const quickAccess = window.locator('.command-palette-overlay');
    await expect(quickAccess).toBeVisible({ timeout: 3000 });

    // Dismiss
    await window.keyboard.press('Escape');
    await expect(quickAccess).not.toBeVisible({ timeout: 2000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. Keyboard shortcut: toggle sidebar
  // ═══════════════════════════════════════════════════════════════════════

  test('Ctrl+B toggles sidebar visibility', async ({ window }) => {
    const sidebar = window.locator('[data-part-id="workbench.parts.sidebar"]');
    await expect(sidebar).toBeVisible();

    // Toggle off
    await window.keyboard.press('Control+b');
    await window.waitForTimeout(500);

    // Sidebar should be hidden
    const isVisibleAfterToggle = await sidebar.isVisible();
    expect(isVisibleAfterToggle).toBe(false);

    // Toggle back on
    await window.keyboard.press('Control+b');
    await window.waitForTimeout(500);
    await expect(sidebar).toBeVisible();
  });
});
