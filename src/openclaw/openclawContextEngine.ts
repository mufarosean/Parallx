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
import { computeElasticBudget, estimateTokens, estimateMessagesTokens } from './openclawTokenBudget.js';
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
 *   maintain → maintain   (proactive transcript cleanup)
 *   afterTurn → afterTurn (post-turn persistence)
 *
 * Upstream methods NOT adopted (with reason):
 *   ingest/ingestBatch — Platform handles message persistence
 *   prepareSubagentSpawn/onSubagentEnded — No subagents in Parallx
 *   dispose — Engine is per-turn, not long-lived
 */
export interface IOpenclawContextEngine {
  bootstrap?(params: IOpenclawBootstrapParams): Promise<IOpenclawBootstrapResult>;
  assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult>;
  compact(params: IOpenclawCompactParams): Promise<IOpenclawCompactResult>;
  afterTurn?(params: IOpenclawAfterTurnParams): Promise<void>;
  maintain?(params: IOpenclawMaintainParams): Promise<IOpenclawMaintainResult>;
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

export interface IOpenclawMaintainParams {
  readonly sessionId: string;
  readonly tokenBudget: number;
  /** History to maintain — passed from the turn context so maintain()
   *  can operate before the first assemble() populates _lastHistory. */
  readonly history: readonly IChatMessage[];
}

export interface IOpenclawMaintainResult {
  readonly rewrites: number;
  readonly tokensBefore: number;
  readonly tokensAfter: number;
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
  /** Incremented on every compact() so assemble() can detect compaction regardless of length. */
  private _compactGeneration = 0;
  /** The generation seen by the last assemble() call. */
  private _lastAssembleGeneration = 0;
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
    // Use compacted/maintained history if available.
    // Upstream pattern: compact() mutates the engine's internal state, and the next
    // assemble() uses the compacted version — not the original from the participant.
    // We use a generation counter instead of length comparison because compact()
    // may produce the same number of messages (e.g., 2 summary + 2 last exchange).
    const effectiveHistory = (this._compactGeneration > this._lastAssembleGeneration)
      ? this._lastHistory
      : params.history;
    this._lastAssembleGeneration = this._compactGeneration;
    // Cache for compact() — always the history we're actually using
    this._lastHistory = effectiveHistory;

    const historyTokenEstimate = estimateMessagesTokens(effectiveHistory);
    const userTokenEstimate = estimateTokens(params.prompt);
    const budget = computeElasticBudget({
      contextWindow: params.tokenBudget,
      historyActual: historyTokenEstimate,
      userActual: userTokenEstimate,
    });
    const messages: IChatMessage[] = [];
    let ragSources: { uri: string; label: string; index: number }[] = [];
    let systemPromptAddition: string | undefined;
    let retrievedContextText = '';

    // ── Sub-lane budget allocation (normalized to 100% of RAG budget) ──
    // Upstream: context engine assembles content UNDER the token budget.
    // Sub-lanes must sum to ≤ 100% to prevent over-allocation.
    const ragLaneBudget = Math.floor(budget.rag * 0.55);     // 55% — primary retrieval
    const pageLaneBudget = Math.floor(budget.rag * 0.15);    // 15% — open page
    const memoryLaneBudget = Math.floor(budget.rag * 0.15);  // 15% — recalled memories
    const transcriptLaneBudget = Math.floor(budget.rag * 0.10); // 10% — transcripts
    const conceptLaneBudget = Math.floor(budget.rag * 0.05); // 5%  — concepts

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

    // ── Build retrieval context sections (delivered via messages, not systemPromptAddition) ──
    // Upstream pattern (context-engine/types.ts): AssembleResult.messages is the primary
    // delivery channel for context. systemPromptAddition is for lightweight metadata only.
    const contextSections: string[] = [];
    let usedRagTokens = 0;

    // ── C2: Page content — inject currently open editor page ──
    if (pageResult?.textContent) {
      const pageTokens = estimateTokens(pageResult.textContent);
      if (pageTokens <= pageLaneBudget) {
        const section = `## Currently Open Page: "${pageResult.title}" (id: ${pageResult.pageId})\n${pageResult.textContent}`;
        contextSections.push(section);
        usedRagTokens += pageTokens;
      }
    }

    // ── RAG: retrieve workspace context relevant to prompt ──
    if (ragResult?.text) {
      const ragTokens = estimateTokens(ragResult.text);
      const maxChars = ragLaneBudget * 4;
      const contextText = ragTokens <= ragLaneBudget
        ? ragResult.text
        : ragResult.text.slice(0, maxChars);
      if (contextText) {
        retrievedContextText = ragResult.text;
        contextSections.push(`## Retrieved Context\n${contextText}`);
        usedRagTokens += Math.min(ragTokens, ragLaneBudget);
      }
      ragSources = ragResult.sources.map((s, i) => ({
        uri: s.uri,
        label: s.label,
        index: s.index ?? i,
      }));
    }

    // ── Memory: recall relevant memories ──
    if (memoryResult) {
      const memoryTokens = estimateTokens(memoryResult);
      if (memoryTokens <= memoryLaneBudget && usedRagTokens + memoryTokens <= budget.rag) {
        contextSections.push(`## Recalled Memories\n${memoryResult}`);
        usedRagTokens += memoryTokens;
      }
    }

    // ── C4: Transcript recall ──
    if (transcriptResult) {
      const transcriptTokens = estimateTokens(transcriptResult);
      if (transcriptTokens <= transcriptLaneBudget && usedRagTokens + transcriptTokens <= budget.rag) {
        contextSections.push(`## Recalled Transcripts\n${transcriptResult}`);
        usedRagTokens += transcriptTokens;
      }
    }

