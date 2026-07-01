/**
 * Anthropic (Claude) provider — the pure request/response mapping between
 * Parallx's flat chat shape and the Anthropic Messages API. Covers system
 * hoisting, image blocks, tool_use↔tool_result id linkage, the request body,
 * and the streaming SSE decoder (text/thinking deltas, streamed tool input,
 * usage, chunk-boundary splitting, error events).
 */

import { describe, it, expect } from 'vitest';
import {
  anthropicMessagesFromChat,
  buildAnthropicRequestBody,
  createAnthropicStreamDecoder,
  fingerprintAssistantTurn,
  injectThinkingBlocks,
  ANTHROPIC_DEFAULT_MAX_TOKENS,
  type AnthropicThinkingBlock,
} from '../../src/built-in/chat/providers/anthropicProvider';
import type { IChatMessage } from '../../src/services/chatTypes';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const msgs = (arr: any[]): readonly IChatMessage[] => arr as readonly IChatMessage[];

describe('anthropicMessagesFromChat', () => {
  it('hoists system messages into a single system string, out of messages', () => {
    const { system, messages } = anthropicMessagesFromChat(msgs([
      { role: 'system', content: 'You are helpful.' },
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi' },
    ]));
    expect(system).toBe('You are helpful.\n\nBe concise.');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'Hi' }] });
  });

  it('maps a user turn with an image to text + image blocks', () => {
    const { messages } = anthropicMessagesFromChat(msgs([
      { role: 'user', content: 'what is this', images: [{ mimeType: 'image/png', data: 'BASE64' }] },
    ]));
    expect(messages[0].content).toEqual([
      { type: 'text', text: 'what is this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'BASE64' } },
    ]);
  });

  it('synthesizes tool_use ids and links tool results by name', () => {
    const { messages } = anthropicMessagesFromChat(msgs([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: 'Checking.', toolCalls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }] },
      { role: 'tool', toolName: 'get_weather', content: '72F' },
      { role: 'assistant', content: 'It is 72F.' },
    ]));
    // assistant turn: text + tool_use with a synthesized id
    const toolUse = (messages[1].content as { type: string; id?: string; name?: string }[]).find((b) => b.type === 'tool_use');
    expect(toolUse).toMatchObject({ type: 'tool_use', name: 'get_weather' });
    const id = (toolUse as { id: string }).id;
    expect(id).toBeTruthy();
    // tool result is a user message referencing the SAME id
    expect(messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: '72F' }] });
    expect(messages[3]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'It is 72F.' }] });
  });

  it('groups two tool results (one turn) into a single user message, matched by name', () => {
    const { messages } = anthropicMessagesFromChat(msgs([
      { role: 'user', content: 'do both' },
      { role: 'assistant', toolCalls: [
        { function: { name: 'a', arguments: {} } },
        { function: { name: 'b', arguments: {} } },
      ] },
      { role: 'tool', toolName: 'b', content: 'result-b' },
      { role: 'tool', toolName: 'a', content: 'result-a' },
    ]));
    // assistant message has two tool_use blocks
    const uses = (messages[1].content as { type: string; id: string; name: string }[]).filter((b) => b.type === 'tool_use');
    expect(uses.map((u) => u.name)).toEqual(['a', 'b']);
    const idA = uses.find((u) => u.name === 'a')!.id;
    const idB = uses.find((u) => u.name === 'b')!.id;
    // one user message with both tool_result blocks, each matched to the right id
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: idB, content: 'result-b' },
      { type: 'tool_result', tool_use_id: idA, content: 'result-a' },
    ]);
  });
});

describe('buildAnthropicRequestBody', () => {
  it('sets model, streaming, default max_tokens, system, and tools; omits sampling params + thinking', () => {
    const { body } = buildAnthropicRequestBody(
      'claude-opus-4-8',
      msgs([{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }]),
      { temperature: 0.7, topP: 0.9, seed: 1, tools: [{ name: 'search', description: 'find', parameters: { type: 'object' } }] },
      { defaultMaxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS },
    );
    expect(body.model).toBe('claude-opus-4-8');
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(ANTHROPIC_DEFAULT_MAX_TOKENS);
    expect(body.system).toBe('sys');
    expect(body.tools).toEqual([{ name: 'search', description: 'find', input_schema: { type: 'object' } }]);
    // frontier Claude rejects these — must not be forwarded
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('top_p');
    expect(body).not.toHaveProperty('seed');
    expect(body).not.toHaveProperty('thinking');
  });

  it('honours an explicit maxTokens and omits system when there are no system turns', () => {
    const { body } = buildAnthropicRequestBody(
      'claude-sonnet-5',
      msgs([{ role: 'user', content: 'hi' }]),
      { maxTokens: 4096 },
      { defaultMaxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS },
    );
    expect(body.max_tokens).toBe(4096);
    expect(body).not.toHaveProperty('system');
  });

  it('enables adaptive extended thinking (with summary) when requested', () => {
    const { body } = buildAnthropicRequestBody(
      'claude-opus-4-8',
      msgs([{ role: 'user', content: 'hi' }]),
      {},
      { defaultMaxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS, enableThinking: true },
    );
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  });
});

