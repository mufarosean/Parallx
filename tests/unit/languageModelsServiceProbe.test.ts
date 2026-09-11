/**
 * A model restored at startup is asked what it can do. Only setActiveModel
 * probed, so a model restored from storage kept the defaults ('completion',
 * 4096): the chat then told browserCapture the model could not see images,
 * although it could. ensureActiveModelInfo lets a turn wait for the answer.
 */

import { describe, it, expect, vi } from 'vitest';
import { LanguageModelsService } from '../../src/services/languageModelsService';

const MODEL = 'qwen3.8:27b';
const info = (capabilities: string[], contextLength = 262144) => ({ id: MODEL, displayName: MODEL, family: 'qwen35', parameterSize: '27.3B', quantization: 'Q4_K_M', contextLength, capabilities });

function provider(getModelInfo: (id: string) => Promise<unknown>) {
  return {
    id: 'ollama', displayName: 'Ollama',
    // The listing carries only the defaults, like Ollama's /api/tags.
    listModels: vi.fn(async () => [{ ...info(['completion'], 0) }]),
    getModelInfo: vi.fn(getModelInfo),
    checkStatus: vi.fn(async () => ({ available: true })),
    sendChatRequest: vi.fn(),
  } as any;
}
function storage(active?: string) {
  const m = new Map<string, string>(active ? [['languageModels.activeModelId', active]] : []);
  return { get: async (k: string) => m.get(k), set: async (k: string, v: string) => { m.set(k, v); }, delete: async (k: string) => { m.delete(k); } } as any;
}
const until = async (cond: () => boolean) => { for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 5)); };

describe('LanguageModelsService: a model restored at startup', () => {
  it('is asked what it can do once its provider lists it, instead of keeping the text-only default', async () => {
    const lms = new LanguageModelsService();
    await lms.setStorage(storage(MODEL));
    const p = provider(async () => info(['completion', 'tools', 'vision']));
    lms.registerProvider(p);
    await until(() => lms.getActiveModelCapabilities().includes('vision'));
    expect(lms.getActiveModel()).toBe(MODEL);
    expect(p.getModelInfo).toHaveBeenCalledWith(MODEL);
    expect(lms.getActiveModelCapabilities()).toContain('vision');
    expect(lms.getActiveModelContextLength()).toBe(262144);
    // Known now: a turn does not ask again.
    p.getModelInfo.mockClear();
    await lms.ensureActiveModelInfo();
    expect(p.getModelInfo).not.toHaveBeenCalled();
  });

  it('lets a turn wait for the answer when the probe has not landed yet', async () => {
    const lms = new LanguageModelsService();
    await lms.setStorage(storage(MODEL));
    const p = provider(() => new Promise((r) => setTimeout(() => r(info(['completion', 'vision'])), 40)));
    lms.registerProvider(p);
    await until(() => p.listModels.mock.calls.length > 0 && p.getModelInfo.mock.calls.length > 0);
    expect(lms.getActiveModelCapabilities()).not.toContain('vision');
    await lms.ensureActiveModelInfo();
    expect(lms.getActiveModelCapabilities()).toContain('vision');
  });

  it('keeps the defaults, without hanging, when the provider does not answer', async () => {
    vi.useFakeTimers();
    try {
      const lms = new LanguageModelsService();
      await lms.setStorage(storage(MODEL));
      const p = provider(() => new Promise(() => { /* never answers */ }));
      lms.registerProvider(p);
      await vi.advanceTimersByTimeAsync(10);
      const waiting = lms.ensureActiveModelInfo();
      await vi.advanceTimersByTimeAsync(3_100);
      await waiting;
      expect(lms.getActiveModelCapabilities()).toEqual(['completion']);
    } finally { vi.useRealTimers(); }
  });
});
