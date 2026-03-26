// @vitest-environment jsdom

// chatIndexingUI.test.ts — Unit tests for M10 Phase 6: Indexing Status & UI
//
// Task 6.1: Indexing indicator in status bar + popup Knowledge Index section
// Task 6.2: Source citation Reference rendering (clickable pills)

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Task 6.1: ChatTokenStatusBar indexing indicator ──

describe('ChatTokenStatusBar — indexing indicator (Task 6.1)', () => {
  let ChatTokenStatusBar: typeof import('../../src/built-in/chat/widgets/chatTokenStatusBar.js').ChatTokenStatusBar;

  beforeEach(async () => {
    // Dynamic import to get the DOM-dependent class
    const mod = await import('../../src/built-in/chat/widgets/chatTokenStatusBar.js');
    ChatTokenStatusBar = mod.ChatTokenStatusBar;
  });

  function createServices(overrides: Record<string, unknown> = {}) {
    return {
      getActiveSession: () => undefined,
      getContextLength: async () => 128_000,
      getMode: () => 'agent' as const,
      getWorkspaceName: () => 'TestWorkspace',
      getPageCount: async () => 10,
      getCurrentPageTitle: () => 'Page 1',
      getToolDefinitions: () => [],
      getFileCount: async () => 5,
      isRAGAvailable: () => false,
      isIndexing: () => false,
      getIndexingProgress: () => ({ phase: 'idle' as const, processed: 0, total: 0 }),
      getIndexStats: () => undefined as { pages: number; files: number } | undefined,
      ...overrides,
    };
  }

  it('creates an indexing indicator element', () => {
    const bar = new ChatTokenStatusBar(createServices());
    const el = bar.element;
    const indicator = el.querySelector('.parallx-token-statusbar-indexing');
    expect(indicator).toBeTruthy();
    bar.dispose();
  });

  it('hides indicator when idle with no stats', async () => {
    const bar = new ChatTokenStatusBar(createServices());
    await bar.update();
    const indicator = bar.element.querySelector('.parallx-token-statusbar-indexing') as HTMLElement;
    expect(indicator.style.display).toBe('none');
    bar.dispose();
  });

  it('shows completed stats when idle with index stats', async () => {
    const bar = new ChatTokenStatusBar(createServices({
      getIndexStats: () => ({ pages: 120, files: 340 }),
    }));
    await bar.update();
    const indicator = bar.element.querySelector('.parallx-token-statusbar-indexing') as HTMLElement;
    expect(indicator.style.display).not.toBe('none');
    expect(indicator.textContent).toContain('120 pages');
    expect(indicator.textContent).toContain('340 files');
    expect(indicator.classList.contains('parallx-token-statusbar-indexing-complete')).toBe(true);
    bar.dispose();
  });

  it('shows page indexing progress', async () => {
    const bar = new ChatTokenStatusBar(createServices({
      isIndexing: () => true,
      getIndexingProgress: () => ({ phase: 'pages', processed: 45, total: 120 }),
    }));
    await bar.update();
    const indicator = bar.element.querySelector('.parallx-token-statusbar-indexing') as HTMLElement;
    expect(indicator.style.display).not.toBe('none');
    expect(indicator.textContent).toContain('45/120 pages');
    expect(indicator.classList.contains('parallx-token-statusbar-indexing-active')).toBe(true);
    bar.dispose();
  });

  it('shows file indexing progress', async () => {
    const bar = new ChatTokenStatusBar(createServices({
      isIndexing: () => true,
      getIndexingProgress: () => ({ phase: 'files', processed: 200, total: 340 }),
    }));
    await bar.update();
    const indicator = bar.element.querySelector('.parallx-token-statusbar-indexing') as HTMLElement;
    expect(indicator.textContent).toContain('200/340 files');
    bar.dispose();
  });

  it('shows incremental re-indexing message', async () => {
    const bar = new ChatTokenStatusBar(createServices({
      isIndexing: () => true,
      getIndexingProgress: () => ({ phase: 'incremental', processed: 1, total: 3 }),
    }));
    await bar.update();
    const indicator = bar.element.querySelector('.parallx-token-statusbar-indexing') as HTMLElement;
    expect(indicator.textContent).toContain('Re-indexing');
    expect(indicator.textContent).toContain('3');
    bar.dispose();
  });

  it('uses singular "item" for count of 1', async () => {
    const bar = new ChatTokenStatusBar(createServices({
      isIndexing: () => true,
      getIndexingProgress: () => ({ phase: 'incremental', processed: 0, total: 1 }),
    }));
    await bar.update();
    const indicator = bar.element.querySelector('.parallx-token-statusbar-indexing') as HTMLElement;
    expect(indicator.textContent).toContain('1 changed item');
    expect(indicator.textContent).not.toContain('items');
    bar.dispose();
  });
});

