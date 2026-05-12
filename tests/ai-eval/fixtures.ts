/**
 * Playwright fixtures for the AI canvas-interaction eval harness.
 *
 * One Electron app per test (clean state). Each test:
 *   1. Gets a unique workspace subfolder under
 *      D:\Documents\Parallx Workspaces\Testing\<scenarioId>__<UTC-ISO>\
 *      so multiple runs can sit side-by-side for post-mortem.
 *   2. Launches Electron with PARALLX_TEST_MODE=1.
 *   3. Installs the Ollama recorder (passthrough; talks to real localhost:11434).
 *   4. Opens the workspace folder.
 *   5. Waits for the chat tool's __parallx_chat_debug__ hook and sets the
 *      active model from PARALLX_AI_EVAL_MODEL.
 *   6. Hands the page + helpers to the scenario.
 *
 * Real Ollama is the point: we want to see how the model actually behaves.
 */
import { test as base, expect, type ElectronApplication, type Page } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { OllamaRecorder } from './ollamaRecorder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

const WORKSPACE_ROOT = process.env.PARALLX_AI_EVAL_WORKSPACE_ROOT
  || 'D:\\Documents\\Parallx Workspaces\\Testing';

export const AI_MODEL = (process.env.PARALLX_AI_EVAL_MODEL || 'gemma4:26b').trim();

interface AiEvalFixtures {
  electronApp: ElectronApplication;
  window: Page;
  workspacePath: string;
  recorder: OllamaRecorder;
  scenarioId: string;
}

export const aiEvalTest = base.extend<AiEvalFixtures>({
  // Scenario id derives from the spec file name; overridable per test via
  // `test.use({ scenarioId: 'foo' })` if multiple scenarios share a spec.
  scenarioId: async ({}, use, testInfo) => {
    const base = path.basename(testInfo.file).replace(/\.spec\.ts$/, '');
    const titleSlug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase();
    await use(`${base}__${titleSlug}`);
  },

  workspacePath: async ({ scenarioId }, use) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(WORKSPACE_ROOT, `${scenarioId}__${stamp}`);
    await fs.mkdir(dir, { recursive: true });
    await use(dir);
    // Intentionally NOT cleaning up: leave artifacts for the user to inspect.
  },

  recorder: async ({}, use) => {
    const r = new OllamaRecorder();
    await use(r);
  },

  electronApp: async ({ workspacePath }, use) => {
    // Pre-stage `data/last-workspace.json` so Parallx boots directly into the
    // test workspace. This avoids the menu-driven "Open Folder" flow, which
    // triggers a page reload and is the root cause of the previous harness
    // landing on the welcome screen / previous workspace. See
    // src/workbench/workbench.ts:_initializeServices — it reads
    // `${appPath}/data/last-workspace.json` on startup.
    const lastWsPath = path.join(PROJECT_ROOT, 'data', 'last-workspace.json');
    let originalLastWs: string | null = null;
    try { originalLastWs = await fs.readFile(lastWsPath, 'utf8'); } catch { /* may not exist */ }
    await fs.mkdir(path.dirname(lastWsPath), { recursive: true });
    await fs.writeFile(lastWsPath, JSON.stringify({ path: workspacePath }, null, 2), 'utf8');

    const app = await electron.launch({
      args: ['.'],
      cwd: PROJECT_ROOT,
      env: {
        ...process.env,
        PARALLX_TEST_MODE: '1',
        PARALLX_RENDERER_PORT: '0',
      },
    });
    try {
      await use(app);
    } finally {
      try { await app.close(); } catch { /* best effort */ }
      // Restore previous last-workspace.json so dev runs aren't affected.
      try {
        if (originalLastWs != null) await fs.writeFile(lastWsPath, originalLastWs, 'utf8');
        else await fs.unlink(lastWsPath).catch(() => {});
      } catch { /* best effort */ }
    }
  },

  window: async ({ electronApp, recorder, workspacePath }, use) => {
    const page = await electronApp.firstWindow();
    // Install Ollama recorder BEFORE any chat traffic flows. page.route()
    // survives navigations within the same Page object, so attaching here
    // (before the workbench is ready) is safe.
    await recorder.attach(page);

    // Wait for the workbench to finish its 5-phase startup. `.parallx-ready`
    // is added in LifecyclePhase.Ready (workbench.ts:736).
    await page.waitForSelector('.parallx-ready', { state: 'attached', timeout: 60_000 });

    // Sanity: the workspace folder we pre-staged must be the one that booted.
    // If the user had a stale workspace and our write race-lost, fail loud
    // rather than silently testing against the wrong workspace.
    const booted = await page.evaluate(async () => {
      const bridge = (window as any).parallxElectron?.storage;
      const appPath = (window as any).parallxElectron?.appPath;
      if (!bridge || !appPath) return null;
      const r = await bridge.readJson(`${appPath}/data/last-workspace.json`);
      return (r?.data as any)?.path ?? null;
    });
    if (!booted || normalizePath(booted) !== normalizePath(workspacePath)) {
      throw new Error(
        `[ai-eval] workspace mismatch: expected ${workspacePath}, booted ${booted ?? '(none)'}`,
      );
    }

    await use(page);
  },
});

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Wait for the chat tool to register its test-mode debug hook, then set the
 * active model. Idempotent and reliable across tool activation timing jitter.
 */
