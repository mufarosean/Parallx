import { describe, expect, it, vi } from 'vitest';

import { registerOpenclawParticipants } from '../../src/openclaw/registerOpenclawParticipants';
import {
  buildOpenclawDefaultParticipantServices,
  buildOpenclawWorkspaceParticipantServices,
  buildOpenclawCanvasParticipantServices,
} from '../../src/openclaw/openclawParticipantServices';
import type {
  IDefaultParticipantServices,
  IWorkspaceParticipantServices,
  ICanvasParticipantServices,
} from '../../src/openclaw/openclawTypes';
import type { IChatAgentService, IChatParticipant } from '../../src/services/chatTypes';

// ---------------------------------------------------------------------------
// Minimal service stubs
// ---------------------------------------------------------------------------

function stubDefaultServices(): IDefaultParticipantServices {
  return {
    sendChatRequest: vi.fn(),
    getActiveModel: vi.fn(() => 'test-model'),
    getWorkspaceName: vi.fn(() => 'test-ws'),
    getPageCount: vi.fn(async () => 0),
    getCurrentPageTitle: vi.fn(() => undefined),
    getToolDefinitions: vi.fn(() => []),
    getReadOnlyToolDefinitions: vi.fn(() => []),
  };
}

function stubWorkspaceServices(): IWorkspaceParticipantServices {
  return {
    sendChatRequest: vi.fn(),
    getActiveModel: vi.fn(() => 'test-model'),
    getWorkspaceName: vi.fn(() => 'test-ws'),
    listPages: vi.fn(async () => []),
    searchPages: vi.fn(async () => []),
    getPageContent: vi.fn(async () => ''),
    getPageTitle: vi.fn(async () => null),
  };
}

function stubCanvasServices(): ICanvasParticipantServices {
  return {
    sendChatRequest: vi.fn(),
    getActiveModel: vi.fn(() => 'test-model'),
    getWorkspaceName: vi.fn(() => 'test-ws'),
    getCurrentPageId: vi.fn(() => undefined),
    getCurrentPageTitle: vi.fn(() => undefined),
    getPageStructure: vi.fn(async () => ({ pageId: 'stub', title: 'Stub', blocks: [] })),
  };
}

