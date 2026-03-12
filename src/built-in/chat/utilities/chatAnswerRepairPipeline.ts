export interface IChatAnswerRepairEvidenceAssessment {
  readonly status: 'sufficient' | 'weak' | 'insufficient';
  readonly reasons: string[];
}

export interface IChatAnswerRepairPipelineDeps {
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
}

export function applyChatAnswerRepairPipeline(
  deps: IChatAnswerRepairPipelineDeps,
  input: IApplyChatAnswerRepairPipelineInput,
): string {
  const groundedContext = input.retrievedContextText || input.markdown;

  return deps.repairUnsupportedSpecificCoverageAnswer(
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
  );
}