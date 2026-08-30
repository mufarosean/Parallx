/**
 * Context engine for the OpenClaw execution pipeline.
 *
 * Upstream evidence:
 *   - context-engine/types.ts:104-230 — ContextEngine interface with lifecycle methods
 *   - attempt.context-engine-helpers.ts:52-73 — tokenBudget passed to assemble()
 *   - agent-runner-execution.ts — compactEmbeddedPiSession called on overflow
 *
 * Parallx adaptation:
 *   - Uses platform services: retrieveContext (RAG), recallMemories
 *   - M11 token budget: System 10%, RAG 30%, History 30%, User 30%
 *   - M9: Token estimation chars / 4
 *   - History from IChatParticipantContext (VS Code chat participant model)
 */

import type { IChatMessage } from '../services/chatTypes.js';
import type { IDefaultParticipantServices } from './openclawTypes.js';
import { computeElasticBudget, estimateTokens, estimateMessagesTokens, estimateMessageTokens } from './openclawTokenBudget.js';


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
 *   prepareSubagentSpawn → prepareSubagentSpawn (D8-8: extract context for subagent)
 *   onSubagentEnded → onSubagentEnded (D8-8: incorporate subagent result into context)
 *
 * Upstream methods NOT adopted (with reason):
 *   ingest/ingestBatch — Platform handles message persistence
 *   dispose — Engine is per-turn, not long-lived
 */
export interface IOpenclawContextEngine {
  bootstrap?(params: IOpenclawBootstrapParams): Promise<IOpenclawBootstrapResult>;
  assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult>;
  compact(params: IOpenclawCompactParams): Promise<IOpenclawCompactResult>;
  afterTurn?(params: IOpenclawAfterTurnParams): Promise<void>;
  maintain?(params: IOpenclawMaintainParams): Promise<IOpenclawMaintainResult>;
  /** D8-8: Prepare a context snapshot for a subagent spawn (upstream: prepareSubagentSpawn). */
  prepareSubagentSpawn?(params: IOpenclawSubagentSpawnContextParams): Promise<IOpenclawSubagentSpawnContext>;
  /** D8-8: Incorporate subagent result back into the parent context (upstream: onSubagentEnded). */
  onSubagentEnded?(params: IOpenclawSubagentEndedParams): Promise<void>;
}

export interface IOpenclawBootstrapParams {
  readonly sessionId: string;
  readonly tokenBudget: number;
  /** When false, skip workspace retrieval (RAG) even if the service is available. */
  readonly autoRag?: boolean;
}

/**
 * Result from bootstrap — reports service readiness so assemble()
 * can skip unavailable services instead of calling them and failing.
 */
export interface IOpenclawBootstrapResult {
  readonly ragReady: boolean;
  readonly memoryReady: boolean;
}

export interface IOpenclawAssembleParams {
  readonly sessionId: string;
  readonly history: readonly IChatMessage[];
  readonly tokenBudget: number;
  readonly prompt: string;
  /**
   * M85 — the session's durable plan, pre-formatted for the prompt.
   * Injected as a GUARANTEED section outside history and outside the RAG
   * budget lanes (the plan_update tool hard-caps its size), so the mission
   * survives compaction and history trimming by construction.
   */
  readonly planText?: string;
  /**
   * MIND continuity (durable beliefs/threads) for interactive turns —
   * injected as a guaranteed section beside the plan. Autonomous sessions
   * pass nothing here: the heartbeat rail carries beliefs in its seed;
   * cron/subagent/dashboard rails intentionally run without continuity.
   */
  readonly mindText?: string;
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
  /** D6-2: Identifier coverage score (0-1). Present when quality audit ran. */
  readonly qualityScore?: number;
  /** D6-3: Number of quality-based retries attempted. */
  readonly qualityRetries?: number;
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
// D8-8: Subagent context types
// Upstream: context-engine/types.ts:194-210 (prepareSubagentSpawn, onSubagentEnded)
// ---------------------------------------------------------------------------

/**
 * Parameters for preparing subagent context.
 * Upstream: PrepareSubagentSpawnParams — task description + budget for the subagent.
 */
export interface IOpenclawSubagentSpawnContextParams {
  readonly task: string;
  readonly tokenBudget: number;
  readonly parentSessionId: string;
}

/**
 * Context snapshot passed to a subagent spawn.
 * Upstream: SubagentSpawnContext — workspace overview + relevant history subset.
 */
export interface IOpenclawSubagentSpawnContext {
  /** Summary of parent context for subagent's system prompt. */
  readonly contextSummary: string;
  /** Token estimate of the context snapshot. */
  readonly estimatedTokens: number;
}

/**
 * Parameters for subagent completion callback.
 * Upstream: OnSubagentEndedParams — run result + completion status.
 */
export interface IOpenclawSubagentEndedParams {
  readonly runId: string;
  readonly parentSessionId: string;
  readonly result: string | null;
  readonly status: 'completed' | 'failed' | 'timeout';
}

// ---------------------------------------------------------------------------
// Services subset needed by the context engine
// ---------------------------------------------------------------------------

/** The minimum set of platform services the context engine needs. */
export type IOpenclawContextEngineServices = Pick<
  IDefaultParticipantServices,
  | 'retrieveContext'
  | 'recallMemories'
  | 'recallTranscripts'
  | 'storeSessionMemory'
  | 'sendSummarizationRequest'
  | 'readCompactionCache'
  | 'writeCompactionCache'
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
  private _transcriptsReady = true;

