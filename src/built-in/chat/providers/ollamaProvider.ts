// ollamaProvider.ts — ILanguageModelProvider for Ollama (M9 Task 1.2 + 1.3)
//
// Implements the provider interface for Ollama's REST API with
// streaming support, model enumeration, and health monitoring.
//
// Ollama endpoints used:
//   GET  /api/version  — connectivity check
//   GET  /api/tags     — list available models
//   POST /api/show     — model info (context length, capabilities)
//   POST /api/chat     — streaming chat completions
//   GET  /api/ps       — currently loaded models
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/languageModels.ts (provider registration)

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { watchContextFit } from './ollamaContextFit.js';
import type {
  ILanguageModelProvider,
  ILanguageModelInfo,
  IProviderStatus,
  IChatMessage,
  IChatRequestOptions,
  IChatResponseChunk,
  IToolDefinition,
  ModelCapability,
} from '../../../services/chatTypes.js';

interface OllamaRequestMessage {
  role: string;
  content: string;
  images?: string[];
  tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  tool_name?: string;
}

// ── Ollama API response shapes (internal) ────────────────────────────────────

interface OllamaTagsResponse {
  models: {
    name: string;
    model: string;
    size: number;
    details: {
      family: string;
      parameter_size: string;
      quantization_level: string;
    };
  }[];
}

interface OllamaShowResponse {
  details: {
    family: string;
    parameter_size: string;
    quantization_level: string;
  };
  model_info?: Record<string, unknown>;
  parameters?: string;
  capabilities?: string[];
}

interface OllamaVersionResponse {
  version: string;
}

interface OllamaPsResponse {
  models: {
    name: string;
    model: string;
    size: number;
    /** Bytes of the model held in graphics memory (the rest is in system RAM). */
    size_vram?: number;
    /** The context size it is loaded at. */
    context_length?: number;
  }[];
}

/** Where a loaded model sits, from Ollama's /api/ps. */
export interface IOllamaPlacement {
  readonly modelId: string;
  /** gpu = all in graphics memory; partial = some layers on the CPU (slower); cpu = none on the GPU. */
  readonly where: 'gpu' | 'partial' | 'cpu';
  readonly contextLength?: number;
}

/** Read /api/ps sizes as a placement. Test seam. */
export function placementOf(m: { name: string; size: number; size_vram?: number; context_length?: number }): IOllamaPlacement {
  const vram = typeof m.size_vram === 'number' ? m.size_vram : m.size;
  const where = vram <= 0 ? 'cpu' : vram >= m.size * 0.99 ? 'gpu' : 'partial';
  return { modelId: m.name, where, contextLength: m.context_length && m.context_length > 0 ? m.context_length : undefined };
}

interface OllamaChatChunk {
  model: string;
  message: {
    role: string;
    content: string;
    thinking?: string;
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  done: boolean;
  /** Number of tokens in the prompt (present on final chunk). */
  prompt_eval_count?: number;
  /** Number of tokens generated (present on final chunk). */
  eval_count?: number;
  eval_duration?: number;
  /** Why it stopped (final chunk): 'stop', 'length', 'load'... */
  done_reason?: string;
  /** Mid-stream failure (runner crash, OOM). Terminal — no more chunks follow. */
  error?: string;
}

// IRetrievalPlan — re-exported for external consumers (now defined in chatTypes.ts)
export type { IRetrievalPlan } from '../chatTypes.js';

// ── Timeouts ──

const METADATA_TIMEOUT_MS = 10_000;
const HEALTH_POLL_CONNECTED_MS = 30_000;
const HEALTH_POLL_DISCONNECTED_MS = 5_000;
const HEALTH_POLL_BACKOFF_MS = 60_000;
/** Ollama never seen yet: after the first misses, check this often, not every
 *  5 s forever (it is quick enough to notice an Ollama just installed). */
const HEALTH_POLL_NEVER_SEEN_MS = 15_000;
const HEALTH_FAILURE_BACKOFF_THRESHOLD = 5;

/** Fast-poll interval during the startup burst window. */
const HEALTH_POLL_STARTUP_MS = 1_500;
/** Duration of the startup burst window (15 seconds). */
const HEALTH_STARTUP_WINDOW_MS = 15_000;

/**
 * Language model provider for Ollama.
 *
 * Connects to a local Ollama instance and maps its REST API
 * to the ILanguageModelProvider interface.
 *
 * Includes a built-in health monitor (Task 1.3) that polls
 * availability and loaded models on a configurable interval.
 */
export class OllamaProvider extends Disposable implements ILanguageModelProvider {

  readonly id = 'ollama';
  readonly local = true;
  readonly displayName = 'Ollama';

  private readonly _baseUrl: string;

