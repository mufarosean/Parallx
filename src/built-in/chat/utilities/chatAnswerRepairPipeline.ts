import type { ICoverageRecord } from '../chatTypes.js';

export interface IChatAnswerRepairEvidenceAssessment {
  readonly status: 'sufficient' | 'weak' | 'insufficient';
  readonly reasons: string[];
}

export interface IChatAnswerRepairPipelineDeps {
  readonly repairGroundedAnswerTypography: (answer: string) => string;
  readonly repairUnsupportedWorkspaceTopicAnswer: (query: string, answer: string) => string;
  readonly repairUnsupportedSpecificCoverageAnswer: (
    query: string,
    answer: string,
    evidenceAssessment: IChatAnswerRepairEvidenceAssessment,
  ) => string;
  readonly repairVehicleInfoAnswer: (query: string, answer: string, retrievedContextText: string) => string;
  readonly repairAgentContactAnswer: (query: string, answer: string, retrievedContextText: string) => string;
  readonly repairDeductibleConflictAnswer: (query: string, answer: string, retrievedContextText: string) => string;
  readonly repairTotalLossThresholdAnswer: (query: string, answer: string, retrievedContextText: string) => string;
  readonly repairGroundedCodeAnswer: (query: string, answer: string, retrievedContextText: string) => string;
}

export interface IApplyChatAnswerRepairPipelineInput {
  readonly query: string;
  readonly markdown: string;
  readonly retrievedContextText: string;
  readonly evidenceAssessment: IChatAnswerRepairEvidenceAssessment;
  /** M38: Coverage record from the evidence engine. */
  readonly coverageRecord?: ICoverageRecord;
}

export function applyChatAnswerRepairPipeline(
  deps: IChatAnswerRepairPipelineDeps,
  input: IApplyChatAnswerRepairPipelineInput,
): string {
  const groundedContext = input.retrievedContextText || input.markdown;

  let repaired = deps.repairGroundedAnswerTypography(
    deps.repairUnsupportedWorkspaceTopicAnswer(
      input.query,
      deps.repairUnsupportedSpecificCoverageAnswer(
        input.query,
        deps.repairVehicleInfoAnswer(
          input.query,
          deps.repairAgentContactAnswer(
            input.query,
            deps.repairDeductibleConflictAnswer(
              input.query,
              deps.repairTotalLossThresholdAnswer(
                input.query,
                deps.repairGroundedCodeAnswer(
                  input.query,
                  input.markdown,
                  groundedContext,
                ),
                groundedContext,
              ),
              groundedContext,
            ),
            groundedContext,
          ),
          groundedContext,
        ),
        input.evidenceAssessment,
      ),
    ),
  );

  // M38: Coverage validation — qualify answers that claim completeness
  // despite incomplete evidence coverage.
  repaired = repairCoverageCompleteness(repaired, input.coverageRecord);

  return repaired;
}

// ── M38: Coverage completeness validation ──────────────────────────────────

const FALSE_COMPLETENESS_PATTERNS = /\b(all\s+(?:files?|documents?|sources?)|every\s+(?:file|document|source)|complete\s+(?:list|summary|overview)|comprehensive\s+(?:summary|list|review)|(?:exhaustive|full)\s+(?:summary|list|review|coverage))\b/i;

/**
 * If coverage is partial or minimal, check whether the answer claims
 * completeness.  If it does, append a qualifier note.
 */
function repairCoverageCompleteness(answer: string, coverage?: ICoverageRecord): string {
  if (!coverage || coverage.level === 'full') return answer;
  if (!FALSE_COMPLETENESS_PATTERNS.test(answer)) return answer;

  const gapNote = coverage.gaps.length > 0
    ? ` The following sources were not available: ${coverage.gaps.slice(0, 5).join(', ')}${coverage.gaps.length > 5 ? ` and ${coverage.gaps.length - 5} more` : ''}.`
    : '';

  return `${answer}\n\n> **Note:** This answer is based on ${coverage.coveredTargets} of ${coverage.totalTargets} available sources (${coverage.level} coverage).${gapNote}`;
}