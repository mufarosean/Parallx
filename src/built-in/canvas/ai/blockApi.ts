// blockApi.ts — M60 Phase δ T3 helpers for canvas property queries and
// block-level addressing.
//
// Per M60 §6.2 (Tier 3 — Canvas Depth), the agent needs:
//   • Multi-filter / sort / group property queries (C1).
//   • Doc-tree utilities to find, replace, and insert blocks by stable
//     `blockId` (C2/C3). Block IDs are persisted in TipTap doc JSON via
//     `@tiptap/extension-unique-id` (already wired in
//     `src/built-in/canvas/config/tiptapExtensions.ts` — see
//     `UNIQUE_ID_BLOCK_TYPES`). Every block carries an immutable
//     `attrs.id` that survives reload and edit cycles.
//
// This module is a pure-data helper — no DOM, no IPC, no DB. The chat
// tool layer wires it to `IBuiltInToolDatabase`.

// ─── Property query types ────────────────────────────────────────────────

/** Operators supported by `pages.query_by_property`. */
export type PropertyFilterOp =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty'
  | 'greater_than'
  | 'less_than';

export interface IPropertyFilter {
  readonly prop: string;
  readonly op: PropertyFilterOp;
  readonly value?: unknown;
}

export interface IPropertySort {
  readonly by: string;
  readonly dir?: 'asc' | 'desc';
}

export interface IPropertyQuery {
  readonly filter: readonly IPropertyFilter[];
  readonly sort?: IPropertySort;
  readonly group?: string;
  readonly limit?: number;
}

// ─── SQL builder for multi-filter query ──────────────────────────────────

/**
 * Build a SQL fragment that constrains `pages.id` to rows matching a
 * single property filter. Returns `{ subquery, params }` to be used
 * inside an `INTERSECT`/`AND IN (...)` chain.
 *
 * Properties live in DATABASES (post legacy-property migration): values are in
 * `page_property_values` and the property is resolved by NAME against
 * `database_properties` — so a filter on "Status" matches that column in ANY
 * database the page belongs to.
 *
 * @throws if `op` is unknown.
 */
export function filterToSubquery(filter: IPropertyFilter): { subquery: string; params: unknown[] } {
  const params: unknown[] = [filter.prop];
  let clause: string;
  switch (filter.op) {
    case 'equals':
      clause = 'value = ?';
      params.push(JSON.stringify(filter.value));
      break;
    case 'not_equals':
      clause = 'value != ?';
      params.push(JSON.stringify(filter.value));
      break;
    case 'contains':
      clause = "value LIKE ? ESCAPE '\\'";
      params.push(`%${String(filter.value).replace(/[\\%_]/g, '\\$&')}%`);
      break;
    case 'is_empty':
      clause = "(value IS NULL OR value = 'null' OR value = '\"\"' OR value = '[]')";
      break;
    case 'is_not_empty':
      clause = "value IS NOT NULL AND value != 'null' AND value != '\"\"' AND value != '[]'";
      break;
    case 'greater_than':
      clause = 'CAST(value AS REAL) > ?';
      params.push(Number(filter.value));
      break;
    case 'less_than':
      clause = 'CAST(value AS REAL) < ?';
      params.push(Number(filter.value));
      break;
    default:
      throw new Error(`Unknown property filter op: ${(filter as { op: string }).op}`);
  }
  return {
    subquery:
      `SELECT ppv.page_id FROM page_property_values ppv ` +
      `JOIN database_properties dp ON dp.id = ppv.property_id AND dp.database_id = ppv.database_id ` +
      `WHERE dp.name = ? AND ${clause.replace(/\bvalue\b/g, 'ppv.value')}`,
    params,
  };
}

// ─── Doc-tree walking (C2/C3) ────────────────────────────────────────────

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
}

/** Decode a `pages.content` envelope into a TipTap doc. Tolerates legacy
 * (un-enveloped) docs and invalid JSON by returning `null`. */
