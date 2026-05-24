/**
 * M81 Slice C — Artifact Linking characterization.
 *
 * Closes the §22 debt for `artifactLinking.test.ts` promised in
 * `docs/Parallx_Milestone_81.md`. Per the 2026-05-23 audit ruling
 * (`docs/research/M81_SLICE_C_AUDIT.md`): "`ArtifactRegistry` — CLOSED
 * (LinkResolverService is the registry). `grep_search` for
 * `ArtifactRegistry|IArtifact|artifact-registry` returns zero matches.
 * The cross-surface URI concern is already served by M66's
 * `LinkResolverService` + `linkContractRegistry`. An `ArtifactRegistry`
 * would be a parallel-but-redundant abstraction."
 *
 * This file pins LinkResolverService AS the artifact registry by
 * exercising the full lifecycle that an ArtifactRegistry would have
 * needed to support:
 *   - register an owning segment with per-kind handlers,
 *   - mint a `parallx://` URI for a resource of that kind,
 *   - parse the URI back into the canonical ParsedLink shape,
 *   - resolve via the registered handler,
 *   - dispose and verify the registration is gone.
 *
 * Plus the anti-bitrot guard: no parallel ArtifactRegistry surface in src/.
 */

import { describe, expect, it, vi } from 'vitest';
import { LinkResolverService } from '../../src/links/linkResolverService';
import { mintParallxUri, parseParallxUri } from '../../src/links/parallxUri';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

describe('M81 Slice C — artifact linking (closed; LinkResolverService is the registry)', () => {
  it('mintParallxUri + parseParallxUri round-trip preserves segment/kind/id', () => {
    const uri = mintParallxUri('canvas', ['page', 'abc-123']);
    const parsed = parseParallxUri(uri);
    expect(parsed).not.toBeNull();
    expect(parsed!.segment).toBe('canvas');
    expect(parsed!.kind).toBe('page');
    expect(parsed!.pathSegments).toEqual(['page', 'abc-123']);
  });

  it('registers a contract and routes open() to the segment+kind handler', async () => {
    const svc = new LinkResolverService();
    const openHandler = vi.fn(async () => true);

    const disposable = svc.register({
      segment: 'canvas',
      extensionId: 'parallx.canvas',
      kinds: {
        page: { open: openHandler },
      },
    });

    const uri = mintParallxUri('canvas', ['page', 'p-001']);
    const ok = await svc.open(uri);
    expect(ok).toBe(true);
    expect(openHandler).toHaveBeenCalledTimes(1);
    const callArg = openHandler.mock.calls[0][0];
    expect(callArg.segment).toBe('canvas');
    expect(callArg.kind).toBe('page');
    expect(callArg.pathSegments).toEqual(['page', 'p-001']);

    disposable.dispose();
  });

  it('returns false (does not throw) for unknown segment or kind', async () => {
    const svc = new LinkResolverService();
    svc.register({
      segment: 'canvas',
      extensionId: 'parallx.canvas',
      kinds: { page: { open: async () => true } },
    });

    expect(await svc.open('parallx://does-not-exist/page/x')).toBe(false);
    expect(await svc.open('parallx://canvas/no-such-kind/x')).toBe(false);
    expect(await svc.open('not-a-parallx-uri')).toBe(false);
  });

  it('resolveMetadata returns null for handlers that do not implement it', async () => {
    const svc = new LinkResolverService();
    svc.register({
      segment: 'canvas',
      extensionId: 'parallx.canvas',
      kinds: { page: { open: async () => true } },
    });
    const md = await svc.resolveMetadata(mintParallxUri('canvas', ['page', 'p']));
    expect(md).toBeNull();
  });

  it('resolveMetadata routes to the handler when provided', async () => {
    const svc = new LinkResolverService();
    svc.register({
      segment: 'canvas',
      extensionId: 'parallx.canvas',
      kinds: {
        page: {
          open: async () => true,
          resolveMetadata: async parsed => ({
            title: `Page ${parsed.pathSegments[1]}`,
          }),
        },
      },
    });
    const md = await svc.resolveMetadata(mintParallxUri('canvas', ['page', '42']));
    expect(md).not.toBeNull();
    expect(md!.title).toBe('Page 42');
  });

  it('fires onDidChangeContracts on register and on dispose', () => {
    const svc = new LinkResolverService();
    const listener = vi.fn();
    svc.onDidChangeContracts(listener);

    const d = svc.register({
      segment: 'canvas',
      extensionId: 'parallx.canvas',
      kinds: { page: { open: async () => true } },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    d.dispose();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('disposing a registration removes the contract and stops routing', async () => {
    const svc = new LinkResolverService();
    const open = vi.fn(async () => true);
    const d = svc.register({
      segment: 'canvas',
      extensionId: 'parallx.canvas',
      kinds: { page: { open } },
    });

    const uri = mintParallxUri('canvas', ['page', 'x']);
    await svc.open(uri);
    expect(open).toHaveBeenCalledTimes(1);

    d.dispose();
    expect(svc.allContracts()).toEqual([]);
    const ok = await svc.open(uri);
    expect(ok).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('anti-bitrot: no parallel ArtifactRegistry surface in src/', async () => {
    // Forbidden identifiers per the audit. If any appears we have grown a
    // parallel-but-redundant abstraction and must reconcile.
    const forbidden = /\b(ArtifactRegistry|IArtifactRegistry|IArtifact|artifact-registry)\b/;
    const srcRoot = path.resolve(process.cwd(), 'src');

    async function* walk(root: string): AsyncGenerator<string> {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
          yield* walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          yield full;
        }
      }
    }

    const hits: string[] = [];
    for await (const file of walk(srcRoot)) {
      const content = await fs.readFile(file, 'utf8');
      if (forbidden.test(content)) {
        hits.push(path.relative(process.cwd(), file));
      }
    }
    expect(hits, `Forbidden ArtifactRegistry surface reintroduced in: ${hits.join(', ')}`).toEqual([]);
  });
});
