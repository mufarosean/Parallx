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
import { assessEvidence, buildEvidenceConstraint } from './openclawResponseValidation.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Parallx adaptation of upstream ContextEngine (context-engine/types.ts:104-230).
 *
 * Upstream methods mapped:
 *   bootstrap → bootstrap (one-time per-turn initialization)
 *   assemble → assemble  (build context under budget)
 *   compact  → compact   (reduce context on overflow)
 *   afterTurn → afterTurn (post-turn persistence)
 *
 * Upstream methods NOT adopted (with reason):
 *   maintain  — Transcript maintenance handled by compact
 *   ingest/ingestBatch — Platform handles message persistence
 *   prepareSubagentSpawn/onSubagentEnded — No subagents in Parallx
 *   dispose — Engine is per-turn, not long-lived
 */
export interface IOpenclawContextEngine {
  bootstrap?(params: IOpenclawBootstrapParams): Promise<IOpenclawBootstrapResult>;
  assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult>;
  compact(params: IOpenclawCompactParams): Promise<IOpenclawCompactResult>;
  afterTurn?(params: IOpenclawAfterTurnParams): Promise<void>;
}

export interface IOpenclawBootstrapParams {
  readonly sessionId: string;
  readonly tokenBudget: number;
}

/**
 * Result from bootstrap — reports service readiness so assemble()
 * can skip unavailable services instead of calling them and failing.
 */
export interface IOpenclawBootstrapResult {
  readonly ragReady: boolean;
  readonly memoryReady: boolean;
  readonly conceptsReady: boolean;
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
  readonly retrievedContextText: string;
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
  | 'recallTranscripts'
  | 'getCurrentPageContent'
  | 'storeSessionMemory'
  | 'storeConceptsFromSession'
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
  /** Cached history from the most recent `assemble()` call (used by `compact()`). */
  private _lastHistory: readonly IChatMessage[] = [];
  /** Service readiness state set by bootstrap(). */
  private _ragReady = true;
  private _memoryReady = true;
  private _conceptsReady = true;
  private _transcriptsReady = true;
  private _pageReady = true;

  constructor(private readonly services: IOpenclawContextEngineServices) {}

  /**
   * One-time per-turn initialization.
   *
   * Upstream: runAttemptContextEngineBootstrap (attempt.context-engine-helpers.ts)
   * Checks which services are available so assemble() can skip unavailable ones
   * rather than making calls that will fail.
   */
  async bootstrap(_params: IOpenclawBootstrapParams): Promise<IOpenclawBootstrapResult> {
    this._ragReady = !!this.services.retrieveContext;
    this._memoryReady = !!this.services.recallMemories;
    this._conceptsReady = !!this.services.recallConcepts;
    this._transcriptsReady = !!this.services.recallTranscripts;
    this._pageReady = !!this.services.getCurrentPageContent;

    return {
      ragReady: this._ragReady,
      memoryReady: this._memoryReady,
      conceptsReady: this._conceptsReady,
    };
  }