// ── Task 6.2: Reference content part rendering ──

describe('renderContentPart — Reference (Task 6.2)', () => {
  let renderContentPart: typeof import('../../src/built-in/chat/rendering/chatContentParts.js').renderContentPart;
  let ChatContentPartKind: typeof import('../../src/services/chatTypes.js').ChatContentPartKind;

  beforeEach(async () => {
    const partsMod = await import('../../src/built-in/chat/rendering/chatContentParts.js');
    renderContentPart = partsMod.renderContentPart;
    const typesMod = await import('../../src/services/chatTypes.js');
    ChatContentPartKind = typesMod.ChatContentPartKind;
  });

  it('renders a page reference as a clickable pill', () => {
    const el = renderContentPart({
      kind: ChatContentPartKind.Reference,
      uri: 'parallx-page://abc123',
      label: 'My Canvas Page',
    });
    expect(el.classList.contains('parallx-chat-reference')).toBe(true);
    // Should have icon + label
    const icon = el.querySelector('.parallx-chat-reference-icon');
    const label = el.querySelector('.parallx-chat-reference-label');
    expect(icon).toBeTruthy();
    expect(label).toBeTruthy();
    expect(label!.textContent).toBe('My Canvas Page');
    // Should have page icon (SVG from icon registry)
    expect(icon!.innerHTML).toContain('<svg');
    expect(icon!.innerHTML).toContain('viewBox');
  });

  it('renders a file reference with file icon', () => {
    const el = renderContentPart({
      kind: ChatContentPartKind.Reference,
      uri: 'src/main.ts',
      label: 'main.ts',
    });
    const icon = el.querySelector('.parallx-chat-reference-icon');
    // Should have file-type icon (SVG from icon registry)
    expect(icon!.innerHTML).toContain('<svg');
  });

  it('has a title attribute for tooltip', () => {
    const el = renderContentPart({
      kind: ChatContentPartKind.Reference,
      uri: 'parallx-page://abc123',
      label: 'Design Notes',
    });
    expect(el.title).toContain('Design Notes');
  });

  it('dispatches parallx:navigate-page event for page references', () => {
    const el = renderContentPart({
      kind: ChatContentPartKind.Reference,
      uri: 'parallx-page://abc123',
      label: 'My Page',
    });
    let capturedPageId: string | undefined;
    // Events now bubble from the element — listen on el or any ancestor
    el.addEventListener('parallx:navigate-page', ((e: CustomEvent) => {
      capturedPageId = e.detail.pageId;
    }) as EventListener, { once: true });
    el.click();
    expect(capturedPageId).toBe('abc123');
  });

  it('dispatches parallx:open-file event for file references', () => {
    const el = renderContentPart({
      kind: ChatContentPartKind.Reference,
      uri: 'src/utils/helpers.ts',
      label: 'helpers.ts',
    });
    let capturedPath: string | undefined;
    // Events now bubble from the element — listen on el or any ancestor
    el.addEventListener('parallx:open-file', ((e: CustomEvent) => {
      capturedPath = e.detail.path;
    }) as EventListener, { once: true });
    el.click();
    expect(capturedPath).toBe('src/utils/helpers.ts');
  });
});

