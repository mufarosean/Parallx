// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildSandboxDocument,
  createSandboxFrame,
  collectThemeVars,
  SANDBOX_CSP,
} from '../../src/built-in/dashboard/widgets/sandboxedHtml';

describe('buildSandboxDocument — CSP & shell', () => {
  it('embeds the strict CSP meta', () => {
    const doc = buildSandboxDocument('<p>hi</p>', '');
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain(SANDBOX_CSP);
  });

  it('forbids all network egress (no connect/default beyond the allowlist)', () => {
    expect(SANDBOX_CSP).toContain("default-src 'none'");
    expect(SANDBOX_CSP).toContain("connect-src 'none'");
    // Images may only come from inline data/blob, never the network.
    expect(SANDBOX_CSP).toMatch(/img-src data: blob:/);
    expect(SANDBOX_CSP).not.toMatch(/img-src[^;]*https?:/);
    // No external scripts — inline only.
    expect(SANDBOX_CSP).not.toMatch(/script-src[^;]*https?:/);
  });

  it('drops the model HTML into the body verbatim', () => {
    const doc = buildSandboxDocument('<canvas id="chart"></canvas><script>draw()</script>', '');
    expect(doc).toContain('<canvas id="chart"></canvas><script>draw()</script>');
  });

  it('injects forwarded theme variables into :root', () => {
    const doc = buildSandboxDocument('<p>x</p>', '--px-accent: hsl(205 64% 60%); --px-text: #e8eaee;');
    expect(doc).toContain('--px-accent: hsl(205 64% 60%);');
    expect(doc).toContain('--px-text: #e8eaee;');
  });

  it('forces a dark base so the frame never falls back to a white canvas', () => {
    const doc = buildSandboxDocument('<p>x</p>', '');
    expect(doc).toContain('content="dark"');
    expect(doc).toContain('color-scheme: dark');
    expect(doc).toMatch(/html\s*\{[^}]*background:\s*var\(--px-bg/);
  });
});

describe('createSandboxFrame — the jail', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('sandboxes with allow-scripts but NEVER allow-same-origin', () => {
    // allow-scripts + allow-same-origin together would let the frame strip its
    // own sandbox — the one combination we must never emit.
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
    const { frame } = createSandboxFrame('<p>hi</p>');
    const sandbox = frame.getAttribute('sandbox') ?? '';
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  it('loads from a blob URL so it carries only our injected CSP', () => {
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
    const { frame } = createSandboxFrame('<p>hi</p>');
    expect(spy).toHaveBeenCalledOnce();
    expect(frame.getAttribute('src')).toBe('blob:stub');
    // The HTML blob must contain the CSP — confirm we wrapped it, not raw.
    const blob = spy.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('text/html');
  });

  it('revoke() releases the object URL', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stub');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { revoke } = createSandboxFrame('<p>hi</p>');
    revoke();
    expect(revokeSpy).toHaveBeenCalledWith('blob:stub');
  });

  it('falls back to srcdoc when createObjectURL is unavailable', () => {
    // @ts-expect-error — simulate an env without blob URLs.
    const original = URL.createObjectURL;
    // @ts-expect-error
    URL.createObjectURL = undefined;
    try {
      const { frame } = createSandboxFrame('<p>fallback</p>');
      expect(frame.getAttribute('src')).toBeNull();
      expect(frame.getAttribute('srcdoc')).toContain('<p>fallback</p>');
    } finally {
      URL.createObjectURL = original;
    }
  });
});

describe('collectThemeVars', () => {
  it('forwards --px tokens defined on :root', () => {
    document.documentElement.style.setProperty('--px-accent', '#abcdef');
    const vars = collectThemeVars(document);
    expect(vars).toContain('--px-accent: #abcdef;');
    document.documentElement.style.removeProperty('--px-accent');
  });
});
