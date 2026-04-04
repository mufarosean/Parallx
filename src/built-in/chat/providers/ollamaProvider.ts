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
  }[];
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
}

// IRetrievalPlan — re-exported for external consumers (now defined in chatTypes.ts)
export type { IRetrievalPlan } from '../chatTypes.js';

// ── Timeouts ──

const METADATA_TIMEOUT_MS = 10_000;
const HEALTH_POLL_CONNECTED_MS = 30_000;
const HEALTH_POLL_DISCONNECTED_MS = 5_000;
const HEALTH_POLL_BACKOFF_MS = 60_000;
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
  readonly displayName = 'Ollama';

  private readonly _baseUrl: string;

  // ── Health Monitor (Task 1.3) ──

  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _lastStatus: IProviderStatus = { available: false };
  private _consecutiveFailures = 0;
  private _loadedModels: string[] = [];
  private _hasEverConnected = false;

  /** True while in the startup burst window (fast polling). */
  private _startupBurst = true;

  /** True once we've already sent a pre-load request (avoids duplicates). */
  private _preloadRequested = false;

  private readonly _onDidChangeStatus = this._register(new Emitter<IProviderStatus>());
  readonly onDidChangeStatus: Event<IProviderStatus> = this._onDidChangeStatus.event;

  private readonly _onDidChangeLoadedModels = this._register(new Emitter<readonly string[]>());
  readonly onDidChangeLoadedModels: Event<readonly string[]> = this._onDidChangeLoadedModels.event;

  constructor(baseUrl = 'http://localhost:11434') {
    super();

    this._baseUrl = baseUrl;

    // Initial check + start polling
    this._pollHealth();
    this._schedulePoll();

    // End startup burst after the window expires
    const startupTimeout = setTimeout(() => { this._startupBurst = false; this._schedulePoll(); }, HEALTH_STARTUP_WINDOW_MS);
    this._register(toDisposable(() => clearTimeout(startupTimeout)));
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

  // ── Context length cache for active model (Cap 9.5) ──

  private _contextLengthCache = new Map<string, number>();

  /**
   * User-configured context length override. When > 0, this value is sent
   * as num_ctx to Ollama and used for token bar display. When 0, no num_ctx
   * is sent — Ollama uses its own setting (desktop slider / OLLAMA_NUM_CTX).
   */
  private _contextLengthOverride = 0;

  /** Tracks whether we're inside a `<think>` tag across stream chunks. */
  private _inThinkTag = false;

  /** Models that returned 400 for think:true — skip on subsequent calls. */
  private _noThinkModels = new Set<string>();

  /** Set context length override (0 = let Ollama decide). */
  setContextLengthOverride(value: number): void {
    this._contextLengthOverride = Math.max(0, Math.floor(value));
  }

  /** Reset streaming parser state (called on model switch to avoid stale artifacts). */
  resetStreamState(): void {
    this._inThinkTag = false;
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
    if (cached !== undefined) { return cached; }
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
    const cached = this._contextLengthCache.get(modelId);
    if (cached !== undefined) { return cached; }
    // Fire-and-forget background fetch
    this.getModelInfo(modelId).then((info) => {
      this._contextLengthCache.set(modelId, info.contextLength);
    }).catch(() => { /* best effort */ });
    return 0;
  }

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

  // ── Model Pre-loading (M17 Task 0.2.2 / 0.2.3) ──

  /**
   * Pre-loads a chat model (and the embedding model) into VRAM so the
   * first real request doesn't pay a cold-start penalty.
   *
   * Sends a zero-token `/api/chat` request with `keep_alive: '30m'` and
   * a single-token `/api/embed` request to warm both models in parallel.
   * Fire-and-forget — failures are silently logged.
   */
  async preloadModel(modelId: string): Promise<void> {
    if (!modelId) { return; }

    const warmChat = fetch(`${this._baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [],
        keep_alive: '30m',
      }),
    }).then(r => { if (!r.ok) { console.warn(`[OllamaProvider] preload chat model failed: HTTP ${r.status}`); } })
      .catch(err => { console.warn('[OllamaProvider] preload chat model error:', err); });

    const warmEmbed = fetch(`${this._baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'nomic-embed-text',
        input: 'warmup',
        keep_alive: '30m',
      }),
    }).then(r => { if (!r.ok) { console.warn(`[OllamaProvider] preload embed model failed: HTTP ${r.status}`); } })
      .catch(err => { console.warn('[OllamaProvider] preload embed model error:', err); });

    await Promise.all([warmChat, warmEmbed]);
    console.log(`[OllamaProvider] Pre-loaded models: ${modelId} + nomic-embed-text`);
  }

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
    // Check for thinking support (DeepSeek-R1, QwQ, etc.)
    const familyLower = response.details.family.toLowerCase();
    if (familyLower.includes('deepseek') || familyLower.includes('qwq')) {
      capabilities.push('thinking');
    }

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
    // Build request body
    const body: Record<string, unknown> = {
      model: modelId,
      messages: messages.map((m) => this._formatMessage(m)),
      stream: true,
    };

    // Only send num_ctx when the user has explicitly configured an override.
    // Otherwise let Ollama use its own setting (Modelfile, desktop slider,
    // or OLLAMA_NUM_CTX env var).  This matches native Ollama behavior —
    // Ollama allocates KV-cache based on ITS configured num_ctx, not the
    // model's theoretical maximum.  Sending the theoretical max (e.g. 262K
    // for qwen3) forces Ollama to allocate a massive KV-cache that cripples
    // inference speed even for tiny prompts.
    const ollamaOptions: Record<string, unknown> = {};
    // num_ctx priority: per-request numCtx > provider-level override > Ollama default
    if (options?.numCtx && options.numCtx > 0) {
      ollamaOptions['num_ctx'] = options.numCtx;
    } else if (this._contextLengthOverride > 0) {
      ollamaOptions['num_ctx'] = this._contextLengthOverride;
    }
    if (options) {
      if (options.temperature !== undefined) ollamaOptions['temperature'] = Math.max(0, Math.min(2, options.temperature));
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
      }
    }
    if (Object.keys(ollamaOptions).length > 0) body['options'] = ollamaOptions;

    // Keep the model loaded in VRAM for 30 minutes after the last request
    // instead of Ollama's default 5 minutes. This eliminates cold-start
    // penalties during active study sessions (M17 Task 0.2.1).
    body['keep_alive'] = '30m';

    // Forward the caller's abort signal (user cancellation + participant stall
    // timeout).  No hard total timeout here — the participant-level stall
    // timeout (resets on each chunk) is the correct safeguard against hung
    // connections.  A fixed total timeout would kill long-running thinking
    // models (qwen3, DeepSeek-R1) mid-response.
    const controller = new AbortController();

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

    // If thinking is rejected, cache and retry without it
    if (!response.ok && response.status === 400 && body['think']) {
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
      throw new Error('Response body is null — streaming not supported.');
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
            yield { content: '\n\n**Warning:** *[Malformed response chunk — partial data may be missing]*', done: false } as IChatResponseChunk;
            continue;
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
          yield this._parseChunk(chunk);
        }
      }

      // Process any remaining buffer content
      if (buffer.trim()) {
        let chunk: OllamaChatChunk;
        try {
          chunk = JSON.parse(buffer.trim()) as OllamaChatChunk;
          if (chunk.done) { receivedDone = true; }
          if (chunk.message) {
            yield this._parseChunk(chunk);
          }
        } catch {
          console.warn('[OllamaProvider] Malformed trailing chunk:', buffer.trim());
        }
      }

      // Stream ended without a done:true final chunk — connection dropped
      if (!receivedDone) {
        console.warn('[OllamaProvider] Stream ended without done:true — connection may have dropped');
        yield { content: '\n\n**Warning:** *[Response interrupted — connection lost. Try sending your message again.]*', done: true } as IChatResponseChunk;
      }
    } finally {
      reader.releaseLock();
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

  private _parseChunk(chunk: OllamaChatChunk): IChatResponseChunk {
    let content = chunk.message.content || '';
    let thinking = chunk.message.thinking || undefined;

    // Fallback: detect inline <think> tags for models that embed
    // reasoning in the content stream (e.g. DeepSeek-R1 via older Ollama).
    // Extract thinking text and strip the tags from the content.
    if (!thinking && content) {
      const parsed = _extractInlineThinking(content, this._inThinkTag);
      if (parsed) {
        content = parsed.content;
        thinking = parsed.thinking || undefined;
        this._inThinkTag = parsed.stillInTag;
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
    };

    // Reset tag tracker on final chunk
    if (chunk.done) {
      this._inThinkTag = false;
    }

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

      // Pre-load the active model on first availability detection (M17 Task 0.2.2)
      if (!this._preloadRequested && this._loadedModels.length === 0) {
        this._preloadRequested = true;
        // Defer to avoid blocking the poll cycle — preload is fire-and-forget
        this._triggerPreload();
      }
    } else {
      this._consecutiveFailures++;
    }

    // Reschedule with dynamic interval
    this._schedulePoll();
  }

  /**
   * Trigger model pre-loading. Attempts to find the configured/active model
   * from the loaded models list or falls back to listing available models
   * and picking the first one.
   */
  private _triggerPreload(): void {
    // Use setTimeout to avoid blocking the poll cycle
    setTimeout(async () => {
      try {
        // Try to detect the user's model — check loaded first, then list all
        let modelId = this._loadedModels[0] ?? '';
        if (!modelId) {
          const models = await this.listModels();
          if (models.length > 0) {
            modelId = models[0].id;
          }
        }
        if (modelId) {
          await this.preloadModel(modelId);
        }
      } catch (err) {
        console.warn('[OllamaProvider] _triggerPreload failed:', err);
      }
    }, 100);
  }

  private async _pollLoadedModels(): Promise<void> {
    try {
      const data = await this._fetchJson<OllamaPsResponse>(
        `${this._baseUrl}/api/ps`,
        { method: 'GET' },
        METADATA_TIMEOUT_MS,
      );
      const newLoaded = data.models.map((m) => m.name);
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
    } else {
      interval = HEALTH_POLL_DISCONNECTED_MS;
    }

    this._pollTimer = setInterval(() => {
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