describe('renderContentPart — Thinking provenance visibility', () => {
  let renderContentPart: typeof import('../../src/built-in/chat/rendering/chatContentParts.js').renderContentPart;
  let ChatContentPartKind: typeof import('../../src/services/chatTypes.js').ChatContentPartKind;

  beforeEach(async () => {
    const partsMod = await import('../../src/built-in/chat/rendering/chatContentParts.js');
    renderContentPart = partsMod.renderContentPart;
    const typesMod = await import('../../src/services/chatTypes.js');
    ChatContentPartKind = typesMod.ChatContentPartKind;
  });

  it('collapses considered sources by default inside the thinking block', () => {
    const el = renderContentPart({
      kind: ChatContentPartKind.Thinking,
      content: 'Reviewing grounded evidence',
      isCollapsed: false,
      provenance: [
        { id: 'Claims Guide.md', label: 'Claims Guide.md', kind: 'rag', uri: 'Claims Guide.md', index: 1, tokens: 120, removable: true },
        { id: 'memory:session-recall', label: 'Durable memory', kind: 'memory', tokens: 80, removable: true },
        { id: 'transcript:recall', label: 'Transcript recall', kind: 'transcript', tokens: 60, removable: true },
      ],
    });

    const sourcesSection = el.querySelector('.parallx-chat-thinking-sources') as HTMLElement;
    const sourcesLabel = el.querySelector('.parallx-chat-thinking-sources-label') as HTMLElement;

    expect(sourcesSection.classList.contains('parallx-chat-thinking-sources--collapsed')).toBe(true);
    expect(sourcesLabel.textContent).toBe('Sources Considered');
    expect(el.textContent).toContain('3 sources');
    expect(el.textContent).toContain('Durable memory');
    expect(el.textContent).toContain('Transcript recall');
  });
});

// ── Task 6.2: Source citation emission from defaultParticipant ──

describe('retrieveContext — source citation metadata (Task 6.2)', () => {
  it('returns both text and source citations', async () => {
    // Simulate what chatTool.ts closure does
    const mockChunks = [
      { sourceType: 'page', sourceId: 'page-1', contextPrefix: '[Source: "Design Notes"]', text: 'chunk1', score: 0.9, sources: [], tokenCount: 50 },
      { sourceType: 'page', sourceId: 'page-1', contextPrefix: '[Source: "Design Notes"]', text: 'chunk2', score: 0.8, sources: [], tokenCount: 50 },
      { sourceType: 'file', sourceId: 'src/main.ts', contextPrefix: '[Source: "src/main.ts"]', text: 'chunk3', score: 0.7, sources: [], tokenCount: 50 },
    ];

    // Build sources the same way chatTool.ts does (using extractCitationLabel)
    const { extractCitationLabel } = await import('../../src/built-in/chat/data/chatDataService');
    const seen = new Set<string>();
    const sources: Array<{ uri: string; label: string }> = [];
    for (const chunk of mockChunks) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const uri = chunk.sourceType === 'page'
        ? `parallx-page://${chunk.sourceId}`
        : chunk.sourceId;
      const label = extractCitationLabel(chunk);
      sources.push({ uri, label });
    }

    // Should deduplicate — page-1 appears twice but only one citation
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ uri: 'parallx-page://page-1', label: 'Design Notes' });
    expect(sources[1]).toEqual({ uri: 'src/main.ts', label: 'main.ts' });
  });

  it('uses fallback labels when contextPrefix is missing', async () => {
    const { extractCitationLabel } = await import('../../src/built-in/chat/data/chatDataService');
    const mockChunks = [
      { sourceType: 'page', sourceId: 'page-1', contextPrefix: undefined, text: 'chunk1', score: 0.9, sources: [], tokenCount: 50 },
      { sourceType: 'file', sourceId: 'readme.md', contextPrefix: undefined, text: 'chunk2', score: 0.8, sources: [], tokenCount: 50 },
    ];

    const seen = new Set<string>();
    const sources: Array<{ uri: string; label: string }> = [];
    for (const chunk of mockChunks) {
      const key = `${chunk.sourceType}:${chunk.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const uri = chunk.sourceType === 'page'
        ? `parallx-page://${chunk.sourceId}`
        : chunk.sourceId;
      const label = extractCitationLabel(chunk);
      sources.push({ uri, label });
    }

    expect(sources[0].label).toBe('Page');
    expect(sources[1].label).toBe('readme.md');
  });
});

