// chatWorkspaceSwitch.test.ts — Tests for workspace-scoped chat persistence behaviour.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import type { IChatPersistenceDatabase } from '../../src/services/chatSessionPersistence';
import type {
  IChatParticipant,
  IChatParticipantRequest,
  IChatParticipantContext,
  IChatResponseStream,
  ICancellationToken,
} from '../../src/services/chatTypes';

// ── Helpers ──

function createDefaultAgent(): IChatParticipant {
  return {
    id: 'parallx.chat.default',
    displayName: 'Default',
    description: 'Default agent',
    commands: [],
    handler: async (
      _req: IChatParticipantRequest,
      _ctx: IChatParticipantContext,
      response: IChatResponseStream,
      _token: ICancellationToken,
    ) => {
      response.markdown('Hello');
      return {};
    },
  };
}

function createMockDb(): IChatPersistenceDatabase {
  return {
    async run(_sql: string, _params?: unknown[]): Promise<void> {},
    async get<T>(_sql: string, _params?: unknown[]): Promise<T | undefined> {
      return undefined;
    },
    async all<T>(_sql: string, _params?: unknown[]): Promise<T[]> {
      return [];
    },
    async runTransaction(fn: (tx: { run: (sql: string, params?: unknown[]) => Promise<void> }) => Promise<void>): Promise<void> {
      const tx = { async run(_sql: string, _params?: unknown[]): Promise<void> {} };
      await fn(tx);
    },
    isOpen: true,
  };
}

describe('ChatService workspace-scoped persistence', () => {
  let agentService: ChatAgentService;
  let modeService: ChatModeService;
  let lmService: LanguageModelsService;

  beforeEach(() => {
    agentService = new ChatAgentService();
    modeService = new ChatModeService();
    lmService = new LanguageModelsService();
    agentService.registerAgent(createDefaultAgent());
  });

  it('setDatabase stores workspace ID and passes it to persistence calls', async () => {
    // Track what workspace_id gets passed to DB queries
    const queriedParams: unknown[][] = [];
    const scopedDb: IChatPersistenceDatabase = {
      ...createMockDb(),
      async all<T>(_sql: string, params?: unknown[]): Promise<T[]> {
        if (params) { queriedParams.push(params as unknown[]); }
        return [];
      },
    };

    const service = new ChatService(agentService, modeService, lmService);
    service.setDatabase(scopedDb, 'workspace-xyz');
    await service.restoreSessions();

    // loadSessions should have received workspace_id = 'workspace-xyz'
    expect(queriedParams.some((p) => p.includes('workspace-xyz'))).toBe(true);
  });

  it('sessions are scoped: different workspace ID yields different sessions', async () => {
    // DB returns sessions only when workspace_id matches 'ws-b'
    const scopedDb: IChatPersistenceDatabase = {
      ...createMockDb(),
      async all<T>(sql: string, params?: unknown[]): Promise<T[]> {
        if (sql.includes('chat_sessions') && params?.[0] === 'ws-b') {
          return [{
            id: 'session-for-b',
            title: 'B Session',
            mode: 'agent',
            model_id: '',
            created_at: Date.now(),
            updated_at: Date.now(),
          }] as T[];
        }
        return [];
      },
    };

    // Workspace A — should get no sessions
    const serviceA = new ChatService(agentService, modeService, lmService);
    serviceA.setDatabase(scopedDb, 'ws-a');
    await serviceA.restoreSessions();
    expect(serviceA.getSessions()).toHaveLength(0);

    // Workspace B — should get the session
    const serviceB = new ChatService(agentService, modeService, lmService);
    serviceB.setDatabase(scopedDb, 'ws-b');
    await serviceB.restoreSessions();
    expect(serviceB.getSessions()).toHaveLength(1);
    expect(serviceB.getSessions()[0].id).toBe('session-for-b');
  });
});
