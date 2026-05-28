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
      async delete(uri: URI): Promise<void> {
        files.delete(uri.fsPath);
        directories.delete(uri.fsPath);
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

  it('ensures today\'s daily memory file exists before opening it in the editor', async () => {
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    const relativePath = await service.ensureDailyMemory(new Date('2026-03-13T08:00:00.000Z'));

    expect(relativePath).toBe('.parallx/memory/2026-03-13.md');
    expect(fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-13.md')).toBe('# 2026-03-13\n');
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

  it('imports legacy memories and preferences into canonical markdown once', async () => {
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
    });

    expect(result).toEqual({ imported: true, reason: 'imported' });

    const durableMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md')!;
    const dailyMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-11.md')!;

    expect(durableMemory).toContain('## Preferences');
    expect(durableMemory).toContain('- answer-style: structured brevity');
    expect(durableMemory).toContain('## Legacy Import');
    expect(durableMemory).toContain('Imported legacy DB snapshot: yes');
    expect(dailyMemory).toContain('## Session legacy-session');
    expect(dailyMemory).toContain('Imported legacy summary.');
  });

  // M81 Phase 3 Stage 2 — `reads, upserts, and searches canonical concepts`
  // test removed alongside the concept methods. Agent-curated memory is
  // covered by tests/unit/memoryEditTool.test.ts.

  it('treats identical legacy snapshots as already imported once canonical entries are present', async () => {
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
    });

    const result = await service.importLegacySnapshot({
      memories: [
        {
          sessionId: 'legacy-session',
          createdAt: '2026-03-11T12:00:00.000Z',
          messageCount: 4,
          summary: 'Imported legacy summary.',
        },
      ],
      preferences: [],
    });

    expect(result).toEqual({ imported: false, reason: 'already-imported' });
    const dailyMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-11.md')!;
    expect((dailyMemory.match(/## Session legacy-session/g) ?? [])).toHaveLength(1);
    expect(dailyMemory).not.toContain('Should not duplicate.');
  });

  it('backfills missing canonical entries even when the legacy import marker already exists', async () => {
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
      preferences: [
        { key: 'answer-style', value: 'structured brevity' },
      ],
    });

    fileService.files.set(
      'D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md',
      '# Durable Memory\n\n## Legacy Import\n\n- Imported legacy DB snapshot: yes\n- Imported at: 2026-03-12T00:00:00.000Z\n',
    );
    fileService.files.delete('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-11.md');

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
    });

    expect(result).toEqual({ imported: true, reason: 'imported' });

    const durableMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md')!;
    const dailyMemory = fileService.files.get('D:/AI/Parallx/demo-workspace/.parallx/memory/2026-03-11.md')!;

    expect(durableMemory).toContain('## Preferences');
    expect(durableMemory).toContain('Imported legacy DB snapshot: yes');
    expect(durableMemory).toContain('Last normalized at:');
    expect(dailyMemory).toContain('## Session legacy-session');
  });
});

