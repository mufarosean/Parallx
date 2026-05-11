// markdownImport.ts — Markdown → TipTap JSON parser for canvas pages.
//
// The inverse of `tiptapJsonToMarkdown` (markdownExport.ts). Pure-data
// transform — no DOM, no IPC, no DB. Produces a doc that can be stored
// directly in `pages.content` (wrapped by the schemaVersion envelope at
// the call site).
//
// Supported block syntax (mirrors the export side):
//   # / ## / ### …          → heading (levels 1-6)
//   - text / * text         → bulletList / listItem
//   1. text                 → orderedList / listItem
//   - [ ] / - [x] text      → taskList / taskItem
//   > text                  → blockquote
//   > [!type] Title         → callout (GitHub-style; type → emoji)
//   ```lang\ncode\n```      → codeBlock
//   $$\nlatex\n$$           → mathBlock
//   ---                     → horizontalRule
//   ![alt](src)             → image (when alone on a line)
//   pipe tables             → table
//   <details>…</details>    → details
//   $latex$                 → inlineMath (inline)
//   **bold** *em* ~~s~~     → inline marks (bold, italic, strike)
//   `code`                  → inline code mark
//   [text](url)             → link mark
//   ==text==                → highlight mark
//   <u>text</u>             → underline mark
//
// Intentionally unsupported (markdown is not the right surface for these;
// the user creates them via the slash menu):
//   columnList, video, audio, fileAttachment, tableOfContents,
//   pageBlock, bookmark (as separate block — handled as link mark),
//   toggleHeading (regular details covers AI's needs)
//
// Unknown lines fall through as plain paragraphs.

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

  const lines = normalizeNewlines(markdown).split('\n');
  const blocks = parseBlocks(lines, 0, lines.length);

  if (assignIds) {
    for (const block of blocks) stampBlockId(block, idGen);
  }

  // Doc must always contain at least one block — TipTap rejects empty docs.
  if (blocks.length === 0) {
    blocks.push(makeParagraph([]));
    if (assignIds) stampBlockId(blocks[0]!, idGen);
  }

  return { type: 'doc', content: blocks };
}

// ─── Top-level block parsing ──────────────────────────────────────────────

/**
 * Parse the line range `[start, end)` into a sequence of block nodes.
 * Recursive — invoked for the body of blockquotes, callouts, and details.
 */
