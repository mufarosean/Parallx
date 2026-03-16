// defaultParticipant.ts — Default chat participant (M9 Cap 3 + Cap 4 + Cap 6 agentic loop)
//
// The default agent that handles messages when no @mention is specified.
// Sends the conversation to ILanguageModelsService and streams the response
// back through the IChatResponseStream.
//
// Cap 4 additions: mode-aware system prompts, mode capability enforcement.
// Cap 6 additions: agentic loop — tool call → execute → feed back → repeat.
//
// VS Code reference:
//   Built-in chat participant registered in chat.contribution.ts
//   Agent loop: chatAgents.ts — processes tool_calls, feeds results back

import type { IDisposable } from '../../../platform/lifecycle.js';
import type {
  IChatParticipant,
  IChatParticipantHandler,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
  IChatParticipantResult,
} from '../../../services/chatTypes.js';
import { isChatImageAttachment } from '../../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
} from '../chatTypes.js';
import { getModeCapabilities } from '../config/chatModeCapabilities.js';
import { determineChatTurnRoute } from '../utilities/chatTurnRouter.js';
import { applyChatAnswerRepairPipeline } from '../utilities/chatAnswerRepairPipeline.js';
import {
  assessEvidenceSufficiency as _assessEvidenceSufficiency,
  buildDeterministicSessionSummary as _buildDeterministicSessionSummary,
  buildEvidenceResponseConstraint as _buildEvidenceResponseConstraint,
  buildExtractiveFallbackAnswer as _buildExtractiveFallbackAnswer,
  buildRetrieveAgainQuery as _buildRetrieveAgainQuery,
} from '../utilities/chatGroundedResponseHelpers.js';
import {
  buildMissingCitationFooter as _buildMissingCitationFooter,
  extractToolCallsFromText as _extractToolCallsFromText,
  parseEditResponse as _parseEditResponse,
  stripToolNarration as _stripToolNarration,
} from '../utilities/chatResponseParsingHelpers.js';
import {
  repairAgentContactAnswer as _repairAgentContactAnswer,
  repairDeductibleConflictAnswer as _repairDeductibleConflictAnswer,
  repairGroundedAnswerTypography as _repairGroundedAnswerTypography,
  repairGroundedCodeAnswer as _repairGroundedCodeAnswer,
  repairTotalLossThresholdAnswer as _repairTotalLossThresholdAnswer,
  repairUnsupportedSpecificCoverageAnswer as _repairUnsupportedSpecificCoverageAnswer,
  repairUnsupportedWorkspaceTopicAnswer as _repairUnsupportedWorkspaceTopicAnswer,
  repairVehicleInfoAnswer as _repairVehicleInfoAnswer,
} from '../utilities/chatGroundedAnswerRepairs.js';
import { categorizeChatRequestError } from '../utilities/chatRequestErrorCategorizer.js';
import { assembleChatTurnMessages } from '../utilities/chatTurnMessageAssembly.js';
import { writeChatProvenanceToResponse } from '../utilities/chatTurnContextPreparation.js';
import { interpretChatParticipantRequest } from '../utilities/chatParticipantInterpretation.js';
import { resolveDefaultChatTurnInterpretation } from '../utilities/chatDefaultTurnInterpretation.js';
import { resolveDefaultPreparedTurnContext } from '../utilities/chatDefaultPreparedTurnContext.js';
import { executeDefaultPreparedTurn } from '../utilities/chatDefaultTurnExecution.js';
import { createDefaultCommandRegistry } from '../utilities/chatDefaultCommandRegistry.js';
import { tryHandleDefaultCompactCommand, tryHandleDefaultInitCommand } from '../utilities/chatDefaultEarlyCommands.js';

/** Default maximum agentic loop iterations. */
const DEFAULT_MAX_ITERATIONS = 10;
/** Ask mode needs fewer iterations — it only reads, never writes. */
const ASK_MODE_MAX_ITERATIONS = 5;

// ── Planner gate ──
//
// The planner (thinking layer) runs on EVERY message when available.
// It classifies intent and decides what context the model needs.
// See docs/research/INTERACTION_LAYER_ARCHITECTURE.md for rationale.

// IDefaultParticipantServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IDefaultParticipantServices } from '../chatTypes.js';

/** Default participant ID — must match ChatAgentService's DEFAULT_AGENT_ID. */
const DEFAULT_PARTICIPANT_ID = 'parallx.chat.default';

/**
 * Create the default chat participant.
 *
 * Returns an IDisposable that holds the participant descriptor.
 * The caller (chatTool.ts) registers this with IChatAgentService.
 */
