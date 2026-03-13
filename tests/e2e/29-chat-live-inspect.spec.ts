import { test, expect, openFolderViaMenu } from './fixtures';
import fs from 'fs/promises';
import path from 'path';
import type { Page } from '@playwright/test';

const EXAM_WORKSPACE = process.env.PARALLX_CHAT_FORMAT_WORKSPACE
  || 'C:\\Users\\mchit\\OneDrive\\Documents\\Actuarial Science\\Exams\\Exam 7 - April 2026';
const PROMPT = "based on mack's chain ladder file, how do I calculate weighted residuals?";
const ARTIFACT_DIR = path.join(process.cwd(), 'test-results', 'chat-live-inspect');

async function waitForChatReady(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const chatWidget = page.locator('.parallx-chat-widget');
    if (await chatWidget.isVisible().catch(() => false)) {
      return;
    }

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

async function openChatPanel(page: Page): Promise<void> {
  const chatWidget = page.locator('.parallx-chat-widget');
  if (!await chatWidget.isVisible().catch(() => false)) {
    await page.keyboard.press('Control+Shift+I');
    await chatWidget.waitFor({ state: 'visible', timeout: 10_000 });
  }
  await collapseSessionSidebar(page);
}

async function startNewChatSession(page: Page): Promise<void> {
  const newChatBtn = page.locator('.parallx-chat-title-action--new');
  if (await newChatBtn.isVisible().catch(() => false)) {
    await newChatBtn.click();
    await page.waitForTimeout(700);
  }
}

async function sendChatMessage(page: Page, message: string): Promise<void> {
  const textarea = page.locator('.parallx-chat-input-textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5_000 });
  await textarea.click({ force: true });
  await textarea.fill(message);
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
}

async function waitForAssistantResponseState(
  page: Page,
  assistantCountBeforeSend: number,
  timeout = 120_000,
): Promise<'completed' | 'stalled'> {
  const assistantBodies = page.locator('.parallx-chat-message--assistant .parallx-chat-message-body');
  await expect(assistantBodies).toHaveCount(assistantCountBeforeSend + 1, { timeout: 30_000 });

  const stopButton = page.locator('.parallx-chat-input-stop');
  await expect(stopButton).toBeVisible({ timeout: 30_000 });

  const body = assistantBodies.last();

  const startedAt = Date.now();
  let lastSignature = '';
  let lastChangeAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const stopVisible = await stopButton.isVisible().catch(() => false);
    const signature = await body.evaluate((element) => element.innerHTML || element.textContent || '');

    if (signature !== lastSignature) {
      lastSignature = signature;
      lastChangeAt = Date.now();
    }

    if (!stopVisible) {
      await page.waitForFunction(
        () => !document.querySelector('.parallx-chat-streaming-cursor'),
        undefined,
        { timeout: 10_000 },
      ).catch(() => {});
      return 'completed';
    }

    if (signature.trim().length > 0 && Date.now() - lastChangeAt >= 10_000) {
      return 'stalled';
    }

    await page.waitForTimeout(2_000);
  }

  return 'stalled';
}

test.describe('Chat Live Inspect', () => {
  test('captures the real Exam 7 Mack response after full streaming completes', async ({ window, electronApp }, testInfo) => {
    test.setTimeout(180_000);

    await fs.mkdir(ARTIFACT_DIR, { recursive: true });

    await openFolderViaMenu(electronApp, window, EXAM_WORKSPACE, { force: true });
    await waitForChatReady(window);
    await openChatPanel(window);
    await startNewChatSession(window);

    const modelLabel = ((await window.locator('.parallx-chat-input-area button').allTextContents()).join(' | '));
    const assistantCountBeforeSend = await window.locator('.parallx-chat-message--assistant .parallx-chat-message-body').count();

    await sendChatMessage(window, PROMPT);
    const responseState = await waitForAssistantResponseState(window, assistantCountBeforeSend, 150_000);

    const assistantBody = window.locator('.parallx-chat-message--assistant .parallx-chat-message-body').last();
    const markdown = assistantBody.locator('.parallx-chat-markdown');
    const markdownCount = await markdown.count();
    const html = markdownCount > 0 ? await markdown.innerHTML() : await assistantBody.innerHTML();
    const text = (await assistantBody.textContent()) || '';
    const counts = await window.evaluate(() => {
      const markdownEl = document.querySelector('.parallx-chat-message--assistant:last-of-type .parallx-chat-markdown')
        || document.querySelectorAll('.parallx-chat-message--assistant .parallx-chat-markdown')[document.querySelectorAll('.parallx-chat-message--assistant .parallx-chat-markdown').length - 1];
      if (!markdownEl) {
        return null;
      }
      return {
        katex: markdownEl.querySelectorAll('.katex').length,
        katexDisplay: markdownEl.querySelectorAll('.katex-display').length,
        mathBlocks: markdownEl.querySelectorAll('.parallx-chat-math-block').length,
        orderedLists: markdownEl.querySelectorAll('ol').length,
        paragraphs: markdownEl.querySelectorAll('p').length,
      };
    });

    const artifact = {
      workspace: EXAM_WORKSPACE,
      prompt: PROMPT,
      modelLabel,
      responseState,
      counts,
      html,
      text,
    };

    const jsonPath = path.join(ARTIFACT_DIR, 'chat-live-inspect.json');
    await fs.writeFile(jsonPath, JSON.stringify(artifact, null, 2), 'utf8');
    await window.screenshot({ path: path.join(ARTIFACT_DIR, 'chat-live-inspect.png'), fullPage: true });
    await testInfo.attach('chat-live-inspect', { path: jsonPath, contentType: 'application/json' });

    expect(text.length).toBeGreaterThan(0);
  });
});