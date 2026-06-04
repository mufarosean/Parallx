// Visual capture harness for the chat redesign — NOT an assertion test.
// Opens the chat, switches to a local gemma model, fires a tool-triggering
// prompt, and screenshots frames through every state (idle → thinking → tool
// running → done) into test-results/chat-states/ so I can eyeball the UI.
import { test, openFolderViaMenu } from './fixtures';
import fs from 'fs/promises';
import path from 'path';
import type { Page } from '@playwright/test';

const ART = path.join(process.cwd(), 'test-results', 'chat-states');
const PROMPT = 'Use your file tools to read README.md, then tell me in one short sentence what this project is.';

async function openChat(page: Page): Promise<void> {
  const w = page.locator('.parallx-chat-widget');
  if (!(await w.isVisible().catch(() => false))) {
    await page.keyboard.press('Control+Shift+I');
    await w.waitFor({ state: 'visible', timeout: 10_000 });
  }
  // Collapse the session sidebar if open.
  const sb = page.locator('.parallx-chat-session-sidebar--visible');
  if (await sb.isVisible().catch(() => false)) {
    await page.locator('.parallx-chat-title-action--history').click().catch(() => {});
    await page.waitForTimeout(300);
  }
  const nw = page.locator('.parallx-chat-title-action--new');
  if (await nw.isVisible().catch(() => false)) { await nw.click(); await page.waitForTimeout(500); }
}

async function selectGemma(page: Page): Promise<string> {
  const btn = page.locator('.parallx-chat-model-picker button');
  if (!(await btn.isVisible().catch(() => false))) return '(no model picker)';
  await btn.click();
  const dd = page.locator('.parallx-chat-picker-dropdown');
  await dd.waitFor({ state: 'visible', timeout: 4_000 }).catch(() => {});
  const gemma = dd.locator('.parallx-chat-picker-item', { hasText: /gemma/i }).first();
  if (await gemma.isVisible().catch(() => false)) {
    const name = (await gemma.locator('.parallx-chat-picker-item-name').textContent()) || '';
    await gemma.click();
    await page.waitForTimeout(300);
    return name.trim();
  }
  // Couldn't find gemma — close and keep default.
  await page.keyboard.press('Escape').catch(() => {});
  return '(gemma not found; default kept)';
}

test('capture chat states', async ({ window, electronApp, workspacePath }) => {
  // Visual capture tool for iterating on the chat UI — needs a local model
  // (Ollama/gemma) and opens a window. Inert in CI; set PARALLX_CAPTURE=1 to run.
  test.skip(!process.env.PARALLX_CAPTURE, 'visual capture tool — set PARALLX_CAPTURE=1 to run');
  test.setTimeout(200_000);
  await fs.mkdir(ART, { recursive: true });

  await openFolderViaMenu(electronApp, window, workspacePath, { force: true });
  await openChat(window);

  const model = await selectGemma(window);
  const modelBtns = (await window.locator('.parallx-chat-input-area button').allTextContents()).join(' | ');

  await window.screenshot({ path: path.join(ART, '00-idle.png') });

  const textarea = window.locator('.parallx-chat-input-textarea');
  await textarea.click({ force: true });
  await textarea.fill(PROMPT);
  await window.keyboard.press('Enter');

  // Capture frames through the response.
  const stop = window.locator('.parallx-chat-input-stop');
  const seen = new Set<string>();
  const frames: string[] = [];
  const started = Date.now();
  let i = 0;
  while (Date.now() - started < 90_000) {
    const state = await window.evaluate(() => ({
      thinkingIndicator: !!document.querySelector('.parallx-chat-typing-indicator'),
      toolRunning: !!document.querySelector('.parallx-chat-tool-node--running'),
      toolAny: !!document.querySelector('.parallx-chat-tool-node'),
      thinkingBlock: !!document.querySelector('.parallx-chat-thinking'),
      cursor: !!document.querySelector('.parallx-chat-streaming-cursor'),
      streaming: !!document.querySelector('.parallx-chat-input-stop'),
    }));
    const tag = `${state.thinkingIndicator ? 'T' : ''}${state.toolRunning ? 'R' : ''}${state.thinkingBlock ? 'B' : ''}${state.cursor ? 'C' : ''}`;
    const fn = `f${String(i).padStart(2, '0')}-${tag || 'x'}.png`;
    await window.screenshot({ path: path.join(ART, fn) });
    frames.push(`${fn} :: ${JSON.stringify(state)}`);
    // Snapshot one of each distinct interesting state for easy review.
    if (state.thinkingIndicator && !seen.has('thinking')) { seen.add('thinking'); await window.screenshot({ path: path.join(ART, 'state-thinking.png') }); }
    if (state.toolRunning && !seen.has('tool')) { seen.add('tool'); await window.screenshot({ path: path.join(ART, 'state-tool-running.png') }); }
    i += 1;
    if (!(await stop.isVisible().catch(() => false)) && i > 1) break;
    await window.waitForTimeout(1100);
  }

  await window.waitForTimeout(800);
  await window.screenshot({ path: path.join(ART, '99-done.png') });
  const bodyHtml = await window.locator('.parallx-chat-message--assistant .parallx-chat-message-body').last().innerHTML().catch(() => '');
  await fs.writeFile(path.join(ART, 'summary.txt'),
    `model picked: ${model}\ninput buttons: ${modelBtns}\nframes:\n${frames.join('\n')}\n\nfinal assistant HTML:\n${bodyHtml}\n`, 'utf8');
});
