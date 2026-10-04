// dataviewNode.ts — M60 Phase δ T3 C4 — live property dataview block
//
// A leaf TipTap node that renders a live, filtered list of pages by
// running a property query against the canvas DB (via window.parallxElectron).
// The query is persisted in the node's `query` attribute (JSON-encoded
// IPropertyQuery shape — see src/built-in/chat/tools/blockApi.ts).
//
// Insertion paths:
//   • Slash menu: "Page List" (it opens on its filter editor).
//   • Agent: pages.insert_block_after with a block carrying type:'dataview'.
//
// Shown as a titled list of pages, each opening on click; "Edit Filter…"
// sets the property rules, the order and how many. With no rules it lists
// every page, most recently edited first. It re-reads whenever workspace
// data changes (LiveBlockServices), so a page that starts or stops
// matching appears or leaves without reopening the page.

import { Node, mergeAttributes } from '@tiptap/core';
import { filterToSubquery, type IPropertyFilter } from '../ai/blockApi.js';
import { createIconElement, resolvePageIcon } from '../config/blockRegistry.js';
import {
  type LiveBlockOptions, watchWorkspace, openBlockPopover, popoverRow, selectControl, textControl,
  blockEditButton, setBlockAttrs, focusBlock,
} from './liveBlock.js';

export interface DataviewQueryFilter {
  prop: string;
  op: string;
  value?: unknown;
}

export interface DataviewQuery {
  filter: DataviewQueryFilter[];
  sort?: { by: string; dir?: 'asc' | 'desc' };
  group?: string;
  limit?: number;
}

interface DataviewBridge {
  all(sql: string, params?: unknown[]): Promise<{ error: { message: string } | null; rows?: Record<string, unknown>[] }>;
}

export const DATAVIEW_OPS: readonly { op: string; label: string; needsValue: boolean }[] = [
  { op: 'equals', label: 'is', needsValue: true },
  { op: 'not_equals', label: 'is not', needsValue: true },
  { op: 'contains', label: 'contains', needsValue: true },
  { op: 'is_empty', label: 'is empty', needsValue: false },
  { op: 'is_not_empty', label: 'is not empty', needsValue: false },
  { op: 'greater_than', label: 'is more than', needsValue: true },
  { op: 'less_than', label: 'is less than', needsValue: true },
];

/** The value a rule compares with, in the stored shape of the column. */
export function dataviewRuleValue(type: string | undefined, raw: string): unknown {
  if (type === 'checkbox') return /^(true|yes|1|checked|on)$/i.test(raw.trim());
  if (type === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : raw; }
  return raw;
}

/**
 * Build the SQL fragments + params for a multi-filter property query.
 * With no rules it lists every live page (most recently edited first).
 */
export function buildDataviewSql(query: DataviewQuery): { sql: string; params: unknown[] } | null {
  if (!Array.isArray(query.filter)) return null;
  const subqueries: string[] = [];
  const params: unknown[] = [];
  for (const f of query.filter) {
    if (!f.prop || !f.op) continue;
    // Delegate to the shared builder (properties live in databases now:
    // page_property_values resolved by name via database_properties).
    try {
      const sub = filterToSubquery({ prop: f.prop, op: f.op as IPropertyFilter['op'], value: f.value });
      subqueries.push(sub.subquery);
      params.push(...sub.params);
    } catch {
      return null; // unknown op
    }
  }
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const dir = query.sort?.dir === 'asc' ? 'ASC' : 'DESC';
  let order = 'p.updated_at DESC';
  if (query.sort?.by === 'title') order = `p.title COLLATE NOCASE ${dir}`;
  else if (query.sort?.by === 'updated_at') order = `p.updated_at ${dir}`;
  else if (query.sort?.by === 'created_at') order = `p.created_at ${dir}`;
  const where = subqueries.length ? ` AND p.id IN (${subqueries.join(' INTERSECT ')})` : '';
  const sql = `SELECT p.id, p.title, p.icon FROM pages p WHERE p.is_archived = 0`
    + ` AND p.id NOT IN (SELECT page_id FROM synced_blocks)${where} ORDER BY ${order} LIMIT ?`;
  params.push(limit);
  return { sql, params };
}

export function parseDataviewQuery(raw: unknown): DataviewQuery | null {
  if (raw === '' || raw === undefined || raw === null) return { filter: [] };
  if (typeof raw !== 'string') return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.filter)) return null;
    return parsed as DataviewQuery;
  } catch {
    return null;
  }
}

