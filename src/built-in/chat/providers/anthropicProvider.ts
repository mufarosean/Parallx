// anthropicProvider.ts — ILanguageModelProvider for Claude (Anthropic Messages API).
//
// This is the cloud/frontier counterpart to ollamaProvider.ts. It implements the
// SAME ILanguageModelProvider interface, so the model picker, the agent loop,
// tool-passing, and streaming all work unchanged — Claude's native tool use runs
// through the existing path (that's the point: let the frontier model do the work,
// no bespoke scaffolding).
//
// Security boundary: the API key NEVER enters the renderer. All HTTP to
// api.anthropic.com happens in the main process (electron/anthropicBridge.cjs),
// which reads the key from safeStorage and streams the raw SSE bytes back over
// IPC. This module only builds the request body and decodes the SSE stream — the
// key-bearing side lives in main, mirroring the Google/Gmail bridges.
//
// Extended thinking (Opus 4.8 / Sonnet 5): Anthropic requires the *signed*
// thinking blocks to be replayed verbatim on tool-use turns, but Parallx's flat
// history only carries thinking text (no signature). We solve this end-to-end:
// the stream decoder captures each signed thinking block; sendChatRequest caches
// them keyed by a content fingerprint of the assistant turn; and on the next
// request we re-inject them into the matching assistant message. A signature-
// error fallback (retry once without thinking) guarantees the loop never breaks
// even if a turn can't be reconstructed (e.g. resumed across a restart).
//
// The pure mapping/decoding functions are exported for unit tests (no live API,
// no IPC).

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
  ModelCapability,
} from '../../../services/chatTypes.js';

// ── Main-process bridge (window.parallxElectron.anthropic) ────────────────────

/** A single relayed stream event from the main-process proxy. */
export interface IAnthropicStreamEvent {
  readonly requestId: string;
  /** 'data' = raw SSE text; 'end' = stream done; 'error' = failure; 'aborted' = user cancel. */
  readonly type: 'data' | 'end' | 'error' | 'aborted';
  readonly data?: string;
  readonly error?: string;
}

/** Renderer-side facade over electron/anthropicBridge.cjs. The key stays in main. */
export interface IAnthropicBridge {
  /** Whether an API key is stored in main-process safeStorage. */
  hasKey(): Promise<boolean>;
  /** Store the API key (main-process safeStorage; never returned to the renderer). */
  setKey(key: string): Promise<{ ok: boolean; error?: string }>;
  /** Delete the stored API key. */
  clearKey(): Promise<unknown>;
  /** Begin a streaming /v1/messages request; chunks arrive via onStreamEvent. */
  startStream(requestId: string, body: unknown): Promise<{ ok: boolean; error?: string }>;
  /** Abort an in-flight request by id. */
  abortStream(requestId: string): Promise<unknown>;
  /** Subscribe to relayed stream events (all requests). Returns an unsubscribe fn. */
  onStreamEvent(cb: (event: IAnthropicStreamEvent) => void): () => void;
}

/** Resolve the bridge from the preload, or undefined (tests / non-electron). */
export function getAnthropicBridge(): IAnthropicBridge | undefined {
  return (globalThis as { parallxElectron?: { anthropic?: IAnthropicBridge } })
    .parallxElectron?.anthropic;
}

// ── Model catalog ─────────────────────────────────────────────────────────────
//
// Static, factual model metadata (like Ollama's /api/show capabilities) — not a
// behavior override. `supportsThinking` is metadata the provider consults; it is
// NOT a hardcoded skip-list that flips the user's settings.

interface IAnthropicModelMeta extends ILanguageModelInfo {
  readonly supportsThinking: boolean;
}

/** Default output token cap when the caller doesn't set one (Anthropic requires max_tokens). */
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16384;

export const ANTHROPIC_MODELS: readonly IAnthropicModelMeta[] = [
  {
    id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', family: 'claude',
    parameterSize: '', quantization: '', contextLength: 1_000_000,
    capabilities: ['completion', 'tools', 'vision', 'thinking'] as ModelCapability[],
    supportsThinking: true,
  },
  {
    id: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', family: 'claude',
    parameterSize: '', quantization: '', contextLength: 1_000_000,
    capabilities: ['completion', 'tools', 'vision', 'thinking'] as ModelCapability[],
    supportsThinking: true,
  },
  {
    id: 'claude-haiku-4-5', displayName: 'Claude Haiku 4.5', family: 'claude',
    parameterSize: '', quantization: '', contextLength: 200_000,
    capabilities: ['completion', 'tools', 'vision'] as ModelCapability[],
    supportsThinking: false,
  },
];

