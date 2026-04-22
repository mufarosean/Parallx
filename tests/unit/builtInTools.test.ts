// Unit tests for builtInTools — M9 Cap 6 Task 6.3

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBuiltInTools } from '../../src/built-in/chat/tools/builtInTools';
import type { IBuiltInToolDatabase } from '../../src/built-in/chat/tools/builtInTools';
import type { IBuiltInToolCanonicalMemorySearch, IBuiltInToolFileSystem, IBuiltInToolRetrieval, IBuiltInToolTranscriptSearch } from '../../src/built-in/chat/chatTypes';
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
    readFileContent: vi.fn(async () => ({ content: '', type: 'text' as const, totalChars: 0 })),
    exists: vi.fn(async () => false),
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

function createMockTranscriptSearch(overrides: Partial<IBuiltInToolTranscriptSearch> = {}): IBuiltInToolTranscriptSearch {
  return {
    isEnabled: vi.fn(() => false),
    isReady: vi.fn(() => true),
    search: vi.fn(async () => []),
    ...overrides,
  };
}

// ── Tests ──

describe('registerBuiltInTools', () => {
  it('registers all 19 built-in tools', () => {
    const toolsService = createMockToolsService();
    const db = createMockDb();
    const fs = createMockFs();
    const retrieval = createMockRetrieval();
    const canonicalMemorySearch = createMockCanonicalMemorySearch();
    const transcriptSearch = createMockTranscriptSearch();

    const disposables = registerBuiltInTools(toolsService, db, fs, undefined, retrieval, canonicalMemorySearch, transcriptSearch);

    // M58 W6: surface_send + surface_list bring the total to 24.
    // M58 W4: 8 cron tools bring the total to 32.
    // M58 W5: sessions_spawn brings the total to 33.
    expect(toolsService.registeredTools).toHaveLength(33);
    expect(disposables).toHaveLength(33);

    const names = toolsService.registeredTools.map(t => t.name).sort();
    expect(names).toEqual([
      'create_page',
      'cron_add',
      'cron_list',
      'cron_remove',
      'cron_run',
      'cron_runs',
      'cron_status',
      'cron_update',
      'cron_wake',
      'delete_file',
      'edit_file',
      'find_pages_by_property',
      'get_page_properties',
      'grep_search',
      'list_files',
      'list_pages',
      'list_property_definitions',
      'memory_get',
      'memory_search',
      'read_current_page',
      'read_file',
      'read_page',
      'run_command',
      'search_files',
      'search_knowledge',
      'search_workspace',
      'sessions_spawn',
      'set_page_property',
      'surface_list',
      'surface_send',
      'transcript_get',
      'transcript_search',
      'write_file',
    ]);
  });

  it('read-only tools do not require confirmation', () => {
    const toolsService = createMockToolsService();
    const db = createMockDb();
    const fs = createMockFs();
    const retrieval = createMockRetrieval();
    const canonicalMemorySearch = createMockCanonicalMemorySearch();
    const transcriptSearch = createMockTranscriptSearch();

    registerBuiltInTools(toolsService, db, fs, undefined, retrieval, canonicalMemorySearch, transcriptSearch);

    const readOnly = ['search_workspace', 'read_page', 'read_current_page', 'list_pages', 'get_page_properties', 'list_files', 'read_file', 'search_files', 'grep_search', 'search_knowledge', 'memory_get', 'memory_search', 'transcript_get', 'transcript_search', 'list_property_definitions', 'find_pages_by_property'];
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

  it('set_page_property requires confirmation', () => {
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, createMockDb());

    const tool = toolsService.registeredTools.find(t => t.name === 'set_page_property');
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

describe('transcript tools', () => {
  it('transcript_get renders a readable transcript instead of raw jsonl', async () => {
    const toolsService = createMockToolsService();
    const fs = createMockFs({
      exists: vi.fn(async (path: string) => path === '.parallx/sessions/session-1.jsonl'),
      readFileContent: vi.fn(async () => {
        const c = [
          JSON.stringify({ type: 'session', sessionId: 'session-1' }),
          JSON.stringify({ type: 'message', timestamp: '2026-03-13T12:00:00.000Z', message: { role: 'user', content: [{ type: 'text', text: 'Hello there' }] } }),
          JSON.stringify({ type: 'message', timestamp: '2026-03-13T12:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'Hi back' }] } }),
        ].join('\n');
        return { content: c, type: 'text' as const, totalChars: c.length };
      }),
    });

    registerBuiltInTools(toolsService, createMockDb(), fs, undefined, createMockRetrieval(), createMockCanonicalMemorySearch(), createMockTranscriptSearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'transcript_get')!;

    const result = await tool.handler({ sessionId: 'session-1' }, createToken());
    expect(result.content).toContain('User');
    expect(result.content).toContain('Hello there');
    expect(result.content).toContain('Assistant');
    expect(result.content).toContain('Hi back');
    expect(result.content).not.toContain('"type":"message"');
  });

  it('transcript_search reports disabled state until transcript indexing is enabled', async () => {
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, createMockDb(), createMockFs(), undefined, createMockRetrieval(), createMockCanonicalMemorySearch(), createMockTranscriptSearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'transcript_search')!;

    const result = await tool.handler({ query: 'hello' }, createToken());
    expect(result.content).toContain('Transcript search is disabled');
  });

  it('transcript_search returns formatted transcript matches when enabled', async () => {
    const toolsService = createMockToolsService();
    const transcriptSearch = createMockTranscriptSearch({
      isEnabled: vi.fn(() => true),
      search: vi.fn(async () => [{
        sourceId: '.parallx/sessions/session-1.jsonl',
        contextPrefix: '[Source: ".parallx/sessions/session-1.jsonl"]',
        text: 'User: Hello there\nAssistant: Hi back',
        score: 0.91,
        sessionId: 'session-1',
      }]),
    });
    registerBuiltInTools(toolsService, createMockDb(), createMockFs(), undefined, createMockRetrieval(), createMockCanonicalMemorySearch(), transcriptSearch);
    const tool = toolsService.registeredTools.find(t => t.name === 'transcript_search')!;

    const result = await tool.handler({ query: 'hello there' }, createToken());
    expect(result.content).toContain('session-1');
    expect(result.content).toContain('User: Hello there');
    expect(result.content).toContain('Score: 0.910');
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
  it('db-backed tools return an error when db is undefined', async () => {
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, undefined);

    const dbBackedToolNames = new Set([
      'search_workspace',
      'read_page',
      'read_current_page',
      'list_pages',
      'get_page_properties',
      'create_page',
      'list_property_definitions',
      'set_page_property',
      'find_pages_by_property',
    ]);

    for (const tool of toolsService.registeredTools) {
      if (!dbBackedToolNames.has(tool.name)) {
        continue;
      }
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
      readFileContent: vi.fn(async () => ({ content: '# Durable Memory\n\nRemember this', type: 'text' as const, totalChars: 33 })),
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
      readFileContent: vi.fn(async () => ({ content: '# 2026-03-12\n\nDaily note', type: 'text' as const, totalChars: 25 })),
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

describe('search_knowledge tool', () => {
  it('passes folder_path as pathPrefixes to the retrieval function', async () => {
    const retrieval = createMockRetrieval({
      retrieve: vi.fn(async () => [
        { sourceType: 'file_chunk', sourceId: 'RF Guides/doc1.md', contextPrefix: 'RF Guides', text: 'scoped result', score: 0.8 },
      ]),
    });
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, createMockDb(), createMockFs(), undefined, retrieval, createMockCanonicalMemorySearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'search_knowledge')!;

    const result = await tool.handler({ query: 'test query', folder_path: 'RF Guides' }, createToken());

    expect(retrieval.retrieve).toHaveBeenCalledWith('test query', undefined, ['RF Guides/']);
    expect(result.content).toContain('scoped result');
  });

  it('omits pathPrefixes when folder_path is not provided', async () => {
    const retrieval = createMockRetrieval({
      retrieve: vi.fn(async () => [
        { sourceType: 'page_block', sourceId: 'p1', contextPrefix: 'Overview', text: 'global result', score: 0.7 },
      ]),
    });
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, createMockDb(), createMockFs(), undefined, retrieval, createMockCanonicalMemorySearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'search_knowledge')!;

    await tool.handler({ query: 'test query' }, createToken());

    expect(retrieval.retrieve).toHaveBeenCalledWith('test query', undefined, undefined);
  });
});

// ── Property tools (M55 Domain 4) ──

describe('get_page_properties tool (enhanced with custom properties)', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'get_page_properties')!;
  });

  it('includes custom properties in output', async () => {
    (db.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: 'p1', title: 'Test Page', icon: null, is_archived: 0,
        created_at: '2025-01-01', updated_at: '2025-01-02',
      })
      .mockResolvedValueOnce({ cnt: 3 });
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { key: 'status', value_type: 'select', value: '"active"', def_type: 'select' },
      { key: 'tags', value_type: 'tags', value: '["alpha","beta"]', def_type: 'tags' },
      { key: 'done', value_type: 'checkbox', value: 'true', def_type: 'checkbox' },
    ]);

    const result = await tool.handler({ pageId: 'p1' }, createToken());
    expect(result.content).toContain('Custom Properties');
    expect(result.content).toContain('**status** (select): active');
    expect(result.content).toContain('**tags** (tags): alpha, beta');
    expect(result.content).toContain('**done** (checkbox): Yes');
  });

  it('omits custom properties section when page has none', async () => {
    (db.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: 'p1', title: 'Empty Page', icon: null, is_archived: 0,
        created_at: '2025-01-01', updated_at: '2025-01-02',
      })
      .mockResolvedValueOnce({ cnt: 0 });
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);

    const result = await tool.handler({ pageId: 'p1' }, createToken());
    expect(result.content).not.toContain('Custom Properties');
  });
});

describe('list_property_definitions tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'list_property_definitions')!;
  });

  it('lists all property definitions', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { name: 'tags', type: 'tags', config: '{}', sort_order: 0, created_at: '2025-01-01', updated_at: '2025-01-01' },
      { name: 'status', type: 'select', config: '{"options":[{"value":"active","color":"green"}]}', sort_order: 1, created_at: '2025-01-01', updated_at: '2025-01-01' },
    ]);

    const result = await tool.handler({}, createToken());
    expect(result.content).toContain('2 property definition(s)');
    expect(result.content).toContain('**tags** (tags)');
    expect(result.content).toContain('**status** (select)');
    expect(result.content).toContain('config:');
  });

  it('returns message when no definitions exist', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await tool.handler({}, createToken());
    expect(result.content).toContain('No property definitions found');
  });
});