export function createDefaultParticipant(services: IDefaultParticipantServices): IChatParticipant & IDisposable {

  const configMaxIterations = services.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  const commandRegistry = createDefaultCommandRegistry(services);

  const handler: IChatParticipantHandler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {
    const interpretation = interpretChatParticipantRequest('default', request);

    // ── Mode capability enforcement ──

    const capabilities = getModeCapabilities(request.mode);

    // Ask mode: fewer iterations (read-only context gathering), Agent: full budget
    const maxIterations = capabilities.canAutonomous
      ? configMaxIterations
      : Math.min(configMaxIterations, ASK_MODE_MAX_ITERATIONS);

    // ── /init command handler (M11 Task 1.6) ──

    const initResult = await tryHandleDefaultInitCommand(services, interpretation.commandName, response);
    if (initResult) {
      return initResult;
    }

    const {
      interpretation: resolvedInterpretation,
      slashResult,
      effectiveText,
      activeCommand,
      hasActiveSlashCommand,
      handledEarlyAnswer,
      mentionPills,
      mentionContextBlocks,
      userText,
      contextQueryText,
      isRagReady,
      turnRoute,
      contextPlan,
      retrievalPlan,
      isConversationalTurn,
      queryScope,
      activatedSkill,
    } = await resolveDefaultChatTurnInterpretation(services, {
      request,
      context,
      response,
      token,
      parseSlashCommand: commandRegistry.parseSlashCommand,
    });

    // ── /compact command handler (M11 Task 3.8) ──
    //
    // Summarize conversation history and replace old messages with a compact summary.
    // Shows token savings to the user.
    if (await tryHandleDefaultCompactCommand(services, {
      activeCommand,
      slashSpecialHandler: slashResult.command?.specialHandler,
      context,
      response,
    })) {
      return {};
    }

    if (handledEarlyAnswer) {
      return {};
    }

    const aiProfile = services.aiSettingsService?.getActiveProfile();

    const { messages } = await assembleChatTurnMessages(services, {
      mode: request.mode,
      history: context.history,
    });

    // ── Build user message with implicit context + attachments ──
    //
    // Following VS Code's implicit context pattern (chatImplicitContext.ts):
    // The content of the currently open page is injected directly into the user
    // message so the model can reference it without a tool call (zero round-trips).

    // ── Latency instrumentation (M17 Task 0.2.7) ──
    const _t0_contextAssembly = performance.now();
    // ── M38: Planned evidence pipeline ──
    //
    // For non-generic workflows, build an execution plan, gather typed
    // evidence, and compute coverage.  For generic-grounded, these are
    // no-ops — the existing context flow runs unchanged (Task 5.2).
    const {
      turnRoute: preparedTurnRoute,
      contextPlan: preparedContextPlan,
      contextParts,
      ragSources,
      retrievedContextText,
      evidenceAssessment,
      provenance,
      memoryResult,
      coverageRecord,
    } = await resolveDefaultPreparedTurnContext(services, {
      mentionPills,
      mentionContextBlocks,
      userText,
      contextQueryText,
      isRagReady,
      turnRoute,
      contextPlan,
      retrievalPlan,
      isConversationalTurn,
      queryScope,
      sessionId: context.sessionId,
      messages,
      attachments: request.attachments,
      activatedSkill,
      hasActiveSlashCommand,
      assessEvidenceSufficiency: _assessEvidenceSufficiency,
      buildRetrieveAgainQuery: _buildRetrieveAgainQuery,
    });
    writeChatProvenanceToResponse(response, provenance);

    // Latency: context assembly complete (M17 Task 0.2.7)
    const _t1_contextAssembly = performance.now();
    console.debug(`[Parallx:latency] Context assembly: ${(_t1_contextAssembly - _t0_contextAssembly).toFixed(1)}ms`);

    return executeDefaultPreparedTurn(services, {
      request,
      context,
      response,
      token,
      messages,
      slashResult,
      turnRoute: preparedTurnRoute,
      effectiveText,
      userText,
      contextParts,
      retrievalPlan,
      evidenceAssessment,
      coverageRecord,
      resolvedRequestText: resolvedInterpretation.rawText,
      capabilities,
      aiProfile,
      retrievedContextText,
      memoryResult,
      isConversationalTurn,
      citationMode: preparedContextPlan.citationMode,
      ragSources,
      maxIterations,
      applyCommandTemplate: commandRegistry.applyCommandTemplate,
      buildEvidenceResponseConstraint: _buildEvidenceResponseConstraint,
      repairMarkdown: (markdown, userContent) => applyChatAnswerRepairPipeline(
        {
          repairGroundedAnswerTypography: _repairGroundedAnswerTypography,
          repairUnsupportedWorkspaceTopicAnswer: _repairUnsupportedWorkspaceTopicAnswer,
          repairUnsupportedSpecificCoverageAnswer: _repairUnsupportedSpecificCoverageAnswer,
          repairVehicleInfoAnswer: _repairVehicleInfoAnswer,
          repairAgentContactAnswer: _repairAgentContactAnswer,
          repairDeductibleConflictAnswer: _repairDeductibleConflictAnswer,
          repairTotalLossThresholdAnswer: _repairTotalLossThresholdAnswer,
          repairGroundedCodeAnswer: _repairGroundedCodeAnswer,
        },
        {
          query: request.text,
          markdown,
          retrievedContextText: retrievedContextText || userContent,
          evidenceAssessment,
          coverageRecord,
        },
      ),
      buildExtractiveFallbackAnswer: _buildExtractiveFallbackAnswer,
      buildMissingCitationFooter: _buildMissingCitationFooter,
      buildDeterministicSessionSummary: _buildDeterministicSessionSummary,
      parseEditResponse: _parseEditResponse,
      extractToolCallsFromText: _extractToolCallsFromText,
      stripToolNarration: _stripToolNarration,
      categorizeError: categorizeChatRequestError,
    });
  };

  // Build participant descriptor
  const participant: IChatParticipant & IDisposable = {
    id: DEFAULT_PARTICIPANT_ID,
    displayName: 'Chat',
    description: 'Default chat participant — sends messages to the active language model.',
    commands: [
      { name: 'init', description: 'Scan workspace and generate AGENTS.md' },
      { name: 'explain', description: 'Explain how code or a concept works' },
      { name: 'fix', description: 'Find and fix problems in the code' },
      { name: 'test', description: 'Generate tests for the code' },
      { name: 'doc', description: 'Generate documentation or comments' },
      { name: 'review', description: 'Code review — suggest improvements' },
      { name: 'compact', description: 'Summarize conversation to free token budget' },
    ],
    handler,
    dispose: () => {
      // No-op cleanup — the participant is just a descriptor
    },
  };

  return participant;
}

