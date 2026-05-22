/**
 * E2E diagnostic: media-organizer grid scroll preservation across tab switch.
 *
 * Points the app at the user's real Art References workspace, opens the grid,
 * scrolls to a known offset, opens a card (which creates a detail tab), then
 * switches back to the grid tab and reads the scrollTop. Compares against the
 * value saved by EditorGroupView's view-state cache. The point is data, not
 * theory — when this fails, the report tells us exactly which step diverged.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect } from './fixtures';
import { _electron as electron } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ART_REFS = 'C:\\Users\\mchit\\OneDrive\\Pictures\\Art References';

test.describe('media-organizer grid scroll restore', () => {
  test('scrollTop is preserved exactly across tab switch', async () => {
    // Launch directly (not via fixtures) so we can point at the real workspace
    // and skip PARALLX_TEST_MODE's state-clearing behavior, while still keeping
    // the __parallx_workbench__ hook.
    //
    // CRITICAL: ELECTRON_RUN_AS_NODE may be inherited from the shell (Claude
    // Code sets it); if it leaks through, Electron behaves as plain Node and
    // `require('electron').app` is undefined, crashing main.cjs:108.
    const env = { ...process.env };
    delete (env as any).ELECTRON_RUN_AS_NODE;
    env.PARALLX_TEST_MODE = '1';
    env.PARALLX_RENDERER_PORT = '0';

    const app = await electron.launch({
      args: ['.'],
      cwd: PROJECT_ROOT,
      env,
    });

    try {
      const page = await app.firstWindow();
      await page.waitForSelector('[data-part-id="workbench.parts.titlebar"]', { timeout: 15_000 });

      // Stream renderer console to the test report — every [mo-grid] line shows up.
      page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[mo-grid]') || text.includes('[EditorGroupView]') || text.includes('MediaOrganizer')) {
          console.log('  RENDERER:', text);
        }
      });

      // Open the real workspace via the File menu (mocks only the OS dialog).
      await app.evaluate(({ ipcMain }, fp) => {
        ipcMain.removeHandler('dialog:openFolder');
        ipcMain.handle('dialog:openFolder', async () => [fp]);
      }, ART_REFS);

      await page.locator('.titlebar-menu-item[data-menu-id="file"]').click();
      const dropdown = page.locator('.context-menu.titlebar-dropdown');
      await dropdown.waitFor({ state: 'visible', timeout: 3000 });
      await dropdown.locator('.context-menu-item', { hasText: 'Open Folder' }).click();
      await page.waitForLoadState('domcontentloaded', { timeout: 20_000 });
      await page.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 20_000 });
      await page.waitForTimeout(3_000); // settle extension activation

      // Open the media-organizer grid directly via command service.
      // ServiceCollection stores entries as { instance, descriptor } — the
      // executable lives on entry.instance, not the entry itself.
      const opened = await page.evaluate(async () => {
        const wb = (window as any).__parallx_workbench__;
        if (!wb) return { error: 'no workbench' };
        const svcs: any = wb._services ?? wb.services;
        const entries: Map<string, any> | undefined = svcs?._entries;
        if (!entries || typeof entries.forEach !== 'function') {
          return { error: 'no _entries map', shape: Object.keys(svcs || {}) };
        }
        let cmd: any = null;
        let foundKey: string | undefined;
        entries.forEach((entry, key) => {
          const inst = entry?.instance;
          if (inst && typeof inst.executeCommand === 'function') {
            cmd = inst;
            foundKey = key;
          }
        });
        if (!cmd) {
          const keys: string[] = [];
          entries.forEach((_v, k) => keys.push(k));
          return { error: 'no command service', keys };
        }
        try {
          await cmd.executeCommand('media-organizer.openGrid');
          return { ok: true, foundKey };
        } catch (e: any) {
          return { error: String(e?.message || e), foundKey };
        }
      });
      console.log('  open result:', JSON.stringify(opened));
      expect((opened as any).ok).toBe(true);

      // Wait for the grid to be visible and have content.
      const gridArea = page.locator('.mo-grid-area').first();
      await gridArea.waitFor({ state: 'visible', timeout: 20_000 });
      // Wait until at least one card is mounted.
      await page.waitForFunction(() => {
        const ga = document.querySelector('.mo-grid-area') as HTMLElement | null;
        if (!ga) return false;
        return ga.querySelectorAll('.mo-card, [data-mo-card], .card').length > 0
          || ga.scrollHeight > ga.clientHeight + 100;
      }, undefined, { timeout: 20_000 });
      await page.waitForTimeout(1000); // let thumbnails resolve a bit

      // Scroll to a known offset (well below the fold).
      await gridArea.evaluate((el) => { (el as HTMLElement).scrollTop = 5500; });
      await page.waitForTimeout(200);
      const scrollA = await gridArea.evaluate((el) => (el as HTMLElement).scrollTop);
      console.log('  saved scrollTop (A):', scrollA);

      // Click the first card to open the detail editor.
      const card = gridArea.locator('.mo-card, [data-mo-card], .card').first();
      await card.dblclick();
      // Detail tab opens with typeId media-organizer-grid; wait for tab change.
      await page.waitForTimeout(1500);
      const tabsBefore = await page.locator('.ui-tab').count();
      console.log('  open tabs after dblclick:', tabsBefore);

      // Read the workbench's view-state cache snapshot.
      const diag = await page.evaluate(() => {
        const wb = (window as any).__parallx_workbench__;
        if (!wb) return { error: 'no workbench' };
        // Find the active EditorGroupView.
        const groups: any[] = (wb._editorPart?._groups || wb.editorPart?._groups || []) as any[];
        const out: any[] = [];
        for (const g of groups) {
          const cache = g._viewStateCache;
          if (!cache) continue;
          const entries: any[] = [];
          cache.forEach((v: any, k: string) => entries.push({ k, v }));
          out.push({ groupId: g.id, entries, activeInputId: g._activePane?.input?.id });
        }
        return { groups: out };
      });
      console.log('  viewStateCache after open-detail:', JSON.stringify(diag, null, 2));

      // Switch back to the grid tab. The grid is typically the first tab.
      const gridTab = page.locator('.ui-tab').first();
      await gridTab.click();
      await page.waitForTimeout(2000); // allow remount + restore

      // Read the new gridArea scrollTop.
      const newGridArea = page.locator('.mo-grid-area').first();
      await newGridArea.waitFor({ state: 'visible', timeout: 10_000 });
      const scrollB = await newGridArea.evaluate((el) => (el as HTMLElement).scrollTop);
      console.log('  restored scrollTop (B):', scrollB);

      const final = await page.evaluate(() => {
        const ga = document.querySelector('.mo-grid-area') as HTMLElement | null;
        return ga ? { scrollTop: ga.scrollTop, scrollHeight: ga.scrollHeight, clientHeight: ga.clientHeight } : null;
      });
      console.log('  final grid metrics:', JSON.stringify(final));

      // Don't hard-fail — log the diff for diagnosis.
      console.log(`  DIFF: saved=${scrollA} restored=${scrollB} delta=${scrollB - scrollA}`);
    } finally {
      try { await app.close(); } catch { /* best effort */ }
    }
  });
});
