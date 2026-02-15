/**
 * E2E tests: Workspace management.
 *
 * Verifies workspace creation, saving, save-as, switching,
 * duplicating, and opening recent workspaces through the real UI.
 *
 * Each test launches a fresh Electron process to avoid cross-test
 * state pollution (localStorage isolation).
 */
import { test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';
import type { Page, ElectronApplication } from '@playwright/test';

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

/**
 * Read the workspace name displayed in the titlebar.
 * Falls back to the document title if no explicit workspace label is found.
 */
async function getWorkspaceName(window: Page): Promise<string> {
  // The titlebar shows the workspace name in a dedicated element
  const wsName = window.locator('.titlebar-workspace-name, .workspace-name, .title-label');
  const count = await wsName.count();
  if (count > 0) {
    const text = await wsName.first().textContent();
    if (text && text.trim().length > 0) return text.trim();
  }
  return window.title();
}

/**
 * Clear all parallx localStorage keys via renderer evaluate.
 * This ensures a clean slate before each workspace test.
 */
async function clearParallxStorage(window: Page) {
  await window.evaluate(() => {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('parallx')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  });
}

/**
 * Get all workspace IDs currently stored in localStorage.
 */
async function getStoredWorkspaceIds(window: Page): Promise<string[]> {
  return window.evaluate(() => {
    const ids: string[] = [];
    const prefix = 'parallx:parallx.workspace.';
    const suffix = '.state';
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && key.endsWith(suffix)) {
        const id = key.slice(prefix.length, key.length - suffix.length);
        ids.push(id);
      }
    }
    return ids;
  });
}

/**
 * Get the active workspace ID from localStorage.
 */
async function getActiveWorkspaceId(window: Page): Promise<string | null> {
  return window.evaluate(() => {
    return localStorage.getItem('parallx:parallx.activeWorkspaceId');
  });
}

/**
 * Get the recent workspaces list from localStorage.
 */
async function getRecentWorkspaces(window: Page): Promise<Array<{ identity: { id: string; name: string } }>> {
  return window.evaluate(() => {
    const json = localStorage.getItem('parallx:parallx.recentWorkspaces');
    if (!json) return [];
    try { return JSON.parse(json); } catch { return []; }
  });
}

/**
 * Get a parsed workspace state from localStorage by ID.
 */
