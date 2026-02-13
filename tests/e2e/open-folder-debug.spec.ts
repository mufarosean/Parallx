/**
 * Dead-simple test: open the app, open D:\AI\Silas via File → Open Folder,
 * take screenshots before and after.
 *
 * The ONLY thing mocked is the native OS file picker dialog response
 * (Playwright cannot interact with Windows native dialogs). Everything
 * else — menu clicks, command dispatch, explorer rendering — is real.
 */
import { test, expect } from './fixtures';

test('open folder D:\\AI\\Silas and screenshot', async ({ window, electronApp }) => {
  // Bring the window to front so you can watch
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      win.show();
      win.focus();
      win.moveTop();
    }
  });

  // Screenshot 1: app just launched, nothing open
  await window.screenshot({ path: 'test-results/01-before-open.png' });
  await window.waitForTimeout(3000); // pause so you can see the empty state

  // Mock the native OS dialog to return D:\AI\Silas
  // (this is the ONLY mock — Playwright can't drive Windows file picker)
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('dialog:openFolder');
    ipcMain.handle('dialog:openFolder', async () => ['D:\\AI\\Silas']);
  });

  // Click File menu
  const fileMenu = window.locator('.titlebar-menu-item[data-menu-id="file"]');
  await fileMenu.click();
  await window.waitForTimeout(2000); // pause so you can see the menu open

  // Wait for dropdown
  const dropdown = window.locator('.context-menu.titlebar-dropdown');
  await dropdown.waitFor({ state: 'visible', timeout: 3000 });

  // Click "Open Folder…"
  const openFolderItem = dropdown.locator('.context-menu-item', { hasText: 'Open Folder' });
  await openFolderItem.click();

  // Wait for the explorer tree to populate
  await window.waitForTimeout(5000); // long pause so you can see the tree render

  // Screenshot 2: after opening D:\AI\Silas
  await window.screenshot({ path: 'test-results/02-after-open.png' });

  // Log what we see in the tree
  const treeNodes = window.locator('.tree-node');
  const count = await treeNodes.count();
  console.log(`Tree nodes visible: ${count}`);
  for (let i = 0; i < Math.min(count, 20); i++) {
    const label = await treeNodes.nth(i).locator('.tree-node-label').textContent();
    console.log(`  [${i}] ${label}`);
  }
});
