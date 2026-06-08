import { describe, expect, it } from 'vitest';

import { reviewForSharing, makeArtifact, hashContent } from '../../src/openclaw/commons/federatedArtifact';

let n = 0;
const genId = () => `a${++n}`;

describe('sovereignty firewall — reviewForSharing (the privacy boundary)', () => {
  it('allows a generic, non-personal pattern', () => {
    const r = reviewForSharing('After editing a source file, its test file is often edited next.');
    expect(r.allowed).toBe(true);
  });

  it('blocks a Windows file path', () => {
    expect(reviewForSharing('look at C:\\Users\\bob\\notes.md').allowed).toBe(false);
  });

  it('blocks a unix home path', () => {
    expect(reviewForSharing('the file ~/Documents/taxes.pdf').allowed).toBe(false);
  });

  it('blocks an email address', () => {
    expect(reviewForSharing('contact alice@example.com about it').allowed).toBe(false);
  });

  it('blocks references to the specific user', () => {
    expect(reviewForSharing('The user works on design every morning').allowed).toBe(false);
    expect(reviewForSharing('my budget is tight this month').allowed).toBe(false);
  });

  it('blocks a specific date and long unique tokens', () => {
    expect(reviewForSharing('met on 2026-06-07').allowed).toBe(false);
    expect(reviewForSharing('key abcdef0123456789abcdef0123456789xyz').allowed).toBe(false);
  });

  it('blocks over-long content (likely specific, not generic)', () => {
    expect(reviewForSharing('x'.repeat(300)).allowed).toBe(false);
  });

  it('blocks empty content', () => {
    expect(reviewForSharing('   ').allowed).toBe(false);
  });
});

describe('makeArtifact — the single chokepoint to the wire', () => {
  it('produces an artifact only when the firewall allows', () => {
    const out = makeArtifact('Linters usually run faster with a warm cache.', 'peer-xyz', 1000, genId);
    expect('artifact' in out).toBe(true);
    if ('artifact' in out) {
      expect(out.artifact.content).toContain('warm cache');
      expect(out.artifact.originId).toBe('peer-xyz');
      expect(out.artifact.provenanceHash).toBe(hashContent('Linters usually run faster with a warm cache.'));
      // crucially — no personal field exists on the artifact at all
      expect(Object.keys(out.artifact).sort()).toEqual(['content', 'createdMs', 'id', 'kind', 'originId', 'provenanceHash']);
    }
  });

  it('refuses to build an artifact from personal content (nothing crosses)', () => {
    const out = makeArtifact('The user lives at C:\\Users\\bob', 'peer-xyz', 1000, genId);
    expect('rejected' in out).toBe(true);
    if ('rejected' in out) expect(out.rejected.allowed).toBe(false);
  });
});
