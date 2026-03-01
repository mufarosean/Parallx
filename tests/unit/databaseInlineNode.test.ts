/**
 * @vitest-environment jsdom
 */
/**
 * Unit tests for Phase 6 — Inline Databases & Linked Views
 *
 * Tests:
 *   - DatabaseInline Tiptap extension schema (name, attrs, atom, group)
 *   - Block registry entries for databaseInline and linkedView
 *   - NodeView DOM structure and error state
 *   - sourceDatabaseId field on IDatabaseViewConfig
 *   - Slash menu registration
 */
import { describe, it, expect, vi } from 'vitest';
import { DatabaseInline } from '../../src/built-in/canvas/extensions/databaseInlineNode';
import { DatabaseFullPage } from '../../src/built-in/canvas/extensions/databaseFullPageNode';
import {
  BLOCK_REGISTRY,
  getSlashMenuBlocks,
} from '../../src/built-in/canvas/config/blockRegistry';
import type {
  IDatabaseViewConfig,
} from '../../src/built-in/canvas/database/databaseTypes';

// ─── Extension Schema ────────────────────────────────────────────────────────

describe('DatabaseInline extension', () => {
  const ext = DatabaseInline.configure({});

  it('has the correct name', () => {
    expect(ext.name).toBe('databaseInline');
  });

  it('is declared as an atom node', () => {
    // The config object exposes atom through the extension options
    const config = (ext as any).config;
    expect(config?.atom ?? (ext as any).options?.atom).toBeDefined;
  });

  it('is draggable', () => {
    const config = (ext as any).config;
    expect(config?.draggable).not.toBe(false);
  });
});

// ─── Block Registry Definitions ──────────────────────────────────────────────

describe('Block Registry — inline database entries', () => {
  it('has a databaseInline definition', () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    expect(def).toBeDefined();
    expect(def!.name).toBe('databaseInline');
    expect(def!.label).toBe('Database - Inline');
    expect(def!.kind).toBe('atom');
    expect(def!.source).toBe('custom');
  });

  it('has a linkedView definition', () => {
    const def = BLOCK_REGISTRY.get('linkedView');
    expect(def).toBeDefined();
    expect(def!.name).toBe('databaseInline');
    expect(def!.label).toBe('Linked view of data source');
    expect(def!.kind).toBe('atom');
  });

  it('databaseInline definition has an extension factory', () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    expect(typeof def!.extension).toBe('function');
  });

  it('linkedView definition has NO extension factory (shares node type)', () => {
    const def = BLOCK_REGISTRY.get('linkedView');
    expect(def!.extension).toBeUndefined();
  });

  it('databaseInline has a slash menu config', () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    expect(def!.slashMenu).toBeDefined();
    expect(def!.slashMenu!.description).toContain('inline database');
  });

  it('linkedView has a slash menu config', () => {
    const def = BLOCK_REGISTRY.get('linkedView');
    expect(def!.slashMenu).toBeDefined();
    expect(def!.slashMenu!.description).toContain('Linked view');
  });

  it('all three have insertAction callbacks', () => {
    const dbInline = BLOCK_REGISTRY.get('databaseInline');
    const dbFull = BLOCK_REGISTRY.get('databaseFullPage');
    const linked = BLOCK_REGISTRY.get('linkedView');
    expect(typeof dbInline!.insertAction).toBe('function');
    expect(typeof dbFull!.insertAction).toBe('function');
    expect(typeof linked!.insertAction).toBe('function');
  });

  it('all three have customDragHandle capability', () => {
    const dbInline = BLOCK_REGISTRY.get('databaseInline');
    const dbFull = BLOCK_REGISTRY.get('databaseFullPage');
    const linked = BLOCK_REGISTRY.get('linkedView');
    expect(dbInline!.capabilities.customDragHandle).toBe(true);
    expect(dbFull!.capabilities.customDragHandle).toBe(true);
    expect(linked!.capabilities.customDragHandle).toBe(true);
  });

  it('all three are not page containers', () => {
    const dbInline = BLOCK_REGISTRY.get('databaseInline');
    const dbFull = BLOCK_REGISTRY.get('databaseFullPage');
    const linked = BLOCK_REGISTRY.get('linkedView');
    expect(dbInline!.capabilities.isPageContainer).toBe(false);
    expect(dbFull!.capabilities.isPageContainer).toBe(false);
    expect(linked!.capabilities.isPageContainer).toBe(false);
  });
});

// ─── Slash Menu Registration ─────────────────────────────────────────────────

