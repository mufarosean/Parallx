// markdownExport.ts — TipTap JSON → Markdown converter for Canvas pages
//
// Lossless: `markdownToTiptapJson(tiptapJsonToMarkdown(doc))` gives back the
// same page (block ids aside; the importer assigns fresh ones). Markdown is
// used wherever it can say the thing exactly, with every markdown-significant
// character in text escaped. What markdown cannot say is carried in HTML
// comments, which renderers hide and the importer reads back:
//
//   <!-- parallx:attrs {json} -->      attributes markdown has no syntax for
//                                      (block colour, image size, odd icons);
//                                      on its own line it applies to the next
//                                      block, at the start of a text line to
//                                      that paragraph
//   <!-- parallx:item {json} -->       the same for a list row, after its marker
//   <!-- parallx:empty -->             an empty paragraph
//   <!-- parallx:open {json} -->       a block markdown has no form for
//   …blocks in markdown…               (columns, toggle headings, rich tables),
//   <!-- parallx:close -->             with its content still readable/editable
//   <!-- parallx:atom {json} -->       a block with no text (table of contents,
//                                      concept map, unknown block types)
//   <!-- parallx:block {json} -->      a block shown as a readable link line
//   [title](url)                       (bookmark, page card, media, file)
//   <!-- /parallx:block -->
//   <!-- parallx:inline {json} -->     an inline node or text markdown cannot say
//   <span data-px="…">text</span>      text marks markdown cannot say (colour)
//
// For reading surfaces (a dashboard embed, AI context, flashcard sources) pass
// `{ forReading: true }`: no carriers and no escapes, just the readable text.
// That output is not meant to be read back.
//
// No external dependencies — pure string transformation.

// ─── Types for TipTap JSON AST ──────────────────────────────────────────────

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Convert a TipTap JSON document to a Markdown string.
 *
 * @param doc — The TipTap JSON object (type: 'doc')
 * @param title — Optional page title to prepend as H1
 * @returns Markdown string
 */
export function tiptapJsonToMarkdown(doc: unknown, title?: string, options: ExportOptions = {}): string {
  const root = doc as TipTapNode;
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) {
    return title ? `# ${title}\n` : '';
  }

  _reading = options.forReading === true;
  try {
    let body = options.withBlockIds && !_reading
      ? renderBlocksWithIds(root.content)
      : renderBlocks(root.content, true);
    if (_reading) body = body.replace(/^[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '');
    const head = title ? `# ${title}\n\n` : '';
    return (head + body).replace(/\s+$/, '') + '\n';
  } finally {
    _reading = false;
  }
}

export interface ExportOptions {
  /** Readable text only, for people and AI to read: no carriers, no escapes. */
  readonly forReading?: boolean;
  /**
   * Put `<!-- block:ID -->` before each top-level block that has an id, so an
   * AI can target blocks by id and a rewrite read back keeps them.
   */
  readonly withBlockIds?: boolean;
}

/** Top-level blocks, each after its id marker. */
function renderBlocksWithIds(nodes: TipTapNode[]): string {
  const alts = alternateMarkers(nodes);
  return nodes.map((node, i) => {
    const id = node.attrs?.id;
    const text = renderBlock(node, alts[i]!);
    return typeof id === 'string' && BLOCK_ID_RE.test(id) ? `<!-- block:${id} -->\n${text}` : text;
  }).join('\n\n');
}

const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Set for the duration of a `forReading` export (the converter is synchronous). */
let _reading = false;

// ─── Comment carriers ────────────────────────────────────────────────────────

/** JSON that is safe inside an HTML comment (no `--`, so no `-->`). */
export function commentJson(value: unknown): string {
  return JSON.stringify(value).replace(/--/g, '-\\u002d');
}

function carry(kind: string, value: unknown): string {
  if (_reading) {
    if (kind === 'inline') return readableInline(value as TipTapNode);
    if (kind === 'atom') return readableAtom(value as TipTapNode);
    return '';
  }
  return `<!-- parallx:${kind} ${commentJson(value)} -->`;
}
const emptyParagraph = () => (_reading ? '' : '<!-- parallx:empty -->');
const closeMark = () => (_reading ? '' : '<!-- parallx:close -->');

