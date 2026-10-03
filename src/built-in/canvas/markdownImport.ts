// markdownImport.ts — Markdown → TipTap JSON parser for canvas pages.
//
// The inverse of `tiptapJsonToMarkdown` (markdownExport.ts): reading back an
// export gives the same page. Pure-data transform — no DOM, no IPC, no DB.
// Produces a doc that can be stored directly in `pages.content` (wrapped by
// the schemaVersion envelope at the call site).
//
// Supported block syntax:
//   # / ## / ### …          → heading (levels 1-6)
//   - text / * text / + text → bulletList / listItem (a row can hold any
//                              block indented under it: code, quotes, lists)
//   1. text / 1) text       → orderedList (keeps its first number)
//   - [ ] / - [x] text      → taskList / taskItem
//   > text                  → blockquote
//   > [!type] Title         → callout (GitHub-style; type → icon)
//   ```lang\ncode\n```      → codeBlock
//   $$\nlatex\n$$           → mathBlock
//   ---                     → horizontalRule
//   ![alt](src)             → image
//   pipe tables             → table
//   <details>…</details>    → details (may nest)
//   <!-- parallx:… -->      → what markdown cannot say (see markdownExport.ts)
//
// Inline: **bold** *em* _em_ ~~s~~ ==mark== <u>u</u> <em>em</em> `code`
// [text](url) $latex$ $$latex$$ <br>, backslash escapes, and the entities
// &amp; &lt; &gt; &quot; &nbsp; &#NN; &#xNN;.
//
// Plain text reads as written, following CommonMark where it matters:
// `$5 and $10` is not math, `my_func_name` is not emphasis, `a * b * c` is not
// emphasis, and a backslash before a letter (C:\Users) stays.
//
// Never throws — unknown syntax becomes a plain paragraph.

// ─── Types ────────────────────────────────────────────────────────────────

export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, unknown>;
}

