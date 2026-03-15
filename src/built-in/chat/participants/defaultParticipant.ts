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
  IInitCommandServices,
} from '../chatTypes.js';
import { getModeCapabilities } from '../config/chatModeCapabilities.js';
import { executeInitCommand } from '../commands/initCommand.js';
import { determineChatTurnRoute } from '../utilities/chatTurnRouter.js';
import { tryExecuteCompactChatCommand } from '../utilities/chatCompactCommand.js';
import { applyChatAnswerRepairPipeline } from '../utilities/chatAnswerRepairPipeline.js';
import { buildExecutionPlan } from '../utilities/chatExecutionPlanner.js';
import { gatherEvidence, computeCoverage } from '../utilities/chatEvidenceGatherer.js';
import { buildExecutionPlanPromptSection, buildSkillInstructionSection } from '../config/chatSystemPrompts.js';
import { handleEarlyDeterministicAnswer, handlePreparedContextDeterministicAnswer } from '../utilities/chatDeterministicResponse.js';
import {
  assessEvidenceSufficiency as _assessEvidenceSufficiency,
  buildDeterministicSessionSummary as _buildDeterministicSessionSummary,
  buildEvidenceResponseConstraint as _buildEvidenceResponseConstraint,
  buildExtractiveFallbackAnswer as _buildExtractiveFallbackAnswer,
  buildFollowUpRetrievalQuery,
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
import { buildChatTurnExecutionConfig } from '../utilities/chatTurnExecutionConfig.js';
import { prepareChatTurnPrelude } from '../utilities/chatTurnPrelude.js';
import { resolveChatTurnEntryRouting } from '../utilities/chatTurnEntryRouting.js';
import { applyChatTurnBudgeting } from '../utilities/chatTurnBudgeting.js';
import { assembleChatTurnMessages } from '../utilities/chatTurnMessageAssembly.js';
import { composeChatUserContent } from '../utilities/chatUserContentComposer.js';
import { prepareChatTurnContext, writeChatProvenanceToResponse } from '../utilities/chatTurnContextPreparation.js';
import { executePreparedChatTurn } from '../utilities/chatTurnSynthesis.js';
import { SlashCommandRegistry, parseSlashCommand } from '../config/chatSlashCommands.js';
import { loadUserCommands } from '../utilities/userCommandLoader.js';
import { matchWorkflowSkill, activateSkill } from '../utilities/chatSkillMatcher.js';
import type { IActivatedSkill } from '../chatTypes.js';

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

  // ── Slash command registry (M11 Tasks 3.5–3.7) ──
  const commandRegistry = new SlashCommandRegistry();

  // Load user-defined commands from .parallx/commands/ (fire-and-forget)
  if (services.userCommandFileSystem) {
    loadUserCommands(services.userCommandFileSystem).then((cmds) => {
      if (cmds.length > 0) {
        commandRegistry.registerCommands(cmds);
      }
    }).catch(() => { /* best-effort */ });
  }

  // ── M39: Register workflow skills as slash commands ──
  //
  // Every workflow skill with userInvocable !== false gets a /skill-name
  // slash command. The special handler 'skill' triggers direct activation.
  {
    const catalog = services.getWorkflowSkillCatalog?.() ?? [];
    const skillCommands = catalog
      .filter(s => s.kind === 'workflow')
      .map(s => ({
        name: s.name,
        description: s.description,
        promptTemplate: '',
        isBuiltIn: false,
        specialHandler: 'skill',
      }));
    if (skillCommands.length > 0) {
      commandRegistry.registerCommands(skillCommands);
    }
  }

  const handler: IChatParticipantHandler = async (
    request: IChatParticipantRequest,
    context: IChatParticipantContext,
    response: IChatResponseStream,
    token: ICancellationToken,
  ): Promise<IChatParticipantResult> => {

    // ── Mode capability enforcement ──

    const capabilities = getModeCapabilities(request.mode);

    // Ask mode: fewer iterations (read-only context gathering), Agent: full budget
    const maxIterations = capabilities.canAutonomous
      ? configMaxIterations
      : Math.min(configMaxIterations, ASK_MODE_MAX_ITERATIONS);

    // ── /init command handler (M11 Task 1.6) ──

    if (request.command === 'init') {
      const initServices: IInitCommandServices = {
        sendChatRequest: services.sendChatRequest,
        getWorkspaceName: services.getWorkspaceName,
        listFiles: services.listFilesRelative
          ? (rel) => services.listFilesRelative!(rel)
          : undefined,
        readFile: services.readFileRelative
          ? (rel) => services.readFileRelative!(rel)
          : undefined,
        writeFile: services.writeFileRelative
          ? (rel, content) => services.writeFileRelative!(rel, content)
          : undefined,
        exists: services.existsRelative
          ? (rel) => services.existsRelative!(rel)
          : undefined,
        invalidatePromptFiles: services.invalidatePromptFiles,
      };
      await executeInitCommand(initServices, response);
      return {};
    }

    const earlyIsRagReady = services.isRAGAvailable?.() ?? false;
    const {
      slashResult,
      effectiveText,
      activeCommand,
      hasActiveSlashCommand,
      handled: handledEarlyAnswer,
    } = resolveChatTurnEntryRouting({
      parseSlashCommand: (text) => parseSlashCommand(text, commandRegistry),
      determineChatTurnRoute,
      handleEarlyDeterministicAnswer: (options) => handleEarlyDeterministicAnswer({
        ...options,
        sessionId: options.sessionId ?? context.sessionId,
      }),
    }, {
      requestText: request.text,
      requestCommand: request.command,
      isRagReady: earlyIsRagReady,
      sessionId: context.sessionId,
      response,
      token,
      reportRuntimeTrace: services.reportRuntimeTrace,
      reportResponseDebug: services.reportResponseDebug,
    });

    // ── /compact command handler (M11 Task 3.8) ──
    //
    // Summarize conversation history and replace old messages with a compact summary.
    // Shows token savings to the user.
    if (await tryExecuteCompactChatCommand({
      sendSummarizationRequest: services.sendSummarizationRequest,
      compactSession: services.compactSession,
    }, {
      isCompactCommand: activeCommand === 'compact' || slashResult.command?.specialHandler === 'compact',
      sessionId: context.sessionId,
      history: context.history,
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
    const {
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
    } = await prepareChatTurnPrelude(
      services,
      {
        buildFollowUpRetrievalQuery,
      },
      {
        requestText: request.text,
        history: context.history,
        sessionId: context.sessionId,
        hasActiveSlashCommand,
      },
    );

    // ── M38: Planned evidence pipeline ──
    //
    // For non-generic workflows, build an execution plan, gather typed
    // evidence, and compute coverage.  For generic-grounded, these are
    // no-ops — the existing context flow runs unchanged (Task 5.2).
    const executionPlan = buildExecutionPlan(turnRoute, queryScope);
    const isPlannedWorkflow = executionPlan.workflowType !== 'generic-grounded';

    const evidenceBundle = isPlannedWorkflow
      ? await gatherEvidence(executionPlan, contextQueryText, {
          listFilesRelative: services.listFilesRelative,
          readFileRelative: services.readFileRelative,
          retrieveContext: services.retrieveContext,
        })
      : undefined;

    const coverageRecord = evidenceBundle
      ? computeCoverage(evidenceBundle)
      : undefined;

    // Append execution plan context to the system message so the model
    // knows the scope and workflow constraints for this turn.
    const planPromptSection = buildExecutionPlanPromptSection(executionPlan, queryScope, coverageRecord);
    if (planPromptSection && messages.length > 0 && messages[0].role === 'system') {
      messages[0] = { ...messages[0], content: messages[0].content + planPromptSection };
    }

    // ── M39: Skill matching & activation ──
    //
    // Two activation paths:
    // 1. Slash command: /skill-name bypasses the matcher, directly activates
    // 2. Planner: deterministic tag+keyword matching against the route
    const skillCatalog = services.getWorkflowSkillCatalog?.() ?? [];
    const isSkillSlashCommand = slashResult.command?.specialHandler === 'skill';

    let activatedSkill: IActivatedSkill | undefined;

    if (isSkillSlashCommand && slashResult.commandName) {
      // Path 1: User explicit slash command → direct activation
      const manifest = services.getSkillManifest?.(slashResult.commandName);
      if (manifest) {
        activatedSkill = activateSkill(manifest, effectiveText, 'user', queryScope);
      }
    } else if (skillCatalog.length > 0) {
      // Path 2: Planner-driven matching
      const skillMatch = matchWorkflowSkill(userText, turnRoute, queryScope, skillCatalog);
      if (skillMatch.matched && skillMatch.skill) {
        const manifest = services.getSkillManifest?.(skillMatch.skill.name);
        if (manifest) {
          activatedSkill = activateSkill(manifest, userText, 'planner', queryScope);
        }
      }
    }

    // Inject activated skill instructions into the system prompt
    if (activatedSkill && messages.length > 0 && messages[0].role === 'system') {
      messages[0] = {
        ...messages[0],
        content: messages[0].content + buildSkillInstructionSection(activatedSkill),
      };
    }

    const {
      contextParts,
      ragSources,
      retrievedContextText,
      evidenceAssessment,
      provenance,
      memoryResult,
    } = await prepareChatTurnContext(
      {
        getCurrentPageContent: services.getCurrentPageContent,
        retrieveContext: services.retrieveContext,
        recallMemories: services.recallMemories,
        recallTranscripts: services.recallTranscripts,
        recallConcepts: services.recallConcepts,
        readFileContent: services.readFileContent,
        reportRetrievalDebug: services.reportRetrievalDebug,
        reportContextPills: services.reportContextPills,
        getExcludedContextIds: services.getExcludedContextIds,
        assessEvidenceSufficiency: _assessEvidenceSufficiency,
        buildRetrieveAgainQuery: _buildRetrieveAgainQuery,
      },
      {
        contextQueryText,
        sessionId: context.sessionId,
        attachments: request.attachments,
        messages,
        mentionPills,
        mentionContextBlocks,
        contextPlan,
        hasActiveSlashCommand,
        isRagReady,
        evidenceBundle,
      },
    );
    writeChatProvenanceToResponse(response, provenance);

    if (handlePreparedContextDeterministicAnswer({
      route: turnRoute,
      query: userText,
      evidenceAssessment,
      retrievedContextText,
      memoryResult,
      ragSources,
      response,
      token,
      reportResponseDebug: services.reportResponseDebug,
    })) {
      return {};
    }

    applyChatTurnBudgeting({
      messages,
      contextParts,
      userText,
      response,
      contextWindow: services.getModelContextLength?.(),
      elasticBudget: services.unifiedConfigService?.getEffectiveConfig().retrieval.contextBudget,
      reportBudget: services.reportBudget,
    });

    // 3. Compose final user message (use userText — mentions stripped)
    //
    // If a slash command was detected, apply its prompt template now
    // (substituting {input} and {context}).
    //
    // M12: If a retrieval plan is available, inject a reasoning hint so the
    // LLM understands the user's INTENT, not just their literal words.
    const userContent = composeChatUserContent(
      {
        applyCommandTemplate: (command, input, contextContent) => commandRegistry.applyTemplate(command, input, contextContent),
        buildEvidenceResponseConstraint: _buildEvidenceResponseConstraint,
      },
      {
        slashResult,
        effectiveText,
        userText,
        contextParts,
        retrievalPlan,
        evidenceAssessment,
        coverageRecord,
      },
    );

    messages.push({
      role: 'user',
      content: userContent,
      images: request.attachments?.filter(isChatImageAttachment),
    });

    // Latency: context assembly complete (M17 Task 0.2.7)
    const _t1_contextAssembly = performance.now();
    console.debug(`[Parallx:latency] Context assembly: ${(_t1_contextAssembly - _t0_contextAssembly).toFixed(1)}ms`);

    const { synthesisDeps, synthesisOptions } = buildChatTurnExecutionConfig(services, {
      requestMode: request.mode,
      requestText: request.text,
      capabilities,
      aiProfile,
      messages,
      userContent,
      retrievedContextText,
      evidenceAssessment,
      isConversationalTurn,
      citationMode: contextPlan.citationMode,
      ragSources,
      retrievalPlan,
      sessionId: context.sessionId,
      history: context.history,
      response,
      token,
      maxIterations,
      repairMarkdown: (markdown) => applyChatAnswerRepairPipeline(
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

    return executePreparedChatTurn(synthesisDeps, synthesisOptions);
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

