import type { Page } from '@playwright/test';
import { test, expect, openFolderViaMenu } from './fixtures';

const MOCK_CHAT_MODEL = (process.env.PARALLX_TEST_CHAT_MODEL || 'gpt-oss:20b').trim();
const MOCK_CHAT_FAMILY = MOCK_CHAT_MODEL.startsWith('gpt-oss') ? 'gptoss' : 'qwen2';

type MockModelConfig = {
  id: string;
  family: string;
  vision?: boolean;
};

async function waitForChatReady(page: Page): Promise<void> {
  const chatWidget = page.locator('.parallx-chat-widget');
  if (await chatWidget.isVisible().catch(() => false)) {
    return;
  }

  await page.keyboard.press('Control+Shift+I');
  await chatWidget.waitFor({ state: 'visible', timeout: 10_000 });
}

async function openChatPanel(page: Page): Promise<void> {
  await waitForChatReady(page);
  const sidebar = page.locator('.parallx-chat-session-sidebar--visible');
  if (await sidebar.isVisible().catch(() => false)) {
    const historyBtn = page.locator('.parallx-chat-title-action--history');
    if (await historyBtn.isVisible().catch(() => false)) {
      await historyBtn.click();
      await page.waitForTimeout(300);
    }
  }

  await page.waitForFunction(() => {
    const host = window as unknown as { __parallx_chat_debug__?: unknown };
    return !!host.__parallx_chat_debug__;
  }, { timeout: 10_000 });
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

async function pasteSyntheticImage(page: Page, fileName = 'clipboard.png'): Promise<void> {
  await page.evaluate(({ name }) => {
    const textarea = document.querySelector('.parallx-chat-input-textarea') as HTMLTextAreaElement | null;
    if (!textarea) {
      throw new Error('Chat textarea not found.');
    }

    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pX6lz0AAAAASUVORK5CYII=';
    const binary = atob(pngBase64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const file = new File([bytes], name, { type: 'image/png' });
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      configurable: true,
      value: {
        items: [{
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file,
        }],
      },
    });

    textarea.dispatchEvent(pasteEvent);
  }, { name: fileName });
}

async function interceptOllama(
  page: Page,
  options: {
    models?: readonly MockModelConfig[];
    responder?: (body: any, requestIndex: number) => string;
  },
): Promise<{ chatRequests: any[] }> {
  const chatRequests: any[] = [];
  const showRequests: string[] = [];
  const models = options.models ?? [{ id: MOCK_CHAT_MODEL, family: MOCK_CHAT_FAMILY, vision: false }];
  const responder = options.responder ?? ((body, requestIndex) => {
    const lastMessage = Array.isArray(body?.messages) ? body.messages.at(-1) : undefined;
    const imageCount = Array.isArray(lastMessage?.images) ? lastMessage.images.length : 0;
    return `reply ${requestIndex + 1} (${imageCount} images)`;
  });

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

    const responseText = responder(body, chatRequests.length - 1);
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
        models: models.map((model, index) => ({
          name: model.id,
          model: model.id,
          modified_at: '2026-01-01T00:00:00Z',
          size: 1_000_000_000 + index,
          digest: `abc123-${index}`,
          details: { family: model.family, parameter_size: '20B', quantization_level: 'Q4_K_M' },
        })),
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
    let modelId = '';
    try {
      modelId = JSON.parse(route.request().postData() || '{}')?.model || '';
    } catch {
      modelId = '';
    }
    showRequests.push(modelId);
    const model = models.find((candidate) => candidate.id === modelId) ?? models[0];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        details: {
          family: model?.family ?? MOCK_CHAT_FAMILY,
          parameter_size: '20B',
          quantization_level: 'Q4_K_M',
        },
        model_info: { 'mock.context_length': 32768 },
        capabilities: model?.vision ? ['vision'] : [],
      }),
    });
  });

  await page.route('**/api/ps', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ models: [] }),
    });
  });

  return { chatRequests, showRequests } as { chatRequests: any[]; showRequests: string[] };
}