describe('extended thinking replay (signed blocks survive tool turns)', () => {
  it('fingerprint is id-independent and stable across identical turns', () => {
    const a = fingerprintAssistantTurn('Checking.', [{ name: 'get_weather', input: { city: 'Paris' } }]);
    const b = fingerprintAssistantTurn('Checking.', [{ name: 'get_weather', input: { city: 'Paris' } }]);
    const c = fingerprintAssistantTurn('Checking.', [{ name: 'get_weather', input: { city: 'London' } }]);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('re-injects cached signed thinking blocks into the matching tool-use assistant turn', () => {
    const { messages } = anthropicMessagesFromChat(msgs([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: 'Checking.', toolCalls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }] },
      { role: 'tool', toolName: 'get_weather', content: '72F' },
    ]));

    const signed: AnthropicThinkingBlock[] = [{ type: 'thinking', thinking: 'Consider the forecast', signature: 'SIG123' }];
    const key = fingerprintAssistantTurn('Checking.', [{ name: 'get_weather', input: { city: 'Paris' } }]);
    injectThinkingBlocks(messages, new Map([[key, signed]]));

    const assistant = messages.find((m) => m.role === 'assistant')!;
    // thinking block must lead the content, followed by text + tool_use
    expect(assistant.content[0]).toEqual({ type: 'thinking', thinking: 'Consider the forecast', signature: 'SIG123' });
    expect(assistant.content.some((b) => (b as { type: string }).type === 'tool_use')).toBe(true);
  });

  it('injects nothing when the cache has no matching turn', () => {
    const { messages } = anthropicMessagesFromChat(msgs([
      { role: 'user', content: 'weather?' },
      { role: 'assistant', content: 'Checking.', toolCalls: [{ function: { name: 'get_weather', arguments: { city: 'Paris' } } }] },
      { role: 'tool', toolName: 'get_weather', content: '72F' },
    ]));
    injectThinkingBlocks(messages, new Map());
    const assistant = messages.find((m) => m.role === 'assistant')!;
    expect(assistant.content.some((b) => (b as { type: string }).type === 'thinking')).toBe(false);
  });
});

describe('createAnthropicStreamDecoder', () => {
  const SSE = [
    'event: message_start',
    'data: {"type":"message_start","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":1}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_x","name":"get_weather","input":{}}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"Paris\\"}"}}',
    '',
    'event: content_block_stop',
    'data: {"type":"content_block_stop","index":1}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":25}}',
    '',
  ].join('\n') + '\n';

  it('decodes text deltas and an accumulated tool_use call', () => {
    const dec = createAnthropicStreamDecoder();
    const chunks = dec.push(SSE);
    expect(chunks.some((c) => c.content === 'Hello')).toBe(true);
    const tool = chunks.find((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(tool?.toolCalls?.[0]).toEqual({ function: { name: 'get_weather', arguments: { city: 'Paris' } } });
    expect(dec.error).toBeUndefined();

    const end = dec.end();
    expect(end[0]).toMatchObject({ done: true, promptEvalCount: 10, evalCount: 25 });
  });

  it('produces the same result when fed across arbitrary chunk boundaries', () => {
    const dec = createAnthropicStreamDecoder();
    const mid = Math.floor(SSE.length / 2);
    const out = [...dec.push(SSE.slice(0, mid)), ...dec.push(SSE.slice(mid))];
    expect(out.some((c) => c.content === 'Hello')).toBe(true);
    const tool = out.find((c) => c.toolCalls && c.toolCalls.length > 0);
    expect(tool?.toolCalls?.[0].function.arguments).toEqual({ city: 'Paris' });
  });

  it('decodes thinking deltas', () => {
    const dec = createAnthropicStreamDecoder();
    const chunks = dec.push(
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"pondering"}}\n\n',
    );
    expect(chunks[0]).toMatchObject({ thinking: 'pondering', content: '' });
  });

  it('assembles a signed thinking block (thinking text + signature) for replay', () => {
    const dec = createAnthropicStreamDecoder();
    dec.push([
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"reasoning…"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"SIGABC"}}',
      '',
      'event: content_block_stop',
      'data: {"type":"content_block_stop","index":0}',
      '',
    ].join('\n') + '\n');
    expect(dec.getThinkingBlocks()).toEqual([{ type: 'thinking', thinking: 'reasoning…', signature: 'SIGABC' }]);
  });

  it('surfaces an error event via decoder.error', () => {
    const dec = createAnthropicStreamDecoder();
    dec.push('event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}\n\n');
    expect(dec.error).toBe('Overloaded');
  });
});
