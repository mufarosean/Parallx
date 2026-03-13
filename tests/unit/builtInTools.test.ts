// Unit tests for builtInTools — M9 Cap 6 Task 6.3

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBuiltInTools } from '../../src/built-in/chat/tools/builtInTools';
import type { IBuiltInToolDatabase } from '../../src/built-in/chat/tools/builtInTools';
import type { IBuiltInToolCanonicalMemorySearch, IBuiltInToolFileSystem, IBuiltInToolRetrieval } from '../../src/built-in/chat/chatTypes';
import type {
  ILanguageModelToolsService,
  IChatTool,
  ICancellationToken,
} from '../../src/services/chatTypes';

// ── Helpers ──

function createToken(cancelled = false): ICancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

function createMockDb(overrides: Partial<IBuiltInToolDatabase> = {}): IBuiltInToolDatabase {
  return {
    isOpen: true,
    get: vi.fn(async () => undefined),
    all: vi.fn(async () => []),
    run: vi.fn(async () => ({ changes: 1 })),
    ...overrides,
  };
}

function createMockToolsService(): ILanguageModelToolsService & { registeredTools: IChatTool[] } {
  const registeredTools: IChatTool[] = [];
  return {
    registeredTools,
    registerTool(tool: IChatTool) {
      registeredTools.push(tool);
      return { dispose: vi.fn() };
    },
    getTools: () => registeredTools,
    getTool: (name: string) => registeredTools.find(t => t.name === name),
    getToolDefinitions: () => [],
    invokeTool: vi.fn(async () => ({ content: '' })),
    onDidChangeTools: vi.fn(() => ({ dispose: vi.fn() })) as any,
    dispose: vi.fn(),
  };
}

function createMockFs(overrides: Partial<IBuiltInToolFileSystem> = {}): IBuiltInToolFileSystem {
  return {
    readdir: vi.fn(async () => []),
    readFile: vi.fn(async () => ''),
    exists: vi.fn(async () => false),
    isRichDocument: vi.fn(() => false),
    readDocumentText: vi.fn(async () => ''),
    workspaceRootName: 'Test Workspace',
    ...overrides,
  };
}

function createMockRetrieval(overrides: Partial<IBuiltInToolRetrieval> = {}): IBuiltInToolRetrieval {
  return {
    isReady: vi.fn(() => true),
    retrieve: vi.fn(async () => []),
    ...overrides,
  };
}

function createMockCanonicalMemorySearch(overrides: Partial<IBuiltInToolCanonicalMemorySearch> = {}): IBuiltInToolCanonicalMemorySearch {
  return {
    isReady: vi.fn(() => true),
    search: vi.fn(async () => []),
    ...overrides,
  };
}

// ── Tests ──

describe('registerBuiltInTools', () => {
  it('registers all 17 built-in tools', () => {
    const toolsService = createMockToolsService();
    const db = createMockDb();
    const fs = createMockFs();
    const retrieval = createMockRetrieval();
    const canonicalMemorySearch = createMockCanonicalMemorySearch();

    const disposables = registerBuiltInTools(toolsService, db, fs, undefined, retrieval, canonicalMemorySearch);

    expect(toolsService.registeredTools).toHaveLength(17);
    expect(disposables).toHaveLength(17);

    const names = toolsService.registeredTools.map(t => t.name).sort();
    expect(names).toEqual([
      'create_page',
      'delete_file',
      'edit_file',
      'get_page_properties',
      'list_files',
      'list_pages',
      'memory_get',
      'memory_search',
      'read_current_page',
      'read_file',
      'read_page',
      'read_page_by_title',
      'run_command',
      'search_files',
      'search_knowledge',
      'search_workspace',
      'write_file',
    ]);
  });

  it('read-only tools do not require confirmation', () => {
    const toolsService = createMockToolsService();
    const db = createMockDb();
    const fs = createMockFs();
    const retrieval = createMockRetrieval();
    const canonicalMemorySearch = createMockCanonicalMemorySearch();

    registerBuiltInTools(toolsService, db, fs, undefined, retrieval, canonicalMemorySearch);

    const readOnly = ['search_workspace', 'read_page', 'read_page_by_title', 'read_current_page', 'list_pages', 'get_page_properties', 'list_files', 'read_file', 'search_files', 'search_knowledge', 'memory_get', 'memory_search'];
    for (const name of readOnly) {
      const tool = toolsService.registeredTools.find(t => t.name === name);
      expect(tool?.requiresConfirmation, `${name} should not require confirmation`).toBe(false);
    }
  });

  it('create_page requires confirmation', () => {
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, createMockDb());

    const tool = toolsService.registeredTools.find(t => t.name === 'create_page');
    expect(tool?.requiresConfirmation).toBe(true);
  });
});

describe('search_workspace tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'search_workspace')!;
  });

  it('searches pages by query', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: '1', title: 'Project Notes', content: 'Some text about goals' },
    ]);

    const result = await tool.handler({ query: 'goals' }, createToken());
    expect(result.content).toContain('Project Notes');
    expect(result.content).toContain('1 page(s)');
    expect(db.all).toHaveBeenCalled();
  });

  it('returns error for empty query', async () => {
    const result = await tool.handler({ query: '' }, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('empty');
  });

  it('reports no results', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await tool.handler({ query: 'nonexistent' }, createToken());
    expect(result.content).toContain('No pages found');
  });
});

