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
    tool_calls?: { function: { name: string; arguments: Record<string, unknown> } }[];
  };
  done: boolean;
  /** Number of tokens in the prompt (present on final chunk). */
  prompt_eval_count?: number;
  /** Number of tokens generated (present on final chunk). */
  eval_count?: number;
  eval_duration?: number;
}

// ── Retrieval Plan (M12 Task 1.2) ────────────────────────────────────────────

/**
 * Structured output from the retrieval planner LLM call.
 * Contains intent classification, reasoning, and targeted search queries.
 */
export interface IRetrievalPlan {
  /** Classified intent of the user's message. */
  intent: 'question' | 'situation' | 'task' | 'conversational' | 'exploration';
  /** 1-2 sentence explanation of what the user needs. */
  reasoning: string;
  /** Whether workspace retrieval is needed. */
  needsRetrieval: boolean;
  /** Targeted search queries (0-6) designed to match document vocabulary. */
  queries: string[];
}

// ── Timeouts ──

const METADATA_TIMEOUT_MS = 10_000;
const CHAT_TIMEOUT_MS = 120_000;
const HEALTH_POLL_CONNECTED_MS = 30_000;
const HEALTH_POLL_DISCONNECTED_MS = 5_000;
const HEALTH_POLL_BACKOFF_MS = 60_000;
const HEALTH_FAILURE_BACKOFF_THRESHOLD = 5;

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

  /** Set context length override (0 = let Ollama decide). */
  setContextLengthOverride(value: number): void {
    this._contextLengthOverride = Math.max(0, Math.floor(value));
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

    // Always send num_ctx so Ollama allocates the model's full context
    // window (without this, Ollama may default to 2048 tokens).
    // User override takes priority; otherwise use the model's detected max.
    const ollamaOptions: Record<string, unknown> = {};
    const effectiveCtx = this._contextLengthOverride > 0
      ? this._contextLengthOverride
      : this._contextLengthCache.get(modelId);
    if (effectiveCtx && effectiveCtx > 0) {
      ollamaOptions['num_ctx'] = effectiveCtx;
    }
    if (options) {
      if (options.temperature !== undefined) ollamaOptions['temperature'] = options.temperature;
      if (options.topP !== undefined) ollamaOptions['top_p'] = options.topP;
      if (options.maxTokens !== undefined) ollamaOptions['num_predict'] = options.maxTokens;
      if (options.seed !== undefined) ollamaOptions['seed'] = options.seed;

      if (options.tools && options.tools.length > 0) {
        body['tools'] = options.tools.map((t) => this._formatToolDefinition(t));
      }
      if (options.format) {
        body['format'] = options.format;
      }
      if (options.think) {
        body['think'] = true;
      }
    }
    if (Object.keys(ollamaOptions).length > 0) body['options'] = ollamaOptions;

    // Create a combined abort signal (user cancellation + timeout)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
      const response = await fetch(`${this._baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama returned HTTP ${response.status}: ${await response.text()}`);
      }

      if (!response.body) {
        throw new Error('Response body is null — streaming not supported.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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

            try {
              const chunk = JSON.parse(trimmed) as OllamaChatChunk;
              yield this._parseChunk(chunk);
            } catch {
              // Malformed JSON line — skip
              console.warn('[OllamaProvider] Malformed streaming chunk:', trimmed);
            }
          }
        }

        // Process any remaining buffer content
        if (buffer.trim()) {
          try {
            const chunk = JSON.parse(buffer.trim()) as OllamaChatChunk;
            yield this._parseChunk(chunk);
          } catch {
            // Ignore trailing incomplete data
          }
        }
      } finally {
        reader.releaseLock();
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ── Retrieval Planner (M12 Task 1.2) ──

  /**
   * Run a lightweight planning LLM call to classify intent and generate
   * targeted search queries. Consumes the full streaming response, then
   * parses JSON from the output.
   *
   * Returns a default fallback plan on any failure (malformed JSON, timeout,
   * network error) so callers never crash.
   */
  async planRetrieval(
    modelId: string,
    messages: readonly IChatMessage[],
    signal?: AbortSignal,
  ): Promise<IRetrievalPlan> {
    const fallback: IRetrievalPlan = {
      intent: 'question',
      reasoning: 'Planning call failed — falling back to direct query.',
      needsRetrieval: true,
      queries: [],
    };

    try {
      // Use low temperature + limited tokens for deterministic, fast planning
      const options: IChatRequestOptions = {
        temperature: 0.1,
        maxTokens: 400,
      };

      let fullText = '';
      for await (const chunk of this.sendChatRequest(modelId, messages, options, signal)) {
        if (chunk.content) { fullText += chunk.content; }
      }

      return this._parsePlannerResponse(fullText, fallback);
    } catch (err) {
      console.warn('[OllamaProvider] planRetrieval failed:', err);
      return fallback;
    }
  }

  /**
   * Parse the planner LLM's text output into a structured IRetrievalPlan.
   * Attempts JSON.parse first, then tries to extract a JSON block from
   * markdown fences, then falls back to free-text query extraction.
   */
  private _parsePlannerResponse(text: string, fallback: IRetrievalPlan): IRetrievalPlan {
    const trimmed = text.trim();

    // Attempt 1: Direct JSON parse
    let parsed = this._tryParseJson(trimmed);
    if (parsed) { return this._normalizePlan(parsed); }

    // Attempt 2: Extract JSON from markdown code fence
    const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (fenceMatch) {
      parsed = this._tryParseJson(fenceMatch[1].trim());
      if (parsed) { return this._normalizePlan(parsed); }
    }

    // Attempt 3: Find first { ... } block
    const braceStart = trimmed.indexOf('{');
    const braceEnd = trimmed.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      parsed = this._tryParseJson(trimmed.slice(braceStart, braceEnd + 1));
      if (parsed) { return this._normalizePlan(parsed); }
    }

    // All JSON parsing failed — return fallback
    console.warn('[OllamaProvider] Could not parse planner JSON, using fallback. Raw:', trimmed.slice(0, 200));
    return fallback;
  }

  private _tryParseJson(text: string): Record<string, unknown> | null {
    try {
      const obj = JSON.parse(text);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) { return obj; }
    } catch { /* not valid JSON */ }
    return null;
  }

  private _normalizePlan(raw: Record<string, unknown>): IRetrievalPlan {
    const validIntents = ['question', 'situation', 'task', 'conversational', 'exploration'];
    const intent = typeof raw['intent'] === 'string' && validIntents.includes(raw['intent'])
      ? raw['intent'] as IRetrievalPlan['intent']
      : 'question';

    const reasoning = typeof raw['reasoning'] === 'string'
      ? raw['reasoning']
      : '';

    const needsRetrieval = typeof raw['needs_retrieval'] === 'boolean'
      ? raw['needs_retrieval']
      : (typeof raw['needsRetrieval'] === 'boolean' ? raw['needsRetrieval'] as boolean : true);

    let queries: string[] = [];
    if (Array.isArray(raw['queries'])) {
      queries = raw['queries']
        .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
        .slice(0, 6); // Cap at 6 queries max
    }

    return { intent, reasoning, needsRetrieval, queries };
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

  private _formatMessage(msg: IChatMessage): Record<string, unknown> {
    const out: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
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
    const result: IChatResponseChunk = {
      content: chunk.message.content || '',
      thinking: undefined,
      toolCalls: chunk.message.tool_calls?.map((tc) => ({
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
      done: chunk.done,
      promptEvalCount: chunk.prompt_eval_count,
      evalCount: chunk.eval_count,
      evalDuration: chunk.eval_duration,
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
      // Also poll loaded models
      await this._pollLoadedModels();
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
    if (this._lastStatus.available) {
      interval = HEALTH_POLL_CONNECTED_MS;
    } else if (this._consecutiveFailures >= HEALTH_FAILURE_BACKOFF_THRESHOLD) {
      interval = HEALTH_POLL_BACKOFF_MS;
    } else {
      interval = HEALTH_POLL_DISCONNECTED_MS;
    }

    this._pollTimer = setInterval(() => {
      this._pollHealth();
    }, interval);

    // Ensure polling stops on dispose
    this._register(toDisposable(() => {
      if (this._pollTimer !== null) {
        clearInterval(this._pollTimer);
        this._pollTimer = null;
      }
    }));
  }

  override dispose(): void {
    if (this._pollTimer !== null) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    super.dispose();
  }
}