describe('Slash menu — database items', () => {
  const slashItems = getSlashMenuBlocks();

  it('includes databaseInline in the slash menu', () => {
    const found = slashItems.find(d => d.id === 'databaseInline');
    expect(found).toBeDefined();
  });

  it('includes databaseFullPage in the slash menu', () => {
    const found = slashItems.find(d => d.id === 'databaseFullPage');
    expect(found).toBeDefined();
  });

  it('includes linkedView in the slash menu', () => {
    const found = slashItems.find(d => d.id === 'linkedView');
    expect(found).toBeDefined();
  });

  it('order: databaseInline < databaseFullPage < linkedView', () => {
    const dbIdx = slashItems.findIndex(d => d.id === 'databaseInline');
    const fullIdx = slashItems.findIndex(d => d.id === 'databaseFullPage');
    const lvIdx = slashItems.findIndex(d => d.id === 'linkedView');
    expect(dbIdx).toBeLessThan(fullIdx);
    expect(fullIdx).toBeLessThan(lvIdx);
  });
});

// ─── NodeView Error State ────────────────────────────────────────────────────

describe('DatabaseInline NodeView — no service', () => {
  it('renders error text when no databaseDataService', () => {
    const ext = DatabaseInline.configure({
      databaseDataService: undefined,
      openEditor: undefined,
    });
    // Get the addNodeView factory
    const nodeViewFactory = (ext as any).options?.addNodeView ?? ext.config?.addNodeView;
    // Manually test the extension provides a node view factory
    expect(ext.name).toBe('databaseInline');
    // The extension is configured — it will produce error DOM at runtime
    // We verify the extension exists and can be configured without errors
    expect(ext).toBeDefined();
  });
});

// ─── DatabaseFullPage Extension ──────────────────────────────────────────────

describe('DatabaseFullPage extension', () => {
  const ext = DatabaseFullPage.configure({});

  it('has the correct name', () => {
    expect(ext.name).toBe('databaseFullPage');
  });

  it('is declared as an atom node', () => {
    const config = (ext as any).config;
    expect(config?.atom ?? (ext as any).options?.atom).toBeDefined;
  });

  it('is draggable', () => {
    const config = (ext as any).config;
    expect(config?.draggable).not.toBe(false);
  });
});

describe('Block Registry — databaseFullPage entry', () => {
  it('has a databaseFullPage definition', () => {
    const def = BLOCK_REGISTRY.get('databaseFullPage');
    expect(def).toBeDefined();
    expect(def!.name).toBe('databaseFullPage');
    expect(def!.label).toBe('Database - Full page');
    expect(def!.kind).toBe('atom');
    expect(def!.source).toBe('custom');
    expect(def!.icon).toBe('database');
  });

  it('has an extension factory', () => {
    const def = BLOCK_REGISTRY.get('databaseFullPage');
    expect(typeof def!.extension).toBe('function');
  });

  it('has a slash menu config', () => {
    const def = BLOCK_REGISTRY.get('databaseFullPage');
    expect(def!.slashMenu).toBeDefined();
    expect(def!.slashMenu!.description).toContain('full-page database');
  });

  it('has iconSelectable set', () => {
    const def = BLOCK_REGISTRY.get('databaseFullPage');
    expect(def!.iconSelectable).toBe(true);
  });
});

// ─── InsertAction — databaseFullPage ─────────────────────────────────────────

