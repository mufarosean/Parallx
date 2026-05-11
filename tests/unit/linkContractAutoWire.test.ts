// linkContractAutoWire.test.ts — M66 Iteration A guardrail.
//
// The whole point of M66 is that any future extension can ship a brand-new
// cite-able resource just by calling `parallx.links.register(...)`. No core
// branches, no per-extension UI changes, no per-extension prompt edits.
//
// This test simulates a synthetic `fake-ext` that registers a contract, then
// asserts the contract is discoverable via the workbench-shared registry and
// that `open()` correctly dispatches to its handler. Prompt-builder inclusion
// (the AI sees the new URI template in the system prompt automatically) is
// deferred to Iteration C.

import { describe, it, expect, vi } from 'vitest';
import { LinkResolverService, type LinkContract } from '../../src/links/linkResolverService.js';
import type { ParsedLink } from '../../src/links/parallxUri.js';
import {
  buildLinkingSection,
  type IOpenclawLinkContractDescriptor,
} from '../../src/openclaw/openclawSystemPrompt.js';

describe('M66 link contract — auto-wire guardrail', () => {
  it('a synthetic extension can register, dispatch, and unregister with zero core changes', async () => {
    const svc = new LinkResolverService();

    // Simulate the extension activating and registering its contract.
    const openSpy = vi.fn(async (_parsed: ParsedLink) => true);
    const metaSpy = vi.fn(async () => ({ title: 'Fake thing 7', icon: '🧪' }));
    const contract: LinkContract = {
      segment: 'fake-ext',
      displayName: 'Fake Extension',
      extensionId: 'fake-ext',
      kinds: {
        thing: {
          uriTemplate: 'parallx://fake-ext/thing/<id>',
          description: 'Open a synthetic thing.',
          examples: ['parallx://fake-ext/thing/7'],
          open: openSpy,
          resolveMetadata: metaSpy,
        },
      },
    };
    const disposable = svc.register(contract);

    // The registry must now expose this contract via the same surface that
    // future consumers (prompt builder, canvas chips, parallx_link tool)
    // read from. No special-casing for built-ins.
    expect(svc.allContracts().some((c) => c.segment === 'fake-ext')).toBe(true);

    // Calling open() with the documented URI shape must reach the handler
    // with the exact ParsedLink contract the handler was authored against.
    const ok = await svc.open('parallx://fake-ext/thing/7');
    expect(ok).toBe(true);
    expect(openSpy).toHaveBeenCalledOnce();
    const parsed = openSpy.mock.calls[0][0];
    expect(parsed.segment).toBe('fake-ext');
    expect(parsed.kind).toBe('thing');
    expect(parsed.pathSegments).toEqual(['thing', '7']);

    // Metadata path also wired automatically — no extra registration needed.
    const md = await svc.resolveMetadata('parallx://fake-ext/thing/7');
    expect(md).toEqual({ title: 'Fake thing 7', icon: '🧪' });

    // Disposing the registration removes the contract — the extension can
    // unload cleanly without leaking entries into the registry.
    disposable.dispose();
    expect(svc.allContracts().some((c) => c.segment === 'fake-ext')).toBe(false);
    const okAfter = await svc.open('parallx://fake-ext/thing/7');
    expect(okAfter).toBe(false);
  });

  it('Iter C — buildLinkingSection emits every registered URI template with zero per-extension branches', () => {
    const contracts: readonly IOpenclawLinkContractDescriptor[] = [
      {
        segment: 'fake-ext',
        displayName: 'Fake Extension',
        extensionId: 'fake-ext',
        kinds: [
          {
            kind: 'thing',
            uriTemplate: 'parallx://fake-ext/thing/<id>',
            description: 'Open a synthetic thing.',
            examples: ['parallx://fake-ext/thing/7'],
          },
        ],
      },
      {
        segment: 'other',
        displayName: 'Other',
        extensionId: 'other',
        kinds: [
          {
            kind: 'doc',
            uriTemplate: 'parallx://other/doc/<id>',
            description: 'Open an other doc.',
          },
        ],
      },
    ];
    const out = buildLinkingSection(contracts);
    // Heading and every template are present — adding a new extension would
    // surface here without touching the builder.
    expect(out).toContain('## Linking');
    expect(out).toContain('parallx://fake-ext/thing/<id>');
    expect(out).toContain('Open a synthetic thing.');
    expect(out).toContain('parallx://fake-ext/thing/7'); // example
    expect(out).toContain('parallx://other/doc/<id>');
    expect(out).toContain('Open an other doc.');
    // Display names are referenced so the AI knows which extension owns each.
    expect(out).toContain('Fake Extension');
    expect(out).toContain('Other');
  });

  it('Iter C — buildLinkingSection renders only static scaffolding when no contracts are passed (caller is responsible for gating)', () => {
    const out = buildLinkingSection([]);
    expect(out).toContain('## Linking');
    expect(out).toContain('URI templates available in this workspace:');
    // No per-extension lines emitted.
    expect(out).not.toMatch(/^- /m);
  });
});
