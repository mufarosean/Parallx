// openaiCompatibleProvider.ts — ILanguageModelProvider for any server that
// speaks the OpenAI chat-completions API: LM Studio, llama.cpp server, vLLM,
// LocalAI, Lemonade, MLX servers, or a hosted endpoint.
//
// One provider instead of one per vendor. It implements the same interface as
// ollamaProvider.ts and anthropicProvider.ts, so the model picker, the agent
// loop, tools and streaming work unchanged.
//
// All HTTP goes through the main process (electron/openaiCompatibleBridge.cjs):
// the renderer CSP reaches only Ollama, and an optional API key stays in main,
// bound to the server it was saved for. This module builds the request body and
// decodes the SSE stream; the pure functions are exported for unit tests.
//
// Model ids are namespaced (`openai-compatible::<server id>`) so they never
// collide with an Ollama model of the same name; the prefix is removed before
// the request goes out.

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
  IToolCall,
  ModelCapability,
} from '../../../services/chatTypes.js';

// ── Main-process bridge (window.parallxElectron.openaiCompatible) ─────────────

/** A relayed stream event from the main-process pipe. */
export interface IOpenAICompatibleStreamEvent {
  readonly requestId: string;
  readonly type: 'data' | 'end' | 'error' | 'aborted';
  readonly data?: string;
  readonly error?: string;
}

/** Renderer facade over electron/openaiCompatibleBridge.cjs. The key stays in main. */
export interface IOpenAICompatibleBridge {
  hasKey(baseUrl?: string): Promise<boolean>;
  setKey(key: string, baseUrl: string): Promise<{ ok: boolean; error?: string }>;
  clearKey(): Promise<unknown>;
  listModels(baseUrl: string): Promise<{ ok: boolean; data?: unknown[]; error?: string }>;
  startStream(requestId: string, baseUrl: string, body: unknown): Promise<{ ok: boolean; error?: string }>;
  abortStream(requestId: string): Promise<unknown>;
  onStreamEvent(cb: (event: IOpenAICompatibleStreamEvent) => void): () => void;
}

/** Resolve the bridge from the preload, or undefined (tests, a browser build). */
export function getOpenAICompatibleBridge(): IOpenAICompatibleBridge | undefined {
  return (globalThis as { parallxElectron?: { openaiCompatible?: IOpenAICompatibleBridge } })
    .parallxElectron?.openaiCompatible;
}

// ── Ids and URLs ──────────────────────────────────────────────────────────────

export const OPENAI_COMPATIBLE_PROVIDER_ID = 'openai-compatible';
export const OPENAI_COMPATIBLE_MODEL_PREFIX = 'openai-compatible::';
export const OPENAI_COMPATIBLE_DEFAULT_BASE_URL = 'http://localhost:1234/v1';
/** Used when the server does not say how long its context is. */
export const OPENAI_COMPATIBLE_DEFAULT_CONTEXT = 8192;

export function toNamespacedModelId(serverId: string): string {
  return OPENAI_COMPATIBLE_MODEL_PREFIX + serverId;
}

/** The id the server knows, from a namespaced id (unchanged if not namespaced). */
export function toServerModelId(modelId: string): string {
  return modelId.startsWith(OPENAI_COMPATIBLE_MODEL_PREFIX)
    ? modelId.slice(OPENAI_COMPATIBLE_MODEL_PREFIX.length)
    : modelId;
}

/** Trim and drop trailing slashes; an empty value falls back to the default. */
export function normalizeBaseUrl(raw: string | undefined): string {
  const t = (raw ?? '').trim().replace(/\/+$/, '');
  return t || OPENAI_COMPATIBLE_DEFAULT_BASE_URL;
}

/** True when the URL names this machine (localhost, 127.x, ::1). */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const h = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return h === 'localhost' || h === '::1' || /^127\.\d+\.\d+\.\d+$/.test(h);
  } catch { return false; }
}

/** host:port of a URL, for telling servers apart in the model picker. */
function hostLabel(raw: string): string {
  try { return new URL(raw).host; } catch { return raw; }
}

// ── Model listing (exported for tests) ────────────────────────────────────────

/**
 * Map a `GET /models` list to model infos. Servers that report a context length
 * (vLLM `max_model_len`, LM Studio `max_context_length`, others
 * `context_length`) are believed; the rest get a conservative default.
 * Embedding models are left out: they cannot chat.
 */
