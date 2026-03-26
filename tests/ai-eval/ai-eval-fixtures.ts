/**
 * AI Quality Evaluation — Playwright Fixtures
 *
 * Provides a worker-scoped Electron instance with the evaluation workspace loaded.
 * Uses REAL Ollama inference — no mocking. Tests exercise the exact same
 * code path a user follows: launch app → open folder → open chat → type → read.
 *
 * Prerequisites:
 *   - Ollama running at localhost:11434
 *   - The test model pulled (default: `ollama pull gpt-oss:20b`)
 */
import {
  test as base,
  expect,
  type Page,
  type ElectronApplication,
} from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEMO_WORKSPACE_SRC = path.join(PROJECT_ROOT, 'demo-workspace');
const ELECTRON_CLOSE_TIMEOUT = 10_000;
const DEFAULT_TEST_CHAT_MODEL = 'gpt-oss:20b';

/** Default timeout for waiting on an LLM response (2 minutes). */
export const RESPONSE_TIMEOUT = 120_000;

/** Time to wait for fire-and-forget memory summarization after a session (20s). */
export const MEMORY_STORE_WAIT = 20_000;

export interface ChatEvalDebugSnapshot {
  query?: string;
  retrievedContextText?: string;
  ragSources: Array<{ uri: string; label: string; index: number }>;
  contextPills: Array<{ id: string; label: string; type: string; removable: boolean; index?: number; tokens?: number }>;
  retrievalTrace?: unknown;
  isRAGAvailable: boolean;
  isIndexing: boolean;
  requestInProgress?: boolean;
  pendingRequestCount?: number;
  assistantMessageCount?: number;
  lastAssistantResponseText?: string;
  lastAssistantResponseComplete?: boolean;
  lastAssistantPartKinds?: string[];
  lastAssistantPartSummary?: Array<{ kind: string; preview: string }>;
  responseDebug?: {
    phase: string;
    markdownLength: number;
    yielded: boolean;
    cancelled: boolean;
    retrievedContextLength: number;
    note?: string;
  };
  retrievalGate?: {
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
    needsRetrieval: boolean;
    attempted: boolean;
    returnedSources?: number;
  };
  explicitSourceDebug?: {
    attempted: boolean;
    matchedPath?: string;
    readSucceeded: boolean;
    reason?: string;
  };
  runtimeTrace?: {
    route: {
      kind: string;
      reason: string;
    };
    contextPlan: {
      route: string;
      intent: string;
      useRetrieval: boolean;
      useMemoryRecall: boolean;
      useConceptRecall: boolean;
      useCurrentPage: boolean;
      citationMode: string;
      reasoning: string;
      retrievalPlan: {
        intent: string;
        reasoning: string;
        needsRetrieval: boolean;
        queries: string[];
        coverageMode?: 'representative' | 'exhaustive';
      };
    };
    semanticFallback?: {
      kind: string;
      confidence: number;
      reason: string;
    };
    routeAuthority?: {
      action: 'preserved' | 'corrected';
      reason: string;
    };
    sessionId?: string;
    hasActiveSlashCommand: boolean;
    isRagReady: boolean;
  };
  bootstrapContext?: {
    maxChars: number;
    totalMaxChars: number;
    totalRawChars: number;
    totalInjectedChars: number;
    files: Array<{
      name: string;
      path: string;
      missing: boolean;
      rawChars: number;
      injectedChars: number;
      truncated: boolean;
      causes: string[];
    }>;
    warningLines: string[];
  };
  retrievalError?: string;
}

// ── Workspace Copy ───────────────────────────────────────────────────────────

function resolveWorkspaceSource(): { sourcePath: string; label: string } {
  const overridePath = process.env.PARALLX_AI_EVAL_WORKSPACE?.trim();
  if (!overridePath) {
    return {
      sourcePath: DEMO_WORKSPACE_SRC,
      label: 'demo-workspace',
    };
  }

  const sourcePath = path.resolve(overridePath);
  return {
    sourcePath,
    label: path.basename(sourcePath) || sourcePath,
  };
}

