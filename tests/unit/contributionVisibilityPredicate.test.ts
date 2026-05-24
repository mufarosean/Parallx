/**
 * Contribution visibility predicate (M81 §8 verification gate — closes §22 debt).
 *
 * Manifest M81 §8 listed `contributionVisibilityPredicate.test.ts` as a
 * required gate before Slice B merge. This file is that gate.
 *
 * Visibility predicates are how contributed commands hide from the
 * command palette when their `when` clause doesn't match the current
 * context. Without this guard the command palette could either:
 *   - show commands that should be hidden (security/UX leak), or
 *   - hide commands that should be shown (functional regression).
 *
 * Covers `MenuContributionProcessor.isCommandVisibleInPalette`:
 *   1. Unregistered commands default to visible.
 *   2. Commands without a `when` clause are visible.
 *   3. Commands whose `when` evaluates true are visible.
 *   4. Commands whose `when` evaluates false are hidden.
 *   5. Multiple palette entries OR together — any-true → visible.
 *   6. Missing context-key service falls back to visible (safe default).
 *   7. removeContributions hides the command again.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The processor imports its own CSS for context-menu styles. Stub it
// out so vitest can load the module without a CSS loader.
vi.mock('../../src/contributions/menuContribution.css', () => ({}));

import { MenuContributionProcessor } from '../../src/contributions/menuContribution';
import type { IToolDescription } from '../../src/tools/toolManifest';

function makeManifest(toolId: string, palette: { command: string; when?: string }[]): IToolDescription {
  return {
    manifest: {
      id: toolId,
      contributes: {
        menus: {
          commandPalette: palette,
        },
      },
    },
  } as unknown as IToolDescription;
}

function makeContextKeyService(rules: Record<string, boolean>) {
  return {
    contextMatchesRules(when: string | undefined): boolean {
      if (!when) return true;
      // Very small evaluator covering the cases this test uses:
      // bare key, `!key`, `a && b`, `a || b`.
      const tryAnd = when.split('&&').map((s) => s.trim());
      if (tryAnd.length > 1) {
        return tryAnd.every((part) => this.contextMatchesRules(part));
      }
      const tryOr = when.split('||').map((s) => s.trim());
      if (tryOr.length > 1) {
        return tryOr.some((part) => this.contextMatchesRules(part));
      }
      if (when.startsWith('!')) return !rules[when.slice(1).trim()];
      return Boolean(rules[when]);
    },
  };
}

describe('MenuContributionProcessor — commandPalette visibility predicate', () => {
  let processor: MenuContributionProcessor;

  beforeEach(() => {
    // CommandService is unused by the visibility predicate. Pass a
    // minimal shape to satisfy the constructor.
    processor = new MenuContributionProcessor({} as never);
  });

  it('unregistered command is visible by default', () => {
    expect(processor.isCommandVisibleInPalette('never.registered')).toBe(true);
  });

  it('registered command without a when clause is visible', () => {
    processor.processContributions(makeManifest('tool.a', [{ command: 'cmd.alwaysShow' }]));
    processor.setContextKeyService(makeContextKeyService({}));
    expect(processor.isCommandVisibleInPalette('cmd.alwaysShow')).toBe(true);
  });

  it('hides when when-clause evaluates to false', () => {
    processor.processContributions(makeManifest('tool.a', [{ command: 'cmd.x', when: 'visible' }]));
    processor.setContextKeyService(makeContextKeyService({ visible: false }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(false);
  });

  it('shows when when-clause evaluates to true', () => {
    processor.processContributions(makeManifest('tool.a', [{ command: 'cmd.x', when: 'visible' }]));
    processor.setContextKeyService(makeContextKeyService({ visible: true }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(true);
  });

  it('multiple palette entries OR together (any-true → visible)', () => {
    processor.processContributions(
      makeManifest('tool.a', [
        { command: 'cmd.x', when: 'modeA' },
        { command: 'cmd.x', when: 'modeB' },
      ]),
    );
    processor.setContextKeyService(makeContextKeyService({ modeA: false, modeB: true }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(true);
  });

  it('multiple palette entries all-false → hidden', () => {
    processor.processContributions(
      makeManifest('tool.a', [
        { command: 'cmd.x', when: 'modeA' },
        { command: 'cmd.x', when: 'modeB' },
      ]),
    );
    processor.setContextKeyService(makeContextKeyService({ modeA: false, modeB: false }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(false);
  });

  it('no context-key service → falls back to visible (safe default)', () => {
    processor.processContributions(makeManifest('tool.a', [{ command: 'cmd.x', when: 'visible' }]));
    // Intentionally do NOT call setContextKeyService.
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(true);
  });

  it('removeContributions restores visible-by-default (no registered entries)', () => {
    processor.processContributions(makeManifest('tool.a', [{ command: 'cmd.x', when: 'visible' }]));
    processor.setContextKeyService(makeContextKeyService({ visible: false }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(false);
    processor.removeContributions('tool.a');
    // With no palette entries, the predicate's "unregistered" path returns true.
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(true);
  });

  it('one negated and one true → visible', () => {
    processor.processContributions(
      makeManifest('tool.a', [
        { command: 'cmd.x', when: '!hidden' },
      ]),
    );
    processor.setContextKeyService(makeContextKeyService({ hidden: false }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(true);
  });

  it('compound and: both true → visible, one false → hidden', () => {
    processor.processContributions(
      makeManifest('tool.a', [
        { command: 'cmd.x', when: 'a && b' },
      ]),
    );
    processor.setContextKeyService(makeContextKeyService({ a: true, b: true }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(true);
    processor.setContextKeyService(makeContextKeyService({ a: true, b: false }));
    expect(processor.isCommandVisibleInPalette('cmd.x')).toBe(false);
  });
});
