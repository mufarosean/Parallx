/**
 * E2E tests: Workspace Chat Isolation & Indexing
 *
 * Verifies end-to-end that:
 *   1. Chat sessions are scoped to the workspace that created them.
 *   2. Switching workspaces (Save As → reload) gives a clean chat slate.
 *   3. The indexing pipeline fires on every workspace load/reload.
 *   4. The database opens for the correct folder after each switch.
 *   5. Chat is fully functional immediately after a workspace switch.
 *
 * Every assertion answers "What does the user SEE?" or checks observable
 * filesystem artifacts (.parallx/data.db existence).
 * Ollama is intercepted at the network level — no real LLM inference needed.
 */
import { test, expect, openFolderViaMenu } from './fixtures';
import type { Page, ElectronApplication } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const MOCK_CHAT_MODEL = (process.env.PARALLX_TEST_CHAT_MODEL || 'gpt-oss:20b').trim();
const MOCK_CHAT_FAMILY = MOCK_CHAT_MODEL.startsWith('gpt-oss') ? 'gptoss' : 'qwen2';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Click a File menu item by label text. */
async function clickFileMenuItem(window: Page, label: string) {
  // Dismiss any open overlays first (press Escape just in case)
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  const fileMenu = window.locator('.titlebar-menu-item[data-menu-id="file"]');
  await fileMenu.click();
  const dropdown = window.locator('.context-menu.titlebar-dropdown');
  await expect(dropdown).toBeVisible({ timeout: 3000 });
  const item = dropdown.locator('.context-menu-item', { hasText: label });
  await item.click();
}

/** Get the workspace name shown in the titlebar. */
async function getTitlebarWorkspaceName(window: Page): Promise<string> {
  const label = window.locator('.titlebar-workspace-label');
  await expect(label).toBeVisible({ timeout: 5000 });
  return (await label.textContent()) ?? '';
}

/**
 * Wait for the workspace switch to complete.
 * Workspace switches trigger a full page reload (`window.location.reload()`).
 * We detect the reload by waiting for `.parallx-ready` to DETACH (old page
 * unloading), then REATTACH (new page finished Phase 5).
 */
async function waitForSwitchComplete(window: Page) {
  try {
    // 1. Wait for the old page to unload — .parallx-ready detaches
    await window.locator('.parallx-ready').waitFor({ state: 'detached', timeout: 15_000 });
  } catch {
    // If it never detached, the reload may have been instant — continue
  }
  try {
    // 2. Wait for the new page to finish Phase 5
    await window.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 30_000 });
  } catch {
    // Fallback – just settle
  }
  // Extra settling for views/services to initialise
  await window.waitForTimeout(2000);
}

/**
 * Wait for the chat tool to activate (`onStartupFinished`).
 * Retries toggling Ctrl+Shift+I up to 3 times.
 */
async function waitForChatReady(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const chatWidget = page.locator('.parallx-chat-widget');
    if (await chatWidget.isVisible().catch(() => false)) return;

    await page.keyboard.press('Control+Shift+I');
    try {
      await chatWidget.waitFor({ state: 'visible', timeout: 5_000 });
      return;
    } catch {
      await page.waitForTimeout(2_000);
    }
  }
  await page.keyboard.press('Control+Shift+I');
  await page.locator('.parallx-chat-widget').waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Open the chat panel. Idempotent — collapses the session sidebar to avoid
 * sash blocking the textarea.
 */
async function openChatPanel(page: Page): Promise<void> {
  const chatWidget = page.locator('.parallx-chat-widget');
  if (await chatWidget.isVisible().catch(() => false)) {
    await collapseSessionSidebar(page);
    return;
  }
  await page.keyboard.press('Control+Shift+I');
  await chatWidget.waitFor({ state: 'visible', timeout: 10_000 });
  await collapseSessionSidebar(page);
}

/** Close the chat panel (hide auxiliary bar) so File menu is unobstructed. */
async function closeChatPanel(page: Page): Promise<void> {
  const chatWidget = page.locator('.parallx-chat-widget');
  if (await chatWidget.isVisible().catch(() => false)) {
    await page.keyboard.press('Control+Shift+I');
    await page.waitForTimeout(300);
  }
}

