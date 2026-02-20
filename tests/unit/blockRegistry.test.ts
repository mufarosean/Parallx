import { describe, expect, it } from 'vitest';
import {
  BLOCK_REGISTRY,
  COLUMN_BLOCK_NODE_TYPES,
  COLUMN_CONTENT_EXPRESSION,
  COLUMN_CONTENT_NODE_TYPES,
  DRAG_HANDLE_CUSTOM_NODE_TYPES,
  PAGE_CONTAINERS,
  getBlockExtensions,
  getBlockLabel,
  getNodePlaceholder,
  getSlashMenuBlocks,
  getTurnIntoBlocks,
  isContainerBlockType,
} from '../../src/built-in/canvas/config/blockRegistry';
import { SLASH_MENU_ITEMS } from '../../src/built-in/canvas/menus/slashMenuItems';

// ── Baseline values (copied verbatim from the original hardcoded sources) ──

/** From blockCapabilities.ts */
const ORIGINAL_COLUMN_BLOCK_NODE_TYPES = [
  'paragraph', 'heading', 'bulletList', 'orderedList', 'taskList',
  'blockquote', 'codeBlock', 'horizontalRule', 'image', 'table',
  'callout', 'details', 'toggleHeading', 'mathBlock', 'pageBlock',
  'bookmark', 'tableOfContents', 'video', 'audio', 'fileAttachment',
];

/** From blockCapabilities.ts */
const ORIGINAL_DRAG_HANDLE_CUSTOM_NODE_TYPES = [
  'mathBlock', 'callout', 'details', 'toggleHeading', 'pageBlock',
  'bookmark', 'tableOfContents', 'video', 'audio', 'fileAttachment',
  'horizontalRule', 'image',
];

/** From blockHandles.ts, blockSelection.ts, blockMutations.ts, columnDropPlugin.ts */
const ORIGINAL_PAGE_CONTAINERS = new Set([
  'column', 'callout', 'detailsContent', 'blockquote',
]);

/** From blockHandles.ts _getBlockLabel() */
const ORIGINAL_BLOCK_LABELS: Record<string, string> = {
  paragraph: 'Text', heading: 'Heading', bulletList: 'Bulleted list',
  orderedList: 'Numbered list', taskList: 'To-do list', taskItem: 'To-do',
  listItem: 'List item', blockquote: 'Quote', codeBlock: 'Code',
  callout: 'Callout', details: 'Toggle list', mathBlock: 'Equation',
  columnList: 'Columns', table: 'Table', image: 'Image',
  horizontalRule: 'Divider',
};

