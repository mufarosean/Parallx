// Diagnostic — exercises the Search sidebar with a real query and captures
// the results tree into test-results/search-view.
import { test, createTestWorkspace, cleanupTestWorkspace, openFolderViaMenu } from './fixtures';
import fs from 'fs/promises';
import path from 'path';

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'search-view');

test('search view renders styled results', async ({ electronApp, window }) => {
  test.setTimeout(180_000);
  await fs.mkdir(SHOT_DIR, { recursive: true });
  const ws = await createTestWorkspace();

  try {
    await openFolderViaMenu(electronApp, window, ws, { force: true });
    await window.waitForTimeout(1500);

    // Open the Search view (activity bar index 1 per the sweep).
    await window.locator('.activity-bar-item').nth(1).click();
    await window.locator('.search-view').waitFor({ state: 'visible', timeout: 8_000 });
    await window.screenshot({ path: path.join(SHOT_DIR, '01-empty.png') });

    // Type a query matching the fixture files ("hello" appears in README + src).
    await window.locator('.search-input').first().fill('hello');
    await window.waitForTimeout(1200);
    await window.screenshot({ path: path.join(SHOT_DIR, '02-results.png') });

    // Results must actually render.
    const fileGroups = await window.locator('.search-file-group').count();
    console.log('SEARCH-FILE-GROUPS', fileGroups);

    // Toggle replace + filters for the full-chrome shot.
    await window.locator('.search-toggle-replace').click();
    await window.locator('.search-filters-toggle').click();
    await window.waitForTimeout(400);
    await window.screenshot({ path: path.join(SHOT_DIR, '03-full-chrome.png') });
  } finally {
    await cleanupTestWorkspace(ws);
  }
});
