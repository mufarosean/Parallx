/**
 * E2E tests: Worksheets (M99) — the exam-faithful practice-sheet surface.
 *
 * Drives the REAL app: activity-bar entry, sidebar, the lazily-loaded Univer
 * engine, the per-surface sheet theme (pinned light default + Sheet Theme
 * toggle), ribbon popups (the clipped-dropdowns bug class), the generate
 * pane, and a seeded item's practice → reveal → grade loop.
 *
 * Screenshots land in test-results/worksheet/ (gitignored) for visual review
 * — the check tsc and unit tests cannot do.
 */
import { sharedTest as test, expect, openFolderViaMenu } from './fixtures';
import path from 'path';
import fs from 'fs/promises';

const SHOT_DIR = path.join('test-results', 'worksheet');

test.beforeAll(async () => {
  await fs.mkdir(SHOT_DIR, { recursive: true });
});

// Univer renders into .ws-pane__sheet; its engine paints on canvas elements.
const ENGINE_READY_TIMEOUT = 30_000; // first open downloads/parses the 17MB bundle

async function waitForEngine(window: import('@playwright/test').Page): Promise<void> {
  await window.waitForFunction(() => {
    const host = document.querySelector('.ws-pane__sheet');
    return !!host && host.querySelectorAll('canvas').length > 0;
  }, { timeout: ENGINE_READY_TIMEOUT });
  await window.waitForTimeout(500); // settle first paint
}

/** Open the scratch sheet if no engine is on screen (tests stay independent). */
async function ensureScratchOpen(window: import('@playwright/test').Page): Promise<void> {
  const hasCanvas = await window.evaluate(() =>
    !!document.querySelector('.ws-pane__sheet canvas'));
  if (hasCanvas) return;
  const sidebar = window.locator('.ws-sidebar');
  if (!(await sidebar.isVisible().catch(() => false))) {
    await window.locator('button.activity-bar-item[data-icon-id="worksheet-container"]').click();
    await sidebar.waitFor({ state: 'visible', timeout: 5_000 });
  }
  await sidebar.locator('button', { hasText: 'Scratch Sheet' }).click();
  await waitForEngine(window);
}

