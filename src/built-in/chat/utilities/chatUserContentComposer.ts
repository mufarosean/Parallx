import type { IParsedSlashCommand } from '../chatTypes.js';
import type { IRetrievalPlan } from '../chatTypes.js';

export interface IChatUserContentEvidenceAssessment {
  readonly status: 'sufficient' | 'weak' | 'insufficient';
  readonly reasons: string[];
}

export interface IChatUserContentComposerDeps {
  readonly applyCommandTemplate: (
    command: NonNullable<IParsedSlashCommand['command']>,
    userInput: string,
    contextContent: string,
  ) => string | undefined;
  readonly buildEvidenceResponseConstraint: (
    query: string,
    evidenceAssessment: IChatUserContentEvidenceAssessment,
  ) => string;
}

export interface IComposeChatUserContentOptions {
  readonly slashResult: IParsedSlashCommand;
  readonly effectiveText: string;
  readonly userText: string;
  readonly contextParts: readonly string[];
  readonly retrievalPlan: IRetrievalPlan;
  readonly evidenceAssessment: IChatUserContentEvidenceAssessment;
}

export function composeChatUserContent(
  deps: IChatUserContentComposerDeps,
  options: IComposeChatUserContentOptions,
): string {
  if (options.slashResult.command && !options.slashResult.command.specialHandler) {
    const contextStr = options.contextParts.join('\n\n');
    const templated = deps.applyCommandTemplate(
      options.slashResult.command,
      options.effectiveText,
      contextStr,
    );
    return templated ?? options.effectiveText;
  }

  const parts: string[] = [];

  parts.push(`[User Request]\n${options.userText}`);

  if (options.retrievalPlan.needsRetrieval) {
    const retrievalAnalysisLines = [
      '[Retrieval Analysis]',
      `Intent: ${options.retrievalPlan.intent}`,
      `Analysis: ${options.retrievalPlan.reasoning}`,
    ];
    if (options.retrievalPlan.coverageMode === 'exhaustive') {
      retrievalAnalysisLines.push(
        'Coverage Mode: exhaustive',
        'Coverage Contract: This request requires file-by-file or source-by-source coverage. Representative semantic retrieval is not enough.',
        'Coverage Contract: Use available read-only tools to enumerate and read the relevant files before answering.',
        'Coverage Contract: Do not invent summaries for files you have not actually read. If coverage is incomplete, say so explicitly.',
      );
    }
    if (options.evidenceAssessment.status !== 'sufficient') {
      retrievalAnalysisLines.push(`Evidence: ${options.evidenceAssessment.status}`);
      if (options.evidenceAssessment.reasons.length > 0) {
        retrievalAnalysisLines.push(`Evidence Notes: ${options.evidenceAssessment.reasons.join(', ')}`);
      }
      retrievalAnalysisLines.push(
        deps.buildEvidenceResponseConstraint(options.userText, options.evidenceAssessment),
      );
    }
    parts.push(retrievalAnalysisLines.join('\n'));
  }

  if (options.contextParts.length > 0) {
    parts.push(`[Supporting Context]\n${options.contextParts.join('\n\n')}`);
  }
  return parts.join('\n\n');
}
