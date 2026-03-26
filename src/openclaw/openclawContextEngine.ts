/**
 * Context engine for the OpenClaw execution pipeline.
 *
 * Upstream evidence:
 *   - context-engine/types.ts:104-230 — ContextEngine interface with lifecycle methods
 *   - attempt.context-engine-helpers.ts:52-73 — tokenBudget passed to assemble()
 *   - agent-runner-execution.ts — compactEmbeddedPiSession called on overflow
 *
 * Parallx adaptation:
 *   - Uses platform services: retrieveContext (RAG), recallMemories, recallConcepts
 *   - M11 token budget: System 10%, RAG 30%, History 30%, User 30%
 *   - M9: Token estimation chars / 4
 *   - History from IChatParticipantContext (VS Code chat participant model)
 */

import type { IChatMessage } from '../services/chatTypes.js';
import type { IDefaultParticipantServices } from './openclawTypes.js';
import { computeTokenBudget, estimateTokens, estimateMessagesTokens } from './openclawTokenBudget.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parallx adaptation of upstream ContextEngine (context-engine/types.ts:104-230).
 *
 * Upstream methods mapped:
 *   assemble → assemble  (build context under budget)
 *   compact  → compact   (reduce context on overflow)
 *   afterTurn → afterTurn (post-turn persistence)
 *
 * Upstream methods NOT adopted (with reason):
 *   bootstrap — Parallx bootstraps via platform (bootstrap files loaded separately)
 *   maintain  — Transcript maintenance handled by compact
 *   ingest/ingestBatch — Platform handles message persistence
 *   prepareSubagentSpawn/onSubagentEnded — No subagents in Parallx
 *   dispose — Engine is per-turn, not long-lived
 */
export interface IOpenclawContextEngine {
  assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult>;
  compact(params: IOpenclawCompactParams): Promise<IOpenclawCompactResult>;
  afterTurn?(params: IOpenclawAfterTurnParams): Promise<void>;
}

export interface IOpenclawAssembleParams {
  readonly sessionId: string;
  readonly history: readonly IChatMessage[];
  readonly tokenBudget: number;
  readonly prompt: string;
}

/**
 * Mirrors upstream AssembleResult from context-engine/types.ts.
 *
 * The engine builds the message array to fit within the provided budget.
 * The pipeline uses messages directly — no further transformation needed.
 */
export interface IOpenclawAssembleResult {
  readonly messages: IChatMessage[];
  readonly estimatedTokens: number;
  readonly systemPromptAddition?: string;
  readonly ragSources: readonly { uri: string; label: string; index: number }[];
}

export interface IOpenclawCompactParams {
  readonly sessionId: string;
  readonly tokenBudget: number;
  readonly force?: boolean;
}

/**
 * Mirrors upstream CompactResult from context-engine/types.ts.
 */
export interface IOpenclawCompactResult {
  readonly compacted: boolean;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
}

export interface IOpenclawAfterTurnParams {
  readonly sessionId: string;
  readonly messages: readonly IChatMessage[];
}

// ---------------------------------------------------------------------------
// Services subset needed by the context engine
// ---------------------------------------------------------------------------

/** The minimum set of platform services the context engine needs. */
export type IOpenclawContextEngineServices = Pick<
  IDefaultParticipantServices,
  | 'retrieveContext'
  | 'recallMemories'
  | 'recallConcepts'
  | 'storeSessionMemory'
  | 'storeConceptsFromSession'
  | 'compactSession'
  | 'sendSummarizationRequest'
>;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Context engine implementation for Parallx.
 *
 * Uses platform retrieval services for RAG, and the M11 token budget
 * to fit context within the model's window.
 */
export class OpenclawContextEngine implements IOpenclawContextEngine {
  constructor(private readonly services: IOpenclawContextEngineServices) {}

