import { describe, expect, it, vi } from 'vitest';
import { ChatDataService } from '../../src/built-in/chat/data/chatDataService';

function createDataService(overrides: Partial<any> = {}) {
  const memoryService = {
    evictStaleContent: vi.fn(async () => ({ memoriesEvicted: 0, conceptsEvicted: 0 })),
    storeMemory: vi.fn(async () => {}),
    recallMemories: vi.fn(async () => []),
    getAllMemories: vi.fn(async () => []),
    extractAndStorePreferences: vi.fn(async () => []),
    getPreferences: vi.fn(async () => []),
    formatMemoryContext: vi.fn(() => '[Conversation Memory]\n---\nPrevious session (2026-03-12T00:00:00.000Z):\nLegacy DB memory'),
  };

  const retrievalService = {
    retrieve: vi.fn(async () => []),
  };

  const fsAccessor = {
    readdir: vi.fn(async () => []),
    readFile: vi.fn(async () => ''),
    exists: vi.fn(async () => false),
    isRichDocument: vi.fn(() => false),
    readDocumentText: vi.fn(async () => ''),
    workspaceRootName: 'Test Workspace',
  };

  const workspaceMemoryService = {
    appendSessionSummary: vi.fn(async () => {}),
    syncPreferences: vi.fn(async () => {}),
    upsertPreferences: vi.fn(async () => {}),
    upsertConcepts: vi.fn(async () => {}),
    searchConcepts: vi.fn(async () => []),
    getPreferencesPromptBlock: vi.fn(async () => undefined),
    getDurableMemoryRelativePath: vi.fn(() => '.parallx/memory/MEMORY.md'),
    hasSessionSummary: vi.fn(async () => false),
    getSessionSummaryMessageCount: vi.fn(async () => null),
  };

  const canonicalMemorySearchService = {
    search: vi.fn(async () => []),
  };

  const chatService = {
    getSession: vi.fn(() => undefined),
    getSessions: vi.fn(() => []),
  };

  const service = new ChatDataService({
    databaseService: undefined,
    fileService: undefined,
    workspaceService: undefined,
    editorService: undefined,
    retrievalService: retrievalService as any,
    indexingPipelineService: undefined,
    memoryService: memoryService as any,
    workspaceMemoryService: workspaceMemoryService as any,
    canonicalMemorySearchService: canonicalMemorySearchService as any,
    languageModelsService: { getActiveModel: vi.fn(() => 'gpt-oss:20b') } as any,
    languageModelToolsService: undefined,
    chatService: chatService as any,
    modeService: undefined as any,
    ollamaProvider: { sendChatRequest: vi.fn() } as any,
    promptFileService: {} as any,
    fsAccessor: fsAccessor as any,
    textFileModelManager: undefined,
    maxIterations: 10,
    networkTimeout: 60_000,
    getActiveWidget: () => undefined,
    ...overrides,
  });

  return {
    service,
    memoryService,
    retrievalService,
    fsAccessor,
    workspaceMemoryService,
    canonicalMemorySearchService,
    chatService,
  };
}

