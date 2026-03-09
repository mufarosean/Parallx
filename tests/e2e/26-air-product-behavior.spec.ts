import path from 'path';
import { test, expect, openFolderViaMenu, setupCanvasPage, setContent } from './fixtures';
import type { Page } from '@playwright/test';

const MOCK_CHAT_MODEL = (process.env.PARALLX_TEST_CHAT_MODEL || 'gpt-oss:20b').trim();
const MOCK_CHAT_FAMILY = MOCK_CHAT_MODEL.startsWith('gpt-oss') ? 'gptoss' : 'qwen2';

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
    const host = window as unknown as {
      __parallx_chat_debug__?: unknown;
    };
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

async function waitForNextAssistantResponse(page: Page, previousAssistantCount: number, timeout = 15_000): Promise<string> {
  await page.waitForFunction(
    (previousCount) => document.querySelectorAll('.parallx-chat-message--assistant').length > previousCount,
    previousAssistantCount,
    { timeout },
  );
  return waitForAssistantResponse(page, timeout);
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

async function seedAgentTask(page: Page, seed: {
  input: {
    goal: string;
    constraints?: readonly string[];
    desiredAutonomy?: 'manual' | 'allow-readonly' | 'allow-safe-actions' | 'allow-policy-actions';
    completionCriteria?: readonly string[];
    allowedScope?: { kind: 'workspace'; roots?: readonly string[] };
    mode?: 'advisor' | 'researcher' | 'executor' | 'reviewer' | 'operator';
  };
  taskId?: string;
  steps?: Array<{
    id: string;
    title: string;
    description: string;
    kind: 'analysis' | 'read' | 'search' | 'write' | 'edit' | 'delete' | 'command' | 'approval';
    dependsOn?: readonly string[];
    proposedAction?: {
      toolName?: string;
      actionClass?: 'read' | 'search' | 'write' | 'edit' | 'delete' | 'command' | 'task-state' | 'approval-sensitive' | 'unknown';
      summary?: string;
      targetPaths?: readonly string[];
      interactionMode?: 'advisor' | 'researcher' | 'executor' | 'reviewer' | 'operator';
    };
  }>;
  run?: boolean;
}) {
  await page.waitForFunction(() => {
    const host = window as unknown as {
      __parallx_chat_debug__?: {
        agent?: {
          seedTask?: unknown;
        };
      };
    };
    return typeof host.__parallx_chat_debug__?.agent?.seedTask === 'function';
  }, { timeout: 10_000 });

  return page.evaluate(async (taskSeed) => {
    const host = window as unknown as {
      __parallx_chat_debug__?: {
        agent?: {
          seedTask?: (seedArg: unknown) => Promise<unknown>;
        };
      };
    };

    if (!host.__parallx_chat_debug__?.agent?.seedTask) {
      throw new Error('Missing test-mode AIR driver.');
    }

    return host.__parallx_chat_debug__.agent.seedTask(taskSeed);
  }, seed);
}

async function updateWorkspaceOverride(page: Page, patch: unknown): Promise<void> {
  await page.evaluate(async (overridePatch) => {
    const host = window as unknown as {
      __parallx_chat_debug__?: {
        updateWorkspaceOverride?: (patchArg: unknown) => Promise<unknown>;
      };
    };

    if (!host.__parallx_chat_debug__?.updateWorkspaceOverride) {
      throw new Error('Missing workspace override debug hook.');
    }

    await host.__parallx_chat_debug__.updateWorkspaceOverride(overridePatch);
  }, patch);
}

async function waitForTaskCard(page: Page, goal: string) {
  const card = page.locator('.parallx-chat-agent-task-card', { hasText: goal }).first();
  await card.waitFor({ state: 'visible', timeout: 10_000 });
  return card;
}

test.describe('AIR Product Behavior', () => {
  const PAGE_CONTENT = 'Claim reports must be filed within 72 hours, and photos should be captured before moving the vehicle.';

  test('mixed conversational, grounded, delegated, and social turns stay mode-balanced', async ({ window, electronApp, workspacePath }) => {
    await setupCanvasPage(window, electronApp, workspacePath);
    await setContent(window, [
      { type: 'paragraph', content: [{ type: 'text', text: PAGE_CONTENT }] },
    ]);
    await window.waitForTimeout(2_000);

    const { chatRequests } = await interceptOllama(window, (body) => {
      const userMsg = [...(body.messages ?? [])].reverse().find((message: any) => message.role === 'user');
      const content = typeof userMsg?.content === 'string' ? userMsg.content : '';
      if (content === 'hello') {
        return 'Hey there. I am ready to help.';
      }
      if (content.includes(PAGE_CONTENT)) {
        return 'The current page says claim reports must be filed within 72 hours, and photos should be captured before moving the vehicle.';
      }
      if (content === 'thanks') {
        return 'You are welcome.';
      }
      return 'I can help with that.';
    });

    await openChatPanel(window);
    await startNewChatSession(window);

    let assistantCount = await window.locator('.parallx-chat-message--assistant').count();
    await sendChatMessage(window, 'hello');
    const greeting = await waitForNextAssistantResponse(window, assistantCount);
    expect(greeting).toContain('ready to help');

    assistantCount = await window.locator('.parallx-chat-message--assistant').count();
    await sendChatMessage(window, 'What does my current page say about filing deadlines and photos?');
    const grounded = await waitForNextAssistantResponse(window, assistantCount);
    expect(grounded).toContain('72 hours');
    expect(grounded).toContain('photos');

    await seedAgentTask(window, {
      taskId: 'task-mode-balance',
      input: {
        goal: 'Refresh the claims docs',
        completionCriteria: ['Claims docs refreshed'],
        desiredAutonomy: 'allow-policy-actions',
        mode: 'operator',
      },
      steps: [
        {
          id: 'step-balance-edit',
          title: 'Edit the claims guide',
          description: 'Refresh the claims guide content.',
          kind: 'edit',
          proposedAction: {
            toolName: 'edit_file',
            actionClass: 'edit',
            summary: 'Edit the claims guide',
            targetPaths: ['docs/Claims Guide.md'],
            interactionMode: 'operator',
          },
        },
      ],
      run: true,
    });
    await waitForTaskCard(window, 'Refresh the claims docs');

    assistantCount = await window.locator('.parallx-chat-message--assistant').count();
    await sendChatMessage(window, 'thanks');
    const followUp = await waitForNextAssistantResponse(window, assistantCount);
    expect(followUp).toContain('welcome');

    expect(chatRequests.length).toBeGreaterThanOrEqual(3);

    const firstReq = chatRequests[0];
  const firstUser = [...firstReq.messages].reverse().find((message: any) => message.role === 'user');
    expect(firstUser.content).toBe('hello');
    expect(firstUser.content).not.toContain('[Retrieved Context]');
    expect(firstUser.content).not.toContain('Currently open page');
    expect(firstReq.tools ?? []).toHaveLength(0);

    const secondReq = chatRequests[1];
  const secondUser = [...secondReq.messages].reverse().find((message: any) => message.role === 'user');
    expect(secondUser.content).toContain(PAGE_CONTENT);
    expect(secondUser.content).toContain('Currently open page');
    expect(secondUser.content).not.toContain('[Retrieved Context]');
    expect(Array.isArray(secondReq.tools)).toBe(true);
    expect(secondReq.tools.length).toBeGreaterThan(0);

    const thirdReq = chatRequests[2];
  const thirdUser = [...thirdReq.messages].reverse().find((message: any) => message.role === 'user');
    expect(thirdUser.content).toBe('thanks');
    expect(thirdUser.content).not.toContain('[Retrieved Context]');
    expect(thirdUser.content).not.toContain('Currently open page');
    expect(thirdReq.tools ?? []).toHaveLength(0);
  });

  test('approval denial stays blocked and artifact-free in the task rail', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);
    await openChatPanel(window);

    await seedAgentTask(window, {
      taskId: 'task-approval-denied',
      input: {
        goal: 'Update the claims guide',
        completionCriteria: ['Claims guide updated'],
        desiredAutonomy: 'allow-policy-actions',
        mode: 'operator',
      },
      steps: [
        {
          id: 'step-write-guide',
          title: 'Write the updated claims guide',
          description: 'Update the claims guide in docs.',
          kind: 'write',
          proposedAction: {
            toolName: 'write_file',
            actionClass: 'write',
            summary: 'Write the updated claims guide',
            targetPaths: ['docs/Claims Guide.md'],
            interactionMode: 'operator',
          },
        },
      ],
      run: true,
    });

    const card = await waitForTaskCard(window, 'Update the claims guide');
    await expect(card.locator('.parallx-chat-agent-task-status')).toHaveText('Awaiting approval');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('Waiting for approval before the next workspace action can run');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('Write the updated claims guide');
    await expect(card.locator('.parallx-chat-agent-approval-card')).toContainText('Claims Guide.md');
    await expect(card.locator('.parallx-chat-agent-approval-card')).toContainText('Approve once only allows this single action');

    await card.locator('.parallx-chat-agent-approval-button', { hasText: 'Deny' }).click();

    await expect(card.locator('.parallx-chat-agent-task-status')).toHaveText('Blocked');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('Task is blocked because an approval was denied');
    await expect(card.locator('.parallx-chat-agent-task-artifacts')).toHaveCount(0);
    await expect(card.locator('.parallx-chat-agent-task-next-step')).toContainText('Continue to retry the task');
    await expect(card.locator('.parallx-chat-agent-task-next-step')).toContainText('different action');
  });

  test('approval approval completes and surfaces artifact summary in the task rail', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);
    await openChatPanel(window);

    await seedAgentTask(window, {
      taskId: 'task-approval-complete',
      input: {
        goal: 'Refresh the claims docs',
        completionCriteria: ['Claims docs refreshed'],
        desiredAutonomy: 'allow-policy-actions',
        mode: 'operator',
      },
      steps: [
        {
          id: 'step-edit-claims-docs',
          title: 'Edit the claims guide',
          description: 'Refresh the claims guide content.',
          kind: 'edit',
          proposedAction: {
            toolName: 'edit_file',
            actionClass: 'edit',
            summary: 'Edit the claims guide',
            targetPaths: ['docs/Claims Guide.md'],
            interactionMode: 'operator',
          },
        },
      ],
      run: true,
    });

    const card = await waitForTaskCard(window, 'Refresh the claims docs');
    await expect(card.locator('.parallx-chat-agent-task-status')).toHaveText('Awaiting approval');

    await card.locator('.parallx-chat-agent-approval-button', { hasText: 'Approve once' }).click();

    await expect(card.locator('.parallx-chat-agent-task-status')).toHaveText('Completed');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('Workspace update complete');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('1 recorded artifact');
    await expect(card.locator('.parallx-chat-agent-task-artifacts')).toContainText('Claims Guide.md');
    await expect(card.locator('.parallx-chat-agent-task-next-step')).toContainText('Review the recorded artifacts');
  });

  test('stepwise execution pauses after a safe step and continue completes the task', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);
    await openChatPanel(window);
    await updateWorkspaceOverride(window, { agent: { executionStyle: 'stepwise', proactivity: 'balanced' } });

    await seedAgentTask(window, {
      taskId: 'task-stepwise-pause',
      input: {
        goal: 'Inspect the workspace readme',
        completionCriteria: ['Readme inspected'],
        desiredAutonomy: 'allow-readonly',
        mode: 'operator',
      },
      steps: [
        {
          id: 'step-read-readme',
          title: 'Read the workspace README',
          description: 'Inspect the workspace README file.',
          kind: 'read',
          proposedAction: {
            toolName: 'read_file',
            actionClass: 'read',
            summary: 'Read the workspace README',
            targetPaths: ['README.md'],
            interactionMode: 'operator',
          },
        },
      ],
      run: true,
    });

    const card = await waitForTaskCard(window, 'Inspect the workspace readme');
    await expect(card.locator('.parallx-chat-agent-task-status')).toHaveText('Paused');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('configured execution cadence');
    await expect(card.locator('.parallx-chat-agent-task-next-step')).toContainText('Continue when you want the next step to run');
    await card.locator('.parallx-chat-agent-task-button', { hasText: 'Continue' }).click();

    await expect(card.locator('.parallx-chat-agent-task-status')).toHaveText('Completed');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('no recorded workspace artifacts');
    await expect(card.locator('.parallx-chat-agent-task-next-step')).toContainText('Review the completed plan');
  });

  test('outside-workspace task stays blocked and exposes readable diagnostics', async ({ window, electronApp, workspacePath }) => {
    await openFolderViaMenu(electronApp, window, workspacePath);
    await openChatPanel(window);

    const outsidePath = path.join(path.dirname(workspacePath), 'parallx-outside-target.md');

    await seedAgentTask(window, {
      taskId: 'task-outside-workspace',
      input: {
        goal: 'Try to edit a file outside the workspace',
        completionCriteria: ['Outside file updated'],
        desiredAutonomy: 'allow-policy-actions',
        mode: 'operator',
      },
      steps: [
        {
          id: 'step-outside-edit',
          title: 'Attempt outside-workspace edit',
          description: 'Try to edit a file beyond the active workspace root.',
          kind: 'edit',
          proposedAction: {
            toolName: 'edit_file',
            actionClass: 'edit',
            summary: 'Edit a file outside the workspace',
            targetPaths: [outsidePath],
            interactionMode: 'operator',
          },
        },
      ],
      run: true,
    });

    const card = await waitForTaskCard(window, 'Try to edit a file outside the workspace');
    await expect(card.locator('.parallx-chat-agent-task-status')).toHaveText('Blocked');
    await expect(card.locator('.parallx-chat-agent-task-summary')).toContainText('outside the active workspace boundary');
    await expect(card.locator('.parallx-chat-agent-task-artifacts')).toHaveCount(0);
    await expect(card.locator('.parallx-chat-agent-task-next-step')).toContainText('Keep the task inside the active workspace');

    await card.locator('.parallx-chat-agent-task-button', { hasText: 'Show details' }).click();
    const details = card.locator('.parallx-chat-agent-task-details');
    await expect(details).toContainText('Trace');
    await expect(details).toContainText('Approvals 0');
    await expect(details.locator('.parallx-chat-agent-task-trace')).toContainText('Blocked step: Attempt outside-workspace edit');
    await expect(details.locator('.parallx-chat-agent-task-trace')).toContainText('outside the active workspace');
  });
});