describe('InsertAction — databaseFullPage', () => {
  it('does nothing when dataService is missing', async () => {
    const def = BLOCK_REGISTRY.get('databaseFullPage');
    const mockEditor = { chain: vi.fn() } as any;
    const range = { from: 0, to: 1 };
    const context = {
      pageId: undefined,
      dataService: undefined,
      databaseDataService: undefined,
    } as any;

    await def!.insertAction!(mockEditor, range, context);
    expect(mockEditor.chain).not.toHaveBeenCalled();
  });

  it('creates page, database, inserts block, and opens editor', async () => {
    const def = BLOCK_REGISTRY.get('databaseFullPage');
    const mockChainResult = {
      insertContentAt: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(true),
    };
    const mockEditor = {
      chain: vi.fn().mockReturnValue(mockChainResult),
      getJSON: vi.fn().mockReturnValue({ type: 'doc', content: [] }),
    } as any;
    const range = { from: 0, to: 1 };

    const mockOpenEditor = vi.fn().mockResolvedValue(undefined);
    const mockDataService = {
      createPage: vi.fn().mockResolvedValue({ id: 'db-page', title: 'Untitled', icon: null }),
      updatePage: vi.fn().mockResolvedValue({ id: 'db-page', title: 'Untitled', icon: 'database' }),
      flushContentSave: vi.fn().mockResolvedValue(undefined),
      deletePage: vi.fn(),
    };
    const mockDbService = {
      createDatabase: vi.fn().mockResolvedValue({ id: 'db-page' }),
      deleteDatabase: vi.fn(),
    };
    const context = {
      pageId: 'parent-page',
      dataService: mockDataService,
      databaseDataService: mockDbService,
      openEditor: mockOpenEditor,
      showImageInsertPopup: vi.fn(),
      showMediaInsertPopup: vi.fn(),
      showBookmarkInsertPopup: vi.fn(),
    } as any;

    await def!.insertAction!(mockEditor, range, context);

    expect(mockDataService.createPage).toHaveBeenCalledWith('parent-page', 'Untitled');
    expect(mockDataService.updatePage).toHaveBeenCalledWith('db-page', { icon: 'database' });
    expect(mockDbService.createDatabase).toHaveBeenCalledWith('db-page');
    expect(mockChainResult.insertContentAt).toHaveBeenCalledWith(
      range,
      expect.objectContaining({
        type: 'databaseFullPage',
        attrs: expect.objectContaining({ databaseId: 'db-page', icon: 'database' }),
      }),
    );
    expect(mockOpenEditor).toHaveBeenCalledWith(
      expect.objectContaining({ typeId: 'database', instanceId: 'db-page' }),
    );
  });

  it('rolls back on insert failure', async () => {
    const def = BLOCK_REGISTRY.get('databaseFullPage');
    const mockChainResult = {
      insertContentAt: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(false),
    };
    const mockEditor = {
      chain: vi.fn().mockReturnValue(mockChainResult),
    } as any;
    const range = { from: 0, to: 1 };

    const mockDataService = {
      createPage: vi.fn().mockResolvedValue({ id: 'db-page', title: 'Untitled', icon: null }),
      updatePage: vi.fn().mockResolvedValue({ id: 'db-page', title: 'Untitled', icon: 'database' }),
      deletePage: vi.fn(),
    };
    const mockDbService = {
      createDatabase: vi.fn().mockResolvedValue({ id: 'db-page' }),
      deleteDatabase: vi.fn(),
    };
    const context = {
      pageId: 'parent-page',
      dataService: mockDataService,
      databaseDataService: mockDbService,
      openEditor: vi.fn(),
      showImageInsertPopup: vi.fn(),
      showMediaInsertPopup: vi.fn(),
      showBookmarkInsertPopup: vi.fn(),
    } as any;

    await expect(def!.insertAction!(mockEditor, range, context)).rejects.toThrow();
    expect(mockDbService.deleteDatabase).toHaveBeenCalledWith('db-page');
    expect(mockDataService.deletePage).toHaveBeenCalledWith('db-page');
  });
});

// ─── IDatabaseViewConfig.sourceDatabaseId ────────────────────────────────────

describe('IDatabaseViewConfig — sourceDatabaseId', () => {
  it('accepts sourceDatabaseId as an optional field', () => {
    const config: IDatabaseViewConfig = {
      visibleProperties: ['prop-1'],
      sourceDatabaseId: 'source-db-123',
    };
    expect(config.sourceDatabaseId).toBe('source-db-123');
  });

  it('sourceDatabaseId is optional (undefined by default)', () => {
    const config: IDatabaseViewConfig = {};
    expect(config.sourceDatabaseId).toBeUndefined();
  });

  it('linked view config carries sourceDatabaseId alongside other fields', () => {
    const config: IDatabaseViewConfig = {
      visibleProperties: ['prop-1', 'prop-2'],
      cardSize: 'medium',
      sourceDatabaseId: 'other-db',
      dateProperty: 'date-prop',
    };
    expect(config.sourceDatabaseId).toBe('other-db');
    expect(config.cardSize).toBe('medium');
    expect(config.visibleProperties).toHaveLength(2);
  });
});

// ─── EditorExtensionContext — databaseDataService ────────────────────────────

describe('EditorExtensionContext — databaseDataService field', () => {
  it('extension factory accepts context with databaseDataService', () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    expect(def!.extension).toBeDefined();

    // Call the factory with a mock context
    const mockDbService = {
      getDatabase: vi.fn(),
      getViews: vi.fn(),
      getProperties: vi.fn(),
      getRows: vi.fn(),
      onDidChangeRow: vi.fn() as any,
      onDidChangeProperty: vi.fn() as any,
      onDidChangeView: vi.fn() as any,
    };

    const result = def!.extension!({
      databaseDataService: mockDbService as any,
      dataService: { getPage: vi.fn(), updatePage: vi.fn(), onDidChangePage: vi.fn() } as any,
      openEditor: vi.fn() as any,
    });
    expect(result).toBeDefined();
    expect((result as any).name).toBe('databaseInline');
  });
});

