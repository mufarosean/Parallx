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
 * Subquery shape: `SELECT page_id FROM page_properties WHERE key = ? AND
 * <op-specific clause>`.
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
  return { subquery: `SELECT page_id FROM page_properties WHERE key = ? AND ${clause}`, params };
}

// ─── Doc-tree walking (C2/C3) ────────────────────────────────────────────

interface DocNode {
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