describe('set_page_property tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'set_page_property')!;
  });

  it('sets a property on an existing page with existing definition', async () => {
    (db.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'p1', title: 'My Page' }) // page lookup
      .mockResolvedValueOnce({ name: 'status', type: 'select' }); // definition lookup

    const result = await tool.handler({ pageId: 'p1', propertyName: 'status', value: 'active' }, createToken());
    expect(result.content).toContain("Set property 'status'");
    expect(result.content).toContain('"active"');
    expect(result.content).toContain('My Page');
    expect(db.run).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO page_properties'),
      expect.arrayContaining(['p1', 'status', 'select', '"active"']),
    );
  });

  it('auto-creates property definition when it does not exist', async () => {
    (db.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'p1', title: 'My Page' }) // page lookup
      .mockResolvedValueOnce(undefined); // definition doesn't exist

    await tool.handler({ pageId: 'p1', propertyName: 'priority', value: 5 }, createToken());

    // First run call = INSERT INTO property_definitions
    const defCall = (db.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(defCall[0]).toContain('INSERT INTO property_definitions');
    expect(defCall[1]).toEqual(expect.arrayContaining(['priority', 'number']));

    // Second run call = INSERT INTO page_properties
    const propCall = (db.run as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(propCall[0]).toContain('INSERT INTO page_properties');
    expect(propCall[1]).toEqual(expect.arrayContaining(['p1', 'priority', 'number', '5']));
  });

  it('infers checkbox type for boolean values', async () => {
    (db.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'p1', title: 'My Page' })
      .mockResolvedValueOnce(undefined);

    await tool.handler({ pageId: 'p1', propertyName: 'done', value: true }, createToken());

    const defCall = (db.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(defCall[1]).toEqual(expect.arrayContaining(['done', 'checkbox']));
  });

  it('infers tags type for array values', async () => {
    (db.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ id: 'p1', title: 'My Page' })
      .mockResolvedValueOnce(undefined);

    await tool.handler({ pageId: 'p1', propertyName: 'labels', value: ['alpha', 'beta'] }, createToken());

    const defCall = (db.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(defCall[1]).toEqual(expect.arrayContaining(['labels', 'tags']));
  });

  it('returns error for missing pageId', async () => {
    const result = await tool.handler({ propertyName: 'x', value: 1 }, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('pageId is required');
  });

  it('returns error when page not found', async () => {
    (db.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const result = await tool.handler({ pageId: 'gone', propertyName: 'x', value: 1 }, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });
});

describe('find_pages_by_property tool', () => {
  let tool: IChatTool;
  let db: IBuiltInToolDatabase;

  beforeEach(() => {
    db = createMockDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    tool = toolsService.registeredTools.find(t => t.name === 'find_pages_by_property')!;
  });

  it('finds pages with equals operator', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'p1', title: 'Page One', value: '"active"' },
    ]);

    const result = await tool.handler({ propertyName: 'status', operator: 'equals', value: 'active' }, createToken());
    expect(result.content).toContain('1 page(s)');
    expect(result.content).toContain('Page One');
    expect(db.all).toHaveBeenCalledWith(
      expect.stringContaining('pp.value = ?'),
      expect.arrayContaining(['status', '"active"']),
    );
  });

  it('finds pages with contains operator', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'p1', title: 'Tagged Page', value: '["alpha","beta"]' },
    ]);

    const result = await tool.handler({ propertyName: 'tags', operator: 'contains', value: 'alpha' }, createToken());
    expect(result.content).toContain('Tagged Page');
    expect(db.all).toHaveBeenCalledWith(
      expect.stringContaining('pp.value LIKE ?'),
      expect.arrayContaining(['tags', '%alpha%']),
    );
  });

  it('finds pages with is_not_empty operator', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'p1', title: 'Has Status', value: '"done"' },
    ]);

    const result = await tool.handler({ propertyName: 'status', operator: 'is_not_empty' }, createToken());
    expect(result.content).toContain('Has Status');
  });

  it('finds pages with greater_than operator', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: 'p1', title: 'High Priority', value: '10' },
    ]);

    const result = await tool.handler({ propertyName: 'priority', operator: 'greater_than', value: 5 }, createToken());
    expect(result.content).toContain('High Priority');
  });

  it('returns error for invalid operator', async () => {
    const result = await tool.handler({ propertyName: 'x', operator: 'invalid' }, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid operator');
  });

  it('returns no-results message', async () => {
    (db.all as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    const result = await tool.handler({ propertyName: 'status', operator: 'equals', value: 'nope' }, createToken());
    expect(result.content).toContain('No pages found');
  });

  it('returns error for missing propertyName', async () => {
    const result = await tool.handler({ operator: 'equals' }, createToken());
    expect(result.isError).toBe(true);
    expect(result.content).toContain('propertyName is required');
  });
});