function parseBlocks(lines: string[], start: number, end: number): TipTapNode[] {
  const out: TipTapNode[] = [];
  let i = start;

  while (i < end) {
    const line = lines[i]!;

    // Skip blank lines at block boundaries
    if (line.trim() === '') { i++; continue; }

    // ── Fenced code block ─────────────────────────────────────────────
    const fence = matchCodeFence(line);
    if (fence) {
      const lang = fence.lang;
      const codeLines: string[] = [];
      i++;
      while (i < end) {
        const cur = lines[i]!;
        if (matchCodeFenceClose(cur, fence.marker)) { i++; break; }
        codeLines.push(cur);
        i++;
      }
      out.push(makeCodeBlock(codeLines.join('\n'), lang));
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
      out.push({ type: 'mathBlock', attrs: { latex: mathLines.join('\n') } });
      continue;
    }

    // ── Horizontal rule ──────────────────────────────────────────────
    if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      out.push({ type: 'horizontalRule' });
      i++;
      continue;
    }

    // ── ATX heading ──────────────────────────────────────────────────
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]!.length;
      out.push({
        type: 'heading',
        attrs: { level },
        content: parseInline(heading[2]!.trim()),
      });
      i++;
      continue;
    }

    // ── Table (pipe-style) ───────────────────────────────────────────
    if (isTableHeader(line, lines[i + 1])) {
      const { node, consumed } = parseTable(lines, i, end);
      out.push(node);
      i += consumed;
      continue;
    }

    // ── Image alone on a line ────────────────────────────────────────
    const imgOnly = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (imgOnly) {
      out.push({ type: 'image', attrs: { alt: imgOnly[1] || '', src: imgOnly[2] || '' } });
      i++;
      continue;
    }

    // ── Details (HTML) ───────────────────────────────────────────────
    if (/^\s*<details>\s*$/.test(line)) {
      const { node, consumed } = parseDetails(lines, i, end);
      out.push(node);
      i += consumed;
      continue;
    }

    // ── Blockquote / callout ─────────────────────────────────────────
    if (/^\s*>/.test(line)) {
      const { node, consumed } = parseBlockquote(lines, i, end);
      out.push(node);
      i += consumed;
      continue;
    }

    // ── Task list ────────────────────────────────────────────────────
    if (isTaskItem(line)) {
      const { node, consumed } = parseTaskList(lines, i, end);
      out.push(node);
      i += consumed;
      continue;
    }

    // ── Bullet list ──────────────────────────────────────────────────
    if (isBulletItem(line)) {
      const { node, consumed } = parseBulletList(lines, i, end);
      out.push(node);
      i += consumed;
      continue;
    }

    // ── Ordered list ─────────────────────────────────────────────────
    if (isOrderedItem(line)) {
      const { node, consumed } = parseOrderedList(lines, i, end);
      out.push(node);
      i += consumed;
      continue;
    }

    // ── Paragraph (gathers consecutive non-blank, non-block-starter lines) ──
    const paraLines: string[] = [line];
    i++;
    while (i < end) {
      const next = lines[i]!;
      if (next.trim() === '') break;
      if (isBlockStart(next, lines[i + 1])) break;
      paraLines.push(next);
      i++;
    }
    out.push(makeParagraph(parseInline(paraLines.join(' '))));
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
  if (/^\s*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) return true;
  if (/^#{1,6}\s+/.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (isTaskItem(line)) return true;
  if (isBulletItem(line)) return true;
  if (isOrderedItem(line)) return true;
  if (/^\s*<details>\s*$/.test(line)) return true;
  if (isTableHeader(line, nextLine)) return true;
  return false;
}

// ─── Code fence helpers ───────────────────────────────────────────────────

interface CodeFence { marker: string; lang: string }

function matchCodeFence(line: string): CodeFence | null {
  const m = /^(\s*)(```+|~~~+)([^\s`~]*)\s*$/.exec(line);
  if (!m) return null;
  return { marker: m[2]!, lang: m[3]! };
}