const NO_KEY_TIP = 'No Anthropic API key set. Add it in AI Settings → Model.';

// ── Content-block shapes (exported for tests) ─────────────────────────────────

/** M85 Slice E — prompt-cache breakpoint marker (all block types except thinking). */
interface AnthropicCacheControl { cache_control?: { type: 'ephemeral' } }
interface AnthropicTextBlock extends AnthropicCacheControl { type: 'text'; text: string }
interface AnthropicImageBlock extends AnthropicCacheControl { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
interface AnthropicToolUseBlock extends AnthropicCacheControl { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
interface AnthropicToolResultBlock extends AnthropicCacheControl { type: 'tool_result'; tool_use_id: string; content: string }
/** A signed extended-thinking block — must be replayed verbatim (text may be empty). */
export interface AnthropicThinkingBlock { type: 'thinking'; thinking: string; signature: string }
type AnthropicContentBlock =
  | AnthropicTextBlock | AnthropicImageBlock | AnthropicToolUseBlock
  | AnthropicToolResultBlock | AnthropicThinkingBlock;
interface AnthropicMessage { role: 'user' | 'assistant'; content: AnthropicContentBlock[] }

// ── Pure request mapping (exported for tests) ─────────────────────────────────

/**
 * Convert Parallx's flat (Ollama-shaped) message list into Anthropic's shape:
 * system messages are hoisted into a single top-level `system` string, and the
 * remaining turns become `messages` with typed content blocks.
 *
 * Tool linkage: Parallx matches tool results to calls by NAME (Ollama style),
 * but Anthropic matches by `tool_use_id`. We synthesize deterministic ids for
 * each assistant `tool_use` and resolve each subsequent `tool` (result) message
 * to the matching pending id (by name, FIFO). Consecutive same-role turns are
 * merged so tool_result blocks group into one user message — what Anthropic
 * expects after a tool-calling assistant turn.
 *
 * The flat `thinking` text on assistant turns is intentionally NOT emitted here
 * (it's unsigned → would 400). Signed thinking blocks are re-injected separately
 * from the provider's cache — see `injectThinkingBlocks`.
 */
export function anthropicMessagesFromChat(
  messages: readonly IChatMessage[],
): { system: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];
  const pending: { name: string; id: string }[] = [];
  let idCounter = 0;

  const push = (role: 'user' | 'assistant', content: AnthropicContentBlock[]): void => {
    if (content.length === 0) return;
    const last = out[out.length - 1];
    if (last && last.role === role) { last.content.push(...content); }
    else { out.push({ role, content }); }
  };

  for (const msg of messages) {
    if (msg.role === 'system') {
      if (msg.content && msg.content.trim()) systemParts.push(msg.content);
      continue;
    }

    if (msg.role === 'user') {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content) blocks.push({ type: 'text', text: msg.content });
      for (const img of msg.images ?? []) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
      }
      push('user', blocks);
      continue;
    }

    if (msg.role === 'assistant') {
      const blocks: AnthropicContentBlock[] = [];
      if (msg.content && msg.content.trim()) blocks.push({ type: 'text', text: msg.content });
      for (const tc of msg.toolCalls ?? []) {
        const id = `toolu_${idCounter++}`;
        blocks.push({ type: 'tool_use', id, name: tc.function.name, input: tc.function.arguments ?? {} });
        pending.push({ name: tc.function.name, id });
      }
      push('assistant', blocks);
      continue;
    }

    if (msg.role === 'tool') {
      let id: string | undefined;
      const byName = pending.findIndex((p) => p.name === msg.toolName);
      if (byName >= 0) { id = pending.splice(byName, 1)[0].id; }
      else if (pending.length > 0) { id = pending.shift()!.id; }
      if (!id) { id = `toolu_orphan_${idCounter++}`; }
      push('user', [{ type: 'tool_result', tool_use_id: id, content: msg.content ?? '' }]);
      continue;
    }
  }

  return { system: systemParts.join('\n\n'), messages: out };
}

/**
 * Stable content fingerprint of an assistant turn (visible text + tool
 * name/args), used to key the signed-thinking cache. Deliberately id-independent
 * (ids are re-synthesized each replay) so a cached turn matches on re-send.
 */
export function fingerprintAssistantTurn(
  text: string,
  tools: readonly { name: string; input: unknown }[],
): string {
  return JSON.stringify({ t: text, c: tools.map((x) => ({ n: x.name, a: x.input })) });
}

