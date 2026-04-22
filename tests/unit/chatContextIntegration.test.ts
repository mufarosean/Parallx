// chatContextIntegration.test.ts — End-to-end tests for chat context integration
//
// Tests the full pipeline with fake page content stored in mock databases:
//   1. extractCanvasPageId — editor ID → bare page UUID
//   2. read_current_page — tool uses getCurrentPageId getter, queries DB with UUID
//   3. read_page — UUID lookup, title lookup, fuzzy title lookup
//   4. Implicit context injection — getCurrentPageContent → user message prepend
//   5. Canvas page attachments — parallx-page:// URI → SQLite content resolution
//   6. getOpenEditorFiles — canvas editors emit parallx-page:// URIs

import { describe, it, expect, vi } from 'vitest';
import {
  registerBuiltInTools,
  extractTextContent,
} from '../../src/built-in/chat/tools/builtInTools';
import { buildFileSystemAccessor } from '../../src/built-in/chat/data/chatDataService';
import type { IBuiltInToolDatabase } from '../../src/built-in/chat/tools/builtInTools';
import type {
  ILanguageModelToolsService,
  IChatTool,
  ICancellationToken,
} from '../../src/services/chatTypes';
import { WorkspaceService } from '../../src/services/workspaceService';
import { Workspace } from '../../src/workspace/workspace';
import { Emitter } from '../../src/platform/events';
import { URI } from '../../src/platform/uri';

// ── Fake content ──

/** Tiptap JSON doc with real nested structure. */
const TIPTAP_DOC = JSON.stringify({
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Random Paragraph' }],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'The quick brown fox jumps over the lazy dog. ' },
        { type: 'text', text: 'This is a test page with real content.' },
      ],
    },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Second paragraph with more details about the project.' },
      ],
    },
  ],
});

const EMPTY_TIPTAP_DOC = JSON.stringify({ type: 'doc', content: [] });

