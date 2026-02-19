/**
 * Unit tests for CommandContributionProcessor — proxy handler, queue/replay,
 * timeout, deactivation cleanup, and duplicate command handling.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { CommandContributionProcessor } from '../../src/contributions/commandContribution';
import type { IToolDescription } from '../../src/tools/toolManifest';

// ── Mocks ───────────────────────────────────────────────────────────────────

function createMockCommandService() {
  const _handlers = new Map<string, Function>();
  return {
    registerCommand(descriptor: { id: string; handler: Function }) {
      _handlers.set(descriptor.id, descriptor.handler);
      return {
        dispose: () => { _handlers.delete(descriptor.id); },
      };
    },
    hasCommand(id: string) {
      return _handlers.has(id);
    },
    getHandler(id: string) {
      return _handlers.get(id);
    },
  };
}

function createMockActivationEvents() {
  const fired: string[] = [];
  return {
    fireCommand(commandId: string) {
      fired.push(commandId);
    },
    getFiredCommands() {
      return fired;
    },
  };
}

function createToolDescription(toolId: string, commands: { id: string; title: string }[]): IToolDescription {
  return {
    manifest: {
      id: toolId,
      displayName: toolId,
      version: '0.0.1',
      contributes: {
        commands,
      },
    },
  } as any;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('CommandContributionProcessor', () => {
  let commandService: ReturnType<typeof createMockCommandService>;
  let activationEvents: ReturnType<typeof createMockActivationEvents>;
  let processor: CommandContributionProcessor;

  beforeEach(() => {
    vi.useFakeTimers();
    commandService = createMockCommandService();
    activationEvents = createMockActivationEvents();
    processor = new CommandContributionProcessor(
      commandService as any,
      activationEvents as any,
    );
  });

  afterEach(() => {
    processor.dispose();
    vi.useRealTimers();
  });

  // ── Registration ──

  describe('processContributions', () => {
    it('registers commands from a tool manifest', () => {
      processor.processContributions(
        createToolDescription('my-tool', [
          { id: 'my-tool.hello', title: 'Hello' },
          { id: 'my-tool.world', title: 'World' },
        ]),
      );

      expect(processor.getContributedCommands()).toHaveLength(2);
      expect(processor.isContributed('my-tool.hello')).toBe(true);
      expect(processor.isContributed('my-tool.world')).toBe(true);
    });

    it('skips duplicate command IDs with a warning', () => {
      processor.processContributions(
        createToolDescription('tool-a', [{ id: 'cmd.dup', title: 'Dup' }]),
      );
      processor.processContributions(
        createToolDescription('tool-b', [{ id: 'cmd.dup', title: 'Dup B' }]),
      );

      // Only first registration should remain
      expect(processor.getContributedCommand('cmd.dup')!.toolId).toBe('tool-a');
    });

    it('fires onDidProcessCommands event', () => {
      let received: any = null;
      processor.onDidProcessCommands(e => { received = e; });

      processor.processContributions(
        createToolDescription('test-tool', [{ id: 'cmd.a', title: 'A' }]),
      );

      expect(received).toBeDefined();
      expect(received.toolId).toBe('test-tool');
      expect(received.commands).toHaveLength(1);
    });
  });

  // ── Proxy → Real Handler Replay ──

  describe('proxy handler and wireRealHandler', () => {
    it('queues invocations and replays when real handler is wired', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.test', title: 'Test' }]),
      );

      // Get the proxy handler registered in the mock command service
      const proxy = commandService.getHandler('cmd.test')!;
      expect(proxy).toBeDefined();

      // Invoke the proxy before real handler is wired
      const resultPromise = (proxy as any)({}, 'arg1', 'arg2');

      // Activation event should have been fired
      expect(activationEvents.getFiredCommands()).toContain('cmd.test');

      // Wire the real handler
      processor.wireRealHandler('cmd.test', (...args: unknown[]) => {
        return `result: ${args.join(',')}`;
      });

      // The queued invocation should have been replayed
      const result = await resultPromise;
      expect(result).toBe('result: arg1,arg2');
    });

    it('replays multiple queued invocations in order', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.multi', title: 'Multi' }]),
      );

      const proxy = commandService.getHandler('cmd.multi')!;
      const p1 = (proxy as any)({}, 'first');
      const p2 = (proxy as any)({}, 'second');
      const p3 = (proxy as any)({}, 'third');

      const results: string[] = [];
      processor.wireRealHandler('cmd.multi', (...args: unknown[]) => {
        const label = args[0] as string;
        results.push(label);
        return label;
      });

      expect(await p1).toBe('first');
      expect(await p2).toBe('second');
      expect(await p3).toBe('third');
      expect(results).toEqual(['first', 'second', 'third']);
    });

    it('calls real handler directly after it is wired', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.direct', title: 'Direct' }]),
      );

      processor.wireRealHandler('cmd.direct', () => 42);

      const proxy = commandService.getHandler('cmd.direct')!;
      const result = await (proxy as any)({});
      expect(result).toBe(42);
    });

    it('handles async real handlers correctly', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.async', title: 'Async' }]),
      );

      const proxy = commandService.getHandler('cmd.async')!;
      const resultPromise = (proxy as any)({}, 'input');

      processor.wireRealHandler('cmd.async', async (arg: string) => {
        return `async: ${arg}`;
      });

      expect(await resultPromise).toBe('async: input');
    });

    it('propagates synchronous errors from real handler', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.err', title: 'Err' }]),
      );

      const proxy = commandService.getHandler('cmd.err')!;
      const resultPromise = (proxy as any)({});

      processor.wireRealHandler('cmd.err', () => {
        throw new Error('handler error');
      });

      await expect(resultPromise).rejects.toThrow('handler error');
    });
  });

  // ── Timeout ──

  describe('timeout', () => {
    it('rejects after 10s if real handler is not wired', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.timeout', title: 'Timeout' }]),
      );

      const proxy = commandService.getHandler('cmd.timeout')!;
      const resultPromise = (proxy as any)({});

      // Advance past the 10s timeout
      vi.advanceTimersByTime(10_001);

      await expect(resultPromise).rejects.toThrow('Timed out waiting for handler');
    });

    it('does not double-resolve after timeout + late wireRealHandler', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.late', title: 'Late' }]),
      );

      const proxy = commandService.getHandler('cmd.late')!;
      const resultPromise = (proxy as any)({});

      vi.advanceTimersByTime(10_001);
      await expect(resultPromise).rejects.toThrow('Timed out');

      // Late wiring should not cause errors — queue was already spliced
      expect(() => processor.wireRealHandler('cmd.late', () => 'late')).not.toThrow();
    });
  });

  // ── Deactivation (removeContributions) ──

  describe('removeContributions', () => {
    it('rejects pending invocations when tool is deactivated', async () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.deact', title: 'Deact' }]),
      );

      const proxy = commandService.getHandler('cmd.deact')!;
      const p1 = (proxy as any)({}, 'a');
      const p2 = (proxy as any)({}, 'b');

      processor.removeContributions('tool');

      await expect(p1).rejects.toThrow('was deactivated');
      await expect(p2).rejects.toThrow('was deactivated');
    });

    it('removes contributed command records', () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.rm', title: 'Rm' }]),
      );

      expect(processor.isContributed('cmd.rm')).toBe(true);
      processor.removeContributions('tool');
      expect(processor.isContributed('cmd.rm')).toBe(false);
    });

    it('fires onDidRemoveCommands event', () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.evt', title: 'Evt' }]),
      );

      let received: any = null;
      processor.onDidRemoveCommands(e => { received = e; });
      processor.removeContributions('tool');

      expect(received).toBeDefined();
      expect(received.toolId).toBe('tool');
      expect(received.commandIds).toContain('cmd.evt');
    });
  });

  // ── Queries ──

  describe('queries', () => {
    it('getContributedCommandsForTool returns only that tool commands', () => {
      processor.processContributions(
        createToolDescription('tool-a', [{ id: 'a.cmd', title: 'A' }]),
      );
      processor.processContributions(
        createToolDescription('tool-b', [{ id: 'b.cmd', title: 'B' }]),
      );

      const toolACmds = processor.getContributedCommandsForTool('tool-a');
      expect(toolACmds).toHaveLength(1);
      expect(toolACmds[0].commandId).toBe('a.cmd');
    });

    it('getContributedCommand returns metadata', () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.meta', title: 'Meta Cmd' }]),
      );

      const cmd = processor.getContributedCommand('cmd.meta');
      expect(cmd).toBeDefined();
      expect(cmd!.title).toBe('Meta Cmd');
      expect(cmd!.toolId).toBe('tool');
      expect(cmd!.handlerWired).toBe(false);
    });

    it('handlerWired is set to true after wireRealHandler', () => {
      processor.processContributions(
        createToolDescription('tool', [{ id: 'cmd.wired', title: 'Wired' }]),
      );

      expect(processor.getContributedCommand('cmd.wired')!.handlerWired).toBe(false);
      processor.wireRealHandler('cmd.wired', () => {});
      expect(processor.getContributedCommand('cmd.wired')!.handlerWired).toBe(true);
    });
  });
});