/** What a reader sees of a carried inline node. */
function readableInline(node: TipTapNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'inlineMath') return `$${String(node.attrs?.latex ?? '')}$`;
  if (node.type === 'hardBreak') return '\n';
  return plainText(node);
}

/** What a reader sees of a carried block. */
function readableAtom(node: TipTapNode): string {
  if (node.type === 'mathBlock') return `$$\n${String(node.attrs?.latex ?? '')}\n$$`;
  if (node.type === 'image') return `![${String(node.attrs?.alt ?? '')}](${String(node.attrs?.src ?? '')})`;
  if (node.type === 'conceptMap') return String(node.attrs?.src ?? '');
  return plainText(node);
}

function plainText(node: TipTapNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(plainText).join(node.content?.every((c) => INLINE_TYPES.has(c.type)) ? '' : '\n');
}

/** Attribute values the editor uses when an attribute is absent. */
const ATTR_DEFAULTS: Record<string, Record<string, unknown>> = {
  codeBlock: { language: 'plaintext' },
  details: { open: false },
  orderedList: { start: 1 },
  callout: { emoji: 'lightbulb' },
  taskItem: { checked: false },
  heading: { level: 1 },
  toggleHeading: { level: 1 },
  inlineMath: { evaluate: 'no', display: 'no' },
};