describe('ChatDataService.recallMemories', () => {
  it('prefers canonical .parallx/memory retrieval over legacy DB memory', async () => {
    const harness = createDataService();
    harness.canonicalMemorySearchService.search.mockResolvedValueOnce([
      {
        sourceId: '.parallx/memory/MEMORY.md',
        contextPrefix: 'Durable memory',
        text: 'Technical answer preference: structured brevity.',
        score: 0.93,
        layer: 'durable',
      },
    ]);

    const result = await harness.service.recallMemories('What do you remember about answer preferences?');

    expect(harness.canonicalMemorySearchService.search).toHaveBeenCalledWith(
      'What do you remember about answer preferences?',
      { layer: 'durable', date: undefined },
    );
    expect(result).toContain('[Conversation Memory]');
    expect(result).toContain('Durable memory:');
    expect(result).toContain('structured brevity');
    expect(harness.memoryService.recallMemories).not.toHaveBeenCalled();
  });

  it('falls back to the latest daily memory file for prior-conversation recall', async () => {
    const harness = createDataService();
    harness.canonicalMemorySearchService.search.mockResolvedValueOnce([]);
    harness.fsAccessor.readdir.mockResolvedValueOnce([
      { name: '2026-03-11.md', type: 'file', size: 100 },
      { name: '2026-03-12.md', type: 'file', size: 120 },
      { name: 'MEMORY.md', type: 'file', size: 80 },
    ]);
    harness.fsAccessor.readFile.mockResolvedValueOnce('# 2026-03-12\n\n- Today\'s codename is ember-rail.');

    const result = await harness.service.recallMemories('What do you remember about our previous conversation?');

    expect(harness.canonicalMemorySearchService.search).toHaveBeenCalledWith(
      'What do you remember about our previous conversation?',
      { layer: 'daily', date: undefined },
    );
    expect(result).toContain('[Conversation Memory]');
    expect(result).toContain('Daily memory (2026-03-12):');
    expect(result).toContain('ember-rail');
    expect(harness.memoryService.recallMemories).not.toHaveBeenCalled();
  });

  it('loads an explicitly dated daily memory file for canonical recall', async () => {
    const harness = createDataService();
    harness.canonicalMemorySearchService.search.mockResolvedValueOnce([]);
    harness.fsAccessor.exists.mockResolvedValueOnce(true);
    harness.fsAccessor.readFile.mockResolvedValueOnce('# 2026-03-11\n\n- Vendor escalation happened here.');

    const result = await harness.service.recallMemories('What happened on 2026-03-11?');

    expect(harness.canonicalMemorySearchService.search).toHaveBeenCalledWith(
      'What happened on 2026-03-11?',
      { layer: 'daily', date: '2026-03-11' },
    );
    expect(result).toContain('Daily memory (2026-03-11):');
    expect(result).toContain('Vendor escalation happened here.');
  });

  it('falls back to legacy DB memory when canonical memory has no result', async () => {
    const harness = createDataService({ workspaceMemoryService: undefined });
    harness.canonicalMemorySearchService.search.mockResolvedValueOnce([]);
    harness.memoryService.recallMemories.mockResolvedValueOnce([
      { sessionId: 's1', summary: 'Legacy database memory', createdAt: '2026-03-12T00:00:00.000Z', lastAccessed: '2026-03-12T00:00:00.000Z', importance: 0.5, decayScore: 1, messageCount: 4 },
    ]);

    const result = await harness.service.recallMemories('legacy fallback query');

    expect(harness.memoryService.recallMemories).toHaveBeenCalledWith('legacy fallback query');
    expect(result).toContain('Legacy DB memory');
  });

  it('prefers canonical memory over recent-session summary for explicit recall turns', async () => {
    const harness = createDataService({
      chatService: {
        getSession: vi.fn(() => ({ id: 'current', createdAt: 20 })),
        getSessions: vi.fn(() => [
          {
            id: 'older',
            createdAt: 10,
            messages: [
              { request: { text: 'What was today\'s migration spike codename from memory?' } },
            ],
          },
        ]),
      },
    });
    harness.canonicalMemorySearchService.search.mockResolvedValueOnce([
      {
        sourceId: '.parallx/memory/2026-03-12.md',
        contextPrefix: 'Daily memory',
        text: 'Today\'s migration spike codename is ember-rail.',
        score: 0.91,
        layer: 'daily',
      },
      {
        sourceId: '.parallx/memory/MEMORY.md',
        contextPrefix: 'Durable memory',
        text: 'Technical answer preference: structured brevity.',
        score: 0.88,
        layer: 'durable',
      },
    ]);

    const result = await harness.service.recallMemories('What do you remember about today\'s migration spike and my durable answer preference?', 'current');

    expect(result).toContain('ember-rail');
    expect(result).toContain('structured brevity');
    expect(result).not.toContain('What was today\'s migration spike codename from memory?');
  });

  it('loads durable and latest daily canonical memory directly for explicit recall when retrieval misses', async () => {
    const harness = createDataService();
    harness.canonicalMemorySearchService.search.mockResolvedValueOnce([]);
    harness.fsAccessor.exists.mockResolvedValueOnce(true);
    harness.fsAccessor.readdir.mockResolvedValueOnce([
      { name: '2026-03-12.md', type: 'file', size: 120 },
      { name: 'MEMORY.md', type: 'file', size: 80 },
    ]);
    harness.fsAccessor.readFile
      .mockResolvedValueOnce('# Durable Memory\n\nTechnical answer preference: structured brevity.')
      .mockResolvedValueOnce('# 2026-03-12\n\nToday\'s migration spike codename is ember-rail.');

    const result = await harness.service.recallMemories('What do you remember about our previous conversation and my durable preference?');

    expect(result).toContain('Durable memory:');
    expect(result).toContain('Daily memory (2026-03-12):');
    expect(result).toContain('structured brevity');
    expect(result).toContain('ember-rail');
  });

  it('writes session summaries to canonical daily memory before legacy DB storage', async () => {
    const harness = createDataService();

    await harness.service.storeSessionMemory('session-42', 'Captured a canonical summary.', 5);

    expect(harness.workspaceMemoryService.appendSessionSummary).toHaveBeenCalledWith('session-42', 'Captured a canonical summary.', 5);
    expect(harness.memoryService.storeMemory).not.toHaveBeenCalled();
  });

  it('syncs extracted preferences into durable canonical memory', async () => {
    const harness = createDataService();
    await harness.service.extractPreferences('I prefer structured brevity for technical answers.');

    expect(harness.workspaceMemoryService.upsertPreferences).toHaveBeenCalledWith([
      { key: 'preference_structured_brevity_for', value: 'structured brevity for technical answers' },
    ]);
    expect(harness.memoryService.extractAndStorePreferences).not.toHaveBeenCalled();
  });

  it('prefers canonical durable markdown preferences for prompt injection', async () => {
    const harness = createDataService();
    harness.workspaceMemoryService.getPreferencesPromptBlock.mockResolvedValueOnce(
      'User preferences (learned from past conversations):\n- answer-style: structured brevity',
    );

    const result = await harness.service.getPreferencesForPrompt();

    expect(result).toContain('structured brevity');
    expect(harness.memoryService.getPreferences).not.toHaveBeenCalled();
  });

  it('uses canonical workspace memory for session summary metadata', async () => {
    const harness = createDataService();
    harness.workspaceMemoryService.hasSessionSummary.mockResolvedValueOnce(true);
    harness.workspaceMemoryService.getSessionSummaryMessageCount.mockResolvedValueOnce(9);

    await expect(harness.service.hasSessionMemory('session-1')).resolves.toBe(true);
    await expect(harness.service.getSessionMemoryMessageCount('session-1')).resolves.toBe(9);
    expect(harness.memoryService.hasMemory).toBeUndefined();
    expect(harness.memoryService.getMemoryMessageCount).toBeUndefined();
  });

  it('does not fall back to legacy DB memories once canonical workspace memory is present', async () => {
    const harness = createDataService();
    harness.canonicalMemorySearchService.search.mockResolvedValueOnce([]);
    harness.fsAccessor.exists.mockResolvedValueOnce(false);
    harness.fsAccessor.readdir.mockResolvedValueOnce([]);

    const result = await harness.service.recallMemories('legacy fallback query');

    expect(result).toBeUndefined();
    expect(harness.memoryService.recallMemories).not.toHaveBeenCalled();
  });

  it('stores concepts in canonical workspace memory during normal runtime', async () => {
    const harness = createDataService();

    await harness.service.storeConceptsFromSession([
      { concept: 'Coverage reasoning', category: 'insurance', summary: 'Applied coverage rules.', struggled: true },
    ], 'session-1');

    expect(harness.workspaceMemoryService.upsertConcepts).toHaveBeenCalledWith([
      {
        concept: 'Coverage reasoning',
        category: 'insurance',
        summary: 'Applied coverage rules.',
        encounterCount: 1,
        masteryLevel: 0,
        struggleCount: 1,
      },
    ]);
  });

  it('recalls concepts from canonical workspace memory during normal runtime', async () => {
    const harness = createDataService();
    harness.workspaceMemoryService.searchConcepts.mockResolvedValueOnce([
      {
        concept: 'Coverage reasoning',
        category: 'insurance',
        summary: 'Applied coverage rules.',
        encounterCount: 2,
        masteryLevel: 0.4,
        struggleCount: 1,
      },
    ]);

    const result = await harness.service.recallConcepts('policy coverage');

    expect(result).toContain('[Prior knowledge');
    expect(result).toContain('Coverage reasoning');
    expect(result).toContain('struggles noted');
    expect(harness.memoryService.recallConcepts).toBeUndefined();
  });
});