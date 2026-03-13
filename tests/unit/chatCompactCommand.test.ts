import { describe, expect, it, vi } from 'vitest';

import { tryExecuteCompactChatCommand } from '../../src/built-in/chat/utilities/chatCompactCommand';

function createResponse() {
  return {
    markdown: vi.fn(),
    progress: vi.fn(),
  } as any;
}

describe('chat compact command', () => {
  it('returns false when the turn is not a compact command', async () => {
    const handled = await tryExecuteCompactChatCommand({}, {
      isCompactCommand: false,
      sessionId: 'session-1',
      history: [],
      response: createResponse(),
    });

    expect(handled).toBe(false);
  });

  it('reports missing summarization support', async () => {
    const response = createResponse();

    const handled = await tryExecuteCompactChatCommand({}, {
      isCompactCommand: true,
      sessionId: 'session-1',
      history: [{ request: { text: 'first' }, response: { parts: [] } }, { request: { text: 'second' }, response: { parts: [] } }] as any,
      response,
    });

    expect(handled).toBe(true);
    expect(response.markdown).toHaveBeenCalledWith('`/compact` requires a summarization model. No summarization service available.');
  });

  it('compacts history, persists the summary, and reports token savings', async () => {
    const response = createResponse();
    const compactSession = vi.fn();
    const sendSummarizationRequest = vi.fn(async function* () {
      yield { content: 'Short summary' };
    });

    const handled = await tryExecuteCompactChatCommand({
      sendSummarizationRequest,
      compactSession,
    }, {
      isCompactCommand: true,
      sessionId: 'session-7',
      history: [
        {
          request: { text: 'What changed in the policy?' },
          response: { parts: [{ text: 'Collision deductible increased.' }] },
        },
        {
          request: { text: 'Who is my agent?' },
          response: { parts: [{ code: 'agent: Sarah Chen' }] },
        },
      ] as any,
      response,
    });

    expect(handled).toBe(true);
    expect(response.progress).toHaveBeenCalledWith('Compacting conversation history…');
    expect(sendSummarizationRequest).toHaveBeenCalledOnce();
    expect(compactSession).toHaveBeenCalledWith('session-7', 'Short summary');
    expect(response.markdown).toHaveBeenCalledWith(expect.stringContaining('Conversation compacted.'));
    expect(response.markdown).toHaveBeenCalledWith(expect.stringContaining('Saved: ~'));
  });
});