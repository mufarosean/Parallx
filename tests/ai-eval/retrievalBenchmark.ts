/**
 * Retrieval Benchmark Definitions
 *
 * Machine-readable retrieval expectations for demo-workspace eval cases.
 * These expectations are intentionally additive: they do not change prompts or
 * response scoring, they provide a retrieval-focused layer for measuring
 * evidence selection quality alongside the broader AI quality rubric.
 */

export type RetrievalBenchmarkCategory =
  | 'exact-identifier'
  | 'source-selection'
  | 'cross-source-coverage'
  | 'structured-document'
  | 'follow-up-continuity'
  | 'workspace-exploration';

export interface RetrievalBenchmarkTurn {
  /** Source documents that should be represented in the answer. */
  expectedSources: string[];
  /** Terms or phrases that should appear if the right evidence was retrieved. */
  requiredTerms?: string[];
  /** Terms that should not appear for this retrieval target. */
  forbiddenTerms?: string[];
  /** Whether the answer is expected to expose citation/source markers. */
  requireCitation?: boolean;
}

export interface RetrievalBenchmarkCase {
  id: string;
  name: string;
  category: RetrievalBenchmarkCategory;
  description: string;
  turns: RetrievalBenchmarkTurn[];
}

export const RETRIEVAL_BENCHMARKS: RetrievalBenchmarkCase[] = [
  {
    id: 'T01',
    name: 'Collision deductible exact retrieval',
    category: 'exact-identifier',
    description: 'Single-source fact retrieval from the policy document.',
    turns: [
      {
        expectedSources: ['Auto Insurance Policy.md'],
        requiredTerms: ['$500', 'collision'],
        forbiddenTerms: ['$250', '$750', '$950', '$1,000'],
      },
    ],
  },
  {
    id: 'T02',
    name: 'Agent contact source selection',
    category: 'source-selection',
    description: 'Phone-number lookup should resolve to the contacts document.',
    turns: [
      {
        expectedSources: ['Agent Contacts.md'],
        requiredTerms: ['Sarah', '(555) 234-5678'],
      },
    ],
  },
  {
    id: 'T05',
    name: 'Accident workflow cross-source coverage',
    category: 'cross-source-coverage',
    description: 'Scenario should pull from reference card, claims guide, and policy.',
    turns: [
      {
        expectedSources: [
          'Accident Quick Reference.md',
          'Claims Guide.md',
          'Auto Insurance Policy.md',
        ],
        requiredTerms: ['police', 'photos', 'claim', 'uninsured'],
      },
    ],
  },
  {
    id: 'T07',
    name: 'Repair shop source attribution',
    category: 'source-selection',
    description: 'Requested repair shops should point back to the contacts document with citations.',
    turns: [
      {
        expectedSources: ['Agent Contacts.md'],
        requiredTerms: ['AutoCraft', 'Precision'],
        requireCitation: true,
      },
    ],
  },
  {
    id: 'T08',
    name: 'Deductible follow-up continuity',
    category: 'follow-up-continuity',
    description: 'Both turns should stay anchored to the policy document and switch deductible type correctly.',
    turns: [
      {
        expectedSources: ['Auto Insurance Policy.md'],
        requiredTerms: ['$500', 'collision'],
      },
      {
        expectedSources: ['Auto Insurance Policy.md'],
        requiredTerms: ['$250', 'comprehensive'],
        forbiddenTerms: ['$500 only'],
      },
    ],
  },
  {
    id: 'T09',
    name: 'Workspace exploration document coverage',
    category: 'workspace-exploration',
    description: 'Workspace overview should mention multiple known documents from the digest.',
    turns: [
      {
        expectedSources: [
          'Auto Insurance Policy.md',
          'Claims Guide.md',
          'Agent Contacts.md',
          'Vehicle Info.md',
        ],
        requiredTerms: ['policy', 'claims', 'contact', 'vehicle'],
      },
    ],
  },
  {
    id: 'T15',
    name: 'Structured vehicle info retrieval',
    category: 'structured-document',
    description: 'Buried total-loss detail should resolve to the vehicle info document.',
    turns: [
      {
        expectedSources: ['Vehicle Info.md'],
        requiredTerms: ['75%', 'KBB'],
      },
    ],
  },
  {
    id: 'T17',
    name: 'Accident workflow continuity',
    category: 'cross-source-coverage',
    description: 'Multi-turn accident flow should maintain evidence across operational steps.',
    turns: [
      {
        expectedSources: ['Accident Quick Reference.md'],
        requiredTerms: ['photo', 'police'],
      },
      {
        expectedSources: ['Auto Insurance Policy.md'],
        requiredTerms: ['collision', 'uninsured'],
      },
      {
        expectedSources: ['Claims Guide.md', 'Agent Contacts.md'],
        requiredTerms: ['claim', 'Sarah'],
      },
    ],
  },
  {
    id: 'T20',
    name: 'Severity routing matrix lookup',
    category: 'structured-document',
    description: 'Question should resolve to the severity routing matrix in the long architecture document.',
    turns: [
      {
        expectedSources: ['Claims Workflow Architecture.md'],
        requiredTerms: ['severity desk coordinator', 'within 1 business day'],
        requireCitation: true,
      },
    ],
  },
  {
    id: 'T21',
    name: 'Escalation packet builder snippet',
    category: 'structured-document',
    description: 'Question should resolve to the embedded code snippet in the long architecture document.',
    turns: [
      {
        expectedSources: ['Claims Workflow Architecture.md'],
        requiredTerms: ['buildEscalationPacket', 'policy-summary', 'police-report'],
        requireCitation: true,
      },
    ],
  },
];

export function getRetrievalBenchmarkById(id: string): RetrievalBenchmarkCase | undefined {
  return RETRIEVAL_BENCHMARKS.find((benchmark) => benchmark.id === id);
}
