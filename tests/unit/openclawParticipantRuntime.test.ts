import { describe, expect, it } from 'vitest';

import {
  buildOpenclawBootstrapContext,
  loadOpenclawBootstrapEntries,
  type IOpenclawBootstrapEntry,
} from '../../src/openclaw/participants/openclawParticipantRuntime';

// ── M85 Slice D: the memory INDEX is guaranteed context every turn ──────────

describe('loadOpenclawBootstrapEntries — memory index guarantee', () => {
  it('loads the canonical .parallx/memory/MEMORY.md index', async () => {
    const files = new Map<string, string>([
      ['.parallx/memory/MEMORY.md', '# Memory Index\n- [Lesson](lessons/a.md) — a lesson'],
    ]);
    const entries = await loadOpenclawBootstrapEntries(async (p) => files.get(p) ?? null);
    const memory = entries.find((e) => e.name === '.parallx/memory/MEMORY.md');
    expect(memory).toBeDefined();
    expect(memory!.missing).toBe(false);
    expect(memory!.content).toContain('Memory Index');
  });

  it('falls back to a legacy root MEMORY.md when the canonical index is absent', async () => {
    const files = new Map<string, string>([['MEMORY.md', 'legacy root index']]);
    const entries = await loadOpenclawBootstrapEntries(async (p) => files.get(p) ?? null);
    const memory = entries.find((e) => e.name === 'MEMORY.md');
    expect(memory?.content).toBe('legacy root index');
  });

  it('prefers the canonical index over the legacy root file', async () => {
    const files = new Map<string, string>([
      ['.parallx/memory/MEMORY.md', 'canonical'],
      ['MEMORY.md', 'legacy'],
    ]);
    const entries = await loadOpenclawBootstrapEntries(async (p) => files.get(p) ?? null);
    expect(entries.some((e) => e.content === 'canonical')).toBe(true);
    expect(entries.some((e) => e.content === 'legacy')).toBe(false);
  });

  it('adds no memory entry when no index exists anywhere', async () => {
    const entries = await loadOpenclawBootstrapEntries(async () => null);
    expect(entries.some((e) => e.name.toLowerCase().includes('memory'))).toBe(false);
  });
});

describe('openclawParticipantRuntime bootstrap accounting', () => {
  it('keeps missing markers and reports raw vs injected sizes', () => {
    const result = buildOpenclawBootstrapContext([
      { name: 'AGENTS.md', path: 'AGENTS.md', content: 'alpha', missing: false },
      { name: 'SOUL.md', path: 'SOUL.md', missing: true },
    ] satisfies IOpenclawBootstrapEntry[]);

    expect(result.sections[0]).toContain('[AGENTS.md]');
    expect(result.sections[1]).toContain('[MISSING] Expected at: SOUL.md');
    expect(result.debug.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'AGENTS.md', rawChars: 5, injectedChars: 5, truncated: false }),
      expect.objectContaining({ name: 'SOUL.md', missing: true, rawChars: 0, injectedChars: expect.any(Number) }),
    ]));
    expect(result.debug.totalRawChars).toBe(5);
    expect(result.debug.totalInjectedChars).toBe(5);
  });

  it('truncates oversized bootstrap content using OpenClaw-style limits', () => {
    const long = `HEAD-${'a'.repeat(600)}${'b'.repeat(300)}-TAIL`;
    const result = buildOpenclawBootstrapContext([
      { name: 'TOOLS.md', path: 'TOOLS.md', content: long, missing: false },
    ], {
      maxChars: 200,
      totalMaxChars: 500,
    });

    expect(result.sections[0]).toContain('[...truncated, read TOOLS.md for full content...]');
    expect(result.debug.files[0]).toMatchObject({
      name: 'TOOLS.md',
      truncated: true,
      rawChars: long.trim().length,
    });
    expect(result.debug.files[0].causes).toContain('per-file-limit');
    expect(result.debug.warningLines[0]).toContain('TOOLS.md');
  });
});