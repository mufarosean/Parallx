// Chat is usable when ANY provider is — not only Ollama. A user who set up
// Claude and never installed Ollama must not be stuck behind the offline state.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatDataService } from '../../src/built-in/chat/data/chatDataService';
import { Emitter } from '../../src/platform/events';

function setup(opts: { ollama: boolean; others: { id: string; available: boolean }[] }) {
  const providersChanged = new Emitter<void>();
  const providers = opts.others.map((o) => ({ id: o.id, checkAvailability: vi.fn(async () => ({ available: o.available })) }));
  const ollamaChanged = new Emitter<unknown>();
  const service = new ChatDataService({
    languageModelsService: { getProviders: () => providers, onDidChangeProviders: providersChanged.event },
    ollamaProvider: { getLastStatus: () => ({ available: opts.ollama }), onDidChangeStatus: ollamaChanged.event },
  } as any) as any;
  return { service, providers, providersChanged };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('chat provider availability', () => {
  afterEach(() => vi.useRealTimers());

  it('Ollama alone is enough', () => {
    const { service } = setup({ ollama: true, others: [] });
    service._providerStatusEvent();
    expect(service._isAnyProviderAvailable()).toBe(true);
  });

  it('a cloud provider with its key makes chat usable without Ollama, and says so', async () => {
    const { service } = setup({ ollama: false, others: [{ id: 'anthropic', available: true }] });
    const fired = vi.fn();
    service._providerStatusEvent()(fired);
    expect(service._isAnyProviderAvailable()).toBe(false);
    await flush();
    expect(service._isAnyProviderAvailable()).toBe(true);
    expect(fired).toHaveBeenCalled();
  });

  it('nothing usable stays offline, and a key saved later is picked up without a restart', async () => {
    vi.useFakeTimers();
    const state = { available: false };
    const { service, providers } = setup({ ollama: false, others: [{ id: 'anthropic', available: false }] });
    providers[0].checkAvailability.mockImplementation(async () => ({ available: state.available }));
    service._providerStatusEvent();
    await vi.advanceTimersByTimeAsync(0);
    expect(service._isAnyProviderAvailable()).toBe(false);
    state.available = true;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(service._isAnyProviderAvailable()).toBe(true);
    // Once usable, it stops polling.
    const calls = providers[0].checkAvailability.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(providers[0].checkAvailability.mock.calls.length).toBe(calls);
  });
});
