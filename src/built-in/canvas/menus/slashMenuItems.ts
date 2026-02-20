// slashMenuItems.ts — Slash command menu item definitions
//
// Each action receives the editor and the **block range** covering the
// entire paragraph node (including its boundaries).  Actions use
// `insertContentAt(range, nodeJSON)` to atomically REPLACE the paragraph
// with the desired block structure — this is the same pattern TipTap's
// own `setDetails()` command uses internally.  NO deleteRange needed.
//
// Block metadata (label, icon, description, order) is read from the
// centralized block registry.  Only custom actions (async popups,
// cursor placement, column creation) are defined here.

import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { showImageInsertPopup } from './imageInsertPopup.js';
import { showMediaInsertPopup } from './mediaInsertPopup.js';
import { showBookmarkInsertPopup } from './bookmarkInsertPopup.js';
import type { CanvasDataService } from '../canvasDataService.js';
import { encodeCanvasContentFromDoc } from '../contentSchema.js';
import { BLOCK_REGISTRY, getSlashMenuBlocks, type BlockDefinition } from '../config/blockRegistry.js';

export interface SlashActionContext {
  readonly pageId?: string;
  readonly dataService?: CanvasDataService;
  readonly openEditor?: (options: { typeId: string; title: string; icon?: string; instanceId?: string }) => Promise<void>;
}