describe('read_file tool (workspace tree)', () => {
  it('includes workspace tree and line count in read_file output', async () => {
    const toolsService = createMockToolsService();
    const fs = createMockFs({
      readdir: vi.fn(async (path: string) => {
        if (path === '.') {
          return [
            { name: 'src', type: 'directory' as const, size: 0 },
            { name: 'README.md', type: 'file' as const, size: 512 },
          ];
        }
        if (path === 'src') {
          return [
            { name: 'main.ts', type: 'file' as const, size: 100 },
          ];
        }
        return [];
      }),
      readFileContent: vi.fn(async () => ({ content: 'line one\nline two\nline three', type: 'text' as const, totalChars: 28 })),
    });
    registerBuiltInTools(toolsService, createMockDb(), fs, undefined, createMockRetrieval(), createMockCanonicalMemorySearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'read_file')!;

    const result = await tool.handler({ path: 'README.md' }, createToken());

    // Tree should appear before file content
    expect(result.content).toContain('**Workspace: Test Workspace**');
    expect(result.content).toContain('src/');
    expect(result.content).toContain('main.ts');
    expect(result.content).toContain('README.md');
    // File content with line count
    expect(result.content).toContain('(3 lines)');
    expect(result.content).toContain('line one\nline two\nline three');
  });

  it('still works when readdir fails (tree is best-effort)', async () => {
    const toolsService = createMockToolsService();
    const fs = createMockFs({
      readdir: vi.fn(async () => { throw new Error('permission denied'); }),
      readFileContent: vi.fn(async () => ({ content: 'content here', type: 'text' as const, totalChars: 12 })),
    });
    registerBuiltInTools(toolsService, createMockDb(), fs, undefined, createMockRetrieval(), createMockCanonicalMemorySearch());
    const tool = toolsService.registeredTools.find(t => t.name === 'read_file')!;

    const result = await tool.handler({ path: 'test.txt' }, createToken());

    // Should still return file content even though tree failed
    expect(result.content).toContain('content here');
    expect(result.isError).toBeUndefined();
  });
});
