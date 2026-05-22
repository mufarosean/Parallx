/**
 * Chat surface helpers for eval specs.
 *
 * Drives the AI chat widget exactly as a user would — opens it via
 * Ctrl+Shift+I, starts a new session per call, sends a turn, waits for
 * streaming to complete, and returns the assistant text plus any tool
 * invocations recorded from the DOM.
 */
import type { Page } from '@playwright/test';

export interface ToolInvocationRecord {
  toolName: string;
  /** Status label scraped from the card header (running/done/failed). */
  status: string;
  /** Raw text content of the card body (input/output preview). */
  body: string;
}

export interface ChatTurnResult {
  assistantText: string;
  toolInvocations: ToolInvocationRecord[];
  responseState: 'completed' | 'stalled';
  durationMs: number;
}

/**
 * Run `/init` once after the workspace is opened, exactly as a user would.
 * This seeds AGENTS.md + the .parallx/ structure so subsequent eval cases
 * have realistic project context to reason about.
 *
 * Returns when the assistant's response finishes streaming or the timeout
 * elapses. Long timeout because /init can run several LLM turns on a 26B
 * model.
 */
export async function runInitOnce(page: Page, timeoutMs = 20 * 60_000): Promise<void> {
  await openChatPanel(page);
  await startNewChat(page);
  console.log('[harness] running /init …');
  const turn = await sendChatTurn(page, '/init', timeoutMs);
  console.log(`[harness] /init done — state=${turn.responseState} dur=${turn.durationMs}ms`);
}

export async function openChatPanel(page: Page): Promise<void> {
  const chatWidget = page.locator('.parallx-chat-widget');
  if (!(await chatWidget.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Shift+I');
    await chatWidget.waitFor({ state: 'visible', timeout: 10_000 });
  }
  // Collapse session sidebar if open.
  const sidebar = page.locator('.parallx-chat-session-sidebar--visible');
  if (await sidebar.isVisible().catch(() => false)) {
    const historyBtn = page.locator('.parallx-chat-title-action--history');
    if (await historyBtn.isVisible().catch(() => false)) {
      await historyBtn.click();
      await page.waitForTimeout(300);
    }
  }
}

export async function startNewChat(page: Page): Promise<void> {
  const newBtn = page.locator('.parallx-chat-title-action--new');
  if (await newBtn.isVisible().catch(() => false)) {
    await newBtn.click();
    await page.waitForTimeout(600);
  }
}

export async function sendChatTurn(page: Page, message: string, timeoutMs = 150_000): Promise<ChatTurnResult> {
  const assistantBodies = page.locator('.parallx-chat-message--assistant .parallx-chat-message-body');
  const beforeCount = await assistantBodies.count();

  const textarea = page.locator('.parallx-chat-input-textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5_000 });
  await textarea.click({ force: true });
  await textarea.fill(message);
  await page.waitForTimeout(80);
  await page.keyboard.press('Enter');

  const start = Date.now();
  await assistantBodies.nth(beforeCount).waitFor({ state: 'attached', timeout: 30_000 });
  const body = assistantBodies.nth(beforeCount);
  const stopButton = page.locator('.parallx-chat-input-stop');

  let lastSig = '';
  let lastChange = Date.now();
  let responseState: 'completed' | 'stalled' = 'stalled';

  while (Date.now() - start < timeoutMs) {
    const stopVisible = await stopButton.isVisible().catch(() => false);
    const sig = await body.evaluate((el) => (el.innerHTML || el.textContent || '')).catch(() => '');
    if (sig !== lastSig) { lastSig = sig; lastChange = Date.now(); }
    if (!stopVisible) {
      await page.waitForFunction(() => !document.querySelector('.parallx-chat-streaming-cursor'), undefined, { timeout: 5_000 }).catch(() => {});
      responseState = 'completed';
      break;
    }
    if (sig.trim().length > 0 && Date.now() - lastChange >= 12_000) {
      responseState = 'stalled';
      break;
    }
    await page.waitForTimeout(1_500);
  }

  const assistantText = (await body.textContent().catch(() => '')) || '';
  const toolInvocations = await collectToolInvocations(page, body);

  return {
    assistantText: assistantText.trim(),
    toolInvocations,
    responseState,
    durationMs: Date.now() - start,
  };
}

async function collectToolInvocations(page: Page, body: import('@playwright/test').Locator): Promise<ToolInvocationRecord[]> {
  const cards = body.locator('.parallx-chat-tool-invocation');
  const n = await cards.count();
  const out: ToolInvocationRecord[] = [];
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const name = (await card.locator('.parallx-chat-tool-invocation-name').first().textContent().catch(() => '')) || '';
    const status = (await card.locator('.parallx-chat-tool-invocation-status').first().textContent().catch(() => '')) || '';
    const text = (await card.textContent().catch(() => '')) || '';
    out.push({ toolName: name.trim(), status: status.trim(), body: text.trim() });
  }
  return out;
}
