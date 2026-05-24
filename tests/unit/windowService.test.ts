// windowService.test.ts — pin WindowService Electron bridge wrapper.
//
// Pins:
//   - With no parallxElectron global: isNativeWindow=false; all controls no-op;
//     isMaximized() resolves to false.
//   - With bridge present: isNativeWindow=true; minimize/maximize/close pass through;
//     isMaximized awaits bridge.
//   - onMaximizedChange callback is registered ONCE at construction and refires
//     the WindowService.onDidChangeMaximized event with the same payload.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { WindowService } from '../../src/services/windowService';

function setBridge(api: any | undefined) {
  if (api === undefined) {
    delete (globalThis as any).window;
    return;
  }
  (globalThis as any).window = { parallxElectron: api };
}

afterEach(() => {
  delete (globalThis as any).window;
});

describe('WindowService — no bridge', () => {
  it('isNativeWindow=false; controls are no-ops; isMaximized resolves false', async () => {
    (globalThis as any).window = {}; // present but no parallxElectron
    const svc = new WindowService();
    expect(svc.isNativeWindow).toBe(false);
    expect(() => svc.minimize()).not.toThrow();
    expect(() => svc.maximize()).not.toThrow();
    expect(() => svc.close()).not.toThrow();
    await expect(svc.isMaximized()).resolves.toBe(false);
    svc.dispose();
  });
});

describe('WindowService — with bridge', () => {
  it('isNativeWindow=true; minimize/maximize/close pass through', () => {
    const api = {
      minimize: vi.fn(),
      maximize: vi.fn(),
      close: vi.fn(),
      isMaximized: vi.fn(),
      onMaximizedChange: vi.fn(),
    };
    setBridge(api);
    const svc = new WindowService();
    expect(svc.isNativeWindow).toBe(true);
    svc.minimize();
    svc.maximize();
    svc.close();
    expect(api.minimize).toHaveBeenCalledTimes(1);
    expect(api.maximize).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledTimes(1);
    svc.dispose();
  });

  it('isMaximized resolves to bridge value', async () => {
    setBridge({
      minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn().mockResolvedValue(true),
      onMaximizedChange: vi.fn(),
    });
    const svc = new WindowService();
    await expect(svc.isMaximized()).resolves.toBe(true);
    svc.dispose();
  });

  it('onMaximizedChange registered once and refires onDidChangeMaximized', () => {
    let captured: ((m: boolean) => void) | undefined;
    const onMaximizedChange = vi.fn((cb) => { captured = cb; });
    setBridge({
      minimize: vi.fn(), maximize: vi.fn(), close: vi.fn(),
      isMaximized: vi.fn(),
      onMaximizedChange,
    });
    const svc = new WindowService();
    expect(onMaximizedChange).toHaveBeenCalledTimes(1);
    const heard: boolean[] = [];
    svc.onDidChangeMaximized(v => heard.push(v));
    captured!(true);
    captured!(false);
    expect(heard).toEqual([true, false]);
    svc.dispose();
  });
});