  constructor(private readonly services: IOpenclawContextEngineServices) {}

  /**
   * One-time per-turn initialization.
   *
   * Upstream: runAttemptContextEngineBootstrap (attempt.context-engine-helpers.ts)
   * Checks which services are available so assemble() can skip unavailable ones
   * rather than making calls that will fail.
   */
  async bootstrap(_params: IOpenclawBootstrapParams): Promise<IOpenclawBootstrapResult> {
    this._ragReady = !!this.services.retrieveContext && (_params.autoRag !== false);
    this._memoryReady = !!this.services.recallMemories;
    this._transcriptsReady = !!this.services.recallTranscripts;

    return {
      ragReady: this._ragReady,
      memoryReady: this._memoryReady,
    };
  }

  async assemble(params: IOpenclawAssembleParams): Promise<IOpenclawAssembleResult> {
    // Use compacted/maintained history if available.
    // Upstream pattern: compact() mutates the engine's internal state, and the next
    // assemble() uses the compacted version — not the original from the participant.
    // We use a generation counter instead of length comparison because compact()
    // may produce the same number of messages (e.g., 2 summary + 2 last exchange).
    const usedMidTurnState = this._compactGeneration > this._lastAssembleGeneration;
    let effectiveHistory = usedMidTurnState ? this._lastHistory : params.history;
    this._lastAssembleGeneration = this._compactGeneration;

    // ── M85 Slice B: boundary continuation cache ──
    // The engine is per-turn, so a compaction done last turn is gone by now —
    // without this cache, history over budget would be re-summarized EVERY
    // turn (or, before Slice B, silently dropped oldest-first). Substitute
    // the cached summary for the prefix it covers; the fingerprint guards
    // against replay/regenerate splices rewriting the covered past.
    if (!usedMidTurnState && this.services.readCompactionCache) {
      const cache = this.services.readCompactionCache(params.sessionId);
      if (cache
          && cache.coveredCount > 0
          && cache.coveredCount <= effectiveHistory.length
          && historyFingerprint(effectiveHistory, cache.coveredCount) === cache.fingerprint) {
        effectiveHistory = [
          { role: 'user' as const, content: `[Context summary]\n${cache.summaryText}` },
          { role: 'assistant' as const, content: 'Understood, I have the conversation context.' },
          ...dropOrphanedToolHead(effectiveHistory.slice(cache.coveredCount)),
        ];
      }
    }

    // Cache for compact() — always the history we're actually using
    this._lastHistory = effectiveHistory;

    let historyTokenEstimate = estimateMessagesTokens(effectiveHistory);
    const userTokenEstimate = estimateTokens(params.prompt);
    let budget = computeElasticBudget({
      contextWindow: params.tokenBudget,
      historyActual: historyTokenEstimate,
      userActual: userTokenEstimate,
    });

    // ── M85 Slice B: summarize-then-fit at the trim boundary ──
    // trimHistoryToBudget below silently drops oldest messages — a data-loss
    // path. When history exceeds its lane and a summarizer is available, fold
    // the overflow into a continuation summary FIRST, and cache it for
    // subsequent turns (keyed to the session, fingerprinted against splices).
    if (historyTokenEstimate > budget.history
        && this.services.sendSummarizationRequest
        && effectiveHistory.length > 2) {
      const originalLength = params.history.length;
      try {
        const compactResult = await this.compact({ sessionId: params.sessionId, tokenBudget: params.tokenBudget });
        if (compactResult.compacted) {
          effectiveHistory = [...this._lastHistory];
          const summaryMsg = effectiveHistory[0];
          if (!usedMidTurnState
              && this.services.writeCompactionCache
              && summaryMsg?.content.startsWith('[Context summary]\n')) {
            // The compacted shape is [summary, ack, ...keptTail]; the tail
            // messages align 1:1 with the END of the session history, so the
            // covered prefix is everything before them.
            const keptTail = effectiveHistory.length - 2;
            const coveredCount = originalLength - keptTail;
            if (coveredCount > 0 && coveredCount <= originalLength) {
              this.services.writeCompactionCache(params.sessionId, {
                coveredCount,
                summaryText: summaryMsg.content.slice('[Context summary]\n'.length),
                fingerprint: historyFingerprint(params.history, coveredCount),
              });
            }
          }
          historyTokenEstimate = estimateMessagesTokens(effectiveHistory);
          budget = computeElasticBudget({
            contextWindow: params.tokenBudget,
            historyActual: historyTokenEstimate,
            userActual: userTokenEstimate,
          });
        }
      } catch {
        // Boundary compaction is best-effort — trimHistoryToBudget below
        // still guarantees the assembled context fits.
      }
    }
    const messages: IChatMessage[] = [];
    let ragSources: { uri: string; label: string; index: number }[] = [];
    let systemPromptAddition: string | undefined;
    let retrievedContextText = '';

    // ── Sub-lane budget allocation (normalized to 100% of RAG budget) ──
    // Upstream: context engine assembles content UNDER the token budget.
    // Sub-lanes must sum to ≤ 100% to prevent over-allocation.
    // M81 Phase 3 Stage 2: the concept retrieval lane was removed — its 5%
    // moved to RAG, which now also picks up agent-curated MEMORY.md content
    // via the standard vector index.
    // M84: the "currently open page" lane was removed — passively injecting the
    // open editor page every turn spent budget on content the user often didn't
    // mean to include. To bring a page/file into context, attach it explicitly;
    // the agent can also pull any page on demand via the canvas read tools. Its
    // 15% folded back into RAG.
    const ragLaneBudget = Math.floor(budget.rag * 0.75);     // 75% — primary retrieval
    const memoryLaneBudget = Math.floor(budget.rag * 0.15);  // 15% — recalled memories
    const transcriptLaneBudget = Math.floor(budget.rag * 0.10); // 10% — transcripts

    // ── C1: Parallel loading — fire all retrieval services concurrently ──
    const [ragResult, memoryResult, transcriptResult] = await Promise.all([
      (this._ragReady && this.services.retrieveContext)
        ? this.services.retrieveContext(params.prompt).catch(() => undefined)
        : Promise.resolve(undefined),
      (this._memoryReady && this.services.recallMemories)
        ? this.services.recallMemories(params.prompt, params.sessionId).catch(() => undefined)
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

    // ── M85: Active plan — GUARANTEED first section, outside the RAG lanes ──
    // The plan is the agent's durable mission anchor. It is deliberately NOT
    // budget-competed (plan_update hard-caps its size) and NOT part of
    // history, so compaction and history trimming can never eat it.
    if (params.planText) {
      contextSections.push(
        '## Active Plan\n'
        + 'This is YOUR durable working plan for this session (maintain it with plan_update; it survives context compaction).\n\n'
        + params.planText,
      );
    }

    // ── MIND continuity — guaranteed like the plan, for the same reason ──
    // The agent's durable beliefs about the user and their work. Tiny by
    // construction (summarizeMind caps at 12 lines behind a confidence floor),
    // so it is not budget-competed: continuity that only shows up when the
    // context is roomy isn't continuity.
    if (params.mindText) {
      contextSections.push(
        '## Continuity\n'
        + 'What you (the assistant) durably believe from earlier sessions and reviews — reaffirm with mind_remember when confirmed, and treat as beliefs, not facts.\n\n'
        + params.mindText,
      );
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

    // ── Deliver retrieval content via messages (upstream pattern) ──
    // Upstream: AssembleResult.messages is the primary delivery channel.
    // RAG content goes in a context message BEFORE history, not in the system prompt.
    if (contextSections.length > 0) {
      messages.push({
        role: 'user' as const,
        content: `The following is standing context for this conversation (your plan, retrieved workspace content, recalled memories). Use it to inform your responses.\n\n${contextSections.join('\n\n---\n\n')}`,
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
      .map((msg) => {
        let line = `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`;
        if (msg.role === 'user' && msg.images?.length) {
          line += ` [attached ${msg.images.length} image(s)]`;
        }
        return line;
      })
      .join('\n\n');

    let summaryText = '';
    let qualityScore: number | undefined;
    let qualityRetries = 0;

    // Only attempt summarization when history is long enough to benefit (>2 messages).
    // With ≤2 messages, summarizer prepends summary + ack to the existing messages,
    // which INCREASES context size rather than reducing it (F2-R2-04).
    if (this.services.sendSummarizationRequest && transcript.length > 0 && history.length > 2) {
      const identifiers = extractIdentifiers(transcript);
      let bestSummary = '';
      let bestScore = 0;

      // D6-1: Identifier-aware summarization prompt
      const basePromptContent = COMPACTION_SUMMARIZATION_PROMPT;

      // D6-3: Quality-gated retry loop (upstream: MAX_OVERFLOW_COMPACTION_ATTEMPTS)
      for (let attempt = 0; attempt <= MAX_QUALITY_RETRIES; attempt++) {
        let promptContent = basePromptContent;
        if (attempt > 0 && identifiers.length > 0) {
          // Stronger retry prompt that explicitly lists missing identifiers
          const audit = auditCompactionQuality(identifiers, bestSummary);
          if (audit.missingIdentifiers.length > 0) {
            promptContent = `${basePromptContent}\n\nCRITICAL: Your previous summary DROPPED these identifiers — you MUST include them verbatim:\n${audit.missingIdentifiers.join(', ')}`;
          }
        }

        const summaryPrompt: IChatMessage[] = [
          { role: 'system', content: promptContent },
          { role: 'user', content: transcript },
        ];

        let candidateSummary = '';
        try {
          for await (const chunk of this.services.sendSummarizationRequest(summaryPrompt)) {
            if (chunk.content) {
              candidateSummary += chunk.content;
            }
          }
          candidateSummary = candidateSummary.trim();
        } catch {
          break; // Summarization failed — use what we have
        }

        if (!candidateSummary) { break; }

        // D6-2: Quality audit — check identifier coverage
        const audit = auditCompactionQuality(identifiers, candidateSummary);
        if (audit.score > bestScore) {
          bestSummary = candidateSummary;
          bestScore = audit.score;
        }

        if (audit.passed || identifiers.length === 0) {
          break; // Quality sufficient
        }
        qualityRetries++;
      }

      summaryText = bestSummary;
      qualityScore = identifiers.length > 0 ? bestScore : undefined;
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

    // Replace internal history with a single summary message + keep the last
    // exchange. Round-boundary guard: slice(-2) can land between an assistant
    // tool-call message and its results now that history preserves them.
    const lastExchange = dropOrphanedToolHead(history.length >= 2 ? history.slice(-2) : [...history]);
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

    return {
      compacted: true,
      tokensBefore: historyTokens,
      tokensAfter: afterTokens,
      qualityScore,
      qualityRetries: qualityRetries > 0 ? qualityRetries : undefined,
    };
  }

  async afterTurn(_params: IOpenclawAfterTurnParams): Promise<void> {
    // M81 Phase 3 Stage 2 — the regex-based concept extraction that used to
    // run here was removed. Agent-curated memory writes happen via the
    // `memory_write` tool during the turn itself, which is higher-signal
    // and avoids unconditional writes that compete with the agent for
    // MEMORY.md's bounded space.
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

  /**
   * D8-8: Prepare a context snapshot for a subagent spawn.
   * Upstream: prepareSubagentSpawn in context-engine/types.ts:194-200.
   *
   * Extracts a summary of the current context (available history + last RAG results)
   * for the subagent to use as its starting context.
   */
  async prepareSubagentSpawn(params: IOpenclawSubagentSpawnContextParams): Promise<IOpenclawSubagentSpawnContext> {
    const history = this._lastHistory;
    const recentMessages = history.slice(-4); // Last 2 exchanges max
    const contextParts: string[] = [];

    if (recentMessages.length > 0) {
      contextParts.push('Parent conversation context:');
      for (const msg of recentMessages) {
        contextParts.push(`${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.slice(0, 500)}`);
      }
    }

    contextParts.push(`\nSubagent task: ${params.task}`);

    const contextSummary = contextParts.join('\n');
    const estimatedTokens = estimateTokens(contextSummary);

    return { contextSummary, estimatedTokens };
  }

  /**
   * D8-8: Incorporate subagent result into parent context.
   * Upstream: onSubagentEnded in context-engine/types.ts:206-210.
   *
   * Appends the subagent's result as a context message so subsequent
   * assemble() calls include it in the conversation history.
   */
  async onSubagentEnded(params: IOpenclawSubagentEndedParams): Promise<void> {
    if (params.status !== 'completed' || !params.result) {
      return; // Only incorporate successful results
    }

    // Append subagent result as a context note in the cached history
    const resultMessage: IChatMessage = {
      role: 'assistant' as const,
      content: `[Subagent ${params.runId} result]\n${params.result}`,
    };
    this._lastHistory = [...this._lastHistory, resultMessage];
    this._compactGeneration++;
  }
}

// ---------------------------------------------------------------------------
// D6: Compaction constants and helpers
// ---------------------------------------------------------------------------

/** Maximum quality-based retries for compaction (upstream: MAX_OVERFLOW_COMPACTION_ATTEMPTS). */
export const MAX_QUALITY_RETRIES = 2;

/** Quality threshold — 60% identifier survival required to pass. */
export const QUALITY_THRESHOLD = 0.6;

/**
 * D6-1: Identifier-aware summarization prompt.
 * Enumerates explicit identifier classes to preserve during compaction.
 */
/**
 * M85 Slice B — the compaction prompt is a CONTINUATION CONTRACT, not an
 * information digest. The summary's consumer is the same agent continuing the
 * same work with less context, so it is optimized for "what would change what
 * I do next": mission, state, failures, and the immediate next step — plus
 * verbatim identifiers (the quality audit in auditCompactionQuality scores
 * identifier coverage, so the Key Facts requirements must stay).
 */
export const COMPACTION_SUMMARIZATION_PROMPT = [
  'You are compacting an agent conversation so the SAME agent can seamlessly continue the work with less context. Write a continuation summary with EXACTLY these sections:',
  '',
  '## Mission',
  "What the user is trying to achieve overall, in their words where possible. If the user gave constraints or preferences about HOW to work, restate them.",
  '',
  '## State',
  'What has been done so far and the current state: decisions made (and why), approaches chosen, things created or changed.',
  '',
  '## Key Facts',
  'Concrete identifiers that MUST appear verbatim:',
  '- Document titles and page names',
  '- File paths, URIs, and code references',
  '- Dates, timestamps, and version numbers',
  '- Proper names (people, systems, organizations, entities)',
  '- Numeric values (amounts, IDs, policy numbers, thresholds)',
  '- Key technical terms and domain-specific identifiers',
  '',
  '## Failures',
  "Errors hit and how they were (or weren't) resolved, so they are not repeated. Omit the section if there were none.",
  '',
  '## Next',
  'What remains to be done, in order, then the single immediate next action.',
  '',
  'Be concise, but lose NOTHING that would change what the continuing agent does next. Output ONLY the summary.',
].join('\n');

/**
 * D6-2: Extract identifiers from a transcript for quality auditing.
 * Returns a deduplicated list of identifiable strings.
 */
export function extractIdentifiers(text: string): string[] {
  const identifiers = new Set<string>();

  // File paths (forward and backslash)
  for (const m of text.matchAll(/(?:\/[\w.-]+)+\.\w+/g)) { identifiers.add(m[0]); }
  for (const m of text.matchAll(/(?:\\[\w.-]+)+\.\w+/g)) { identifiers.add(m[0]); }

  // URIs
  for (const m of text.matchAll(/https?:\/\/\S+/g)) { identifiers.add(m[0]); }

  // Dates (ISO and common formats)
  for (const m of text.matchAll(/\d{4}-\d{2}-\d{2}/g)) { identifiers.add(m[0]); }
  for (const m of text.matchAll(/\d{1,2}\/\d{1,2}\/\d{4}/g)) { identifiers.add(m[0]); }

  // Policy/ID numbers (# or $ prefixed)
  for (const m of text.matchAll(/(?:#|policy\s*)\d{4,}/gi)) { identifiers.add(m[0]); }
  for (const m of text.matchAll(/\$[\d,]+(?:\.\d{2})?/g)) { identifiers.add(m[0]); }

  // Email addresses
  for (const m of text.matchAll(/\S+@\S+\.\S+/g)) { identifiers.add(m[0]); }

  // Version numbers (e.g., v1.2.3, 2.0.0)
  for (const m of text.matchAll(/\bv?\d+\.\d+\.\d+\b/g)) { identifiers.add(m[0]); }

  // CamelCase/PascalCase identifiers (e.g., MyClass, handleClick)
  for (const m of text.matchAll(/\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b/g)) { identifiers.add(m[0]); }

  // ALL_CAPS constants (e.g., MAX_RETRIES, API_KEY) — minimum 3 chars
  for (const m of text.matchAll(/\b[A-Z][A-Z_]{2,}\b/g)) { identifiers.add(m[0]); }

  return [...identifiers];
}

/**
 * D6-2: Audit compaction quality — check identifier survival in the summary.
 */
export function auditCompactionQuality(
  identifiers: string[],
  summary: string,
): { passed: boolean; score: number; missingIdentifiers: string[] } {
  if (identifiers.length === 0) {
    return { passed: true, score: 1.0, missingIdentifiers: [] };
  }

  const lowerSummary = summary.toLowerCase();
  const missing: string[] = [];
  for (const id of identifiers) {
    if (!lowerSummary.includes(id.toLowerCase())) {
      missing.push(id);
    }
  }

  const found = identifiers.length - missing.length;
  const score = found / identifiers.length;
  return { passed: score >= QUALITY_THRESHOLD, score, missingIdentifiers: missing };
}

// M81 Phase 3 Stage 2 — extractConceptsFromTranscript was a regex-based pull
// of file paths, URIs, and capitalized multi-word terms from chat transcripts.
// It auto-wrote these to MEMORY.md's `## Concepts` section, competing with
// agent-driven `memory_write` writes for the bounded curation surface. Removed
// in favor of agent-authored curation via `memory_write`.

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
/**
 * M85 Slice B — cheap shape check of the first `count` history messages, used
 * to validate the boundary compaction cache. Replay/regenerate splices change
 * message content in place; a stale summary of a rewritten past would poison
 * every later turn, so any prefix change must invalidate the cache.
 */
export function historyFingerprint(history: readonly IChatMessage[], count: number): string {
  const covered = history.slice(0, count);
  let chars = 0;
  for (const m of covered) { chars += m.content.length; }
  const first = covered[0]?.content ?? '';
  const last = covered[covered.length - 1]?.content ?? '';
  return `${count}:${chars}:${first.slice(0, 24)}:${last.length}`;
}

/**
 * HARNESS.md §1 — history now carries the tool exchange record, so every cut
 * point must respect round boundaries: a `role: 'tool'` message whose
 * assistant tool-call message was cut is an orphan. The Anthropic seam would
 * fabricate a `tool_use_id` for it that references nothing (a 400), and other
 * providers would show the model a result with no visible cause. Drop the
 * orphaned head instead.
 */
export function dropOrphanedToolHead(messages: readonly IChatMessage[]): IChatMessage[] {
  let start = 0;
  while (start < messages.length && messages[start].role === 'tool') {
    start++;
  }
  return start === 0 ? [...messages] : messages.slice(start);
}

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
    const msgTokens = estimateMessageTokens(msg);
    if (usedTokens + msgTokens > budgetTokens) {
      break;
    }
    result.unshift(msg);
    usedTokens += msgTokens;
  }

  return dropOrphanedToolHead(result);
}