test.describe('Worksheets — surface and engine', () => {
  test('activity bar has a Worksheets entry that opens the sidebar', async ({ window }) => {
    const btn = window.locator('button.activity-bar-item[data-icon-id="worksheet-container"]');
    await expect(btn).toBeVisible();
    await btn.click();

    const sidebar = window.locator('.ws-sidebar');
    await expect(sidebar).toBeVisible({ timeout: 5_000 });
    await expect(sidebar.locator('button', { hasText: 'Generate Items' })).toBeVisible();
    await expect(sidebar.locator('button', { hasText: 'Scratch Sheet' })).toBeVisible();
  });

  test('scratch sheet opens and the engine actually renders', async ({ window }) => {
    await window.locator('.ws-sidebar button', { hasText: 'Scratch Sheet' }).click();

    // The pane mounts with a loading note, then the engine takes over.
    await expect(window.locator('.ws-pane')).toBeVisible({ timeout: 10_000 });
    await waitForEngine(window);

    // The loading placeholder must be gone — a stuck "Loading the practice
    // sheet engine…" is exactly the failure a user would report.
    await expect(window.locator('.ws-pane__loading')).toHaveCount(0);

    // Scratch bar with Export to Excel is present.
    await expect(window.locator('.ws-scratchbar button', { hasText: 'Export to Excel' })).toBeVisible();

    await window.screenshot({ path: path.join(SHOT_DIR, 'scratch-default.png') });
  });

  test('popup portal exists at body level with overlay-clearing z-index', async ({ window }) => {
    const portal = await window.evaluate(() => {
      const el = document.getElementById('ws-univer-popup-root');
      if (!el) return null;
      return {
        parentIsBody: el.parentElement === document.body,
        zIndex: getComputedStyle(el).zIndex,
      };
    });
    expect(portal).not.toBeNull();
    expect(portal!.parentIsBody).toBe(true);
    expect(Number(portal!.zIndex)).toBeGreaterThanOrEqual(10005);
  });

  test('a sheet menu opens and is visible (the clipped-popups bug class)', async ({ window }) => {
    // Was a pinned KNOWN ISSUE (grid right-click menu never opened) — fixed
    // as a side effect of the 2026-08-11 fixes (the :where() form-control
    // downgrade / footer enable); the test.fail() marker flipped the suite
    // loud, so it now asserts the menu OPENS.
    // The font-family trigger collapses into toolbar overflow at narrow
    // widths, so it's a fragile anchor. The grid CONTEXT MENU is always
    // available and exercises the same popup path that used to clip.
    await ensureScratchOpen(window);
    // Univer stacks several canvases; clicking the HOST at grid coordinates
    // reaches whichever layer owns pointer events (force: layered canvases
    // report as occluding each other).
    const host = window.locator('.ws-pane__sheet');
    await host.click({ position: { x: 220, y: 220 }, force: true });
    // Playwright's synthetic right-click did not reach Univer's handler —
    // dispatch pointerdown+contextmenu on the topmost canvas like the real
    // browser does.
    await window.evaluate(() => {
      const hostEl = document.querySelector('.ws-pane__sheet') as HTMLElement;
      const rect = hostEl.getBoundingClientRect();
      const x = rect.left + 220;
      const y = rect.top + 220;
      const target = document.elementFromPoint(x, y) ?? hostEl;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2, buttons: 2 };
      target.dispatchEvent(new PointerEvent('pointerdown', { ...opts, pointerId: 9, pointerType: 'mouse' }));
      target.dispatchEvent(new PointerEvent('pointerup', { ...opts, pointerId: 9, pointerType: 'mouse' }));
      target.dispatchEvent(new MouseEvent('contextmenu', opts));
    });

    await window.waitForTimeout(800);
    await window.screenshot({ path: path.join(SHOT_DIR, 'sheet-context-menu.png') });
    // Diagnostic: what did the click produce, portal-side and pane-side?
    const state = await window.evaluate(() => ({
      portalChildren: document.getElementById('ws-univer-popup-root')?.childElementCount ?? -1,
      portalText: (document.getElementById('ws-univer-popup-root')?.textContent ?? '').slice(0, 200),
    }));
    console.log('CONTEXT MENU STATE:', JSON.stringify(state));

    // "Copy" only renders inside an OPEN menu (menu items build on demand).
    const menuEntry = window.getByText('Copy', { exact: true }).first();
    await expect(menuEntry, `right-click menu did not appear — state: ${JSON.stringify(state)}`).toBeVisible({ timeout: 3_000 });
    await window.keyboard.press('Escape');
  });

  test('sheet theme is independent of the app theme, toggled by Sheet Theme', async ({ window }) => {
    // Contract (Mufaro): "user may want dark mode for UI, but worksheet as
    // light mode". Default sheetAppearance is pinned LIGHT (Athena is always
    // white); the Sheet Theme button flips light↔dark without touching the
    // app mode. ('app' follow-mode is Settings-only — not driven here.)
    await ensureScratchOpen(window);
    const themeBtn = window.locator('.ws-scratchbar button', { hasText: 'Sheet Theme:' });
    await expect(themeBtn).toBeVisible();

    // Normalize to Light — the setting persists in the user's real workspace
    // config, so a prior run (or the user) may have left it dark/app.
    for (let i = 0; i < 2; i++) {
      const label = (await themeBtn.textContent()) ?? '';
      if (label.includes('Light')) break;
      await themeBtn.click();
      await window.waitForTimeout(600);
    }
    await expect(themeBtn).toHaveText('Sheet Theme: Light');

    const sheetBg = () => window.evaluate(() => {
      const host = document.querySelector('.ws-pane__sheet') as HTMLElement | null;
      const engineRoot = host?.querySelector('div') as HTMLElement | null;
      const el = engineRoot ?? host;
      return el ? getComputedStyle(el).backgroundColor : '';
    });
    const lightBg = await sheetBg();

    // 1. Pinned light: the sheet must NOT react to an app-mode flip.
    await window.evaluate(() => document.documentElement.setAttribute('data-px-mode', 'light'));
    await window.waitForTimeout(600);
    await window.evaluate(() => document.documentElement.removeAttribute('data-px-mode'));
    await window.waitForTimeout(600);
    expect(await sheetBg(), 'pinned-light sheet changed with the app theme').toBe(lightBg);
    await window.screenshot({ path: path.join(SHOT_DIR, 'sheet-light-app-dark.png') });

    // 2. The toggle flips the sheet dark while the app stays untouched.
    await themeBtn.click();
    await window.waitForTimeout(800); // engine re-skin + repaint
    await expect(themeBtn).toHaveText('Sheet Theme: Dark');
    const darkBg = await sheetBg();
    expect(darkBg, 'Sheet Theme toggle did not re-skin the engine').not.toBe(lightBg);
    const appMode = await window.evaluate(() => document.documentElement.getAttribute('data-px-mode'));
    expect(appMode, 'sheet toggle leaked into the app theme').toBeNull();
    await window.screenshot({ path: path.join(SHOT_DIR, 'sheet-dark-app-dark.png') });

    // 3. Toggle back — leave the surface (and the persisted setting) at the
    //    light default so reruns and the user's real workspace stay clean.
    await themeBtn.click();
    await window.waitForTimeout(800);
    await expect(themeBtn).toHaveText('Sheet Theme: Light');
    expect(await sheetBg()).toBe(lightBg);
  });

  test('command palette lists the Worksheets commands and opens the browser', async ({ window }) => {
    // Click into neutral chrome first — the Univer canvas swallows keys.
    await window.locator('[data-part-id="workbench.parts.statusbar"]').click();
    await window.keyboard.press('Control+Shift+P');
    const overlay = window.locator('.command-palette-overlay');
    await expect(overlay).toBeVisible({ timeout: 3_000 });
    // The palette pre-fills '>' for command mode — a bare fill() erases it
    // and silently turns the query into FILE search (probe-proven).
    await window.locator('.command-palette-input').fill('>Worksheets');
    await window.waitForTimeout(400);

    // Diagnostic: when the entry is missing, show what IS listed.
    const listed = await window.locator('.command-palette-item').allInnerTexts();
    const item = window.locator('.command-palette-item', { hasText: 'Worksheets: Open Practice Items' });
    await expect(item.first(), `palette listed: ${JSON.stringify(listed)}`).toBeVisible({ timeout: 3_000 });
    await item.first().click();

    await expect(window.locator('.ws-home')).toBeVisible({ timeout: 5_000 });
    await expect(window.locator('.ws-home__title', { hasText: 'Practice Items' })).toBeVisible();
    await window.screenshot({ path: path.join(SHOT_DIR, 'home.png') });
  });

  test('generate pane renders its full control set', async ({ window }) => {
    // Independent entry: the sidebar button, not a prior test's home pane.
    const sidebar = window.locator('.ws-sidebar');
    if (!(await sidebar.isVisible().catch(() => false))) {
      await window.locator('button.activity-bar-item[data-icon-id="worksheet-container"]').click();
      await expect(sidebar).toBeVisible({ timeout: 5_000 });
    }
    await sidebar.locator('button', { hasText: 'Generate Items' }).click();
    const pane = window.locator('.ws-create');
    await expect(pane).toBeVisible({ timeout: 5_000 });

    await expect(pane.locator('.ws-dropzone')).toBeVisible();
    await expect(pane.locator('textarea.ws-textarea')).toBeVisible();
    await expect(pane.locator('.ws-create__controls button', { hasText: 'Generate Items' })).toBeVisible();
    await window.screenshot({ path: path.join(SHOT_DIR, 'generate.png') });

    // Generating with no source must complain loudly, not sit silent.
    await pane.locator('.ws-create__controls button', { hasText: 'Generate Items' }).click();
    await expect(pane.locator('.ws-error')).toBeVisible({ timeout: 3_000 });
  });
});