function stubAgentService(): IChatAgentService {
  const agents: IChatParticipant[] = [];
  return {
    onDidChangeAgents: vi.fn(() => ({ dispose: vi.fn() })) as any,
    registerAgent: vi.fn((p: IChatParticipant) => {
      agents.push(p);
      return { dispose: vi.fn(() => { agents.splice(agents.indexOf(p), 1); }) };
    }),
    getAgents: vi.fn(() => agents),
    getAgent: vi.fn((id: string) => agents.find(a => a.id === id)),
    getDefaultAgent: vi.fn(() => agents.find(a => a.id.includes('default'))),
    invokeAgent: vi.fn(),
    dispose: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// registerOpenclawParticipants
// ---------------------------------------------------------------------------

describe('registerOpenclawParticipants', () => {
  it('returns 6 disposables (3 participants + 3 registrations)', () => {
    const result = registerOpenclawParticipants({
      agentService: stubAgentService(),
      defaultParticipantServices: stubDefaultServices(),
      workspaceParticipantServices: stubWorkspaceServices(),
      canvasParticipantServices: stubCanvasServices(),
    });
    expect(result).toHaveLength(6);
  });

  it('registers all 3 participants with agentService', () => {
    const agentService = stubAgentService();
    registerOpenclawParticipants({
      agentService,
      defaultParticipantServices: stubDefaultServices(),
      workspaceParticipantServices: stubWorkspaceServices(),
      canvasParticipantServices: stubCanvasServices(),
    });
    expect(agentService.registerAgent).toHaveBeenCalledTimes(3);
  });

  it('registered participants have correct IDs', () => {
    const agentService = stubAgentService();
    registerOpenclawParticipants({
      agentService,
      defaultParticipantServices: stubDefaultServices(),
      workspaceParticipantServices: stubWorkspaceServices(),
      canvasParticipantServices: stubCanvasServices(),
    });
    const calls = (agentService.registerAgent as ReturnType<typeof vi.fn>).mock.calls;
    const ids = calls.map((c: any) => c[0].id);
    expect(ids).toContain('parallx.chat.openclaw-default');
    expect(ids).toContain('parallx.chat.workspace');
    expect(ids).toContain('parallx.chat.canvas');
  });

  it('each participant is an IChatParticipant with handler', () => {
    const agentService = stubAgentService();
    const result = registerOpenclawParticipants({
      agentService,
      defaultParticipantServices: stubDefaultServices(),
      workspaceParticipantServices: stubWorkspaceServices(),
      canvasParticipantServices: stubCanvasServices(),
    });
    // Even-indexed items are participants (0, 2, 4)
    for (let i = 0; i < 6; i += 2) {
      const participant = result[i] as unknown as IChatParticipant;
      expect(participant.id).toBeDefined();
      expect(participant.handler).toBeTypeOf('function');
    }
  });

  it('disposing registrations works without error', () => {
    const result = registerOpenclawParticipants({
      agentService: stubAgentService(),
      defaultParticipantServices: stubDefaultServices(),
      workspaceParticipantServices: stubWorkspaceServices(),
      canvasParticipantServices: stubCanvasServices(),
    });
    for (const d of result) {
      expect(() => d.dispose()).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// Service builder functions
// ---------------------------------------------------------------------------

describe('buildOpenclawDefaultParticipantServices', () => {
  it('passes through all required fields', () => {
    const deps = stubDefaultServices();
    const result = buildOpenclawDefaultParticipantServices(deps);
    expect(result.sendChatRequest).toBe(deps.sendChatRequest);
    expect(result.getActiveModel).toBe(deps.getActiveModel);
    expect(result.getWorkspaceName).toBe(deps.getWorkspaceName);
    expect(result.getPageCount).toBe(deps.getPageCount);
    expect(result.getCurrentPageTitle).toBe(deps.getCurrentPageTitle);
    expect(result.getToolDefinitions).toBe(deps.getToolDefinitions);
    expect(result.getReadOnlyToolDefinitions).toBe(deps.getReadOnlyToolDefinitions);
  });

  it('passes through optional fields when provided', () => {
    const deps = {
      ...stubDefaultServices(),
      maxIterations: 5,
      networkTimeout: 30000,
      retrieveContext: vi.fn(),
      recallMemories: vi.fn(),
    };
    const result = buildOpenclawDefaultParticipantServices(deps);
    expect(result.maxIterations).toBe(5);
    expect(result.networkTimeout).toBe(30000);
    expect(result.retrieveContext).toBe(deps.retrieveContext);
    expect(result.recallMemories).toBe(deps.recallMemories);
  });

  it('optional fields are undefined when not provided', () => {
    const result = buildOpenclawDefaultParticipantServices(stubDefaultServices());
    expect(result.maxIterations).toBeUndefined();
    expect(result.retrieveContext).toBeUndefined();
    expect(result.recallMemories).toBeUndefined();
  });
});

describe('buildOpenclawWorkspaceParticipantServices', () => {
  it('passes through all required fields', () => {
    const deps = stubWorkspaceServices();
    const result = buildOpenclawWorkspaceParticipantServices(deps);
    expect(result.sendChatRequest).toBe(deps.sendChatRequest);
    expect(result.getActiveModel).toBe(deps.getActiveModel);
    expect(result.getWorkspaceName).toBe(deps.getWorkspaceName);
    expect(result.listPages).toBe(deps.listPages);
    expect(result.searchPages).toBe(deps.searchPages);
    expect(result.getPageContent).toBe(deps.getPageContent);
    expect(result.getPageTitle).toBe(deps.getPageTitle);
  });

  it('passes through optional fields when provided', () => {
    const deps = {
      ...stubWorkspaceServices(),
      listFiles: vi.fn(),
      readFileContent: vi.fn(),
      reportParticipantDebug: vi.fn(),
    };
    const result = buildOpenclawWorkspaceParticipantServices(deps);
    expect(result.listFiles).toBe(deps.listFiles);
    expect(result.readFileContent).toBe(deps.readFileContent);
    expect(result.reportParticipantDebug).toBe(deps.reportParticipantDebug);
  });
});

describe('buildOpenclawCanvasParticipantServices', () => {
  it('passes through all required fields', () => {
    const deps = stubCanvasServices();
    const result = buildOpenclawCanvasParticipantServices(deps);
    expect(result.sendChatRequest).toBe(deps.sendChatRequest);
    expect(result.getActiveModel).toBe(deps.getActiveModel);
    expect(result.getWorkspaceName).toBe(deps.getWorkspaceName);
    expect(result.getCurrentPageId).toBe(deps.getCurrentPageId);
    expect(result.getCurrentPageTitle).toBe(deps.getCurrentPageTitle);
    expect(result.getPageStructure).toBe(deps.getPageStructure);
  });

  it('passes through optional fields when provided', () => {
    const deps = {
      ...stubCanvasServices(),
      readFileContent: vi.fn(),
      reportParticipantDebug: vi.fn(),
      reportRetrievalDebug: vi.fn(),
    };
    const result = buildOpenclawCanvasParticipantServices(deps);
    expect(result.readFileContent).toBe(deps.readFileContent);
    expect(result.reportParticipantDebug).toBe(deps.reportParticipantDebug);
    expect(result.reportRetrievalDebug).toBe(deps.reportRetrievalDebug);
  });
});
