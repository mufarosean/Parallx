import { describe, it, expect, vi } from 'vitest';
import { RuntimeHookRegistry } from '../../src/services/runtimeHookRegistry.js';
import type { IChatRuntimeToolInvocationObserver, IChatRuntimeToolMetadata } from '../../src/services/chatRuntimeTypes.js';
import type { IToolResult } from '../../src/services/chatTypes.js';
import type { IChatRuntimeMessageObserver } from '../../src/services/serviceTypes.js';

const makeMetadata = (name = 'test-tool'): IChatRuntimeToolMetadata => ({
  name,
  permissionLevel: 'always-allowed',
  enabled: true,
  requiresApproval: false,
  autoApproved: true,
  approvalSource: 'default',
});

const makeResult = (content = 'ok'): IToolResult => ({ content });

describe('RuntimeHookRegistry', () => {
  // ── Registration / Deregistration ──

  it('registerToolObserver returns disposable that removes observer', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    const observer: IChatRuntimeToolInvocationObserver = {
      onValidated: () => calls.push('validated'),
    };
    const disposable = registry.registerToolObserver(observer);
    const composite = registry.getCompositeToolObserver();

    composite.onValidated!(makeMetadata());
    expect(calls).toEqual(['validated']);

    disposable.dispose();
    composite.onValidated!(makeMetadata());
    // Should still be ['validated'] — observer was removed
    expect(calls).toEqual(['validated']);
  });

  it('registerMessageObserver returns disposable that removes observer', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    const observer: IChatRuntimeMessageObserver = {
      onBeforeModelCall: () => calls.push('before'),
    };
    const disposable = registry.registerMessageObserver(observer);
    const composite = registry.getCompositeMessageObserver();

    composite.onBeforeModelCall!([], 'model');
    expect(calls).toEqual(['before']);

    disposable.dispose();
    composite.onBeforeModelCall!([], 'model');
    expect(calls).toEqual(['before']);
  });

  // ── Composite fires all observers ──

  it('composite tool observer fires all registered observers', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    registry.registerToolObserver({ onValidated: () => calls.push('A') });
    registry.registerToolObserver({ onValidated: () => calls.push('B') });
    registry.registerToolObserver({ onExecuted: () => calls.push('C') });

    const composite = registry.getCompositeToolObserver();
    composite.onValidated!(makeMetadata());
    composite.onExecuted!(makeMetadata(), makeResult());

    expect(calls).toEqual(['A', 'B', 'C']);
  });

  it('composite message observer fires all registered observers', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    const msgs = [{ role: 'user', content: 'hello' }];
    registry.registerMessageObserver({ onBeforeModelCall: () => calls.push('before-A') });
    registry.registerMessageObserver({ onAfterModelCall: () => calls.push('after-B') });

    const composite = registry.getCompositeMessageObserver();
    composite.onBeforeModelCall!(msgs, 'gpt-oss:20b');
    composite.onAfterModelCall!(msgs, 'gpt-oss:20b', 1234);

    expect(calls).toEqual(['before-A', 'after-B']);
  });

  // ── Error isolation ──

  it('tool observer error does not prevent other observers from firing', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registry.registerToolObserver({
      onValidated: () => { throw new Error('boom'); },
    });
    registry.registerToolObserver({
      onValidated: () => calls.push('survived'),
    });

    const composite = registry.getCompositeToolObserver();
    composite.onValidated!(makeMetadata());

    expect(calls).toEqual(['survived']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it('message observer error does not prevent other observers from firing', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    registry.registerMessageObserver({
      onBeforeModelCall: () => { throw new Error('boom'); },
    });
    registry.registerMessageObserver({
      onBeforeModelCall: () => calls.push('survived'),
    });

    const composite = registry.getCompositeMessageObserver();
    composite.onBeforeModelCall!([], 'model');

    expect(calls).toEqual(['survived']);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  // ── All 4 tool observer callbacks ──

  it('composite fires all 4 tool observer callbacks', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    registry.registerToolObserver({
      onValidated: () => calls.push('validated'),
      onApprovalRequested: () => calls.push('requested'),
      onApprovalResolved: () => calls.push('resolved'),
      onExecuted: () => calls.push('executed'),
    });

    const composite = registry.getCompositeToolObserver();
    const meta = makeMetadata();
    composite.onValidated!(meta);
    composite.onApprovalRequested!(meta);
    composite.onApprovalResolved!(meta, true);
    composite.onExecuted!(meta, makeResult());

    expect(calls).toEqual(['validated', 'requested', 'resolved', 'executed']);
  });

  // ── Both message observer callbacks ──

  it('composite fires both message observer callbacks with correct args', () => {
    const registry = new RuntimeHookRegistry();
    const beforeArgs: unknown[] = [];
    const afterArgs: unknown[] = [];
    registry.registerMessageObserver({
      onBeforeModelCall: (msgs, model) => beforeArgs.push({ msgs, model }),
      onAfterModelCall: (msgs, model, dur) => afterArgs.push({ msgs, model, dur }),
    });

    const msgs = [{ role: 'user', content: 'hi' }];
    const composite = registry.getCompositeMessageObserver();
    composite.onBeforeModelCall!(msgs, 'gpt-oss:20b');
    composite.onAfterModelCall!(msgs, 'gpt-oss:20b', 500);

    expect(beforeArgs).toEqual([{ msgs, model: 'gpt-oss:20b' }]);
    expect(afterArgs).toEqual([{ msgs, model: 'gpt-oss:20b', dur: 500 }]);
  });

  // ── Multiple observers per callback ──

  it('supports multiple observers for the same callback', () => {
    const registry = new RuntimeHookRegistry();
    const order: number[] = [];
    registry.registerToolObserver({ onExecuted: () => order.push(1) });
    registry.registerToolObserver({ onExecuted: () => order.push(2) });
    registry.registerToolObserver({ onExecuted: () => order.push(3) });

    const composite = registry.getCompositeToolObserver();
    composite.onExecuted!(makeMetadata(), makeResult());

    expect(order).toHaveLength(3);
    // All 3 fired (order matches Set insertion order in practice)
    expect(new Set(order)).toEqual(new Set([1, 2, 3]));
  });

  // ── Empty registry ──

  it('composite works with no registered observers', () => {
    const registry = new RuntimeHookRegistry();
    const composite = registry.getCompositeToolObserver();
    const msgComposite = registry.getCompositeMessageObserver();

    // Should not throw
    composite.onValidated!(makeMetadata());
    composite.onExecuted!(makeMetadata(), makeResult());
    msgComposite.onBeforeModelCall!([], 'model');
    msgComposite.onAfterModelCall!([], 'model', 0);
  });

  // ── Partial observers (only some callbacks defined) ──

  it('handles observers with only some callbacks defined', () => {
    const registry = new RuntimeHookRegistry();
    const calls: string[] = [];
    registry.registerToolObserver({
      onValidated: () => calls.push('validated'),
      // onExecuted not defined
    });

    const composite = registry.getCompositeToolObserver();
    composite.onValidated!(makeMetadata());
    composite.onExecuted!(makeMetadata(), makeResult());

    expect(calls).toEqual(['validated']);
  });

  // ── Double dispose is safe ──

  it('double dispose does not throw', () => {
    const registry = new RuntimeHookRegistry();
    const disp = registry.registerToolObserver({ onValidated: () => {} });
    disp.dispose();
    expect(() => disp.dispose()).not.toThrow();
  });
});
