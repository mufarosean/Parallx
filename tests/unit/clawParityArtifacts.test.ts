import { describe, expect, it } from 'vitest';
import type { IChatRuntimeTrace } from '../../src/built-in/chat/chatTypes';
import {
  compareClawParityArtifacts,
  createClawParityArtifact,
  summarizeClawParityComparisons,
} from '../ai-eval/clawParityArtifacts';

describe('clawParityArtifacts', () => {
  it('normalizes common runtime traces and metadata into comparison signals', () => {
    const traces: IChatRuntimeTrace[] = [
      {
        route: { kind: 'grounded', reason: 'test' },
        contextPlan: {
          route: 'grounded',
          intent: 'answer-question',
          useRetrieval: true,
          useMemoryRecall: false,
          useTranscriptRecall: false,
          useConceptRecall: false,
          useCurrentPage: false,
          citationMode: 'required',
          reasoning: 'test',
          retrievalPlan: {
            intent: 'answer-question',
            reasoning: 'test',
            needsRetrieval: true,
            queries: ['claims guide'],
          },
        },
        hasActiveSlashCommand: false,
        isRagReady: true,
        runtime: 'claw',
        runState: 'executing',
        checkpoint: 'prompt-seed',
      },
      {
        route: { kind: 'grounded', reason: 'test' },
        contextPlan: {
          route: 'grounded',
          intent: 'answer-question',
          useRetrieval: true,
          useMemoryRecall: false,
          useTranscriptRecall: false,
          useConceptRecall: false,
          useCurrentPage: false,
          citationMode: 'required',
          reasoning: 'test',
          retrievalPlan: {
            intent: 'answer-question',
            reasoning: 'test',
            needsRetrieval: true,
            queries: ['claims guide'],
          },
        },
        hasActiveSlashCommand: false,
        isRagReady: true,
        runtime: 'claw',
        runState: 'awaiting-approval',
        approvalState: 'pending',
        toolName: 'workspace.search',
        checkpoint: 'tool-validation',
      },
      {
        route: { kind: 'grounded', reason: 'test' },
        contextPlan: {
          route: 'grounded',
          intent: 'answer-question',
          useRetrieval: true,
          useMemoryRecall: false,
          useTranscriptRecall: false,
          useConceptRecall: false,
          useCurrentPage: false,
          citationMode: 'required',
          reasoning: 'test',
          retrievalPlan: {
            intent: 'answer-question',
            reasoning: 'test',
            needsRetrieval: true,
            queries: ['claims guide'],
          },
        },
        hasActiveSlashCommand: false,
        isRagReady: true,
        runtime: 'claw',
        runState: 'completed',
        checkpoint: 'post-finalization',
      },
      {
        route: { kind: 'grounded', reason: 'test' },
        contextPlan: {
          route: 'grounded',
          intent: 'answer-question',
          useRetrieval: true,
          useMemoryRecall: false,
          useTranscriptRecall: false,
          useConceptRecall: false,
          useCurrentPage: false,
          citationMode: 'required',
          reasoning: 'test',
          retrievalPlan: {
            intent: 'answer-question',
            reasoning: 'test',
            needsRetrieval: true,
            queries: ['claims guide'],
          },
        },
        hasActiveSlashCommand: false,
        isRagReady: true,
        runtime: 'claw',
        runState: 'completed',
        checkpoint: 'memory-summary-refined-stored',
      },
    ];

    const artifact = createClawParityArtifact({
      system: 'parallx',
      scenarioId: 'CP02',
      traces,
      metadata: {
        runtimeBoundary: {
          type: 'bridge-compatibility',
          runtime: 'claw',
        },
        toolProvenance: {
          owner: 'tool.test',
        },
      },
      observedSignals: ['tool source provenance visible'],
    });

    expect(artifact.signals).toContain('runtime=claw');
    expect(artifact.signals).toContain('runState=completed');
    expect(artifact.signals).toContain('prompt-seed checkpoint');
    expect(artifact.signals).toContain('approval state trace');
    expect(artifact.signals).toContain('tool identity visible');
    expect(artifact.signals).toContain('permission or approval posture visible');
    expect(artifact.signals).toContain('tool validation trace when tools are used');
    expect(artifact.signals).toContain('memory-summary-refined-stored occurs after completion');
    expect(artifact.signals).toContain('runtimeBoundary=bridge-compatibility');
    expect(artifact.signals).toContain('surface=bridge');
    expect(artifact.signals).toContain('tool source provenance visible');
  });

  it('passes a scenario when both artifacts satisfy the required signals', () => {
    const parallx = createClawParityArtifact({
      system: 'parallx',
      scenarioId: 'CP07',
      observedSignals: [
        'bridge-handler-start',
        'bridge-handler-complete',
        'runtimeBoundary=bridge-compatibility',
      ],
    });
    const nemo = createClawParityArtifact({
      system: 'nemo-claw',
      scenarioId: 'CP07',
      observedSignals: [
        'bridge-handler-start',
        'bridge-handler-complete',
        'runtimeBoundary=bridge-compatibility',
      ],
    });

    const comparison = compareClawParityArtifacts('CP07', parallx, nemo);

    expect(comparison.status).toBe('pass');
    expect(comparison.matchedSignals).toEqual([
      'bridge-handler-start',
      'bridge-handler-complete',
      'runtimeBoundary=bridge-compatibility',
    ]);
  });

  it('fails a scenario when required signals are missing from one side', () => {
    const parallx = createClawParityArtifact({
      system: 'parallx',
      scenarioId: 'CP10',
      observedSignals: [
        'tool identity visible',
        'permission or approval posture visible',
      ],
    });
    const nemo = createClawParityArtifact({
      system: 'nemo-claw',
      scenarioId: 'CP10',
      observedSignals: [
        'tool identity visible',
        'permission or approval posture visible',
        'tool source provenance visible',
      ],
    });

    const comparison = compareClawParityArtifacts('CP10', parallx, nemo);

    expect(comparison.status).toBe('fail');
    expect(comparison.missingFromParallx).toEqual(['tool source provenance visible']);
    expect(comparison.missingFromNemoClaw).toEqual([]);
  });

  it('blocks a scenario when the NemoClaw artifact is not available yet', () => {
    const parallx = createClawParityArtifact({
      system: 'parallx',
      scenarioId: 'CP03',
      outcome: 'blocked',
      observedSignals: ['effective prompt layers are inspectable'],
      blockers: ['Parallx capture incomplete'],
    });

    const comparison = compareClawParityArtifacts('CP03', parallx);

    expect(comparison.status).toBe('blocked');
    expect(comparison.blockers).toContain('Missing NemoClaw artifact');
    expect(comparison.blockers).toContain('Full skill-manifest parity remains a larger follow-on track outside the runtime seam closure in this pass.');
  });

  it('summarizes mixed comparison results', () => {
    const passComparison = compareClawParityArtifacts(
      'CP07',
      createClawParityArtifact({
        system: 'parallx',
        scenarioId: 'CP07',
        observedSignals: ['bridge-handler-start', 'bridge-handler-complete', 'runtimeBoundary=bridge-compatibility'],
      }),
      createClawParityArtifact({
        system: 'nemo-claw',
        scenarioId: 'CP07',
        observedSignals: ['bridge-handler-start', 'bridge-handler-complete', 'runtimeBoundary=bridge-compatibility'],
      }),
    );
    const blockedComparison = compareClawParityArtifacts(
      'CP03',
      createClawParityArtifact({
        system: 'parallx',
        scenarioId: 'CP03',
        outcome: 'blocked',
      }),
    );

    expect(summarizeClawParityComparisons([passComparison, blockedComparison])).toEqual({
      total: 2,
      passed: 1,
      failed: 0,
      blocked: 1,
    });
  });
});