/** Attributes markdown cannot express for this node (ids excluded). */
function extraAttrs(node: TipTapNode, native: readonly string[]): Record<string, unknown> | null {
  const attrs = node.attrs ?? {};
  const defaults = ATTR_DEFAULTS[node.type] ?? {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'id' || value === undefined || native.includes(key)) continue;
    const dflt = key in defaults ? defaults[key] : null;
    if (sameValue(value, dflt)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Every attribute but the id and nulls, for blocks carried whole. */
function keptAttrs(node: TipTapNode): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if (key === 'id' || value === null || value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function sameValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** A node without ids anywhere, for whole-node carriers. */
function withoutIds(node: TipTapNode): TipTapNode {
  const out: TipTapNode = { type: node.type };
  const attrs = keptAttrs(node);
  if (attrs) out.attrs = attrs;
  if (node.text !== undefined) out.text = node.text;
  if (node.marks && node.marks.length > 0) out.marks = node.marks;
  if (node.content) out.content = node.content.map(withoutIds);
  return out;
}

// ─── Blocks ──────────────────────────────────────────────────────────────────

const LIST_TYPES = new Set(['bulletList', 'orderedList', 'taskList']);

/**
 * Render a sequence of sibling blocks, separated by blank lines.
 * `emptyIsDefault`: the reader turns an empty container into one empty
 * paragraph, so a container holding only that needs no text at all.
 */
function renderBlocks(nodes: TipTapNode[], emptyIsDefault: boolean): string {
  if (emptyIsDefault && nodes.length === 1 && isPlainEmptyParagraph(nodes[0]!)) return '';
  const alts = alternateMarkers(nodes);
  return nodes.map((node, i) => renderBlock(node, alts[i]!)).join('\n\n');
}

/**
 * Two lists of the same kind side by side stay two lists: the second uses
 * the other marker (`-`/`*`, `.`/`)`), which starts a new list.
 */
function alternateMarkers(nodes: TipTapNode[]): boolean[] {
  const out: boolean[] = [];
  let alt = false;
  nodes.forEach((node, i) => {
    alt = LIST_TYPES.has(node.type) && nodes[i - 1]?.type === node.type ? !alt : false;
    out.push(alt);
  });
  return out;
}

function isPlainEmptyParagraph(node: TipTapNode): boolean {
  return node.type === 'paragraph' && (!node.content || node.content.length === 0) && !extraAttrs(node, []);
}

/** Prefix a block with its attrs line when it has attributes markdown lacks. */
function withAttrs(node: TipTapNode, native: readonly string[], text: string): string {
  const extra = extraAttrs(node, native);
  return extra && !_reading ? `${carry('attrs', extra)}\n${text}` : text;
}

function renderBlock(node: TipTapNode, alt: boolean): string {
  switch (node.type) {
    case 'paragraph':
      return renderParagraph(node);

    case 'heading': {
      // Markdown stops at six levels, as does the editor.
      const level = Math.min(6, Math.max(1, Math.floor(Number(node.attrs?.level ?? 1)) || 1));
      return withAttrs(node, ['level'], `${'#'.repeat(level)} ${renderTextLine(node.content, { lineStart: true })}`);
    }

    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return renderList(node, alt);

    case 'blockquote': {
      const inner = renderBlocks(node.content ?? [], true);
      // A quote whose text starts like the old `**Note:**` callout form would
      // read back as a callout; carry it as a plain quote instead.
      if (/^\*\*[A-Za-z]+:\*\*/.test(inner)) return renderOpenClose(node);
      return withAttrs(node, [], quoteLines(inner));
    }

    case 'callout': {
      const emoji = String(node.attrs?.emoji ?? 'lightbulb');
      const type = CALLOUT_TYPE_BY_EMOJI[emoji];
      const inner = renderBlocks(node.content ?? [], true);
      const text = quoteLines(inner ? `[!${type ?? 'TIP'}]\n${inner}` : `[!${type ?? 'TIP'}]`);
      return withAttrs(node, type ? ['emoji'] : [], text);
    }

    case 'codeBlock': {
      const lang = node.attrs?.language;
      const code = (node.content ?? []).map((c) => c.text ?? '').join('');
      const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
      const fence = '`'.repeat(Math.max(3, longest + 1));
      const nativeLang = typeof lang === 'string' && /^[^\s`~]+$/.test(lang) && lang !== 'plaintext';
      return withAttrs(node, nativeLang ? ['language'] : [], `${fence}${nativeLang ? lang : ''}\n${code}\n${fence}`);
    }

    case 'horizontalRule':
      return withAttrs(node, [], '---');

    case 'mathBlock': {
      const latex = String(node.attrs?.latex ?? '');
      if (latex.split('\n').some((l) => l.trim() === '$$')) return carry('atom', withoutIds(node));
      return withAttrs(node, ['latex'], `$$\n${latex}\n$$`);
    }

    case 'image': {
      const src = String(node.attrs?.src ?? '');
      const alt = String(node.attrs?.alt ?? '');
      const dest = src ? linkDestination(src) : null;
      if (dest === null) return carry('atom', withoutIds(node));
      const native = ['src', ...(alt ? ['alt'] : [])];
      return withAttrs(node, native, `![${escapeText(alt, false, false, true)}](${dest})`);
    }

    case 'details':
      return renderDetails(node);

    case 'table': {
      if (_reading) return renderReadingTable(node);
      const header = tableHeaderRow(node);
      if (header === null) return renderOpenClose(node);
      const table = renderSimpleTable(node);
      // A pipe table always has a header row; say so when this one does not.
      return header ? table : `${carry('attrs', { headerRow: false })}\n${table}`;
    }

    case 'toggleHeading':
      return renderToggleHeading(node);

    case 'bookmark':
    case 'video':
    case 'audio':
    case 'fileAttachment':
    case 'pageBlock':
      return renderLinkCard(node);

    case 'unsupportedBlock': {
      const original = parseRaw(node.attrs?.raw);
      return original ? renderBlock(original, alt) : carry('atom', withoutIds(node));
    }

    case 'columnList':
    case 'column':
      return renderOpenClose(node);

    // Parts of a block, when one is exported on its own (chat block context).
    case 'listItem':
      return renderList({ type: 'bulletList', content: [node] }, alt);
    case 'taskItem':
      return renderList({ type: 'taskList', content: [node] }, alt);
    case 'detailsSummary':
    case 'toggleHeadingText':
      return renderTextLine(node.content, { lineStart: true });
    case 'detailsContent':
      return renderBlocks(node.content ?? [], false);

    default:
      // Leaf blocks (table of contents, concept map, dataview, unknown types)
      // travel whole; containers keep their content readable.
      if (!node.content || node.content.length === 0 || !node.content.every(isBlockLike)) {
        return carry('atom', withoutIds(node));
      }
      return renderOpenClose(node);
  }
}

function isBlockLike(node: TipTapNode): boolean {
  return node.type !== 'text' && !INLINE_TYPES.has(node.type);
}

const INLINE_TYPES = new Set(['text', 'hardBreak', 'inlineMath', 'unsupportedInline']);

function parseRaw(raw: unknown): TipTapNode | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const node = JSON.parse(raw) as TipTapNode;
    return node && typeof node === 'object' && typeof node.type === 'string' ? node : null;
  } catch { return null; }
}

function renderParagraph(node: TipTapNode): string {
  const extra = extraAttrs(node, []);
  const prefix = extra ? carry('attrs', extra) : '';
  if (!node.content || node.content.length === 0) return prefix + emptyParagraph();
  const line = renderTextLine(node.content, { lineStart: !prefix });
  return prefix ? `${prefix} ${line}` : line;
}

function quoteLines(inner: string): string {
  if (!inner) return '>';
  return inner.split('\n').map((line) => (line ? `> ${line}` : '>')).join('\n');
}

function indentLines(text: string, width: number): string {
  const pad = ' '.repeat(width);
  return text.split('\n').map((line) => (line ? pad + line : line)).join('\n');
}

/** A block markdown has no syntax for: its content stays markdown inside markers. */
function renderOpenClose(node: TipTapNode): string {
  const head: TipTapNode = { type: node.type };
  const attrs = keptAttrs(node);
  if (attrs) head.attrs = attrs;
  const inner = renderBlocks(node.content ?? [], true);
  return inner ? `${carry('open', head)}\n\n${inner}\n\n${closeMark()}` : `${carry('open', head)}\n${closeMark()}`;
}

function renderToggleHeading(node: TipTapNode): string {
  const children = node.content ?? [];
  const titleNode = children[0];
  const body = children[1];
  const level = Number(node.attrs?.level ?? 1);
  if (
    children.length !== 2 || titleNode?.type !== 'toggleHeadingText' || body?.type !== 'detailsContent'
    || !Number.isInteger(level) || level < 1 || level > 6
  ) {
    return renderOpenClose(node);
  }
  const head: TipTapNode = { type: 'toggleHeading' };
  const attrs = keptAttrs(node);
  if (attrs) head.attrs = attrs;
  const title = `${'#'.repeat(level)} ${renderTextLine(titleNode.content, { lineStart: true })}`;
  const inner = renderBlocks(body.content ?? [], true);
  return `${carry('open', head)}\n\n${title}${inner ? `\n\n${inner}` : ''}\n\n${closeMark()}`;
}

function renderLinkCard(node: TipTapNode): string {
  const a = node.attrs ?? {};
  const url = String(a.url ?? a.src ?? '');
  const label = String(a.title || a.filename || url || node.type);
  const dest = linkDestination(url);
  const line = dest === null || !url
    ? renderTextLine([{ type: 'text', text: label }], { lineStart: true })
    : `[${escapeText(label, false, false, true)}](${dest})`;
  if (_reading) return line;
  return `${carry('block', withoutIds(node))}\n${line}\n<!-- /parallx:block -->`;
}

// ─── Details ─────────────────────────────────────────────────────────────────

function renderDetails(node: TipTapNode): string {
  const children = node.content ?? [];
  const summary = children[0];
  const body = children[1];
  if (children.length !== 2 || summary?.type !== 'detailsSummary' || body?.type !== 'detailsContent') {
    return renderOpenClose(node);
  }
  const open = node.attrs?.open === true;
  const summaryText = renderTextLine(summary.content, { lineStart: false });
  const inner = renderBlocks(body.content ?? [], true);
  const text = `<details${open ? ' open' : ''}>\n<summary>${summaryText}</summary>${inner ? `\n\n${inner}` : ''}\n\n</details>`;
  return withAttrs(node, ['open'], text);
}

// ─── Lists ───────────────────────────────────────────────────────────────────

function renderList(node: TipTapNode, alt: boolean): string {
  const items = node.content ?? [];
  const lines: string[] = [];
  const start = node.type === 'orderedList' ? Number(node.attrs?.start ?? 1) : 1;
  const nativeStart = Number.isInteger(start) && start >= 0 && start < 1e9;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let marker: string;
    if (node.type === 'orderedList') {
      marker = `${(nativeStart ? start : 1) + i}${alt ? ')' : '.'}`;
    } else {
      marker = alt ? '*' : '-';
    }
    const contentIndent = marker.length + 1;
    if (node.type === 'taskList') marker += item.attrs?.checked ? ' [x]' : ' [ ]';
    lines.push(renderListItem(item, marker, contentIndent));
  }
  return withAttrs(node, nativeStart ? ['start'] : [], lines.join('\n'));
}

function renderListItem(item: TipTapNode, marker: string, contentIndent: number): string {
  const children = item.content ?? [];
  const extra = extraAttrs(item, ['checked']);
  const itemPrefix = extra && !_reading ? `${carry('item', extra)} ` : '';
  const first = children[0];
  const rest = children.slice(1);
  let firstLine = '';
  if (first && first.type === 'paragraph') {
    if (!first.content || first.content.length === 0) {
      const pExtra = extraAttrs(first, []);
      firstLine = pExtra ? carry('attrs', pExtra) + emptyParagraph() : rest.length > 0 ? emptyParagraph() : '';
    } else {
      firstLine = renderParagraph(first);
    }
  } else if (first) {
    // Not a valid row (a row starts with a paragraph); keep the block anyway.
    rest.unshift(first);
    firstLine = emptyParagraph();
  }
  // Trailing spaces of the row's text are already written as entities.
  let text = `${marker} ${itemPrefix}${firstLine}`.trimEnd();
  const alts = alternateMarkers(rest);
  rest.forEach((child, i) => {
    // A nested list hugs its row; any other block sits after a blank line.
    const sep = LIST_TYPES.has(child.type) ? '\n' : '\n\n';
    text += sep + indentLines(renderBlock(child, alts[i]!), contentIndent);
  });
  return text;
}

// ─── Tables ──────────────────────────────────────────────────────────────────

/**
 * Whether the table fits a pipe table (one paragraph per cell, no spans or
 * widths, header cells only and all through the first row): true when the
 * first row is a header row, false when there is none, null when it does
 * not fit.
 */
function tableHeaderRow(node: TipTapNode): boolean | null {
  if (keptAttrs(node)) return null;
  const rows = node.content ?? [];
  if (rows.length === 0) return null;
  const width = rows[0]!.content?.length ?? 0;
  if (width === 0) return null;
  const header = rows[0]!.content![0]!.type === 'tableHeader';
  const fits = rows.every((row, r) => {
    if (row.type !== 'tableRow' || keptAttrs(row) || (row.content?.length ?? 0) !== width) return false;
    return (row.content ?? []).every((cell) => {
      if (cell.type !== (r === 0 && header ? 'tableHeader' : 'tableCell')) return false;
      const a = cell.attrs ?? {};
      if ((a.colspan ?? 1) !== 1 || (a.rowspan ?? 1) !== 1 || a.colwidth != null) return false;
      const blocks = cell.content ?? [];
      return blocks.length === 1 && blocks[0]!.type === 'paragraph' && !extraAttrs(blocks[0]!, []);
    });
  });
  return fits ? header : null;
}

/** Any table as a pipe table, each cell's blocks run together (reading only). */
function renderReadingTable(node: TipTapNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => renderBlocks(cell.content ?? [], true).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()),
  );
  if (rows.length === 0 || rows[0]!.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < width) r.push('');
  const line = (cells: string[]) => '| ' + cells.join(' | ') + ' |';
  return [line(rows[0]!), '| ' + rows[0]!.map(() => '---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n');
}

function renderSimpleTable(node: TipTapNode): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => renderTextLine(cell.content![0]!.content, { lineStart: false, inTable: true })),
  );
  const widths = rows[0]!.map((_, c) => Math.max(3, ...rows.map((r) => r[c]!.length)));
  const line = (cells: string[]) => '| ' + cells.map((cell, c) => cell.padEnd(widths[c]!)).join(' | ') + ' |';
  const out = [line(rows[0]!), '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |'];
  for (const row of rows.slice(1)) out.push(line(row));
  return out.join('\n');
}

// ─── Inline ──────────────────────────────────────────────────────────────────

interface LineOptions {
  /** The text begins a line, where `#`, `-`, `1.` … would start a block. */
  lineStart: boolean;
  inTable?: boolean;
  /** This node is the first of its line (its leading spaces would be trimmed). */
  first?: boolean;
}

const NATIVE_MARKS = new Set(['bold', 'italic', 'strike', 'underline', 'code', 'highlight', 'link']);
const DEFAULT_LINK_ATTRS: Record<string, unknown> = { target: '_blank', rel: 'noopener noreferrer nofollow', class: 'canvas-link', title: null };

/** Render inline nodes as one markdown line (hard breaks become `<br>`). */
function renderTextLine(content: TipTapNode[] | undefined, opts: LineOptions): string {
  // Neighbouring text with the same marks is one run (the editor merges
  // them too); written apart, two code spans would fuse into one fence.
  const nodes: TipTapNode[] = [];
  for (const node of content ?? []) {
    const last = nodes[nodes.length - 1];
    if (last && last.type === 'text' && node.type === 'text' && sameValue(last.marks ?? [], node.marks ?? [])) {
      nodes[nodes.length - 1] = { ...last, text: (last.text ?? '') + (node.text ?? '') };
    } else {
      nodes.push(node);
    }
  }
  let out = '';
  for (let i = 0; i < nodes.length; i++) {
    out += renderInline(nodes[i]!, out, nodes[i + 1], { ...opts, lineStart: opts.lineStart && i === 0, first: i === 0 });
  }
  return out;
}

function renderInline(node: TipTapNode, before: string, next: TipTapNode | undefined, opts: LineOptions): string {
  const hasMarks = (node.marks?.length ?? 0) > 0;
  if (node.type === 'hardBreak' && (!hasMarks || _reading)) return _reading ? '\n' : '<br>';
  if (node.type === 'inlineMath' && !hasMarks) {
    const latex = String(node.attrs?.latex ?? '');
    const display = node.attrs?.display === 'yes';
    const evaluate = node.attrs?.evaluate ?? 'no';
    const nextText = next?.type === 'text' ? next.text ?? '' : '';
    const ok = latex && !latex.includes('$') && !/^\s|\s$/.test(latex) && !latex.includes('\n') && evaluate === 'no'
      && (display || !/^\d/.test(nextText)) && !extraAttrs(node, ['latex', 'display']);
    if (ok) return display ? `$$${latex}$$` : `$${latex}$`;
    return carry('inline', withoutIds(node));
  }
  if (node.type === 'image' && !hasMarks) {
    // Not valid inside text in the page schema; the reader moves it to its
    // own block after the text.
    const src = String(node.attrs?.src ?? '');
    const dest = src ? linkDestination(src) : null;
    if (dest !== null) return `![${escapeText(String(node.attrs?.alt ?? ''), false, false, true)}](${dest})`;
  }
  if (node.type === 'unsupportedInline') {
    const original = parseRaw(node.attrs?.raw);
    return carry('inline', original ?? withoutIds(node));
  }
  if (node.type !== 'text') return carry('inline', withoutIds(node));
  return renderText(node, before, next, opts);
}

/** `before`: what is already written on the line. */
function renderText(node: TipTapNode, before: string, next: TipTapNode | undefined, opts: LineOptions): string {
  const text = node.text ?? '';
  if (!text) return '';
  const marks = node.marks ?? [];
  const has = (type: string) => marks.some((m) => m.type === type);
  const link = marks.find((m) => m.type === 'link');
  const linkDest = link ? linkDestination(String(link.attrs?.href ?? '')) : null;
  const linkNative = !!link && linkDest !== null
    && Object.entries(link.attrs ?? {}).every(([k, v]) => k === 'href' || sameValue(v, DEFAULT_LINK_ATTRS[k] ?? null) || v === undefined);
  const highlightNative = marks.every((m) => m.type !== 'highlight' || m.attrs?.color == null);
  const carried = marks.filter((m) => !NATIVE_MARKS.has(m.type) || (m.type === 'link' && !linkNative) || (m.type === 'highlight' && !highlightNative));

  if (has('code') && (text.includes('\n') || (opts.inTable && /\\$/.test(text)))) {
    // A code span cannot hold a line break.
    return carry('inline', withoutIds(node));
  }

  const bare = marks.length === 0;
  let out: string;
  if (has('code')) {
    out = codeSpan(opts.inTable ? text.replace(/\|/g, '\\|') : text);
  } else {
    out = escapeText(text, bare && opts.lineStart, !!opts.inTable, false);
    if (bare) out = encodeEdgeSpace(out, !!opts.first, next === undefined);
  }
  if (has('underline')) out = `<u>${out}</u>`;
  if (has('strike')) out = `~~${out}~~`;
  if (has('highlight') && highlightNative) out = `==${out}==`;
  if (has('italic')) {
    // `*a*` right after `*b*` would read as `**`; spaces at the edges would
    // stop `*` from counting as emphasis at all.
    if (/^\s|\s$/.test(text) || /[*_]$/.test(before)) out = `<em>${out}</em>`;
    else out = has('bold') ? `_${out}_` : `*${out}*`;
  }
  if (has('bold')) out = `**${out}**`;
  if (link && linkNative) out = `[${out}](${linkDest})`;
  if (carried.length > 0 && !_reading) out = `<span data-px="${encodeMarks(carried)}">${out}</span>`;
  return out;
}

function encodeMarks(marks: TipTapMark[]): string {
  return encodeURIComponent(JSON.stringify(marks)).replace(/[!'()*_~.-]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Leading/trailing whitespace of a text line, which markdown would trim. */
function encodeEdgeSpace(text: string, atStart: boolean, atEnd: boolean): string {
  let out = text;
  if (_reading) return out;
  if (atStart) out = out.replace(/^\s+/, (ws) => [...ws].map((c) => `&#${c.charCodeAt(0)};`).join(''));
  if (atEnd) out = out.replace(/\s+$/, (ws) => [...ws].map((c) => `&#${c.charCodeAt(0)};`).join(''));
  return out;
}

function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = /^`|`$/.test(text) || (/^ /.test(text) && / $/.test(text) && /[^ ]/.test(text)) ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

/**
 * A link destination the reader takes back exactly, or null when the URL
 * cannot be written as one (it then travels in a carrier).
 */
function linkDestination(href: string): string | null {
  if (/[<>\n\r]/.test(href)) return null;
  if (href === '' || /[\s()\\]/.test(href)) return `<${href}>`;
  return href;
}

const ENTITY_RE = /^&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|nbsp);/;

/**
 * Escape a text run so the reader takes every character literally.
 * `lineStart`: the run begins a line, where `#`, `>`, `-`, `+` and `1.`
 * would start a block.
 */
function escapeText(text: string, lineStart: boolean, inTable: boolean, inLabel: boolean): string {
  if (_reading) return inTable ? text.replace(/\|/g, '\\|').replace(/\n/g, ' ') : text;
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    const prev = text[i - 1];
    const next = text[i + 1];
    switch (ch) {
      case '\\':
        out += next === undefined || /[!-/:-@[-`{-~]/.test(next) ? '\\\\' : '\\';
        break;
      case '*': case '`': case '$': case '[': case ']': case '~':
        out += '\\' + ch;
        break;
      case '_':
        out += prev && next && /[A-Za-z0-9]/.test(prev) && /[A-Za-z0-9]/.test(next) ? '_' : '\\_';
        break;
      case '=':
        out += prev === '=' || next === '=' || prev === undefined || next === undefined ? '\\=' : '=';
        break;
      case '<':
        out += next === undefined || /[A-Za-z/!?]/.test(next) ? '\\<' : '<';
        break;
      case '&':
        out += ENTITY_RE.test(text.slice(i)) ? '\\&' : '&';
        break;
      case '|':
        out += inTable ? '\\|' : '|';
        break;
      case '!':
        // `!` then a link would read as an image.
        out += next === undefined ? '\\!' : '!';
        break;
      case '\n':
        out += '&#10;';
        break;
      default:
        out += ch;
    }
  }
  if (inLabel) return out;
  if (lineStart) {
    if (/^[#>+-]/.test(out)) out = '\\' + out;
    else {
      const ordered = /^(\d{1,9})([.)])(\s|$)/.exec(out);
      if (ordered) out = ordered[1] + '\\' + out.slice(ordered[1]!.length);
    }
  }
  return out;
}

// ─── Callout types ───────────────────────────────────────────────────────────

/** Icon → GitHub alert type (the reader maps these back). */
const CALLOUT_TYPE_BY_EMOJI: Record<string, string> = {
  lightbulb: 'TIP',
  note: 'NOTE',
  info: 'INFO',
  alert: 'IMPORTANT',
  warning: 'WARNING',
  check: 'SUCCESS',
  'x-circle': 'ERROR',
};