function matchCodeFenceClose(line: string, marker: string): boolean {
  const re = new RegExp(`^\\s*${marker[0]!}{${marker.length},}\\s*$`);
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

const BULLET_RE = /^(\s*)[-*+]\s+(?!\[[ xX]\])(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const TASK_RE = /^(\s*)[-*+]\s+\[([ xX])\]\s*(.*)$/;

function isBulletItem(line: string): boolean { return BULLET_RE.test(line); }
function isOrderedItem(line: string): boolean { return ORDERED_RE.test(line); }
function isTaskItem(line: string): boolean { return TASK_RE.test(line); }

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

interface ListParse { node: TipTapNode; consumed: number }

function parseBulletList(lines: string[], start: number, end: number): ListParse {
  return parseList(lines, start, end, 'bulletList', BULLET_RE, (m) => ({ indent: indentWidth(m[1]!), text: m[2]! }));
}

function parseOrderedList(lines: string[], start: number, end: number): ListParse {
  return parseList(lines, start, end, 'orderedList', ORDERED_RE, (m) => ({ indent: indentWidth(m[1]!), text: m[3]! }));
}

function parseTaskList(lines: string[], start: number, end: number): ListParse {
  const items: TipTapNode[] = [];
  let i = start;
  const baseIndent = indentWidth(lines[start]!);

  while (i < end) {
    const line = lines[i]!;
    const m = TASK_RE.exec(line);
    if (!m || indentWidth(m[1]!) !== baseIndent) break;

    const checked = m[2]!.toLowerCase() === 'x';
    const text = m[3]!;
    items.push({
      type: 'taskItem',
      attrs: { checked },
      content: [makeParagraph(parseInline(text))],
    });
    i++;
  }

  return { node: { type: 'taskList', content: items }, consumed: i - start };
}

function parseList(
  lines: string[],
  start: number,
  end: number,
  nodeType: 'bulletList' | 'orderedList',
  re: RegExp,
  extract: (m: RegExpExecArray) => { indent: number; text: string },
): ListParse {
  const items: TipTapNode[] = [];
  let i = start;
  const baseIndent = indentWidth(lines[start]!);

  while (i < end) {
    const line = lines[i]!;
    const m = re.exec(line);
    if (!m) break;
    const { indent, text } = extract(m);
    if (indent !== baseIndent) break;

    // Item body: the inline text on this line, plus any nested list lines
    // (deeper indent matching one of bullet/ordered/task patterns).
    const itemContent: TipTapNode[] = [makeParagraph(parseInline(text))];
    i++;

    // Look ahead for nested list items
    const nestedLines: string[] = [];
    const nestedStart = i;
    while (i < end) {
      const next = lines[i]!;
      if (next.trim() === '') break;
      if (indentWidth(next) <= baseIndent) break;
      // Nested item OR continuation; we only consume nested list items
      if (isBulletItem(next) || isOrderedItem(next) || isTaskItem(next)) {
        nestedLines.push(next);
        i++;
      } else {
        break;
      }
    }
    if (nestedLines.length > 0) {
      const nested = parseBlocks(nestedLines, 0, nestedLines.length);
      for (const n of nested) itemContent.push(n);
    } else {
      // No nested; revert i in case the loop above advanced for non-list lines
      i = nestedStart + (nestedLines.length === 0 ? 0 : nestedLines.length);
    }

    items.push({ type: 'listItem', content: itemContent });
  }

  return { node: { type: nodeType, content: items }, consumed: i - start };
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
    body.push(line.replace(/^\s*>\s?/, ''));
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
      content.push(makeParagraph([{ type: 'text', text: calloutTitle, marks: [{ type: 'bold' }] }]));
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
  let i = start + 1; // skip <details>
  let summary = '';
  const bodyLines: string[] = [];

  while (i < end) {
    const line = lines[i]!;
    if (/^\s*<\/details>\s*$/.test(line)) { i++; break; }
    const summaryMatch = /^\s*<summary>(.*)<\/summary>\s*$/.exec(line);
    if (summaryMatch) {
      summary = summaryMatch[1]!;
      i++;
      continue;
    }
    bodyLines.push(line);
    i++;
  }

  const bodyBlocks = parseBlocks(bodyLines, 0, bodyLines.length);

  return {
    node: {
      type: 'details',
      content: [
        { type: 'detailsSummary', content: parseInline(summary || 'Details') },
        { type: 'detailsContent', content: bodyBlocks.length > 0 ? bodyBlocks : [makeParagraph([])] },
      ],
    },
    consumed: i - start,
  };
}

// ─── Tables ──────────────────────────────────────────────────────────────

const TABLE_SEP_RE = /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/;

function isTableHeader(line: string, next: string | undefined): boolean {
  if (!next) return false;
  if (!line.includes('|')) return false;
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
  // Strip leading/trailing pipes, split on un-escaped pipes
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (ch === '\\' && trimmed[i + 1] === '|') { cur += '|'; i++; continue; }
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
 * Mark precedence (outer → inner): link > bold > italic > strike >
 * underline > highlight > code. Inline math and images create
 * standalone nodes, not text-with-marks.
 *
 * This is a hand-rolled tokenizer; it intentionally avoids backtracking
 * regex disasters by scanning left-to-right and only matching paired
 * delimiters.
 */
export function parseInline(text: string): TipTapNode[] {
  if (!text) return [];
  return tokenize(text, new Set());
}

function tokenize(text: string, activeMarks: Set<string>): TipTapNode[] {
  const out: TipTapNode[] = [];
  let buf = '';

  const flush = () => {
    if (buf) {
      out.push(makeTextNode(buf, activeMarks));
      buf = '';
    }
  };

  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    const rest = text.slice(i);

    // Hard break: trailing two spaces + newline; we don't see newlines
    // here (paragraphs are joined), but `\\n` in source becomes <br>.
    if (rest.startsWith('\\\n') || rest.startsWith('  \n')) {
      flush();
      out.push({ type: 'hardBreak' });
      i += rest.startsWith('\\\n') ? 2 : 3;
      continue;
    }

    // Inline image
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest);
    if (img) {
      flush();
      out.push({ type: 'image', attrs: { alt: img[1] || '', src: img[2] || '' } });
      i += img[0].length;
      continue;
    }

    // Link: [text](url)
    if (ch === '[' && !activeMarks.has('link')) {
      const link = matchLink(rest);
      if (link) {
        flush();
        // Tokenize inner text with the existing active marks; the link
        // mark itself is appended onto each resulting text node (it
        // carries attrs and so isn't tracked in the boolean activeMarks
        // set).
        const children = tokenize(link.text, activeMarks);
        for (const child of children) {
          if (child.type === 'text') {
            child.marks = (child.marks ?? []).concat([{ type: 'link', attrs: { href: link.href } }]);
          }
          out.push(child);
        }
        i += link.consumed;
        continue;
      }
    }

    // Inline code: `…`
    if (ch === '`' && !activeMarks.has('code')) {
      const code = matchInlineCode(rest);
      if (code) {
        flush();
        out.push({ type: 'text', text: code.text, marks: marksFromActive(activeMarks, 'code') });
        i += code.consumed;
        continue;
      }
    }

    // Inline math: $…$ (single dollars; double-dollars in inline → display)
    if (ch === '$') {
      const m = matchInlineMath(rest);
      if (m) {
        flush();
        out.push({ type: 'inlineMath', attrs: { latex: m.latex, display: m.display ? 'yes' : 'no' } });
        i += m.consumed;
        continue;
      }
    }

    // Bold: ** … **
    if (rest.startsWith('**') && !activeMarks.has('bold')) {
      const close = findClose(rest, '**', 2);
      if (close > 0) {
        flush();
        const next = new Set(activeMarks);
        next.add('bold');
        out.push(...tokenize(rest.slice(2, close), next));
        i += close + 2;
        continue;
      }
    }

    // Italic: * … * (single) or _ … _
    if ((ch === '*' || ch === '_') && !activeMarks.has('italic')) {
      // Avoid matching ** here — that's handled above
      if (!(ch === '*' && rest[1] === '*')) {
        const marker = ch;
        const close = findClose(rest, marker, 1);
        if (close > 0) {
          flush();
          const next = new Set(activeMarks);
          next.add('italic');
          out.push(...tokenize(rest.slice(1, close), next));
          i += close + 1;
          continue;
        }
      }
    }

    // Strike: ~~ … ~~
    if (rest.startsWith('~~') && !activeMarks.has('strike')) {
      const close = findClose(rest, '~~', 2);
      if (close > 0) {
        flush();
        const next = new Set(activeMarks);
        next.add('strike');
        out.push(...tokenize(rest.slice(2, close), next));
        i += close + 2;
        continue;
      }
    }

    // Highlight: == … ==
    if (rest.startsWith('==') && !activeMarks.has('highlight')) {
      const close = findClose(rest, '==', 2);
      if (close > 0) {
        flush();
        const next = new Set(activeMarks);
        next.add('highlight');
        out.push(...tokenize(rest.slice(2, close), next));
        i += close + 2;
        continue;
      }
    }

    // Underline: <u> … </u>
    if (rest.toLowerCase().startsWith('<u>') && !activeMarks.has('underline')) {
      const close = rest.toLowerCase().indexOf('</u>');
      if (close > 3) {
        flush();
        const next = new Set(activeMarks);
        next.add('underline');
        out.push(...tokenize(rest.slice(3, close), next));
        i += close + 4;
        continue;
      }
    }

    // Escapes
    if (ch === '\\' && i + 1 < text.length) {
      buf += text[i + 1]!;
      i += 2;
      continue;
    }

    buf += ch;
    i++;
  }

  if (buf) out.push(makeTextNode(buf, activeMarks));
  return out;
}

function makeTextNode(text: string, activeMarks: Set<string>): TipTapNode {
  const node: TipTapNode = { type: 'text', text };
  if (activeMarks.size > 0) node.marks = Array.from(activeMarks).map((t) => ({ type: t }));
  return node;
}

function marksFromActive(active: Set<string>, extra: string): TipTapMark[] {
  const out: TipTapMark[] = Array.from(active).map((t) => ({ type: t }));
  out.push({ type: extra });
  return out;
}

/**
 * Find the index in `s` (starting from `from`) where `marker` next
 * appears, skipping over escaped occurrences. Returns -1 if not found.
 */
function findClose(s: string, marker: string, from: number): number {
  let i = from;
  while (i <= s.length - marker.length) {
    if (s[i - 1] !== '\\' && s.slice(i, i + marker.length) === marker) {
      return i;
    }
    i++;
  }
  return -1;
}

function matchLink(rest: string): { text: string; href: string; consumed: number } | null {
  // [text](href) where text may contain inline marks but no unmatched ]
  if (rest[0] !== '[') return null;
  let depth = 1;
  let i = 1;
  while (i < rest.length && depth > 0) {
    const c = rest[i]!;
    if (c === '\\') { i += 2; continue; }
    if (c === '[') depth++;
    else if (c === ']') depth--;
    if (depth === 0) break;
    i++;
  }
  if (depth !== 0) return null;
  const textEnd = i;
  if (rest[i + 1] !== '(') return null;
  const hrefStart = i + 2;
  const hrefEnd = rest.indexOf(')', hrefStart);
  if (hrefEnd === -1) return null;
  return {
    text: rest.slice(1, textEnd),
    href: rest.slice(hrefStart, hrefEnd).trim(),
    consumed: hrefEnd + 1,
  };
}

function matchInlineCode(rest: string): { text: string; consumed: number } | null {
  // Count opening backticks
  const open = /^`+/.exec(rest);
  if (!open) return null;
  const len = open[0].length;
  const closeIdx = rest.indexOf(open[0], len);
  if (closeIdx === -1) return null;
  // The next char after close must not be a backtick (no longer fence)
  if (rest[closeIdx + len] === '`') return null;
  const text = rest.slice(len, closeIdx);
  return { text, consumed: closeIdx + len };
}

function matchInlineMath(rest: string): { latex: string; display: boolean; consumed: number } | null {
  // $$…$$ inline (display=yes); otherwise $…$
  if (rest.startsWith('$$')) {
    const close = rest.indexOf('$$', 2);
    if (close === -1) return null;
    return { latex: rest.slice(2, close), display: true, consumed: close + 2 };
  }
  // Single $: require non-whitespace immediately after, and a closing $.
  if (rest[1] === undefined || /\s/.test(rest[1])) return null;
  let i = 1;
  while (i < rest.length) {
    if (rest[i] === '\\') { i += 2; continue; }
    if (rest[i] === '$') {
      // Don't match if preceded by whitespace (empty math) — though that's
      // already excluded by the rest[1] check above.
      return { latex: rest.slice(1, i), display: false, consumed: i + 1 };
    }
    i++;
  }
  return null;
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
  'video', 'audio', 'fileAttachment',
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