  async assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult> {
    // Cache history for use by compact() — upstream pattern couples assemble/compact state
    this._lastHistory = params.history;

    const budget = computeTokenBudget(params.tokenBudget);
    const messages: IChatMessage[] = [];
    let ragSources: { uri: string; label: string; index: number }[] = [];
    let systemPromptAddition: string | undefined;
    let retrievedContextText = '';

    // ── C1: Parallel loading — fire all retrieval services concurrently ──
    const [ragResult, memoryResult, conceptResult, pageResult, transcriptResult] = await Promise.all([
      (this._ragReady && this.services.retrieveContext)
        ? this.services.retrieveContext(params.prompt).catch(() => undefined)
        : Promise.resolve(undefined),
      (this._memoryReady && this.services.recallMemories)
        ? this.services.recallMemories(params.prompt, params.sessionId).catch(() => undefined)
        : Promise.resolve(undefined),
      (this._conceptsReady && this.services.recallConcepts)
        ? this.services.recallConcepts(params.prompt).catch(() => undefined)
        : Promise.resolve(undefined),
      (this._pageReady && this.services.getCurrentPageContent)
        ? this.services.getCurrentPageContent().catch(() => undefined)
        : Promise.resolve(undefined),
      (this._transcriptsReady && this.services.recallTranscripts)
        ? this.services.recallTranscripts(params.prompt).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);

    // ── C2: Page content — inject currently open editor page ──
    if (pageResult?.textContent) {
      const pageTokens = estimateTokens(pageResult.textContent);
      if (pageTokens <= budget.rag * 0.3) { // max 30% of RAG budget for page
        const pageHeader = `## Currently Open Page: "${pageResult.title}" (id: ${pageResult.pageId})`;
        systemPromptAddition = `${pageHeader}\n${pageResult.textContent}`;
      }
    }

    // ── RAG: retrieve workspace context relevant to prompt ──
    if (ragResult) {
      retrievedContextText = ragResult.text;
      const ragTokens = estimateTokens(ragResult.text);
      const maxRagChars = budget.rag * 4;
      const contextText = ragTokens <= budget.rag
        ? ragResult.text
        : ragResult.text.slice(0, maxRagChars);
      systemPromptAddition = (systemPromptAddition ?? '') + `\n\n## Retrieved Context\n${contextText}`;
      ragSources = ragResult.sources.map((s, i) => ({
        uri: s.uri,
        label: s.label,
        index: s.index ?? i,
      }));
    }

    // ── Memory: recall relevant memories ──
    if (memoryResult) {
      const memoryTokens = estimateTokens(memoryResult);
      if (memoryTokens < budget.rag * 0.2) {
        systemPromptAddition = (systemPromptAddition ?? '') +
          `\n\n## Recalled Memories\n${memoryResult}`;
      }
    }

    // ── Concepts: recall relevant concepts ──
    if (conceptResult) {
      const conceptTokens = estimateTokens(conceptResult);
      if (conceptTokens < budget.rag * 0.1) {
        systemPromptAddition = (systemPromptAddition ?? '') +
          `\n\n## Concepts\n${conceptResult}`;
      }
    }

    // ── C4: Transcript recall ──
    if (transcriptResult) {
      const transcriptTokens = estimateTokens(transcriptResult);
      if (transcriptTokens < budget.rag * 0.15) { // max 15% of RAG budget for transcripts
        systemPromptAddition = (systemPromptAddition ?? '') +
          `\n\n## Recalled Transcripts\n${transcriptResult}`;
      }
    }

    // ── M5 + C5: Assess evidence quality; re-retrieve on insufficient ──
    if (retrievedContextText.trim()) {
      let evidence = assessEvidence(params.prompt, retrievedContextText, ragSources);
      // C5: Re-retrieval — when evidence is insufficient, reformulate and try again
      if (evidence.status === 'insufficient' && this._ragReady && this.services.retrieveContext) {
        const reQuery = buildRetrieveAgainQuery(params.prompt, evidence.reasons);
        if (reQuery) {
          const reResult = await this.services.retrieveContext(reQuery).catch(() => undefined);
          if (reResult?.text) {
            // Merge re-retrieved context
            retrievedContextText = retrievedContextText + '\n\n' + reResult.text;
            const combinedTokens = estimateTokens(retrievedContextText);
            const maxChars = budget.rag * 4;
            const combinedText = combinedTokens <= budget.rag
              ? retrievedContextText
              : retrievedContextText.slice(0, maxChars);
            systemPromptAddition = (systemPromptAddition ?? '').replace(
              /\n\n## Retrieved Context\n[\s\S]*?(?=\n\n##|$)/,
              `\n\n## Retrieved Context\n${combinedText}`,
            );
            // Merge sources, dedup by uri
            const existingUris = new Set(ragSources.map(s => s.uri));
            for (const s of reResult.sources) {
              if (!existingUris.has(s.uri)) {
                ragSources.push({ uri: s.uri, label: s.label, index: ragSources.length });
              }
            }
            // Re-assess with augmented context
            evidence = assessEvidence(params.prompt, retrievedContextText, ragSources);
          }
        }
      }
      if (evidence.status !== 'sufficient') {
        const constraint = buildEvidenceConstraint(params.prompt, evidence);
        systemPromptAddition = (systemPromptAddition ?? '') + `\n\n${constraint}`;
      }
    }

    // ── History: trim conversation history to fit budget ──
    const historyMessages = trimHistoryToBudget(params.history, budget.history);
    messages.push(...historyMessages);

    const estimatedTokens = estimateMessagesTokens(messages) +
      (systemPromptAddition ? estimateTokens(systemPromptAddition) : 0);

    return {
      messages,
      estimatedTokens,
      systemPromptAddition: systemPromptAddition || undefined,
      ragSources,
      retrievedContextText,
    };
  }

  async compact(params: IOpenclawCompactParams): Promise<IOpenclawCompactResult> {
    // Upstream pattern (agent-runner-execution.ts): context overflow triggers
    // summarization of older turns into a compact summary, then re-assemble
    // uses the trimmed history for the next model call.
    //
    // CRITICAL: upstream compaction is an INTERNAL context-assembly operation.
    // It trims the messages sent to the model, NOT the visible UI conversation.
    // Calling compactSession() here would destroy the user's visible chat —
    // that's only for the explicit /compact slash command.

    const history = this._lastHistory;
    const historyTokens = estimateMessagesTokens([...history]);

    if (history.length < 2) {
      return { compacted: false, tokensBefore: historyTokens, tokensAfter: historyTokens };
    }

    // Build a transcript of history for summarization
    const transcript = history
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    let summaryText = '';

    if (this.services.sendSummarizationRequest && transcript.length > 0) {
      // Generate a real summary via the model
      const summaryPrompt: IChatMessage[] = [
        {
          role: 'system',
          content: 'You are a conversation summarizer. Condense the following conversation history into a concise context summary. Preserve all key facts, decisions, code references, and action items. Output ONLY the summary.',
        },
        { role: 'user', content: transcript },
      ];

      try {
        for await (const chunk of this.services.sendSummarizationRequest(summaryPrompt)) {
          if (chunk.content) {
            summaryText += chunk.content;
          }
        }
        summaryText = summaryText.trim();
      } catch {
        // Summarization failed — fall back to placeholder
      }
    }

    if (!summaryText) {
      // Without a summarizer, do a simple trim: keep the most recent half of history
      const keepCount = Math.max(2, Math.floor(history.length / 2));
      this._lastHistory = history.slice(history.length - keepCount);
      const afterTokens = estimateMessagesTokens([...this._lastHistory]);
      return { compacted: true, tokensBefore: historyTokens, tokensAfter: afterTokens };
    }

    // Replace internal history with a single summary message + keep the last exchange
    const lastExchange = history.length >= 2 ? history.slice(-2) : [...history];
    this._lastHistory = [
      { role: 'user' as const, content: `[Context summary]\n${summaryText}` },
      { role: 'assistant' as const, content: 'Understood, I have the conversation context.' },
      ...lastExchange,
    ];

    const afterTokens = estimateMessagesTokens([...this._lastHistory]);

    // Auto-flush summary to long-term memory (upstream pattern: compaction → memory flush)
    if (this.services.storeSessionMemory && summaryText.length > 0) {
      const messageCount = history.length;
      try {
        await this.services.storeSessionMemory(params.sessionId, summaryText, messageCount);
      } catch {
        // Memory flush failure is non-fatal
      }
    }

    return { compacted: true, tokensBefore: historyTokens, tokensAfter: afterTokens };
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

// ---------------------------------------------------------------------------
// C5: Re-retrieval query reformulation
// ---------------------------------------------------------------------------

/**
 * Build a reformulated query for re-retrieval when evidence is insufficient.
 *
 * Strategy: strip question wrappers, extract core noun phrases,
 * and produce a keyword-focused search string that may retrieve
 * different chunks from the vector store.
 */
function buildRetrieveAgainQuery(
  originalQuery: string,
  reasons: readonly string[],
): string | undefined {
  // Only re-retrieve for meaningful gaps — skip if we simply have no sources at all
  if (reasons.includes('no-grounded-sources')) return undefined;

  // Strip question framing to extract core search terms
  const stripped = originalQuery
    .replace(/^(?:what|how|where|who|when|which|does|do|is|are|can|could|should|would|will|tell me|show me|explain)\s+/i, '')
    .replace(/\?+$/, '')
    .trim();

  if (stripped.length < 5) return undefined;

  // Add "details about" prefix to bias toward explanatory chunks
  return `details about ${stripped}`;
}