  // ── Health Monitor (Task 1.3) ──

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastStatus: IProviderStatus = { available: false };
  private _consecutiveFailures = 0;
  private _loadedModels: string[] = [];
  private _placements: readonly IOllamaPlacement[] = [];
  private _placementKey = '';
  private readonly _onDidChangePlacement = this._register(new Emitter<void>());
  /** Fires when a loaded model's place (GPU, partly CPU) or size changes. */
  readonly onDidChangePlacement: Event<void> = this._onDidChangePlacement.event;

  /** Where each loaded model sits (last /api/ps answer). */
  getPlacements(): readonly IOllamaPlacement[] {
    return this._placements;
  }
  private _hasEverConnected = false;

  /** True while in the startup burst window (fast polling). */
  private _startupBurst = true;


  private readonly _onDidChangeStatus = this._register(new Emitter<IProviderStatus>());
  readonly onDidChangeStatus: Event<IProviderStatus> = this._onDidChangeStatus.event;

  private readonly _onDidChangeLoadedModels = this._register(new Emitter<readonly string[]>());
  readonly onDidChangeLoadedModels: Event<readonly string[]> = this._onDidChangeLoadedModels.event;

  private readonly _onDidSendChatRequest = this._register(new Emitter<{ readonly modelId: string; readonly numCtx: number }>());
  /** A request named its context size: the chat remembers it for the next launch's warm-up. */
  readonly onDidSendChatRequest: Event<{ readonly modelId: string; readonly numCtx: number }> = this._onDidSendChatRequest.event;

  constructor(baseUrl = 'http://localhost:11434') {
    super();

    this._baseUrl = baseUrl;

    // Initial check + start polling
    this._pollHealth();
    this._schedulePoll();

    // End startup burst after the window expires
    const startupTimeout = setTimeout(() => { this._startupBurst = false; this._schedulePoll(); }, HEALTH_STARTUP_WINDOW_MS);
    this._register(toDisposable(() => clearTimeout(startupTimeout)));

    // A hidden window skips its polls (see _schedulePoll); coming back checks
    // at once, so the status is current the moment someone looks.
    if (typeof document !== 'undefined') {
      const onVisible = () => { if (!document.hidden) this._pollHealth(); };
      document.addEventListener('visibilitychange', onVisible);
      this._register(toDisposable(() => document.removeEventListener('visibilitychange', onVisible)));
    }
  }

  // ── Public accessors for cached state ──

  /** Get the last known provider status (for synchronous UI checks). */
  getLastStatus(): IProviderStatus {
    return this._lastStatus;
  }

  /** Get the last known loaded model IDs (from /api/ps). */
  getLoadedModels(): readonly string[] {
    return this._loadedModels;
  }

