import { describe, expect, it } from 'vitest';

import { computeCoverage } from '../../src/built-in/chat/utilities/chatEvidenceGatherer';
import { applyChatAnswerRepairPipeline } from '../../src/built-in/chat/utilities/chatAnswerRepairPipeline';
import { composeChatUserContent } from '../../src/built-in/chat/utilities/chatUserContentComposer';
import type { IEvidenceBundle, IExecutionPlan, IQueryScope } from '../../src/built-in/chat/chatTypes';

// ── Helpers ────────────────────────────────────────────────────────────────

function makePlan(): IExecutionPlan {
  const scope: IQueryScope = { level: 'workspace', derivedFrom: 'contextual', confidence: 0.3 };
  return { workflowType: 'folder-summary', steps: [], outputConstraints: {}, scope };
}

function makeBundle(structural: string[], reads: string[]): IEvidenceBundle {
  return {
    plan: makePlan(),
    items: [
      {
        kind: 'structural',
        scopePath: 'docs/',
        files: structural.map(p => ({ relativePath: p, ext: '.md' })),
      },
      {
        kind: 'exhaustive',
        reads: reads.map(p => ({ relativePath: p, content: `content of ${p}` })),
      },
    ],
    totalChars: 1000,
  };
}

const passthrough = (s: string) => s;
const repairDeps = {
  repairGroundedAnswerTypography: passthrough,
  repairUnsupportedWorkspaceTopicAnswer: (_q: string, a: string) => a,
  repairUnsupportedSpecificCoverageAnswer: (_q: string, a: string) => a,
  repairVehicleInfoAnswer: (_q: string, a: string) => a,
  repairAgentContactAnswer: (_q: string, a: string) => a,
  repairDeductibleConflictAnswer: (_q: string, a: string) => a,
  repairTotalLossThresholdAnswer: (_q: string, a: string) => a,
  repairGroundedCodeAnswer: (_q: string, a: string) => a,
};

// ── computeCoverage ────────────────────────────────────────────────────────

describe('computeCoverage', () => {
  it('returns full when no structural evidence exists', () => {
    const bundle: IEvidenceBundle = {
      plan: makePlan(),
      items: [{ kind: 'semantic', text: 'context', sources: [] }],
      totalChars: 7,
    };
    const record = computeCoverage(bundle);
    expect(record.level).toBe('full');
    expect(record.totalTargets).toBe(0);
  });

  it('returns full when all enumerated files are read', () => {
    const bundle = makeBundle(['docs/a.md', 'docs/b.md'], ['docs/a.md', 'docs/b.md']);
    const record = computeCoverage(bundle);
    expect(record.level).toBe('full');
    expect(record.coveredTargets).toBe(2);
    expect(record.gaps).toHaveLength(0);
  });

  it('returns partial when most files are read', () => {
    const bundle = makeBundle(
      ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'],
      ['a.md', 'b.md', 'c.md', 'd.md'],
    );
    const record = computeCoverage(bundle);
    expect(record.level).toBe('partial');
    expect(record.gaps).toEqual(['e.md']);
  });

  it('returns minimal when few files are read', () => {
    const bundle = makeBundle(
      ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md', 'h.md', 'i.md', 'j.md'],
      ['a.md', 'b.md'],
    );
    const record = computeCoverage(bundle);
    expect(record.level).toBe('minimal');
    expect(record.gaps).toHaveLength(8);
  });

  it('returns none when no files are read', () => {
    const bundle = makeBundle(['a.md', 'b.md'], []);
    const record = computeCoverage(bundle);
    expect(record.level).toBe('none');
    expect(record.coveredTargets).toBe(0);
  });

  it('counts semantic sources as covering enumerated files', () => {
    const bundle: IEvidenceBundle = {
      plan: makePlan(),
      items: [
        { kind: 'structural', scopePath: 'docs/', files: [{ relativePath: 'docs/a.md', ext: '.md' }] },
        { kind: 'semantic', text: 'retrieved', sources: [{ uri: 'docs/a.md', label: 'a.md' }] },
      ],
      totalChars: 100,
    };
    const record = computeCoverage(bundle);
    expect(record.level).toBe('full');
    expect(record.coveredTargets).toBe(1);
  });
});

// ── Coverage notes in composeChatUserContent ───────────────────────────────

describe('coverage notes in user content', () => {
  it('injects coverage assessment for partial coverage', () => {
    const result = composeChatUserContent(
      {
        applyCommandTemplate: () => undefined,
        buildEvidenceResponseConstraint: () => '',
      },
      {
        slashResult: { userText: 'test', effectiveText: 'test' },
        effectiveText: 'test',
        userText: 'test',
        contextParts: [],
        retrievalPlan: { intent: 'question', reasoning: '', needsRetrieval: false, queries: [] },
        evidenceAssessment: { status: 'sufficient', reasons: [] },
        coverageRecord: { level: 'partial', totalTargets: 5, coveredTargets: 4, gaps: ['e.md'] },
      },
    );

    expect(result).toContain('[Coverage Assessment]');
    expect(result).toContain('partial');
    expect(result).toContain('4/5');
    expect(result).toContain('e.md');
  });

  it('does not inject coverage for full coverage', () => {
    const result = composeChatUserContent(
      {
        applyCommandTemplate: () => undefined,
        buildEvidenceResponseConstraint: () => '',
      },
      {
        slashResult: { userText: 'test', effectiveText: 'test' },
        effectiveText: 'test',
        userText: 'test',
        contextParts: [],
        retrievalPlan: { intent: 'question', reasoning: '', needsRetrieval: false, queries: [] },
        evidenceAssessment: { status: 'sufficient', reasons: [] },
        coverageRecord: { level: 'full', totalTargets: 3, coveredTargets: 3, gaps: [] },
      },
    );

    expect(result).not.toContain('[Coverage Assessment]');
  });
});

// ── Coverage validation in repair pipeline ─────────────────────────────────

describe('coverage validation in repair pipeline', () => {
  it('adds a note when answer claims completeness but coverage is partial', () => {
    const result = applyChatAnswerRepairPipeline(repairDeps, {
      query: 'summarize all files',
      markdown: 'Here is a comprehensive summary covering all files in the folder.',
      retrievedContextText: 'context',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      coverageRecord: { level: 'partial', totalTargets: 10, coveredTargets: 8, gaps: ['h.md', 'i.md'] },
    });

    expect(result).toContain('**Note:**');
    expect(result).toContain('8 of 10');
    expect(result).toContain('h.md');
  });

  it('does not modify answer when coverage is full', () => {
    const original = 'Here is every file in the folder.';
    const result = applyChatAnswerRepairPipeline(repairDeps, {
      query: 'list all files',
      markdown: original,
      retrievedContextText: 'context',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      coverageRecord: { level: 'full', totalTargets: 5, coveredTargets: 5, gaps: [] },
    });

    expect(result).toBe(original);
  });

  it('does not modify answer when it does not claim completeness', () => {
    const original = 'Based on what I found, here are some results.';
    const result = applyChatAnswerRepairPipeline(repairDeps, {
      query: 'summarize files',
      markdown: original,
      retrievedContextText: 'context',
      evidenceAssessment: { status: 'sufficient', reasons: [] },
      coverageRecord: { level: 'partial', totalTargets: 10, coveredTargets: 7, gaps: ['x.md', 'y.md', 'z.md'] },
    });

    expect(result).toBe(original);
  });
});
