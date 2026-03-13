import { describe, expect, it } from 'vitest';
import { Emitter } from '../../src/platform/events';
import { URI } from '../../src/platform/uri';
import { WorkspaceService } from '../../src/services/workspaceService';
import { WorkspaceMemoryService } from '../../src/services/workspaceMemoryService';
import { Workspace } from '../../src/workspace/workspace';

function createWorkspaceService(rootPath: string): WorkspaceService {
  const workspace = Workspace.create('Test Workspace');
  workspace.addFolder(URI.file(rootPath), 'workspace');
  const onDidSwitchWorkspace = new Emitter<Workspace>();
  const service = new WorkspaceService();
  service.setHost({
    workspace,
    _workspaceSaver: {
      save: async () => {},
      requestSave: () => {},
    },
    createWorkspace: async () => workspace,
    switchWorkspace: async () => {},
    getRecentWorkspaces: async () => [],
    removeRecentWorkspace: async () => {},
    onDidSwitchWorkspace: onDidSwitchWorkspace.event,
  });
  return service;
}

function createFileServiceMock() {
  const files = new Map<string, string>();
  const directories = new Set<string>();

  return {
    files,
    directories,
    service: {
      async readdir(uri: URI): Promise<Array<{ name: string }>> {
        const prefix = uri.fsPath.endsWith('/') ? uri.fsPath : `${uri.fsPath}/`;
        const names = new Set<string>();
        for (const filePath of files.keys()) {
          if (filePath.startsWith(prefix)) {
            const remainder = filePath.slice(prefix.length);
            if (remainder && !remainder.includes('/')) {
              names.add(remainder);
            }
          }
        }
        return Array.from(names).map((name) => ({ name }));
      },
      async exists(uri: URI): Promise<boolean> {
        return directories.has(uri.fsPath) || files.has(uri.fsPath);
      },
      async mkdir(uri: URI): Promise<void> {
        directories.add(uri.fsPath);
      },
      async readFile(uri: URI): Promise<{ content: string; encoding: string; size: number; mtime: number }> {
        const content = files.get(uri.fsPath);
        if (content === undefined) {
          throw new Error(`File not found: ${uri.fsPath}`);
        }
        return {
          content,
          encoding: 'utf8',
          size: content.length,
          mtime: 0,
        };
      },
      async writeFile(uri: URI, content: string): Promise<void> {
        files.set(uri.fsPath, content);
      },
    } as any,
  };
}

