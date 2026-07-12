// Diagnostic — screenshots every primary workbench surface (activity-bar views
// + bottom-panel tabs) into test-results/surface-sweep for visual review.
import { test, createTestWorkspace, cleanupTestWorkspace, openFolderViaMenu } from './fixtures';
import fs from 'fs/promises';
import path from 'path';

const SHOT_DIR = path.join(process.cwd(), 'test-results', 'surface-sweep');

test('capture all primary surfaces', async ({ electronApp, window }) => {
  test.setTimeout(240_000);
  await fs.mkdir(SHOT_DIR, { recursive: true });
  const ws = await createTestWorkspace();

  try {
    await openFolderViaMenu(electronApp, window, ws, { force: true });
    await window.waitForTimeout(2500);

    // ── Activity bar views ──
    const tabs = await window.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.activity-bar-item')]
        .map((el) => el.getAttribute('aria-label') || el.dataset.iconId || '?'),
    );
    console.log('ACTIVITY-TABS ' + JSON.stringify(tabs));

    for (let i = 0; i < tabs.length; i++) {
      const safe = tabs[i].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || `tab-${i}`;
      await window.locator('.activity-bar-item').nth(i).click();
      await window.waitForTimeout(900);
      await window.screenshot({ path: path.join(SHOT_DIR, `view-${String(i).padStart(2, '0')}-${safe}.png`) });
    }

    // ── Bottom panel tabs ──
    const panelTabs = await window.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('.panel-tab, [class*="panel"] [role="tab"]')]
        .map((el) => (el.textContent ?? '').trim())
        .filter(Boolean),
    );
    console.log('PANEL-TABS ' + JSON.stringify(panelTabs));

    for (let i = 0; i < panelTabs.length; i++) {
      const safe = panelTabs[i].toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || `panel-${i}`;
      await window.locator('.panel-tab, [class*="panel"] [role="tab"]').nth(i).click().catch(() => {});
      await window.waitForTimeout(700);
      await window.screenshot({ path: path.join(SHOT_DIR, `panel-${String(i).padStart(2, '0')}-${safe}.png`) });
    }
  } finally {
    await cleanupTestWorkspace(ws);
  }
});
