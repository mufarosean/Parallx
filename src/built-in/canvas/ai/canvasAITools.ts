// canvasAITools.ts — Canvas's AI tool contribution.
//
// M84: canvas owns the tools it exposes to the AI, the same way it owns its
// commands, views, and editor. Previously these page/block tools were created
// and registered inside the chat module, which coupled chat to the canvas data
// model. Now canvas registers them from its own activate() via this module.

import type { IDisposable } from '../../../platform/lifecycle.js';
import type { ILanguageModelToolsService, IChatTool } from '../../../services/chatTypes.js';
import type {
  IBuiltInToolDatabase,
  CurrentPageIdGetter,
  PageMutationNotifier,
} from '../../chat/chatTypes.js';
import type { CanvasTemplateApi } from '../canvasTemplates.js';
import {
  createFindPagesTool,
  createReadPageTool,
  createListTemplatesTool,
  createCreatePageTool,
  createEditPageTool,
  createMovePageTool,
  createListPropertyDefinitionsTool,
  createSetPagePropertyTool,
  createSetPageStyleTool,
  type StreamPageBodyFn,
  type MovePageFn,
  type NewPageLayoutDefaults,
} from './pageTools.js';
import { createBlockTools } from './blockTools.js';
import { createRelatePagesTool, type RelatePagesFn } from './relatePagesTool.js';
import { createDatabaseTools } from './databaseTools.js';
import type { DatabaseDataService } from '../database/databaseDataService.js';

/** Canvas's stable tool id — attributes the tools to canvas in the AI tool
 *  picker and the Tool Gallery membership view. */
export const CANVAS_TOOL_ID = 'parallx.canvas';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Resolve a canvas page id from an editor id (`*:canvas:<id>` or a bare UUID). */
export function canvasPageIdFromEditorId(editorId: string | undefined): string | undefined {
  if (!editorId) return undefined;
  const parts = editorId.split(':');
  if (parts.length >= 3 && (parts[1] === 'canvas' || parts[1] === 'database')) {
    return parts.slice(2).join(':');
  }
  return UUID_RE.test(editorId) ? editorId : undefined;
}

export interface ICanvasAIToolDeps {
  readonly toolsService: ILanguageModelToolsService;
  readonly db: IBuiltInToolDatabase | undefined;
  readonly getCurrentPageId: CurrentPageIdGetter;
  readonly workspaceRoot: string | undefined;
  readonly pageMutationNotifier?: PageMutationNotifier;
  /** Snapshot a page's current content into version history BEFORE a destructive
   *  AI edit, so a replace/overwrite is always revertable. Wired to the data
   *  service in canvas/main.ts. Omitted → no pre-edit checkpoint. */
  readonly pageCheckpoint?: (pageId: string) => void | Promise<void>;
  readonly templateApi?: CanvasTemplateApi;
  /** Nest related pages under a hub (canvas_relate_pages). Omitted → tool not
   *  registered. Implemented over the live data service in canvas/main.ts. */
  readonly relatePages?: RelatePagesFn;
  /** Stream the (already-known) body of a created/edited page into the open
   *  editor block-by-block. Omitted → create/edit write instantly. */
  readonly streamPageBody?: StreamPageBodyFn;
  /** Atomically create a SUB-page (page row + the parent's sub-page card in
   *  one transaction). Lets canvas_create_page accept parentId. */
  readonly createChildPage?: (parentId: string, title: string) => Promise<string>;
  /** Re-parent an existing page (atomic, keeps the pageBlock card in sync).
   *  Omitted → canvas_move_page is not registered. */
  readonly movePage?: MovePageFn;
  /** Layout defaults applied to AI-created pages (full-width / small-text).
   *  Omitted → new pages use the schema column defaults (off). */
  readonly getNewPageDefaults?: () => NewPageLayoutDefaults;
  /** Database engine — registers canvas_create_database / add_database_row /
   *  query_database when provided. */
  readonly databaseService?: DatabaseDataService;
}

/**
 * Register canvas's page + block AI tools, attributed to the canvas tool.
 * Returns disposables that deregister them.
 */
export function registerCanvasAITools(deps: ICanvasAIToolDeps): IDisposable[] {
  const { toolsService, db, getCurrentPageId, workspaceRoot, pageMutationNotifier, pageCheckpoint, templateApi, relatePages, streamPageBody, createChildPage, movePage, getNewPageDefaults, databaseService } = deps;

  const tools: IChatTool[] = [
    createFindPagesTool(db),
    createReadPageTool(db, getCurrentPageId),
    createListTemplatesTool(templateApi),
    createCreatePageTool(db, pageMutationNotifier, templateApi, createChildPage, streamPageBody, getNewPageDefaults),
    createEditPageTool(db, pageMutationNotifier, pageCheckpoint),
    ...(movePage ? [createMovePageTool(db, movePage)] : []),
    createListPropertyDefinitionsTool(db),
    createSetPagePropertyTool(db, databaseService ? (id) => databaseService.notifyRowsChanged(id) : undefined),
    createSetPageStyleTool(db, pageMutationNotifier, workspaceRoot),
    ...createBlockTools(db, pageMutationNotifier),
    ...(relatePages ? [createRelatePagesTool(relatePages)] : []),
    ...(databaseService ? createDatabaseTools(databaseService) : []),
  ];

  return tools.map((tool) =>
    toolsService.registerTool({ ...tool, ownerToolId: CANVAS_TOOL_ID }),
  );
}