  async assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult> {
    const budget = computeTokenBudget(params.tokenBudget);
    const messages: IChatMessage[] = [];
    let ragSources: { uri: string; label: string; index: number }[] = [];
    let systemPromptAddition: string | undefined;

    // ── RAG: retrieve workspace context relevant to prompt ──
    // Upstream: ContextEngine.assemble builds messages under budget
    // Parallx: uses services.retrieveContext for hybrid vector + FTS5 retrieval
    if (this.services.retrieveContext) {
      const ragResult = await this.services.retrieveContext(params.prompt);
      if (ragResult) {
        const ragTokens = estimateTokens(ragResult.text);
        if (ragTokens <= budget.rag) {
          systemPromptAddition = `## Retrieved Context\n${ragResult.text}`;
          ragSources = ragResult.sources.map((s, i) => ({
            uri: s.uri,
            label: s.label,
            index: s.index ?? i,
          }));
        } else {
          // Trim RAG context to fit budget
          const maxChars = budget.rag * 4; // tokens * 4 = chars (inverse of chars/4)
          const trimmedText = ragResult.text.slice(0, maxChars);
          systemPromptAddition = `## Retrieved Context\n${trimmedText}`;
          ragSources = ragResult.sources.map((s, i) => ({
            uri: s.uri,
            label: s.label,
            index: s.index ?? i,
          }));
        }
      }
    }

    // ── Memory: recall relevant memories ──
    if (this.services.recallMemories) {
      const memoryResult = await this.services.recallMemories(params.prompt, params.sessionId);
      if (memoryResult) {
        const memoryTokens = estimateTokens(memoryResult);
        // Memory fits within RAG budget allocation (shared with RAG)
        if (memoryTokens < budget.rag * 0.2) { // max 20% of RAG budget for memory
          systemPromptAddition = (systemPromptAddition ?? '') +
            `\n\n## Recalled Memories\n${memoryResult}`;
        }
      }
    }

    // ── Concepts: recall relevant concepts ──
    if (this.services.recallConcepts) {
      const conceptResult = await this.services.recallConcepts(params.prompt);
      if (conceptResult) {
        const conceptTokens = estimateTokens(conceptResult);
        if (conceptTokens < budget.rag * 0.1) { // max 10% of RAG budget for concepts
          systemPromptAddition = (systemPromptAddition ?? '') +
            `\n\n## Concepts\n${conceptResult}`;
        }
      }
    }

    // ── History: trim conversation history to fit budget ──
    // Keep most recent messages that fit within the history budget
    const historyMessages = trimHistoryToBudget(params.history, budget.history);
    messages.push(...historyMessages);

    const estimatedTokens = estimateMessagesTokens(messages) +
      (systemPromptAddition ? estimateTokens(systemPromptAddition) : 0);

    return {
      messages,
      estimatedTokens,
      systemPromptAddition: systemPromptAddition || undefined,
      ragSources,
    };
  }

  async compact(params: IOpenclawCompactParams): Promise<IOpenclawCompactResult> {
    // Upstream: compactEmbeddedPiSession from agent-runner-execution.ts
    // Summarize older history to reduce token count.
    // Platform provides compactSession which replaces older turns with a summary.

    if (this.services.compactSession && this.services.sendSummarizationRequest) {
      // The platform's compactSession handles the actual summarization
      // We just need to trigger it and measure the result
      const before = params.tokenBudget; // approximate — actual tokens tracked by caller
      this.services.compactSession(params.sessionId, '[compacted by context engine]');
      const after = Math.floor(before * 0.6); // conservative estimate of compaction effect
      return { compacted: true, tokensBefore: before, tokensAfter: after };
    }

    return { compacted: false, tokensBefore: params.tokenBudget, tokensAfter: params.tokenBudget };
  }

  async afterTurn(_params: IOpenclawAfterTurnParams): Promise<void> {
    // Upstream: finalize step commits context mutations
    // Parallx: platform handles message persistence automatically
    // Memory write-back is handled separately by the participant lifecycle
    // This hook exists for future extensions (e.g., concept extraction from turn)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Trim conversation history to fit within a token budget.
 *
 * Keeps the most recent messages. Drops oldest messages first.
 * This matches the upstream pattern where context overflow triggers
 * compaction of older turns.
 */
function trimHistoryToBudget(
  history: readonly IChatMessage[],
  budgetTokens: number,
): IChatMessage[] {
  if (history.length === 0) {
    return [];
  }

  // Build from the end (most recent first), stop when budget exceeded
  const result: IChatMessage[] = [];
  let usedTokens = 0;

  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    const msgTokens = 4 + estimateTokens(msg.content); // 4 for role overhead
    if (usedTokens + msgTokens > budgetTokens) {
      break;
    }
    result.unshift(msg);
    usedTokens += msgTokens;
  }

  return result;
}
