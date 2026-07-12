// Diagnostic — opens the Settings hub, dumps the nav (SETTINGS-NAV in the
// output), and screenshots every page into test-results/settings-ia-review.
// Use it to review the hub's information architecture after settings changes.
import { test, createTestWorkspace, cleanupTestWorkspace, openFolderViaMenu } from './fixtures';
import fs from 'fs/promises';
import path from 'path';

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'settings-ia-review');

test('capture settings hub IA', async ({ electronApp, window }) => {
  test.setTimeout(180_000);
  await fs.mkdir(SHOT_DIR, { recursive: true });
  const ws = await createTestWorkspace();

  try {
    await openFolderViaMenu(electronApp, window, ws, { force: true });
    await window.waitForTimeout(2500); // let tools activate + register settings

    await window.keyboard.press('Control+Alt+S');
    await window.locator('.settings-editor').waitFor({ state: 'visible', timeout: 10_000 });
    await window.waitForTimeout(600);

    const navItems = await window.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.settings-editor__nav-item')]
        .map((el) => (el.textContent ?? '').trim()),
    );
    console.log('SETTINGS-NAV ' + JSON.stringify(navItems, null, 1));

    for (let i = 0; i < navItems.length; i++) {
      await window.locator('.settings-editor__nav-item').nth(i).click();
      await window.waitForTimeout(450);
      const safe = navItems[i].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30) || `cat-${i}`;
      await window.screenshot({ path: path.join(SHOT_DIR, `${String(i).padStart(2, '0')}-${safe}.png`) });
    }
  } finally {
    await cleanupTestWorkspace(ws);
  }
});