export async function waitForChatAndSetModel(page: Page, modelId: string): Promise<void> {
  // The chat tool activates on startupFinished and exposes __parallx_chat_debug__.
  await page.waitForFunction(
    () => Boolean((window as any).__parallx_chat_debug__?.setActiveModel),
    { timeout: 30_000 },
  );
  await page.evaluate((id) => {
    (window as any).__parallx_chat_debug__.setActiveModel(id);
  }, modelId);

  // Open the chat panel so the textarea is ready.
  const chatWidget = page.locator('.parallx-chat-widget');
  if (!(await chatWidget.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Shift+I');
    await chatWidget.waitFor({ state: 'visible', timeout: 10_000 });
  }

  // Collapse the session sidebar if it intercepts pointer events.
  const sidebar = page.locator('.parallx-chat-session-sidebar--visible');
  if (await sidebar.isVisible().catch(() => false)) {
    const historyBtn = page.locator('.parallx-chat-title-action--history');
    if (await historyBtn.isVisible().catch(() => false)) {
      await historyBtn.click();
      await page.waitForTimeout(200);
    }
  }
}

/** Type into the chat textarea and submit with Enter. */
export async function sendChat(page: Page, message: string): Promise<void> {
  const textarea = page.locator('.parallx-chat-input-textarea');
  await textarea.waitFor({ state: 'visible', timeout: 10_000 });
  await textarea.click({ force: true });
  await textarea.fill(message);
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');
}

/**
 * Wait for the assistant's reply to fully render. Returns the text of the
 * last assistant message. The chat widget removes `.parallx-chat-streaming-cursor`
 * when streaming finishes; multi-step tool-calling produces multiple
 * assistant messages but the last one is the "final" answer to the user.
 *
 * Long timeout: 24B+ models on consumer hardware can take 60+ seconds, and
 * multi-step tool sequences compound.
 */
export async function waitForAssistantReply(page: Page, timeoutMs = 4 * 60_000): Promise<string> {
  const msgBody = page.locator('.parallx-chat-message--assistant .parallx-chat-message-body');
  await msgBody.last().waitFor({ state: 'visible', timeout: timeoutMs });

  // Then wait for streaming to settle. We watch the cursor: it appears
  // while tokens are streaming and is removed when the turn finishes.
  // For multi-step tool calls there may be several appearances; we wait
  // for it to be absent for a sustained period (3 seconds).
  const start = Date.now();
  let lastSeenAt = Date.now();
  while (Date.now() - start < timeoutMs) {
    const present = await page.locator('.parallx-chat-streaming-cursor').count() > 0;
    if (present) {
      lastSeenAt = Date.now();
    } else if (Date.now() - lastSeenAt > 3_000) {
      break;
    }
    await page.waitForTimeout(250);
  }

  return (await msgBody.last().textContent()) || '';
}

/** Approve every pending tool-call card. Some tools require approval; we
 *  auto-approve in eval mode so the model can complete its work and we can
 *  measure end-state. The rubric can still grade `requires-approval` correctness. */
export async function autoApprovePending(page: Page): Promise<number> {
  let clicked = 0;
  for (let i = 0; i < 10; i++) {
    const approveBtn = page.locator('.parallx-chat-agent-approval-card button', { hasText: /approve|allow/i }).first();
    if (!(await approveBtn.isVisible().catch(() => false))) break;
    await approveBtn.click().catch(() => { /* ignore */ });
    clicked++;
    await page.waitForTimeout(400);
  }
  return clicked;
}

export { expect };
