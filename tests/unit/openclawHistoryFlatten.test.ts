import { describe, expect, it } from 'vitest';

import { ChatContentPartKind } from '../../src/services/chatTypes';
import type {
  IChatParticipantContext,
  IChatRequestResponsePair,
  IChatToolInvocationContent,
} from '../../src/services/chatTypes';
import { flattenPairsToMessages, buildOpenclawSeedMessages } from '../../src/openclaw/participants/openclawParticipantRuntime';
import { dropOrphanedToolHead } from '../../src/openclaw/openclawContextEngine';

// ── Fixtures ──

function md(content: string) {
  return { kind: ChatContentPartKind.Markdown, content } as const;
}

function code(codeText: string) {
  return { kind: ChatContentPartKind.CodeBlock, code: codeText } as const;
}

function thinking(content: string) {
  return { kind: ChatContentPartKind.Thinking, content, isCollapsed: true } as const;
}

function tool(
  name: string,
  args: Record<string, unknown>,
  result: string,
  overrides: Partial<IChatToolInvocationContent> = {},
): IChatToolInvocationContent {
  return {
    kind: ChatContentPartKind.ToolInvocation,
    toolCallId: `${name}-0`,
    toolName: name,
    args,
    status: 'completed',
    result: { content: result },
    ...overrides,
  };
}

function pair(text: string, parts: unknown[]): IChatRequestResponsePair {
  return {
    request: { text, requestId: `req-${text}`, attempt: 0, timestamp: 0 },
    response: { parts, isComplete: true },
  } as unknown as IChatRequestResponsePair;
}

function history(...pairs: IChatRequestResponsePair[]): IChatParticipantContext['history'] {
  return pairs;
}

// ── flattenPairsToMessages ──

describe('flattenPairsToMessages — the transcript is sacred (HARNESS.md §1)', () => {
  it('preserves the tool exchange record in round order', () => {
    const messages = flattenPairsToMessages(history(
      pair('read those files', [
        md('Reading both files.'),
        tool('fs_read_file', { path: 'a.ts' }, 'contents of a'),
        tool('fs_read_file', { path: 'b.ts' }, 'contents of b'),
        md('Both files read; a.ts imports b.ts.'),
      ]),
    ));

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant']);
    const [, assistant, result1, result2, final] = messages;
    expect(assistant.content).toBe('Reading both files.');
    expect(assistant.toolCalls).toHaveLength(2);
    expect(assistant.toolCalls?.[0].function.name).toBe('fs_read_file');
    expect(assistant.toolCalls?.[0].function.arguments).toEqual({ path: 'a.ts' });
    expect(result1.toolName).toBe('fs_read_file');
    expect(result1.content).toBe('contents of a');
    expect(result2.content).toBe('contents of b');
    expect(final.content).toBe('Both files read; a.ts imports b.ts.');
  });

  it('splits multiple tool rounds at text boundaries', () => {
    const messages = flattenPairsToMessages(history(
      pair('two rounds', [
        md('Round one.'),
        tool('fs_list_files', { path: '.' }, 'a.ts\nb.ts'),
        md('Round two.'),
        tool('fs_read_file', { path: 'a.ts' }, 'contents'),
        md('Done.'),
      ]),
    ));

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool', 'assistant']);
    expect(messages[1].toolCalls?.[0].function.name).toBe('fs_list_files');
    expect(messages[3].toolCalls?.[0].function.name).toBe('fs_read_file');
  });

  it('marks error results with the loop convention and rejected calls plainly', () => {
    const messages = flattenPairsToMessages(history(
      pair('try things', [
        tool('fs_read_file', { path: 'missing.ts' }, 'File not found', { status: 'error', result: { content: 'File not found', isError: true } }),
        tool('fs_delete_file', { path: 'a.ts' }, '', { status: 'rejected', result: undefined }),
      ]),
    ));

    const toolMessages = messages.filter((m) => m.role === 'tool');
    expect(toolMessages[0].content).toBe('[TOOL ERROR] File not found');
    expect(toolMessages[1].content).toBe('[Tool call rejected by user]');
  });

  it('ages old pairs: results decay to previews, long string args elide, recent pairs stay whole', () => {
    const bigResult = 'x'.repeat(5_000);
    const bigArg = 'y'.repeat(1_000);
    const messages = flattenPairsToMessages(history(
      pair('old turn', [tool('fs_read_file', { path: 'a.ts', content: bigArg }, bigResult)]),
      pair('recent turn 1', [tool('fs_read_file', { path: 'b.ts' }, bigResult)]),
      pair('recent turn 2', [md('No tools.')]),
    ));

    const agedResult = messages.find((m) => m.role === 'tool' && m.content.length < 5_000);
    expect(agedResult).toBeDefined();
    expect(agedResult!.content).toContain('truncated by history aging');
    expect(agedResult!.content).toContain('re-run fs_read_file');

    const agedCall = messages.find((m) => m.role === 'assistant' && m.toolCalls);
    const agedArgs = agedCall!.toolCalls![0].function.arguments;
    expect(String(agedArgs.content)).toContain('elided by history aging');
    expect(agedArgs.path).toBe('a.ts');

    const recentResult = messages.filter((m) => m.role === 'tool')[1];
    expect(recentResult.content).toBe(bigResult);
  });

  it('keeps a longer preview for aged errors — failure memory prevents repeats', () => {
    const longError = '[TOOL ERROR] ' + 'e'.repeat(600);
    const messages = flattenPairsToMessages(history(
      pair('old failure', [tool('terminal_run_command', { command: 'build' }, longError, { status: 'error' })]),
      pair('recent 1', [md('a')]),
      pair('recent 2', [md('b')]),
    ));

    const aged = messages.find((m) => m.role === 'tool')!;
    expect(aged.content).toBe(longError); // 613 chars ≤ 800 error cap: kept whole
  });

  it('excludes thinking parts from replayed history', () => {
    const messages = flattenPairsToMessages(history(
      pair('question', [thinking('private reasoning here'), md('The answer.'), code('const x = 1;')]),
    ));

    expect(messages).toHaveLength(2);
    expect(messages[1].content).toBe('The answer.\n```\nconst x = 1;\n```');
    expect(messages[1].content).not.toContain('private reasoning');
  });

  it('records a placeholder when an invocation has no persisted result', () => {
    const messages = flattenPairsToMessages(history(
      pair('crashed turn', [tool('fs_read_file', { path: 'a.ts' }, '', { result: undefined })]),
    ));
    expect(messages.find((m) => m.role === 'tool')!.content).toBe('[no result recorded]');
  });
});

