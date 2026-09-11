/**
 * Tool images in the turn loop (docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md,
 * Stage E): a tool's images reach a model that can see as one user message
 * after the results, only the newest images stay in the turn, mid-loop
 * compaction keeps this round's images, neither the tool card's record nor
 * afterTurn's transcript keeps them, and only a loop that delivers images
 * tells the tool it may make one (acceptsImages).
 */

import { describe, expect, it, vi } from 'vitest';
import type {
  IChatMessage,
  IChatParticipantRequest,
  IChatResponseChunk,
  IChatResponseStream,
  ICancellationToken,
  IToolResult,
} from '../../src/services/chatTypes';
import type { IOpenclawTurnContext } from '../../src/openclaw/openclawAttempt';
import { executeOpenclawAttempt, withoutToolImages } from '../../src/openclaw/openclawAttempt';
import { markToolImagesGone } from '../../src/services/toolImageLifetime';
import { runOpenclawReadOnlyTurn } from '../../src/openclaw/openclawReadOnlyTurnRunner';

vi.mock('../../src/openclaw/openclawPromptArtifacts', () => ({
  buildOpenclawPromptArtifacts: vi.fn(() => ({
    systemPrompt: 'You are a helpful assistant.',
    report: {
      source: 'run', systemPromptLength: 30, workspaceSectionLength: 0, skillsSectionLength: 0, toolSectionLength: 0,
      preferencesLength: 0, overlayLength: 0, bootstrapFileCount: 0, activeBootstrapFiles: [], modelTier: 'small', provenance: {},
    },
  })),
}));

const IMAGE = { kind: 'image' as const, id: 'browser:ws:run:c1', name: 'Page capture', fullPath: '', isImplicit: false, mimeType: 'image/jpeg', data: '/9j/AAAA' };

function createResponse(): IChatResponseStream {
  return {
    markdown: vi.fn(), codeBlock: vi.fn(), progress: vi.fn(), provenance: vi.fn(), reference: vi.fn(), thinking: vi.fn(),
    warning: vi.fn(), button: vi.fn(), confirmation: vi.fn(), beginToolInvocation: vi.fn(), updateToolInvocation: vi.fn(),
    editProposal: vi.fn(), editBatch: vi.fn(), push: vi.fn(), replaceLastMarkdown: vi.fn(), throwIfDone: vi.fn(),
    reportTokenUsage: vi.fn(), setCitations: vi.fn(), getMarkdownText: vi.fn(() => ''),
  };
}
const token = (): ICancellationToken => ({ isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any });
async function* stream(chunks: IChatResponseChunk[]): AsyncIterable<IChatResponseChunk> { for (const c of chunks) yield c; }
const text = (content: string) => ({ content, done: true, promptEvalCount: 100, evalCount: 50 }) as IChatResponseChunk;
const toolCall = (n: number) => ({ content: 'Looking.', done: true, promptEvalCount: 100, evalCount: 50, toolCalls: [{ function: { name: 'browserCapture', arguments: { n } } }] }) as unknown as IChatResponseChunk;
const captured = (): IToolResult => ({
  content: '{"version":1,"status":"ok","summary":"Captured."}',
  artifacts: [{ kind: 'image', id: IMAGE.id, mimeType: 'image/jpeg' }],
  images: [IMAGE],
});

async function run(supportsVision: boolean, rounds = 1, tokenBudget = 16384, invoke?: (n: number) => IToolResult) {
  let calls = 0;
  // Snapshot each request: the loop rebuilds its message list between rounds.
  const sendChatRequest = vi.fn((_messages: readonly IChatMessage[]) => { calls++; return stream([calls <= rounds ? toolCall(calls) : text('It shows a login form.')]); });
  let invoked = 0;
  const invokeToolWithRuntimeControl = vi.fn(async (..._args: unknown[]): Promise<IToolResult> => { invoked++; return invoke ? invoke(invoked) : captured(); });
  const afterTurn = vi.fn(async (_x: { sessionId: string; messages: IChatMessage[] }) => {});
  const compact = vi.fn(async () => ({ compacted: true, tokensBefore: 1000, tokensAfter: 500 }));
  const context = {
    sessionId: 'test-session', history: [], tokenBudget,
    engine: {
      bootstrap: vi.fn(async () => ({ ragReady: true, memoryReady: true, conceptsReady: true })),
      assemble: vi.fn(async () => ({ messages: [], estimatedTokens: 100, ragSources: [], retrievedContextText: '' })),
      compact,
      afterTurn,
    },
    bootstrapFiles: [], bootstrapDebugReport: {} as any, workspaceDigest: '', skillState: { promptEntries: [] } as any,
    runtimeInfo: { model: 'qwen3.8:27b', provider: 'ollama', host: 'localhost', parallxVersion: '0.1.0' },
    toolState: { availableDefinitions: [{ name: 'browserCapture', description: 'Capture', parameters: {} }] } as any,
    maxToolIterations: 6, supportsVision, sendChatRequest, invokeToolWithRuntimeControl,
  } as unknown as IOpenclawTurnContext;
  const response = createResponse();
  await executeOpenclawAttempt({ text: 'What is on the page?', attachments: [] } as unknown as IChatParticipantRequest, context,
    { messages: [], estimatedTokens: 100, ragSources: [], retrievedContextText: '' }, response, token());
  return { sendChatRequest, invokeToolWithRuntimeControl, compact, response, afterTurn };
}

