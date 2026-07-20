/**
 * M88 S4 — workspace-graph node-id normalization + provider dedup.
 *
 * The extension is single-file plain JS loaded via blob URL (same situation
 * as mediaOrganizerSelection.test.ts): we extract the functions under test
 * from the source by anchor and evaluate them with stubbed collaborators.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type NormalizeFn = (id: string) => string;
type CollectFn = (api: unknown, nodes: unknown[], edges: unknown[]) => Promise<void>;

let normalize: NormalizeFn;
let collectProviders: CollectFn;

beforeAll(() => {
  const src = readFileSync(resolve(__dirname, '../../ext/workspace-graph/main.js'), 'utf8');

  const normStart = src.indexOf('function _normalizeGraphNodeId(');
  const collectStart = src.indexOf('async function _collectProviders(');
  const collectEnd = src.indexOf('function _getRefreshOrchestrator(');
  if (normStart < 0 || collectStart < 0 || collectEnd < 0 || !(normStart < collectStart)) {
    throw new Error('extraction anchors not found in workspace-graph/main.js');
  }
  const body = src.slice(normStart, collectEnd);

  // Stub the collaborators _collectProviders touches.
  const factory = new Function(
    'IGNORED_PROVIDER_IDS', '_makeNode', '_domainColor',
    `${body}; return { _normalizeGraphNodeId, _collectProviders };`,
  );
  const out = factory(
    new Set<string>(),
    (id: string, label: string, domain: string, color: string, radius: number, meta: unknown) =>
      ({ id, label, domain, color, radius, meta }),
    () => '#888888',
  );
  normalize = out._normalizeGraphNodeId;
  collectProviders = out._collectProviders;
});

describe('_normalizeGraphNodeId (M88 S4)', () => {
  it('canonicalizes case, separators, encoding, and trailing slashes', () => {
    const a = normalize('file:D:\\AI\\Ws\\Books\\Exam%207.pdf');
    const b = normalize('file:d:/ai/ws/books/exam 7.pdf/');
    expect(a).toBe(b);
  });

  it('leaves non-file ids untouched', () => {
    expect(normalize('page:abc')).toBe('page:abc');
    expect(normalize('concept:xyz')).toBe('concept:xyz');
  });
});

describe('_collectProviders dedup (M88 S4)', () => {
  function api(snap: { nodes?: unknown[]; edges?: unknown[] }) {
    return {
      workspaceGraph: {
        getAll: () => [{ id: 'p1', snapshot: async () => snap }],
      },
    };
  }

  it('a provider node that normalizes onto an existing node becomes an ALIAS, not a duplicate', async () => {
    const nodes: any[] = [{ id: 'file:d:/ws/Books/ch2.pdf', label: 'ch2.pdf' }];
    const edges: any[] = [];
    await collectProviders(api({
      nodes: [{ id: 'file:D:/ws/books/ch2.pdf', label: 'ch2.pdf (dup spelling)' }],
      edges: [{ source: 'file:D:/ws/books/ch2.pdf', target: 'page:p9', kind: 'similar-to', score: 0.8 }],
    }), nodes, edges);

    expect(nodes).toHaveLength(1); // no duplicate node spawned
    expect(edges).toHaveLength(1);
    expect(edges[0].source).toBe('file:d:/ws/Books/ch2.pdf'); // edge reattached
  });

  it('genuinely new provider nodes still land', async () => {
    const nodes: any[] = [];
    const edges: any[] = [];
    await collectProviders(api({
      nodes: [{ id: 'file:d:/ws/new.pdf', label: 'new.pdf' }],
      edges: [],
    }), nodes, edges);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].id).toBe('file:d:/ws/new.pdf');
  });
});