/**
 * Re-attach signed thinking blocks (from the provider cache) to assistant
 * messages that made tool calls, so extended thinking survives the tool-use
 * turns Anthropic requires it on. Thinking blocks must lead the content array.
 */
export function injectThinkingBlocks(
  messages: AnthropicMessage[],
  cache: ReadonlyMap<string, AnthropicThinkingBlock[]>,
): void {
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    if (m.content.some((b) => b.type === 'thinking')) continue;
    const tools = m.content.filter((b): b is AnthropicToolUseBlock => b.type === 'tool_use');
    if (tools.length === 0) continue;
    const text = m.content.filter((b): b is AnthropicTextBlock => b.type === 'text').map((b) => b.text).join('');
    const key = fingerprintAssistantTurn(text, tools.map((t) => ({ name: t.name, input: t.input })));
    const blocks = cache.get(key);
    if (blocks && blocks.length > 0) m.content = [...blocks, ...m.content];
  }
}

/** Remove all thinking blocks (used by the no-thinking fallback retry). */
function stripThinkingBlocks(messages: AnthropicMessage[]): void {
  for (const m of messages) {
    if (m.content.some((b) => b.type === 'thinking')) {
      m.content = m.content.filter((b) => b.type !== 'thinking');
    }
  }
}

/**
 * Build the Anthropic `/v1/messages` request body from Parallx chat inputs.
 *
 * `enableThinking` turns on adaptive extended thinking with a readable summary.
 * Sampling params (`temperature`, `topP`, `seed`) are deliberately NOT forwarded:
 * frontier Claude rejects them with a 400 — Anthropic steers via prompting.
 */
export function buildAnthropicRequestBody(
  modelId: string,
  messages: readonly IChatMessage[],
  options: IChatRequestOptions | undefined,
  opts: { defaultMaxTokens: number; enableThinking?: boolean },
): { body: Record<string, unknown>; messages: AnthropicMessage[] } {
  const { system, messages: anthMessages } = anthropicMessagesFromChat(messages);
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: options?.maxTokens && options.maxTokens > 0 ? options.maxTokens : opts.defaultMaxTokens,
    stream: true,
    messages: anthMessages,
  };
  // M85 Slice E — prompt caching. Anthropic's cache prefix order is
  // tools → system → messages, so ONE breakpoint on the system block caches
  // the whole stable per-session prefix (tool schemas + system prompt) across
  // every round of an agent turn — previously re-billed in full each round.
  if (system) {
    body['system'] = [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } } satisfies AnthropicTextBlock];
  }
  if (options?.tools && options.tools.length > 0) {
    body['tools'] = options.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }
  // Second breakpoint on the LAST message block: it moves forward each round,
  // so the growing conversation re-reads earlier rounds from cache instead of
  // re-billing them (incremental agent-loop caching). Thinking blocks can't
  // carry cache_control — in practice the last message is always a user turn
  // (prompt or tool results), but guard anyway.
  const lastMsg = anthMessages[anthMessages.length - 1];
  const lastBlock = lastMsg?.content[lastMsg.content.length - 1];
  if (lastBlock && lastBlock.type !== 'thinking') {
    lastBlock.cache_control = { type: 'ephemeral' };
  }
  if (opts.enableThinking) {
    body['thinking'] = { type: 'adaptive', display: 'summarized' };
  }
  return { body, messages: anthMessages };
}

// ── Pure SSE decoder (exported for tests) ─────────────────────────────────────

interface IAnthropicStreamDecoder {
  /** Feed raw SSE text; returns any decoded chunks. */
  push(text: string): IChatResponseChunk[];
  /** Emit the terminal chunk (carries token usage). */
  end(): IChatResponseChunk[];
  /** Signed thinking blocks assembled from the stream (for tool-turn replay). */
  getThinkingBlocks(): AnthropicThinkingBlock[];
  /** Set when an `error` SSE event was seen. */
  readonly error: string | undefined;
}

/**
 * Incrementally decode Anthropic's Messages streaming SSE into Parallx chunks.
 * Handles text/thinking deltas, accumulates streamed `tool_use` input JSON
 * (emitted as one toolCall on content_block_stop), and assembles signed thinking
 * blocks (text + signature) for later replay.
 */