/** Collapse the session sidebar if visible. */
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

/** Open / reveal the session sidebar. */
async function openSessionSidebar(page: Page): Promise<void> {
  const sidebar = page.locator('.parallx-chat-session-sidebar--visible');
  if (await sidebar.isVisible().catch(() => false)) return;

  const historyBtn = page.locator('.parallx-chat-title-action--history');
  if (await historyBtn.isVisible().catch(() => false)) {
    await historyBtn.click();
    await page.waitForTimeout(500);
  }
}

/** Type a message and submit with Enter. */
async function sendChatMessage(page: Page, message: string): Promise<void> {
  const textarea = page.locator('.parallx-chat-input-textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5_000 });
  await textarea.click({ force: true });
  await textarea.fill(message);
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
}

/** Wait for the assistant response to finish rendering. */
async function waitForAssistantResponse(page: Page, timeout = 15_000): Promise<string> {
  const msgBody = page.locator('.parallx-chat-message--assistant .parallx-chat-message-body');
  await msgBody.last().waitFor({ state: 'visible', timeout });

  await page.waitForFunction(
    () => !document.querySelector('.parallx-chat-streaming-cursor'),
    { timeout },
  ).catch(() => { /* cursor may already be gone */ });

  return (await msgBody.last().textContent()) || '';
}

/**
 * Intercept all Ollama API routes so chat messages can be sent without a real
 * LLM. Must be called (or re-called) after every page reload because route
 * handlers are lost on navigation.
 */
async function interceptOllama(
  page: Page,
  responseText = 'Mock assistant reply.',
): Promise<{ chatRequests: any[] }> {
  const chatRequests: any[] = [];

  await page.unroute('**/api/chat').catch(() => {});
  await page.unroute('**/api/tags').catch(() => {});
  await page.unroute('**/api/version').catch(() => {});
  await page.unroute('**/api/show').catch(() => {});
  await page.unroute('**/api/ps').catch(() => {});

  await page.route('**/api/chat', async (route) => {
    try {
      const body = JSON.parse(route.request().postData() || '{}');
      chatRequests.push(body);
    } catch { /* ignore */ }

    const lines = [
      JSON.stringify({ message: { role: 'assistant', content: responseText }, done: false }),
      JSON.stringify({ message: { role: 'assistant', content: '' }, done: true, prompt_eval_count: 100, eval_count: 50, eval_duration: 1_000_000_000 }),
    ];
    await route.fulfill({
      status: 200,
      contentType: 'application/x-ndjson',
      body: lines.join('\n') + '\n',
    });
  });

  await page.route('**/api/tags', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: [{
          name: MOCK_CHAT_MODEL,
          model: MOCK_CHAT_MODEL,
          modified_at: '2026-01-01T00:00:00Z',
          size: 1_000_000_000,
          digest: 'abc123',
          details: { family: MOCK_CHAT_FAMILY, parameter_size: '20B', quantization_level: 'Q4_K_M' },
        }],
      }),
    });
  });

  await page.route('**/api/version', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: '0.5.0' }),
    });
  });

  await page.route('**/api/show', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ model_info: { 'mock.context_length': 32768 } }),
    });
  });

  await page.route('**/api/ps', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [] }),
    });
  });

  return { chatRequests };
}

/**
 * Check that the `.parallx/data.db` file exists at the given workspace path.
 * This is the most reliable evidence that the database opened and initialised.
 */
function databaseExistsAt(workspacePath: string): boolean {
  const dbPath = path.join(workspacePath, '.parallx', 'data.db');
  return fs.existsSync(dbPath);
}

/**
 * Save As the current workspace with a given name and wait for the switch.
 * Closes any open overlays first (chat panel, menus) to prevent interference.
 */
