/**
 * E2E tests: Conversational vs Evidence-Balanced Chat
 *
 * Goal:
 *   1. A fresh-session greeting stays conversational and ungrounded.
 *   2. An evidence-seeking turn uses current-page evidence without relying on
 *      the retrieval pipeline.
 *
 * Ollama is intercepted at the network level. We assert against the actual
 * payload sent to the model plus the rendered chat UI.
 */
import { test, expect, setupCanvasPage, setContent } from './fixtures';
import type { Page } from '@playwright/test';

const MOCK_CHAT_MODEL = (process.env.PARALLX_TEST_CHAT_MODEL || 'gpt-oss:20b').trim();
const MOCK_CHAT_FAMILY = MOCK_CHAT_MODEL.startsWith('gpt-oss') ? 'gptoss' : 'qwen2';

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

async function waitForAssistantResponse(page: Page, timeout = 15_000): Promise<string> {
  const msgBody = page.locator('.parallx-chat-message--assistant .parallx-chat-message-body');
  await msgBody.last().waitFor({ state: 'visible', timeout });
  await page.waitForFunction(
    () => !document.querySelector('.parallx-chat-streaming-cursor'),
    { timeout },
  ).catch(() => {});
  return (await msgBody.last().textContent()) || '';
}

async function interceptOllama(
  page: Page,
  responder: (body: any) => string,
): Promise<{ chatRequests: any[] }> {
  const chatRequests: any[] = [];

  await page.unroute('**/api/chat').catch(() => {});
  await page.unroute('**/api/tags').catch(() => {});
  await page.unroute('**/api/version').catch(() => {});
  await page.unroute('**/api/show').catch(() => {});
  await page.unroute('**/api/ps').catch(() => {});

  await page.route('**/api/chat', async (route) => {
    let body: any = {};
    try {
      body = JSON.parse(route.request().postData() || '{}');
      chatRequests.push(body);
    } catch {
      chatRequests.push(body);
    }

    const responseText = responder(body);
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

test.describe('Chat Conversational Balance', () => {
  const PAGE_CONTENT = 'Claim reports must be filed within 72 hours, and photos should be captured before moving the vehicle.';

  test('fresh-session greeting stays conversational and avoids evidence scaffolding', async ({ window }) => {
    await waitForChatReady(window);
    const { chatRequests } = await interceptOllama(window, () => 'Hey there. I am here and ready to help.');

    await openChatPanel(window);
    await startNewChatSession(window);
    await sendChatMessage(window, 'hello');

    const content = await waitForAssistantResponse(window);
    expect(content).toContain('ready to help');
    expect(content).not.toContain('Sources:');

    expect(chatRequests.length).toBeGreaterThanOrEqual(1);
    const lastReq = chatRequests[chatRequests.length - 1];
    const userMsg = lastReq.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toBe('hello');
    expect(userMsg.content).not.toContain('[Retrieved Context]');
    expect(userMsg.content).not.toContain('Currently open page');
    expect(lastReq.tools ?? []).toHaveLength(0);
  });

  test('evidence-seeking turn includes current-page evidence without retrieval-only sourcing', async ({ window, electronApp, workspacePath }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: PAGE_CONTENT }] },
    ]);
    await window.waitForTimeout(2_000);

    await waitForChatReady(window);
    const { chatRequests } = await interceptOllama(window, (body) => {
      const userMsg = body.messages?.find((m: any) => m.role === 'user');
      if (typeof userMsg?.content === 'string' && userMsg.content.includes(PAGE_CONTENT)) {
        return 'The current page says claim reports must be filed within 72 hours, and photos should be captured before moving the vehicle.';
      }
      return 'I need page evidence before answering.';
    });

    await openChatPanel(window);
    await startNewChatSession(window);
    await sendChatMessage(window, 'What does my current page say about filing deadlines and photos?');

    const content = await waitForAssistantResponse(window);
    expect(content).toContain('72 hours');
    expect(content).toContain('photos');
    expect(content).not.toContain('Sources:');

    expect(chatRequests.length).toBeGreaterThanOrEqual(1);
    const lastReq = chatRequests[chatRequests.length - 1];
    const userMsg = lastReq.messages.find((m: any) => m.role === 'user');
    expect(userMsg.content).toContain(PAGE_CONTENT);
    expect(userMsg.content).toContain('Currently open page');
    expect(userMsg.content).not.toContain('[Retrieved Context]');
    expect(Array.isArray(lastReq.tools)).toBe(true);
    expect(lastReq.tools.length).toBeGreaterThan(0);
  });
});