/**
 * Pin-the-invariant: ContributionRegistry per-processor try/catch isolation (M81 Slice B).
 *
 * The unified ContributionRegistry orchestrator wraps each per-processor
 * `processContributions` / `removeContributions` call in its own try/catch
 * (see src/contributions/contributionRegistry.ts). The audit's Landmine #1
 * required that one failing processor MUST NOT prevent the remaining
 * processors from running.
 *
 * This test guards that invariant against silent regression: if a future
 * refactor merges the per-processor try/catch blocks into a single outer
 * try/catch, or removes them entirely, these tests fail.
 *
 * It also covers the M82 follow-on processors (chat-participant, canvas
 * block-type), which inherit the same isolation contract per
 * docs/Parallx_Milestone_82.md §11 "Failure behavior" preservation row.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ContributionRegistry } from '../../src/contributions/contributionRegistry';
import type { IToolDescription } from '../../src/tools/toolManifest';

function makeDescription(toolId: string): IToolDescription {
  return {
    manifest: { id: toolId, displayName: toolId, version: '0.0.1' },
    toolPath: `/virtual/${toolId}`,
    isBuiltin: false,
  } as any;
}

function makeProcessor(opts: { throwOnProcess?: boolean; throwOnRemove?: boolean } = {}) {
  const proc = {
    processContributions: vi.fn((_d: IToolDescription) => {
      if (opts.throwOnProcess) throw new Error('boom-process');
    }),
    removeContributions: vi.fn((_id: string) => {
      if (opts.throwOnRemove) throw new Error('boom-remove');
    }),
  };
  return proc;
}

describe('ContributionRegistry per-processor try/catch isolation (M81 Slice B)', () => {
  let errSpy: any;

  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('a throwing command processor does NOT prevent keybinding/menu/view from running', () => {
    const command = makeProcessor({ throwOnProcess: true });
    const keybinding = makeProcessor();
    const menu = makeProcessor();
    const view = makeProcessor();

    const reg = new ContributionRegistry(
      command as any,
      keybinding as any,
      menu as any,
      view as any,
    );

    expect(() => reg.processContributions(makeDescription('tool.x'))).not.toThrow();

    expect(command.processContributions).toHaveBeenCalledTimes(1);
    expect(keybinding.processContributions).toHaveBeenCalledTimes(1);
    expect(menu.processContributions).toHaveBeenCalledTimes(1);
    expect(view.processContributions).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[ContributionRegistry] command processContributions failed for tool',
      'tool.x',
      expect.any(Error),
    );
  });

  it('a throwing menu processor still lets the view processor run', () => {
    const command = makeProcessor();
    const keybinding = makeProcessor();
    const menu = makeProcessor({ throwOnProcess: true });
    const view = makeProcessor();

    const reg = new ContributionRegistry(
      command as any,
      keybinding as any,
      menu as any,
      view as any,
    );

    reg.processContributions(makeDescription('tool.y'));

    expect(view.processContributions).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[ContributionRegistry] menu processContributions failed for tool',
      'tool.y',
      expect.any(Error),
    );
  });

  it('M82 chat-participant + canvas-block-type processors share the same isolation', () => {
    const command = makeProcessor();
    const keybinding = makeProcessor();
    const menu = makeProcessor();
    const view = makeProcessor();
    const chat = makeProcessor({ throwOnProcess: true });
    const canvasBlock = makeProcessor();

    const reg = new ContributionRegistry(
      command as any,
      keybinding as any,
      menu as any,
      view as any,
      chat as any,
      canvasBlock as any,
    );

    expect(() => reg.processContributions(makeDescription('tool.z'))).not.toThrow();

    // chat threw but canvas-block-type STILL ran
    expect(chat.processContributions).toHaveBeenCalledTimes(1);
    expect(canvasBlock.processContributions).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[ContributionRegistry] chat-participant processContributions failed for tool',
      'tool.z',
      expect.any(Error),
    );
  });

  it('a throwing canvas-block-type processor does not bubble', () => {
    const command = makeProcessor();
    const keybinding = makeProcessor();
    const menu = makeProcessor();
    const view = makeProcessor();
    const chat = makeProcessor();
    const canvasBlock = makeProcessor({ throwOnProcess: true });

    const reg = new ContributionRegistry(
      command as any,
      keybinding as any,
      menu as any,
      view as any,
      chat as any,
      canvasBlock as any,
    );

    expect(() => reg.processContributions(makeDescription('tool.cb'))).not.toThrow();
    expect(chat.processContributions).toHaveBeenCalledTimes(1);
    expect(canvasBlock.processContributions).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledWith(
      '[ContributionRegistry] canvas-block-type processContributions failed for tool',
      'tool.cb',
      expect.any(Error),
    );
  });

  it('removeContributions isolates throws across every processor in order', () => {
    const command = makeProcessor({ throwOnRemove: true });
    const keybinding = makeProcessor({ throwOnRemove: true });
    const menu = makeProcessor();
    const view = makeProcessor({ throwOnRemove: true });
    const chat = makeProcessor();
    const canvasBlock = makeProcessor({ throwOnRemove: true });

    const reg = new ContributionRegistry(
      command as any,
      keybinding as any,
      menu as any,
      view as any,
      chat as any,
      canvasBlock as any,
    );

    expect(() => reg.removeContributions('tool.r')).not.toThrow();

    expect(command.removeContributions).toHaveBeenCalledTimes(1);
    expect(keybinding.removeContributions).toHaveBeenCalledTimes(1);
    expect(menu.removeContributions).toHaveBeenCalledTimes(1);
    expect(view.removeContributions).toHaveBeenCalledTimes(1);
    expect(chat.removeContributions).toHaveBeenCalledTimes(1);
    expect(canvasBlock.removeContributions).toHaveBeenCalledTimes(1);

    // 4 throws → 4 error logs
    const errorMessages = errSpy.mock.calls.map((c: any[]) => c[0]);
    expect(errorMessages).toContain('[ContributionRegistry] command removeContributions failed for tool');
    expect(errorMessages).toContain('[ContributionRegistry] keybinding removeContributions failed for tool');
    expect(errorMessages).toContain('[ContributionRegistry] view removeContributions failed for tool');
    expect(errorMessages).toContain('[ContributionRegistry] canvas-block-type removeContributions failed for tool');
  });

  it('once disposed, processContributions and removeContributions are no-ops', () => {
    const command = makeProcessor();
    const keybinding = makeProcessor();
    const menu = makeProcessor();
    const view = makeProcessor();

    const reg = new ContributionRegistry(
      command as any,
      keybinding as any,
      menu as any,
      view as any,
    );

    reg.dispose();

    reg.processContributions(makeDescription('tool.after-dispose'));
    reg.removeContributions('tool.after-dispose');

    expect(command.processContributions).not.toHaveBeenCalled();
    expect(command.removeContributions).not.toHaveBeenCalled();
    expect(view.processContributions).not.toHaveBeenCalled();
  });

  it('optional M82 processors are skipped entirely when not provided (no spurious calls, no throws)', () => {
    const command = makeProcessor();
    const keybinding = makeProcessor();
    const menu = makeProcessor();
    const view = makeProcessor();

    const reg = new ContributionRegistry(
      command as any,
      keybinding as any,
      menu as any,
      view as any,
      // chat + canvasBlock intentionally omitted
    );

    expect(() => reg.processContributions(makeDescription('tool.q'))).not.toThrow();
    expect(() => reg.removeContributions('tool.q')).not.toThrow();
    expect(command.processContributions).toHaveBeenCalledTimes(1);
    expect(view.processContributions).toHaveBeenCalledTimes(1);
  });
});