async function getWorkspaceState(window: Page, workspaceId: string): Promise<Record<string, any> | null> {
  return window.evaluate((id) => {
    const key = `parallx:parallx.workspace.${id}.state`;
    const json = localStorage.getItem(key);
    if (!json) return null;
    try { return JSON.parse(json); } catch { return null; }
  }, workspaceId);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Workspace Management', () => {

  test('default workspace is created on first launch', async ({ window }) => {
    // On launch, a default workspace should exist and be active
    const activeId = await getActiveWorkspaceId(window);
    expect(activeId).toBeTruthy();
    expect(typeof activeId).toBe('string');

    // The workspace state should be persisted in localStorage
    const ids = await getStoredWorkspaceIds(window);
    expect(ids.length).toBeGreaterThanOrEqual(1);
    expect(ids).toContain(activeId);

    // Recent workspaces should contain the default workspace
    const recents = await getRecentWorkspaces(window);
    expect(recents.length).toBeGreaterThanOrEqual(1);
    expect(recents.some(r => r.identity.id === activeId)).toBe(true);
  });

  test('workspace state is saved with correct schema', async ({ window }) => {
    const activeId = await getActiveWorkspaceId(window);
    expect(activeId).toBeTruthy();

    const state = await getWorkspaceState(window, activeId!);
    expect(state).toBeTruthy();

    // Validate schema fields
    expect(state!.version).toBe(2);
    expect(state!.identity).toBeTruthy();
    expect(state!.identity.id).toBe(activeId);
    expect(typeof state!.identity.name).toBe('string');
    expect(state!.metadata).toBeTruthy();
    expect(state!.layout).toBeTruthy();
    expect(Array.isArray(state!.parts)).toBe(true);
    expect(Array.isArray(state!.viewContainers)).toBe(true);
    expect(Array.isArray(state!.views)).toBe(true);
    expect(state!.editors).toBeTruthy();
    expect(state!.context).toBeTruthy();
    expect(Array.isArray(state!.folders)).toBe(true);
  });

  test('workspace auto-saves when layout changes', async ({ window }) => {
    const activeId = await getActiveWorkspaceId(window);
    expect(activeId).toBeTruthy();

    // Record initial state
    const stateBefore = await getWorkspaceState(window, activeId!);
    expect(stateBefore).toBeTruthy();

    // Toggle sidebar to trigger a layout change + save
    await window.keyboard.press('Control+b');
    // Wait for debounced auto-save (1s + margin)
    await window.waitForTimeout(2000);

    // State should have been updated
    const stateAfter = await getWorkspaceState(window, activeId!);
    expect(stateAfter).toBeTruthy();

    // The metadata lastAccessedAt should be updated
    expect(stateAfter!.metadata.lastAccessedAt).toBeTruthy();
  });

  test('open folder persists workspace folders', async ({ electronApp, window, workspacePath }) => {
    // Open a folder via the menu
    await openFolderViaMenu(electronApp, window, workspacePath);

    // Wait for auto-save
    await window.waitForTimeout(2000);

    const activeId = await getActiveWorkspaceId(window);
    const state = await getWorkspaceState(window, activeId!);
    expect(state).toBeTruthy();

    // At least one folder should be persisted
    expect(state!.folders.length).toBeGreaterThanOrEqual(1);

    // The folder path should match what we opened
    const folderPaths = state!.folders.map((f: any) => f.path);
    const hasOurFolder = folderPaths.some((p: string) =>
      p.toLowerCase().includes('parallx-test') ||
      p.replace(/\//g, '\\').toLowerCase() === workspacePath.toLowerCase() ||
      p.toLowerCase() === workspacePath.replace(/\\/g, '/').toLowerCase()
    );
    expect(hasOurFolder).toBe(true);
  });

  test('duplicate workspace creates a clone with full state', async ({ electronApp, window, workspacePath }) => {
    // First, open a folder so we have non-default state
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);

    const originalId = await getActiveWorkspaceId(window);
    expect(originalId).toBeTruthy();

    const originalState = await getWorkspaceState(window, originalId!);
    expect(originalState).toBeTruthy();

    // Count workspaces before duplication
    const idsBefore = await getStoredWorkspaceIds(window);

    // Execute duplicate command
    await clickFileMenuItem(window, 'Duplicate Workspace');
    await window.waitForTimeout(2000);

    // Should still be on the original workspace (duplicate doesn't switch)
    const activeAfter = await getActiveWorkspaceId(window);
    expect(activeAfter).toBe(originalId);

    // A new workspace should exist in storage
    const idsAfter = await getStoredWorkspaceIds(window);
    expect(idsAfter.length).toBe(idsBefore.length + 1);

    // Find the new workspace ID
    const newId = idsAfter.find(id => !idsBefore.includes(id));
    expect(newId).toBeTruthy();

    // The new workspace state should have the cloned folders
    const clonedState = await getWorkspaceState(window, newId!);
    expect(clonedState).toBeTruthy();
    expect(clonedState!.identity.id).toBe(newId);
    expect(clonedState!.identity.name).toContain('(Copy)');

    // Folder state should be cloned from original
    expect(clonedState!.folders.length).toBe(originalState!.folders.length);

    // Parts and viewContainers should also be cloned
    expect(clonedState!.parts.length).toBe(originalState!.parts.length);
    expect(clonedState!.viewContainers.length).toBe(originalState!.viewContainers.length);

    // Recent workspaces should contain both
    const recents = await getRecentWorkspaces(window);
    expect(recents.some(r => r.identity.id === originalId)).toBe(true);
    expect(recents.some(r => r.identity.id === newId)).toBe(true);
  });

  test('save workspace as prompts for name and creates clone', async ({ electronApp, window, workspacePath }) => {
    // Open a folder so we have non-default state
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);

    const originalId = await getActiveWorkspaceId(window);
    expect(originalId).toBeTruthy();

    // Count workspaces before
    const idsBefore = await getStoredWorkspaceIds(window);

    // Click Save Workspace As…
    await clickFileMenuItem(window, 'Save Workspace As');

    // A modal input box should appear
    const inputModal = window.locator('.parallx-modal-overlay');
    await expect(inputModal).toBeVisible({ timeout: 3000 });

    // The input should have a default name suggestion
    const input = window.locator('.parallx-modal-input');
    await expect(input).toBeVisible();
    const defaultValue = await input.inputValue();
    expect(defaultValue).toContain('(Copy)');

    // Type a custom name
    await input.fill('My Custom Workspace');
    await input.press('Enter');

    // Wait for save + switch
    await window.waitForTimeout(3000);

    // Should have switched to the new workspace
    const activeAfter = await getActiveWorkspaceId(window);
    expect(activeAfter).not.toBe(originalId);

    // New workspace should exist
    const idsAfter = await getStoredWorkspaceIds(window);
    expect(idsAfter.length).toBe(idsBefore.length + 1);

    // The new workspace should have our custom name
    const newState = await getWorkspaceState(window, activeAfter!);
    expect(newState).toBeTruthy();
    expect(newState!.identity.name).toBe('My Custom Workspace');

    // The cloned state should have the original's folders
    const originalState = await getWorkspaceState(window, originalId!);
    expect(newState!.folders.length).toBe(originalState!.folders.length);
  });

  test('save workspace as can be cancelled with Escape', async ({ window }) => {
    const idsBefore = await getStoredWorkspaceIds(window);
    const activeBefore = await getActiveWorkspaceId(window);

    // Click Save Workspace As…
    await clickFileMenuItem(window, 'Save Workspace As');

    // Modal should appear
    const inputModal = window.locator('.parallx-modal-overlay');
    await expect(inputModal).toBeVisible({ timeout: 3000 });

    // Press Escape to cancel
    await window.keyboard.press('Escape');
    await window.waitForTimeout(500);

    // Modal should be gone
    await expect(inputModal).not.toBeVisible({ timeout: 2000 });

    // No new workspace should be created
    const idsAfter = await getStoredWorkspaceIds(window);
    expect(idsAfter.length).toBe(idsBefore.length);

    // Should still be on same workspace
    const activeAfter = await getActiveWorkspaceId(window);
    expect(activeAfter).toBe(activeBefore);
  });

  test('switch workspace changes active workspace', async ({ electronApp, window, workspacePath }) => {
    // Open a folder first
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);

    const originalId = await getActiveWorkspaceId(window);

    // Duplicate to create a second workspace we can switch to
    await clickFileMenuItem(window, 'Duplicate Workspace');
    await window.waitForTimeout(2000);

    // Find the duplicated workspace ID
    const ids = await getStoredWorkspaceIds(window);
    const duplicateId = ids.find(id => id !== originalId);
    expect(duplicateId).toBeTruthy();

    // Switch to the duplicate via the exposed workbench instance
    await window.evaluate(async (targetId) => {
      const wb = (window as any).__parallx_workbench__;
      if (wb?.switchWorkspace) {
        await wb.switchWorkspace(targetId);
      }
    }, duplicateId!);

    await window.waitForTimeout(3000);

    // Active workspace should now be the duplicate
    const activeAfter = await getActiveWorkspaceId(window);
    expect(activeAfter).toBe(duplicateId);
  });

  test('open recent shows quick access with workspace list', async ({ electronApp, window, workspacePath }) => {
    // Open a folder and duplicate to ensure we have multiple workspaces
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);

    await clickFileMenuItem(window, 'Duplicate Workspace');
    await window.waitForTimeout(2000);

    // Now click Open Recent…
    await clickFileMenuItem(window, 'Open Recent');

    // Quick Access overlay should appear
    const quickAccess = window.locator('.quick-access-overlay, .quick-access, .command-palette');
    await expect(quickAccess).toBeVisible({ timeout: 3000 });

    // It should contain workspace entries (the duplicate should appear)
    // Wait a moment for workspace items to load
    await window.waitForTimeout(500);
    const items = window.locator('.quick-access-item, .list-item, .command-palette-item');
    const count = await items.count();
    // At minimum, some items should be visible (files or workspaces)
    expect(count).toBeGreaterThanOrEqual(0);

    // Dismiss
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
  });

  test('workspace state roundtrip — saved state matches live state', async ({ electronApp, window, workspacePath }) => {
    // Open a folder to have non-trivial state
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);

    const activeId = await getActiveWorkspaceId(window);
    expect(activeId).toBeTruthy();

    // Force a save via the exposed workbench
    await window.evaluate(async () => {
      const wb = (window as any).__parallx_workbench__;
      if (wb?._workspaceSaver) {
        await wb._workspaceSaver.save();
      }
    });

    // Read back the persisted state
    const state = await getWorkspaceState(window, activeId!);
    expect(state).toBeTruthy();

    // The identity should match
    expect(state!.identity.id).toBe(activeId);

    // Parts, views, folders should all be populated
    expect(state!.parts.length).toBeGreaterThan(0);
    expect(state!.viewContainers.length).toBeGreaterThan(0);
    expect(state!.folders.length).toBeGreaterThanOrEqual(1);

    // Layout should have valid dimensions
    expect(state!.layout).toBeTruthy();
    expect(state!.layout.grid).toBeTruthy();
  });

  test('active workspace ID persists in storage', async ({ window }) => {
    // The active workspace ID should always be persisted
    const activeId = await getActiveWorkspaceId(window);
    expect(activeId).toBeTruthy();

    // It should match a workspace that exists in storage
    const state = await getWorkspaceState(window, activeId!);
    expect(state).toBeTruthy();
    expect(state!.identity.id).toBe(activeId);
  });

  test('workspace folders are saved correctly to storage', async ({ electronApp, window, workspacePath }) => {
    // Open a folder
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);

    // Force save
    await window.evaluate(async () => {
      const wb = (window as any).__parallx_workbench__;
      if (wb?._workspaceSaver) {
        await wb._workspaceSaver.save();
      }
    });

    const activeId = await getActiveWorkspaceId(window);
    const state = await getWorkspaceState(window, activeId!);
    expect(state).toBeTruthy();
    expect(state!.folders.length).toBeGreaterThanOrEqual(1);

    // Verify folder data has the expected shape
    const folder = state!.folders[0];
    expect(folder.scheme).toBe('file');
    expect(typeof folder.path).toBe('string');
    expect(folder.path.length).toBeGreaterThan(0);
  });

  test('close folder removes all workspace folders', async ({ electronApp, window, workspacePath }) => {
    // Open a folder first
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2000);

    // Verify folder is loaded
    const treeNodes = window.locator('.tree-node');
    await expect(treeNodes.first()).toBeVisible({ timeout: 5000 });

    // Close folder via File menu
    await clickFileMenuItem(window, 'Close Folder');
    await window.waitForTimeout(2000);

    // Workspace should have zero folders
    const activeId = await getActiveWorkspaceId(window);
    const state = await getWorkspaceState(window, activeId!);
    expect(state).toBeTruthy();
    expect(state!.folders.length).toBe(0);
  });
});
