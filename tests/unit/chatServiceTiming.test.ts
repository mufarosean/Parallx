// chatServiceTiming.test.ts — a request through the chat service leaves its
// answer with the times the line under it is made of: the first word (the
// model's own, not the runtime's status lines), the finish, and what the
// engine reported of each model call.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import type { IChatParticipant, IChatResponseStream } from '../../src/services/chatTypes';

afterEach(() => vi.useRealTimers());

function setup(write: (response: IChatResponseStream) => Promise<void>) {
  const agents = new ChatAgentService();
  const service = new ChatService(agents, new ChatModeService(), new LanguageModelsService());
  const agent: IChatParticipant = {
    id: 'parallx.chat.default', displayName: 'Default', description: 'Default agent for tests', commands: [],
    handler: async (_request, _context, response) => { await write(response); return {}; },
  };
  agents.registerAgent(agent);
  return service;
}

describe('an answer\'s timing', () => {
  it('stamps the first word when the model first writes, not at a status line, and the finish at the end', async () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const service = setup(async (response) => {
      response.progress('Searching the workspace');       // the runtime's own line
      await vi.advanceTimersByTimeAsync(700);
      response.thinking('Let me think.');                 // the model's first word
      await vi.advanceTimersByTimeAsync(3000);
      response.markdown('The answer.');
      response.reportModelCall?.({ promptEvalCount: 26, promptEvalDuration: 342546000, evalCount: 282, evalDuration: 4535599000, loadDuration: 1334875 });
      await vi.advanceTimersByTimeAsync(300);
    });
    const session = service.createSession();
    await service.sendRequest(session.id, 'A question');
    const { request, response } = service.getSession(session.id)!.messages[0];
    expect(request.timestamp).toBe(1_000_000);
    expect(response.timing).toEqual({ firstWordAt: 1_000_700, completedAt: 1_004_000, calls: 1, writtenTokens: 282, timedTokens: 282, writingMs: 4536, readTokens: 26, readingMs: 343, loadingMs: 1 });
  });

  it('sums the model calls of an answer that used tools', async () => {
    const service = setup(async (response) => {
      response.reportModelCall?.({ evalCount: 100, evalDuration: 2e9 });
      response.beginToolInvocation('t1', 'read_file', {});
      response.updateToolInvocation('t1', { status: 'completed', isComplete: true });
      response.reportModelCall?.({ evalCount: 300, evalDuration: 3e9 });
      response.markdown('Done.');
    });
    const session = service.createSession();
    await service.sendRequest(session.id, 'Read it');
    const timing = service.getSession(session.id)!.messages[0].response.timing!;
    expect(timing).toMatchObject({ calls: 2, writtenTokens: 400, writingMs: 5000 });
    expect(timing.firstWordAt).toBeGreaterThan(0);
    expect(timing.completedAt).toBeGreaterThanOrEqual(timing.firstWordAt!);
  });

  it('an answer that failed still says when it ended, and has no first word if the model never wrote', async () => {
    const service = setup(async () => { throw new Error('The model could not be reached.'); });
    const session = service.createSession();
    await service.sendRequest(session.id, 'Hello');
    const timing = service.getSession(session.id)!.messages[0].response.timing!;
    expect(timing.completedAt).toBeGreaterThan(0);
    expect(timing.firstWordAt).toBeUndefined();
  });
});