function getLatestUserMessage(requestBody: any): any {
  return [...(requestBody?.messages ?? [])].reverse().find((message: any) => message?.role === 'user');
}

function findRequestByUserContent(chatRequests: readonly any[], text: string): any {
  return [...chatRequests].reverse().find((requestBody) => {
    const userMessage = getLatestUserMessage(requestBody);
    return typeof userMessage?.content === 'string' && userMessage.content.includes(text);
  });
}

test.describe('Chat Vision Attachments and Regenerate', () => {
  test('pasted images stay disabled on non-vision models and are omitted from the request payload', async ({ electronApp, window, workspacePath }) => {
    const { chatRequests } = await interceptOllama(window, {
      models: [{ id: MOCK_CHAT_MODEL, family: MOCK_CHAT_FAMILY, vision: false }],
    });
    await openFolderViaMenu(electronApp, window, workspacePath);
    await openChatPanel(window);
    await startNewChatSession(window);

    await pasteSyntheticImage(window);

    const imageChip = window.locator('.parallx-chat-context-chip--image').first();
    await expect(imageChip).toBeVisible();
    await expect(imageChip).toHaveClass(/parallx-chat-context-chip--disabled/);
    await expect(imageChip).toContainText('Vision required');

    await sendChatMessage(window, 'Describe the attached image if possible.');
    await waitForAssistantResponse(window);
    await expect.poll(() => !!findRequestByUserContent(chatRequests, 'Describe the attached image if possible.')).toBe(true);

    const lastUserMessage = getLatestUserMessage(findRequestByUserContent(chatRequests, 'Describe the attached image if possible.'));
    expect(lastUserMessage?.content).toContain('Describe the attached image if possible.');
    expect(Array.isArray(lastUserMessage?.images) ? lastUserMessage.images : []).toHaveLength(0);
  });

  test('regenerate replays the same original user request', async ({ electronApp, window, workspacePath }) => {
    const { chatRequests } = await interceptOllama(window, {
      models: [{ id: MOCK_CHAT_MODEL, family: MOCK_CHAT_FAMILY, vision: false }],
    });
    await openFolderViaMenu(electronApp, window, workspacePath);
    await openChatPanel(window);
    await startNewChatSession(window);

    await sendChatMessage(window, 'Summarize the deductible rules.');
    await waitForAssistantResponse(window);
    await expect.poll(() => !!findRequestByUserContent(chatRequests, 'Summarize the deductible rules.')).toBe(true);

    const firstRequest = findRequestByUserContent(chatRequests, 'Summarize the deductible rules.');
    const firstUserMessage = getLatestUserMessage(firstRequest);
    expect(firstUserMessage?.content).toContain('Summarize the deductible rules.');
    const firstAssistantText = await window.locator('.parallx-chat-message--assistant .parallx-chat-message-body').last().textContent();

    const regenerateBtn = window.locator('.parallx-chat-message--assistant').last().locator('button[aria-label="Regenerate response"]');
    await expect(regenerateBtn).toBeVisible();
    await regenerateBtn.click();

    await expect.poll(async () => {
      const text = await window.locator('.parallx-chat-message--assistant .parallx-chat-message-body').last().textContent();
      return text ?? '';
    }).not.toBe(firstAssistantText ?? '');
    await expect.poll(() => chatRequests.filter((requestBody) => {
      const userMessage = getLatestUserMessage(requestBody);
      return typeof userMessage?.content === 'string' && userMessage.content.includes('Summarize the deductible rules.');
    }).length).toBeGreaterThan(1);

    const matchingRequests = chatRequests.filter((requestBody) => {
      const userMessage = getLatestUserMessage(requestBody);
      return typeof userMessage?.content === 'string' && userMessage.content.includes('Summarize the deductible rules.');
    });
    const secondRequest = matchingRequests[matchingRequests.length - 1];
    const secondUserMessage = getLatestUserMessage(secondRequest);
    expect(secondUserMessage?.content).toContain(firstUserMessage?.content);
    expect(secondUserMessage?.content.trim().endsWith(firstUserMessage?.content ?? '')).toBe(true);
  });
});