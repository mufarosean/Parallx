import { describe, it, expect, vi } from 'vitest';
import { sendTurnWithWorkingLimit } from '../../src/openclaw/openclawWorkingTimeLimit';

describe('sendTurnWithWorkingLimit', () => {
  it('returns the turn result when it finishes in time', async () => {
    const chat = { sendRequest: vi.fn(async () => 'ok') };
    await expect(sendTurnWithWorkingLimit(chat, 's', 'm', 1000)).resolves.toBe('ok');
  });

  it('does not count time spent waiting for the model', async () => {
    vi.useFakeTimers();
    try {
      let waited = 0;
      const chat = {
        sendRequest: () => new Promise((r) => setTimeout(() => r('done'), 3000)),
        getWaitingMs: () => waited,
        cancelRequest: vi.fn(),
      };
      const p = sendTurnWithWorkingLimit(chat, 's', 'm', 2000);
      waited = 1500; // half the run sat behind your chat
      await vi.advanceTimersByTimeAsync(3100);
      await expect(p).resolves.toBe('done');
      expect(chat.cancelRequest).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels a turn that works past the limit', async () => {
    vi.useFakeTimers();
    try {
      let finish: () => void = () => {};
      const chat = {
        sendRequest: () => new Promise<void>((r) => { finish = r; }),
        cancelRequest: vi.fn(() => finish()),
      };
      const p = sendTurnWithWorkingLimit(chat, 's', 'm', 1000);
      const settled = expect(p).rejects.toThrow(/stopped/);
      await vi.advanceTimersByTimeAsync(1100);
      await settled;
      expect(chat.cancelRequest).toHaveBeenCalledWith('s');
    } finally {
      vi.useRealTimers();
    }
  });
});