  /** Unload every model Ollama holds (keep_alive 0 is its own way to say so); the ids released. */
  async releaseLoaded(): Promise<readonly string[]> {
    const ps = await this._fetchJson<{ models?: { name: string }[] }>(`${this._baseUrl}/api/ps`, { method: 'GET' }, 5_000);
    const names = (ps.models ?? []).map((m) => m.name).filter(Boolean);
    for (const model of names) {
      await this._fetchJson<unknown>(`${this._baseUrl}/api/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, keep_alive: 0 }) }, 30_000);
    }
    this._loadedModels = []; this._placements = []; this._onDidChangePlacement.fire();
    return names;
  }

  // ── Context length cache for active model (Cap 9.5) ──

  private _contextLengthCache = new Map<string, number>();

  /**
   * User-configured context length override. When > 0, this value is sent
   * as num_ctx to Ollama and used for token bar display. When 0, a request
   * that names no size reuses the last size named (_lastNumCtx).
   */
  private _contextLengthOverride = 0;

  /**
   * The last context size (8K and up) a request named, per model; a request
   * naming none reuses its model's, so Ollama does not reload it at its own
   * default. One global value let a 2K marking call shrink the next sizeless
   * call to any model, which Ollama then truncated from the top unseen.
   */
  private readonly _lastNumCtx = new Map<string, number>();
  /** The weights on disk per model (/api/tags), for the context fit. */
  private readonly _weightBytes = new Map<string, number>();
  /** The context size known to fit on the card per model, from a measured load (ollamaContextFit.ts). */
  private readonly _contextFits = new Map<string, number>();
  private readonly _onDidLearnContextFit = this._register(new Emitter<{ readonly modelId: string; readonly numCtx: number }>());
  /** A model's fitting context was measured; the chat keeps it across restarts. */
  readonly onDidLearnContextFit: Event<{ readonly modelId: string; readonly numCtx: number }> = this._onDidLearnContextFit.event;
  /** How often a load the app sized is looked at, and for how long. */
  static FIT_POLL_MS = 2_000;
  static FIT_WATCH_MS = 120_000;

  /** Fits learned earlier (the chat's global state), fed back at launch. */
  setKnownContextFits(fits: Readonly<Record<string, number>>): void {
    for (const [modelId, numCtx] of Object.entries(fits)) if (modelId && numCtx > 0) this._contextFits.set(modelId, Math.floor(numCtx));
  }
  /** The size last named for each model in earlier sessions: what Auto runs that model at. */
  setLastNamedSizes(sizes: Readonly<Record<string, number>>): void {
    for (const [modelId, numCtx] of Object.entries(sizes)) if (modelId && numCtx >= 8_192 && !this._lastNumCtx.has(modelId)) this._lastNumCtx.set(modelId, Math.floor(numCtx));
  }

  /** Models that returned 400 for think:true — skip on subsequent calls. */
  private _noThinkModels = new Set<string>();

  /**
   * Cache of model family lowercased, keyed by modelId. Populated lazily
   * by `getModelInfo`. Used by the streaming path to decide whether
   * sending `think:true` is safe for a given model — without this gate,
   * recent Ollama versions silently honor `think:true` on models whose
   * thinking implementation loops in long contexts.
   */
  private _modelFamilyCache = new Map<string, string>();

  // Prior versions of this file maintained a `_BUGGY_THINK_FAMILIES` static
  // list (gemma, qwen3.5, qwen3.6) that silently flipped `think:true` to
  // false for matching models. That mechanism was removed — hardcoding
  // per-model behavior in the provider is the wrong layer. Model behavior
  // belongs to the user / model, not the harness. When a model's thinking
  // mode misbehaves, surface it via UX (settings toggle, release notes)
  // rather than burying an override here. The reactive `_noThinkModels`
  // cache below still records models that return HTTP 400 for `think:true`
  // (so a single 400 doesn't repeat every turn) — that's reacting to
  // Ollama's own signal, not a hardcoded policy.

  /** Set context length override (0 = let Ollama decide). */
  setContextLengthOverride(value: number): void {
    this._contextLengthOverride = Math.max(0, Math.floor(value));
  }

  /** Reset streaming parser state (called on model switch to avoid stale artifacts). */
  resetStreamState(): void {
    this._noThinkModels.clear();
  }

  /**
   * Get the context length for a model (fetched lazily, cached).
   * If the user set an override, returns that instead.
   * Returns 0 if not yet fetched. Triggers background fetch on first call.
   */
  getActiveModelContextLength(): number {
    if (this._contextLengthOverride > 0) { return this._contextLengthOverride; }
    // Find the first loaded model or return 0
    const loaded = this._loadedModels[0];
    if (!loaded) { return 0; }
    const cached = this._contextLengthCache.get(loaded);
    if (cached !== undefined) { return Math.min(cached, OllamaProvider.AUTO_MAX_CONTEXT); }
    // Fire-and-forget background fetch
    this.getModelInfo(loaded).then((info) => {
      this._contextLengthCache.set(loaded, info.contextLength);
    }).catch(() => { /* best effort */ });
    return 0; // Not yet available — will be ready for next request
  }

  /**
   * Sync cache lookup for a specific model ID. Does not depend on
   * _loadedModels — use this when you know the model ID (e.g. from
   * languageModelsService.getActiveModel()). Triggers a background
   * fetch on first call so subsequent reads return the real value.
   */
  getCachedContextLength(modelId: string): number {
    if (this._contextLengthOverride > 0) { return this._contextLengthOverride; }
    if (!modelId) { return 0; }
    // No pick: the loaded size, so Auto never reloads the model at its full length (minutes, and past the card, for a large one).
    const live = this.loadedContextLength(modelId); if (live > 0) { return live; }
    const fit = this._contextFits.get(modelId); if (fit) { return fit; } // measured on this card
    const cached = this._contextLengthCache.get(modelId);
    if (cached !== undefined) { return Math.min(cached, OllamaProvider.AUTO_MAX_CONTEXT); }
    // Fire-and-forget background fetch
    this.getModelInfo(modelId).then((info) => {
      this._contextLengthCache.set(modelId, info.contextLength);
    }).catch(() => { /* best effort */ });
    return 0;
  }

  /** The context size a model is loaded at (Ollama's /api/ps), or 0. */
  loadedContextLength(modelId: string): number { return this._placements.find((p) => p.modelId === modelId)?.contextLength ?? 0; }
  /**
   * Async version that fetches context length if not cached.
   * Returns the real context length or 0 if no model is loaded.
   */
  async getActiveModelContextLengthAsync(): Promise<number> {
    const loaded = this._loadedModels[0];
    if (!loaded) { return 0; }
    return this.getModelContextLength(loaded);
  }

  /**
   * Get context length for a specific model by ID (fetches from Ollama if not cached).
   * If the user set an override, returns that instead.
   * This is the preferred method — doesn't depend on _loadedModels polling.
   */
  async getModelContextLength(modelId: string): Promise<number> {
    if (this._contextLengthOverride > 0) { return this._contextLengthOverride; }
    if (!modelId) { return 0; }
    const cached = this._contextLengthCache.get(modelId);
    if (cached !== undefined) { return cached; }
    try {
      const info = await this.getModelInfo(modelId);
      this._contextLengthCache.set(modelId, info.contextLength);
      return info.contextLength;
    } catch {
      return 0;
    }
  }

  // ── Model Pre-loading ──

  // ── ILanguageModelProvider ──

  async checkAvailability(): Promise<IProviderStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), METADATA_TIMEOUT_MS);

      const response = await fetch(`${this._baseUrl}/api/version`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        return { available: false, error: `Ollama returned HTTP ${response.status}` };
      }

      const data = (await response.json()) as OllamaVersionResponse;
      return { available: true, version: data.version };
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return { available: false, error: 'Connection timed out' };
      }
      return {
        available: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listModels(): Promise<readonly ILanguageModelInfo[]> {
    const response = await this._fetchJson<OllamaTagsResponse>(
      `${this._baseUrl}/api/tags`,
      { method: 'GET' },
      METADATA_TIMEOUT_MS,
    );

    for (const m of response.models) if (m.size > 0) this._weightBytes.set(m.name, m.size);
    return response.models.map((m) => ({
      id: m.name,
      displayName: this._formatDisplayName(m.name),
      family: m.details.family,
      parameterSize: m.details.parameter_size,
      quantization: m.details.quantization_level,
      contextLength: 0, // Enriched by getModelInfo()
      capabilities: ['completion'] as ModelCapability[],
    }));
  }

  async getModelInfo(modelId: string): Promise<ILanguageModelInfo> {
    const response = await this._fetchJson<OllamaShowResponse>(
      `${this._baseUrl}/api/show`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: modelId }),
      },
      METADATA_TIMEOUT_MS,
    );

    // Extract context length from model_info (key varies by family)
    const contextLength = this._extractContextLength(
      response.model_info ?? {},
      response.parameters,
    );

    // Determine capabilities
    const capabilities: ModelCapability[] = ['completion'];
    if (response.capabilities?.includes('tools')) {
      capabilities.push('tools');
    }
    if (response.capabilities?.includes('vision')) {
      capabilities.push('vision');
    }
    // Thinking capability. Source of truth is Ollama's own capabilities
    // array when present (newer Ollama versions report 'thinking'
    // directly). Family-string sniffing is kept only as a fallback for
    // models whose Ollama version doesn't yet report it, and is restricted
    // to families known to have a stable thinking implementation —
    // deepseek-r1 and QwQ. The Gemma family in newer Ollama builds started
    // honoring `think:true` but produces thought-loops in long contexts,
    // so we no longer infer thinking from arbitrary families.
    const familyLower = response.details.family.toLowerCase();
    if (
      response.capabilities?.includes('thinking') ||
      familyLower.includes('deepseek') ||
      familyLower.includes('qwq')
    ) {
      capabilities.push('thinking');
    }

    // Cache the family so the streaming path can gate `think:true` without
    // round-tripping to /api/show on every request.
    this._modelFamilyCache.set(modelId, response.details.family.toLowerCase());

    return {
      id: modelId,
      displayName: this._formatDisplayName(modelId),
      family: response.details.family,
      parameterSize: response.details.parameter_size,
      quantization: response.details.quantization_level,
      contextLength,
      capabilities,
    };
  }


  async *sendChatRequest(
    modelId: string,
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    // Whether this stream is inside an inline <think> tag. Per stream, never
    // on the provider: the chat and a feature can stream at the same time,
    // and a shared flag let one stream's open tag file the other's answer as
    // reasoning (and a stream aborted mid-tag latched it for the next one).
    const thinkTag = { open: false };

    // Build request body
    const body: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((m) => this._formatMessage(m)),
      stream: true,
    };

    // Every request names its context size. Ollama keeps a loaded model at
    // one size: a request at another size makes it load the model again, and
    // with no size it uses the model's full length (262K for qwen3.x), whose
    // context cache spills past the graphics card. Priority: the request's
    // own numCtx > the provider-wide override > the last size a request
    // named (capped at the model's own length when known).
    const ollamaOptions: Record<string, unknown> = {};
    const named = options?.numCtx && options.numCtx > 0
      ? options.numCtx
      : this._contextLengthOverride > 0 ? this._contextLengthOverride : 0;
    if (named > 0) {
      ollamaOptions['num_ctx'] = named;
      if (named >= 8_192) this._lastNumCtx.set(modelId, named);
      this._onDidSendChatRequest.fire({ modelId, numCtx: named });
    } else {
      // No size from the caller: the size the model is loaded at, else the
      // size measured to fit on this card, else the last size a request
      // named, else the model's own length capped (the first attempt, which
      // is measured). Never nothing: with nothing, Ollama uses its own
      // default, the model's full length on a machine set so.
      const live = this.loadedContextLength(modelId), fit = this._contextFits.get(modelId) ?? 0, last = this._lastNumCtx.get(modelId) ?? 0, known = this._contextLengthCache.get(modelId) ?? 0;
      ollamaOptions['num_ctx'] = live > 0 ? live : fit > 0 ? fit : last > 0 ? last : Math.min(known > 0 ? known : OllamaProvider.AUTO_MAX_CONTEXT, OllamaProvider.AUTO_MAX_CONTEXT);
    }
    if (options) {
      // Negative temperature means "no opinion": omit the key so Ollama falls back to
      // the model's own PARAMETER temperature, which model authors tune per model
      // (Qwen3.8 wants 1.0 for thinking, 0.7 for instruct). Sending a harness default
      // here silently overrode that for every model.
      if (options.temperature !== undefined && options.temperature >= 0) ollamaOptions['temperature'] = Math.max(0, Math.min(2, options.temperature));
      if (options.topP !== undefined) ollamaOptions['top_p'] = Math.max(0, Math.min(1, options.topP));
      if (options.maxTokens !== undefined && options.maxTokens > 0) ollamaOptions['num_predict'] = options.maxTokens;
      if (options.seed !== undefined) ollamaOptions['seed'] = options.seed;

      if (options.tools && options.tools.length > 0) {
        body['tools'] = options.tools.map((t) => this._formatToolDefinition(t));
      }
      if (options.format) {
        body['format'] = options.format;
      }
      if (options.think && !this._noThinkModels.has(modelId)) {
        body['think'] = true;
      } else if (options.think === false) {
        // Explicit off must be SENT, not implied: thinking-capable models
        // (qwen3.x, DeepSeek-R1) think by default when the key is absent,
        // so callers that set think:false (summarisation, memory
        // extraction, JSON-constrained generation) were silently paying
        // the full thinking cost anyway.
        body['think'] = false;
      }
    }
    if (Object.keys(ollamaOptions).length > 0) body['options'] = ollamaOptions;

    body['keep_alive'] = '30m'; // loaded 30 minutes after the last request, not Ollama's 5: no cold start mid-session

    // A size the app chose on its own is measured (ollamaContextFit.ts): a
    // load that spills off the card is sent again, once, at the size that fits.
    const chosenByApp = !(options?.numCtx && options.numCtx > 0) && !(this._contextLengthOverride > 0);
    const size = Number(ollamaOptions['num_ctx']) || 0;
    const watch = chosenByApp && size > 0 && !this._contextFits.has(modelId)
      ? watchContextFit({ modelId, contextLength: size, weightBytes: this._weightBytes.get(modelId), pollMs: OllamaProvider.FIT_POLL_MS, maxMs: OllamaProvider.FIT_WATCH_MS,
        ps: () => this._fetchJson<OllamaPsResponse>(`${this._baseUrl}/api/ps`, { method: 'GET' }, METADATA_TIMEOUT_MS),
        onFit: (fit) => { this._contextFits.set(modelId, fit); this._onDidLearnContextFit.fire({ modelId, numCtx: fit }); } })
      : undefined;
    try {
      for await (const chunk of this._streamOnce(modelId, body, signal, thinkTag, watch?.signal)) { watch?.stop(); yield chunk; }
    } catch (err) {
      if (!(watch && watch.refit > 0) || signal?.aborted) throw err;
    } finally { watch?.stop(); }
    if (watch && watch.refit > 0 && !signal?.aborted) {
      body['options'] = { ...ollamaOptions, num_ctx: watch.refit };
      this._lastNumCtx.set(modelId, watch.refit);
      this._onDidSendChatRequest.fire({ modelId, numCtx: watch.refit });
      yield* this._streamOnce(modelId, body, signal, thinkTag);
    }
  }

  /** One attempt at /api/chat with the body as built; `stopSignal` ends it from inside (a spilled load). */
  private async *_streamOnce(modelId: string, body: Record<string, unknown>, signal: AbortSignal | undefined, thinkTag: { open: boolean }, stopSignal?: AbortSignal): AsyncIterable<IChatResponseChunk> {
    // The caller's abort signal is forwarded (Stop, the engine broker's
    // first-output watchdog). No total timeout: it would cut a long thinking
    // answer short.
    const controller = new AbortController();
    if (stopSignal) stopSignal.addEventListener('abort', () => controller.abort(), { once: true });

    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    let response = await fetch(`${this._baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // If the think key is rejected (models that predate the option),
    // cache and retry without it. Checked with `in` because an explicit
    // think:false is falsy but still present in the request body.
    if (!response.ok && response.status === 400 && 'think' in body) {
      const errorText = await response.text();
      if (errorText.includes('does not support thinking')) {
        console.warn(`[OllamaProvider] ${modelId} does not support thinking — retrying without think:true`);
        this._noThinkModels.add(modelId);
        delete body['think'];
        response = await fetch(`${this._baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } else {
        throw new Error(`Ollama returned HTTP ${response.status}: ${errorText}`);
      }
    }

    if (!response.ok) {
      throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
    }

    if (!response.body) {
      throw new Error('Response body is null. Streaming is not supported.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    let receivedDone = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk: OllamaChatChunk;
          try {
            chunk = JSON.parse(trimmed) as OllamaChatChunk;
          } catch {
            console.warn('[OllamaProvider] Malformed streaming chunk:', trimmed);
            yield { content: '\n\n**Warning:** *[Malformed response chunk, partial data may be missing]*', done: false } as IChatResponseChunk;
            continue;
          }

          // Mid-stream error objects ({"error": "..."}) are how Ollama
          // reports runner crashes and OOM during generation. Swallowing
          // them (they have no `message` body) made every such failure
          // look like a mysteriously cut-off response downstream.
          if (chunk.error) {
            throw new Error(`Ollama stream error: ${chunk.error}`);
          }

          // Skip chunks with no message body (e.g. done:true completion markers)
          if (!chunk.message) {
            if (chunk.done) { receivedDone = true; }
            continue;
          }

          // Validate tool call arguments if present
          if (chunk.message.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              if (!tc.function?.name || typeof tc.function.arguments !== 'object') {
                console.warn('[OllamaProvider] Invalid tool call structure:', JSON.stringify(tc));
                yield { content: `\n\n**Warning:** *[Tool call error: malformed call to "${tc.function?.name ?? 'unknown'}"]*`, done: false } as IChatResponseChunk;
              }
            }
          }

          if (chunk.done) { receivedDone = true; }
          yield this._parseChunk(chunk, thinkTag);
        }
      }

      // Process any remaining buffer content
      if (buffer.trim()) {
        let chunk: OllamaChatChunk | undefined;
        try {
          chunk = JSON.parse(buffer.trim()) as OllamaChatChunk;
        } catch {
          console.warn('[OllamaProvider] Malformed trailing chunk:', buffer.trim());
        }
        if (chunk) {
          if (chunk.error) {
            throw new Error(`Ollama stream error: ${chunk.error}`);
          }
          if (chunk.done) { receivedDone = true; }
          if (chunk.message) {
            yield this._parseChunk(chunk, thinkTag);
          }
        }
      }

      // Stream ended without a done:true final chunk — connection dropped
      if (!receivedDone) {
        console.warn('[OllamaProvider] Stream ended without done:true — connection may have dropped');
        yield { content: '\n\n**Warning:** *[Response interrupted, the connection was lost. Try sending your message again.]*', done: true } as IChatResponseChunk;
      }
    } finally {
      reader.releaseLock();
      // A consumer that stops reading (Stop, a timeout, a preemption, a
      // break) must close the request too: otherwise Ollama keeps
      // generating into a socket nobody reads, holding its only slot.
      controller.abort();
      // A request may have just loaded (or reloaded) the model: look again
      // at where it sits, so the chip's "on GPU" is current.
      setTimeout(() => { void this._pollLoadedModels(); }, 500);
    }
  }

  // ── Health Monitor (Task 1.3) ──

  /** Get the last known status. */
  get status(): IProviderStatus {
    return this._lastStatus;
  }

  /** Get currently loaded model names. */
  get loadedModels(): readonly string[] {
    return this._loadedModels;
  }

  // ── Internal: Formatting Helpers ──

  private _formatMessage(msg: IChatMessage): OllamaRequestMessage {
    const out: OllamaRequestMessage = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.images?.length) {
      out.images = msg.images.map((image) => image.data);
    }
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      out['tool_calls'] = msg.toolCalls.map((tc) => ({
        function: { name: tc.function.name, arguments: tc.function.arguments },
      }));
    }
    if (msg.toolName) {
      out['tool_name'] = msg.toolName;
    }
    return out;
  }

  _debugFormatMessage(msg: IChatMessage): OllamaRequestMessage {
    return this._formatMessage(msg);
  }

  private _formatToolDefinition(tool: IToolDefinition): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  private _parseChunk(chunk: OllamaChatChunk, thinkTag: { open: boolean }): IChatResponseChunk {
    let content = chunk.message.content || '';
    let thinking = chunk.message.thinking || undefined;

    // Fallback: detect inline <think> tags for models that embed
    // reasoning in the content stream (e.g. DeepSeek-R1 via older Ollama).
    // Extract thinking text and strip the tags from the content.
    if (!thinking && content) {
      const parsed = _extractInlineThinking(content, thinkTag.open);
      if (parsed) {
        content = parsed.content;
        thinking = parsed.thinking || undefined;
        thinkTag.open = parsed.stillInTag;
      }
    }

    const result: IChatResponseChunk = {
      content,
      thinking,
      toolCalls: chunk.message.tool_calls?.map((tc) => ({
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      done: chunk.done,
      promptEvalCount: chunk.prompt_eval_count,
      evalCount: chunk.eval_count,
      evalDuration: chunk.eval_duration,
      ...(chunk.done && chunk.done_reason ? { doneReason: chunk.done_reason } : {}),
    };

    return result;
  }

  private _formatDisplayName(modelId: string): string {
    // 'llama3.2:latest' → 'Llama 3.2'
    const base = modelId.split(':')[0];
    // Insert space before version numbers: 'llama3.2' → 'llama 3.2'
    const spaced = base.replace(/([a-zA-Z])(\d)/, '$1 $2');
    // Capitalize first letter
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  /** Maximum context length Parallx will request (matches Ollama desktop max). */
  private static readonly MAX_CONTEXT_LENGTH = 262144; // 256K
  /**
   * The first attempt for a model the app has never run: Auto with nothing
   * loaded, no size measured and none ever named for it. A model's own
   * length is what it can address, not what runs: a 31B model at 131072 on
   * a 32 GB card is reported by Ollama as sitting on the card and generates
   * at 4 tokens a second, the driver having spilled it unseen; at 65536 the
   * same model runs at 50. After the first run, Auto is the size the user
   * last named for the model, kept across restarts; a size the user names
   * is never capped.
   */
  static readonly AUTO_MAX_CONTEXT = 65536;

  private _extractContextLength(
    modelInfo: Record<string, unknown>,
    parameters?: string,
  ): number {
    // 1. Read the GGUF-declared context_length (family-prefixed key).
    //    Some model publishers set this conservatively (e.g. qwen2.5 says
    //    32768 even though the architecture supports 128K).
    let ggufContextLength = 0;
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.context_length') && typeof value === 'number' && value > 0) {
        ggufContextLength = value;
        break;
      }
    }

    // 2. Compute the model's REAL max from rope_freq_base.
    //    RoPE frequency base directly determines maximum supported context:
    //    - rope_freq_base  10000 →   8K (base LLaMA)
    //    - rope_freq_base 500000 → 128K (LLaMA 3.1)
    //    - rope_freq_base 1000000 → 128K (Qwen 2.5)
    //    - rope_freq_base 10000000 → 256K+ (Qwen 3)
    let ropeMaxContext = 0;
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.rope.freq_base') && typeof value === 'number' && value > 0) {
        ropeMaxContext = this._ropeFreqBaseToMaxContext(value);
        break;
      }
    }

    // 3. Use the MAXIMUM of GGUF context_length and rope-derived max.
    //    This catches models where the publisher set a conservative default
    //    but the architecture supports more.
    let contextLength = Math.max(ggufContextLength, ropeMaxContext);

    // 4. Check Modelfile parameters for explicit num_ctx override.
    //    e.g. "num_ctx 131072\ntemperature 0.7"
    if (parameters) {
      const match = parameters.match(/num_ctx\s+(\d+)/);
      if (match) {
        const parsed = parseInt(match[1], 10);
        if (parsed > 0) contextLength = Math.max(contextLength, parsed);
      }
    }

    // 5. Cap at 256K (Ollama's max) and ensure a reasonable minimum.
    if (contextLength <= 0) { contextLength = 4096; }
    return Math.min(contextLength, OllamaProvider.MAX_CONTEXT_LENGTH);
  }

  /**
   * Estimate maximum context length from RoPE frequency base.
   * Based on standard RoPE scaling: higher freq_base = longer context.
   */
  private _ropeFreqBaseToMaxContext(freqBase: number): number {
    // These thresholds are based on published model architectures:
    if (freqBase >= 10_000_000) return 262144;  // 256K (Qwen3, etc.)
    if (freqBase >= 1_000_000)  return 131072;  // 128K (Qwen2.5, Gemma2)
    if (freqBase >= 500_000)    return 131072;  // 128K (LLaMA 3.1)
    if (freqBase >= 100_000)    return 65536;   //  64K
    if (freqBase >= 50_000)     return 32768;   //  32K
    if (freqBase >= 10_000)     return 8192;    //   8K (base LLaMA)
    return 4096;
  }

  private async _fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Internal: Health Polling (Task 1.3) ──

  private async _pollHealth(): Promise<void> {
    const newStatus = await this.checkAvailability();
    const wasAvailable = this._lastStatus.available;
    const isAvailable = newStatus.available;

    if (wasAvailable !== isAvailable) {
      this._lastStatus = newStatus;
      this._onDidChangeStatus.fire(newStatus);
    } else {
      this._lastStatus = newStatus;
    }

    if (isAvailable) {
      this._consecutiveFailures = 0;
      this._hasEverConnected = true;
      // Connected — end startup burst early
      this._startupBurst = false;
      // Also poll loaded models
      await this._pollLoadedModels();
      // Nothing is loaded here. A chat model loaded on the app's own
      // initiative at launch held the engine while the user's first request,
      // for another model at another size, waited behind it. The embedding
      // service warms its own model when indexing starts (ensureModel).
    } else {
      this._consecutiveFailures++;
    }

    // Reschedule with dynamic interval
    this._schedulePoll();
  }

  private async _pollLoadedModels(): Promise<void> {
    try {
      const data = await this._fetchJson<OllamaPsResponse>(
        `${this._baseUrl}/api/ps`,
        { method: 'GET' },
        METADATA_TIMEOUT_MS,
      );
      const newLoaded = data.models.map((m) => m.name);
      const placements = data.models.map(placementOf);
      const key = JSON.stringify(placements);
      if (key !== this._placementKey) {
        this._placementKey = key;
        this._placements = placements;
        this._onDidChangePlacement.fire();
      }
      const changed =
        newLoaded.length !== this._loadedModels.length ||
        newLoaded.some((name, i) => name !== this._loadedModels[i]);

      if (changed) {
        this._loadedModels = newLoaded;
        this._onDidChangeLoadedModels.fire(newLoaded);
      }
    } catch {
      // Non-critical — don't change loaded models on failure
    }
  }

  private _schedulePoll(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }

    let interval: number;
    if (this._startupBurst) {
      // Fast-poll during startup for snappy first connection
      interval = HEALTH_POLL_STARTUP_MS;
    } else if (this._lastStatus.available) {
      interval = HEALTH_POLL_CONNECTED_MS;
    } else if (this._hasEverConnected && this._consecutiveFailures >= HEALTH_FAILURE_BACKOFF_THRESHOLD) {
      interval = HEALTH_POLL_BACKOFF_MS;
    } else if (this._consecutiveFailures >= HEALTH_FAILURE_BACKOFF_THRESHOLD) {
      interval = HEALTH_POLL_NEVER_SEEN_MS;
    } else {
      interval = HEALTH_POLL_DISCONNECTED_MS;
    }

    this._pollTimer = setInterval(() => {
      // Minimised or hidden: nobody is reading the status; skip the wake-up.
      if (typeof document !== 'undefined' && document.hidden) return;
      this._pollHealth();
    }, interval);
  }

  override dispose(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    super.dispose();
  }
}

// ── Inline <think> tag parser ──

/**
 * Extracts thinking content from `<think>...</think>` tags that some models
 * (DeepSeek-R1, QwQ) embed inline in the content stream.  Handles partial
 * tags across streaming chunks via the `wasInTag` carry-over flag.
 *
 * Returns `null` when the chunk contains no think tags and `wasInTag` is false.
 */
export function _extractInlineThinking(
  text: string,
  wasInTag: boolean,
): { content: string; thinking: string; stillInTag: boolean } | null {
  let content = '';
  let thinking = '';
  let inTag = wasInTag;
  let i = 0;

  // Quick bail: no tags and not continuing a tag
  if (!inTag && !text.includes('<think')) {
    return null;
  }

  while (i < text.length) {
    if (!inTag) {
      const openIdx = text.indexOf('<think>', i);
      if (openIdx === -1) {
        content += text.slice(i);
        break;
      }
      content += text.slice(i, openIdx);
      inTag = true;
      i = openIdx + 7; // skip '<think>'
    } else {
      const closeIdx = text.indexOf('</think>', i);
      if (closeIdx === -1) {
        // Tag continues into next chunk
        thinking += text.slice(i);
        break;
      }
      thinking += text.slice(i, closeIdx);
      inTag = false;
      i = closeIdx + 8; // skip '</think>'
    }
  }

  return { content, thinking, stillInTag: inTag };
}