export interface SlashMenuItem {
  label: string;
  icon: string;
  description: string;
  action: (editor: Editor, range: { from: number; to: number }, context?: SlashActionContext) => void | Promise<void>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Insert content and place cursor inside a target child node. */
function insertAndFocusChild(
  editor: Editor,
  range: { from: number; to: number },
  content: Record<string, any>,
  targetNodeName: string,
  cursorOffset: number = 1,
): void {
  editor.chain().insertContentAt(range, content).run();
  const { doc } = editor.state;
  doc.nodesBetween(range.from, doc.content.size, (node, pos) => {
    if (node.type.name === targetNodeName) {
      editor.chain().setTextSelection(pos + cursorOffset).focus().run();
      return false;
    }
    return true;
  });
}

/** Replace a block with a columnList containing N columns. */
function replaceBlockWithColumns(editor: Editor, range: { from: number; to: number }, columnCount: number): void {
  const { schema } = editor.state;
  const columnType = schema.nodes.column;
  const columnListType = schema.nodes.columnList;
  const paragraphType = schema.nodes.paragraph;

  if (!columnType || !columnListType || !paragraphType || columnCount < 2) {
    return;
  }

  const columns: any[] = [];
  for (let i = 0; i < columnCount; i++) {
    const paragraph = paragraphType.createAndFill();
    if (!paragraph) return;
    columns.push(columnType.create({ width: null }, [paragraph]));
  }

  const columnList = columnListType.create(null, columns);
  const tr = editor.state.tr.replaceWith(range.from, range.to, columnList);
  const selectionPos = Math.min(range.from + 3, tr.doc.content.size);
  tr.setSelection(TextSelection.near(tr.doc.resolve(selectionPos), 1));
  editor.view.dispatch(tr);
  editor.commands.focus();
}

// ── Custom actions — blocks that need special insertion logic ────────────────
// Keyed by BlockDefinition.id.  Blocks not listed here use the simple
// `insertContentAt(range, def.defaultContent).focus().run()` path.

type SlashAction = SlashMenuItem['action'];

const CUSTOM_ACTIONS: Record<string, SlashAction> = {

  // Page — async page creation + parent doc save + navigation
  'pageBlock': async (editor, range, context) => {
    if (!context?.dataService || !context.pageId) return;

    let child: Awaited<ReturnType<CanvasDataService['createPage']>> | null = null;
    try {
      child = await context.dataService.createPage(context.pageId, 'Untitled');
      const childPage = child;
      const pageBlockAttrs = {
        pageId: childPage.id,
        title: childPage.title,
        icon: childPage.icon,
        parentPageId: context.pageId,
      };

      let inserted = editor
        .chain()
        .insertContentAt(range, {
          type: 'pageBlock',
          attrs: pageBlockAttrs,
        })
        .focus()
        .run();

      if (!inserted) {
        const pageBlockType = editor.state.schema.nodes.pageBlock;
        if (!pageBlockType) {
          throw new Error('pageBlock schema node is unavailable');
        }
        const node = pageBlockType.create(pageBlockAttrs);
        const tr = editor.state.tr.replaceWith(range.from, range.to, node);
        editor.view.dispatch(tr);
        editor.commands.focus();
        inserted = true;
      }

      if (!inserted) {
        throw new Error('Failed to insert pageBlock');
      }

      const docJson = editor.getJSON();
      const hasInsertedPageBlock = Array.isArray(docJson?.content)
        && docJson.content.some((node: any) => node?.type === 'pageBlock' && node?.attrs?.pageId === childPage.id);
      if (!hasInsertedPageBlock) {
        throw new Error('Inserted pageBlock not found in parent doc');
      }

      const encoded = encodeCanvasContentFromDoc(docJson);
      await context.dataService.updatePage(context.pageId, {
        content: encoded.storedContent,
        contentSchemaVersion: encoded.schemaVersion,
      });

      // Replace any stale pending save (e.g. literal '/page' text) with final parent snapshot
      // before navigation potentially disposes this editor pane.
      context.dataService.scheduleContentSave(context.pageId, JSON.stringify(docJson));

      if (context.openEditor) {
        await context.openEditor({
          typeId: 'canvas',
          title: childPage.title,
          icon: childPage.icon ?? undefined,
          instanceId: childPage.id,
        });
      }
    } catch (error) {
      if (child) {
        try {
          await context.dataService.deletePage(child.id);
        } catch {
          // Best-effort rollback only.
        }
      }
      throw error;
    }
  },

  // Callout — insert + cursor inside the callout paragraph
  'callout': (e, range) => {
    const def = BLOCK_REGISTRY.get('callout')!;
    insertAndFocusChild(e, range, def.defaultContent!, 'callout', 2);
  },

  // Toggle list — insert + cursor inside the detailsSummary
  'details': (e, range) => {
    const def = BLOCK_REGISTRY.get('details')!;
    insertAndFocusChild(e, range, def.defaultContent!, 'detailsSummary', 1);
  },

  // Table — complex 3×3 with header row
  'table': (e, range) => {
    const headerCells = Array.from({ length: 3 }, () => ({
      type: 'tableHeader', content: [{ type: 'paragraph' }],
    }));
    const bodyRow = () => ({
      type: 'tableRow',
      content: Array.from({ length: 3 }, () => ({
        type: 'tableCell', content: [{ type: 'paragraph' }],
      })),
    });
    e.chain().insertContentAt(range, {
      type: 'table',
      content: [{ type: 'tableRow', content: headerCells }, bodyRow(), bodyRow()],
    }).focus().run();
  },

  // Toggle headings — insert + cursor inside toggleHeadingText
  'toggleHeading-1': (e, range) => {
    const def = BLOCK_REGISTRY.get('toggleHeading-1')!;
    insertAndFocusChild(e, range, def.defaultContent!, 'toggleHeadingText', 1);
  },
  'toggleHeading-2': (e, range) => {
    const def = BLOCK_REGISTRY.get('toggleHeading-2')!;
    insertAndFocusChild(e, range, def.defaultContent!, 'toggleHeadingText', 1);
  },
  'toggleHeading-3': (e, range) => {
    const def = BLOCK_REGISTRY.get('toggleHeading-3')!;
    insertAndFocusChild(e, range, def.defaultContent!, 'toggleHeadingText', 1);
  },

  // Columns — ProseMirror-level schema construction
  'columnList-2': (e, range) => replaceBlockWithColumns(e, range, 2),
  'columnList-3': (e, range) => replaceBlockWithColumns(e, range, 3),
  'columnList-4': (e, range) => replaceBlockWithColumns(e, range, 4),

  // Media — popup-based insertion
  'image': (e, range) => showImageInsertPopup(e, range),
  'bookmark': (e, range) => showBookmarkInsertPopup(e, range),
  'video': (e, range) => showMediaInsertPopup(e, range, 'video'),
  'audio': (e, range) => showMediaInsertPopup(e, range, 'audio'),
  'fileAttachment': (e, range) => showMediaInsertPopup(e, range, 'fileAttachment'),
};

// ── Build SLASH_MENU_ITEMS from registry ────────────────────────────────────

export const SLASH_MENU_ITEMS: SlashMenuItem[] = getSlashMenuBlocks().map((def) => ({
  label: def.slashMenu!.label ?? def.label,
  icon: def.icon,
  description: def.slashMenu!.description,
  action: CUSTOM_ACTIONS[def.id] ??
    ((e: Editor, range: { from: number; to: number }) =>
      e.chain().insertContentAt(range, def.defaultContent!).focus().run()),
}));
