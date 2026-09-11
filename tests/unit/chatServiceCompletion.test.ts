/**
 * ChatService.onDidCompleteRequest: once per request that reached its
 * participant, however it ended, carrying the request id the turn's
 * cancellation token held. Holders scoped to one turn (the Assistant
 * Browser's lease) end on it. docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md.
 */

import { describe, it, expect, vi } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import type { IChatParticipant, ICancellationToken } from '../../src/services/chatTypes';

function setup(behaviour: (token: ICancellationToken) => Promise<void>) {
  const agents = new ChatAgentService();
  const service = new ChatService(agents, new ChatModeService(), new LanguageModelsService());
  const turns: (string | undefined)[] = [];
  const agent: IChatParticipant = {
    id: 'parallx.chat.default',
    displayName: 'Default',
    description: 'Default agent for tests',
    commands: [],
    handler: async (_request, _context, response, token) => {
      turns.push(token.turnId);
      await behaviour(token);
      response.markdown('done');
      return {};
    },
  };
  agents.registerAgent(agent);
  const completions: { sessionId: string; turnId: string }[] = [];
  service.onDidCompleteRequest((c) => completions.push(c));
  return { service, turns, completions };
}

describe('ChatService.onDidCompleteRequest', () => {
  it('fires once per request with the turn id the token carried', async () => {
    const s = setup(async () => {});
    const session = s.service.createSession();
    await s.service.sendRequest(session.id, 'Hello');
    await s.service.sendRequest(session.id, 'Again');
    expect(s.completions).toHaveLength(2);
    expect(s.completions.map((c) => c.sessionId)).toEqual([session.id, session.id]);
    expect(s.completions.map((c) => c.turnId)).toEqual(s.turns);
    expect(s.turns[0]).toBeTruthy();
    expect(s.turns[0]).not.toBe(s.turns[1]);
  });

  it('fires when the participant fails', async () => {
    const s = setup(async () => { throw new Error('boom'); });
    const session = s.service.createSession();
    await s.service.sendRequest(session.id, 'Hello');
    expect(s.completions).toEqual([{ sessionId: session.id, turnId: s.turns[0] }]);
  });

  // The agent service catches a participant's own error, so the case above
  // returns normally. This one throws out of sendRequest itself, after the
  // participant ran: only the finally around the request can still fire.
  it('fires when sendRequest itself throws after the participant', async () => {
    const s = setup(async () => {});
    const session = s.service.createSession();
    vi.spyOn(s.service as unknown as { _schedulePersist(id: string): void }, '_schedulePersist').mockImplementation(() => { throw new Error('persist'); });
    await expect(s.service.sendRequest(session.id, 'Hello')).rejects.toThrow('persist');
    expect(s.turns).toHaveLength(1);
    expect(s.completions).toEqual([{ sessionId: session.id, turnId: s.turns[0] }]);
  });

  it('fires when the request is cancelled', async () => {
    let started: () => void = () => {};
    const running = new Promise<void>((r) => { started = r; });
    const s = setup((token) => new Promise<void>((resolve) => {
      started();
      token.onCancellationRequested(() => resolve());
    }));
    const session = s.service.createSession();
    const pending = s.service.sendRequest(session.id, 'Hello');
    await running;
    expect(s.completions).toHaveLength(0);
    s.service.cancelRequest(session.id);
    await pending;
    expect(s.completions).toEqual([{ sessionId: session.id, turnId: s.turns[0] }]);
  });
});