export function modelsFromListResponse(data: readonly unknown[], baseUrl: string): ILanguageModelInfo[] {
  const host = hostLabel(baseUrl);
  const out: ILanguageModelInfo[] = [];
  const seen = new Set<string>();
  for (const raw of data) {
    const m = raw as Record<string, unknown> | null;
    const id = typeof m?.id === 'string' ? m.id : (typeof m?.name === 'string' ? m.name : (typeof m?.model === 'string' ? m.model : ''));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const ctx = [m?.max_model_len, m?.context_length, m?.max_context_length]
      .find((v): v is number => typeof v === 'number' && v > 0);
    if (/embed/i.test(id) || m?.type === 'embeddings') continue; // not a chat model
    out.push({
      id: toNamespacedModelId(id),
      displayName: `${id} (${host})`,
      family: OPENAI_COMPATIBLE_PROVIDER_ID,
      parameterSize: '',
      quantization: '',
      contextLength: ctx ?? OPENAI_COMPATIBLE_DEFAULT_CONTEXT,
      capabilities: ['completion', 'tools'] as ModelCapability[],
    });
  }
  return out;
}

// ── Request mapping (exported for tests) ──────────────────────────────────────

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type OpenAIMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | OpenAIContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAIToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/**
 * Convert Parallx's flat chat history into OpenAI messages.
 *
 * System messages are joined into one leading system message (several chat
 * templates in local servers reject a system turn anywhere else). Parallx links
 * a tool result to its call by name; OpenAI links by `tool_call_id`, so each
 * assistant tool call gets a synthesized id and each result takes the pending
 * id of the same name (first in, first out). A result with no call to answer
 * goes back as a user turn, since a stray `tool` message is rejected.
 * Thinking text is not sent back.
 */
export function openAIMessagesFromChat(messages: readonly IChatMessage[]): OpenAIMessage[] {
  const system: string[] = [];
  const out: OpenAIMessage[] = [];
  const pending: { name: string; id: string }[] = [];
  let idCounter = 0;

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (msg.content && msg.content.trim()) system.push(msg.content);
    } else if (msg.role === 'user') {
      const images = msg.images ?? [];
      if (images.length === 0) {
        out.push({ role: 'user', content: msg.content ?? '' });
      } else {
        const parts: OpenAIContentPart[] = [];
        if (msg.content) parts.push({ type: 'text', text: msg.content });
        for (const img of images) parts.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
        out.push({ role: 'user', content: parts });
      }
    } else if (msg.role === 'assistant') {
      const calls: OpenAIToolCall[] = (msg.toolCalls ?? []).map((tc) => {
        const id = `call_${idCounter++}`;
        pending.push({ name: tc.function.name, id });
        return { id, type: 'function', function: { name: tc.function.name, arguments: JSON.stringify(tc.function.arguments ?? {}) } };
      });
      if (calls.length > 0) out.push({ role: 'assistant', content: msg.content ? msg.content : null, tool_calls: calls });
      else out.push({ role: 'assistant', content: msg.content ?? '' });
    } else if (msg.role === 'tool') {
      let id: string | undefined;
      const byName = pending.findIndex((p) => p.name === msg.toolName);
      if (byName >= 0) id = pending.splice(byName, 1)[0].id;
      else if (pending.length > 0) id = pending.shift()!.id;
      if (id) out.push({ role: 'tool', tool_call_id: id, content: msg.content ?? '' });
      else out.push({ role: 'user', content: `Result of ${msg.toolName ?? 'a tool'}:\n${msg.content ?? ''}` });
    }
  }

  if (system.length > 0) out.unshift({ role: 'system', content: system.join('\n\n') });
  return out;
}

/** Build the `POST /chat/completions` body. */
export function buildOpenAIRequestBody(
  modelId: string,
  messages: readonly IChatMessage[],
  options?: IChatRequestOptions,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: toServerModelId(modelId),
    messages: openAIMessagesFromChat(messages),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (options?.temperature !== undefined) body['temperature'] = options.temperature;
  if (options?.topP !== undefined) body['top_p'] = options.topP;
  if (options?.seed !== undefined) body['seed'] = options.seed;
  if (options?.maxTokens && options.maxTokens > 0) body['max_tokens'] = options.maxTokens;
  if (options?.tools && options.tools.length > 0) {
    body['tools'] = options.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
  }
  if (options?.format === 'json') {
    body['response_format'] = { type: 'json_object' };
  } else if (options?.format && typeof options.format === 'object') {
    body['response_format'] = { type: 'json_schema', json_schema: { name: 'response', schema: options.format } };
  }
  return body;
}

// ── SSE decoder (exported for tests) ──────────────────────────────────────────

