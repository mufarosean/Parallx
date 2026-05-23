/**
 * Unit tests for ContributionRegistry (M81 Slice B).
 *
 * Verifies the unified contribution orchestrator:
 *  - fans processContributions out to all four processors in order
 *  - fans removeContributions out to all four processors in order
 *  - isolates errors: one throwing processor does not block the others
 *  - dispose() prevents further fan-out
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { ContributionRegistry } from '../../src/contributions/contributionRegistry';
import type { CommandContributionProcessor } from '../../src/contributions/commandContribution';
import type { KeybindingContributionProcessor } from '../../src/contributions/keybindingContribution';
import type { MenuContributionProcessor } from '../../src/contributions/menuContribution';
import type { ViewContributionProcessor } from '../../src/contributions/viewContribution';
import type { IToolDescription } from '../../src/tools/toolManifest';

interface FakeProcessor {
  label: string;
  processCalls: IToolDescription[];
  removeCalls: string[];
  throwOnProcess: boolean;
  throwOnRemove: boolean;
  processContributions(desc: IToolDescription): void;
  removeContributions(toolId: string): void;
  dispose(): void;
}

function makeProcessor(label: string): FakeProcessor {
  const p: FakeProcessor = {
    label,
    processCalls: [],
    removeCalls: [],
    throwOnProcess: false,
    throwOnRemove: false,
    processContributions(desc) {
      if (p.throwOnProcess) throw new Error(`${label} process boom`);
      p.processCalls.push(desc);
    },
    removeContributions(toolId) {
      if (p.throwOnRemove) throw new Error(`${label} remove boom`);
      p.removeCalls.push(toolId);
    },
    dispose() { /* no-op */ },
  };
  return p;
}

function makeDesc(toolId: string): IToolDescription {
  return { manifest: { id: toolId } } as unknown as IToolDescription;
}

describe('ContributionRegistry', () => {
  let cmd: FakeProcessor;
  let kb: FakeProcessor;
  let menu: FakeProcessor;
  let view: FakeProcessor;
  let order: string[];
  let registry: ContributionRegistry;

  beforeEach(() => {
    cmd = makeProcessor('cmd');
    kb = makeProcessor('kb');
    menu = makeProcessor('menu');
    view = makeProcessor('view');

    // Record call order across all processors
    order = [];
    for (const p of [cmd, kb, menu, view]) {
      const origProc = p.processContributions.bind(p);
      p.processContributions = (desc) => { order.push(`process:${p.label}`); origProc(desc); };
      const origRem = p.removeContributions.bind(p);
      p.removeContributions = (id) => { order.push(`remove:${p.label}`); origRem(id); };
    }

    registry = new ContributionRegistry(
      cmd as unknown as CommandContributionProcessor,
      kb as unknown as KeybindingContributionProcessor,
      menu as unknown as MenuContributionProcessor,
      view as unknown as ViewContributionProcessor,
    );
  });

  afterEach(() => {
    registry.dispose();
  });

  it('processContributions calls all four processors with the same description, in order', () => {
    const desc = makeDesc('alpha');
    registry.processContributions(desc);

    expect(cmd.processCalls).toEqual([desc]);
    expect(kb.processCalls).toEqual([desc]);
    expect(menu.processCalls).toEqual([desc]);
    expect(view.processCalls).toEqual([desc]);
    expect(order).toEqual([
      'process:cmd', 'process:kb', 'process:menu', 'process:view',
    ]);
  });

  it('removeContributions calls all four processors with the same toolId, in order', () => {
    registry.removeContributions('beta');

    expect(cmd.removeCalls).toEqual(['beta']);
    expect(kb.removeCalls).toEqual(['beta']);
    expect(menu.removeCalls).toEqual(['beta']);
    expect(view.removeCalls).toEqual(['beta']);
    expect(order).toEqual([
      'remove:cmd', 'remove:kb', 'remove:menu', 'remove:view',
    ]);
  });

  it('isolates errors: a throwing processContributions does not block the others', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    kb.throwOnProcess = true;
    const desc = makeDesc('gamma');

    expect(() => registry.processContributions(desc)).not.toThrow();

    // cmd, menu, and view still received the call; kb is the one that threw.
    expect(cmd.processCalls).toEqual([desc]);
    expect(menu.processCalls).toEqual([desc]);
    expect(view.processCalls).toEqual([desc]);
    expect(kb.processCalls).toEqual([]);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('isolates errors: a throwing removeContributions does not block the others', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    menu.throwOnRemove = true;

    expect(() => registry.removeContributions('delta')).not.toThrow();

    expect(cmd.removeCalls).toEqual(['delta']);
    expect(kb.removeCalls).toEqual(['delta']);
    expect(view.removeCalls).toEqual(['delta']);
    expect(menu.removeCalls).toEqual([]);
    expect(errSpy).toHaveBeenCalled();

    errSpy.mockRestore();
  });

  it('dispose() prevents further fan-out', () => {
    registry.dispose();
    registry.processContributions(makeDesc('epsilon'));
    registry.removeContributions('epsilon');

    expect(cmd.processCalls).toEqual([]);
    expect(kb.processCalls).toEqual([]);
    expect(menu.processCalls).toEqual([]);
    expect(view.processCalls).toEqual([]);
    expect(cmd.removeCalls).toEqual([]);
    expect(kb.removeCalls).toEqual([]);
    expect(menu.removeCalls).toEqual([]);
    expect(view.removeCalls).toEqual([]);
  });
});