export function createAnthropicStreamDecoder(): IAnthropicStreamDecoder {
  let buffer = '';
  const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
  const thinkingBlocks = new Map<number, { thinking: string; signature: string }>();
  let promptTokens: number | undefined;
  let outputTokens: number | undefined;
  let errorMessage: string | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = (evt: any): IChatResponseChunk[] => {
    switch (evt?.type) {
      case 'message_start':
        // The TRUE prompt size: input_tokens counts only uncached input;
        // cache creation/read tokens are the rest of the same prompt.
        if (typeof evt.message?.usage?.input_tokens === 'number') {
          const u = evt.message.usage as { input_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
          promptTokens = u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
        }
        return [];
      case 'content_block_start': {
        const cb = evt.content_block;
        if (typeof evt.index !== 'number') return [];
        if (cb?.type === 'tool_use') toolBlocks.set(evt.index, { id: cb.id ?? '', name: cb.name ?? '', json: '' });
        else if (cb?.type === 'thinking') thinkingBlocks.set(evt.index, { thinking: cb.thinking ?? '', signature: cb.signature ?? '' });
        return [];
      }
      case 'content_block_delta': {
        const d = evt.delta;
        if (d?.type === 'text_delta') return [{ content: d.text ?? '', done: false }];
        if (d?.type === 'thinking_delta') {
          if (typeof evt.index === 'number') { const t = thinkingBlocks.get(evt.index); if (t) t.thinking += d.thinking ?? ''; }
          return [{ content: '', thinking: d.thinking ?? '', done: false }];
        }
        if (d?.type === 'signature_delta' && typeof evt.index === 'number') {
          const t = thinkingBlocks.get(evt.index); if (t) t.signature += d.signature ?? '';
          return [];
        }
        if (d?.type === 'input_json_delta' && typeof evt.index === 'number') {
          const b = toolBlocks.get(evt.index); if (b) b.json += d.partial_json ?? '';
          return [];
        }
        return [];
      }
      case 'content_block_stop': {
        if (typeof evt.index !== 'number') return [];
        const b = toolBlocks.get(evt.index);
        if (!b) return [];
        toolBlocks.delete(evt.index);
        let args: Record<string, unknown> = {};
        try { args = b.json ? JSON.parse(b.json) as Record<string, unknown> : {}; }
        catch { args = {}; }
        return [{ content: '', toolCalls: [{ function: { name: b.name, arguments: args } }], done: false }];
      }
      case 'message_delta':
        if (typeof evt.usage?.output_tokens === 'number') outputTokens = evt.usage.output_tokens;
        return [];
      case 'error':
        errorMessage = evt.error?.message ?? 'Anthropic stream error';
        return [];
      default:
        return [];
    }
  };

  return {
    push(text: string): IChatResponseChunk[] {
      buffer += text;
      const chunks: IChatResponseChunk[] = [];
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line || line.startsWith('event:') || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let evt: any;
        try { evt = JSON.parse(payload); } catch { continue; }
        chunks.push(...handle(evt));
      }
      return chunks;
    },
    end(): IChatResponseChunk[] {
      return [{ content: '', done: true, promptEvalCount: promptTokens, evalCount: outputTokens }];
    },
    getThinkingBlocks(): AnthropicThinkingBlock[] {
      return [...thinkingBlocks.values()]
        .filter((t) => t.signature)
        .map((t) => ({ type: 'thinking', thinking: t.thinking, signature: t.signature }));
    },
    get error(): string | undefined { return errorMessage; },
  };
}

// ── Provider ──────────────────────────────────────────────────────────────────

const THINKING_CACHE_MAX = 64;

