import { describe, expect, it, vi } from 'vitest';

import { applyChatTurnBudgeting } from '../../src/built-in/chat/utilities/chatTurnBudgeting';

function createResponse() {
  return {
    progress: vi.fn(),
    warning: vi.fn(),
  } as any;
}

describe('chat turn budgeting', () => {
  it('trims rag context and reports budget usage when over budget', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'older history message that is reasonably long' },
      { role: 'assistant', content: 'assistant history message that is reasonably long' },
    ] as any[];
    const contextParts = ['A'.repeat(2000), 'B'.repeat(2000)];
    const response = createResponse();
    const reportBudget = vi.fn();

    applyChatTurnBudgeting({
      messages,
      contextParts,
      userText: 'current question',
      response,
      contextWindow: 300,
      reportBudget,
    });

    expect(contextParts.join('\n\n').length).toBeLessThan(('A'.repeat(2000) + '\n\n' + 'B'.repeat(2000)).length);
    expect(reportBudget).toHaveBeenCalledOnce();
    expect(response.warning).not.toHaveBeenCalled();
  });

  it('drops oldest history when messages still exceed the context window', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'x'.repeat(9000) },
      { role: 'assistant', content: 'y'.repeat(9000) },
      { role: 'user', content: 'latest question' },
    ] as any[];
    const contextParts: string[] = [];
    const response = createResponse();

    applyChatTurnBudgeting({
      messages,
      contextParts,
      userText: 'latest question',
      response,
      contextWindow: 500,
    });

    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(response.warning).toHaveBeenCalledWith(expect.stringContaining('Context window full'));
  });

  it('warns when approaching the context limit without trimming', () => {
    const messages = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'x'.repeat(700) },
    ] as any[];
    const contextParts: string[] = [];
    const response = createResponse();

    applyChatTurnBudgeting({
      messages,
      contextParts,
      userText: 'latest question',
      response,
      contextWindow: 220,
    });

    expect(response.warning).toHaveBeenCalledWith(expect.stringContaining('Approaching context limit'));
  });
});