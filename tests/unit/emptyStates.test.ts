// @vitest-environment jsdom
// emptyStates.test.ts — M89 S2: the voice registry and its rules.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { globSync } from 'glob';
import { EMPTY_STATES, renderEmptyState, type EmptyStateId } from '../../src/ui/emptyStates';

const ROOT = resolve(__dirname, '../..');
const entries = Object.values(EMPTY_STATES);

describe('empty-state voice rules (M89 S2)', () => {
  it('headlines are warm and brief: ≤ 6 words, no terminal period, no anti-voice', () => {
    for (const e of entries) {
      expect(e.headline.split(/\s+/).length, `${e.id} headline too long`).toBeLessThanOrEqual(6);
      expect(e.headline.endsWith('.'), `${e.id} headline ends with a period`).toBe(false);
      expect(/nothing here|no data|n\/a/i.test(e.headline), `${e.id} uses anti-voice`).toBe(false);
    }
  });

  it('every hint names a next action or explains what will happen', () => {
    // A hint must contain a concrete verb/reference the user can act on.
    const actionable = /(press|click|ask|try|capture|create|switch|nest|say|check back|appear here|plan|search covers)/i;
    for (const e of entries) {
      expect(actionable.test(e.hint), `${e.id} hint names no action: "${e.hint}"`).toBe(true);
      expect(e.hint.length, `${e.id} hint too long`).toBeLessThanOrEqual(160);
    }
  });

  it('ids are unique and match their keys', () => {
    for (const [key, e] of Object.entries(EMPTY_STATES)) {
      expect(e.id).toBe(key);
    }
  });

  it('renderEmptyState builds the standard hero', () => {
    const el = renderEmptyState('planner.day' as EmptyStateId);
    expect(el.className).toBe('px-empty');
    expect(el.querySelector('.px-empty__headline')?.textContent).toBe(EMPTY_STATES['planner.day'].headline);
    expect(el.querySelector('.px-empty__hint')?.textContent).toBe(EMPTY_STATES['planner.day'].hint);
    expect(el.dataset.emptyStateId).toBe('planner.day');
  });
});

describe('anti-voice canary — flat copy stays out of built-in surfaces', () => {
  it('no "Nothing here" / "No data" in built-in TS', () => {
    const files = globSync('src/built-in/**/*.ts', { cwd: ROOT });
    const violations: string[] = [];
    for (const f of files) {
      const src = readFileSync(resolve(ROOT, f), 'utf8');
      // UI copy only — tool-result strings for the model are exempt, and
      // "No data" must not match "No databases".
      const m = /'(Nothing here[^']*|No data(?![a-z])[^']*)'/.exec(src);
      if (m) violations.push(`${f}: ${m[1]}`);
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