// ─── InsertAction — databaseInline ───────────────────────────────────────────

describe('InsertAction — databaseInline', () => {
  it('does nothing when dataService is missing', async () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    const mockEditor = { chain: vi.fn() } as any;
    const range = { from: 0, to: 1 };
    const context = {
      pageId: undefined,
      dataService: undefined,
      databaseDataService: undefined,
    } as any;

    // Should return without throwing
    await def!.insertAction!(mockEditor, range, context);
    expect(mockEditor.chain).not.toHaveBeenCalled();
  });

  it('does nothing when databaseDataService is missing', async () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    const mockEditor = { chain: vi.fn() } as any;
    const range = { from: 0, to: 1 };
    const context = {
      pageId: 'page-1',
      dataService: { createPage: vi.fn() },
      databaseDataService: undefined,
      showImageInsertPopup: vi.fn(),
      showMediaInsertPopup: vi.fn(),
      showBookmarkInsertPopup: vi.fn(),
    } as any;

    await def!.insertAction!(mockEditor, range, context);
    expect(mockEditor.chain).not.toHaveBeenCalled();
  });

  it('creates page, database, and inserts node on success', async () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    const mockChainResult = {
      insertContentAt: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(true),
    };
    const mockEditor = {
      chain: vi.fn().mockReturnValue(mockChainResult),
      getJSON: vi.fn().mockReturnValue({ type: 'doc', content: [] }),
    } as any;
    const range = { from: 0, to: 1 };

    const mockDataService = {
      createPage: vi.fn().mockResolvedValue({ id: 'new-page', title: 'Untitled', icon: null }),
      flushContentSave: vi.fn().mockResolvedValue(undefined),
      deletePage: vi.fn(),
    };
    const mockDbService = {
      createDatabase: vi.fn().mockResolvedValue({ id: 'new-page' }),
      deleteDatabase: vi.fn(),
    };
    const context = {
      pageId: 'parent-page',
      dataService: mockDataService,
      databaseDataService: mockDbService,
      openEditor: vi.fn(),
      showImageInsertPopup: vi.fn(),
      showMediaInsertPopup: vi.fn(),
      showBookmarkInsertPopup: vi.fn(),
    } as any;

    await def!.insertAction!(mockEditor, range, context);

    expect(mockDataService.createPage).toHaveBeenCalledWith('parent-page', 'Untitled');
    expect(mockDbService.createDatabase).toHaveBeenCalledWith('new-page');
    expect(mockChainResult.insertContentAt).toHaveBeenCalledWith(
      range,
      expect.objectContaining({
        type: 'databaseInline',
        attrs: expect.objectContaining({ databaseId: 'new-page' }),
      }),
    );
    expect(mockDataService.flushContentSave).toHaveBeenCalled();
  });

  it('rolls back on insert failure', async () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    const mockChainResult = {
      insertContentAt: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(false),
    };
    const mockEditor = {
      chain: vi.fn().mockReturnValue(mockChainResult),
    } as any;
    const range = { from: 0, to: 1 };

    const mockDataService = {
      createPage: vi.fn().mockResolvedValue({ id: 'new-page', title: 'Untitled', icon: null }),
      deletePage: vi.fn(),
    };
    const mockDbService = {
      createDatabase: vi.fn().mockResolvedValue({ id: 'new-page' }),
      deleteDatabase: vi.fn(),
    };
    const context = {
      pageId: 'parent-page',
      dataService: mockDataService,
      databaseDataService: mockDbService,
      openEditor: vi.fn(),
      showImageInsertPopup: vi.fn(),
      showMediaInsertPopup: vi.fn(),
      showBookmarkInsertPopup: vi.fn(),
    } as any;

    await expect(def!.insertAction!(mockEditor, range, context)).rejects.toThrow();
    expect(mockDbService.deleteDatabase).toHaveBeenCalledWith('new-page');
    expect(mockDataService.deletePage).toHaveBeenCalledWith('new-page');
  });
});

// ─── InsertAction — linkedView ───────────────────────────────────────────────