/** One line saying what the list shows ("Status is Doing, Tags contains urgent"). */
export function describeDataviewQuery(q: DataviewQuery): string {
  const rules = q.filter.filter((f) => f.prop && f.op).map((f) => {
    const op = DATAVIEW_OPS.find((o) => o.op === f.op);
    const label = op?.label ?? f.op;
    return op && !op.needsValue ? `${f.prop} ${label}` : `${f.prop} ${label} ${String(f.value ?? '')}`;
  });
  return rules.length ? rules.join(', ') : 'All pages';
}

/** Render rows into the block. Each row opens its page. */
export function renderDataviewRows(
  container: HTMLElement,
  rows: { id: string; title: string; icon?: string | null }[],
  emptyMessage = 'No pages match.',
  openPage?: (pageId: string) => void,
): void {
  container.innerHTML = '';
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.classList.add('canvas-dataview-empty');
    empty.textContent = emptyMessage;
    container.appendChild(empty);
    return;
  }
  // Plain divs: the editor's list styles would put bullets on <li> rows.
  const list = document.createElement('div');
  list.classList.add('canvas-dataview-list');
  list.setAttribute('role', 'list');
  for (const r of rows) {
    const li = document.createElement('div');
    li.setAttribute('role', 'listitem');
    li.classList.add('canvas-dataview-row');
    li.dataset['pageId'] = r.id;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'canvas-dataview-page';
    try { btn.appendChild(createIconElement(resolvePageIcon(r.icon ?? null), 14)); } catch { /* icon is decoration */ }
    const t = document.createElement('span');
    t.textContent = r.title || 'Untitled';
    btn.appendChild(t);
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => openPage?.(r.id));
    li.appendChild(btn);
    list.appendChild(li);
  }
  container.appendChild(list);
}

function bridge(): DataviewBridge | undefined {
  return (window as any).parallxElectron?.database;
}

/** Property names and types the filter editor offers. */
async function listProperties(): Promise<{ name: string; type: string }[]> {
  const b = bridge();
  if (!b) return [];
  const res = await b.all(
    `SELECT dp.name, MIN(dp.type) AS type FROM database_properties dp
       JOIN databases d ON d.id = dp.database_id
       JOIN pages p ON p.id = d.page_id AND p.is_archived = 0
      GROUP BY dp.name ORDER BY dp.name COLLATE NOCASE`,
  );
  return (res.rows ?? []).map((r) => ({ name: String(r['name']), type: String(r['type']) }));
}

function editFilter(anchor: HTMLElement, current: DataviewQuery, onSave: (q: DataviewQuery) => void, returnFocus?: () => void): void {
  void listProperties().then((props) => {
    openBlockPopover(anchor, 'Page list', (body, close) => {
      const rules: DataviewQueryFilter[] = current.filter.map((f) => ({ ...f }));
      const rulesEl = document.createElement('div');
      rulesEl.className = 'canvas-dataview-rules';
      body.appendChild(rulesEl);
      const typeOf = (name: string) => props.find((p) => p.name === name)?.type;

      const draw = (): void => {
        rulesEl.innerHTML = '';
        if (!props.length) {
          const none = document.createElement('div');
          none.className = 'canvas-live-popover__hint';
          none.textContent = 'No database properties yet. Without a filter the list shows every page.';
          rulesEl.appendChild(none);
        }
        rules.forEach((rule, i) => {
          const row = document.createElement('div');
          row.className = 'canvas-dataview-rule';
          const prop = selectControl(props.map((p) => ({ value: p.name, label: p.name })), rule.prop);
          const op = selectControl(DATAVIEW_OPS.map((o) => ({ value: o.op, label: o.label })), rule.op);
          const value = textControl(rule.value === undefined ? '' : String(rule.value), 'Value');
          value.style.display = DATAVIEW_OPS.find((o) => o.op === rule.op)?.needsValue === false ? 'none' : '';
          prop.setAttribute('aria-label', 'Property');
          op.setAttribute('aria-label', 'Condition');
          value.setAttribute('aria-label', 'Value');
          prop.addEventListener('change', () => { rule.prop = prop.value; });
          op.addEventListener('change', () => { rule.op = op.value; draw(); });
          value.addEventListener('input', () => { rule.value = dataviewRuleValue(typeOf(rule.prop), value.value); });
          const remove = document.createElement('button');
          remove.type = 'button';
          remove.className = 'canvas-live-popover__icon-btn';
          remove.title = 'Remove rule';
          remove.setAttribute('aria-label', 'Remove rule');
          remove.textContent = '×';
          remove.addEventListener('click', () => { rules.splice(i, 1); draw(); });
          row.append(prop, op, value, remove);
          rulesEl.appendChild(row);
        });
        if (props.length) {
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'canvas-live-popover__link';
          add.textContent = 'Add Rule';
          add.addEventListener('click', () => { rules.push({ prop: props[0]!.name, op: 'equals', value: '' }); draw(); });
          rulesEl.appendChild(add);
        }
      };
      draw();

      const sort = selectControl([
        { value: 'updated_at:desc', label: 'Last edited, newest first' },
        { value: 'created_at:desc', label: 'Created, newest first' },
        { value: 'created_at:asc', label: 'Created, oldest first' },
        { value: 'title:asc', label: 'Title, A to Z' },
        { value: 'title:desc', label: 'Title, Z to A' },
      ], `${current.sort?.by ?? 'updated_at'}:${current.sort?.dir ?? 'desc'}`);
      popoverRow(body, 'Order', sort);
      const limit = textControl(String(current.limit ?? 50));
      limit.type = 'number';
      limit.min = '1';
      limit.max = '200';
      popoverRow(body, 'Show at most', limit);

      const done = document.createElement('button');
      done.type = 'button';
      done.className = 'canvas-live-popover__primary';
      done.textContent = 'Done';
      done.addEventListener('click', () => {
        const [by, dir] = sort.value.split(':') as [string, 'asc' | 'desc'];
        const n = Math.min(Math.max(Math.round(Number(limit.value) || 50), 1), 200);
        onSave({
          filter: rules.filter((r) => r.prop && r.op),
          sort: { by, dir },
          limit: n,
        });
        close();
      });
      body.appendChild(done);
    }, returnFocus);
  });
}

