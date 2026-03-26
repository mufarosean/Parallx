import { describe, expect, it } from 'vitest';

import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatContentPartKind, ChatMode } from '../../src/services/chatTypes';
import type {
  IChatParticipant,
  IChatParticipantContext,
  IChatParticipantRequest,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';

const USER_COUNT = 100;
const TURNS_PER_USER = 3;

function createEchoAgent(): IChatParticipant {
  return {
    id: 'parallx.chat.default',
    displayName: 'Default',
    description: 'Stress test echo agent',
    commands: [],
    handler: async (
      request: IChatParticipantRequest,
      _context: IChatParticipantContext,
      response: IChatResponseStream,
      _token: ICancellationToken,
    ) => {
      await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 5)));
      response.markdown([
        `request=${request.requestId}`,
        `user=${request.text}`,
        `scope=${request.turnState?.queryScope.level ?? 'unknown'}`,
      ].join('\n'));
      return {};
    },
  };
}

describe('chat service 100-user simulation', () => {
  it('keeps 100 concurrent users isolated across repeated turns', async () => {
    const agentService = new ChatAgentService();
    const modeService = new ChatModeService();
    const lmService = new LanguageModelsService();
    const chatService = new ChatService(agentService, modeService, lmService);

    modeService.setMode(ChatMode.Agent);
    agentService.registerAgent(createEchoAgent());
    chatService.setTurnPreparationServices({
      isRAGAvailable: () => true,
      listFilesRelative: async (relativePath: string) => {
        if (relativePath === '') {
          return [
            { name: 'Claims Guide.md', type: 'file' as const },
            { name: 'RF Guides', type: 'directory' as const },
          ];
        }
        if (relativePath === 'RF Guides') {
          return [
            { name: 'Brosius.pdf', type: 'file' as const },
            { name: 'Clark.pdf', type: 'file' as const },
          ];
        }
        return [];
      },
    });

    const sessions = Array.from({ length: USER_COUNT }, () => chatService.createSession(ChatMode.Agent, 'test-model'));

    await Promise.all(sessions.map(async (session, userIndex) => {
      for (let turn = 0; turn < TURNS_PER_USER; turn += 1) {
        const prompt = turn === 0
          ? `User ${userIndex} summarize Claims Guide.md`
          : turn === 1
            ? `User ${userIndex} summarize each file in the RF Guides folder`
            : `User ${userIndex} compare Claims Guide.md with RF Guides`;
        await chatService.sendRequest(session.id, prompt);
      }
    }));

    expect(chatService.getSessions()).toHaveLength(USER_COUNT);

    for (const [userIndex, session] of sessions.entries()) {
      expect(session.requestInProgress).toBe(false);
      expect(session.messages).toHaveLength(TURNS_PER_USER);

      for (const [turnIndex, pair] of session.messages.entries()) {
        expect(pair.request.text).toContain(`User ${userIndex}`);
        expect(pair.response.isComplete).toBe(true);
        expect(pair.response.parts[0]).toMatchObject({ kind: ChatContentPartKind.Markdown });
        const responseText = (pair.response.parts[0] as { content: string }).content;
        expect(responseText).toContain(`user=${pair.request.text}`);
        expect(responseText).toContain('scope=');
        if (turnIndex === 1) {
          expect(responseText).toContain('scope=folder');
        }
      }
    }
  });
});