describe('M81 Phase 8 — lessons + index', () => {
  const WORKSPACE_ROOT = 'D:/AI/Parallx/demo-workspace';
  const MEMORY_FILE = `${WORKSPACE_ROOT}/.parallx/memory/MEMORY.md`;
  const LESSONS_DIR = `${WORKSPACE_ROOT}/.parallx/memory/lessons`;
  const ARCHIVE_LESSONS_DIR = `${WORKSPACE_ROOT}/.parallx/memory/_archive/lessons`;
  const ARCHIVE_LEGACY_CONCEPTS = `${WORKSPACE_ROOT}/.parallx/memory/_archive/pre-m81-concepts.md`;

  it('exposes lessons root + lesson file relative paths', () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    expect(service.getLessonsRootRelativePath()).toBe('.parallx/memory/lessons');
    expect(service.getLessonFileRelativePath('canvas-no-move')).toBe('.parallx/memory/lessons/canvas-no-move.md');
  });

  it('round-trips writeLessonFile and readLessonFile under lessons/', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.writeLessonFile('canvas-no-move', '# Canvas no move\n\nDetails.\n');

    expect(fileService.directories.has(LESSONS_DIR)).toBe(true);
    expect(fileService.files.get(`${LESSONS_DIR}/canvas-no-move.md`)).toContain('Details.');
    await expect(service.readLessonFile('canvas-no-move')).resolves.toContain('Details.');
    await expect(service.readLessonFile('missing-lesson')).resolves.toBe('');
  });

  it('rejects empty slugs on writeLessonFile / archiveLessonFile', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await expect(service.writeLessonFile('', 'body')).rejects.toThrow(/lesson slug is required/);
    await expect(service.writeLessonFile('   ', 'body')).rejects.toThrow(/lesson slug is required/);
    await expect(service.archiveLessonFile('')).rejects.toThrow(/lesson slug is required/);
  });

  it('listLessons returns slugs of files actually on disk', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await expect(service.listLessons()).resolves.toEqual([]);

    await service.writeLessonFile('alpha', 'body');
    await service.writeLessonFile('beta', 'body');
    // Non-markdown file in lessons dir should be ignored.
    fileService.files.set(`${LESSONS_DIR}/notes.txt`, 'plain');

    await expect(service.listLessons()).resolves.toEqual(['alpha', 'beta']);
  });

  it('addMemoryIndexEntry initializes a clean header and appends; replaces on re-add', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.addMemoryIndexEntry('canvas-no-move', 'canvas_set_page_property only sets metadata');

    let memory = fileService.files.get(MEMORY_FILE)!;
    expect(memory).toContain('# Memory Index');
    expect(memory).toContain('Long-term lessons. Each line points to a lesson file with the full');
    expect(memory).toContain('- [Canvas no move](lessons/canvas-no-move.md) — canvas_set_page_property only sets metadata');

    // Re-add same slug with new description must REPLACE the line, not duplicate.
    await service.addMemoryIndexEntry('canvas-no-move', 'updated description here');
    memory = fileService.files.get(MEMORY_FILE)!;
    const occurrences = memory.match(/lessons\/canvas-no-move\.md/g) ?? [];
    expect(occurrences).toHaveLength(1);
    expect(memory).toContain('— updated description here');
    expect(memory).not.toContain('canvas_set_page_property only sets metadata');

    // Adding a different slug appends.
    await service.addMemoryIndexEntry('ollama-tool-result-string', 'extensions returning MCP-shape arrays cause HTTP 400');
    memory = fileService.files.get(MEMORY_FILE)!;
    expect(memory).toContain('- [Canvas no move](lessons/canvas-no-move.md)');
    expect(memory).toContain('- [Ollama tool result string](lessons/ollama-tool-result-string.md)');
  });

  it('truncates descriptions over 120 chars in the index entry', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    const longDescription = 'x'.repeat(200);
    await service.addMemoryIndexEntry('long-one', longDescription);

    const memory = fileService.files.get(MEMORY_FILE)!;
    const match = memory.match(/— (x+)$/m);
    expect(match).not.toBeNull();
    expect(match![1].length).toBe(120);
  });

  it('parseMemoryIndex returns the entries previously added', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.addMemoryIndexEntry('alpha-slug', 'first description');
    await service.addMemoryIndexEntry('beta-slug', 'second description');

    const entries = await service.parseMemoryIndex();
    expect(entries).toEqual([
      { slug: 'alpha-slug', description: 'first description', path: 'lessons/alpha-slug.md' },
      { slug: 'beta-slug', description: 'second description', path: 'lessons/beta-slug.md' },
    ]);
  });

  it('removeMemoryIndexEntry removes the matching line and is a no-op when absent', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.addMemoryIndexEntry('alpha-slug', 'first');
    await service.addMemoryIndexEntry('beta-slug', 'second');

    await service.removeMemoryIndexEntry('alpha-slug');
    let entries = await service.parseMemoryIndex();
    expect(entries.map((entry) => entry.slug)).toEqual(['beta-slug']);

    // No-op when slug absent.
    const before = fileService.files.get(MEMORY_FILE);
    await service.removeMemoryIndexEntry('not-there');
    const after = fileService.files.get(MEMORY_FILE);
    expect(after).toBe(before);
  });

  it('archiveLessonFile moves the file to _archive/lessons/ and subsequent reads return ""', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.writeLessonFile('canvas-no-move', '# body\n');
    expect(fileService.files.has(`${LESSONS_DIR}/canvas-no-move.md`)).toBe(true);

    const result = await service.archiveLessonFile('canvas-no-move');
    expect(result).toBe(true);

    expect(fileService.files.has(`${LESSONS_DIR}/canvas-no-move.md`)).toBe(false);
    expect(fileService.files.get(`${ARCHIVE_LESSONS_DIR}/canvas-no-move.md`)).toContain('# body');
    await expect(service.readLessonFile('canvas-no-move')).resolves.toBe('');

    // Re-archiving (now absent) returns false.
    await expect(service.archiveLessonFile('canvas-no-move')).resolves.toBe(false);
  });

  it('archiveLegacyConceptSection moves a regex-style Concepts section to _archive/pre-m81-concepts.md', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    const legacyMemory = [
      '# Durable Memory',
      '',
      'Some intro text.',
      '',
      '## Concepts',
      '',
      '### Foo',
      '- Category: tool',
      '- Encounters: 4',
      '- Mastery: 0.5',
      '- Struggles: 2',
      '- Summary: foo summary',
      '',
      '### Bar',
      '- Category: pattern',
      '- Encounters: 9',
      '- Mastery: 0.8',
      '- Struggles: 1',
      '- Summary: bar summary',
      '',
      '## Other',
      '',
      'Keep me.',
      '',
    ].join('\n');
    await service.ensureScaffold();
    fileService.files.set(MEMORY_FILE, legacyMemory);

    const result = await service.archiveLegacyConceptSection();
    expect(result.archived).toBe(true);
    expect(result.movedChars).toBeGreaterThan(0);

    const archived = fileService.files.get(ARCHIVE_LEGACY_CONCEPTS)!;
    expect(archived).toMatch(/^<!-- Archived from MEMORY\.md ## Concepts section on \d{4}-\d{2}-\d{2} by M81 Phase 8\. -->/);
    expect(archived).toContain('### Foo');
    expect(archived).toContain('### Bar');

    const rewritten = fileService.files.get(MEMORY_FILE)!;
    expect(rewritten).toContain('# Durable Memory');
    expect(rewritten).toContain('## Other');
    expect(rewritten).toContain('Keep me.');
    expect(rewritten).not.toContain('## Concepts');
    expect(rewritten).not.toContain('### Foo');
  });

  it('archiveLegacyConceptSection is a no-op on a clean MEMORY.md', async () => {
    const workspaceService = createWorkspaceService(WORKSPACE_ROOT);
    const fileService = createFileServiceMock();
    const service = new WorkspaceMemoryService(fileService.service, workspaceService);

    await service.ensureScaffold();
    await service.addMemoryIndexEntry('alpha-slug', 'first');
    const before = fileService.files.get(MEMORY_FILE);

    const result = await service.archiveLegacyConceptSection();
    expect(result).toEqual({ archived: false, movedChars: 0 });
    expect(fileService.files.get(MEMORY_FILE)).toBe(before);
    expect(fileService.files.has(ARCHIVE_LEGACY_CONCEPTS)).toBe(false);
  });
});