// ── buildOpenclawSeedMessages ──

describe('buildOpenclawSeedMessages', () => {
  it('wraps the shared flattener with system prompt and trailing user turn', () => {
    const messages = buildOpenclawSeedMessages(
      'SYSTEM',
      history(pair('earlier', [md('Earlier answer.'), tool('fs_read_file', { path: 'a.ts' }, 'contents')])),
      { text: 'now', requestId: 'r2', attempt: 0 } as never,
    );

    expect(messages[0]).toMatchObject({ role: 'system', content: 'SYSTEM' });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'user']);
    expect(messages.at(-1)!.content).toBe('now');
  });
});

// ── dropOrphanedToolHead ──

describe('dropOrphanedToolHead — round-boundary guard at history cut points', () => {
  it('drops leading tool results whose assistant call was cut', () => {
    const guarded = dropOrphanedToolHead([
      { role: 'tool', toolName: 'fs_read_file', content: 'orphan' },
      { role: 'tool', toolName: 'fs_read_file', content: 'orphan 2' },
      { role: 'user', content: 'next turn' },
      { role: 'assistant', content: 'reply' },
    ]);
    expect(guarded.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('leaves intact sequences alone', () => {
    const messages = [
      { role: 'assistant' as const, content: '', toolCalls: [{ function: { name: 'fs_read_file', arguments: {} } }] },
      { role: 'tool' as const, toolName: 'fs_read_file', content: 'result' },
    ];
    expect(dropOrphanedToolHead(messages)).toEqual(messages);
  });
});

// ── /compact command (HARNESS.md §1.3) ──

describe('tryHandleOpenclawCompactCommand', () => {
  it('summarizes the tool-aware transcript, rewrites the session, clears the boundary cache', async () => {
    const { tryHandleOpenclawCompactCommand } = await import('../../src/openclaw/openclawDefaultRuntimeSupport');
    const captured: unknown[] = [];
    const compactSession = vi.fn();
    const writeCompactionCache = vi.fn();
    async function* summarize(messages: unknown): AsyncIterable<{ content: string; done: boolean }> {
      captured.push(messages);
      yield { content: 'Mission: continue. fs_read_file a.ts', done: true };
    }

    const handled = await tryHandleOpenclawCompactCommand(
      {
        sendSummarizationRequest: summarize as never,
        compactSession,
        storeSessionMemory: undefined,
        writeCompactionCache,
      },
      {
        activeCommand: 'compact',
        context: {
          sessionId: 'sess-1',
          history: history(
            pair('read it', [
              md('Reading.'),
              tool('fs_read_file', { path: 'a.ts' }, '[TOOL ERROR] File not found', { status: 'error' }),
            ]),
            pair('ok', [md('Acknowledged.')]),
          ),
        } as never,
        response: { markdown: vi.fn(), progress: vi.fn() } as never,
      },
    );

    expect(handled).toBe(true);
    const transcript = (captured[0] as Array<{ content: string }>)[1].content;
    expect(transcript).toContain('[called: fs_read_file({"path":"a.ts"})]');
    expect(transcript).toContain('Tool result (fs_read_file): [TOOL ERROR] File not found');
    expect(compactSession).toHaveBeenCalledWith('sess-1', expect.stringContaining('Mission'));
    expect(writeCompactionCache).toHaveBeenCalledWith('sess-1', undefined);
  });
});
