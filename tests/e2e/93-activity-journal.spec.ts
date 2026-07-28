// 93-activity-journal.spec.ts — the Activity Journal narrates real actions
// and the Activity panel shows them.
//
// End-to-end over the full chain: taps (session boundary, command execution)
// → ActivityJournalService (ring + coalescing) → the built-in Activity panel
// (view.activityLog) rendering live rows with actor chips.
//
// Run note (this repo): `env -u ELECTRON_RUN_AS_NODE npx playwright test` —
// the VS Code extension host leaks ELECTRON_RUN_AS_NODE=1, which makes
// Electron boot as plain node.

import { test, expect } from './fixtures';

test('activity journal: session + command lines reach the Activity panel', async ({ window }) => {
  test.setTimeout(90_000);

  const pageErrors: string[] = [];
  window.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));

  // Boot: titlebar is the last chrome the workbench mounts.
  await window.waitForSelector('[data-part-id="workbench.parts.titlebar"]', {
    state: 'attached',
    timeout: 60_000,
  });
  await window.waitForTimeout(1_500); // let Phase-5 activations settle

  const panel = window.locator('[data-part-id="workbench.parts.panel"]');

  // Run "Toggle Panel" through the palette — this is BOTH the way to reveal
  // the panel and a deterministic command-tap event for the journal.
  const togglePanelViaPalette = async () => {
    await window.keyboard.press('Control+Shift+p');
    const input = window.locator('.command-palette-input');
    await expect(input).toBeVisible({ timeout: 3_000 });
    await input.pressSequentially('Toggle Panel', { delay: 30 });
    await window.waitForTimeout(400);
    await window.locator('.command-palette-item').first().click();
    await window.waitForTimeout(400);
  };

  await togglePanelViaPalette();
  if (!(await panel.isVisible())) {
    // First toggle hid an initially-visible panel — bring it back.
    await togglePanelViaPalette();
  }
  await expect(panel).toBeVisible({ timeout: 3_000 });

  // Open the Activity tab inside the panel.
  const activityTab = panel.getByText('Activity', { exact: true }).first();
  await expect(activityTab).toBeVisible({ timeout: 5_000 });
  await activityTab.click();

  // Rows appear — the journal has been narrating since boot.
  const rows = window.locator('.activity-log-row');
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  const texts = await rows.allInnerTexts();
  const joined = texts.join('\n');
  console.log(`[activity-e2e] ${texts.length} row(s) visible:\n${joined}`);

  // 1. The session boundary line (actor: app) from the taps' wiring moment.
  expect(joined).toMatch(/started\s+session/i);

  // 2. The command tap narrated the palette execution by its human title.
  expect(joined).toMatch(/ran\s+.*Toggle Panel/i);

  // 3. Actor chips render — the session line is "app", the command is "user".
  const chipTexts = await window.locator('.activity-log-actor').allInnerTexts();
  expect(chipTexts.map((t) => t.toLowerCase())).toEqual(
    expect.arrayContaining(['app', 'user']),
  );

  // 4. The actor filter narrows the list: "User" hides the app session line.
  await panel.getByRole('button', { name: 'User', exact: true }).click();
  await window.waitForTimeout(300);
  const filtered = (await rows.allInnerTexts()).join('\n');
  expect(filtered).not.toMatch(/started\s+session/i);
  expect(filtered).toMatch(/ran\s+.*Toggle Panel/i);

  // 5. Live append: run another palette command while the panel is open and
  //    watch the new row arrive without a reload.
  await window.keyboard.press('Control+Shift+p');
  const input = window.locator('.command-palette-input');
  await expect(input).toBeVisible({ timeout: 3_000 });
  await input.pressSequentially('Toggle Sidebar', { delay: 30 });
  await window.waitForTimeout(400);
  await window.locator('.command-palette-item').first().click();
  await window.waitForTimeout(600);
  const afterLive = (await rows.allInnerTexts()).join('\n');
  // Palette fuzzy-match resolves to "View: Toggle Primary Sidebar".
  expect(afterLive).toMatch(/ran\s+.*Toggle (Primary )?Sidebar/i);

  expect(pageErrors, 'uncaught renderer exceptions').toEqual([]);
});
