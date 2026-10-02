/**
 * Autonomy / Heartbeat — engage the live autonomy system from the user's seat.
 *
 * This is an OBSERVATION test, not a pass/fail gate: it opens a clean workspace,
 * opens Agents (Routines), turns the heartbeat on, fires a real review ("Wake
 * now"), and captures what the system actually does — the status board, any
 * Agents History entries, the heartbeat executor's own console decisions
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

/** Run a workbench command from inside the window. */
async function runCommand(page: Page, id: string): Promise<void> {
  await page.evaluate(async (cmd) => {
    const wb = (window as unknown as { __parallx_workbench__?: { _services: { get(x: { id: string }): { executeCommand(id: string): Promise<unknown> } } } }).__parallx_workbench__;
    await wb?._services.get({ id: 'ICommandService' }).executeCommand(cmd);
  }, id);
  await page.waitForTimeout(800);
}

/** Open Agents on a tab (autonomy lives there; the old panel is gone). */
async function openAgents(page: Page, tab: 'Routines' | 'History' | 'Mind'): Promise<boolean> {
  await runCommand(page, 'agents.show');
  const seg = page.locator('.agents-tabs').getByText(tab, { exact: true }).first();
  if (await seg.isVisible().catch(() => false)) await seg.click();
  await page.waitForTimeout(700);
  return page.locator('.agents-view').isVisible().catch(() => false);
}

/** The Routines status card whose name matches `label` (e.g. "Heartbeat"). */
function statusRow(page: Page, label: string) {
  return page.locator('.agents-rt__status').filter({ hasText: label }).first();
}
/** The card's state, read from its class: 'on' | 'off' | 'paused' | ''. */
async function rowState(page: Page, label: string): Promise<string> {
  const cls = (await statusRow(page, label).getAttribute('class').catch(() => '')) ?? '';
  return /agents-rt__status--(on|off|paused)/.exec(cls)?.[1] ?? '';
}
async function rowDetail(page: Page, label: string): Promise<string> {
  return (await statusRow(page, label).locator('.agents-rt__line').first().textContent().catch(() => '')) ?? '';
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

      const opened = await openAgents(window, 'Routines');
      expect(opened, 'Agents should open on Routines').toBeTruthy();

      // ── Enable the heartbeat if it's off ──
      await statusRow(window, 'Heartbeat').waitFor({ state: 'visible', timeout: 10_000 });
      const badgeBefore = await rowState(window, 'Heartbeat');
      if (badgeBefore === 'off') {
        await statusRow(window, 'Heartbeat').locator('.px-btn', { hasText: 'Turn On' }).first().click();
        await window.waitForTimeout(1500);
      }
      const badgeAfter = await rowState(window, 'Heartbeat');
      const detailAfter = await rowDetail(window, 'Heartbeat');

      // ── Fire a real review (Wake now) and watch ──
      await openAgents(window, 'History');
      const logCountBefore = await window.locator('.agents-hist__row').count().catch(() => 0);
      await openAgents(window, 'Routines');
      const wakeBtn = statusRow(window, 'Heartbeat').locator('.px-btn', { hasText: 'Wake' }).first();
      let woke = false;
      if (await wakeBtn.isVisible().catch(() => false)) {
        await wakeBtn.click();
        woke = true;
      }

      // Give the review a real-turn window to run (LLM through the local model).
      await window.waitForTimeout(45_000);

      await openAgents(window, 'History');
      const logCountAfter = await window.locator('.agents-hist__row').count().catch(() => 0);
      const newEntries = await window.locator('.agents-hist__row').allTextContents().catch(() => []);

      // The Mind tab: the visible inner model, said in words. Forget a belief
      // and confirm it's gone (the mind is editable).
      const mindEditable = { panelOpened: false, beliefsBefore: 0, beliefsAfter: 0 };
      mindEditable.panelOpened = await openAgents(window, 'Mind');
      await window.waitForTimeout(900);
      const mindBadge = '';
      const mindDetail = (await window.locator('.agents-mind__meters').textContent().catch(() => '')) ?? '';
      mindEditable.beliefsBefore = await window.locator('.agents-mind__belief').count().catch(() => 0);
      if (mindEditable.beliefsBefore > 0) {
        await window.locator('.agents-mind__belief').first().locator('.px-btn', { hasText: 'Forget' }).click();
        await window.waitForTimeout(900);
        mindEditable.beliefsAfter = await window.locator('.agents-mind__belief').count().catch(() => 0);
      }

      const observation = {
        workspace: ws,
        chatStarted,
        woke,
        mind: { badge: mindBadge.trim(), detail: mindDetail.trim() },
        mindEditable,
        heartbeat: { badgeBefore, badgeAfter, detailAfter },
        log: { before: logCountBefore, after: logCountAfter, entries: newEntries.slice(0, 20) },
        heartbeatConsole: consoleLines.slice(0, 80),
      };
      const jsonPath = path.join(ARTIFACT_DIR, 'observation.json');
      await fs.writeFile(jsonPath, JSON.stringify(observation, null, 2), 'utf8');
      await window.screenshot({ path: path.join(ARTIFACT_DIR, 'autonomy-heartbeat.png'), fullPage: true });
      await testInfo.attach('observation', { path: jsonPath, contentType: 'application/json' });

      // Soft signal: we engaged the system. The artifact is the real deliverable.
      expect(badgeAfter.length, 'heartbeat cell should expose a state (dot class)').toBeGreaterThan(0);
    } finally {
      await cleanupTestWorkspace(ws);
    }
  });
});