export class AnthropicProvider extends Disposable implements ILanguageModelProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Claude (Anthropic)';

  private readonly _pending = new Map<string, (e: IAnthropicStreamEvent) => void>();
  /** fingerprint → signed thinking blocks, so extended thinking survives tool turns. */
  private readonly _thinkingCache = new Map<string, AnthropicThinkingBlock[]>();

  private readonly _onDidChangeStatus = this._register(new Emitter<IProviderStatus>());
  readonly onDidChangeStatus: Event<IProviderStatus> = this._onDidChangeStatus.event;

  constructor(private readonly _bridge: IAnthropicBridge) {
    super();
    const unsub = this._bridge.onStreamEvent((e) => {
      const handler = this._pending.get(e.requestId);
      if (handler) handler(e);
    });
    this._register(toDisposable(unsub));
  }

  async listModels(): Promise<readonly ILanguageModelInfo[]> {
    return ANTHROPIC_MODELS.map((m) => this._toInfo(m));
  }

  async getModelInfo(modelId: string): Promise<ILanguageModelInfo> {
    const m = ANTHROPIC_MODELS.find((x) => x.id === modelId);
    if (m) return this._toInfo(m);
    return {
      id: modelId, displayName: modelId, family: 'claude',
      parameterSize: '', quantization: '', contextLength: 200_000,
      capabilities: ['completion', 'tools'] as ModelCapability[],
    };
  }

  async checkAvailability(): Promise<IProviderStatus> {
    const hasKey = await this._bridge.hasKey().catch(() => false);
    return hasKey ? { available: true } : { available: false, error: NO_KEY_TIP };
  }

  async *sendChatRequest(
    modelId: string,
    messages: readonly IChatMessage[],
    options?: IChatRequestOptions,
    signal?: AbortSignal,
  ): AsyncIterable<IChatResponseChunk> {
    const supportsThinking = ANTHROPIC_MODELS.find((m) => m.id === modelId)?.supportsThinking ?? false;
    const enableThinking = !!options?.think && supportsThinking;

    const { body, messages: anthMessages } = buildAnthropicRequestBody(modelId, messages, options, {
      defaultMaxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
      enableThinking,
    });
    if (enableThinking) injectThinkingBlocks(anthMessages, this._thinkingCache);

    // First attempt (with thinking, if enabled). Anthropic validates the thinking
    // signature BEFORE streaming, so a signature error fails with zero chunks
    // yielded — making a one-shot no-thinking retry safe (no duplicate output).
    let yielded = 0;
    try {
      for await (const chunk of this._run(body, signal)) { yielded++; yield chunk; }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (enableThinking && yielded === 0 && /thinking/i.test(msg)) {
        delete (body as Record<string, unknown>).thinking;
        stripThinkingBlocks(anthMessages);
        for await (const chunk of this._run(body, signal)) yield chunk;
      } else {
        throw err;
      }
    }
  }

  /** One streaming round-trip over IPC; throws on error, caches signed thinking on success. */
  private async *_run(
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ): AsyncGenerator<IChatResponseChunk> {
    const requestId = `anthropic_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const decoder = createAnthropicStreamDecoder();
    const queue: IAnthropicStreamEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;
    let fullText = '';
    const toolCalls: { name: string; input: unknown }[] = [];

    this._pending.set(requestId, (e) => {
      queue.push(e);
      if (notify) { const n = notify; notify = null; n(); }
    });

    const onAbort = (): void => { void this._bridge.abortStream(requestId); };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const started = await this._bridge.startStream(requestId, body);
      if (!started.ok) {
        throw new Error(started.error === 'no-api-key' ? NO_KEY_TIP : (started.error ?? 'Failed to start Anthropic request'));
      }

      while (!finished) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => { notify = resolve; });
        }
        while (queue.length > 0) {
          const e = queue.shift()!;
          if (e.type === 'data') {
            for (const chunk of decoder.push(e.data ?? '')) {
              if (chunk.content) fullText += chunk.content;
              if (chunk.toolCalls) for (const tc of chunk.toolCalls) toolCalls.push({ name: tc.function.name, input: tc.function.arguments });
              yield chunk;
            }
            if (decoder.error) throw new Error(decoder.error);
          } else if (e.type === 'end') {
            if (decoder.error) throw new Error(decoder.error);
            // Cache this turn's signed thinking so it can be replayed if the
            // agent loop sends tool results back (Anthropic requires it).
            const blocks = decoder.getThinkingBlocks();
            if (blocks.length > 0 && toolCalls.length > 0) {
              this._cacheThinking(fingerprintAssistantTurn(fullText, toolCalls), blocks);
            }
            for (const chunk of decoder.end()) yield chunk;
            finished = true;
          } else if (e.type === 'aborted') {
            finished = true;
          } else if (e.type === 'error') {
            throw new Error(e.error === 'no-api-key' ? NO_KEY_TIP : (e.error ?? 'Anthropic stream error'));
          }
        }
      }
    } finally {
      this._pending.delete(requestId);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  private _cacheThinking(key: string, blocks: AnthropicThinkingBlock[]): void {
    if (this._thinkingCache.has(key)) this._thinkingCache.delete(key);
    this._thinkingCache.set(key, blocks);
    while (this._thinkingCache.size > THINKING_CACHE_MAX) {
      const oldest = this._thinkingCache.keys().next().value;
      if (oldest === undefined) break;
      this._thinkingCache.delete(oldest);
    }
  }

  private _toInfo(m: IAnthropicModelMeta): ILanguageModelInfo {
    return {
      id: m.id, displayName: m.displayName, family: m.family,
      parameterSize: m.parameterSize, quantization: m.quantization,
      contextLength: m.contextLength, capabilities: m.capabilities,
    };
  }
}
