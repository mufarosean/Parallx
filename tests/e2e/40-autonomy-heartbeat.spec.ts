/**
 * Autonomy / Heartbeat — engage the live autonomy system from the user's seat.
 *
 * This is an OBSERVATION test, not a pass/fail gate: it opens a clean workspace,
 * opens the Autonomy Log, enables the heartbeat, fires a real review ("Wake
 * now"), and captures what the system actually does — the status board, any
 * autonomy-log entries, the heartbeat executor's own console decisions
 * (NOOP / NOTE / ACT), and a screenshot. The review runs a real LLM turn through
 * the local model, so this exercises the whole awareness loop end to end.
 *
 * Run (strip ELECTRON_RUN_AS_NODE so Electron boots as a GUI, isolate userData):
 *   env -u ELECTRON_RUN_AS_NODE PARALLX_USER_DATA="$(mktemp -d)" \
 *     npx playwright test tests/e2e/40-autonomy-heartbeat.spec.ts
 */
import { test, expect, openFolderViaMenu, createTestWorkspace, cleanupTestWorkspace } from './fixtures';
import fs from 'fs/promises';
import path from 'path';
import type { Page, ElectronApplication } from '@playwright/test';

const ARTIFACT_DIR = path.join(process.cwd(), 'test-results', 'autonomy-heartbeat');

/** Open the Autonomy Log panel view via the command palette, with fallbacks. */
async function openAutonomyLog(page: Page): Promise<boolean> {
  if (await page.locator('.autonomy-log-container').isVisible().catch(() => false)) return true;
  // Command palette → "Autonomy Log".
  for (const combo of ['Control+Shift+P', 'F1', 'Control+P']) {
    await page.keyboard.press(combo);
    const input = page.locator('input.quick-input-box, .quick-input-widget input, input[placeholder*="ommand"]').first();
    if (await input.isVisible().catch(() => false)) {
      await input.fill('Autonomy Log');
      await page.waitForTimeout(400);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
      if (await page.locator('.autonomy-log-container').isVisible().catch(() => false)) return true;
    }
    await page.keyboard.press('Escape').catch(() => {});
  }
  // Fallback: click a panel tab labelled "Autonomy Log".
  const tab = page.locator('[role="tab"], .tab, .panel-tab').filter({ hasText: 'Autonomy Log' }).first();
  if (await tab.isVisible().catch(() => false)) {
    await tab.click();
    await page.waitForTimeout(500);
  }
  return page.locator('.autonomy-log-container').isVisible().catch(() => false);
}

/** The status-board row whose name matches `label` (e.g. "Heartbeat"). */
function statusRow(page: Page, label: string) {
  return page.locator('.autonomy-status__row').filter({ hasText: label }).first();
}
async function rowBadge(page: Page, label: string): Promise<string> {
  return (await statusRow(page, label).locator('.autonomy-status__badge').first().textContent().catch(() => '')) ?? '';
}
async function rowDetail(page: Page, label: string): Promise<string> {
  return (await statusRow(page, label).locator('.autonomy-status__detail').first().textContent().catch(() => '')) ?? '';
}

test.describe('Autonomy / Heartbeat (live)', () => {
  test('enable → wake → observe the heartbeat review', async ({ window, electronApp }, testInfo) => {
    test.setTimeout(240_000);
    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    // Capture the heartbeat/autonomy console decisions as the system thinks.
    const consoleLines: string[] = [];
    window.on('console', (msg) => {
      const t = msg.text();
      if (/heartbeat|autonomy|HeartbeatExecutor|HeartbeatRunner|review/i.test(t)) {
        consoleLines.push(`[${msg.type()}] ${t}`);
      }
    });

    const ws = await createTestWorkspace();
    try {
      await openFolderViaMenu(electronApp, window, ws, { force: true });
      await window.waitForTimeout(1500);

      // Send one chat message so a real session exists — the heartbeat review
      // needs a parent session (Phase 4 fallback). Merely opening the panel
      // isn't enough; a session is created on first send.
      await window.keyboard.press('Control+Shift+I');
      const textarea = window.locator('.parallx-chat-input-textarea');
      let chatStarted = false;
      if (await textarea.isVisible({ timeout: 8000 }).catch(() => false)) {
        await textarea.click({ force: true });
        await textarea.fill('hi');
        await window.keyboard.press('Enter');
        chatStarted = true;
        await window.waitForTimeout(6000); // let the session register (+ model start)
      }

      const opened = await openAutonomyLog(window);
      expect(opened, 'Autonomy Log panel should open').toBeTruthy();

      // ── Enable the heartbeat if it's off ──
      await statusRow(window, 'Heartbeat').waitFor({ state: 'visible', timeout: 10_000 });
      const badgeBefore = await rowBadge(window, 'Heartbeat');
      if (/off/i.test(badgeBefore)) {
        await statusRow(window, 'Heartbeat').locator('.autonomy-status__btn', { hasText: 'Enable' }).first().click();
        await window.waitForTimeout(1500);
      }
      const badgeAfter = await rowBadge(window, 'Heartbeat');
      const detailAfter = await rowDetail(window, 'Heartbeat');

      // ── Fire a real review (Wake now) and watch ──
      const logCountBefore = await window.locator('.autonomy-log-entry').count().catch(() => 0);
      const wakeBtn = statusRow(window, 'Heartbeat').locator('.autonomy-status__btn', { hasText: 'Wake' }).first();
      let woke = false;
      if (await wakeBtn.isVisible().catch(() => false)) {
        await wakeBtn.click();
        woke = true;
      }

      // Give the review a real-turn window to run (LLM through the local model).
      await window.waitForTimeout(45_000);

      const logCountAfter = await window.locator('.autonomy-log-entry').count().catch(() => 0);
      const newEntries = await window.locator('.autonomy-log-entry').allTextContents().catch(() => []);

      const observation = {
        workspace: ws,
        chatStarted,
        woke,
        heartbeat: { badgeBefore, badgeAfter, detailAfter },
        log: { before: logCountBefore, after: logCountAfter, entries: newEntries.slice(0, 20) },
        heartbeatConsole: consoleLines.slice(0, 80),
      };
      const jsonPath = path.join(ARTIFACT_DIR, 'observation.json');
      await fs.writeFile(jsonPath, JSON.stringify(observation, null, 2), 'utf8');
      await window.screenshot({ path: path.join(ARTIFACT_DIR, 'autonomy-heartbeat.png'), fullPage: true });
      await testInfo.attach('observation', { path: jsonPath, contentType: 'application/json' });

      // Soft signal: we engaged the system. The artifact is the real deliverable.
      expect(badgeAfter.length, 'heartbeat status badge should be present').toBeGreaterThan(0);
    } finally {
      await cleanupTestWorkspace(ws);
    }
  });
});
