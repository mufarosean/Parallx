// databaseTools.ts — AI tools over the Notion-style database system.
//
//   canvas_create_database   — create a database (optionally nested) with a schema
//   canvas_add_database_row  — add a row with property values (by property name)
//   canvas_query_database    — filtered/sorted rows as a markdown table (read-only)
//
// All operate through DatabaseDataService, so events fire and any open
// database editor updates live.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type { DatabaseDataService } from '../database/databaseDataService.js';
import type { FilterOp, IFilterRule, ISortRule } from '../database/databaseTypes.js';
import { TITLE_KEY } from '../database/databaseTypes.js';
import { applyFilter, applySort } from '../database/databaseViewModel.js';
import type { PropertyType } from '../properties/propertyTypes.js';

const VALID_TYPES: PropertyType[] = ['text', 'number', 'checkbox', 'date', 'datetime', 'tags', 'select', 'url'];
const VALID_OPS: FilterOp[] = ['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty', 'greater_than', 'less_than'];

export function createDatabaseTools(db: DatabaseDataService): IChatTool[] {
  return [
    {
      name: 'canvas_create_database',
      displaySummary: 'Create a Notion-style database.',
      description:
        'CREATE a database (a special canvas page with typed columns, table/board views, and rows that are pages). ' +
        'Optionally nest it under an existing page via `parentId`. Provide `properties` to define columns beyond ' +
        'the seeded Status select. Rows are added with `canvas_add_database_row`.',
      parameters: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', description: 'Database title.' },
          parentId: { type: 'string', description: 'Optional UUID of an existing page to nest the database under.' },
          properties: {
            type: 'array',
            description: 'Additional columns. Each: {name, type, options?}. Types: text, number, checkbox, date, datetime, tags, select, url. options (for select/tags): array of option names.',
            items: {
              type: 'object',
              required: ['name', 'type'],
              properties: {
                name: { type: 'string' },
                type: { type: 'string', enum: VALID_TYPES },
                options: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      requiresConfirmation: true,
      permissionLevel: 'requires-approval' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
        const title = String(args['title'] ?? '').trim();
        if (!title) return { content: 'title is required', isError: true };
        const parentId = typeof args['parentId'] === 'string' && args['parentId'].trim() ? (args['parentId'] as string).trim() : undefined;
        const info = await db.createDatabase({ title, parentId });
        const extra = Array.isArray(args['properties']) ? (args['properties'] as { name?: unknown; type?: unknown; options?: unknown }[]) : [];
        const added: string[] = [];
        for (const p of extra) {
          const name = String(p?.name ?? '').trim();
          const type = String(p?.type ?? '') as PropertyType;
          if (!name || !VALID_TYPES.includes(type)) continue;
          const colors = ['blue', 'green', 'orange', 'purple', 'pink', 'yellow', 'red', 'brown', 'gray'];
          const config = (type === 'select' || type === 'tags') && Array.isArray(p.options)
            ? { options: (p.options as unknown[]).map((o, i) => ({ value: String(o), color: colors[i % colors.length] })) }
            : {};
          await db.addProperty(info.id, name, type, config);
          added.push(name);
        }
        return {
          content: `Created database "${title}" (id: ${info.id})${parentId ? ` under ${parentId}` : ''} with columns: Status${added.length ? ', ' + added.join(', ') : ''}. Add rows with canvas_add_database_row.`,
        };
      },
    },
    {
      name: 'canvas_add_database_row',
      displaySummary: 'Add a row to a database.',
      description:
        'ADD a row to an existing database (by database UUID). The row is a page; pass `values` keyed by PROPERTY ' +
        'NAME to fill cells (select/tags values must match existing options or they are stored as-is). ' +
        'Find databases + property names with canvas_query_database or canvas_find_pages.',
      parameters: {
        type: 'object',
        required: ['databaseId', 'title'],
        properties: {
          databaseId: { type: 'string', description: 'UUID of the database.' },
          title: { type: 'string', description: 'Row title (the page title).' },
          values: { type: 'object', description: 'Cell values keyed by property NAME, e.g. {"Status": "Done", "Estimate": 5}.' },
        },
      },
      requiresConfirmation: true,
      permissionLevel: 'requires-approval' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
        const databaseId = String(args['databaseId'] ?? '').trim();
        const title = String(args['title'] ?? '').trim();
        if (!databaseId || !title) return { content: 'databaseId and title are required', isError: true };
        const info = await db.getDatabase(databaseId);
        if (!info) return { content: `Database not found: ${databaseId}`, isError: true };
        const props = await db.listProperties(databaseId);
        const row = await db.addRow(databaseId, title);
        const set: string[] = [];
        const unknown: string[] = [];
        const values = (args['values'] && typeof args['values'] === 'object') ? (args['values'] as Record<string, unknown>) : {};
        for (const [name, value] of Object.entries(values)) {
          const prop = props.find((p) => p.name.toLowerCase() === name.toLowerCase());
          if (!prop) { unknown.push(name); continue; }
          const coerced = prop.type === 'tags' && !Array.isArray(value) ? [value] : value;
          await db.setCellValue(databaseId, row.pageId, prop.id, coerced);
          set.push(prop.name);
        }
        const parts = [`Added row "${title}" (page id: ${row.pageId}) to "${info.title}"${set.length ? ` with ${set.join(', ')}` : ''}.`];
        if (unknown.length) parts.push(`Unknown properties skipped: ${unknown.join(', ')}.`);
        return { content: parts.join(' ') };
      },
    },
    {
      name: 'canvas_add_page_to_database',
      displaySummary: 'Make a database the home of an existing page.',
      description:
        'Set an EXISTING page\'s HOME database — the page becomes a row of it and the database\'s schema ' +
        'becomes the page\'s properties. The page keeps its place in the sidebar tree. A page has at most ' +
        'ONE home; this fails (with the current home named) if the page already belongs to another database. ' +
        'After this, set its cells with canvas_set_page_property. ' +
        'Use canvas_add_database_row instead when the row page should be created fresh.',
      parameters: {
        type: 'object',
        required: ['databaseId', 'pageId'],
        properties: {
          databaseId: { type: 'string', description: 'UUID of the database.' },
          pageId: { type: 'string', description: 'UUID of the existing page to add.' },
        },
      },
      requiresConfirmation: true,
      permissionLevel: 'requires-approval' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
        const databaseId = String(args['databaseId'] ?? '').trim();
        const pageId = String(args['pageId'] ?? '').trim();
        if (!databaseId || !pageId) return { content: 'databaseId and pageId are required', isError: true };
        const info = await db.getDatabase(databaseId);
        if (!info) return { content: `Database not found: ${databaseId}`, isError: true };
        try {
          await db.addExistingPageAsRow(databaseId, pageId);
        } catch (err) {
          return { content: err instanceof Error ? err.message : String(err), isError: true };
        }
        return { content: `"${info.title}" is now the home database of page ${pageId} (its schema is the page's properties). Tree position unchanged.` };
      },
    },
    {
      name: 'canvas_query_database',
      displaySummary: 'Query a database (filter/sort rows).',
      description:
        'READ rows from a database as a markdown table. Optional `filter` rules (by property NAME or "title") with ' +
        'ops equals/not_equals/contains/greater_than/less_than/is_empty/is_not_empty, and `sort` {property, dir}. ' +
        'Use this to inspect schema + rows before adding or editing.',
      parameters: {
        type: 'object',
        required: ['databaseId'],
        properties: {
          databaseId: { type: 'string', description: 'UUID of the database.' },
          filter: {
            type: 'array',
            items: {
              type: 'object',
              required: ['property', 'op'],
              properties: {
                property: { type: 'string', description: 'Property NAME, or "title".' },
                op: { type: 'string', enum: VALID_OPS },
                value: { description: 'Comparison value (omit for is_empty/is_not_empty).' },
              },
            },
          },
          sort: {
            type: 'object',
            properties: {
              property: { type: 'string', description: 'Property NAME, or "title".' },
              dir: { type: 'string', enum: ['asc', 'desc'] },
            },
          },
        },
      },
      requiresConfirmation: false,
      permissionLevel: 'always-allowed' as ToolPermissionLevel,
      category: 'canvas',
      async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
        const databaseId = String(args['databaseId'] ?? '').trim();
        const info = await db.getDatabase(databaseId);
        if (!info) return { content: `Database not found: ${databaseId}`, isError: true };
        const props = await db.listProperties(databaseId);
        const byName = (name: string): string =>
          name.toLowerCase() === 'title' || name.toLowerCase() === 'name'
            ? TITLE_KEY
            : (props.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? name);

        let rows = await db.listRows(databaseId);
        if (Array.isArray(args['filter'])) {
          const rules: IFilterRule[] = (args['filter'] as { property?: unknown; op?: unknown; value?: unknown }[])
            .filter((f) => f && typeof f.property === 'string' && VALID_OPS.includes(f.op as FilterOp))
            .map((f) => ({ propertyId: byName(f.property as string), op: f.op as FilterOp, value: f.value }));
          rows = applyFilter(rows, { conjunction: 'and', rules });
        }
        const sortArg = args['sort'] as { property?: unknown; dir?: unknown } | undefined;
        if (sortArg && typeof sortArg.property === 'string') {
          const rule: ISortRule = { propertyId: byName(sortArg.property), dir: sortArg.dir === 'desc' ? 'desc' : 'asc' };
          rows = applySort(rows, [rule]);
        }

        const header = ['Title', ...props.map((p) => p.name), 'pageId'];
        const lines = [
          `Database "${info.title}" (id: ${info.id}) — ${rows.length} row(s):`,
          `| ${header.join(' | ')} |`,
          `| ${header.map(() => '---').join(' | ')} |`,
        ];
        for (const r of rows.slice(0, 100)) {
          const cells = [r.title, ...props.map((p) => {
            const v = r.values[p.id];
            return v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v);
          }), r.pageId];
          lines.push(`| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`);
        }
        if (rows.length > 100) lines.push(`… ${rows.length - 100} more rows truncated.`);
        return { content: lines.join('\n') };
      },
    },
  ];
}
