// dataviewNode.ts — M60 Phase δ T3 C4 — live property dataview block
//
// A leaf TipTap node that renders a live, filtered list of pages by
// running a property query against the canvas DB (via window.parallxElectron).
// The query is persisted in the node's `query` attribute (JSON-encoded
// IPropertyQuery shape — see src/built-in/chat/tools/blockApi.ts).
//
// Insertion paths:
//   • Agent: pages.insert_block_after with a block carrying type:'dataview'.
//   • UI: future slash-menu entry (deferred to T4).
//
// Re-render is triggered:
//   • on first mount,
//   • on PropertyDataService change events (set/removed/definition deleted),
//     surfaced through the global window.parallxElectron bridge (deferred —
//     for M60 the renderer simply re-runs the query when the user navigates
//     to or focuses the page; see CANVAS_BLOCK_API.md for the live-update
//     contract notes).
//
// Styling: uses --vscode-* tokens via canvas.css class hooks
// (`canvas-dataview`, `canvas-dataview-row`, `canvas-dataview-empty`).
// No inline styles.

import { Node, mergeAttributes } from '@tiptap/core';

interface DataviewQueryFilter {
  prop: string;
  op: string;
  value?: unknown;
}

interface DataviewQuery {
  filter: DataviewQueryFilter[];
  sort?: { by: string; dir?: 'asc' | 'desc' };
  group?: string;
  limit?: number;
}

interface DataviewBridge {
  all(sql: string, params?: unknown[]): Promise<{ error: { message: string } | null; rows?: Record<string, unknown>[] }>;
}

/**
 * Build the SQL fragments + params for a multi-filter property query.
 * Mirrors `filterToSubquery` in chat/tools/blockApi.ts but inlined here so
 * the canvas extension layer doesn't import from the chat layer
 * (gate compliance).
 */
export function buildDataviewSql(query: DataviewQuery): { sql: string; params: unknown[] } | null {
  if (!Array.isArray(query.filter) || query.filter.length === 0) return null;
  const subqueries: string[] = [];
  const params: unknown[] = [];
  for (const f of query.filter) {
    if (!f.prop || !f.op) continue;
    const sub = ['SELECT page_id FROM page_properties WHERE key = ?'];
    params.push(f.prop);
    switch (f.op) {
      case 'equals':
        sub.push('AND value = ?');
        params.push(JSON.stringify(f.value));
        break;
      case 'not_equals':
        sub.push('AND value != ?');
        params.push(JSON.stringify(f.value));
        break;
      case 'contains':
        sub.push("AND value LIKE ? ESCAPE '\\'");
        params.push(`%${String(f.value).replace(/[\\%_]/g, '\\$&')}%`);
        break;
      case 'is_empty':
        sub.push("AND (value IS NULL OR value = 'null' OR value = '\"\"' OR value = '[]')");
        break;
      case 'is_not_empty':
        sub.push("AND value IS NOT NULL AND value != 'null' AND value != '\"\"' AND value != '[]'");
        break;
      case 'greater_than':
        sub.push('AND CAST(value AS REAL) > ?');
        params.push(Number(f.value));
        break;
      case 'less_than':
        sub.push('AND CAST(value AS REAL) < ?');
        params.push(Number(f.value));
        break;
      default:
        return null;
    }
    subqueries.push(sub.join(' '));
  }
  if (subqueries.length === 0) return null;
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const dir = query.sort?.dir === 'asc' ? 'ASC' : 'DESC';
  let order = 'p.updated_at DESC';
  if (query.sort?.by === 'title') order = `p.title ${dir}`;
  else if (query.sort?.by === 'updated_at') order = `p.updated_at ${dir}`;
  else if (query.sort?.by === 'created_at') order = `p.created_at ${dir}`;
  const sql =
    `SELECT p.id, p.title FROM pages p WHERE p.is_archived = 0 AND p.id IN (` +
    subqueries.join(' INTERSECT ') +
    `) ORDER BY ${order} LIMIT ?`;
  params.push(limit);
  return { sql, params };
}

export function parseDataviewQuery(raw: unknown): DataviewQuery | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.filter)) return null;
    return parsed as DataviewQuery;
  } catch {
    return null;
  }
}

/** Render rows into a `<ul class="canvas-dataview">…</ul>` DOM node. */
export function renderDataviewRows(
  container: HTMLElement,
  rows: { id: string; title: string }[],
  emptyMessage = 'No pages match this query.',
): void {
  container.innerHTML = '';
  container.classList.add('canvas-dataview');
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.classList.add('canvas-dataview-empty');
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }
  const list = document.createElement('ul');
  list.classList.add('canvas-dataview-list');
  for (const r of rows) {
    const li = document.createElement('li');
    li.classList.add('canvas-dataview-row');
    li.dataset['pageId'] = r.id;
    li.textContent = r.title;
    list.appendChild(li);
  }
  container.appendChild(list);
}

export const Dataview = Node.create({
  name: 'dataview',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      query: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="dataview"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'dataview',
        class: 'canvas-dataview',
      }),
    ];
  },

  addNodeView() {
    return ({ node }: any) => {
      const dom = document.createElement('div');
      dom.classList.add('canvas-dataview');
      dom.setAttribute('data-type', 'dataview');
      dom.contentEditable = 'false';

      const refresh = async (): Promise<void> => {
        const q = parseDataviewQuery(node.attrs?.query);
        if (!q) {
          renderDataviewRows(dom, [], 'Empty dataview query.');
          return;
        }
        const built = buildDataviewSql(q);
        if (!built) {
          renderDataviewRows(dom, [], 'Invalid dataview query.');
          return;
        }
        const electron = (window as any).parallxElectron;
        const bridge: DataviewBridge | undefined = electron?.database;
        if (!bridge) {
          renderDataviewRows(dom, [], 'Database bridge unavailable.');
          return;
        }
        try {
          const result = await bridge.all(built.sql, built.params);
          if (result.error) {
            renderDataviewRows(dom, [], `Error: ${result.error.message}`);
            return;
          }
          const rows = (result.rows ?? []).map((r) => ({
            id: String(r['id'] ?? ''),
            title: String(r['title'] ?? '(untitled)'),
          }));
          renderDataviewRows(dom, rows);
        } catch (err) {
          renderDataviewRows(dom, [], `Error: ${(err as Error).message}`);
        }
      };

      void refresh();

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'dataview') return false;
          if (updatedNode.attrs?.query !== node.attrs?.query) {
            void refresh();
          }
          return true;
        },
      };
    };
  },
});