export function decodeDocContent(stored: string | null | undefined): DocNode | null {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    if (parsed && typeof parsed === 'object') {
      // Schema envelope: { schemaVersion, doc }
      if (parsed.doc && parsed.doc.type === 'doc' && Array.isArray(parsed.doc.content)) {
        return parsed.doc as DocNode;
      }
      // Legacy: bare doc
      if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
        return parsed as DocNode;
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/** Re-encode a doc into the schema-versioned envelope used by canvas. */
export function encodeDocContent(doc: DocNode, schemaVersion = 2): string {
  return JSON.stringify({ schemaVersion, doc });
}

/** Walk the doc and yield every node with an `attrs.id`. Depth-first,
 * pre-order. */
export function* iterateBlocks(doc: DocNode): Generator<{ node: DocNode; path: number[] }> {
  function* walk(node: DocNode, path: number[]): Generator<{ node: DocNode; path: number[] }> {
    const id = node.attrs?.['id'];
    if (typeof id === 'string' && id.length > 0) {
      yield { node, path };
    }
    if (Array.isArray(node.content)) {
      for (let i = 0; i < node.content.length; i++) {
        yield* walk(node.content[i]!, [...path, i]);
      }
    }
  }
  yield* walk(doc, []);
}

/** Find a block by id. Returns the node + path (sequence of child indices
 * from the doc root) or `null`. */
export function findBlockById(doc: DocNode, blockId: string): { node: DocNode; path: number[] } | null {
  for (const hit of iterateBlocks(doc)) {
    if (hit.node.attrs?.['id'] === blockId) return hit;
  }
  return null;
}

/** Extract plain text from a node subtree. */
export function nodeToPlainText(node: DocNode): string {
  if (node.type === 'text' && typeof node.text === 'string') return node.text;
  if (!Array.isArray(node.content)) return '';
  let out = '';
  for (const child of node.content) {
    out += nodeToPlainText(child);
    // Block-level separators
    if (
      child.type === 'paragraph' ||
      child.type === 'heading' ||
      child.type === 'blockquote' ||
      child.type === 'codeBlock' ||
      child.type === 'listItem' ||
      child.type === 'taskItem'
    ) {
      out += '\n';
    }
  }
  return out;
}

/** Replace the node at `path` with `replacement`. Returns a new doc; does
 * not mutate input. Throws if path is invalid. */
export function replaceAt(doc: DocNode, path: number[], replacement: DocNode): DocNode {
  if (path.length === 0) return { ...replacement };
  const [head, ...tail] = path;
  const children = Array.isArray(doc.content) ? [...doc.content] : [];
  if (head! < 0 || head! >= children.length) {
    throw new Error(`replaceAt: index ${head} out of range`);
  }
  if (tail.length === 0) {
    children[head!] = replacement;
  } else {
    children[head!] = replaceAt(children[head!]!, tail, replacement);
  }
  return { ...doc, content: children };
}

/** Insert `node` immediately after the block at `path`. Returns a new doc. */
export function insertAfter(doc: DocNode, path: number[], node: DocNode): DocNode {
  if (path.length === 0) {
    throw new Error('insertAfter: cannot insert after the doc root');
  }
  const [head, ...tail] = path;
  const children = Array.isArray(doc.content) ? [...doc.content] : [];
  if (head! < 0 || head! >= children.length) {
    throw new Error(`insertAfter: index ${head} out of range`);
  }
  if (tail.length === 0) {
    children.splice(head! + 1, 0, node);
  } else {
    children[head!] = insertAfter(children[head!]!, tail, node);
  }
  return { ...doc, content: children };
}

/** Replace the node at `path` with `nodes` (splice in 0..n replacements).
 *  Returns a new doc; does not mutate input. Lets a single-block edit expand
 *  into several blocks (e.g. one block → a markdown list). */
export function replaceWithMany(doc: DocNode, path: number[], nodes: DocNode[]): DocNode {
  if (path.length === 0) throw new Error('replaceWithMany: cannot replace the doc root');
  const [head, ...tail] = path;
  const children = Array.isArray(doc.content) ? [...doc.content] : [];
  if (head! < 0 || head! >= children.length) {
    throw new Error(`replaceWithMany: index ${head} out of range`);
  }
  if (tail.length === 0) {
    children.splice(head!, 1, ...nodes);
  } else {
    children[head!] = replaceWithMany(children[head!]!, tail, nodes);
  }
  return { ...doc, content: children };
}

/** Insert `nodes` (0..n) immediately after the block at `path`. New doc. */
export function insertManyAfter(doc: DocNode, path: number[], nodes: DocNode[]): DocNode {
  if (path.length === 0) throw new Error('insertManyAfter: cannot insert after the doc root');
  const [head, ...tail] = path;
  const children = Array.isArray(doc.content) ? [...doc.content] : [];
  if (head! < 0 || head! >= children.length) {
    throw new Error(`insertManyAfter: index ${head} out of range`);
  }
  if (tail.length === 0) {
    children.splice(head! + 1, 0, ...nodes);
  } else {
    children[head!] = insertManyAfter(children[head!]!, tail, nodes);
  }
  return { ...doc, content: children };
}

// ── Structure-aware splicing (C13) ──────────────────────────────────────────
//
// The AI addresses blocks by id, and ids exist on list rows and on a row's
// own line paragraph too.  Splicing arbitrary blocks there wrote invalid
// pages: a paragraph between two rows of a list, a heading as a row's first
// line.  These fit the blocks to where they land.  The tools still validate
// the result against the real schema before writing (validateBlockDoc).

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);
const ROW_TYPES = new Set(['listItem', 'taskItem']);
const ROW_FOR_LIST: Record<string, string> = { bulletList: 'listItem', orderedList: 'listItem', taskList: 'taskItem' };

function nodeAtPath(doc: DocNode, path: number[]): DocNode | null {
  let node: DocNode | undefined = doc;
  for (const i of path) {
    node = Array.isArray(node?.content) ? node!.content[i] : undefined;
    if (!node) return null;
  }
  return node ?? null;
}

/** A block's inline content, for a place that only takes a line. */
function inlineOf(block: DocNode): DocNode[] {
  if (LIST_TYPES.has(block.type)) {
    const firstRow = block.content?.[0];
    const line = firstRow?.content?.[0];
    return Array.isArray(line?.content) ? line!.content : [];
  }
  if (Array.isArray(block.content) && block.content.every((c) => c.type === 'text' || c.type === 'hardBreak' || c.type === 'inlineMath')) {
    return block.content;
  }
  return [{ type: 'text', text: nodeToPlainText(block).trim() }].filter((n) => n.text);
}

/**
 * Replace (`mode: 'replace'`) the block at `path`, or insert after it
 * (`'insertAfter'`), with `blocks` — fitted to the target's place:
 *   • after a list row: rows of the same list type join the list; any other
 *     blocks split the list there, so they land exactly between the rows;
 *   • after a row's own line: the same as after the row;
 *   • a row's own line replaced: the line stays a paragraph (the first
 *     block's text, keeping the line's id) and further blocks nest in the row;
 *   • anywhere else: a plain splice.
 */
export function fitBlocksAtTarget(doc: DocNode, path: number[], blocks: DocNode[], mode: 'replace' | 'insertAfter'): DocNode {
  if (path.length === 0) throw new Error('fitBlocksAtTarget: cannot target the doc root');
  const target = nodeAtPath(doc, path);
  const parentPath = path.slice(0, -1);
  const parent = nodeAtPath(doc, parentPath);
  const index = path[path.length - 1]!;

  // A row's own line (first child of a row).
  if (target && parent && ROW_TYPES.has(parent.type) && index === 0 && target.type === 'paragraph') {
    if (mode === 'insertAfter') return fitBlocksAtTarget(doc, parentPath, blocks, 'insertAfter');
    if (blocks.length === 0) return replaceWithMany(doc, path, [{ ...target, content: [] }]);
    const line: DocNode = { type: 'paragraph', attrs: { ...(target.attrs ?? {}) }, content: inlineOf(blocks[0]!) };
    const rest = LIST_TYPES.has(blocks[0]!.type)
      ? [...(blocks[0]!.content?.[0]?.content?.slice(1) ?? []), ...(blocks[0]!.content!.length > 1 ? [{ ...blocks[0]!, content: blocks[0]!.content!.slice(1) }] : []), ...blocks.slice(1)]
      : blocks.slice(1);
    return replaceWithMany(doc, path, [line, ...rest]);
  }

  // A list row.
  if (target && parent && ROW_TYPES.has(target.type) && LIST_TYPES.has(parent.type)) {
    const rowType = ROW_FOR_LIST[parent.type];
    const sameRows = blocks.length > 0 && blocks.every((b) => b.type === parent.type);
    if (sameRows) {
      const rows = blocks.flatMap((b) => (b.content ?? []).filter((r) => r.type === rowType));
      return mode === 'replace' ? replaceWithMany(doc, path, rows) : insertManyAfter(doc, path, rows);
    }
    // Split the list around the blocks.
    const rowsBefore = (parent.content ?? []).slice(0, mode === 'replace' ? index : index + 1);
    const rowsAfter = (parent.content ?? []).slice(index + 1);
    const { id: _listId, ...listAttrs } = (parent.attrs ?? {}) as Record<string, unknown>;
    const pieces: DocNode[] = [];
    if (rowsBefore.length > 0) pieces.push({ ...parent, content: rowsBefore });
    pieces.push(...blocks);
    if (rowsAfter.length > 0) pieces.push({ type: parent.type, attrs: listAttrs, content: rowsAfter });
    return replaceWithMany(doc, parentPath, pieces);
  }

  return mode === 'replace' ? replaceWithMany(doc, path, blocks) : insertManyAfter(doc, path, blocks);
}

/**
 * Validator for whole docs, installed by the canvas at activation (it owns
 * the editor schema; this module has none).  Returns a message when the doc
 * is invalid, null when it is fine or no validator is installed.
 */
let _docValidator: ((doc: DocNode) => string | null) | null = null;
export function setBlockDocValidator(fn: ((doc: DocNode) => string | null) | null): void {
  _docValidator = fn;
}
export function validateBlockDoc(doc: DocNode): string | null {
  try { return _docValidator ? _docValidator(doc) : null; } catch (err) { return err instanceof Error ? err.message : String(err); }
}

/** Build a paragraph node from a plain-text string. */
export function paragraphFromText(text: string, blockId?: string): DocNode {
  const para: DocNode = { type: 'paragraph' };
  if (blockId) para.attrs = { id: blockId };
  if (text) para.content = [{ type: 'text', text }];
  return para;
}

/**
 * Generate a stable v4-style block ID. Uses crypto.randomUUID when
 * available; falls back to a Math.random hex string for environments
 * without webcrypto (e.g., older test runners). Never returns an empty
 * string.
 */
export function generateBlockId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Deterministic-shape fallback (not RFC4122-strict; sufficient for tests).
  const r = (n: number) => Math.floor(Math.random() * n).toString(16).padStart(2, '0');
  return `${r(256)}${r(256)}${r(256)}${r(256)}-${r(256)}${r(256)}-${r(256)}${r(256)}-${r(256)}${r(256)}-${r(256)}${r(256)}${r(256)}${r(256)}${r(256)}${r(256)}`;
}