export interface IOpenAIStreamDecoder {
  /** Feed raw SSE text (any split); returns the chunks it completes. */
  push(text: string): IChatResponseChunk[];
  /** The final chunk: assembled tool calls not yet sent, usage, doneReason. */
  end(): IChatResponseChunk[];
  /** Set when the stream carried an error object. */
  readonly error: string | undefined;
}

function parseArguments(json: string): Record<string, unknown> {
  if (!json.trim()) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
  } catch { return {}; }
}

/**
 * Decode an OpenAI chat-completions SSE stream into Parallx chunks: content and
 * reasoning deltas, tool calls assembled across chunks by index (the name comes
 * once, the arguments in pieces), `finish_reason` and `usage`.
 */
export function createOpenAIStreamDecoder(): IOpenAIStreamDecoder {
  let buffer = '';
  const tools = new Map<number, { name: string; args: string }>();
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let finishReason: string | undefined;
  let errorMessage: string | undefined;

  const flushTools = (): IChatResponseChunk[] => {
    if (tools.size === 0) return [];
    const calls: IToolCall[] = [...tools.entries()]
      .sort((a, b) => a[0] - b[0])
      .filter(([, t]) => t.name)
      .map(([, t]) => ({ function: { name: t.name, arguments: parseArguments(t.args) } }));
    tools.clear();
    return calls.length > 0 ? [{ content: '', toolCalls: calls, done: false }] : [];
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (evt: any): IChatResponseChunk[] => {
    if (evt?.error) {
      errorMessage = typeof evt.error === 'string' ? evt.error : (evt.error.message ?? 'The server reported an error');
      return [];
    }
    if (evt?.usage) {
      if (typeof evt.usage.prompt_tokens === 'number') promptTokens = evt.usage.prompt_tokens;
      if (typeof evt.usage.completion_tokens === 'number') completionTokens = evt.usage.completion_tokens;
    }
    const out: IChatResponseChunk[] = [];
    for (const choice of Array.isArray(evt?.choices) ? evt.choices : []) {
      const d = choice?.delta ?? choice?.message ?? {};
      const thinking = typeof d.reasoning_content === 'string' ? d.reasoning_content : (typeof d.reasoning === 'string' ? d.reasoning : '');
      const content = typeof d.content === 'string' ? d.content : '';
      if (content || thinking) out.push(thinking ? { content, thinking, done: false } : { content, done: false });
      const calls = Array.isArray(d.tool_calls) ? d.tool_calls : [];
      calls.forEach((tc: { index?: number; function?: { name?: string; arguments?: unknown } }, pos: number) => {
        const index = typeof tc.index === 'number' ? tc.index : pos;
        const slot = tools.get(index) ?? { name: '', args: '' };
        if (tc.function?.name && !slot.name) slot.name = tc.function.name;
        const a = tc.function?.arguments;
        if (typeof a === 'string') slot.args += a;
        else if (a && typeof a === 'object') slot.args = JSON.stringify(a);
        tools.set(index, slot);
      });
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason;
        out.push(...flushTools());
      }
    }
    return out;
  };

  const push = (text: string): IChatResponseChunk[] => {
    buffer += text;
    const chunks: IChatResponseChunk[] = [];
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let evt: any;
      try { evt = JSON.parse(payload); } catch { continue; }
      chunks.push(...handle(evt));
    }
    return chunks;
  };

  return {
    push,
    end(): IChatResponseChunk[] {
      const rest = buffer.trim() ? push('\n') : [];
      return [
        ...rest,
        ...flushTools(),
        {
          content: '', done: true,
          promptEvalCount: promptTokens, evalCount: completionTokens,
          doneReason: finishReason === 'length' ? 'length' : 'stop',
        },
      ];
    },
    get error(): string | undefined { return errorMessage; },
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class OpenAICompatibleProvider extends Disposable implements ILanguageModelProvider {
  /** A server that was down when listed is asked again, less and less often, until it answers. */
  static readonly RETRY_FIRST_MS = 15_000;
  static readonly RETRY_MAX_MS = 120_000;

  readonly id = OPENAI_COMPATIBLE_PROVIDER_ID;
  readonly displayName = 'OpenAI-Compatible Server';
  /** A server on this machine shares its one engine, so it goes through the broker queue. */
  readonly local: boolean;

  private readonly _baseUrl: string;
  private readonly _pending = new Map<string, (e: IOpenAICompatibleStreamEvent) => void>();
  private _models: ILanguageModelInfo[] = [];
  private _retryTimer: ReturnType<typeof setTimeout> | undefined;
  private _retryDelay = OpenAICompatibleProvider.RETRY_FIRST_MS;

  private readonly _onDidChangeStatus = this._register(new Emitter<IProviderStatus>());
  /** Fires once a server that was down answers, so the model list refreshes. */
  readonly onDidChangeStatus: Event<IProviderStatus> = this._onDidChangeStatus.event;

  constructor(private readonly _bridge: IOpenAICompatibleBridge, baseUrl: string) {
    super();
    this._baseUrl = normalizeBaseUrl(baseUrl);
    this.local = isLoopbackUrl(this._baseUrl);
    const unsub = this._bridge.onStreamEvent((e) => this._pending.get(e.requestId)?.(e));
    this._register(toDisposable(unsub));
    this._register(toDisposable(() => { if (this._retryTimer) clearTimeout(this._retryTimer); this._retryTimer = undefined; }));
  }

  get baseUrl(): string { return this._baseUrl; }

  async listModels(): Promise<readonly ILanguageModelInfo[]> {
    const r = await this._bridge.listModels(this._baseUrl);
    if (!r.ok) {
      this._scheduleRetry();
      throw new Error(r.error ?? `No server at ${this._baseUrl}`);
    }
    this._models = modelsFromListResponse(r.data ?? [], this._baseUrl);
    return this._models;
  }

  private _scheduleRetry(): void {
    if (this._retryTimer || this.isDisposed) return;
    this._retryTimer = setTimeout(() => {
      this._retryTimer = undefined;
      void this._bridge.listModels(this._baseUrl).then((r) => {
        if (this.isDisposed) return;
        if (r.ok) { this._retryDelay = OpenAICompatibleProvider.RETRY_FIRST_MS; this._onDidChangeStatus.fire({ available: true }); }
        else { this._retryDelay = Math.min(this._retryDelay * 2, OpenAICompatibleProvider.RETRY_MAX_MS); this._scheduleRetry(); }
      }, () => { /* bridge gone: the provider is being torn down */ });
    }, this._retryDelay);
  }

  async getModelInfo(modelId: string): Promise<ILanguageModelInfo> {
    const known = this._models.find((m) => m.id === modelId);
    if (known) return known;
    const serverId = toServerModelId(modelId);
    return {
      id: modelId, displayName: serverId, family: OPENAI_COMPATIBLE_PROVIDER_ID,
      parameterSize: '', quantization: '', contextLength: OPENAI_COMPATIBLE_DEFAULT_CONTEXT,
      capabilities: ['completion', 'tools'] as ModelCapability[],
    };
  }

  async checkAvailability(): Promise<IProviderStatus> {
    const r = await this._bridge.listModels(this._baseUrl).catch((err: unknown) => ({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    return r.ok ? { available: true } : { available: false, error: r.error ?? `No server at ${this._baseUrl}` };
  }

  async *sendChatRequest(
    modelId: string,
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    if (signal?.aborted) return;
    const body = buildOpenAIRequestBody(modelId, messages, options);
    const requestId = `openai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const decoder = createOpenAIStreamDecoder();
    const queue: IOpenAICompatibleStreamEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;

    this._pending.set(requestId, (e) => {
      queue.push(e);
      if (notify) { const n = notify; notify = null; n(); }
    });
    const onAbort = (): void => { void this._bridge.abortStream(requestId); };
    signal?.addEventListener('abort', onAbort, { once: true });

    try {
      const started = await this._bridge.startStream(requestId, this._baseUrl, body);
      if (!started.ok) throw new Error(started.error ?? `No server at ${this._baseUrl}`);

      while (!finished) {
        if (queue.length === 0) await new Promise<void>((resolve) => { notify = resolve; });
        while (queue.length > 0 && !finished) {
          const e = queue.shift()!;
          if (e.type === 'data') {
            for (const chunk of decoder.push(e.data ?? '')) yield chunk;
            if (decoder.error) throw new Error(decoder.error);
          } else if (e.type === 'end') {
            const last = decoder.end();
            if (decoder.error) throw new Error(decoder.error);
            for (const chunk of last) yield chunk;
            finished = true;
          } else if (e.type === 'aborted') {
            finished = true;
          } else {
            throw new Error(e.error ?? `The server at ${this._baseUrl} stopped with an error`);
          }
        }
      }
    } finally {
      this._pending.delete(requestId);
      signal?.removeEventListener('abort', onAbort);
      if (!finished) void this._bridge.abortStream(requestId);
    }
  }
}
