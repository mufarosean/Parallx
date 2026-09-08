import { describe, expect, it, vi } from 'vitest';
import { ChatDataService } from '../../src/built-in/chat/data/chatDataService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import type { ILanguageModelProvider } from '../../src/services/chatTypes';

describe('compaction provider routing', () => {
  it('routes a non-Ollama active model through its registered provider, preserving budget and cancellation', async () => {
    const lm = new LanguageModelsService();
    const info = { id: 'fixture-cloud', displayName: 'Fixture', family: 'fixture', parameterSize: '27B', quantization: '', contextLength: 16384, capabilities: ['completion'] as const };
    const send = vi.fn(async function* () { yield { content: 'Continuation summary', done: true }; });
    const provider: ILanguageModelProvider = {
      id: 'fixture', displayName: 'Fixture', listModels: async () => [info],
      getModelInfo: async () => info, checkAvailability: async () => ({ available: true }), sendChatRequest: send,
    };
    const registration = lm.registerProvider(provider);
    await lm.getModels();
    lm.setActiveModel(info.id);
    const rawOllama = vi.fn(async function* () { throw new Error('Model does not exist in Ollama'); });
    const service = new ChatDataService({ languageModelsService: lm, ollamaProvider: { sendChatRequest: rawOllama } } as any);
    const controller = new AbortController();
    const messages = [{ role: 'user' as const, content: 'Preserve the pending task.' }];
    const chunks = [];
    try {
      for await (const chunk of service.sendSummarizationRequest(messages, controller.signal, { numCtx: 16384 })) chunks.push(chunk);
      expect(chunks).toEqual([{ content: 'Continuation summary', done: true }]);
      expect(send).toHaveBeenCalledWith(info.id, messages, { numCtx: 16384 }, controller.signal);
      expect(rawOllama).not.toHaveBeenCalled();
    } finally { registration.dispose(); lm.dispose(); }
  });
});