/**
 * Copy the selected evaluation workspace to a temp directory so that the .parallx/ database
 * folder doesn't pollute the source workspace. Excludes SMOKE_TEST_CHECKLIST.md to avoid
 * test metadata leaking into RAG results.
 */
async function copyEvalWorkspace(): Promise<{ workspacePath: string; workspaceLabel: string }> {
  const { sourcePath, label } = resolveWorkspaceSource();
  const stat = await fs.stat(sourcePath).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`AI eval workspace not found or not a directory: ${sourcePath}`);
  }

  const dest = path.join(os.tmpdir(), `parallx-ai-eval-${Date.now()}`);
  await fs.cp(sourcePath, dest, { recursive: true });
  try {
    await fs.rm(path.join(dest, 'SMOKE_TEST_CHECKLIST.md'));
  } catch { /* may not exist */ }

  const configOverride = process.env.PARALLX_AI_CONFIG_OVERRIDE;
  if (configOverride) {
    const overrideDir = path.join(dest, '.parallx');
    await fs.mkdir(overrideDir, { recursive: true });
    await fs.writeFile(path.join(overrideDir, 'ai-config.json'), configOverride, 'utf8');
  }

  return { workspacePath: dest, workspaceLabel: label };
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch { /* best effort */ }
}

async function closeElectronApp(app: ElectronApplication): Promise<void> {
  const child = app.process();

  try {
    await Promise.race([
      app.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Electron close timeout')), ELECTRON_CLOSE_TIMEOUT)),
    ]);
  } catch (err) {
    console.warn(`[AI Eval] closeElectronApp fallback: ${err}`);
    if (child && child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch { /* best effort */ }
    }
  }

  if (child && child.exitCode === null && !child.killed) {
    try {
      child.kill();
    } catch { /* best effort */ }
  }
}

// ── Ollama Health Check ──────────────────────────────────────────────────────

async function checkOllama(): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const resp = await fetch('http://localhost:11434/api/tags');
    if (!resp.ok) return { ok: false, error: `Ollama returned HTTP ${resp.status}` };
    const data = (await resp.json()) as { models?: { name: string }[] };
    const requestedModel = (process.env.PARALLX_TEST_CHAT_MODEL || DEFAULT_TEST_CHAT_MODEL).trim();
    const models = data.models?.map(model => model.name) ?? [];
    if (!models.includes(requestedModel)) {
      return {
        ok: false,
        error: `Required test model '${requestedModel}' is not installed. Available models: ${models.join(', ') || '(none)'}`,
      };
    }
    return { ok: true, model: requestedModel };
  } catch (e) {
    return { ok: false, error: `Ollama not reachable at localhost:11434: ${e}` };
  }
}

// ── Fixture Types ────────────────────────────────────────────────────────────

type WorkerFixtures = {
  electronApp: ElectronApplication;
  window: Page;
  workspacePath: string;
  workspaceLabel: string;
  workspaceHasPersistedIndex: boolean;
  /** Name of the test model required for the run (defaults to "gpt-oss:20b"). */
  ollamaModel: string;
};

// ── Fixture Definition ───────────────────────────────────────────────────────

