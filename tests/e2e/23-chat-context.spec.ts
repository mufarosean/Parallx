/**
 * E2E tests: Chat Context Integration
 *
 * Verifies the full chat context pipeline end-to-end:
 *   1. Chat panel opens and renders
 *   2. Canvas page content is available as implicit context
 *   3. System prompt contains workspace info and tool descriptions
 *   4. Ollama request includes tool definitions
 *   5. Assistant response renders properly
 *
 * Ollama API is intercepted at the network level — no real LLM inference needed.
 * Every request body is captured and asserted to verify context was injected.
 */
import { sharedTest as test, expect, setupCanvasPage, setContent } from './fixtures';
import type { Page } from '@playwright/test';

const MOCK_CHAT_MODEL = (process.env.PARALLX_TEST_CHAT_MODEL || 'gpt-oss:20b').trim();
const MOCK_CHAT_FAMILY = MOCK_CHAT_MODEL.startsWith('gpt-oss') ? 'gptoss' : 'qwen2';

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wait for the chat tool to activate. The chat tool uses `onStartupFinished`
 * activation, which fires after all startup work. We detect it by waiting
 * for the chat keybinding to be registered (the widget renders once opened).
 */
async function waitForChatReady(page: Page): Promise<void> {
  // The chat tool registers the keybinding Ctrl+Shift+I → chat.toggle.
  // Wait up to 15s for the tool to fully activate — we detect readiness
  // by attempting to open the panel and checking if the widget appears.
  for (let attempt = 0; attempt < 3; attempt++) {
    const chatWidget = page.locator('.parallx-chat-widget');
    if (await chatWidget.isVisible().catch(() => false)) return;

    await page.keyboard.press('Control+Shift+I');
    try {
      await chatWidget.waitFor({ state: 'visible', timeout: 5_000 });
      return;
    } catch {
      // Tool may not have activated yet — wait and retry
      await page.waitForTimeout(2_000);
    }
  }
  // Final attempt with full timeout
  await page.keyboard.press('Control+Shift+I');
  await page.locator('.parallx-chat-widget').waitFor({ state: 'visible', timeout: 10_000 });
}

/**
 * Open chat by toggling the Auxiliary Bar via Ctrl+Shift+I.
 * Idempotent — if already visible, does nothing.
 * Also collapses the session sidebar if it's overlapping the input.
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

/**
 * Collapse the chat session sidebar if it's visible.
 * The sidebar starts visible by default and its sash can block the textarea.
 */
async function collapseSessionSidebar(page: Page): Promise<void> {
  const sidebar = page.locator('.parallx-chat-session-sidebar--visible');
  if (await sidebar.isVisible().catch(() => false)) {
    // Click the history toggle button to hide the sidebar
    const historyBtn = page.locator('.parallx-chat-title-action--history');
    if (await historyBtn.isVisible().catch(() => false)) {
      await historyBtn.click();
      await page.waitForTimeout(300);
    }
  }
}

/** Type a message in the chat textarea and submit with Enter. */
async function sendChatMessage(page: Page, message: string): Promise<void> {
  const textarea = page.locator('.parallx-chat-input-textarea');
  await textarea.waitFor({ state: 'visible', timeout: 5_000 });
  // Use force:true to bypass any overlay (session sidebar sash) that might
  // intercept pointer events when the chat panel is narrow.
  await textarea.click({ force: true });
  await textarea.fill(message);
  await page.waitForTimeout(100);
  await page.keyboard.press('Enter');
}

/** Click the "New Chat" button in the chat header to start a fresh session. */
async function startNewChatSession(page: Page): Promise<void> {
  const newChatBtn = page.locator('.parallx-chat-title-action--new');
  if (await newChatBtn.isVisible().catch(() => false)) {
    await newChatBtn.click();
    await page.waitForTimeout(500);
  }
}

/**
 * Set up Ollama API interception.  Clears any previous routes first, then
 * returns a list that collects all captured /api/chat request bodies.
 */
async function interceptOllama(
  page: Page,
  responseText = 'I can see your page content.',
): Promise<{ chatRequests: any[] }> {
  const chatRequests: any[] = [];

  // Clear stale route handlers from previous tests
  await page.unroute('**/api/chat').catch(() => {});
  await page.unroute('**/api/tags').catch(() => {});
  await page.unroute('**/api/version').catch(() => {});
  await page.unroute('**/api/show').catch(() => {});
  await page.unroute('**/api/ps').catch(() => {});

  // POST /api/chat — streaming NDJSON
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

  // GET /api/tags — model list
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

  // GET /api/version
  await page.route('**/api/version', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: '0.5.0' }),
    });
  });

  // POST /api/show — model info
  await page.route('**/api/show', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ model_info: { 'mock.context_length': 32768 } }),
    });
  });

  // GET /api/ps — running models
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
 * Wait for the chat to show an assistant response and return its text.
 */
async function waitForAssistantResponse(page: Page, timeout = 15_000): Promise<string> {
  const msgBody = page.locator('.parallx-chat-message--assistant .parallx-chat-message-body');
  await msgBody.last().waitFor({ state: 'visible', timeout });

  // Wait for streaming cursor to disappear (response complete)
  await page.waitForFunction(
    () => !document.querySelector('.parallx-chat-streaming-cursor'),
    { timeout },
  ).catch(() => { /* cursor might already be gone */ });

  return (await msgBody.last().textContent()) || '';
}

