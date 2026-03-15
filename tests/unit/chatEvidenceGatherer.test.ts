import { describe, expect, it, vi } from 'vitest';

import { gatherEvidence } from '../../src/built-in/chat/utilities/chatEvidenceGatherer';
import type { IEvidenceGathererDeps } from '../../src/built-in/chat/utilities/chatEvidenceGatherer';
import type { IExecutionPlan, IQueryScope } from '../../src/built-in/chat/chatTypes';

// ── Helpers ────────────────────────────────────────────────────────────────

function makePlan(steps: IExecutionPlan['steps'], workflowType: IExecutionPlan['workflowType'] = 'generic-grounded'): IExecutionPlan {
  const scope: IQueryScope = { level: 'workspace', derivedFrom: 'contextual', confidence: 0.3 };
  return { workflowType, steps, outputConstraints: {}, scope };
}

function makeDeps(overrides?: Partial<IEvidenceGathererDeps>): IEvidenceGathererDeps {
  return {
    listFilesRelative: vi.fn(async () => [
      { name: 'file1.md', type: 'file' as const },
      { name: 'file2.pdf', type: 'file' as const },
      { name: 'subdir', type: 'directory' as const },
    ]),
    readFileRelative: vi.fn(async (path: string) => `Content of ${path}`),
    retrieveContext: vi.fn(async () => ({
      text: 'Retrieved context text',
      sources: [{ uri: 'source1.md', label: 'Source 1' }],
    })),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('gatherEvidence', () => {
  it('skips synthesize steps', async () => {
    const plan = makePlan([{ kind: 'synthesize', label: 'Generate answer' }]);
    const bundle = await gatherEvidence(plan, 'test query', makeDeps());

    expect(bundle.items).toHaveLength(0);
    expect(bundle.totalChars).toBe(0);
  });

  it('gathers structural evidence from enumerate steps', async () => {
    const plan = makePlan([
      { kind: 'enumerate', label: 'List files', targetPaths: ['docs/'] },
      { kind: 'synthesize', label: 'Synthesize' },
    ], 'folder-summary');
    const deps = makeDeps();
    const bundle = await gatherEvidence(plan, 'list docs', deps);

    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].kind).toBe('structural');
    if (bundle.items[0].kind === 'structural') {
      expect(bundle.items[0].scopePath).toBe('docs/');
      expect(bundle.items[0].files).toHaveLength(2); // files only, not directory
      expect(bundle.items[0].files[0].relativePath).toBe('docs//file1.md');
      expect(bundle.items[0].files[0].ext).toBe('.md');
      expect(bundle.items[0].files[1].ext).toBe('.pdf');
    }
    expect(deps.listFilesRelative).toHaveBeenCalledWith('docs/');
  });

  it('gathers semantic evidence from scoped-retrieve steps', async () => {
    const plan = makePlan([
      { kind: 'scoped-retrieve', label: 'Retrieve context', targetPaths: ['Claims/'] },
      { kind: 'synthesize', label: 'Synthesize' },
    ], 'scoped-topic');
    const deps = makeDeps();
    const bundle = await gatherEvidence(plan, 'claims liability', deps);

    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].kind).toBe('semantic');
    if (bundle.items[0].kind === 'semantic') {
      expect(bundle.items[0].text).toBe('Retrieved context text');
      expect(bundle.items[0].sources).toHaveLength(1);
    }
    expect(deps.retrieveContext).toHaveBeenCalledWith('claims liability', ['Claims/']);
  });

  it('gathers exhaustive evidence from deterministic-read steps', async () => {
    const plan = makePlan([
      { kind: 'deterministic-read', label: 'Read file', targetPaths: ['Policy.md', 'Claims.md'] },
      { kind: 'synthesize', label: 'Synthesize' },
    ], 'document-summary');
    const deps = makeDeps();
    const bundle = await gatherEvidence(plan, 'summarize policy', deps);

    expect(bundle.items).toHaveLength(1);
    expect(bundle.items[0].kind).toBe('exhaustive');
    if (bundle.items[0].kind === 'exhaustive') {
      expect(bundle.items[0].reads).toHaveLength(2);
      expect(bundle.items[0].reads[0].relativePath).toBe('Policy.md');
      expect(bundle.items[0].reads[0].content).toBe('Content of Policy.md');
    }
    expect(deps.readFileRelative).toHaveBeenCalledWith('Policy.md');
    expect(deps.readFileRelative).toHaveBeenCalledWith('Claims.md');
  });

  it('collects multiple evidence items for multi-step plans', async () => {
    const plan = makePlan([
      { kind: 'enumerate', label: 'Enumerate', targetPaths: ['docs/'] },
      { kind: 'scoped-retrieve', label: 'Retrieve' },
      { kind: 'synthesize', label: 'Synthesize' },
    ], 'folder-summary');
    const bundle = await gatherEvidence(plan, 'summarize docs folder', makeDeps());

    expect(bundle.items).toHaveLength(2);
    expect(bundle.items[0].kind).toBe('structural');
    expect(bundle.items[1].kind).toBe('semantic');
  });

  it('tracks total character count across evidence items', async () => {
    const plan = makePlan([
      { kind: 'scoped-retrieve', label: 'Retrieve' },
      { kind: 'deterministic-read', label: 'Read', targetPaths: ['a.md'] },
      { kind: 'synthesize', label: 'Synthesize' },
    ]);
    const bundle = await gatherEvidence(plan, 'query', makeDeps());

    expect(bundle.totalChars).toBeGreaterThan(0);
    expect(bundle.totalChars).toBe(
      'Retrieved context text'.length + 'Content of a.md'.length,
    );
  });

  it('handles missing deps gracefully', async () => {
    const plan = makePlan([
      { kind: 'enumerate', label: 'List' },
      { kind: 'scoped-retrieve', label: 'Retrieve' },
      { kind: 'deterministic-read', label: 'Read', targetPaths: ['a.md'] },
      { kind: 'synthesize', label: 'Synthesize' },
    ]);
    const bundle = await gatherEvidence(plan, 'query', {});

    expect(bundle.items).toHaveLength(0);
    expect(bundle.totalChars).toBe(0);
  });

  it('preserves the plan reference on the bundle', async () => {
    const plan = makePlan([{ kind: 'synthesize', label: 'Synthesize' }]);
    const bundle = await gatherEvidence(plan, 'query', makeDeps());

    expect(bundle.plan).toBe(plan);
  });

  it('calls retrieveContext without pathPrefixes when step has no targetPaths', async () => {
    const plan = makePlan([
      { kind: 'scoped-retrieve', label: 'Retrieve' },
      { kind: 'synthesize', label: 'Synthesize' },
    ]);
    const deps = makeDeps();
    await gatherEvidence(plan, 'general question', deps);

    expect(deps.retrieveContext).toHaveBeenCalledWith('general question');
  });
});