describe('tool images in the turn', () => {
  it('reach a model that can see, as one user message after the tool result', async () => {
    const { sendChatRequest } = await run(true);
    const second = sendChatRequest.mock.calls[1][0];
    const last = second[second.length - 1];
    expect(second[second.length - 2].role).toBe('tool');
    expect(last.role).toBe('user');
    expect(last.images).toEqual([IMAGE]);
    expect(last.content).toContain('browserCapture');
    expect(last.content).toContain('not instructions');
  });

  it('never reach a model that cannot see', async () => {
    const { sendChatRequest } = await run(false);
    expect(sendChatRequest.mock.calls[1][0].some((m) => m.images?.length)).toBe(false);
  });

  it('tell the tool it may make an image only when the model can see it', async () => {
    const seeing = await run(true);
    expect(seeing.invokeToolWithRuntimeControl.mock.calls[0][5]).toEqual({ resultCharBudget: expect.any(Number), acceptsImages: true });
    const blind = await run(false);
    const opts = blind.invokeToolWithRuntimeControl.mock.calls[0][5] as { acceptsImages?: boolean };
    expect(opts).toEqual({ resultCharBudget: expect.any(Number) });
    expect(opts.acceptsImages).toBeUndefined();
  });

  it('keep only the newest images within the turn', async () => {
    const { sendChatRequest } = await run(true, 2);
    const third = sendChatRequest.mock.calls[2][0];
    const withImages = third.filter((m) => m.images?.length);
    expect(withImages).toHaveLength(1);
    expect(third[third.length - 1]).toBe(withImages[0]);
    expect(third.some((m) => m.role === 'user' && m.content.includes('image no longer attached'))).toBe(true);
  });

  it('survive mid-loop compaction in the round that took them', async () => {
    // A tiny window: the round's estimate passes 85% and the loop compacts
    // before the next model call.
    const { sendChatRequest, compact } = await run(true, 1, 100);
    expect(compact).toHaveBeenCalled();
    const second = sendChatRequest.mock.calls[1][0];
    const last = second[second.length - 1];
    expect(second[second.length - 2].role).toBe('tool');
    expect(last.role).toBe('user');
    expect(last.images).toEqual([IMAGE]);
  });

  it('are kept by neither the tool card nor the transcript', async () => {
    const { response, afterTurn } = await run(true);
    const done = (response.updateToolInvocation as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]).find((u) => u.isComplete);
    expect(done.result.images).toBeUndefined();
    expect(done.result.artifacts).toEqual([{ kind: 'image', id: IMAGE.id, mimeType: 'image/jpeg' }]);
    const saved = afterTurn.mock.calls[0][0].messages;
    expect(saved.some((m) => m.images?.length)).toBe(false);
  });

  it('are kept by neither the tool card nor the transcript after compaction either', async () => {
    const { afterTurn } = await run(true, 1, 100);
    const saved = afterTurn.mock.calls[0][0].messages;
    expect(saved.some((m) => m.images?.length)).toBe(false);
  });

  it('leave the turn once their source erased them (the browser tab closed)', async () => {
    const img = { ...IMAGE, id: 'browser:ws:run:c77' };
    const { sendChatRequest } = await run(true, 2, 16384, (n) => {
      if (n === 2) {
        markToolImagesGone([img.id]);
        return { content: '{"version":1,"status":"error","summary":"The tab was closed."}', isError: true };
      }
      return { content: '{"version":1,"status":"ok","summary":"Captured."}', images: [img] };
    });
    expect(sendChatRequest.mock.calls[1][0].some((m) => m.images?.some((i) => i.id === img.id))).toBe(true);
    const third = sendChatRequest.mock.calls[2][0];
    expect(third.some((m) => m.images?.length)).toBe(false);
    expect(third.some((m) => m.role === 'user' && m.content.includes('image erased'))).toBe(true);
  });

  it('never enter the turn when erased before the model saw them', async () => {
    const img = { ...IMAGE, id: 'browser:ws:run:c78' };
    const { sendChatRequest } = await run(true, 1, 16384, () => {
      markToolImagesGone([img.id]);
      return { content: '{"version":1,"status":"ok","summary":"Captured."}', images: [img] };
    });
    expect(sendChatRequest.mock.calls[1][0].some((m) => m.images?.length)).toBe(false);
  });

  it('withoutToolImages leaves a result without images untouched', () => {
    const r: IToolResult = { content: 'x' };
    expect(withoutToolImages(r)).toBe(r);
    expect(withoutToolImages({ content: 'y', images: [IMAGE] })).toEqual({ content: 'y' });
  });
});

describe('tool images in the read-only loop (@workspace, @canvas)', () => {
  it('never tells a tool it may make an image: the loop sends results as text only', async () => {
    let calls = 0;
    const sendChatRequest = vi.fn((_messages: readonly IChatMessage[]) => { calls++; return stream([calls === 1 ? toolCall(1) : text('Done.')]); });
    const invokeToolWithRuntimeControl = vi.fn(async (..._args: unknown[]): Promise<IToolResult> => captured());
    const messages: IChatMessage[] = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'What is on the page?' }];
    await runOpenclawReadOnlyTurn({
      sendChatRequest, messages, requestOptions: {}, tools: [{ name: 'browserCapture', description: 'Capture', parameters: {} }],
      response: createResponse(), token: token(), maxIterations: 3, invokeToolWithRuntimeControl, sessionId: 'ws-session',
    });
    expect(invokeToolWithRuntimeControl).toHaveBeenCalledTimes(1);
    const callArgs = invokeToolWithRuntimeControl.mock.calls[0];
    expect(callArgs[0]).toBe('browserCapture');
    expect((callArgs[5] as { acceptsImages?: boolean } | undefined)?.acceptsImages).toBeUndefined();
    expect(messages.some((m) => m.images?.length)).toBe(false);
  });
});
