import { describe, expect, it } from 'vitest';

import {
  buildOpenclawBootstrapContext,
  type IOpenclawBootstrapEntry,
} from '../../src/openclaw/participants/openclawParticipantRuntime';

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