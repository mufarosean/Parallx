// openclawAttemptCitations.test.ts — an answer's citations are checked before it is final.
//
// A citation to the wrong source goes back to the model once; its rewrite
// replaces the draft on screen. What still fails is shown as Unverified.
// Labels become links in the answer that is kept.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import MarkdownIt from 'markdown-it';
import type { IChatResponseChunk, IChatResponseStream, ICancellationToken, IChatParticipantRequest } from '../../src/services/chatTypes';
import type { IOpenclawTurnContext } from '../../src/openclaw/openclawAttempt';
import { executeOpenclawAttempt } from '../../src/openclaw/openclawAttempt';
import { _resetSourceHandlesForTest, citeSource } from '../../src/services/sourceHandles';
import { citationMarks } from '../../src/built-in/chat/rendering/chatCitationMarks';

vi.mock('../../src/openclaw/openclawPromptArtifacts', () => ({
  buildOpenclawPromptArtifacts: vi.fn(() => ({ systemPrompt: 'System.', report: {} })),
}));

const SID = 'cite-session';

function page(n: number, text: string): void {
  const uri = `parallx://explorer/file?path=Clark.pdf&page=${n}`;
  citeSource(SID, { key: uri, location: `Clark.pdf · page ${n} of 30`, title: `Clark.pdf, page ${n}`, uri, text, document: true });
}

function response(): IChatResponseStream {
  const r = {
    markdown: vi.fn(), codeBlock: vi.fn(), progress: vi.fn(), provenance: vi.fn(), reference: vi.fn(), thinking: vi.fn(),
    warning: vi.fn(), button: vi.fn(), confirmation: vi.fn(), beginToolInvocation: vi.fn(), updateToolInvocation: vi.fn(),
    editProposal: vi.fn(), editBatch: vi.fn(), push: vi.fn(), replaceLastMarkdown: vi.fn(), throwIfDone: vi.fn(),
    reportTokenUsage: vi.fn(), setCitations: vi.fn(), getMarkdownText: vi.fn(() => ''),
    replaceMarkdownTail: vi.fn(() => true),
  };
  return r as unknown as IChatResponseStream;
}

const token: ICancellationToken = { isCancellationRequested: false, onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as never };

function context(answers: string[]): IOpenclawTurnContext {
  let call = 0;
  return {
    sessionId: SID,
    history: [],
    tokenBudget: 8192,
    engine: {
      bootstrap: vi.fn(async () => ({ ragReady: true, memoryReady: true, conceptsReady: true })),
      assemble: vi.fn(async () => ({ messages: [], estimatedTokens: 100, ragSources: [], retrievedContextText: '' })),
      compact: vi.fn(async () => ({ compacted: true, tokensBefore: 1, tokensAfter: 1 })),
      afterTurn: vi.fn(async () => {}),
    },
    bootstrapFiles: [],
    bootstrapDebugReport: {} as never,
    workspaceDigest: '',
    skillState: { promptEntries: [] } as never,
    runtimeInfo: { model: 'qwen2.5:7b', provider: 'ollama', host: 'localhost', parallxVersion: '0.1.0' },
    toolState: { availableDefinitions: [] } as never,
    maxToolIterations: 6,
    sendChatRequest: vi.fn(async function* () {
      yield { content: answers[Math.min(call++, answers.length - 1)], done: true } as IChatResponseChunk;
    }),
  } as unknown as IOpenclawTurnContext;
}

const request = { text: 'What tail factor does Clark select?', attachments: [] } as unknown as IChatParticipantRequest;
const assembled = { messages: [], estimatedTokens: 100, ragSources: [], retrievedContextText: '' };

beforeEach(() => {
  _resetSourceHandlesForTest();
  page(12, 'Development is slow in the early years.');
  page(13, 'The selected tail factor is 1.05, from the inverse power curve.');
});

describe('citation check in the turn', () => {
  it('sends a wrong citation back once, and keeps the corrected answer with its link', async () => {
    const ctx = context(['The selected tail factor is 1.05 [S1].', 'The selected tail factor is 1.05 [S2].']);
    const res = response();
    const result = await executeOpenclawAttempt(request, ctx, assembled, res, token);

    expect(ctx.sendChatRequest).toHaveBeenCalledTimes(2);
    const second = vi.mocked(ctx.sendChatRequest).mock.calls[1][0];
    const note = second[second.length - 1];
    expect(note.role).toBe('user');
    expect(note.content).toContain('[Citation check]');
    expect(note.content).toContain('[S2] does: cite it instead.');
    // The draft was taken off the screen before the rewrite streamed.
    expect(res.replaceMarkdownTail).toHaveBeenCalledWith('The selected tail factor is 1.05 [S1].', '');
    expect(result.markdown).toBe('The selected tail factor is 1.05 ([Clark.pdf, page 13](parallx://explorer/file?path=Clark.pdf&page=13)).');
  });

  it('marks a citation that is still wrong as Unverified after the one correction', async () => {
    const ctx = context(['The selected tail factor is 1.05 [S1].']);
    const result = await executeOpenclawAttempt(request, ctx, assembled, response(), token);
    expect(ctx.sendChatRequest).toHaveBeenCalledTimes(2);
    expect(result.markdown).toContain('[Clark.pdf, page 12 · Unverified](parallx://explorer/file?path=Clark.pdf&page=12 "Unverified: the source does not contain 1.05")');
  });

  it('lets a correct answer through in one call', async () => {
    const ctx = context(['The selected tail factor is 1.05 [S2].']);
    await executeOpenclawAttempt(request, ctx, assembled, response(), token);
    expect(ctx.sendChatRequest).toHaveBeenCalledTimes(1);
  });
});

describe('citation looks in the rendered reply', () => {
  const md = new MarkdownIt();
  md.use(citationMarks);

  it('shows a label not yet checked as a pending chip', () => {
    expect(md.render('The factor is 1.05 [S3].')).toContain('<span class="parallx-cite-pending" title="Checking this source">S3</span>');
  });

  it('styles an Unverified citation apart', () => {
    const html = md.render('[Clark.pdf, page 12 · Unverified](parallx://explorer/file?path=Clark.pdf&page=12 "Unverified: the source does not contain 1.05")');
    expect(html).toContain('class="parallx-chat-link--unverified"');
  });

  it('leaves labels in code alone', () => {
    expect(md.render('`arr[S3]`')).not.toContain('parallx-cite-pending');
  });
});
