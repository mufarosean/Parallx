import { test, expect, openFolderViaMenu } from './fixtures';
import type { Page } from '@playwright/test';

const EXAM_WORKSPACE = process.env.PARALLX_CHAT_FORMAT_WORKSPACE
  || 'C:\\Users\\mchit\\OneDrive\\Documents\\Actuarial Science\\Exams\\Exam 7 - April 2026';
const MOCK_CHAT_MODEL = (process.env.PARALLX_TEST_CHAT_MODEL || 'gpt-oss:20b').trim();
const MOCK_CHAT_FAMILY = MOCK_CHAT_MODEL.startsWith('gpt-oss') ? 'gptoss' : 'qwen2';

const MACK_RESPONSE = [
  'To calculate weighted residuals using the Mack Chain-Ladder method, you need to follow a series of steps that involve estimating the age-to-age factors, calculating the volume-weighted factors, and then computing the residuals and their weights.',
  '',
  "Here's a step-by-step guide to calculating weighted residuals:",
  '',
  '1. Estimate Age-to-Age Factors:',
  '',
  '- Compute the age-to-age factors (LDFs) for each development period.',
  String.raw`- Let \(C_{i,j}\) be the cumulative losses at the end of accident year \(i\) and development period \(j\).`,
  String.raw`- The age-to-age factor \(f_j\) for development period \(j\) is given by:`,
  '',
  '[',
  String.raw`f_j = \frac{\sum_{i=1}^{n-j} C_{i,j+1}}{\sum_{i=1}^{n-j} C_{i,j}}`,
  ']',
  '',
  String.raw`where \(C_{i,j}\) is the cumulative loss amount for accident year \(i\) and development period \(j\).`,
  '',
  '2. Calculate Volume-Weighted Factors:',
  '',
  String.raw`- Compute the volume-weighted factors: \(f_j^*\):`,
  '',
  '[',
  String.raw`f_j^* = \frac{\sum_{i=1}^{n-j} C_{i,j} \cdot f_j}{\sum_{i=1}^{n-j} C_{i,j}}`,
  ']',
].join('\n');

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
    await page.waitForTimeout(500);
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

async function waitForAssistantMarkdown(page: Page, timeout = 15_000): Promise<void> {
  const body = page.locator('.parallx-chat-message--assistant .parallx-chat-message-body').last();
  await body.waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    () => !document.querySelector('.parallx-chat-streaming-cursor'),
    { timeout },
  ).catch(() => {});
  await expect(body.locator('.parallx-chat-markdown')).toBeVisible({ timeout });
}

async function interceptOllama(page: Page, responseText: string): Promise<void> {
  await page.unroute('**/api/chat').catch(() => {});
  await page.unroute('**/api/tags').catch(() => {});
  await page.unroute('**/api/version').catch(() => {});
  await page.unroute('**/api/show').catch(() => {});
  await page.unroute('**/api/ps').catch(() => {});

  await page.route('**/api/chat', async (route) => {
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
}

test.describe('Chat Formatting Regression', () => {
  test('renders Mack-style math and numbering correctly in the real Exam 7 workspace', async ({ window, electronApp }) => {
    await openFolderViaMenu(electronApp, window, EXAM_WORKSPACE, { force: true });
    await waitForChatReady(window);
    await interceptOllama(window, MACK_RESPONSE);

    await openChatPanel(window);
    await startNewChatSession(window);
    await sendChatMessage(window, 'based on mack\'s chain ladder file, how do I calculate weighted residuals?');
    await waitForAssistantMarkdown(window);

    const assistantBody = window.locator('.parallx-chat-message--assistant .parallx-chat-message-body').last();
    const markdown = assistantBody.locator('.parallx-chat-markdown');

    await expect(markdown.locator('.parallx-chat-math-block')).toHaveCount(2);
    await expect(markdown.locator('.katex-display')).toHaveCount(2);
    await expect(markdown.locator('ol')).toHaveCount(2);
    await expect(markdown.locator('ol').nth(1)).toHaveAttribute('start', '2');

    expect(await markdown.locator('.katex').count()).toBeGreaterThanOrEqual(4);

    const html = await markdown.innerHTML();
    expect(html).not.toContain('[<br');
    expect(html).not.toContain('<br>]');
    expect(html).not.toContain('>1. Calculate Volume-Weighted Factors');

    const text = (await assistantBody.textContent()) || '';
    expect(text).toContain('Estimate Age-to-Age Factors');
    expect(text).toContain('Calculate Volume-Weighted Factors');
  });
});