    // ── Concepts: recall relevant concepts ──
    if (conceptResult) {
      const conceptTokens = estimateTokens(conceptResult);
      if (conceptTokens <= conceptLaneBudget && usedRagTokens + conceptTokens <= budget.rag) {
        contextSections.push(`## Concepts\n${conceptResult}`);
        usedRagTokens += conceptTokens;
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
            const maxChars = ragLaneBudget * 4;
            const combinedText = combinedTokens <= ragLaneBudget
              ? retrievedContextText
              : retrievedContextText.slice(0, maxChars);
            // Replace the RAG section in contextSections
            const ragIdx = contextSections.findIndex(s => s.startsWith('## Retrieved Context\n'));
            if (ragIdx >= 0) {
              contextSections[ragIdx] = `## Retrieved Context\n${combinedText}`;
            }
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
        systemPromptAddition = constraint;
      }
    }

    // ── Deliver retrieval content via messages (upstream pattern) ──
    // Upstream: AssembleResult.messages is the primary delivery channel.
    // RAG content goes in a context message BEFORE history, not in the system prompt.
    if (contextSections.length > 0) {
      messages.push({
        role: 'user' as const,
        content: `The following is retrieved context relevant to the conversation. Use it to inform your responses.\n\n${contextSections.join('\n\n---\n\n')}`,
      });
    }

    // ── History: trim conversation history to fit budget ──
    const historyMessages = trimHistoryToBudget(effectiveHistory, budget.history);
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

    if (history.length < 2 && !params.force) {
      return { compacted: false, tokensBefore: historyTokens, tokensAfter: historyTokens };
    }

    // Build a transcript of history for summarization
    const transcript = history
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n\n');

    let summaryText = '';

    // Only attempt summarization when history is long enough to benefit (>2 messages).
    // With ≤2 messages, summarizer prepends summary + ack to the existing messages,
    // which INCREASES context size rather than reducing it (F2-R2-04).
    if (this.services.sendSummarizationRequest && transcript.length > 0 && history.length > 2) {
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
      if (keepCount >= history.length) {
        // No actual reduction possible — report honestly (F2-R2-03)
        return { compacted: false, tokensBefore: historyTokens, tokensAfter: historyTokens };
      }
      this._lastHistory = history.slice(history.length - keepCount);
      this._compactGeneration++;
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
    this._compactGeneration++;

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

  /**
   * Proactive context maintenance — trims and cleans cached history
   * before the retry loop to keep context lean.
   *
   * Upstream evidence:
   *   - context-engine-maintenance.ts — rule-based transcript maintenance
   *
   * Rules applied (no model calls):
   *   1. Trim verbose tool results (>2000 chars → first 1500 + truncation marker)
   *   2. Remove redundant acknowledgment pairs (<20 chars, e.g. "Understood")
   *   3. Collapse duplicate [Context summary] messages — keep only the latest
   */
  async maintain(params: IOpenclawMaintainParams): Promise<IOpenclawMaintainResult> {
    // Use incoming history (from turn context) — _lastHistory may be empty before first assemble()
    const history = [...params.history] as IChatMessage[];
    const tokensBefore = estimateMessagesTokens(history);
    let rewrites = 0;

    // Rule 1: Trim verbose tool results (role 'tool' or content containing tool markers)
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const isToolResult = msg.role === 'tool' || msg.content.includes('```tool-result') || msg.content.includes('[tool-result]');
      if (isToolResult && msg.content.length > 2000) {
        history[i] = { ...msg, content: msg.content.slice(0, 1500) + '\n[... truncated]' };
        rewrites++;
      }
    }

    // Rule 2: Remove redundant acknowledgment pairs
    const ackPattern = /^(understood|got it|sure|ok|okay|alright|noted|yes|right)\.?$/i;
    const toRemove = new Set<number>();
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (msg.role === 'assistant' && msg.content.length < 20 && ackPattern.test(msg.content.trim())) {
        toRemove.add(i);
        rewrites++;
      }
    }
    if (toRemove.size > 0) {
      const filtered: IChatMessage[] = [];
      for (let i = 0; i < history.length; i++) {
        if (!toRemove.has(i)) {
          filtered.push(history[i]);
        }
      }
      history.length = 0;
      history.push(...filtered);
    }

    // Rule 3: Collapse duplicate [Context summary] messages — keep only the latest
    let lastSummaryIdx = -1;
    for (let i = 0; i < history.length; i++) {
      if (history[i].content.startsWith('[Context summary]')) {
        lastSummaryIdx = i;
      }
    }
    if (lastSummaryIdx > 0) {
      const summaryIndicesToRemove = new Set<number>();
      for (let i = 0; i < lastSummaryIdx; i++) {
        if (history[i].content.startsWith('[Context summary]')) {
          summaryIndicesToRemove.add(i);
          rewrites++;
        }
      }
      if (summaryIndicesToRemove.size > 0) {
        const filtered: IChatMessage[] = [];
        for (let i = 0; i < history.length; i++) {
          if (!summaryIndicesToRemove.has(i)) {
            filtered.push(history[i]);
          }
        }
        history.length = 0;
        history.push(...filtered);
      }
    }

    this._lastHistory = history;
    // Bump generation so assemble() uses the maintained history
    if (rewrites > 0) {
      this._compactGeneration++;
    }
    const tokensAfter = estimateMessagesTokens(history);

    return { rewrites, tokensBefore, tokensAfter };
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
