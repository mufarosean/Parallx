// progressProviders.test.ts — the core's progress-provider seam.
//
// The registry (register, list, replace, dispose, onDidChange), what it
// refuses, the counts made safe to draw, the core command that hands the live
// registry to extensions, and that the seam names no tool.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  registerProgressProvider, listProgressProviders, onDidChangeProgressProviders,
  progressProviderRegistry, progressCounts, PROGRESS_STATES, type IProgressProvider,
} from '../../src/services/progressProviders.js';
import { progressGetRegistry } from '../../src/commands/progressCommands.js';
import { ALL_BUILTIN_COMMANDS } from '../../src/commands/structuralCommands.js';

function provider(id: string, extra: Partial<IProgressProvider> = {}): IProgressProvider {
  return {
    id, displayName: 'Drills', toolId: 'test.tool',
    words: { good: 'Crisp', middling: 'Shaky', poor: 'Blank', rest: 'Untried' },
    groups: async () => [],
    onDidChange: () => ({ dispose() { /* nothing held */ } }),
    ...extra,
  };
}

describe('progress provider registry', () => {
  it('registers, lists and disposes', () => {
    const d = registerProgressProvider(provider('a.one'));
    expect(listProgressProviders().map((p) => p.id)).toContain('a.one');
    d.dispose();
    expect(listProgressProviders().map((p) => p.id)).not.toContain('a.one');
  });

  it('fires onDidChange on register and on dispose, once each', () => {
    const fn = vi.fn();
    const sub = onDidChangeProgressProviders(fn);
    const d = registerProgressProvider(provider('a.two'));
    expect(fn).toHaveBeenCalledTimes(1);
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(2);
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(2);
    sub.dispose();
  });

  it('replaces a provider registered under the same id, with a warning, and keeps the replacement when the old one is disposed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = provider('a.three', { displayName: 'first' });
    const second = provider('a.three', { displayName: 'second' });
    const d1 = registerProgressProvider(first);
    const d2 = registerProgressProvider(second);
    expect(warn).toHaveBeenCalledOnce();
    expect(listProgressProviders().filter((p) => p.id === 'a.three')).toEqual([second]);
    d1.dispose();
    expect(listProgressProviders().filter((p) => p.id === 'a.three')).toEqual([second]);
    d2.dispose();
    expect(listProgressProviders().some((p) => p.id === 'a.three')).toBe(false);
    warn.mockRestore();
  });

  it('refuses a provider without an id, a groups() or an onDidChange', () => {
    const { id: _id, ...noId } = provider('x.y');
    const { groups: _groups, ...noGroups } = provider('a.four');
    const { onDidChange: _event, ...noEvent } = provider('a.five');
    expect(() => registerProgressProvider(noId as never)).toThrow();
    expect(() => registerProgressProvider(noGroups as never)).toThrow();
    expect(() => registerProgressProvider(noEvent as never)).toThrow();
    expect(listProgressProviders().some((p) => p.id === 'a.four' || p.id === 'a.five')).toBe(false);
  });

  it('keeps the four states in one order, best first', () => {
    expect(PROGRESS_STATES).toEqual(['good', 'middling', 'poor', 'rest']);
  });
});

describe('progressCounts', () => {
  it('gives good, middling, poor and the rest', () => {
    expect(progressCounts({ total: 10, good: 3, middling: 1, poor: 2 })).toEqual([3, 1, 2, 4]);
    expect(progressCounts({ total: 0, good: 0, middling: 0, poor: 0 })).toEqual([0, 0, 0, 0]);
  });

  it('never counts more than the total, below zero, or a part of an item', () => {
    expect(progressCounts({ total: 4, good: 3, middling: 3, poor: 3 })).toEqual([3, 1, 0, 0]);
    expect(progressCounts({ total: 5, good: -2, middling: 1.9, poor: Number.NaN })).toEqual([0, 1, 0, 4]);
    expect(progressCounts({ total: -1, good: 2, middling: 0, poor: 0 })).toEqual([0, 0, 0, 0]);
    expect(progressCounts({ total: '6', good: '2', middling: null, poor: undefined } as never)).toEqual([2, 0, 0, 4]);
  });
});

describe('progress.getRegistry', () => {
  it('is a core command', () => {
    const cmd = ALL_BUILTIN_COMMANDS.find((c) => c.id === 'progress.getRegistry');
    expect(cmd).toBe(progressGetRegistry);
  });

  it('returns the live registry', async () => {
    const ctx = { getService: () => undefined, workbench: {}, origin: 'ext:test' as const };
    const registry = await progressGetRegistry.handler(ctx as never) as typeof progressProviderRegistry;
    expect(registry).toBe(progressProviderRegistry);
    const fn = vi.fn();
    const sub = registry.onDidChange(fn);
    const d = registry.register(provider('b.one'));
    expect(fn).toHaveBeenCalledOnce();
    expect(listProgressProviders().map((p) => p.id)).toContain('b.one');
    expect(registry.list().map((p) => p.id)).toContain('b.one');
    d.dispose();
    sub.dispose();
  });
});

describe('the seam is the core\'s: it names no tool', () => {
  it('neither file mentions a tool that can be turned off', () => {
    for (const file of ['src/services/progressProviders.ts', 'src/commands/progressCommands.ts']) {
      const text = readFileSync(resolve(__dirname, '../..', file), 'utf8');
      expect(text, file).not.toMatch(/worksheet|flashcard|\bstudy\b|planner|atelier/i);
    }
  });
});