export interface TipTapMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface ImportOptions {
  /** Whether to assign a stable `attrs.id` to each block. Defaults to true.
   *  When false, blocks are created without ids — the editor will assign
   *  them on first load via the unique-id extension. */
  readonly assignBlockIds?: boolean;
  /** Optional id generator. Defaults to crypto.randomUUID(). */
  readonly idGenerator?: () => string;
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Convert a markdown string to a TipTap doc node.
 * Returns `{ type: 'doc', content: [...blocks] }`.
 *
 * Never throws — unknown syntax becomes a plain paragraph.
 */
export function markdownToTiptapJson(markdown: string, options: ImportOptions = {}): TipTapNode {
  const assignIds = options.assignBlockIds !== false;
  const idGen = options.idGenerator ?? defaultIdGenerator;

  const lines = normalizeNewlines(markdown ?? '').split('\n');
  const blocks = fitBlocks(parseBlocks(lines, 0, lines.length));

  // Doc must always contain at least one block — TipTap rejects empty docs.
  if (blocks.length === 0) blocks.push(makeParagraph([]));

  if (assignIds) {
    for (const block of blocks) stampBlockId(block, idGen);
  }

  return { type: 'doc', content: blocks };
}

// ─── Carriers (HTML comments written by the exporter) ─────────────────────

type CarrierKind = 'attrs' | 'empty' | 'atom' | 'block' | 'open' | 'close' | 'endblock';

const CARRIER_LINE_RE = /^\s*<!-- (\/?)parallx:(attrs|empty|atom|block|open|close)(?: (.*?))? -->\s*$/;
const ATTRS_PREFIX_RE = /^\s*<!-- parallx:attrs (\{.*?\}) -->\s?(.*)$/;
const ITEM_PREFIX_RE = /^<!-- parallx:item (\{.*?\}) -->\s?(.*)$/;
const OPEN_RE = /^\s*<!-- parallx:open .* -->\s*$/;
const CLOSE_RE = /^\s*<!-- parallx:close -->\s*$/;
const END_BLOCK_RE = /^\s*<!-- \/parallx:block -->\s*$/;

interface Carrier { kind: CarrierKind; value: unknown }

function matchCarrierLine(line: string): Carrier | null {
  const m = CARRIER_LINE_RE.exec(line);
  if (!m) return null;
  const kind = m[2] as CarrierKind;
  if (m[1] === '/') return kind === 'block' ? { kind: 'endblock', value: null } : null;
  if (kind === 'empty' || kind === 'close') return m[3] === undefined ? { kind, value: null } : null;
  const value = parseJson(m[3]);
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  if (kind !== 'attrs' && typeof (value as TipTapNode).type !== 'string') return null;
  return { kind, value };
}

function parseJson(text: string | undefined): unknown {
  if (text === undefined) return undefined;
  try { return JSON.parse(text); } catch { return undefined; }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ─── Top-level block parsing ──────────────────────────────────────────────

/**
 * Parse the line range `[start, end)` into a sequence of block nodes.
 * Recursive — invoked for the body of quotes, callouts, list rows, details
 * and carried blocks.
 */
function parseBlocks(lines: string[], start: number, end: number): TipTapNode[] {
  const out: TipTapNode[] = [];
  let pending: Record<string, unknown> | null = null;
  const push = (node: TipTapNode) => {
    if (pending) {
      const { headerRow, ...attrs } = pending;
      if (node.type === 'table' && headerRow === false) {
        // A pipe table always has a header row; this one had none.
        for (const cell of node.content?.[0]?.content ?? []) cell.type = 'tableCell';
      } else if (headerRow !== undefined) {
        attrs['headerRow'] = headerRow;
      }
      if (Object.keys(attrs).length > 0) node.attrs = { ...(node.attrs ?? {}), ...attrs };
      pending = null;
    }
    out.push(node);
  };
  let i = start;

  while (i < end) {
    const line = lines[i]!;

    // Skip blank lines at block boundaries
    if (line.trim() === '') { i++; continue; }

    // ── Carriers ─────────────────────────────────────────────────────
    const carrier = matchCarrierLine(line);
    if (carrier) {
      i++;
      switch (carrier.kind) {
        case 'attrs':
          pending = { ...(pending ?? {}), ...(carrier.value as Record<string, unknown>) };
          break;
        case 'empty':
          push(makeParagraph([]));
          break;
        case 'atom':
          push(carrier.value as TipTapNode);
          break;
        case 'block': {
          // The readable line(s) after it are for people; skip to the end mark.
          let j = i;
          while (j < end && j < i + 3 && !END_BLOCK_RE.test(lines[j]!)) j++;
          if (j < end && END_BLOCK_RE.test(lines[j]!)) i = j + 1;
          push(carrier.value as TipTapNode);
          break;
        }
        case 'open': {
          const close = findMatchingLine(lines, i - 1, end, OPEN_RE, CLOSE_RE);
          const innerEnd = close === -1 ? end : close;
          const node = { ...(carrier.value as TipTapNode) };
          node.content = parseBlocks(lines, i, innerEnd);
          push(finishOpenedNode(node));
          i = close === -1 ? end : close + 1;
          break;
        }
        default:
          // A stray close or end mark: nothing to do.
          break;
      }
      continue;
    }

    // ── Fenced code block ─────────────────────────────────────────────
    const fence = matchCodeFence(line);
    if (fence) {
      const codeLines: string[] = [];
      i++;
      while (i < end) {
        const cur = lines[i]!;
        if (matchCodeFenceClose(cur, fence.marker)) { i++; break; }
        codeLines.push(stripIndent(cur, fence.indent));
        i++;
      }
      push(makeCodeBlock(codeLines.join('\n'), fence.lang));
      continue;
    }

    // ── Math block ($$ … $$) ──────────────────────────────────────────
    if (line.trim() === '$$') {
      const mathLines: string[] = [];
      i++;
      while (i < end && lines[i]!.trim() !== '$$') {
        mathLines.push(lines[i]!);
        i++;
      }
      if (i < end) i++; // consume closing $$
      push({ type: 'mathBlock', attrs: { latex: mathLines.join('\n') } });
      continue;
    }

    // ── Horizontal rule ──────────────────────────────────────────────
    if (HR_RE.test(line)) {
      push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // ── ATX heading ──────────────────────────────────────────────────
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      push({
        type: 'heading',
        attrs: { level },
        content: parseInline((heading[2] ?? '').trim()),
      });
      i++;
      continue;
    }

    // ── Table (pipe-style) ───────────────────────────────────────────
    if (isTableHeader(line, lines[i + 1])) {
      const { node, consumed } = parseTable(lines, i, end);
      push(node);
      i += consumed;
      continue;
    }

    // ── Details (HTML) ───────────────────────────────────────────────
    if (DETAILS_OPEN_RE.test(line)) {
      const { node, consumed } = parseDetails(lines, i, end);
      push(node);
      i += consumed;
      continue;
    }

    // ── Blockquote / callout ─────────────────────────────────────────
    if (/^\s*>/.test(line)) {
      const { node, consumed } = parseBlockquote(lines, i, end);
      push(node);
      i += consumed;
      continue;
    }

    // ── Lists ────────────────────────────────────────────────────────
    if (matchListMarker(line)) {
      const { node, consumed } = parseList(lines, i, end);
      push(node);
      i += consumed;
      continue;
    }

    // ── Paragraph (gathers consecutive non-blank, non-block-starter lines) ──
    let first = line;
    let paraAttrs: Record<string, unknown> | null = null;
    const prefixed = ATTRS_PREFIX_RE.exec(line);
    if (prefixed) {
      const attrs = parseJson(prefixed[1]);
      if (isRecord(attrs)) {
        paraAttrs = attrs;
        first = prefixed[2]!;
      }
    }
    const paraLines: string[] = [first];
    i++;
    while (i < end) {
      const next = lines[i]!;
      if (next.trim() === '') break;
      if (isBlockStart(next, lines[i + 1])) break;
      paraLines.push(next);
      i++;
    }

    let node: TipTapNode;
    if (paraLines.length === 1 && first.trim() === '<!-- parallx:empty -->') {
      node = makeParagraph([]);
    } else {
      const inline = parseInline(joinParagraphLines(paraLines));
      // An image alone on its line is an image block.
      node = inline.length === 1 && inline[0]!.type === 'image' && !paraAttrs ? inline[0]! : makeParagraph(inline);
    }
    if (paraAttrs) node.attrs = { ...(node.attrs ?? {}), ...paraAttrs };
    push(node);
  }

  return out;
}

const HR_RE = /^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const DETAILS_OPEN_RE = /^\s*<details(\s+open)?\s*>\s*$/i;
const DETAILS_CLOSE_RE = /^\s*<\/details>\s*$/i;

/** Soft line breaks become spaces; a line ending in `\` or two spaces breaks. */
function joinParagraphLines(lines: string[]): string {
  let out = '';
  for (let k = 0; k < lines.length; k++) {
    let line = lines[k]!.replace(/^[ \t]+/, '');
    if (k === lines.length - 1) { out += line.replace(/[ \t]+$/, ''); break; }
    const slashes = /\\+$/.exec(line)?.[0].length ?? 0;
    if (slashes % 2 === 1) { out += line.slice(0, -1) + '\n'; continue; }
    if (/ {2,}$/.test(line)) { out += line.replace(/[ \t]+$/, '') + '\n'; continue; }
    line = line.replace(/[ \t]+$/, '');
    out += line + ' ';
  }
  return out;
}

/**
 * Returns true if `line` starts a block-level construct that would
 * terminate an in-progress paragraph.
 */
function isBlockStart(line: string, nextLine: string | undefined): boolean {
  if (matchCodeFence(line)) return true;
  if (line.trim() === '$$') return true;
  if (HR_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (matchListMarker(line)) return true;
  if (DETAILS_OPEN_RE.test(line)) return true;
  if (isTableHeader(line, nextLine)) return true;
  if (/^\s*<!-- \/?parallx:(attrs|empty|atom|block|open|close)\b/.test(line)) return true;
  return false;
}

/**
 * Index of the line closing the construct opened at `openIndex`, counting
 * nested opens and skipping fenced code. -1 when it is never closed.
 */
function findMatchingLine(lines: string[], openIndex: number, end: number, openRe: RegExp, closeRe: RegExp): number {
  let depth = 1;
  let j = openIndex + 1;
  while (j < end) {
    const line = lines[j]!;
    const fence = matchCodeFence(line);
    if (fence) {
      j++;
      while (j < end && !matchCodeFenceClose(lines[j]!, fence.marker)) j++;
      j++;
      continue;
    }
    if (openRe.test(line)) depth++;
    else if (closeRe.test(line)) {
      depth--;
      if (depth === 0) return j;
    }
    j++;
  }
  return -1;
}

/** Blocks that must hold at least one block. */
const NEEDS_BLOCK = new Set(['column', 'tableCell', 'tableHeader', 'detailsContent', 'callout', 'blockquote', 'listItem', 'taskItem']);

function finishOpenedNode(node: TipTapNode): TipTapNode {
  const content = node.content ?? [];
  if (node.type === 'toggleHeading') {
    const [first, ...rest] = content;
    const title: TipTapNode = { type: 'toggleHeadingText' };
    let body = content;
    if (first?.type === 'heading') {
      if (first.content && first.content.length > 0) title.content = first.content;
      body = rest;
    }
    node.content = [title, { type: 'detailsContent', content: body.length > 0 ? body : [makeParagraph([])] }];
    return node;
  }
  if (content.length === 0) {
    if (NEEDS_BLOCK.has(node.type)) node.content = [makeParagraph([])];
    else delete node.content;
  }
  return node;
}

// ─── Code fence helpers ───────────────────────────────────────────────────

interface CodeFence { marker: string; lang: string; indent: number }

function matchCodeFence(line: string): CodeFence | null {
  const m = /^(\s*)(```+|~~~+)([^\s`~]*)\s*$/.exec(line);
  if (!m) return null;
  return { marker: m[2]!, lang: m[3]!, indent: indentWidth(m[1]!) };
}

function matchCodeFenceClose(line: string, marker: string): boolean {
  const re = new RegExp(`^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
  return re.test(line);
}

function makeCodeBlock(code: string, lang: string): TipTapNode {
  const node: TipTapNode = { type: 'codeBlock', content: [{ type: 'text', text: code }] };
  if (lang) node.attrs = { language: lang };
  // codeBlock with empty code: TipTap accepts no content array; emit empty
  if (!code) node.content = undefined;
  return node;
}

// ─── List helpers ─────────────────────────────────────────────────────────

interface ListMarker {
  indent: number;
  kind: 'bullet' | 'ordered' | 'task';
  /** `-`, `*`, `+`, `.` or `)` — a change starts a new list. */
  char: string;
  num: number;
  checked: boolean;
  text: string;
  contentIndent: number;
}

const MARKER_RE = /^(\s*)([-*+]|\d{1,9}[.)])(?:[ \t]+(.*))?$/;
const TASK_BOX_RE = /^\[([ xX])\](?:[ \t]+(.*))?$/;

function matchListMarker(line: string): ListMarker | null {
  if (HR_RE.test(line)) return null;
  const m = MARKER_RE.exec(line);
  if (!m) return null;
  const indent = indentWidth(m[1]!);
  const marker = m[2]!;
  let text = m[3] ?? '';
  const ordered = /\d/.test(marker[0]!);
  let kind: ListMarker['kind'] = ordered ? 'ordered' : 'bullet';
  let checked = false;
  if (!ordered) {
    const box = TASK_BOX_RE.exec(text);
    if (box) {
      kind = 'task';
      checked = box[1]!.toLowerCase() === 'x';
      text = box[2] ?? '';
    }
  }
  return {
    indent,
    kind,
    char: ordered ? marker.slice(-1) : marker,
    num: ordered ? parseInt(marker, 10) : 1,
    checked,
    text,
    contentIndent: indent + marker.length + 1,
  };
}

function indentWidth(s: string): number {
  // Tabs as 4-spaces (markdown convention)
  let w = 0;
  for (const ch of s) {
    if (ch === ' ') w++;
    else if (ch === '\t') w += 4;
    else break;
  }
  return w;
}

/** Remove up to `width` columns of leading whitespace. */
function stripIndent(line: string, width: number): string {
  let w = 0;
  let k = 0;
  while (k < line.length && w < width) {
    const ch = line[k]!;
    if (ch === ' ') w++;
    else if (ch === '\t') w += 4;
    else break;
    k++;
  }
  return line.slice(k);
}

interface ListParse { node: TipTapNode; consumed: number }

function parseList(lines: string[], start: number, end: number): ListParse {
  const first = matchListMarker(lines[start]!)!;
  const sameList = (m: ListMarker | null): m is ListMarker =>
    !!m && m.indent === first.indent && m.kind === first.kind && m.char === first.char;
  const items: TipTapNode[] = [];
  let i = start;

  while (i < end) {
    const m = matchListMarker(lines[i]!);
    if (!sameList(m)) break;

    // The row's body: every following line indented past the marker, with
    // blank lines inside it; a lazy continuation line joins the first line.
    const body: string[] = [];
    let k = i + 1;
    while (k < end) {
      const line = lines[k]!;
      if (line.trim() === '') {
        let n = k;
        while (n < end && lines[n]!.trim() === '') n++;
        if (n < end && indentWidth(lines[n]!) > m.indent) {
          for (; k < n; k++) body.push('');
          continue;
        }
        break;
      }
      if (indentWidth(line) > m.indent) {
        body.push(stripIndent(line, Math.min(m.contentIndent, indentWidth(line))));
        k++;
        continue;
      }
      if (body.length === 0 && m.text !== '' && !isBlockStart(line, lines[k + 1])) {
        body.push(line.trim());
        k++;
        continue;
      }
      break;
    }

    let text = m.text;
    let itemAttrs: Record<string, unknown> | null = null;
    const itemPrefix = ITEM_PREFIX_RE.exec(text);
    if (itemPrefix) {
      const attrs = parseJson(itemPrefix[1]);
      if (isRecord(attrs)) {
        itemAttrs = attrs;
        text = itemPrefix[2]!;
      }
    }

    let children: TipTapNode[];
    if (text === '') {
      children = [makeParagraph([]), ...parseBlocks(body, 0, body.length)];
    } else {
      const rowLines = [text, ...body];
      children = parseBlocks(rowLines, 0, rowLines.length);
      if (children[0]?.type !== 'paragraph') children.unshift(makeParagraph([]));
    }

    const item: TipTapNode = m.kind === 'task'
      ? { type: 'taskItem', attrs: { checked: m.checked }, content: children }
      : { type: 'listItem', content: children };
    if (itemAttrs) item.attrs = { ...(item.attrs ?? {}), ...itemAttrs };
    items.push(item);

    i = k;
    // A blank line between rows of the same list keeps the list going.
    let n = i;
    while (n < end && lines[n]!.trim() === '') n++;
    if (n > i && n < end && sameList(matchListMarker(lines[n]!))) i = n;
  }

  const type = first.kind === 'task' ? 'taskList' : first.kind === 'ordered' ? 'orderedList' : 'bulletList';
  const node: TipTapNode = { type, content: items };
  if (first.kind === 'ordered' && first.num !== 1) node.attrs = { start: first.num };
  return { node, consumed: i - start };
}

// ─── Blockquote / callout ────────────────────────────────────────────────

interface BqParse { node: TipTapNode; consumed: number }

/**
 * Parse a blockquote starting at `lines[start]`. Detects GitHub-style
 * callout syntax (first body line starts with `[!type]`).
 */
function parseBlockquote(lines: string[], start: number, end: number): BqParse {
  // Collect raw quote body (strip one leading `> ` per line)
  const body: string[] = [];
  let i = start;
  while (i < end) {
    const line = lines[i]!;
    if (!/^\s*>/.test(line)) break;
    body.push(line.replace(/^\s*>[ \t]?/, ''));
    i++;
  }

  // Check for GitHub callout marker on the first non-empty body line.
  let calloutType: string | null = null;
  let calloutTitle: string | null = null;
  if (body.length > 0) {
    const calloutHead = /^\s*\[!(\w+)\]\s*(.*)$/.exec(body[0]!);
    if (calloutHead) {
      calloutType = calloutHead[1]!.toLowerCase();
      calloutTitle = (calloutHead[2] || '').trim();
      body.shift();
    } else {
      // Legacy export form: > **Note:** body
      const legacy = /^\s*\*\*([A-Za-z]+):\*\*\s*(.*)$/.exec(body[0]!);
      if (legacy) {
        calloutType = legacy[1]!.toLowerCase();
        body[0] = legacy[2]!;
      }
    }
  }

  const innerBlocks = parseBlocks(body, 0, body.length);

  if (calloutType) {
    const emoji = mapCalloutTypeToEmoji(calloutType);
    const content: TipTapNode[] = [];
    if (calloutTitle) {
      // Render the title as a leading paragraph with strong text
      content.push(makeParagraph(parseInline(calloutTitle).map((n) => (n.type === 'text' ? { ...n, marks: [...(n.marks ?? []), { type: 'bold' }] } : n))));
    }
    for (const b of innerBlocks) content.push(b);
    if (content.length === 0) content.push(makeParagraph([]));
    return { node: { type: 'callout', attrs: { emoji }, content }, consumed: i - start };
  }

  return {
    node: { type: 'blockquote', content: innerBlocks.length > 0 ? innerBlocks : [makeParagraph([])] },
    consumed: i - start,
  };
}

function mapCalloutTypeToEmoji(type: string): string {
  const map: Record<string, string> = {
    note: 'note',
    info: 'info',
    tip: 'lightbulb',
    important: 'alert',
    warning: 'warning',
    caution: 'alert',
    success: 'check',
    error: 'x-circle',
  };
  return map[type] ?? 'lightbulb';
}

// ─── Details (HTML) ──────────────────────────────────────────────────────

interface DetailsParse { node: TipTapNode; consumed: number }

function parseDetails(lines: string[], start: number, end: number): DetailsParse {
  const open = /\bopen\b/i.test(lines[start]!);
  const close = findMatchingLine(lines, start, end, DETAILS_OPEN_RE, DETAILS_CLOSE_RE);
  const bodyEnd = close === -1 ? end : close;
  let i = start + 1;
  while (i < bodyEnd && lines[i]!.trim() === '') i++;
  let summary: TipTapNode[] = parseInline('Details');
  const summaryMatch = i < bodyEnd ? /^\s*<summary>(.*)<\/summary>\s*$/i.exec(lines[i]!) : null;
  if (summaryMatch) {
    summary = parseInline(summaryMatch[1]!.trim());
    i++;
  }

  const bodyBlocks = parseBlocks(lines, i, bodyEnd);
  const summaryNode: TipTapNode = { type: 'detailsSummary' };
  if (summary.length > 0) summaryNode.content = summary;
  const node: TipTapNode = {
    type: 'details',
    content: [
      summaryNode,
      { type: 'detailsContent', content: bodyBlocks.length > 0 ? bodyBlocks : [makeParagraph([])] },
    ],
  };
  if (open) node.attrs = { open: true };
  return { node, consumed: (close === -1 ? end : close + 1) - start };
}

// ─── Tables ──────────────────────────────────────────────────────────────

const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

function isTableHeader(line: string, next: string | undefined): boolean {
  if (!next) return false;
  if (!line.includes('|') || !next.includes('|')) return false;
  return TABLE_SEP_RE.test(next);
}

interface TableParse { node: TipTapNode; consumed: number }

function parseTable(lines: string[], start: number, end: number): TableParse {
  const headerCells = splitTableRow(lines[start]!);
  const colCount = headerCells.length;
  let i = start + 2; // skip header + separator

  const rows: TipTapNode[] = [];
  // Header row
  rows.push({
    type: 'tableRow',
    content: headerCells.map((c) => ({
      type: 'tableHeader',
      content: [makeParagraph(parseInline(c))],
    })),
  });

  while (i < end) {
    const line = lines[i]!;
    if (!line.includes('|') || line.trim() === '') break;
    const cells = splitTableRow(line);
    // Pad or truncate to header column count
    while (cells.length < colCount) cells.push('');
    cells.length = colCount;
    rows.push({
      type: 'tableRow',
      content: cells.map((c) => ({
        type: 'tableCell',
        content: [makeParagraph(parseInline(c))],
      })),
    });
    i++;
  }

  return { node: { type: 'table', content: rows }, consumed: i - start };
}

function splitTableRow(line: string): string[] {
  // Strip leading/trailing pipes, split on un-escaped pipes. `\|` is a pipe
  // in the cell; any other escape is left for the inline parser.
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|') && !/(^|[^\\])(\\\\)*\\\|$/.test(trimmed)) trimmed = trimmed.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === '\\' && trimmed[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '\\' && i + 1 < trimmed.length) { cur += ch + trimmed[i + 1]; i++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

// ─── Inline parsing ──────────────────────────────────────────────────────

/**
 * Parse inline markdown into an array of TipTap text/inline nodes.
 *
 * A hand-rolled left-to-right tokenizer: it only matches paired delimiters,
 * and follows CommonMark's flanking rules for `*`, `_` and `$` so ordinary
 * text (prices, snake_case, arithmetic) is never read as markup.
 */
export function parseInline(text: string): TipTapNode[] {
  if (!text) return [];
  return tokenize(text, []);
}

const ASCII_PUNCT_RE = /[!-/:-@[-`{-~]/;
const ENTITY_RE = /^&(#\d+|#x[0-9a-fA-F]+|amp|lt|gt|quot|nbsp);/;
const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', nbsp: '\u00a0' };

function decodeEntity(body: string): string | null {
  if (body.startsWith('#x') || body.startsWith('#X')) {
    const code = parseInt(body.slice(2), 16);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
  }
  if (body.startsWith('#')) {
    const code = parseInt(body.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;
  }
  return NAMED_ENTITIES[body] ?? null;
}

const isSpace = (c: string | undefined) => c !== undefined && /\s/.test(c);
const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);

function hasMark(active: TipTapMark[], type: string): boolean {
  return active.some((m) => m.type === type);
}

function addMark(active: TipTapMark[], mark: TipTapMark): TipTapMark[] {
  return hasMark(active, mark.type) ? active : [...active, mark];
}

function tokenize(text: string, active: TipTapMark[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  let buf = '';

  const flush = () => {
    if (buf) {
      out.push(makeTextNode(buf, active));
      buf = '';
    }
  };
  const nested = (inner: string, marks: TipTapMark[]) => {
    flush();
    out.push(...tokenize(inner, marks));
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const rest = text.slice(i);

    // Escapes: a backslash before punctuation makes it literal; before
    // anything else it is just a backslash (C:\Users).
    if (ch === '\\') {
      const next = text[i + 1];
      if (next !== undefined && ASCII_PUNCT_RE.test(next)) { buf += next; i += 2; continue; }
      buf += ch;
      i++;
      continue;
    }

    // Hard break (a joined paragraph line ended with `\` or two spaces).
    if (ch === '\n') {
      flush();
      out.push({ type: 'hardBreak' });
      i++;
      continue;
    }

    if (ch === '&') {
      const ent = ENTITY_RE.exec(rest);
      const decoded = ent ? decodeEntity(ent[1]!) : null;
      if (ent && decoded !== null) { buf += decoded; i += ent[0].length; continue; }
    }

    if (ch === '<') {
      // Carried inline node
      const carried = /^<!-- parallx:inline (.*?) -->/.exec(rest);
      if (carried) {
        const node = parseJson(carried[1]);
        if (isRecord(node) && typeof node.type === 'string') {
          flush();
          out.push(node as unknown as TipTapNode);
          i += carried[0].length;
          continue;
        }
      }
      const br = /^<br\s*\/?>/i.exec(rest);
      if (br) {
        flush();
        out.push({ type: 'hardBreak' });
        i += br[0].length;
        continue;
      }
      // Carried marks
      const span = /^<span data-px="([^"]*)">/.exec(rest);
      if (span) {
        const close = rest.indexOf('</span>', span[0].length);
        const marks = parseJson(safeDecode(span[1]!));
        if (close !== -1 && Array.isArray(marks)) {
          let next = active;
          for (const mk of marks) if (isRecord(mk) && typeof mk.type === 'string') next = addMark(next, mk as unknown as TipTapMark);
          nested(rest.slice(span[0].length, close), next);
          i += close + '</span>'.length;
          continue;
        }
      }
      const tag = /^<(u|em|i)>/i.exec(rest);
      if (tag) {
        const name = tag[1]!.toLowerCase();
        const markType = name === 'u' ? 'underline' : 'italic';
        const close = rest.toLowerCase().indexOf(`</${name}>`, tag[0].length);
        if (close > tag[0].length && !hasMark(active, markType)) {
          nested(rest.slice(tag[0].length, close), addMark(active, { type: markType }));
          i += close + name.length + 3;
          continue;
        }
      }
    }

    // Image: ![alt](src)
    if (ch === '!' && text[i + 1] === '[') {
      const img = matchLinkLike(rest.slice(1));
      if (img) {
        flush();
        const alt = unescapeText(img.text);
        out.push({ type: 'image', attrs: alt ? { alt, src: img.href } : { src: img.href } });
        i += 1 + img.consumed;
        continue;
      }
    }

    // Link: [text](url)
    if (ch === '[' && !hasMark(active, 'link')) {
      const link = matchLinkLike(rest);
      if (link) {
        nested(link.text, addMark(active, { type: 'link', attrs: { href: link.href } }));
        i += link.consumed;
        continue;
      }
    }

    // Inline code: `…`
    if (ch === '`') {
      const code = matchInlineCode(rest);
      if (code) {
        flush();
        out.push(makeTextNode(code.text, addMark(active, { type: 'code' })));
        i += code.consumed;
        continue;
      }
      // An unmatched backtick run is literal as a whole.
      const run = /^`+/.exec(rest)![0];
      buf += run;
      i += run.length;
      continue;
    }

    // Inline math: $…$ (single dollars; double-dollars inline → display)
    if (ch === '$') {
      const m = matchInlineMath(rest);
      if (m) {
        flush();
        out.push({ type: 'inlineMath', attrs: { latex: m.latex, display: m.display ? 'yes' : 'no' } });
        i += m.consumed;
        continue;
      }
      buf += ch;
      i++;
      continue;
    }

    // Bold + italic: *** … ***
    if (rest.startsWith('***') && !hasMark(active, 'bold') && !hasMark(active, 'italic') && !isSpace(text[i + 3])) {
      const close = findClose(rest, '***', 3);
      if (close > 3) {
        nested(rest.slice(3, close), addMark(addMark(active, { type: 'bold' }), { type: 'italic' }));
        i += close + 3;
        continue;
      }
    }

    // Bold: ** … **
    if (rest.startsWith('**') && !hasMark(active, 'bold')) {
      const close = findClose(rest, '**', 2);
      if (close > 2) {
        nested(rest.slice(2, close), addMark(active, { type: 'bold' }));
        i += close + 2;
        continue;
      }
      buf += '**';
      i += 2;
      continue;
    }

    // Italic: * … * or _ … _ (not inside a word for `_`, not around spaces)
    if ((ch === '*' || ch === '_') && !hasMark(active, 'italic') && !isSpace(text[i + 1]) && text[i + 1] !== undefined
      && !(ch === '_' && isWordChar(text[i - 1]))) {
      const close = findClose(rest, ch, 1);
      if (close > 1) {
        nested(rest.slice(1, close), addMark(active, { type: 'italic' }));
        i += close + 1;
        continue;
      }
    }

    // Strike: ~~ … ~~
    if (rest.startsWith('~~') && !hasMark(active, 'strike')) {
      const close = findClose(rest, '~~', 2);
      if (close > 2) {
        nested(rest.slice(2, close), addMark(active, { type: 'strike' }));
        i += close + 2;
        continue;
      }
    }

    // Highlight: == … ==
    if (rest.startsWith('==') && !hasMark(active, 'highlight')) {
      const close = findClose(rest, '==', 2);
      if (close > 2) {
        nested(rest.slice(2, close), addMark(active, { type: 'highlight' }));
        i += close + 2;
        continue;
      }
    }

    buf += ch;
    i++;
  }

  flush();
  return out;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return ''; }
}

/** Text with markdown escapes and entities resolved (image alt text). */
function unescapeText(s: string): string {
  return tokenize(s, []).map((n) => n.text ?? '').join('');
}

function makeTextNode(text: string, active: TipTapMark[]): TipTapNode {
  const node: TipTapNode = { type: 'text', text };
  if (active.length > 0) node.marks = active.map((m) => ({ ...m }));
  return node;
}

/**
 * Find where `marker` closes a run opened at the start of `s`, scanning from
 * `from`. Escapes, code spans, comments, carried marks and link destinations
 * are skipped. Returns -1 if not found.
 */
function findClose(s: string, marker: string, from: number): number {
  let j = from;
  while (j < s.length) {
    const c = s[j]!;
    if (c === '\\') { j += 2; continue; }
    if (c === '`') {
      const code = matchInlineCode(s.slice(j));
      if (code) { j += code.consumed; continue; }
      j += /^`+/.exec(s.slice(j))![0].length;
      continue;
    }
    if (s.startsWith('<!--', j)) {
      const k = s.indexOf('-->', j + 4);
      if (k !== -1) { j = k + 3; continue; }
    }
    if (s.startsWith('<span data-px="', j)) {
      const k = s.indexOf('">', j);
      if (k !== -1) { j = k + 2; continue; }
    }
    if (c === ']' && s[j + 1] === '(') {
      const k = destinationEnd(s, j + 2);
      if (k !== -1) { j = k + 1; continue; }
    }
    if (marker === '*' || marker === '_') {
      if (c === marker) {
        // `**` inside an italic run is a bold run, not the italic's end —
        // except at `***`, where the first star closes the italic.
        if (marker === '*' && s[j + 1] === '*' && s[j + 2] !== '*') {
          const boldClose = findClose(s.slice(j), '**', 2);
          if (boldClose > 2) { j += boldClose + 2; continue; }
        }
        if (j > from && !isSpace(s[j - 1]) && !(marker === '_' && isWordChar(s[j + 1]))) return j;
      }
      j++;
      continue;
    }
    if (s.startsWith(marker, j) && j > from) return j;
    j++;
  }
  return -1;
}

/** Index of the `)` closing a link destination that starts at `start`, or -1. */
function destinationEnd(s: string, start: number): number {
  if (s[start] === '<') {
    const close = s.indexOf('>', start + 1);
    if (close === -1 || s[close + 1] !== ')') return -1;
    const inner = s.slice(start + 1, close);
    if (/[<\n]/.test(inner)) return -1;
    return close + 1;
  }
  let depth = 0;
  for (let j = start; j < s.length; j++) {
    const c = s[j]!;
    if (c === '\\' && j + 1 < s.length) { j++; continue; }
    if (c === '(') depth++;
    else if (c === ')') {
      if (depth === 0) return j;
      depth--;
    }
  }
  return -1;
}

function matchLinkLike(rest: string): { text: string; href: string; consumed: number } | null {
  // [text](href) where text may contain inline marks but no unmatched ]
  if (rest[0] !== '[') return null;
  let depth = 1;
  let i = 1;
  while (i < rest.length) {
    const c = rest[i]!;
    if (c === '\\') { i += 2; continue; }
    if (c === '`') {
      const code = matchInlineCode(rest.slice(i));
      if (code) { i += code.consumed; continue; }
    }
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  if (depth !== 0 || i >= rest.length) return null;
  const textEnd = i;
  if (rest[i + 1] !== '(') return null;
  const hrefStart = i + 2;
  const hrefEnd = destinationEnd(rest, hrefStart);
  if (hrefEnd === -1) return null;
  let href = rest.slice(hrefStart, hrefEnd);
  if (href.startsWith('<') && href.endsWith('>')) href = href.slice(1, -1);
  else href = href.trim();
  return {
    text: rest.slice(1, textEnd),
    href,
    consumed: hrefEnd + 1,
  };
}

function matchInlineCode(rest: string): { text: string; consumed: number } | null {
  const open = /^`+/.exec(rest);
  if (!open) return null;
  const len = open[0].length;
  // Find a closing run of exactly the same length.
  let j = len;
  while (j < rest.length) {
    if (rest[j] !== '`') { j++; continue; }
    let k = j;
    while (k < rest.length && rest[k] === '`') k++;
    if (k - j === len) {
      let text = rest.slice(len, j);
      if (text.length >= 2 && text.startsWith(' ') && text.endsWith(' ') && /[^ ]/.test(text)) text = text.slice(1, -1);
      return { text, consumed: k };
    }
    j = k;
  }
  return null;
}

function matchInlineMath(rest: string): { latex: string; display: boolean; consumed: number } | null {
  // $$…$$ inline (display=yes); otherwise $…$
  if (rest.startsWith('$$')) {
    for (let j = 2; j < rest.length - 1; j++) {
      if (rest[j] === '\\') { j++; continue; }
      if (rest[j] === '$' && rest[j + 1] === '$') {
        if (j === 2) return null;
        return { latex: rest.slice(2, j), display: true, consumed: j + 2 };
      }
    }
    return null;
  }
  // Single $ (pandoc's rule): the opener is followed by a non-space; the
  // closer follows a non-space and is not followed by a digit. So
  // "$5 and $10" stays text.
  if (rest[1] === undefined || isSpace(rest[1]) || rest[1] === '$') return null;
  for (let j = 1; j < rest.length; j++) {
    if (rest[j] === '\\') { j++; continue; }
    if (rest[j] === '$') {
      if (!isSpace(rest[j - 1]) && !/\d/.test(rest[j + 1] ?? '')) {
        return { latex: rest.slice(1, j), display: false, consumed: j + 1 };
      }
    }
  }
  return null;
}

// ─── Fitting the result to the page schema ──────────────────────────────

/** Nodes whose content is inline text, not blocks. */
const TEXT_BLOCKS = new Set(['paragraph', 'heading', 'toggleHeadingText', 'detailsSummary', 'codeBlock']);

/**
 * Images are blocks in the page schema: an image written inside a line of
 * text becomes its own block after that text. Inline-only places (a details
 * summary, a toggle heading title) keep the image's alt text instead.
 */
function fitBlocks(blocks: TipTapNode[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'heading') {
      out.push(...splitOutImages(block));
      continue;
    }
    if (block.type === 'detailsSummary') {
      if (block.content) block.content = textOnly(block.content);
      if (block.content?.length === 0) delete block.content;
    } else if (block.type === 'toggleHeadingText') {
      if (block.content) block.content = block.content.map((n) => (n.type === 'image' ? textOfImage(n) : n)).filter((n): n is TipTapNode => !!n);
    } else if (Array.isArray(block.content) && !TEXT_BLOCKS.has(block.type)) {
      block.content = fitBlocks(block.content);
      if ((block.type === 'listItem' || block.type === 'taskItem') && block.content[0]?.type !== 'paragraph') {
        block.content.unshift(makeParagraph([]));
      }
    }
    out.push(block);
  }
  return out;
}

function splitOutImages(block: TipTapNode): TipTapNode[] {
  const content = block.content ?? [];
  if (!content.some((n) => n.type === 'image')) return [block];
  const out: TipTapNode[] = [];
  let run: TipTapNode[] = [];
  let first = true;
  const flushRun = () => {
    const trimmed = trimRun(run);
    if (trimmed.length > 0 || (first && block.type === 'heading')) {
      const node: TipTapNode = first ? { ...block } : { type: 'paragraph' };
      if (trimmed.length > 0) node.content = trimmed;
      else delete node.content;
      out.push(node);
      first = false;
    }
    run = [];
  };
  for (const n of content) {
    if (n.type === 'image') {
      flushRun();
      out.push({ type: 'image', attrs: n.attrs });
    } else {
      run.push(n);
    }
  }
  flushRun();
  return out;
}

/** Drop the spaces that only separated text from an image. */
function trimRun(run: TipTapNode[]): TipTapNode[] {
  const nodes = run.map((n) => ({ ...n }));
  const firstNode = nodes[0];
  if (firstNode?.type === 'text' && !firstNode.marks) firstNode.text = firstNode.text!.replace(/^\s+/, '');
  const lastNode = nodes[nodes.length - 1];
  if (lastNode?.type === 'text' && !lastNode.marks) lastNode.text = lastNode.text!.replace(/\s+$/, '');
  return nodes.filter((n) => n.type !== 'text' || n.text);
}

function textOfImage(n: TipTapNode): TipTapNode | null {
  const alt = String(n.attrs?.alt ?? '');
  return alt ? { type: 'text', text: alt } : null;
}

/** A details summary holds plain (marked) text only. */
function textOnly(nodes: TipTapNode[]): TipTapNode[] {
  const out: TipTapNode[] = [];
  for (const n of nodes) {
    if (n.type === 'text') out.push(n);
    else if (n.type === 'image') { const t = textOfImage(n); if (t) out.push(t); }
    else if (n.type === 'inlineMath') out.push({ type: 'text', text: `$${String(n.attrs?.latex ?? '')}$` });
    else if (n.type === 'hardBreak') out.push({ type: 'text', text: ' ' });
  }
  return out;
}

// ─── Misc helpers ────────────────────────────────────────────────────────

function normalizeNewlines(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

function makeParagraph(content: TipTapNode[]): TipTapNode {
  const node: TipTapNode = { type: 'paragraph' };
  if (content.length > 0) node.content = content;
  return node;
}

function defaultIdGenerator(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const r = (n: number) => Math.floor(Math.random() * n).toString(16).padStart(2, '0');
  return `${r(256)}${r(256)}${r(256)}${r(256)}-${r(256)}${r(256)}-${r(256)}${r(256)}-${r(256)}${r(256)}-${r(256)}${r(256)}${r(256)}${r(256)}${r(256)}${r(256)}`;
}

/**
 * Block types that carry an `attrs.id` per UNIQUE_ID_BLOCK_TYPES.
 * Mirrors the canonical list in `config/tiptapExtensions.ts` — kept
 * inline here to keep this module free of TipTap runtime imports.
 * The contract test `tests/unit/canvasMarkdownImportUniqueId.test.ts`
 * guards against drift.
 */
const UNIQUE_ID_BLOCK_TYPES = new Set<string>([
  // ── StarterKit blocks ──
  'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem',
  'blockquote', 'horizontalRule',
  // ── Content blocks ──
  'codeBlock', 'image', 'taskList', 'taskItem', 'callout', 'mathBlock',
  'toggleHeading', 'toggleHeadingText', 'details', 'detailsSummary',
  'detailsContent', 'bookmark', 'pageBlock', 'tableOfContents',
  'video', 'audio', 'fileAttachment', 'conceptMap',
  // ── Table nodes ──
  'table', 'tableRow', 'tableCell', 'tableHeader',
  // ── Column nodes ──
  'columnList', 'column',
  // ── M60 Phase δ ──
  'dataview',
]);

function stampBlockId(node: TipTapNode, gen: () => string): void {
  if (UNIQUE_ID_BLOCK_TYPES.has(node.type)) {
    const attrs = node.attrs ?? {};
    if (typeof attrs['id'] !== 'string' || !attrs['id']) {
      node.attrs = { ...attrs, id: gen() };
    }
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) stampBlockId(child, gen);
  }
}