const FAKE_PAGES = [
  { id: 'uuid-page-1', title: 'Random Paragraph', content: TIPTAP_DOC, icon: '📝', is_archived: 0, created_at: '2026-01-01', updated_at: '2026-02-28' },
  { id: 'uuid-page-2', title: 'Meeting Notes', content: JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Discussed roadmap for Q2.' }] }] }), icon: '📋', is_archived: 0, created_at: '2026-01-15', updated_at: '2026-02-20' },
  { id: 'uuid-page-3', title: 'Empty Page', content: EMPTY_TIPTAP_DOC, icon: null, is_archived: 0, created_at: '2026-02-01', updated_at: '2026-02-01' },
];

// ── Helpers ──

function createToken(cancelled = false): ICancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

/**
 * Create a mock database that stores fake pages and answers queries realistically.
 * This simulates the actual SQLite behavior rather than using simple vi.fn() stubs.
 */
function createRealisticDb(pages = FAKE_PAGES): IBuiltInToolDatabase {
  return {
    isOpen: true,
    async get<T>(sql: string, params?: unknown[]): Promise<T | null | undefined> {
      // Route queries to the right resolver based on SQL pattern
      if (sql.includes('WHERE id = ?')) {
        const id = params?.[0] as string;
        return (pages.find(p => p.id === id) as T) ?? undefined;
      }
      if (sql.includes('LOWER(title) = LOWER(?)')) {
        const title = params?.[0] as string;
        return (pages.find(p => p.title.toLowerCase() === title.toLowerCase()) as T) ?? undefined;
      }
      if (sql.includes('title LIKE ?')) {
        const pattern = params?.[0] as string;
        const search = pattern.replace(/%/g, '').toLowerCase();
        return (pages.find(p => p.title.toLowerCase().includes(search)) as T) ?? undefined;
      }
      if (sql.includes('COUNT(*)')) {
        return { cnt: pages.length } as T;
      }
      return undefined;
    },
    async all<T>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql.includes('title LIKE ? OR content LIKE ?')) {
        const pattern = params?.[0] as string;
        const search = pattern.replace(/%/g, '').toLowerCase();
        return pages.filter(p =>
          p.title.toLowerCase().includes(search) ||
          p.content.toLowerCase().includes(search),
        ) as T[];
      }
      if (sql.includes('FROM pages')) {
        return pages.filter(p => !p.is_archived) as T[];
      }
      return [];
    },
    async run(_sql: string, _params?: unknown[]): Promise<{ changes: number }> {
      return { changes: 1 };
    },
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

function getTool(name: string, toolsService: ReturnType<typeof createMockToolsService>): IChatTool {
  const tool = toolsService.registeredTools.find(t => t.name === name);
  if (!tool) { throw new Error(`Tool "${name}" not found. Registered: ${toolsService.registeredTools.map(t => t.name).join(', ')}`); }
  return tool;
}

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

// ──────────────────────────────────────────────────────────────────────────────
// 1. extractCanvasPageId
// ──────────────────────────────────────────────────────────────────────────────

// The function is private in chatTool.ts, so we test it indirectly through
// the tools and services. But we can replicate the logic here to verify our
// understanding of editor ID formats.

describe('extractCanvasPageId (logic verification)', () => {
  // Replicate the helper to test it directly
  function extractCanvasPageId(editorId: string | undefined): string | undefined {
    if (!editorId) { return undefined; }
    const parts = editorId.split(':');
    if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
      return parts.slice(2).join(':');
    }
    return undefined;
  }

  it('extracts UUID from canvas editor ID', () => {
    expect(extractCanvasPageId('parallx.canvas:canvas:uuid-page-1')).toBe('uuid-page-1');
  });

  it('extracts UUID from database editor ID', () => {
    expect(extractCanvasPageId('parallx.canvas:database:uuid-db-1')).toBe('uuid-db-1');
  });

  it('handles UUIDs that contain colons', () => {
    expect(extractCanvasPageId('parallx.canvas:canvas:a:b:c')).toBe('a:b:c');
  });

  it('returns undefined for non-canvas editor IDs', () => {
    expect(extractCanvasPageId('some-file-editor-id')).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(extractCanvasPageId(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(extractCanvasPageId('')).toBeUndefined();
  });

  it('returns undefined for IDs with wrong namespace', () => {
    expect(extractCanvasPageId('parallx.canvas:text:file-id')).toBeUndefined();
  });
});

describe('buildFileSystemAccessor hidden path handling', () => {
  it('preserves leading dot for .parallx paths', async () => {
    const fileService = {
      readdir: vi.fn(async () => []),
      readFile: vi.fn(async () => ({ content: 'ok', encoding: 'utf8', size: 2, mtime: 0 })),
      stat: vi.fn(async (uri: URI) => ({ size: 2, uri })),
      exists: vi.fn(async () => true),
      isRichDocument: vi.fn(() => false),
      readDocumentText: vi.fn(async () => ({ text: 'ok', format: 'text' })),
    } as any;
    const workspaceService = createWorkspaceService('D:/AI/Parallx/demo-workspace');
    const accessor = buildFileSystemAccessor(fileService, workspaceService)!;

    await accessor.exists('.parallx/memory/MEMORY.md');

    const calledUri = fileService.exists.mock.calls[0][0] as URI;
    expect(calledUri.fsPath).toBe('D:/AI/Parallx/demo-workspace/.parallx/memory/MEMORY.md');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 2. read_current_page — with realistic getCurrentPageId wiring
// ──────────────────────────────────────────────────────────────────────────────

describe('read_current_page tool (end-to-end with fake data)', () => {
  it('reads the active page when getCurrentPageId returns a bare UUID', async () => {
    const db = createRealisticDb();
    const toolsService = createMockToolsService();
    // Simulate what chatTool.ts does AFTER the fix: extractCanvasPageId returns bare UUID
    const getCurrentPageId = () => 'uuid-page-1';
    registerBuiltInTools(toolsService, db, undefined, getCurrentPageId);

    const tool = getTool('read_current_page', toolsService);
    const result = await tool.handler({}, createToken());

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Random Paragraph');
    expect(result.content).toContain('uuid-page-1');
    expect(result.content).toContain('quick brown fox');
  });

  it('FAILS when getCurrentPageId returns full editor ID (the bug we fixed)', async () => {
    const db = createRealisticDb();
    const toolsService = createMockToolsService();
    // Simulate the OLD broken behavior: raw editor ID passed through
    const getCurrentPageId = () => 'parallx.canvas:canvas:uuid-page-1';
    registerBuiltInTools(toolsService, db, undefined, getCurrentPageId);

    const tool = getTool('read_current_page', toolsService);
    const result = await tool.handler({}, createToken());

    // The full editor ID does NOT match pages.id — query returns nothing
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
  });

  it('returns error when no page is open', async () => {
    const db = createRealisticDb();
    const toolsService = createMockToolsService();
    const getCurrentPageId = () => undefined;
    registerBuiltInTools(toolsService, db, undefined, getCurrentPageId);

    const tool = getTool('read_current_page', toolsService);
    const result = await tool.handler({}, createToken());

    expect(result.isError).toBe(true);
    expect(result.content).toContain('No page is currently open');
  });

  it('handles empty pages gracefully', async () => {
    const db = createRealisticDb();
    const toolsService = createMockToolsService();
    const getCurrentPageId = () => 'uuid-page-3';
    registerBuiltInTools(toolsService, db, undefined, getCurrentPageId);

    const tool = getTool('read_current_page', toolsService);
    const result = await tool.handler({}, createToken());

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Empty Page');
    expect(result.content).toContain('(empty page)');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 3. read_page — UUID + title 3-level fallback with real data
// ──────────────────────────────────────────────────────────────────────────────

describe('read_page tool (3-level fallback with fake data)', () => {
  let tool: IChatTool;

  function setup() {
    const db = createRealisticDb();
    const toolsService = createMockToolsService();
    registerBuiltInTools(toolsService, db);
    return getTool('read_page', toolsService);
  }

  it('reads page by exact UUID', async () => {
    tool = setup();
    const result = await tool.handler({ pageId: 'uuid-page-1' }, createToken());

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Random Paragraph');
    expect(result.content).toContain('quick brown fox');
  });

  it('reads page by exact title (case-insensitive)', async () => {
    tool = setup();
    const result = await tool.handler({ pageId: 'random paragraph' }, createToken());

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Random Paragraph');
    expect(result.content).toContain('uuid-page-1');
  });

  it('reads page by partial title (LIKE fallback)', async () => {
    tool = setup();
    const result = await tool.handler({ pageId: 'Meeting' }, createToken());

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Meeting Notes');
    expect(result.content).toContain('Discussed roadmap');
  });

  it('returns error for completely unknown identifier', async () => {
    tool = setup();
    const result = await tool.handler({ pageId: 'xyznonexistent' }, createToken());

    expect(result.isError).toBe(true);
    expect(result.content).toContain('not found');
    expect(result.content).toContain('list_pages');
  });

  it('prefers UUID match over title match', async () => {
    // If the identifier happens to be a valid UUID that exists, use that
    tool = setup();
    const result = await tool.handler({ pageId: 'uuid-page-2' }, createToken());

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Meeting Notes');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 4. Implicit context injection (defaultParticipant message building)
// ──────────────────────────────────────────────────────────────────────────────

describe('implicit context injection (message building)', () => {
  // Replicate the message-building logic from defaultParticipant.ts
  // to test it in isolation with fake services.

  async function buildUserMessage(opts: {
    text: string;
    attachments?: { name: string; fullPath: string }[];
    getCurrentPageContent?: () => Promise<{ title: string; pageId: string; textContent: string } | undefined>;
    readFileContent?: (fullPath: string) => Promise<string>;
  }): Promise<string> {
    const contextParts: string[] = [];

    // 1. Implicit context
    if (opts.getCurrentPageContent) {
      try {
        const pageContext = await opts.getCurrentPageContent();
        if (pageContext && pageContext.textContent) {
          contextParts.push(
            `[Currently open page: "${pageContext.title}" (id: ${pageContext.pageId})]\n${pageContext.textContent}`,
          );
        }
      } catch { /* skip */ }
    }

    // 2. Explicit attachments
    if (opts.attachments?.length && opts.readFileContent) {
      for (const attachment of opts.attachments) {
        try {
          const content = await opts.readFileContent(attachment.fullPath);
          contextParts.push(`File: ${attachment.name}\n\`\`\`\n${content}\n\`\`\``);
        } catch {
          contextParts.push(`File: ${attachment.name}\n[Could not read file]`);
        }
      }
    }

    return contextParts.length > 0
      ? `${contextParts.join('\n\n')}\n\n${opts.text}`
      : opts.text;
  }

  it('prepends active page content to user message', async () => {
    const msg = await buildUserMessage({
      text: 'Summarize this page',
      getCurrentPageContent: async () => ({
        title: 'Random Paragraph',
        pageId: 'uuid-page-1',
        textContent: 'The quick brown fox jumps over the lazy dog.',
      }),
    });

    expect(msg).toContain('[Currently open page: "Random Paragraph" (id: uuid-page-1)]');
    expect(msg).toContain('quick brown fox');
    expect(msg).toContain('Summarize this page');
    // The implicit context must appear BEFORE the user text
    const contextIdx = msg.indexOf('quick brown fox');
    const userIdx = msg.indexOf('Summarize this page');
    expect(contextIdx).toBeLessThan(userIdx);
  });

  it('returns just user text when no page is open', async () => {
    const msg = await buildUserMessage({
      text: 'Hello',
      getCurrentPageContent: async () => undefined,
    });

    expect(msg).toBe('Hello');
  });

  it('includes attachment content inline', async () => {
    const msg = await buildUserMessage({
      text: 'Read this file',
      attachments: [{ name: 'notes.txt', fullPath: '/path/to/notes.txt' }],
      readFileContent: async () => 'File content here',
    });

    expect(msg).toContain('File: notes.txt');
    expect(msg).toContain('File content here');
    expect(msg).toContain('Read this file');
  });

  it('includes both implicit context AND attachment content', async () => {
    const msg = await buildUserMessage({
      text: 'Compare these',
      getCurrentPageContent: async () => ({
        title: 'Page A',
        pageId: 'uuid-a',
        textContent: 'Content of page A',
      }),
      attachments: [{ name: 'data.csv', fullPath: '/data.csv' }],
      readFileContent: async () => 'col1,col2\n1,2',
    });

    expect(msg).toContain('[Currently open page: "Page A"');
    expect(msg).toContain('Content of page A');
    expect(msg).toContain('File: data.csv');
    expect(msg).toContain('col1,col2');
    expect(msg).toContain('Compare these');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 6. Canvas page attachment resolution (parallx-page:// URIs)
// ──────────────────────────────────────────────────────────────────────────────

describe('canvas page attachment resolution (parallx-page:// URIs)', () => {
  // Replicate the readFileContent logic from chatTool.ts

  function createReadFileContent(db: IBuiltInToolDatabase) {
    return async (fullPath: string): Promise<string> => {
      // Canvas page attachments use parallx-page://<pageId> URIs
      if (fullPath.startsWith('parallx-page://') && db.isOpen) {
        const pageId = fullPath.slice('parallx-page://'.length);
        const row = await db.get<{ title: string; content: string }>(
          'SELECT title, content FROM pages WHERE id = ?',
          [pageId],
        );
        if (!row) { return `[Error: Page not found "${pageId}"]`; }
        const text = extractTextContent(row.content);
        return text || '[Empty page]';
      }
      // Regular filesystem (would use fileService — not tested here)
      return `[Error: Could not read file "${fullPath}"]`;
    };
  }

  it('resolves parallx-page:// URI to page content from database', async () => {
    const db = createRealisticDb();
    const readFileContent = createReadFileContent(db);

    const content = await readFileContent('parallx-page://uuid-page-1');

    expect(content).toContain('quick brown fox');
    expect(content).toContain('Random Paragraph');
    expect(content).not.toContain('Error');
  });

  it('returns error for non-existent page URI', async () => {
    const db = createRealisticDb();
    const readFileContent = createReadFileContent(db);

    const content = await readFileContent('parallx-page://nonexistent-uuid');

    expect(content).toContain('Page not found');
  });

  it('handles empty page content', async () => {
    const db = createRealisticDb();
    const readFileContent = createReadFileContent(db);

    const content = await readFileContent('parallx-page://uuid-page-3');

    expect(content).toBe('[Empty page]');
  });

  it('falls through to filesystem for non-page URIs', async () => {
    const db = createRealisticDb();
    const readFileContent = createReadFileContent(db);

    const content = await readFileContent('/some/file.txt');

    expect(content).toContain('Could not read file');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 7. getOpenEditorFiles — canvas editors emit parallx-page:// URIs
// ──────────────────────────────────────────────────────────────────────────────

describe('getOpenEditorFiles (canvas editor URI mapping)', () => {
  // Replicate the mapping logic from chatTool.ts

  interface EditorDescriptor {
    id: string;
    name: string;
    description: string;
    isDirty: boolean;
    isActive: boolean;
    groupId: string;
  }

  function getOpenEditorFiles(editors: EditorDescriptor[]) {
    return editors.map((ed) => {
      const parts = ed.id.split(':');
      if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
        const pageId = parts.slice(2).join(':');
        return { name: ed.name, fullPath: `parallx-page://${pageId}` };
      }
      return { name: ed.name, fullPath: ed.description || ed.name };
    });
  }

  it('maps canvas editor to parallx-page:// URI', () => {
    const files = getOpenEditorFiles([
      { id: 'parallx.canvas:canvas:uuid-page-1', name: 'Random Paragraph', description: 'Tool editor: canvas', isDirty: false, isActive: true, groupId: 'g1' },
    ]);

    expect(files).toHaveLength(1);
    expect(files[0].name).toBe('Random Paragraph');
    expect(files[0].fullPath).toBe('parallx-page://uuid-page-1');
  });

  it('maps database editor to parallx-page:// URI', () => {
    const files = getOpenEditorFiles([
      { id: 'parallx.canvas:database:uuid-db-1', name: 'My Database', description: 'Tool editor: database', isDirty: false, isActive: false, groupId: 'g1' },
    ]);

    expect(files[0].fullPath).toBe('parallx-page://uuid-db-1');
  });

  it('preserves filesystem editor paths (non-canvas)', () => {
    const files = getOpenEditorFiles([
      { id: 'file-editor-1', name: 'readme.md', description: '/workspace/readme.md', isDirty: false, isActive: true, groupId: 'g1' },
    ]);

    expect(files[0].fullPath).toBe('/workspace/readme.md');
  });

  it('handles mixed canvas and filesystem editors', () => {
    const files = getOpenEditorFiles([
      { id: 'parallx.canvas:canvas:uuid-page-1', name: 'My Page', description: 'Tool editor: canvas', isDirty: false, isActive: true, groupId: 'g1' },
      { id: 'file-editor-1', name: 'main.ts', description: '/src/main.ts', isDirty: false, isActive: false, groupId: 'g1' },
    ]);

    expect(files[0].fullPath).toBe('parallx-page://uuid-page-1');
    expect(files[1].fullPath).toBe('/src/main.ts');
  });

  it('does NOT produce broken Tool editor: canvas as fullPath', () => {
    // This is the OLD broken behavior — canvas editors used to return
    // "Tool editor: canvas" as the fullPath since that was ed.description
    const files = getOpenEditorFiles([
      { id: 'parallx.canvas:canvas:uuid-page-1', name: 'Random Paragraph', description: 'Tool editor: canvas', isDirty: false, isActive: true, groupId: 'g1' },
    ]);

    expect(files[0].fullPath).not.toBe('Tool editor: canvas');
    expect(files[0].fullPath).toBe('parallx-page://uuid-page-1');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 8. Full round-trip: editor ID → UUID → DB query → content in user message
// ──────────────────────────────────────────────────────────────────────────────

describe('full round-trip: canvas page → chat context', () => {
  function extractCanvasPageId(editorId: string | undefined): string | undefined {
    if (!editorId) { return undefined; }
    const parts = editorId.split(':');
    if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
      return parts.slice(2).join(':');
    }
    return undefined;
  }

  it('active canvas page content appears in user message (implicit context)', async () => {
    const db = createRealisticDb();
    const editorId = 'parallx.canvas:canvas:uuid-page-1';

    // Step 1: Extract page UUID (what chatTool.ts does after fix)
    const pageId = extractCanvasPageId(editorId);
    expect(pageId).toBe('uuid-page-1');

    // Step 2: Query database (what getCurrentPageContent does)
    const row = await db.get<{ id: string; title: string; content: string }>(
      'SELECT id, title, content FROM pages WHERE id = ?',
      [pageId],
    );
    expect(row).toBeDefined();
    expect(row!.title).toBe('Random Paragraph');

    // Step 3: Extract text content
    const textContent = extractTextContent(row!.content);
    expect(textContent).toContain('quick brown fox');

    // Step 4: Build user message with implicit context
    const contextParts: string[] = [];
    contextParts.push(`[Currently open page: "${row!.title}" (id: ${row!.id})]\n${textContent}`);
    const userMessage = `${contextParts.join('\n\n')}\n\nSummarize this page`;

    expect(userMessage).toContain('[Currently open page: "Random Paragraph" (id: uuid-page-1)]');
    expect(userMessage).toContain('quick brown fox');
    expect(userMessage).toContain('Summarize this page');
  });

  it('attached canvas page content appears in user message', async () => {
    const db = createRealisticDb();
    const editorId = 'parallx.canvas:canvas:uuid-page-2';

    // Step 1: getOpenEditorFiles maps to parallx-page:// URI
    const parts = editorId.split(':');
    const pageId = parts.slice(2).join(':');
    const fullPath = `parallx-page://${pageId}`;
    expect(fullPath).toBe('parallx-page://uuid-page-2');

    // Step 2: readFileContent resolves the URI via SQLite
    const resolvedPageId = fullPath.slice('parallx-page://'.length);
    const row = await db.get<{ title: string; content: string }>(
      'SELECT title, content FROM pages WHERE id = ?',
      [resolvedPageId],
    );
    expect(row).toBeDefined();

    const text = extractTextContent(row!.content);
    expect(text).toContain('Discussed roadmap');

    // Step 3: Content appears as attachment in user message
    const contextParts: string[] = [];
    contextParts.push(`File: Meeting Notes\n\`\`\`\n${text}\n\`\`\``);
    const userMessage = `${contextParts.join('\n\n')}\n\nRead the contents of the attached file.`;

    expect(userMessage).toContain('Meeting Notes');
    expect(userMessage).toContain('Discussed roadmap');
  });

  it('old broken behavior: full editor ID fails DB lookup', async () => {
    const db = createRealisticDb();
    const brokenId = 'parallx.canvas:canvas:uuid-page-1'; // full editor ID, NOT extracted

    // Without extraction, the query matches nothing
    const row = await db.get<{ id: string; title: string; content: string }>(
      'SELECT id, title, content FROM pages WHERE id = ?',
      [brokenId],
    );
    expect(row).toBeUndefined(); // This is why implicit context was never injected
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 9. extractTextContent — Tiptap JSON parsing
// ──────────────────────────────────────────────────────────────────────────────

describe('extractTextContent (Tiptap JSON → plain text)', () => {
  it('extracts text from nested Tiptap JSON document', () => {
    const text = extractTextContent(TIPTAP_DOC);
    expect(text).toContain('Random Paragraph');
    expect(text).toContain('quick brown fox');
    expect(text).toContain('Second paragraph');
  });

  it('returns empty string for empty doc', () => {
    expect(extractTextContent(EMPTY_TIPTAP_DOC)).toBe('');
  });

  it('handles plain text content (non-JSON)', () => {
    expect(extractTextContent('Just plain text')).toBe('Just plain text');
  });

  it('handles empty string', () => {
    expect(extractTextContent('')).toBe('');
  });

  it('handles null-ish content', () => {
    expect(extractTextContent(null as any)).toBe('');
    expect(extractTextContent(undefined as any)).toBe('');
  });
});
