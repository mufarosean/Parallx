import type {
  IChatMessage,
  IChatParticipantRequest,
  IChatRequestResponsePair,
} from '../../../services/chatTypes.js';
import type {
  IResolvedDefaultChatTurnInterpretation,
} from './chatDefaultTurnInterpretation.js';
import type {
  IDefaultRuntimeContextStageResult,
} from './chatDefaultRuntimeContextStage.js';
import {
  assembleChatTurnMessages,
  type IChatTurnMessageAssemblyDeps,
} from './chatTurnMessageAssembly.js';
import { composeChatUserContent } from './chatUserContentComposer.js';
import { buildRuntimePromptEnvelopeMessages } from './chatRuntimePromptMessages.js';

export type IDefaultRuntimePromptStageServices = IChatTurnMessageAssemblyDeps;

export interface IBuildDefaultRuntimePromptSeedInput {
  readonly mode: IChatParticipantRequest['mode'];
  readonly history: readonly IChatRequestResponsePair[];
}

export interface IBuildDefaultRuntimePromptEnvelopeInput {
  readonly request: IChatParticipantRequest;
  readonly turn: IResolvedDefaultChatTurnInterpretation;
  readonly preparedContext: IDefaultRuntimeContextStageResult;
  readonly applyCommandTemplate: (
    command: NonNullable<IResolvedDefaultChatTurnInterpretation['slashResult']['command']>,
    userInput: string,
    contextContent: string,
  ) => string;
  readonly buildEvidenceResponseConstraint: (
    query: string,
    assessment: IDefaultRuntimeContextStageResult['evidenceAssessment'],
  ) => string;
}

export async function buildDefaultRuntimePromptSeed(
  services: IDefaultRuntimePromptStageServices,
  input: IBuildDefaultRuntimePromptSeedInput,
): Promise<{ messages: IChatMessage[] }> {
  return assembleChatTurnMessages(services, input);
}

export function buildDefaultRuntimePromptEnvelope(
  input: IBuildDefaultRuntimePromptEnvelopeInput,
): { messages: IChatMessage[]; userContent: string } {
  const userContent = composeChatUserContent(
    {
      applyCommandTemplate: input.applyCommandTemplate,
      buildEvidenceResponseConstraint: input.buildEvidenceResponseConstraint,
    },
    {
      slashResult: input.turn.slashResult,
      effectiveText: input.turn.effectiveText,
      userText: input.turn.userText,
      contextParts: input.preparedContext.contextParts,
      retrievalPlan: input.turn.retrievalPlan,
      evidenceAssessment: input.preparedContext.evidenceAssessment,
      coverageRecord: input.preparedContext.coverageRecord,
    },
  );

  return {
    messages: buildRuntimePromptEnvelopeMessages({
      seedMessages: input.preparedContext.messages,
      userContent,
      attachments: input.request.attachments,
    }),
    userContent,
  };
}