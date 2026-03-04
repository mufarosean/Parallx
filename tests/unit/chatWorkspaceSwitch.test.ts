// chatWorkspaceSwitch.test.ts — Tests for workspace switch reset behaviour
//
// Verifies that ChatDataService.resetForWorkspaceSwitch() and
// ChatService.resetForWorkspaceSwitch() properly tear down stale state
// and reinitialise for the new workspace.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatService } from '../../src/services/chatService';
import { ChatAgentService } from '../../src/services/chatAgentService';
import { ChatModeService } from '../../src/services/chatModeService';
import { LanguageModelsService } from '../../src/services/languageModelsService';
import { ChatDataService } from '../../src/built-in/chat/data/chatDataService';
import type { ChatDataServiceDeps } from '../../src/built-in/chat/data/chatDataService';
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

function createMinimalDeps(overrides?: Partial<ChatDataServiceDeps>): ChatDataServiceDeps {
  return {
    databaseService: undefined,
    fileService: undefined,
    workspaceService: undefined,
    editorService: undefined,
    retrievalService: undefined,
    indexingPipelineService: undefined,
    memoryService: undefined,
    languageModelsService: new LanguageModelsService() as any,
    languageModelToolsService: undefined,
    chatService: {} as any,
    modeService: new ChatModeService() as any,
    ollamaProvider: {} as any,
    promptFileService: { invalidate: vi.fn() } as any,
    fsAccessor: undefined,
    textFileModelManager: undefined,
    maxIterations: 5,
    networkTimeout: 30_000,
    getActiveWidget: () => undefined,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ChatDataService.resetForWorkspaceSwitch
// ═══════════════════════════════════════════════════════════════════════════════

describe('ChatDataService.resetForWorkspaceSwitch', () => {
  let dataService: ChatDataService;
  let deps: ChatDataServiceDeps;
  const oldRetrieval = { id: 'old-retrieval' } as any;
  const oldPipeline = { id: 'old-pipeline' } as any;
  const oldMemory = { id: 'old-memory' } as any;

  beforeEach(() => {
    deps = createMinimalDeps({
      retrievalService: oldRetrieval,
      indexingPipelineService: oldPipeline,
      memoryService: oldMemory,
    });
    dataService = new ChatDataService(deps);
  });

  it('swaps stale service references to fresh ones', () => {
    const freshRetrieval = { id: 'fresh-retrieval' } as any;
    const freshPipeline = { id: 'fresh-pipeline' } as any;
    const freshMemory = { id: 'fresh-memory' } as any;

    dataService.resetForWorkspaceSwitch({
      retrievalService: freshRetrieval,
      indexingPipelineService: freshPipeline,
      memoryService: freshMemory,
    });

    // Access the private _d via any cast to verify the swap
    const d = (dataService as any)._d;
    expect(d.retrievalService).toBe(freshRetrieval);
    expect(d.indexingPipelineService).toBe(freshPipeline);
    expect(d.memoryService).toBe(freshMemory);
  });

  it('preserves non-stale deps (e.g. databaseService, ollamaProvider)', () => {
    const provider = { id: 'provider' } as any;
    deps = createMinimalDeps({
      retrievalService: oldRetrieval,
      indexingPipelineService: oldPipeline,
      memoryService: oldMemory,
      ollamaProvider: provider,
    });
    dataService = new ChatDataService(deps);

    dataService.resetForWorkspaceSwitch({
      retrievalService: undefined,
      indexingPipelineService: undefined,
      memoryService: undefined,
    });

    const d = (dataService as any)._d;
    expect(d.ollamaProvider).toBe(provider);
  });

  it('clears the cached digest', async () => {
    // Force a digest to be cached by setting internal state directly
    (dataService as any)._cachedDigest = 'old digest text';
    (dataService as any)._cacheTimestamp = Date.now();

    dataService.resetForWorkspaceSwitch({
      retrievalService: undefined,
      indexingPipelineService: undefined,
      memoryService: undefined,
    });

    expect((dataService as any)._cachedDigest).toBeUndefined();
    expect((dataService as any)._cacheTimestamp).toBe(0);
  });

  it('clears _lastIndexStats', () => {
    dataService.setLastIndexStats({ pages: 10, files: 20 });
    expect((dataService as any)._lastIndexStats).toBeDefined();

    dataService.resetForWorkspaceSwitch({
      retrievalService: undefined,
      indexingPipelineService: undefined,
      memoryService: undefined,
    });

    expect((dataService as any)._lastIndexStats).toBeUndefined();
  });

  it('invalidates the prompt file cache', () => {
    const invalidateSpy = (deps.promptFileService as any).invalidate;

    dataService.resetForWorkspaceSwitch({
      retrievalService: undefined,
      indexingPipelineService: undefined,
      memoryService: undefined,
    });

    expect(invalidateSpy).toHaveBeenCalledOnce();
  });

  it('handles switching from no services to having services', () => {
    deps = createMinimalDeps({
      retrievalService: undefined,
      indexingPipelineService: undefined,
      memoryService: undefined,
    });
    dataService = new ChatDataService(deps);

    const freshRetrieval = { id: 'new' } as any;
    dataService.resetForWorkspaceSwitch({
      retrievalService: freshRetrieval,
      indexingPipelineService: undefined,
      memoryService: undefined,
    });

    expect((dataService as any)._d.retrievalService).toBe(freshRetrieval);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// ChatService.resetForWorkspaceSwitch
// ═══════════════════════════════════════════════════════════════════════════════

describe('ChatService.resetForWorkspaceSwitch', () => {
  let chatService: ChatService;
  let agentService: ChatAgentService;
  let modeService: ChatModeService;
  let lmService: LanguageModelsService;
  let mockDb: IChatPersistenceDatabase;

  beforeEach(() => {
    agentService = new ChatAgentService();
    modeService = new ChatModeService();
    lmService = new LanguageModelsService();
    mockDb = createMockDb();
    chatService = new ChatService(agentService, modeService, lmService, mockDb);
    agentService.registerAgent(createDefaultAgent());
  });

  it('clears all in-memory sessions', async () => {
    chatService.createSession();
    chatService.createSession();
    expect(chatService.getSessions()).toHaveLength(2);

    await chatService.resetForWorkspaceSwitch();

    // Reset only clears memory; restore is deferred until DB rebind.
    expect(chatService.getSessions()).toHaveLength(0);
  });

  it('fires onDidDeleteSession for every cleared session', async () => {
    const s1 = chatService.createSession();
    const s2 = chatService.createSession();
    const deletedIds: string[] = [];
    chatService.onDidDeleteSession((id) => deletedIds.push(id));

    await chatService.resetForWorkspaceSwitch();

    expect(deletedIds).toContain(s1.id);
    expect(deletedIds).toContain(s2.id);
    expect(deletedIds).toHaveLength(2);
  });

  it('is safe to call when there are no sessions', async () => {
    expect(chatService.getSessions()).toHaveLength(0);
    await expect(chatService.resetForWorkspaceSwitch()).resolves.toBeUndefined();
  });

  it('flushes pending persistence before clearing', async () => {
    // Create a session (which might schedule a persist) and immediately reset.
    // We mainly check it doesn't throw.
    chatService.createSession();
    await chatService.resetForWorkspaceSwitch();
    expect(chatService.getSessions()).toHaveLength(0);
  });

  it('works when no database is bound', async () => {
    const noPersistService = new ChatService(agentService, modeService, lmService);
    noPersistService.createSession();
    await expect(noPersistService.resetForWorkspaceSwitch()).resolves.toBeUndefined();
    expect(noPersistService.getSessions()).toHaveLength(0);
  });

  it('does not restore sessions during reset (restore is deferred)', async () => {
    // Set up a mock DB that returns a "new workspace" session on `all()`
    const newDb: IChatPersistenceDatabase = {
      ...createMockDb(),
      async all<T>(sql: string, _params?: unknown[]): Promise<T[]> {
        if (sql.includes('SELECT')) {
          return [{
            id: 'new-ws-session',
            title: 'New Workspace Session',
            mode: 'ask',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            messages_json: '[]',
          }] as T[];
        }
        return [];
      },
    };

    const service = new ChatService(agentService, modeService, lmService, newDb);
    service.createSession(); // old session
    expect(service.getSessions()).toHaveLength(1);

    await service.resetForWorkspaceSwitch();

    // No restore during reset.
    expect(service.getSessions()).toHaveLength(0);

    // Restore runs later after DB rebind in workbench flow.
    await service.restoreSessions();
    const sessions = service.getSessions();
    expect(sessions.some((s) => s.id === 'new-ws-session')).toBe(true);
  });

  it('stamps new sessions with current workspace scope', () => {
    chatService.setWorkspaceScope('workspace-abc');
    const session = chatService.createSession();
    expect(session.workspaceId).toBe('workspace-abc');
  });

  it('restores only sessions from current workspace scope', async () => {
    const scopedDb: IChatPersistenceDatabase = {
      ...createMockDb(),
      async all<T>(sql: string, params?: unknown[]): Promise<T[]> {
        if (sql.includes('FROM chat_sessions')) {
          const scope = (params?.[0] as string) ?? '';
          if (scope === 'ws-new') {
            return [{
              id: 'session-new',
              workspace_id: 'ws-new',
              title: 'Scoped Session',
              mode: 'ask',
              model_id: '',
              created_at: Date.now(),
              updated_at: Date.now(),
            }] as T[];
          }
          return [];
        }
        return [];
      },
    };

    const service = new ChatService(agentService, modeService, lmService, scopedDb);
    service.setWorkspaceScope('ws-new');
    await service.restoreSessions();

    const sessions = service.getSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('session-new');
    expect(sessions[0].workspaceId).toBe('ws-new');
  });
});