export const Dataview = Node.create<LiveBlockOptions>({
  name: 'dataview',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addOptions() {
    return { live: undefined };
  },

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
    const live = this.options.live;
    return ({ node, editor, getPos }: any) => {
      let current = node;
      const dom = document.createElement('div');
      dom.classList.add('canvas-dataview');
      dom.setAttribute('data-type', 'dataview');
      dom.contentEditable = 'false';

      const head = document.createElement('div');
      head.className = 'canvas-dataview-head';
      const summary = document.createElement('span');
      summary.className = 'canvas-dataview-summary';
      const edit = blockEditButton('Edit Filter…');
      head.append(summary, edit);
      const listEl = document.createElement('div');
      listEl.className = 'canvas-dataview-body';
      dom.append(head, listEl);

      edit.addEventListener('click', () => {
        if (!editor.isEditable) return;
        const q = parseDataviewQuery(current.attrs?.query) ?? { filter: [] };
        editFilter(edit, q, (next) => setBlockAttrs(editor, getPos, { query: JSON.stringify(next) }), () => focusBlock(editor, getPos));
      });

      let seq = 0;
      const refresh = async (): Promise<void> => {
        const mine = ++seq;
        const q = parseDataviewQuery(current.attrs?.query);
        summary.textContent = q ? describeDataviewQuery(q) : 'Page list';
        const show = (rows: { id: string; title: string; icon?: string | null }[], empty?: string) => {
          if (mine === seq) renderDataviewRows(listEl, rows, empty, (id) => live?.openPage(id));
        };
        if (!q) return show([], 'This list has a filter that cannot be read. Edit Filter… to set it again.');
        const built = buildDataviewSql(q);
        if (!built) return show([], 'This filter has a condition that cannot be used. Edit Filter… to fix it.');
        const b = bridge();
        if (!b) return show([], 'Pages cannot be read here.');
        try {
          const result = await b.all(built.sql, built.params);
          if (result.error) return show([], `Could not read pages. ${result.error.message}`);
          show((result.rows ?? []).map((r) => ({
            id: String(r['id'] ?? ''),
            title: String(r['title'] ?? 'Untitled'),
            icon: (r['icon'] as string | null) ?? null,
          })));
        } catch (err) {
          show([], `Could not read pages. ${(err as Error).message}`);
        }
      };

      void refresh();
      let timer: ReturnType<typeof setTimeout> | null = null;
      const stop = watchWorkspace(live, () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; void refresh(); }, 250);
      });

      return {
        dom,
        update(updatedNode: any) {
          if (updatedNode.type.name !== 'dataview') return false;
          const changed = updatedNode.attrs?.query !== current.attrs?.query;
          current = updatedNode;
          if (changed) void refresh();
          return true;
        },
        stopEvent: (e: Event) => head.contains(e.target as globalThis.Node) || listEl.contains(e.target as globalThis.Node),
        ignoreMutation: () => true,
        destroy() {
          stop();
          if (timer) clearTimeout(timer);
        },
      };
    };
  },
});
