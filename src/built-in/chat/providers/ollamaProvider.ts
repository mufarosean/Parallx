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
  model_info: Record<string, unknown>;
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
  eval_count?: number;
  eval_duration?: number;
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
    const contextLength = this._extractContextLength(response.model_info);

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

    // Map options
    if (options) {
      const ollamaOptions: Record<string, unknown> = {};
      if (options.temperature !== undefined) ollamaOptions['temperature'] = options.temperature;
      if (options.topP !== undefined) ollamaOptions['top_p'] = options.topP;
      if (options.maxTokens !== undefined) ollamaOptions['num_predict'] = options.maxTokens;
      if (options.seed !== undefined) ollamaOptions['seed'] = options.seed;
      if (Object.keys(ollamaOptions).length > 0) body['options'] = ollamaOptions;

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

  private _extractContextLength(modelInfo: Record<string, unknown>): number {
    // Ollama stores context length under family-prefixed keys:
    // 'llama.context_length', 'gemma.context_length', etc.
    for (const [key, value] of Object.entries(modelInfo)) {
      if (key.endsWith('.context_length') && typeof value === 'number') {
        return value;
      }
    }
    // Fallback: common default
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
