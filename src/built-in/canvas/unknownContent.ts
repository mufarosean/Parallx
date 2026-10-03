// unknownContent.ts — content the editor's schema doesn't know
//
// A page can hold a node or mark this build doesn't define: a block type that
// was removed (databaseInline), one from a newer build on another machine, a
// mark from an extension that is turned off.  ProseMirror can't build a doc
// with an unknown type, and Tiptap — with its content check off — then loaded
// an EMPTY page.  The next keystroke saved that empty page over the stored one.
//
// On load, each unknown node (or text carrying an unknown mark) is wrapped in
// a placeholder holding its original JSON: `unsupportedBlock` where a block
// stands, `unsupportedInline` inside text.  The placeholder shows that
// something is there and can be moved or deleted like any block.  On save the
// placeholder is unwrapped back to the exact JSON it held, so the stored page
// keeps what this build can't show.

export const UNSUPPORTED_BLOCK = 'unsupportedBlock';
export const UNSUPPORTED_INLINE = 'unsupportedInline';

interface SchemaLike {
  readonly nodes: Record<string, any>;
  readonly marks: Record<string, any>;
}

function hasUnknownMark(node: any, schema: SchemaLike): boolean {
  return Array.isArray(node?.marks) && node.marks.some((m: any) => !m || !schema.marks[m.type]);
}

function placeholder(node: any, inline: boolean): any {
  return {
    type: inline ? UNSUPPORTED_INLINE : UNSUPPORTED_BLOCK,
    attrs: { raw: JSON.stringify(node), label: String(node?.type ?? 'unknown') },
  };
}

function wrapChildren(content: any[], schema: SchemaLike, inlineContext: boolean): { content: any[]; changed: boolean } {
  let changed = false;
  const out = content.map((child) => {
    const next = wrapNode(child, schema, inlineContext);
    if (next !== child) changed = true;
    return next;
  });
  return { content: changed ? out : content, changed };
}

function wrapNode(node: any, schema: SchemaLike, inlineContext: boolean): any {
  if (!node || typeof node !== 'object' || typeof node.type !== 'string') return node;
  const type = schema.nodes[node.type];
  if (!type || hasUnknownMark(node, schema)) return placeholder(node, inlineContext);
  if (!Array.isArray(node.content)) return node;
  const wrapped = wrapChildren(node.content, schema, !!type.inlineContent);
  return wrapped.changed ? { ...node, content: wrapped.content } : node;
}

/** The stored doc made loadable: unknown nodes and marks become placeholders. */
export function wrapUnknownContent(doc: any, schema: SchemaLike): any {
  if (!doc || !Array.isArray(doc.content)) return doc;
  const wrapped = wrapChildren(doc.content, schema, false);
  return wrapped.changed ? { ...doc, content: wrapped.content } : doc;
}

function unwrapNode(node: any): any {
  if (!node || typeof node !== 'object') return node;
  if (node.type === UNSUPPORTED_BLOCK || node.type === UNSUPPORTED_INLINE) {
    try {
      return JSON.parse(String(node.attrs?.raw ?? ''));
    } catch {
      return node;
    }
  }
  if (!Array.isArray(node.content)) return node;
  let changed = false;
  const content = node.content.map((child: any) => {
    const next = unwrapNode(child);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, content } : node;
}

/** The editor's doc as it is stored: placeholders become what they held. */
export function unwrapUnknownContent(doc: any): any {
  return unwrapNode(doc);
}

/** The stored JSON string for an editor's doc (placeholders unwrapped). */
export function editorContentForStorage(editor: { getJSON(): any }): string {
  return JSON.stringify(unwrapUnknownContent(editor.getJSON()));
}
