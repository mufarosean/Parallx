import { describe, expect, it, vi } from 'vitest';

import { queueChatMemoryWriteBack } from '../../src/built-in/chat/utilities/chatMemoryWriteBack';
import { ChatContentPartKind } from '../../src/services/chatTypes';

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHistory() {
  return [{
    request: { text: 'I had an accident on Elm Street.', timestamp: Date.now() },
    response: {
      parts: [{ kind: ChatContentPartKind.Markdown, content: 'You should file a claim.' }],
      isComplete: true,
      modelId: 'test-model',
      timestamp: Date.now(),
    },
  }];
}

describe('chat memory write-back', () => {
  it('runs preference extraction when memory is enabled', async () => {
    const extractPreferences = vi.fn().mockResolvedValue(undefined);

    queueChatMemoryWriteBack(
      {
        extractPreferences,
        buildDeterministicSessionSummary: vi.fn(() => ''),
      },
      {
        memoryEnabled: true,
        requestText: 'Remember that I prefer concise answers.',
        sessionId: 'session-1',
        history: [],
      },
    );

    await flushPromises();

    expect(extractPreferences).toHaveBeenCalledWith('Remember that I prefer concise answers.');
  });

  it('stores fallback and model summaries, then persists extracted concepts', async () => {
    const storeSessionMemory = vi.fn().mockResolvedValue(undefined);
    const storeConceptsFromSession = vi.fn().mockResolvedValue(undefined);
    const sendSummarizationRequest = vi.fn(async function* () {
      yield {
        content: JSON.stringify({
          summary: 'Refined summary.',
          concepts: [
            {
              concept: 'Claims process',
              category: 'insurance',
              summary: 'User is learning the filing steps.',
              struggled: false,
            },
          ],
        }),
        done: true,
      };
    });

    queueChatMemoryWriteBack(
      {
        storeSessionMemory,
        storeConceptsFromSession,
        isSessionEligibleForSummary: vi.fn(() => true),
        getSessionMemoryMessageCount: vi.fn().mockResolvedValue(1),
        sendSummarizationRequest,
        buildDeterministicSessionSummary: vi.fn(() => 'Fallback summary.'),
      },
      {
        memoryEnabled: true,
        requestText: 'The police report number is 2026-0308-1147.',
        sessionId: 'session-1',
        history: createHistory(),
      },
    );

    await flushPromises();
    await flushPromises();

    expect(storeSessionMemory).toHaveBeenNthCalledWith(1, 'session-1', 'Fallback summary.', 2);
    expect(storeSessionMemory).toHaveBeenNthCalledWith(2, 'session-1', 'Refined summary.', 2);
    expect(storeConceptsFromSession).toHaveBeenCalledWith([
      {
        concept: 'Claims process',
        category: 'insurance',
        summary: 'User is learning the filing steps.',
        struggled: false,
      },
    ], 'session-1');
    expect(sendSummarizationRequest).toHaveBeenCalledTimes(1);
  });
});