export const test = base.extend<{}, WorkerFixtures>({
  // Check Ollama first — fail fast with a clear message if not running.
  ollamaModel: [
    async ({}, use) => {
      const health = await checkOllama();
      if (!health.ok) {
        throw new Error(
          `\n${'='.repeat(60)}\n` +
          `  Ollama is not running!\n\n` +
          `  AI evaluation tests require a live Ollama instance.\n` +
          `  Start it and pull the required test model before running:\n\n` +
          `    ollama serve\n` +
          `    ollama pull ${(process.env.PARALLX_TEST_CHAT_MODEL || DEFAULT_TEST_CHAT_MODEL).trim()}\n\n` +
          `  Error: ${health.error}\n` +
          `${'='.repeat(60)}\n`,
        );
      }
      await use(health.model!);
    },
    { scope: 'worker' },
  ],

  workspacePath: [
    async ({}, use) => {
      const { workspacePath } = await copyEvalWorkspace();
      await use(workspacePath);
      await cleanupDir(workspacePath);
    },
    { scope: 'worker' },
  ],

  workspaceLabel: [
    async ({}, use) => {
      const { workspaceLabel } = resolveWorkspaceSource();
      await use(workspaceLabel);
    },
    { scope: 'worker' },
  ],

  workspaceHasPersistedIndex: [
    async ({}, use) => {
      const { sourcePath } = resolveWorkspaceSource();
      const persistedIndex = await fs.stat(path.join(sourcePath, '.parallx', 'data.db')).catch(() => null);
      await use(!!persistedIndex?.isFile());
    },
    { scope: 'worker' },
  ],

  electronApp: [
    // Depend on ollamaModel so the health check runs first.
    async ({ ollamaModel: _model }, use) => {
      const app = await electron.launch({
        args: ['.'],
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          PARALLX_TEST_MODE: '1',
          PARALLX_RENDERER_PORT: '0',
        },
      });

      const child = app.process();
      if (child) {
        child.once('exit', (code, signal) => {
          console.warn(`[AI Eval] Electron process exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
        });
      }

      app.on('close', () => {
        console.warn('[AI Eval] Electron application close event fired');
      });

      await use(app);
      await closeElectronApp(app);
    },
    { scope: 'worker' },
  ],

  window: [
    async ({ electronApp }, use) => {
      const page = await electronApp.firstWindow();
      page.on('close', () => {
        console.warn(`[AI Eval] Renderer page closed url=${page.url() || '(unknown)'}`);
      });
      page.on('crash', () => {
        console.warn('[AI Eval] Renderer page crashed');
      });
      await page.waitForSelector(
        '[data-part-id="workbench.parts.titlebar"]',
        { timeout: 30_000 },
      );
      await use(page);
    },
    { scope: 'worker' },
  ],
});

export { expect };

// ── UI Helpers ───────────────────────────────────────────────────────────────

/**
 * Open a folder by mocking the native file dialog IPC and clicking
 * File → Open Folder. Skips if the tree already has nodes.
 */
export async function openFolderViaMenu(
  app: ElectronApplication,
  page: Page,
  folderPath: string,
): Promise<void> {
  // Mock the OS dialog — Playwright can't drive native dialogs
  await app.evaluate(({ ipcMain }, fp) => {
    ipcMain.removeHandler('dialog:openFolder');
    ipcMain.handle('dialog:openFolder', async () => [fp]);
  }, folderPath);

  // Click File → Open Folder
  const fileMenu = page.locator('.titlebar-menu-item[data-menu-id="file"]');
  await fileMenu.click();

  const dropdown = page.locator('.context-menu.titlebar-dropdown');
  await dropdown.waitFor({ state: 'visible', timeout: 3_000 });

  const openFolderItem = dropdown.locator('.context-menu-item', { hasText: 'Open Folder' });
  await openFolderItem.click();

  // Wait for the reload cycle to complete
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 15_000 });
    await page.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 15_000 });
  } catch { /* timing can vary */ }

  await page.waitForTimeout(2_000);
  await page.waitForSelector('.tree-node', { timeout: 10_000 });
}

/**
 * Open the chat panel via Ctrl+Shift+I.
 * Retries up to 3 times to wait for the chat tool to activate.
 */
export async function openChatPanel(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const chatWidget = page.locator('.parallx-chat-widget');
    if (await chatWidget.isVisible().catch(() => false)) {
      await collapseSessionSidebar(page);
      return;
    }

    await page.keyboard.press('Control+Shift+I');
    try {
      await chatWidget.waitFor({ state: 'visible', timeout: 5_000 });
      await collapseSessionSidebar(page);
      return;
    } catch {
      await page.waitForTimeout(2_000);
    }
  }

  // Final attempt with full timeout
  await page.keyboard.press('Control+Shift+I');
  await page.locator('.parallx-chat-widget').waitFor({ state: 'visible', timeout: 10_000 });
  await collapseSessionSidebar(page);
}

export async function waitForRagReady(page: Page, timeout = 120_000): Promise<void> {
  try {
    await page.waitForFunction(
      () => {
        const host = window as unknown as {
          __parallx_chat_debug__?: { getSnapshot?: () => { isRAGAvailable?: boolean; isIndexing?: boolean } };
        };
        const snapshot = host.__parallx_chat_debug__?.getSnapshot?.();
        return !!snapshot?.isRAGAvailable && !snapshot?.isIndexing;
      },
      undefined,
      { timeout },
    );
  } catch (error) {
    const timeoutDebug = await page.evaluate(() => {
      const host = window as unknown as {
        __parallx_chat_debug__?: {
          getSnapshot?: () => {
            isRAGAvailable?: boolean;
            isIndexing?: boolean;
            indexingProgress?: { phase?: string; processed?: number; total?: number; currentSource?: string };
            indexStats?: { pages?: number; files?: number };
          };
        };
      };
      const snapshot = host.__parallx_chat_debug__?.getSnapshot?.();
      return {
        snapshot,
        progress: snapshot?.indexingProgress,
        stats: snapshot?.indexStats,
      };
    }).catch(() => undefined);

    const progress = timeoutDebug?.progress;
    const stats = timeoutDebug?.stats;
    const snapshot = timeoutDebug?.snapshot;
    const details = [
      `timeout=${timeout}`,
      `isRAGAvailable=${String(snapshot?.isRAGAvailable)}`,
      `isIndexing=${String(snapshot?.isIndexing)}`,
      `phase=${String(progress?.phase)}`,
      `processed=${String(progress?.processed)}`,
      `total=${String(progress?.total)}`,
      `currentSource=${String(progress?.currentSource ?? '')}`,
      `indexedPages=${String(stats?.pages ?? '')}`,
      `indexedFiles=${String(stats?.files ?? '')}`,
    ].join(' ');

    throw new Error(`RAG readiness timeout. ${details}. cause=${String(error)}`);
  }

  const configOverride = process.env.PARALLX_AI_CONFIG_OVERRIDE;
  if (configOverride) {
    const overrideResult = await page.evaluate(async (overrideText) => {
      const host = window as unknown as {
        __parallx_chat_debug__?: {
          updateWorkspaceOverride?: (patch: unknown) => Promise<void> | void;
        };
      };
      const patch = JSON.parse(overrideText) as { overrides?: unknown };
      await host.__parallx_chat_debug__?.updateWorkspaceOverride?.(patch.overrides ?? patch);
      return {
        hasDebugHook: !!host.__parallx_chat_debug__,
        hasUpdate: typeof host.__parallx_chat_debug__?.updateWorkspaceOverride === 'function',
      };
    }, configOverride);

    if (!overrideResult.hasUpdate) {
      throw new Error(
        `AI config override could not be applied. ` +
        `debugHook=${overrideResult.hasDebugHook} updateMethod=${overrideResult.hasUpdate}`,
      );
    }
  }

  const requestedModel = (process.env.PARALLX_TEST_CHAT_MODEL || DEFAULT_TEST_CHAT_MODEL).trim();
  const modelResult = await page.evaluate(async (modelId) => {
    const host = window as unknown as {
      __parallx_chat_debug__?: {
        setActiveModel?: (id: string) => Promise<void> | void;
        getActiveModel?: () => string | undefined;
      };
    };
    await host.__parallx_chat_debug__?.setActiveModel?.(modelId);
    return {
      hasDebugHook: !!host.__parallx_chat_debug__,
      hasSetter: typeof host.__parallx_chat_debug__?.setActiveModel === 'function',
      activeModel: host.__parallx_chat_debug__?.getActiveModel?.(),
    };
  }, requestedModel);

  if (modelResult.activeModel !== requestedModel) {
    throw new Error(
      `Test chat model did not apply. expected=${requestedModel} actual=${String(modelResult.activeModel)} ` +
      `debugHook=${modelResult.hasDebugHook} setter=${modelResult.hasSetter}`,
    );
  }
}

/** Collapse the session sidebar if it overlaps the input area. */
async function collapseSessionSidebar(page: Page): Promise<void> {
  const sidebar = page.locator('.parallx-chat-session-sidebar--visible');
  if (await sidebar.isVisible().catch(() => false)) {
    const historyBtn = page.locator('.parallx-chat-title-action--history');
    if (await historyBtn.isVisible().catch(() => false)) {
      await historyBtn.click();
      await page.waitForTimeout(300);
    }
  }
}

/**
 * Click the "New Chat" button to start a fresh session.
 */
export async function startNewSession(page: Page): Promise<void> {
  const newChatBtn = page.locator('.parallx-chat-title-action--new');
  if (await newChatBtn.isVisible().catch(() => false)) {
    await newChatBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Send a chat message and wait for the AI to finish responding.
 *
 * Returns the response text content and wall-clock latency.
 * Handles multi-turn conversations by tracking the assistant message count
 * before/after sending so it always reads the newest response.
 *
 * Text extraction strategy (in order of preference):
 * 1. `.parallx-chat-markdown` inside the LAST assistant message — the actual answer
 * 2. JavaScript-based extraction that explicitly strips thinking/source/tool UI
 */
export async function sendAndWaitForResponse(
  page: Page,
  message: string,
  timeout = RESPONSE_TIMEOUT,
): Promise<{ text: string; latencyMs: number; debug?: ChatEvalDebugSnapshot }> {
  await page.evaluate(() => {
    const host = window as unknown as {
      __parallx_chat_debug__?: { resetSnapshot?: () => void };
    };
    host.__parallx_chat_debug__?.resetSnapshot?.();
  }).catch(() => undefined);

  // Count existing assistant messages BEFORE sending
  const assistantMsgs = page.locator('.parallx-chat-message--assistant');
  const beforeCount = await assistantMsgs.count();

  const start = Date.now();

  // Type and submit
  const textarea = page.locator('.parallx-chat-input-textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5_000 });
  await textarea.click({ force: true });
  await textarea.fill(message);
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');

  // Wait for a NEW assistant message container to appear
  await page.waitForFunction(
    (prev: number) =>
      document.querySelectorAll('.parallx-chat-message--assistant').length > prev,
    beforeCount,
    { timeout },
  ).catch((err) => {
    throw new Error(`Timed out waiting for a new assistant message container: ${err}`);
  });

  // Wait for the streaming cursor to disappear (response fully rendered).
  // The agentic loop may cause the cursor to appear/disappear multiple times
  // (thinking → tool calls → final answer). We loop to handle this:
  // wait for cursor gone → short settle → check if it reappeared.
  for (let cursorRound = 0; cursorRound < 8; cursorRound++) {
    await page.waitForFunction(
      () => !document.querySelector('.parallx-chat-streaming-cursor'),
      { timeout },
    ).catch(() => { /* cursor may already be gone */ });

    // Settle briefly, then check if cursor reappeared (new streaming round)
    await page.waitForTimeout(2_500);
    const cursorBack = await page.evaluate(
      () => !!document.querySelector('.parallx-chat-streaming-cursor'),
    );
    if (!cursorBack) break;
  }

  // The input intentionally stays writable during streaming so users can queue
  // messages. For tests, wait on the widget's actual completion signals instead
  // of the textarea enabled state.
  await page.waitForFunction(
    (previousAssistantCount: number) => {
      const assistantCount = document.querySelectorAll('.parallx-chat-message--assistant').length;
      if (assistantCount <= previousAssistantCount) {
        return false;
      }

      const stopButton = document.querySelector('.parallx-chat-input-stop') as HTMLElement | null;
      const stopHidden = !stopButton || getComputedStyle(stopButton).display === 'none';
      const hasStreamingCursor = !!document.querySelector('.parallx-chat-streaming-cursor');
      const pendingCount = document.querySelectorAll('.parallx-chat-pending-message').length;

      return stopHidden && !hasStreamingCursor && pendingCount === 0;
    },
    beforeCount,
    { timeout },
  ).catch((err) => {
    throw new Error(`Timed out waiting for widget completion state: ${err}`);
  });

  const debug = await page.evaluate(() => {
    const host = window as unknown as {
      __parallx_chat_debug__?: { getSnapshot?: () => unknown };
    };
    if (!host.__parallx_chat_debug__?.getSnapshot) {
      return undefined;
    }
    try {
      return host.__parallx_chat_debug__.getSnapshot();
    } catch {
      return undefined;
    }
  }).catch(() => undefined);

  // Extra settle for DOM to finalize rendering after the data model reports a
  // complete assistant response.
  await page.waitForTimeout(500).catch(() => {});

  const latencyMs = Date.now() - start;

  // Extract the answer text from the LAST assistant message using JS evaluation.
  // This is more reliable than Playwright locators because we can explicitly
  // skip thinking blocks, tool invocation cards, and source pills at the DOM level.
  const text = await page.evaluate((prevCount: number) => {
    const allAssistant = document.querySelectorAll('.parallx-chat-message--assistant');
    if (allAssistant.length === 0) return '';

    // Get the NEW assistant message (the one added after our prompt)
    // Use the last one — but verify it's actually new
    const lastMsg = allAssistant[allAssistant.length - 1];
    if (!lastMsg) return '';

    const body = lastMsg.querySelector('.parallx-chat-message-body');
    if (!body) return '';

    // Strategy 1: Find .parallx-chat-markdown elements that are NOT inside
    // a .parallx-chat-thinking container. These are the actual answer.
    const allMarkdown = body.querySelectorAll('.parallx-chat-markdown');
    const answerMarkdowns: HTMLElement[] = [];
    for (const md of allMarkdown) {
      // Walk up to check if this markdown is inside a thinking block
      let parent: HTMLElement | null = md.parentElement;
      let insideThinking = false;
      while (parent && parent !== body) {
        if (parent.classList.contains('parallx-chat-thinking')) {
          insideThinking = true;
          break;
        }
        parent = parent.parentElement;
      }
      if (!insideThinking) {
        answerMarkdowns.push(md as HTMLElement);
      }
    }

    if (answerMarkdowns.length > 0) {
      // Concatenate all non-thinking markdown blocks
      return answerMarkdowns.map(el => el.innerText).join('\n\n').trim();
    }

    // Strategy 2: Get all direct children of .parallx-chat-message-body
    // that are NOT thinking blocks, tool invocations, or references.
    // Then extract innerText from those.
    const skipClasses = [
      'parallx-chat-thinking',
      'parallx-chat-tool-invocation',
      'parallx-chat-tool-card',
      'parallx-chat-reference',
      'parallx-chat-progress',
      'parallx-chat-warning',
      'parallx-chat-edit-proposal',
      'parallx-chat-confirmation',
    ];

    const parts: string[] = [];
    for (const child of body.children) {
      const el = child as HTMLElement;
      const shouldSkip = skipClasses.some(cls => el.classList.contains(cls));
      if (!shouldSkip && el.innerText?.trim()) {
        parts.push(el.innerText.trim());
      }
    }

    return parts.join('\n\n').trim();
  }, beforeCount).catch(() => '');

  const resolvedText = text.trim() || debug?.lastAssistantResponseText?.trim() || '';

  return { text: resolvedText, latencyMs, debug: debug as ChatEvalDebugSnapshot | undefined };
}

/**
 * Modify a file in the workspace by performing a text replacement.
 * Used by T11 (live data change) and T12 (memory vs RAG conflict) tests.
 *
 * @param workspacePath - The temp workspace directory
 * @param fileName - The file name within the workspace
 * @param search - Text to find
 * @param replace - Text to replace with
 */
export async function modifyWorkspaceFile(
  workspacePath: string,
  fileName: string,
  search: string,
  replace: string,
): Promise<void> {
  const filePath = path.join(workspacePath, fileName);
  const content = await fs.readFile(filePath, 'utf-8');
  if (!content.includes(search)) {
    throw new Error(
      `modifyWorkspaceFile: Could not find "${search}" in ${fileName}`,
    );
  }
  const updated = content.replace(search, replace);
  await fs.writeFile(filePath, updated, 'utf-8');
}

/**
 * Revert a file in the workspace by performing the reverse replacement.
 */
export async function revertWorkspaceFile(
  workspacePath: string,
  fileName: string,
  search: string,
  replace: string,
): Promise<void> {
  const filePath = path.join(workspacePath, fileName);
  const content = await fs.readFile(filePath, 'utf-8');
  const reverted = content.replace(search, replace);
  await fs.writeFile(filePath, reverted, 'utf-8');
}
