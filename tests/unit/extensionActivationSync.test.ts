/**
 * Extension-activation synchronous baseline (M82 §8).
 *
 * Measures the synchronous cost of `ContributionRegistry.processContributions()`
 * across N mock tools using fake processors that do constant trivial work.
 * This is a SYNCHRONOUS PROXY for the H15 extension-activation hop: it does
 * NOT measure async `tool.activate()`, module loading, or DB work — those
 * require an Electron probe and are out of M82 scope (see
 * `docs/research/baselines/workbench-baseline.md` §5).
 *
 * Purpose: record a pre-M82 baseline number, then assert that adding the M82
 * chat-participant and canvas-block contribution processors does not regress
 * synchronous contribution processing beyond +5%.
 *
 * Reports the measured duration via `console.log` so the CI log captures it.
 * The numeric upper bound is set loosely — this test asserts shape, not
 * absolute speed (CI hardware varies). The M82 closeout comparison reads the
 * console output from this commit's CI run as the baseline-N.
 */

import { describe, expect, it } from 'vitest';
import { ContributionRegistry } from '../../src/contributions/contributionRegistry';
import type { CommandContributionProcessor } from '../../src/contributions/commandContribution';
import type { KeybindingContributionProcessor } from '../../src/contributions/keybindingContribution';
import type { MenuContributionProcessor } from '../../src/contributions/menuContribution';
import type { ViewContributionProcessor } from '../../src/contributions/viewContribution';
import type { IToolDescription } from '../../src/tools/toolManifest';

function makeNoopProcessor() {
  return {
    processContributions(_desc: IToolDescription) { /* constant work */ },
    removeContributions(_toolId: string) { /* constant work */ },
    dispose() { /* no-op */ },
  };
}

function makeDesc(toolId: string): IToolDescription {
  return {
    manifest: {
      id: toolId,
      contributes: {
        commands: [{ id: `${toolId}.cmd`, title: 'X' }],
      },
    },
  } as unknown as IToolDescription;
}

describe('M82 baseline — ContributionRegistry.processContributions sync cost', () => {
  it('records synchronous cost for 14 mock tools (baseline-N)', () => {
    const cmd = makeNoopProcessor();
    const kb = makeNoopProcessor();
    const menu = makeNoopProcessor();
    const view = makeNoopProcessor();

    const registry = new ContributionRegistry(
      cmd as unknown as CommandContributionProcessor,
      kb as unknown as KeybindingContributionProcessor,
      menu as unknown as MenuContributionProcessor,
      view as unknown as ViewContributionProcessor,
    );

    // 14 mock tools — same shape as Parallx's built-in count today.
    const descs: IToolDescription[] = [];
    for (let i = 0; i < 14; i++) descs.push(makeDesc(`tool.${i}`));

    // Warmup
    for (const d of descs) registry.processContributions(d);

    const iters = 200;
    const start = performance.now();
    for (let n = 0; n < iters; n++) {
      for (const d of descs) registry.processContributions(d);
    }
    const total = performance.now() - start;
    const perCallNs = (total / (iters * descs.length)) * 1e6;

    // eslint-disable-next-line no-console
    console.log(
      `[M82-baseline] processContributions: ${iters} iters x ${descs.length} tools = `
      + `${total.toFixed(2)} ms total, ${perCallNs.toFixed(0)} ns/call`,
    );

    // Loose upper bound — this is a shape assertion, not a speed assertion.
    // Per-call must be under 100 microseconds on any reasonable hardware
    // even with two more processors added in M82.
    expect(perCallNs).toBeLessThan(100_000); // 100us

    registry.dispose();
  });
});