// ═════════════════════════════════════════════════════════════════════════════
// Tests
// ═════════════════════════════════════════════════════════════════════════════

test.describe('Chat Context Integration', () => {
  // Distinctive content — an uncommon phrase we can assert on
  const PAGE_CONTENT = 'The quantum entanglement hypothesis suggests faster-than-light communication is impossible.';

  test('chat panel opens and shows input', async ({ window }) => {
    // Allow the chat tool time to activate (onStartupFinished)
    await waitForChatReady(window);

    const chatWidget = window.locator('.parallx-chat-widget');
    await expect(chatWidget).toBeVisible();

    const textarea = window.locator('.parallx-chat-input-textarea');
    await expect(textarea).toBeVisible();
  });

  test('canvas page content is injected as implicit context in the request to Ollama', async ({ window, electronApp, workspacePath }) => {
    // 1. Create a canvas page with known content using fixtures
    await setupCanvasPage(window, electronApp, workspacePath);

    // Set distinctive content via the TipTap editor
    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: PAGE_CONTENT }] },
    ]);
    await window.waitForTimeout(2_000); // Wait for the DB auto-save debounce

    // 2. Set up Ollama interception BEFORE sending any chat message
    const { chatRequests } = await interceptOllama(window);

    // 3. Open chat and send a message
    await openChatPanel(window);
    await window.waitForTimeout(500);
    await startNewChatSession(window);
    await sendChatMessage(window, 'Summarize my current page');

    // 4. Wait for the response to complete
    await waitForAssistantResponse(window);

    // 5. Verify the request body contains our page content as implicit context
    expect(chatRequests.length).toBeGreaterThanOrEqual(1);

    const lastReq = chatRequests[chatRequests.length - 1];
    expect(lastReq.messages).toBeDefined();

    // Find the user message in the Ollama request
    const userMsg = lastReq.messages.find((m: any) => m.role === 'user');
    expect(userMsg).toBeDefined();

    // The implicit context should inject the page content into the user message
    // Format: [Currently open page: "<title>" (id: <uuid>)]\n<content>\n\n<user text>
    expect(userMsg.content).toContain(PAGE_CONTENT);
    expect(userMsg.content).toContain('Currently open page');
    expect(userMsg.content).toContain('Summarize my current page');
  });

  test('system prompt contains workspace info and page listings', async ({ window }) => {
    // Workspace + page are still open from previous test (sharedTest = worker-scoped)
    const { chatRequests } = await interceptOllama(window);

    await openChatPanel(window);
    await window.waitForTimeout(500);
    await startNewChatSession(window);

    await sendChatMessage(window, 'What pages do I have?');
    await waitForAssistantResponse(window);

    expect(chatRequests.length).toBeGreaterThanOrEqual(1);
    const lastReq = chatRequests[chatRequests.length - 1];

    const sysMsg = lastReq.messages.find((m: any) => m.role === 'system');
    expect(sysMsg).toBeDefined();

    // System prompt always contains workspace info with page count
    expect(sysMsg.content).toMatch(/canvas page/i);

    // After test 2 created a page, the listing section should appear
    // Format: "Canvas pages in this workspace:\n- 📄 Untitled"
    if (sysMsg.content.includes('Canvas pages in this workspace')) {
      // Verify it lists at least one actual page name
      expect(sysMsg.content).toMatch(/Canvas pages in this workspace:\n- /);
    }
  });

  test('Ollama request includes tool definitions', async ({ window }) => {
    const { chatRequests } = await interceptOllama(window);

    await openChatPanel(window);
    await window.waitForTimeout(500);
    await startNewChatSession(window);

    await sendChatMessage(window, 'List my pages');
    await waitForAssistantResponse(window);

    expect(chatRequests.length).toBeGreaterThanOrEqual(1);
    const lastReq = chatRequests[chatRequests.length - 1];

    // Tool definitions are carried on the request payload itself, not in the system prompt.
    expect(Array.isArray(lastReq.tools)).toBe(true);
    const toolNames = lastReq.tools.map((t: any) => t.function?.name);
    expect(toolNames).toContain('read_page');
    expect(toolNames).toContain('read_current_page');
    expect(toolNames).toContain('search_workspace');
    expect(toolNames).toContain('list_pages');
  });

  test('system prompt mentions implicit context behavior', async ({ window }) => {
    const { chatRequests } = await interceptOllama(window);

    await openChatPanel(window);
    await window.waitForTimeout(500);
    await startNewChatSession(window);

    await sendChatMessage(window, 'Hello');
    await waitForAssistantResponse(window);

    expect(chatRequests.length).toBeGreaterThanOrEqual(1);
    const lastReq = chatRequests[chatRequests.length - 1];
    const sysMsg = lastReq.messages.find((m: any) => m.role === 'system');
    expect(sysMsg).toBeDefined();

    // Verify the system prompt tells the model about implicit context.
    expect(sysMsg.content).toContain("included in the user's message automatically");
  });

  test('assistant response renders in the chat UI', async ({ window }) => {
    const responseText = 'The page discusses quantum entanglement.';
    await interceptOllama(window, responseText);

    await openChatPanel(window);
    await window.waitForTimeout(500);
    await startNewChatSession(window);

    await sendChatMessage(window, 'What does my page say?');
    const content = await waitForAssistantResponse(window);

    expect(content).toContain('quantum entanglement');
  });
});