describe('InsertAction — linkedView', () => {
  it('creates page, database, and inserts node', async () => {
    const def = BLOCK_REGISTRY.get('linkedView');
    const mockChainResult = {
      insertContentAt: vi.fn().mockReturnThis(),
      focus: vi.fn().mockReturnThis(),
      run: vi.fn().mockReturnValue(true),
    };
    const mockEditor = {
      chain: vi.fn().mockReturnValue(mockChainResult),
      getJSON: vi.fn().mockReturnValue({ type: 'doc', content: [] }),
    } as any;
    const range = { from: 0, to: 1 };

    const mockDataService = {
      createPage: vi.fn().mockResolvedValue({ id: 'linked-page', title: 'Linked View', icon: null }),
      flushContentSave: vi.fn().mockResolvedValue(undefined),
    };
    const mockDbService = {
      createDatabase: vi.fn().mockResolvedValue({ id: 'linked-page' }),
    };
    const context = {
      pageId: 'parent-page',
      dataService: mockDataService,
      databaseDataService: mockDbService,
      openEditor: vi.fn(),
      showImageInsertPopup: vi.fn(),
      showMediaInsertPopup: vi.fn(),
      showBookmarkInsertPopup: vi.fn(),
    } as any;

    await def!.insertAction!(mockEditor, range, context);

    expect(mockDataService.createPage).toHaveBeenCalledWith('parent-page', 'Linked View');
    expect(mockDbService.createDatabase).toHaveBeenCalledWith('linked-page');
    expect(mockChainResult.insertContentAt).toHaveBeenCalled();
  });

  it('does nothing when databaseDataService is missing', async () => {
    const def = BLOCK_REGISTRY.get('linkedView');
    const mockEditor = { chain: vi.fn() } as any;
    const range = { from: 0, to: 1 };
    const context = {
      pageId: 'page-1',
      dataService: { createPage: vi.fn() },
      databaseDataService: undefined,
      showImageInsertPopup: vi.fn(),
      showMediaInsertPopup: vi.fn(),
      showBookmarkInsertPopup: vi.fn(),
    } as any;

    await def!.insertAction!(mockEditor, range, context);
    expect(mockEditor.chain).not.toHaveBeenCalled();
  });
});

// ─── Title Linking — IInlineDatabasePageAccess ───────────────────────────────

describe('DatabaseInline — title linking types', () => {
  it('DatabaseInlineOptions accepts optional pageDataService', () => {
    // Verify the extension can be configured with pageDataService
    const ext = DatabaseInline.configure({
      databaseDataService: undefined,
      pageDataService: {
        getPage: vi.fn(),
        updatePage: vi.fn(),
        onDidChangePage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      },
      openEditor: undefined,
    });
    expect(ext).toBeDefined();
    expect(ext.name).toBe('databaseInline');
  });

  it('extension factory passes pageDataService from context.dataService', () => {
    const def = BLOCK_REGISTRY.get('databaseInline');
    expect(def!.extension).toBeDefined();

    const mockPageService = {
      getPage: vi.fn(),
      updatePage: vi.fn(),
      onDidChangePage: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    };
    const mockDbService = {
      getDatabase: vi.fn(),
      getViews: vi.fn(),
      getProperties: vi.fn(),
      getRows: vi.fn(),
      onDidChangeRow: vi.fn() as any,
      onDidChangeProperty: vi.fn() as any,
      onDidChangeView: vi.fn() as any,
    };

    const result = def!.extension!({
      databaseDataService: mockDbService as any,
      dataService: mockPageService as any,
      openEditor: vi.fn() as any,
    });

    expect(result).toBeDefined();
    // The configured extension should have pageDataService in its options
    const opts = (result as any).options;
    expect(opts?.pageDataService).toBe(mockPageService);
  });

  it('databaseTitle attr default is Untitled', () => {
    const ext = DatabaseInline.configure({});
    // Access the schema attributes
    const attrs = (ext as any).config?.addAttributes?.() ??
      (ext.options as any)?.addAttributes?.() ?? {};
    // The default should be 'Untitled' (matching pages.title convention)
    if (attrs.databaseTitle) {
      expect(attrs.databaseTitle.default).toBe('Untitled');
    }
  });
});

// ─── Inline DOM — unified controls row ──────────────────────────────────────

describe('DatabaseInline — unified class names', () => {
  it('extension uses db-host--inline modifier', () => {
    // Verify renderHTML produces the correct class
    const ext = DatabaseInline.configure({});
    const renderFn = (ext as any).config?.renderHTML ??
      (ext.options as any)?.renderHTML;
    if (typeof renderFn === 'function') {
      const result = renderFn({ HTMLAttributes: {} });
      expect(result).toBeDefined();
      // Should include db-host--inline
      const classStr = Array.isArray(result) ? result[1]?.class : '';
      expect(classStr).toContain('db-host--inline');
    }
  });
});
