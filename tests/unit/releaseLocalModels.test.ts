// releaseLocalModels.test.ts — setting the local models aside so a tool can
// use the graphics card: Ollama unloads each model it holds, the service asks
// only local providers, and the Generate tab reads the card's room from the
// engine's check.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaProvider } from '../../src/built-in/chat/providers/ollamaProvider';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import type { ILanguageModelProvider } from '../../src/services/chatTypes';
// @ts-expect-error — JS module with no types
import { MO_GENERATE_NEEDS_MIB, moGenCardRoom } from '../../ext/media-organizer/edit-generate.js';

const json = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => { vi.unstubAllGlobals(); });

describe('OllamaProvider.releaseLoaded', () => {
  it('unloads every model Ollama holds, and says which', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith('/api/ps')) return json({ models: [{ name: 'gemma4:31b', size: 20e9, size_vram: 20e9 }, { name: 'nomic-embed-text:latest', size: 3e8, size_vram: 3e8 }] });
      if (url.endsWith('/api/generate')) return json({ done: true });
      if (url.endsWith('/api/version')) return json({ version: '0.5.4' });
      return json({ models: [] });
    }));
    const provider = new OllamaProvider('http://localhost:11434');
    try {
      expect(await provider.releaseLoaded()).toEqual(['gemma4:31b', 'nomic-embed-text:latest']);
      const unloads = calls.filter((c) => c.url.endsWith('/api/generate'));
      expect(unloads.map((c) => c.body)).toEqual([{ model: 'gemma4:31b', keep_alive: 0 }, { model: 'nomic-embed-text:latest', keep_alive: 0 }]);
      expect(provider.getLoadedModels()).toEqual([]);
      expect(provider.getPlacements()).toEqual([]);
    } finally { provider.dispose(); }
  });

  it('does nothing when nothing is loaded', async () => {
    const posts: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(String(input));
      return String(input).endsWith('/api/version') ? json({ version: '0.5.4' }) : json({ models: [] });
    }));
    const provider = new OllamaProvider('http://localhost:11434');
    try {
      expect(await provider.releaseLoaded()).toEqual([]);
      expect(posts.filter((u) => u.endsWith('/api/generate'))).toEqual([]);
    } finally { provider.dispose(); }
  });
});

describe('LanguageModelsService.releaseLocalModels', () => {
  const provider = (id: string, over: Partial<ILanguageModelProvider>): ILanguageModelProvider => ({
    id, displayName: id,
    listModels: async () => [],
    checkAvailability: async () => ({ available: true }),
    sendChatRequest: async function* () { /* nothing */ },
    ...over,
  } as unknown as ILanguageModelProvider);

  it('asks only local providers, and gathers what each released', async () => {
    const service = new LanguageModelsService();
    const cloud = vi.fn(async () => ['should-not-be-asked']);
    service.registerProvider(provider('local-a', { local: true, releaseLoaded: async () => ['gemma4:31b'] }));
    service.registerProvider(provider('cloud', { releaseLoaded: cloud }));
    service.registerProvider(provider('local-b', { local: true }));
    expect(await service.releaseLocalModels()).toEqual(['gemma4:31b']);
    expect(cloud).not.toHaveBeenCalled();
    service.dispose();
  });

  it('carries on past a local engine that is not running', async () => {
    const service = new LanguageModelsService();
    service.registerProvider(provider('down', { local: true, releaseLoaded: async () => { throw new Error('ECONNREFUSED'); } }));
    service.registerProvider(provider('up', { local: true, releaseLoaded: async () => ['qwen3.8:latest'] }));
    expect(await service.releaseLocalModels()).toEqual(['qwen3.8:latest']);
    service.dispose();
  });
});

describe('the room on the card, as the Generate tab reads it', () => {
  it('is the largest card\'s free and total memory', () => {
    expect(moGenCardRoom({ cards: [{ name: 'Small', vramMiB: 8192, freeMiB: 8000 }, { name: 'RTX 5090', vramMiB: 32607, freeMiB: 9200 }] })).toEqual({ free: 9200, total: 32607, name: 'RTX 5090' });
  });

  it('is nothing when the check found no card', () => {
    expect(moGenCardRoom({ cards: [] })).toBeNull();
    expect(moGenCardRoom(null)).toBeNull();
  });

  it('needs what the script refuses below', () => {
    expect(MO_GENERATE_NEEDS_MIB).toBe(21 * 1024);
  });
});