test.describe('Worksheets — item practice loop (workspace DB)', () => {
  test('explorer file drag reaches the generate drop zone', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);

    // Open the generate pane.
    const sidebar = window.locator('.ws-sidebar');
    if (!(await sidebar.isVisible().catch(() => false))) {
      await window.locator('button.activity-bar-item[data-icon-id="worksheet-container"]').click();
      await sidebar.waitFor({ state: 'visible', timeout: 5_000 });
    }
    await sidebar.locator('button', { hasText: 'Generate Items' }).click();
    await expect(window.locator('.ws-dropzone')).toBeVisible({ timeout: 5_000 });

    // Show the Explorer. The worksheet sidebar is active right now, so this
    // SWITCHES (clicking the active view's icon would toggle the sidebar
    // closed instead — probe-verified trap). The app may be in any restored
    // workspace, so pick ANY visible file node rather than a fixture path;
    // files have no expand chevron.
    await window.locator('button.activity-bar-item[data-icon-id="view.explorer"]').click();
    await expect(window.locator('.tree-node').first()).toBeVisible({ timeout: 5_000 });
    const fileNode = window.locator('.tree-node:not(:has(.tree-node-chevron))').first();
    for (let i = 0; i < 3 && !(await fileNode.isVisible().catch(() => false)); i++) {
      await window.locator('.tree-node:has(.tree-node-chevron)').nth(i).click();
      await window.waitForTimeout(500);
    }
    await expect(fileNode).toBeVisible({ timeout: 5_000 });

    // The real drag: Explorer sets effectAllowed='move'; the drop zone must
    // answer with a compatible dropEffect or Chromium never fires drop (the
    // exact "dragging from the workspace does nothing" bug).
    const status = window.locator('.ws-create__status');
    await expect(status).toHaveText('No source loaded yet.');
    await fileNode.dragTo(window.locator('.ws-dropzone'));

    // Any status movement proves drop fired and the path flowed through
    // (extraction may legitimately fail on a tiny/binary file — the BUG was
    // that drop never fired at all and the status never moved).
    await expect(status, 'drop never fired — status untouched').not.toHaveText('No source loaded yet.', { timeout: 15_000 });
  });

  test('multi-part item: question on the sheet, parts on tabs, no header question', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);

    const seeded = await window.evaluate(async () => {
      const db = (window as any).parallxElectron?.database;
      if (!db) return 'no-db-bridge';
      const open = await db.isOpen();
      if (!open?.isOpen) return 'db-not-open';
      const wb = (withSolution: boolean) => JSON.stringify({
        id: `e2e-mp-${Math.random().toString(36).slice(2)}`,
        name: 'Item',
        sheetOrder: ['p0', 'p1'],
        sheets: {
          p0: {
            id: 'p0', name: '(a)', rowCount: 150, columnCount: 40,
            cellData: {
              0: { 0: { v: 'Part a: compute the loss ratio.', s: { tb: 3, vt: 1 } } },
              5: { 1: { v: 'Premium', s: { bl: 1 } }, 2: { v: 1000 } },
              ...(withSolution ? { 7: { 2: { f: '=C6*0.65' } } } : {}),
            },
            mergeData: [{ startRow: 0, startColumn: 0, endRow: 3, endColumn: 9 }],
            rowData: { 0: { h: 20 }, 1: { h: 20 }, 2: { h: 20 }, 3: { h: 20 } },
          },
          p1: {
            id: 'p1', name: '(b)', rowCount: 150, columnCount: 40,
            cellData: { 0: { 0: { v: 'Part b: double it.', s: { tb: 3, vt: 1 } } } },
            mergeData: [{ startRow: 0, startColumn: 0, endRow: 3, endColumn: 9 }],
            rowData: { 0: { h: 20 }, 1: { h: 20 }, 2: { h: 20 }, 3: { h: 20 } },
          },
        },
      });
      await db.run("DELETE FROM ws_attempts WHERE item_id IN (SELECT id FROM ws_items WHERE title = 'E2E Multipart Item')");
      await db.run("DELETE FROM ws_items WHERE title = 'E2E Multipart Item'");
      const res = await db.run(
        `INSERT INTO ws_items (title, question_md, givens_json, solution_json, solution_notes_md, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['E2E Multipart Item', '(a) compute the loss ratio.\n\n(b) double it.', wb(false), wb(true), '', 'e2e', Date.now()],
      );
      return res?.error ? `insert-error: ${res.error.message}` : 'ok';
    });
    expect(seeded).toBe('ok');

    await window.locator('[data-part-id="workbench.parts.statusbar"]').click();
    await window.keyboard.press('Control+Shift+P');
    await expect(window.locator('.command-palette-overlay')).toBeVisible({ timeout: 3_000 });
    await window.locator('.command-palette-input').fill('>Worksheets: Open Practice Items');
    await window.locator('.command-palette-item', { hasText: 'Worksheets: Open Practice Items' }).first().click();
    await expect(window.locator('.ws-home')).toBeVisible({ timeout: 5_000 });
    await window.locator('.ws-itemrow', { hasText: 'E2E Multipart Item' }).first()
      .locator('button', { hasText: 'Practice' }).click();

    await expect(window.locator('.ws-item__title', { hasText: 'E2E Multipart Item' })).toBeVisible({ timeout: 10_000 });
    await waitForEngine(window);

    // On-sheet question model: NO header question block for new-style items.
    await expect(window.locator('.ws-item__question')).toHaveCount(0);
    // The workbook footer shows both part tabs.
    await expect(window.locator('.ws-pane__sheet', { hasText: '(a)' })).toBeVisible();
    await expect(window.locator('.ws-pane__sheet', { hasText: '(b)' })).toBeVisible();
    await window.screenshot({ path: path.join(SHOT_DIR, 'item-multipart-tabs.png') });
  });

  test('seeded item: practice → reveal → grade → state chip', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);

    // Seed one item straight into the workspace DB (generation is model-
    // dependent; the LOOP is what this test owns).
    const seeded = await window.evaluate(async () => {
      const db = (window as any).parallxElectron?.database;
      if (!db) return 'no-db-bridge';
      const open = await db.isOpen();
      if (!open?.isOpen) return 'db-not-open';
      const sheet = (cells: Record<number, Record<number, unknown>>) => JSON.stringify({
        id: `e2e-${Math.random().toString(36).slice(2)}`,
        name: 'Item',
        sheetOrder: ['sheet1'],
        sheets: { sheet1: { id: 'sheet1', name: 'Sheet1', rowCount: 150, columnCount: 40, cellData: cells } },
      });
      // The workspace DB is app-shared: scrub prior runs' seeds first, so
      // reruns stay idempotent and the user's real list stays clean.
      await db.run("DELETE FROM ws_attempts WHERE item_id IN (SELECT id FROM ws_items WHERE title = 'E2E Loss Ratio Item')");
      await db.run("DELETE FROM ws_items WHERE title = 'E2E Loss Ratio Item'");
      const givens = sheet({ 1: { 1: { v: 'Earned Premium', s: { bl: 1 } }, 2: { v: 1000 } } });
      const solution = sheet({
        1: { 1: { v: 'Earned Premium', s: { bl: 1 } }, 2: { v: 1000 } },
        3: { 1: { v: 'Loss Ratio', s: { bl: 1 } }, 2: { f: '=C2*0.65' } },
      });
      const res = await db.run(
        `INSERT INTO ws_items (title, question_md, givens_json, solution_json, solution_notes_md, tags, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['E2E Loss Ratio Item', 'Compute the **loss ratio** from the givens.', givens, solution,
          'Multiply premium by the expected ratio.', 'e2e,ratemaking', Date.now()],
      );
      return res?.error ? `insert-error: ${res.error.message}` : 'ok';
    });
    expect(seeded).toBe('ok');

    // Open the browser via the command palette — the sidebar may have
    // pre-rendered its empty state during reload (raw-SQL seeding fires no
    // change event), but the home pane builds fresh on open.
    await window.locator('[data-part-id="workbench.parts.statusbar"]').click();
    await window.keyboard.press('Control+Shift+P');
    await expect(window.locator('.command-palette-overlay')).toBeVisible({ timeout: 3_000 });
    await window.locator('.command-palette-input').fill('>Worksheets: Open Practice Items');
    await window.locator('.command-palette-item', { hasText: 'Worksheets: Open Practice Items' }).first().click();
    await expect(window.locator('.ws-home')).toBeVisible({ timeout: 5_000 });

    const row = window.locator('.ws-itemrow', { hasText: 'E2E Loss Ratio Item' }).first();
    await expect(row).toBeVisible({ timeout: 5_000 });
    await row.locator('button', { hasText: 'Practice' }).click();

    // Player: question above, engine below, actions present.
    await expect(window.locator('.ws-item__title', { hasText: 'E2E Loss Ratio Item' })).toBeVisible({ timeout: 10_000 });
    await expect(window.locator('.ws-item__question')).toContainText('loss ratio');
    await waitForEngine(window);
    await expect(window.locator('.ws-item__titlerow button', { hasText: 'Reset Sheet' })).toBeVisible();
    await window.screenshot({ path: path.join(SHOT_DIR, 'item-player.png') });

    // Reveal → self-grade.
    await window.locator('.ws-item__titlerow button', { hasText: 'Reveal Solution' }).click();
    await expect(window.locator('.ws-item__solutiontag', { hasText: 'Model Solution' })).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('.ws-item__solutionnotes')).toContainText('Multiply premium');
    await window.screenshot({ path: path.join(SHOT_DIR, 'item-solution.png') });

    await window.locator('.ws-item__grades button', { hasText: 'Nailed It' }).click();
    // Grading closes the attempt: Try Again appears.
    await expect(window.locator('.ws-item__solutionbar button', { hasText: 'Try Again' })).toBeVisible({ timeout: 5_000 });

    // The grade landed in the DB.
    const graded = await window.evaluate(async () => {
      const db = (window as any).parallxElectron?.database;
      const res = await db.get(
        "SELECT a.self_grade FROM ws_attempts a JOIN ws_items i ON i.id = a.item_id WHERE i.title = 'E2E Loss Ratio Item' AND a.completed = 1 ORDER BY a.updated_at DESC LIMIT 1",
      );
      return res?.row?.self_grade ?? null;
    });
    expect(graded).toBe('nailed');
  });
});