describe('read_page tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'read_page')!;
  });

  it('reads page content by ID', async () => {
    (db.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'abc', title: 'My Page', content: 'Hello world',
    });

    const result = await tool.handler({ pageId: 'abc' }, createToken());
    expect(result.content).toContain('My Page');
    expect(result.content).toContain('Hello world');
  });

  it('returns error for missing page', async () => {
    (db.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const result = await tool.handler({ pageId: 'missing' }, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('returns error when pageId not provided', async () => {
    const result = await tool.handler({}, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('pageId is required');
  });
});

describe('list_pages tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'list_pages')!;
  });

  it('lists pages with titles and IDs', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: '1', title: 'Page A', icon: '📝', updated_at: '2025-01-01' },
      { id: '2', title: 'Page B', icon: null, updated_at: '2025-01-02' },
    ]);

    const result = await tool.handler({}, createToken());
    expect(result.content).toContain('2 page(s)');
    expect(result.content).toContain('Page A');
    expect(result.content).toContain('Page B');
  });

  it('reports empty workspace', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await tool.handler({}, createToken());
    expect(result.content).toContain('No pages found');
  });
});

describe('get_page_properties tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'get_page_properties')!;
  });

  it('returns page metadata', async () => {
    (db.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: 'abc', title: 'My Page', icon: '📄', is_archived: 0,
        created_at: '2025-01-01', updated_at: '2025-01-02',
      })
      .mockResolvedValueOnce({ cnt: 5 });

    const result = await tool.handler({ pageId: 'abc' }, createToken());
    expect(result.content).toContain('My Page');
    expect(result.content).toContain('Blocks:** 5');
    expect(result.content).toContain('Archived:** No');
  });

  it('returns error for missing page', async () => {
    (db.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const result = await tool.handler({ pageId: 'gone' }, createToken());
    expect(result.isError).toBe(true);
  });
});

describe('create_page tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'create_page')!;
  });

  it('creates a page with title', async () => {
    const result = await tool.handler({ title: 'New Page' }, createToken());
    expect(result.content).toContain('Created page');
    expect(result.content).toContain('New Page');
    expect(db.run).toHaveBeenCalled();
  });

  it('returns error for empty title', async () => {
    const result = await tool.handler({ title: '' }, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Title is required');
  });

  it('passes content and icon to INSERT', async () => {
    await tool.handler({ title: 'With Content', content: 'Hello', icon: '🎉' }, createToken());
    const callArgs = (db.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[0]).toContain('INSERT INTO pages');
    expect(callArgs[1]).toEqual(expect.arrayContaining(['With Content', '🎉', 'Hello']));
  });
});

describe('built-in tools with no database', () => {
  it('all tools return error when db is undefined', async () => {
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, undefined);

    for (const tool of toolsService.registeredTools) {
      const result = await tool.handler({}, createToken()).catch((e: Error) => ({
        content: e.message,
        isError: true,
      }));
      expect(result.isError || result.content.includes('not available')).toBeTruthy();
    }
  });
});

describe('memory_get tool', () => {
  it('reads durable memory by default', async () => {
    const toolsService = createMockToolsService();
    const fs = createMockFs({
      exists: vi.fn(async (path: string) => path === '.parallx/memory/MEMORY.md'),
      readFile: vi.fn(async () => '# Durable Memory\n\nRemember this'),
    });

    registerBuiltInTools(toolsService, createMockDb(), fs, undefined, createMockRetrieval(), createMockCanonicalMemorySearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'memory_get')!;

    const result = await tool.handler({}, createToken());
    expect(result.content).toContain('.parallx/memory/MEMORY.md');
    expect(result.content).toContain('Remember this');
  });

  it('reads daily memory for a provided date', async () => {
    const toolsService = createMockToolsService();
    const fs = createMockFs({
      exists: vi.fn(async (path: string) => path === '.parallx/memory/2026-03-12.md'),
      readFile: vi.fn(async () => '# 2026-03-12\n\nDaily note'),
    });

    registerBuiltInTools(toolsService, createMockDb(), fs, undefined, createMockRetrieval(), createMockCanonicalMemorySearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'memory_get')!;

    const result = await tool.handler({ layer: 'daily', date: '2026-03-12' }, createToken());
    expect(result.content).toContain('.parallx/memory/2026-03-12.md');
    expect(result.content).toContain('Daily note');
  });
});

describe('memory_search tool', () => {
  it('filters retrieval results to canonical memory files', async () => {
    const toolsService = createMockToolsService();
    const canonicalMemorySearch = createMockCanonicalMemorySearch({
      search: vi.fn(async () => [
        {
          sourceId: '.parallx/memory/MEMORY.md',
          contextPrefix: 'Durable memory',
          text: 'The user prefers concise implementation notes.',
          score: 0.93,
          layer: 'durable',
        },
      ]),
    });

    registerBuiltInTools(toolsService, createMockDb(), createMockFs(), undefined, createMockRetrieval(), canonicalMemorySearch);
    const tool = toolsService.registeredTools.find(t => t.name === 'memory_search')!;

    const result = await tool.handler({ query: 'user preferences', layer: 'durable' }, createToken());
    expect(result.content).toContain('.parallx/memory/MEMORY.md');
    expect(result.content).toContain('concise implementation notes');
  });

  it('returns a friendly message when no memory results match', async () => {
    const toolsService = createMockToolsService();
    registerBuiltInTools(
      toolsService,
      createMockDb(),
      createMockFs(),
      undefined,
      createMockRetrieval({ retrieve: vi.fn(async () => []) }),
      createMockCanonicalMemorySearch({ search: vi.fn(async () => []) }),
    );
    const tool = toolsService.registeredTools.find(t => t.name === 'memory_search')!;

    const result = await tool.handler({ query: 'missing note' }, createToken());
    expect(result.content).toContain('No canonical memory results found');
  });
});