describe('WorkspaceMemoryService', () => {
  it('resolves canonical durable and daily memory paths under .parallx/memory', () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    expect(service.getDurableMemoryRelativePath()).toBe('.parallx/memory/MEMORY.md');
    expect(service.getDailyMemoryRelativePath(new Date('2026-03-12T08:00:00.000Z'))).toBe('.parallx/memory/2026-03-12.md');
    expect(service.durableMemoryUri?.fsPath).toBe('D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md');
    expect(service.getDailyMemoryUri(new Date('2026-03-12T08:00:00.000Z'))?.fsPath).toBe('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-12.md');
  });

  it('creates the memory scaffold and appends daily log entries', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.ensureScaffold();

    expect(fileService.directories.has('D:/AI/Parallx/demo-workspace/.parallx')).toBe(true);
    expect(fileService.directories.has('D:/AI/Parallx/demo-workspace/.parallx/memory')).toBe(true);
    expect(fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md')).toContain('# Durable Memory');

    await service.appendDailyMemory('Captured a durable implementation note.', new Date('2026-03-12T08:00:00.000Z'));
    await service.appendDailyMemory('Follow-up context for the same day.', new Date('2026-03-12T08:00:00.000Z'));

    const dailyLog = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-12.md');
    expect(dailyLog).toContain('# 2026-03-12');
    expect(dailyLog).toContain('Captured a durable implementation note.');
    expect(dailyLog).toContain('Follow-up context for the same day.');
  });

  it('appends structured session summaries to the daily log', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.appendSessionSummary('session-123', 'Discussed the canonical memory migration.', 6, new Date('2026-03-12T08:00:00.000Z'));

    const dailyLog = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-12.md');
    expect(dailyLog).toContain('## Session session-123');
    expect(dailyLog).toContain('- Message count: 6');
    expect(dailyLog).toContain('- Summary: Discussed the canonical memory migration.');
  });

  it('updates an existing session summary block instead of duplicating it', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.appendSessionSummary('session-123', 'Initial summary.', 3, new Date('2026-03-12T08:00:00.000Z'));
    await service.appendSessionSummary('session-123', 'Updated summary.', 5, new Date('2026-03-12T08:00:00.000Z'));

    const dailyLog = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-12.md')!;
    expect((dailyLog.match(/## Session session-123/g) ?? [])).toHaveLength(1);
    expect(dailyLog).toContain('- Message count: 5');
    expect(dailyLog).toContain('- Summary: Updated summary.');
    expect(dailyLog).not.toContain('- Summary: Initial summary.');
  });

  it('syncs durable preferences into a dedicated MEMORY.md section', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.ensureScaffold();
    await service.syncPreferences([
      { key: 'answer-style', value: 'structured brevity' },
      { key: 'planning', value: 'prefer concrete next steps' },
    ]);

    const durableMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md');
    expect(durableMemory).toContain('## Preferences');
    expect(durableMemory).toContain('- answer-style: structured brevity');
    expect(durableMemory).toContain('- planning: prefer concrete next steps');
  });

  it('reads a prompt-ready preferences block from durable memory', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.ensureScaffold();
    await service.syncPreferences([
      { key: 'answer-style', value: 'structured brevity' },
      { key: 'planning', value: 'prefer concrete next steps' },
    ]);

    const promptBlock = await service.getPreferencesPromptBlock();
    expect(promptBlock).toContain('User preferences (learned from past conversations):');
    expect(promptBlock).toContain('- answer-style: structured brevity');
    expect(promptBlock).toContain('- planning: prefer concrete next steps');
  });

  it('reads and upserts canonical durable preferences without DB state', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.syncPreferences([
      { key: 'answer-style', value: 'structured brevity' },
    ]);
    await service.upsertPreferences([
      { key: 'answer-style', value: 'concise structure' },
      { key: 'tool_preference_apply_patch', value: 'apply_patch for edits' },
    ]);

    const preferences = await service.readPreferences();
    expect(preferences).toEqual([
      { key: 'answer-style', value: 'concise structure' },
      { key: 'tool_preference_apply_patch', value: 'apply_patch for edits' },
    ]);
  });

  it('finds the daily markdown file that contains a session summary', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.appendSessionSummary('session-abc', 'Canonical session summary.', 4, new Date('2026-03-12T08:00:00.000Z'));

    const relativePath = await service.findSessionSummaryRelativePath('session-abc');
    expect(relativePath).toBe('.parallx/memory/2026-03-12.md');
  });

  it('reads canonical session-summary presence and message count from daily memory', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.appendSessionSummary('session-meta', 'Canonical summary.', 7, new Date('2026-03-12T08:00:00.000Z'));

    await expect(service.hasSessionSummary('session-meta')).resolves.toBe(true);
    await expect(service.getSessionSummaryMessageCount('session-meta')).resolves.toBe(7);
    await expect(service.hasSessionSummary('missing-session')).resolves.toBe(false);
    await expect(service.getSessionSummaryMessageCount('missing-session')).resolves.toBeNull();
  });

  it('imports legacy memories, preferences, and concepts into canonical markdown once', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    const result = await service.importLegacySnapshot({
      memories: [
        {
          sessionId: 'legacy-session',
          createdAt: '2026-03-11T12:00:00.000Z',
          messageCount: 4,
          summary: 'Imported legacy summary.',
        },
      ],
      preferences: [
        { key: 'answer-style', value: 'structured brevity' },
      ],
      concepts: [
        {
          concept: 'coverage reasoning',
          category: 'insurance',
          summary: 'User asked about policy coverage logic.',
          encounterCount: 3,
          masteryLevel: 0.6,
        },
      ],
    });

    expect(result).toEqual({ imported: true, reason: 'imported' });

    const durableMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md')!;
    const dailyMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-11.md')!;

    expect(durableMemory).toContain('## Preferences');
    expect(durableMemory).toContain('- answer-style: structured brevity');
    expect(durableMemory).toContain('## Concepts');
    expect(durableMemory).toContain('### coverage reasoning');
    expect(durableMemory).toContain('## Legacy Import');
    expect(durableMemory).toContain('Imported legacy DB snapshot: yes');
    expect(dailyMemory).toContain('## Session legacy-session');
    expect(dailyMemory).toContain('Imported legacy summary.');
  });

  it('reads, upserts, and searches canonical concepts from durable memory', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.upsertConcepts([
      {
        concept: 'Coverage reasoning',
        category: 'insurance',
        summary: 'User asked how policy coverage applies to incidents.',
        encounterCount: 1,
        masteryLevel: 0.2,
        struggleCount: 1,
      },
    ]);
    await service.upsertConcepts([
      {
        concept: 'Coverage reasoning',
        category: 'insurance',
        summary: 'User asked how policy coverage applies to multi-vehicle incidents.',
        encounterCount: 1,
        masteryLevel: 0.4,
        struggleCount: 0,
      },
      {
        concept: 'Deductible basics',
        category: 'insurance',
        summary: 'User reviewed deductible definitions.',
        encounterCount: 1,
        masteryLevel: 0.5,
        struggleCount: 0,
      },
    ]);

    const concepts = await service.readConcepts();
    expect(concepts).toHaveLength(2);
    expect(concepts.find((concept) => concept.concept === 'Coverage reasoning')).toEqual(
      expect.objectContaining({ encounterCount: 2, masteryLevel: 0.4, struggleCount: 1 }),
    );

    const searchResults = await service.searchConcepts('policy coverage incident');
    expect(searchResults[0].concept).toBe('Coverage reasoning');
  });

  it('does not import the same legacy snapshot twice once the marker exists', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.importLegacySnapshot({
      memories: [
        {
          sessionId: 'legacy-session',
          createdAt: '2026-03-11T12:00:00.000Z',
          messageCount: 4,
          summary: 'Imported legacy summary.',
        },
      ],
      preferences: [],
      concepts: [],
    });

    const result = await service.importLegacySnapshot({
      memories: [
        {
          sessionId: 'legacy-session',
          createdAt: '2026-03-11T12:00:00.000Z',
          messageCount: 4,
          summary: 'Should not duplicate.',
        },
      ],
      preferences: [{ key: 'duplicate', value: 'no' }],
      concepts: [],
    });

    expect(result).toEqual({ imported: false, reason: 'already-imported' });
    const dailyMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-11.md')!;
    expect((dailyMemory.match(/## Session legacy-session/g) ?? [])).toHaveLength(1);
    expect(dailyMemory).not.toContain('Should not duplicate.');
  });
});