// ── extractCitationLabel — comprehensive coverage ──

describe('extractCitationLabel', () => {
  let extractCitationLabel: typeof import('../../src/built-in/chat/data/chatDataService').extractCitationLabel;

  beforeEach(async () => {
    const mod = await import('../../src/built-in/chat/data/chatDataService');
    extractCitationLabel = mod.extractCitationLabel;
  });

  it('extracts filename from full file path in contextPrefix', () => {
    expect(extractCitationLabel({
      sourceType: 'file',
      sourceId: 'D:/AI/Parallx/demo-workspace/Vehicle Info.md',
      contextPrefix: '[Source: "D:/AI/Parallx/demo-workspace/Vehicle Info.md" | Section: "Overview"]',
    })).toBe('Vehicle Info.md');
  });

  it('extracts filename for file_chunk sourceType', () => {
    expect(extractCitationLabel({
      sourceType: 'file_chunk',
      sourceId: 'D:/AI/Parallx/demo-workspace/Claims Guide.md',
      contextPrefix: '[Source: "D:/AI/Parallx/demo-workspace/Claims Guide.md" | Section: "Filing"]',
    })).toBe('Claims Guide.md');
  });

  it('extracts page title from contextPrefix', () => {
    expect(extractCitationLabel({
      sourceType: 'page',
      sourceId: 'abc-123',
      contextPrefix: '[Source: "My Design Notes" | Type: heading]',
    })).toBe('My Design Notes');
  });

  it('extracts page title for page_block sourceType', () => {
    expect(extractCitationLabel({
      sourceType: 'page_block',
      sourceId: 'def-456',
      contextPrefix: '[Source: "Sprint Planning" | Type: paragraph]',
    })).toBe('Sprint Planning');
  });

  it('returns "Session Memory" for conversation_memory chunks', () => {
    expect(extractCitationLabel({
      sourceType: 'conversation_memory',
      sourceId: 'session-xyz',
      contextPrefix: '[Conversation Memory — Session abc12345]',
    })).toBe('Session Memory');
  });

  it('returns "Session Memory" for memory sourceType (actual retrieval value)', () => {
    expect(extractCitationLabel({
      sourceType: 'memory',
      sourceId: 'session-abc',
      contextPrefix: '[Conversation Memory — Session abc12345]',
    })).toBe('Session Memory');
  });

  it('returns "Session Memory" for memory sourceType even without contextPrefix', () => {
    expect(extractCitationLabel({
      sourceType: 'memory',
      sourceId: 'session-abc',
      contextPrefix: undefined,
    })).toBe('Session Memory');
  });

  it('returns "Page" fallback when no contextPrefix for pages', () => {
    expect(extractCitationLabel({
      sourceType: 'page',
      sourceId: 'some-uuid',
      contextPrefix: undefined,
    })).toBe('Page');
  });

  it('returns "Page" fallback for page_block without contextPrefix', () => {
    expect(extractCitationLabel({
      sourceType: 'page_block',
      sourceId: 'some-uuid',
      contextPrefix: undefined,
    })).toBe('Page');
  });

  it('extracts filename from sourceId fallback for files', () => {
    expect(extractCitationLabel({
      sourceType: 'file',
      sourceId: 'src/utils/helpers.ts',
      contextPrefix: undefined,
    })).toBe('helpers.ts');
  });

  it('handles backslash paths in contextPrefix', () => {
    expect(extractCitationLabel({
      sourceType: 'file',
      sourceId: 'D:\\Projects\\readme.md',
      contextPrefix: '[Source: "D:\\Projects\\readme.md"]',
    })).toBe('readme.md');
  });
});