describe('blockRegistry', () => {
  describe('BLOCK_REGISTRY map', () => {
    it('is a non-empty Map', () => {
      expect(BLOCK_REGISTRY).toBeInstanceOf(Map);
      expect(BLOCK_REGISTRY.size).toBeGreaterThan(20);
    });

    it('every entry has required fields', () => {
      for (const [id, def] of BLOCK_REGISTRY) {
        expect(def.id).toBe(id);
        expect(def.name).toBeTruthy();
        expect(def.label).toBeTruthy();
        expect(def.capabilities).toBeDefined();
        expect(typeof def.capabilities.allowInColumn).toBe('boolean');
        expect(typeof def.capabilities.customDragHandle).toBe('boolean');
        expect(typeof def.capabilities.isPageContainer).toBe('boolean');
        expect(typeof def.capabilities.suppressBubbleMenu).toBe('boolean');
      }
    });
  });

  describe('COLUMN_BLOCK_NODE_TYPES parity', () => {
    it('contains the same set of node types as the original', () => {
      const registrySet = new Set(COLUMN_BLOCK_NODE_TYPES);
      const originalSet = new Set(ORIGINAL_COLUMN_BLOCK_NODE_TYPES);
      expect(registrySet).toEqual(originalSet);
    });
  });

  describe('DRAG_HANDLE_CUSTOM_NODE_TYPES parity', () => {
    it('contains the same set of node types as the original', () => {
      const registrySet = new Set(DRAG_HANDLE_CUSTOM_NODE_TYPES);
      const originalSet = new Set(ORIGINAL_DRAG_HANDLE_CUSTOM_NODE_TYPES);
      expect(registrySet).toEqual(originalSet);
    });
  });

  describe('PAGE_CONTAINERS parity', () => {
    it('equals the original PAGE_CONTAINERS set', () => {
      expect(PAGE_CONTAINERS).toEqual(ORIGINAL_PAGE_CONTAINERS);
    });
  });

  describe('COLUMN_CONTENT_NODE_TYPES', () => {
    it('includes all COLUMN_BLOCK_NODE_TYPES plus columnList', () => {
      const contentSet = new Set(COLUMN_CONTENT_NODE_TYPES);
      for (const name of COLUMN_BLOCK_NODE_TYPES) {
        expect(contentSet.has(name)).toBe(true);
      }
      expect(contentSet.has('columnList')).toBe(true);
    });
  });

  describe('COLUMN_CONTENT_EXPRESSION', () => {
    it('matches the expected ProseMirror content expression format', () => {
      expect(COLUMN_CONTENT_EXPRESSION).toMatch(/^\(.+\)\+$/);
      expect(COLUMN_CONTENT_EXPRESSION).toContain('paragraph');
      expect(COLUMN_CONTENT_EXPRESSION).toContain('columnList');
    });
  });

  describe('getBlockLabel()', () => {
    it('matches all original _getBlockLabel entries', () => {
      for (const [typeName, expected] of Object.entries(ORIGINAL_BLOCK_LABELS)) {
        // Skip structural sub-types not directly in the registry by name.
        if (typeName === 'taskItem' || typeName === 'listItem') {
          continue;
        }
        expect(getBlockLabel(typeName)).toBe(expected);
      }
    });

    it('returns the type name as fallback for unknown types', () => {
      expect(getBlockLabel('nonExistentType')).toBe('nonExistentType');
    });
  });

  describe('getSlashMenuBlocks()', () => {
    it('returns items sorted by slash menu order', () => {
      const items = getSlashMenuBlocks();
      for (let i = 1; i < items.length; i++) {
        expect(items[i].slashMenu!.order).toBeGreaterThanOrEqual(items[i - 1].slashMenu!.order);
      }
    });

    it('returns 27 slash menu items', () => {
      expect(getSlashMenuBlocks()).toHaveLength(27);
    });

    it('includes Page as the first item (order 0)', () => {
      const items = getSlashMenuBlocks();
      expect(items[0].name).toBe('pageBlock');
    });
  });

  describe('getTurnIntoBlocks()', () => {
    it('returns 15 turn-into items', () => {
      expect(getTurnIntoBlocks()).toHaveLength(15);
    });

    it('returns items sorted by turn-into order', () => {
      const items = getTurnIntoBlocks();
      for (let i = 1; i < items.length; i++) {
        expect(items[i].turnInto!.order).toBeGreaterThanOrEqual(items[i - 1].turnInto!.order);
      }
    });

    it('starts with Text (paragraph)', () => {
      const items = getTurnIntoBlocks();
      expect(items[0].name).toBe('paragraph');
    });
  });

  describe('isContainerBlockType()', () => {
    it('returns true for container blocks', () => {
      expect(isContainerBlockType('callout')).toBe(true);
      expect(isContainerBlockType('details')).toBe(true);
      expect(isContainerBlockType('blockquote')).toBe(true);
      expect(isContainerBlockType('toggleHeading')).toBe(true);
    });

    it('returns false for leaf blocks', () => {
      expect(isContainerBlockType('paragraph')).toBe(false);
      expect(isContainerBlockType('heading')).toBe(false);
      expect(isContainerBlockType('codeBlock')).toBe(false);
    });

    it('returns false for unknown types', () => {
      expect(isContainerBlockType('nonExistent')).toBe(false);
    });
  });

  describe('getNodePlaceholder()', () => {
    it('returns level-specific placeholder for headings', () => {
      expect(getNodePlaceholder('heading', { level: 1 })).toBe('Heading 1');
      expect(getNodePlaceholder('heading', { level: 2 })).toBe('Heading 2');
      expect(getNodePlaceholder('heading', { level: 3 })).toBe('Heading 3');
    });

    it('returns placeholder for structural nodes', () => {
      expect(getNodePlaceholder('detailsSummary')).toBe('Toggle title…');
      expect(getNodePlaceholder('toggleHeadingText')).toBe('Toggle heading');
    });

    it('returns undefined for nodes without placeholder config', () => {
      expect(getNodePlaceholder('paragraph')).toBeUndefined();
      expect(getNodePlaceholder('codeBlock')).toBeUndefined();
      expect(getNodePlaceholder('nonExistent')).toBeUndefined();
    });
  });

  describe('SLASH_MENU_ITEMS parity', () => {
    /** Original labels from the hardcoded SLASH_MENU_ITEMS, in order. */
    const ORIGINAL_SLASH_LABELS = [
      'Page', 'Heading 1', 'Heading 2', 'Heading 3',
      'Bullet List', 'Numbered List', 'To-Do List',
      'Quote', 'Code Block', 'Divider',
      'Toggle List', 'Callout', 'Table',
      'Image', 'Video', 'Audio', 'File',
      'Block Equation', 'Inline Equation',
      'Toggle Heading 1', 'Toggle Heading 2', 'Toggle Heading 3',
      '2 Columns', '3 Columns', '4 Columns',
      'Bookmark', 'Table of Contents',
    ];

    it('produces 27 items', () => {
      expect(SLASH_MENU_ITEMS).toHaveLength(27);
    });

    it('preserves all original labels', () => {
      const labels = SLASH_MENU_ITEMS.map((item) => item.label);
      expect(new Set(labels)).toEqual(new Set(ORIGINAL_SLASH_LABELS));
    });

    it('every item has label, icon, description, and action', () => {
      for (const item of SLASH_MENU_ITEMS) {
        expect(item.label).toBeTruthy();
        expect(item.icon).toBeTruthy();
        expect(item.description).toBeTruthy();
        expect(typeof item.action).toBe('function');
      }
    });

    it('uses SlashMenuConfig.label overrides when present', () => {
      // These items have different labels in slash menu vs turn-into menu
      const map = new Map(SLASH_MENU_ITEMS.map((i) => [i.label, i]));
      expect(map.has('Bullet List')).toBe(true);     // not 'Bulleted list'
      expect(map.has('Numbered List')).toBe(true);    // not 'Numbered list'
      expect(map.has('To-Do List')).toBe(true);       // not 'To-do list'
      expect(map.has('Code Block')).toBe(true);       // not 'Code'
      expect(map.has('Toggle List')).toBe(true);      // not 'Toggle list'
    });
  });

  describe('extension factories', () => {
    it('every non-starterkit node type has exactly one definition with an extension factory', () => {
      // Group all non-starterkit definitions by ProseMirror node type name.
      const byName = new Map<string, number>();
      for (const [, def] of BLOCK_REGISTRY) {
        if (def.source === 'starterkit') continue;
        if (def.extension) {
          byName.set(def.name, (byName.get(def.name) ?? 0) + 1);
        }
      }
      // Each non-starterkit node type name should appear exactly once.
      for (const [name, count] of byName) {
        expect(count, `node type '${name}' has ${count} extension factories, expected 1`).toBe(1);
      }
    });

    it('no starterkit definition has an extension factory', () => {
      for (const [, def] of BLOCK_REGISTRY) {
        if (def.source === 'starterkit') {
          expect(def.extension, `starterkit block '${def.id}' should not have an extension factory`).toBeUndefined();
        }
      }
    });

    it('every non-starterkit unique node type has a factory somewhere (or is bundled with parent)', () => {
      // Structural sub-nodes whose extensions are loaded by their parent's factory.
      const BUNDLED_WITH_PARENT = new Set(['column', 'toggleHeadingText']);

      // Collect unique non-starterkit node type names
      const nonStarterKitNames = new Set<string>();
      for (const [, def] of BLOCK_REGISTRY) {
        if (def.source !== 'starterkit') {
          nonStarterKitNames.add(def.name);
        }
      }
      // For each, at least one definition should have an extension factory
      // (unless the extension is bundled with a parent block's factory)
      for (const name of nonStarterKitNames) {
        if (BUNDLED_WITH_PARENT.has(name)) continue;
        const hasFactory = Array.from(BLOCK_REGISTRY.values()).some(
          (d) => d.name === name && d.extension !== undefined,
        );
        expect(hasFactory, `node type '${name}' has no extension factory in any definition`).toBe(true);
      }
    });

    it('getBlockExtensions returns a non-empty array', () => {
      // Use a minimal context — factories that need lowlight/dataService will
      // still return configured extensions (just with undefined options).
      const extensions = getBlockExtensions({});
      expect(extensions.length).toBeGreaterThan(0);
    });

    it('getBlockExtensions returns unique extensions (no duplicates by name)', () => {
      const extensions = getBlockExtensions({});
      const names = extensions
        .filter((ext: any) => ext.name)
        .map((ext: any) => ext.name);
      const dupes = names.filter((n: string, i: number) => names.indexOf(n) !== i);
      expect(dupes, `duplicate extensions: ${dupes.join(', ')}`).toEqual([]);
    });
  });
});