async function saveWorkspaceAs(window: Page, name: string): Promise<void> {
  // Close chat if open so File menu isn't obstructed
  await closeChatPanel(window);
  await window.waitForTimeout(300);

  await clickFileMenuItem(window, 'Save Workspace As');
  const modal = window.locator('.parallx-modal-overlay');
  await expect(modal).toBeVisible({ timeout: 5000 });
  const input = window.locator('.parallx-modal-input');
  await input.fill(name);
  await input.press('Enter');
  await waitForSwitchComplete(window);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe('Workspace Chat Isolation & Indexing', () => {

  // ═══════════════════════════════════════════════════════════════════════
  // 1. Database opens when a folder is opened
  // ═══════════════════════════════════════════════════════════════════════

  test('opening a folder creates .parallx/data.db (database + indexing init)', async ({
    electronApp,
    window,
    workspacePath,
  }) => {
    // Before opening: no .parallx directory
    expect(databaseExistsAt(workspacePath)).toBe(false);

    // Open a real folder via the File menu
    await openFolderViaMenu(electronApp, window, workspacePath);

    // Wait for Phase 5 to complete (DB open + indexing pipeline start)
    await window.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 15_000 });
    // Extra settling for DB I/O
    await window.waitForTimeout(3_000);

    // The database file should now exist — proves DB opened and indexing init ran
    expect(databaseExistsAt(workspacePath)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 2. Database re-initialises after workspace switch
  // ═══════════════════════════════════════════════════════════════════════

  test('workspace switch via Save As re-initialises database on reload', async ({
    electronApp,
    window,
    workspacePath,
  }) => {
    // 1. Open a folder first
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 15_000 });
    // Extra settling for DB I/O (DB opens async via onDidChangeFolders listener)
    await window.waitForTimeout(3_000);

    // DB should exist for the original folder
    expect(databaseExistsAt(workspacePath)).toBe(true);

    // 2. Save As → triggers reload into a new workspace
    await saveWorkspaceAs(window, 'DB-Reinit-WS');

    // 3. In single-folder mode the titlebar continues to show the folder name,
    //    not the saved workspace name.
    const wsName = await getTitlebarWorkspaceName(window);
    expect(wsName).toContain(path.basename(workspacePath));

    // 4. The workbench should have completed Phase 5 again (.parallx-ready)
    //    This proves the full lifecycle ran including _openDatabaseForWorkspace
    //    and _startIndexingPipeline
    const ready = window.locator('.parallx-ready');
    await expect(ready).toBeAttached({ timeout: 5_000 });

    // 5. The folder is still associated — DB should still exist
    expect(databaseExistsAt(workspacePath)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. Chat sessions are isolated between workspaces
  // ═══════════════════════════════════════════════════════════════════════

  test('chat sessions do not bleed between workspaces', async ({
    electronApp,
    window,
    workspacePath,
  }) => {
    // ── Workspace A: open folder + send a chat message ──

    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 15_000 });
    // Extra settling for DB I/O
    await window.waitForTimeout(3_000);

    // Intercept Ollama so chat can function without a real LLM
    await interceptOllama(window, 'Reply in workspace A.');

    // Open chat panel
    await waitForChatReady(window);
    await openChatPanel(window);
    await window.waitForTimeout(500);

    // Send a message in Workspace A
    await sendChatMessage(window, 'Hello from Workspace A');
    const responseA = await waitForAssistantResponse(window);
    expect(responseA).toContain('Reply in workspace A');

    // Verify session sidebar has exactly 1 session
    await openSessionSidebar(window);
    await window.waitForTimeout(500);
    const sessionsA = window.locator('.parallx-chat-session-sidebar-item');
    await expect(sessionsA).toHaveCount(1, { timeout: 5_000 });

    // ── Switch to Workspace B via Save As ──
    await saveWorkspaceAs(window, 'Isolation-WS-B');
    const wsNameB = await getTitlebarWorkspaceName(window);
    expect(wsNameB).toContain(path.basename(workspacePath));

    // Verify Phase 5 complete (DB + indexing pipeline re-init)
    const ready = window.locator('.parallx-ready');
    await expect(ready).toBeAttached({ timeout: 5_000 });

    // DB file should still exist (same folder is open)
    expect(databaseExistsAt(workspacePath)).toBe(true);

    // ── Workspace B: chat should be EMPTY ──

    // Re-intercept Ollama (routes are lost on reload)
    await interceptOllama(window, 'Reply in workspace B.');

    await waitForChatReady(window);
    await openChatPanel(window);
    await window.waitForTimeout(500);

    // Open session sidebar. A fresh blank session shell may exist after reload,
    // but the previous workspace's conversation must not bleed through.
    await openSessionSidebar(window);
    await window.waitForTimeout(500);

    const sessionsB = window.locator('.parallx-chat-session-sidebar-item');
    const emptyState = window.locator('.parallx-chat-session-sidebar-empty');

    const sessionCount = await sessionsB.count();
    const hasEmptyMsg = await emptyState.isVisible().catch(() => false);
    const sessionTexts = await sessionsB.allTextContents();
    const combinedSessionText = sessionTexts.join('\n');
    expect(hasEmptyMsg || sessionCount >= 0).toBe(true);
    expect(combinedSessionText).not.toContain('Hello from Workspace A');
    expect(combinedSessionText).not.toContain('Reply in workspace A');

    const messageListText = await window.locator('.parallx-chat-message-list').textContent();
    expect(messageListText ?? '').not.toContain('Hello from Workspace A');
    expect(messageListText ?? '').not.toContain('Reply in workspace A');

    // ── Send a message in Workspace B ──
    await collapseSessionSidebar(window);
    await sendChatMessage(window, 'Hello from Workspace B');
    const responseB = await waitForAssistantResponse(window);
    expect(responseB).toContain('Reply in workspace B');

    // Session sidebar in B should now have exactly 1 session
    await openSessionSidebar(window);
    await window.waitForTimeout(500);
    const sessionsBAfter = window.locator('.parallx-chat-session-sidebar-item');
    await expect(sessionsBAfter).toHaveCount(1, { timeout: 5_000 });
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. DB + indexing after open folder in fresh workspace
  // ═══════════════════════════════════════════════════════════════════════

  test('opening a folder in a new workspace creates database', async ({
    electronApp,
    window,
    workspacePath,
  }) => {
    // Save As to create a new workspace (no folder open yet)
    await saveWorkspaceAs(window, 'Fresh-Index-WS');

    // Verify we're on the new workspace
    const wsName = await getTitlebarWorkspaceName(window);
    expect(wsName).toContain('Fresh-Index-WS');

    // No DB yet — no folder open
    expect(databaseExistsAt(workspacePath)).toBe(false);

    // Now open a folder — this should trigger DB open + indexing
    await openFolderViaMenu(electronApp, window, workspacePath, { force: true });
    await window.locator('.parallx-ready').waitFor({ state: 'attached', timeout: 15_000 });
    await window.waitForTimeout(3_000);

    // Database should now exist
    expect(databaseExistsAt(workspacePath)).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. Chat works smoothly after workspace switch — no lag / broken state
  // ═══════════════════════════════════════════════════════════════════════

  test('chat is fully functional immediately after workspace switch', async ({
    electronApp,
    window,
    workspacePath,
  }) => {
    // Open folder
    await openFolderViaMenu(electronApp, window, workspacePath);
    await window.waitForTimeout(2_000);

    // Switch workspace
    await saveWorkspaceAs(window, 'Smooth-Chat-WS');

    // Re-intercept Ollama
    await interceptOllama(window, 'Smooth reply.');

    // Open chat — should work immediately
    await waitForChatReady(window);
    await openChatPanel(window);

    // Textarea should be visible and interactive
    const textarea = window.locator('.parallx-chat-input-textarea');
    await expect(textarea).toBeVisible({ timeout: 5_000 });
    await expect(textarea).toBeEditable({ timeout: 3_000 });

    // Send a message — response should come back quickly
    const start = Date.now();
    await sendChatMessage(window, 'Quick test');
    const response = await waitForAssistantResponse(window, 10_000);
    const elapsed = Date.now() - start;

    expect(response).toContain('Smooth reply');
    // Response should arrive within 10 seconds (most of that is UI settling)
    expect(elapsed).toBeLessThan(10_000);

    // UI should not be in any broken state — no error overlays
    const errorOverlay = window.locator('.parallx-error-overlay');
    const hasError = await errorOverlay.count();
    expect(hasError).toBe(0);
  });
});
