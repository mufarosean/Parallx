// sourceReading.ts — a file's live text as labelled blocks, for reading and citing.
//
// fs_read_file and fs_grep_search show the model text from real files. Every
// block they show comes from the file as it is now (never from the search
// index, which can lag the file), carries its own location and, in a chat
// session, a source label the model cites with (services/sourceHandles.ts).
// The same block format serves a whole small file, a page range, the
// passages that answer a question in a large file, and search results, so
// how the model came by a passage makes no difference to its citation.
//
// The search index only decides WHICH blocks are worth showing: a search
// chunk is placed on the file's live blocks (quoteLocator), and a chunk that
// cannot be placed is dropped. With no index (still building, or off) a
// keyword ranking of the live blocks stands in.

import type { IBuiltInToolFileSystem, IBuiltInToolRetrieval } from '../chatTypes.js';
import { labelSourceBlock, SOURCE_LABEL_GUIDE, type ISourceBlock } from '../../../services/sourceHandles.js';
import { locatePassageUnits, isLocatableQuote } from '../../../services/quoteLocator.js';

/** Reading material: an answer drawn from these must cite them. */
const DOCUMENT_EXTS = new Set([
  '.pdf', '.docx', '.doc', '.epub', '.md', '.markdown', '.txt', '.rst', '.org', '.tex', '.rtf', '.html', '.htm',
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers', '.csv', '.tsv',
]);
const PROSE_EXTS = new Set(['.md', '.markdown', '.txt', '.rst', '.org', '.tex']);

/** Lines per block in a long section or a code file. */
const PROSE_BLOCK_MAX_LINES = 60;
const CODE_BLOCK_LINES = 200;
/** Characters per block of a Word, EPUB or spreadsheet text. */
const TEXT_BLOCK_CHARS = 3_000;
/** What a large file shows when no question was asked: its start. */
export const START_OF_LARGE_FILE_CHARS = 12_000;
/** Blocks shown for a question. */
const MAX_PASSAGE_BLOCKS = 6;
/** Search results asked of the index for one file. */
const INDEX_RESULTS_PER_FILE = 12;

function extOf(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot >= 0 ? path.slice(dot).toLowerCase() : '';
}

function nameOf(path: string): string {
  return path.split('/').pop() || path;
}

/** Whether a file is reading material, which an answer must cite. */
export function isDocumentPath(path: string): boolean {
  return DOCUMENT_EXTS.has(extOf(path));
}

/** The checked link to a spot in a workspace file (the Explorer's file link). */
export function fileLinkUri(path: string, anchor: { page?: number; line?: number; quote?: string } = {}): string {
  const params = new URLSearchParams({ path });
  if (anchor.page !== undefined) params.set('page', String(anchor.page));
  else if (anchor.line !== undefined) params.set('line', String(anchor.line));
  else if (anchor.quote) params.set('quote', anchor.quote);
  return `parallx://explorer/file?${params.toString()}`;
}

// ── Live documents and their blocks ──

export type LiveDoc =
  | { readonly kind: 'page'; readonly path: string; readonly pages: readonly string[] }
  | { readonly kind: 'line'; readonly path: string; readonly lines: readonly string[] }
  | { readonly kind: 'text'; readonly path: string; readonly text: string };

/** One block of a file: what it says and where it is. */
export interface LiveBlock {
  readonly text: string;
  readonly location: string;
  readonly title: string;
  readonly uri: string;
  /** For a line file: the block's first and last line (1-based). */
  readonly firstLine?: number;
  readonly lastLine?: number;
  /** For a PDF: the page (1-based). */
  readonly page?: number;
}

/** Read a file as it is now. Undefined when it cannot be read. */
export async function loadLiveDoc(fs: IBuiltInToolFileSystem, path: string): Promise<LiveDoc | undefined> {
  if (extOf(path) === '.pdf' && fs.readPdfPages) {
    const pages = await fs.readPdfPages(path);
    if (pages) return { kind: 'page', path, pages };
  }
  const result = await fs.readFileContent(path);
  if (result.type === 'rich-document') return { kind: 'text', path, text: result.content ?? '' };
  return { kind: 'line', path, lines: result.content.split('\n').map((l) => l.replace(/\r$/, '')) };
}

/** The first words of a passage, long enough to find it again (a link's quote). */
function anchorQuote(text: string): string | undefined {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  for (let n = 8; n <= Math.min(words.length, 24); n += 4) {
    const q = words.slice(0, n).join(' ');
    if (isLocatableQuote(q)) return q.length > 160 ? q.slice(0, 160) : q;
  }
  const all = words.join(' ');
  return isLocatableQuote(all) ? all.slice(0, 160) : undefined;
}

/** Split a file into the blocks it is read and cited by. */
export function blocksOf(doc: LiveDoc): LiveBlock[] {
  const name = nameOf(doc.path);
  if (doc.kind === 'page') {
    const total = doc.pages.length;
    return doc.pages.map((p, i) => ({
      text: (p ?? '').trim(),
      location: `${doc.path} · page ${i + 1} of ${total}`,
      title: `${name}, page ${i + 1}`,
      uri: fileLinkUri(doc.path, { page: i + 1 }),
      page: i + 1,
    }));
  }
  if (doc.kind === 'line') {
    const prose = PROSE_EXTS.has(extOf(doc.path));
    const total = doc.lines.length;
    const ranges: Array<[number, number]> = [];
    let start = 0;
    for (let i = 1; i <= total; i++) {
      const atEnd = i === total;
      const heading = !atEnd && prose && /^#{1,6}\s/.test(doc.lines[i]);
      const full = i - start >= (prose ? PROSE_BLOCK_MAX_LINES : CODE_BLOCK_LINES);
      if (atEnd || heading || full) { ranges.push([start, i - 1]); start = i; }
    }
    return ranges
      .filter(([a, b]) => doc.lines.slice(a, b + 1).some((l) => l.trim()))
      .map(([a, b]) => ({
        text: doc.lines.slice(a, b + 1).join('\n'),
        location: a === 0 && b === total - 1 ? `${doc.path} · lines 1 to ${total}` : `${doc.path} · lines ${a + 1} to ${b + 1} of ${total}`,
        title: a === 0 && b === total - 1 ? name : `${name}, line ${a + 1}`,
        uri: fileLinkUri(doc.path, { line: a + 1 }),
        firstLine: a + 1,
        lastLine: b + 1,
      }));
  }
  // Word, EPUB, spreadsheets: no pages or lines to address, so blocks are
  // runs of paragraphs and a link finds its block by its opening words.
  const paragraphs = doc.text.split(/\n/);
  const chunks: string[] = [];
  let buf = '';
  for (const para of paragraphs) {
    if (buf && buf.length + para.length + 1 > TEXT_BLOCK_CHARS) { chunks.push(buf); buf = ''; }
    buf = buf ? `${buf}\n${para}` : para;
  }
  if (buf.trim()) chunks.push(buf);
  const total = chunks.length;
  return chunks.filter((c) => c.trim()).map((c, i) => {
    const quote = anchorQuote(c);
    return {
      text: c.trim(),
      location: total === 1 ? doc.path : `${doc.path} · part ${i + 1} of ${total}`,
      title: total === 1 ? name : `${name}, part ${i + 1}`,
      uri: fileLinkUri(doc.path, quote ? { quote } : {}),
    };
  });
}

/** Label blocks for the session and lay them out for the model, each under its header. */
export function renderBlocks(sessionId: string | undefined, path: string, blocks: readonly LiveBlock[]): string {
  const document = isDocumentPath(path);
  return blocks.map((b) => {
    const block: ISourceBlock = { key: `${b.uri}#${b.location}`, location: b.location, title: b.title, uri: b.uri, text: b.text, document };
    return `${labelSourceBlock(sessionId, block)}\n${b.text}`;
  }).join('\n\n');
}

/** Total characters of a set of blocks as rendered. */
export function blocksSize(blocks: readonly LiveBlock[]): number {
  return blocks.reduce((n, b) => n + b.text.length + b.location.length + 16, 0);
}

/** The leading blocks that fit a budget (always at least one). */
export function blocksWithin(blocks: readonly LiveBlock[], budget: number): LiveBlock[] {
  const out: LiveBlock[] = [];
  let size = 0;
  for (const b of blocks) {
    size += b.text.length + b.location.length + 16;
    if (out.length > 0 && size > budget) break;
    out.push(b);
  }
  return out;
}

// ── Finding the blocks that answer a question ──

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'had', 'her', 'was', 'one', 'our', 'out',
  'has', 'how', 'its', 'may', 'who', 'did', 'get', 'what', 'when', 'where', 'which', 'with', 'this', 'that', 'from',
  'they', 'them', 'then', 'than', 'there', 'their', 'have', 'will', 'would', 'should', 'could', 'into', 'about',
  'does', 'also', 'more', 'most', 'some', 'such', 'only', 'other', 'each', 'used', 'using', 'between', 'these',
  'those', 'being', 'been', 'were', 'your', 'find', 'show', 'tell', 'explain', 'describe', 'mean', 'means',
]);

/** The words of a question worth matching on. */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(words.filter((w) => (w.length >= 3 || /\d/.test(w)) && !STOPWORDS.has(w)))];
}

/** Rank blocks by how many of the question's words they hold (index-free fallback). */
export function rankByKeywords(blocks: readonly LiveBlock[], query: string): number[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const lower = blocks.map((b) => b.text.toLowerCase());
  // Rarer words count for more: a word on every page says little.
  const weight = terms.map((t) => {
    const df = lower.filter((l) => l.includes(t)).length;
    return df === 0 ? 0 : Math.log(1 + blocks.length / df);
  });
  const scored = lower.map((l, i) => {
    let score = 0;
    terms.forEach((t, k) => {
      if (!weight[k]) return;
      let count = 0;
      let at = l.indexOf(t);
      while (at >= 0 && count < 5) { count++; at = l.indexOf(t, at + t.length); }
      if (count > 0) score += weight[k] * (2 + count);
    });
    return { i, score };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.i);
}

export interface PassageResult {
  /** Indices into the blocks, in document order. */
  readonly picked: number[];
  /** How they were found. */
  readonly via: 'index' | 'keywords' | 'none';
}

/**
 * The blocks of one file that answer a question. Search chunks from the
 * index are placed on the live blocks; any that cannot be placed are
 * dropped. Falls back to keyword ranking when the index has nothing for
 * the file (not built yet, or the file changed since).
 */
export async function findPassages(
  retrieval: IBuiltInToolRetrieval | undefined,
  path: string,
  blocks: readonly LiveBlock[],
  query: string,
  budget: number,
): Promise<PassageResult> {
  const order: number[] = [];
  let via: PassageResult['via'] = 'none';
  if (retrieval?.isReady()) {
    try {
      const results = await retrieval.retrieve(query, 'file_chunk', [path]);
      const texts = blocks.map((b) => b.text);
      const own = results.filter((r) => r.sourceId.replace(/\\/g, '/').toLowerCase() === path.toLowerCase())
        .slice(0, INDEX_RESULTS_PER_FILE);
      for (const r of own) {
        for (const i of locatePassageUnits(texts, r.text)) if (!order.includes(i)) order.push(i);
      }
      if (order.length > 0) via = 'index';
    } catch { /* the index failing leaves the keyword ranking */ }
  }
  if (order.length === 0) {
    order.push(...rankByKeywords(blocks, query));
    if (order.length > 0) via = 'keywords';
  }
  const picked: number[] = [];
  let size = 0;
  for (const i of order) {
    if (picked.length >= MAX_PASSAGE_BLOCKS) break;
    const s = blocks[i].text.length + blocks[i].location.length + 16;
    if (picked.length > 0 && size + s > budget) continue;
    picked.push(i);
    size += s;
  }
  return { picked: picked.sort((a, b) => a - b), via };
}

/** Headings of a Markdown-style file with their lines: a map of a long note. */
export function outlineOf(doc: LiveDoc, maxEntries = 60): string[] {
  if (doc.kind !== 'line' || !PROSE_EXTS.has(extOf(doc.path))) return [];
  const out: string[] = [];
  doc.lines.forEach((l, i) => {
    if (out.length < maxEntries && /^#{1,6}\s/.test(l)) out.push(`line ${i + 1}: ${l.trim()}`);
  });
  return out;
}

export { SOURCE_LABEL_GUIDE };

// ── Related passages for a search ──

/** Passages a workspace search adds from the index, at most. */
const MAX_RELATED_PASSAGES = 4;
const RELATED_BUDGET_CHARS = 12_000;

/**
 * Passages related to a search by meaning, from documents and canvas pages,
 * each placed on its file's live text and labelled like a read. '' when the
 * index is not ready or holds nothing related. Code files are left out: a
 * search for a symbol wants exact matches, not prose about it.
 */
export async function relatedPassages(
  fs: IBuiltInToolFileSystem,
  retrieval: IBuiltInToolRetrieval | undefined,
  query: string,
  scopePath: string,
  sessionId: string | undefined,
): Promise<string> {
  if (!retrieval?.isReady() || !query.trim()) return '';
  const scope = scopePath.replace(/\\/g, '/').replace(/^\.\/?/, '').replace(/\/$/, '');
  const prefixes = scope ? [/\.[a-z0-9]{1,5}$/i.test(scope) ? scope : `${scope}/`] : undefined;
  let results: Awaited<ReturnType<IBuiltInToolRetrieval['retrieve']>>;
  try {
    results = await retrieval.retrieve(query, undefined, prefixes);
  } catch {
    return '';
  }
  const parts: string[] = [];
  const shown = new Set<string>();
  const docs = new Map<string, LiveBlock[] | null>();
  let size = 0;
  for (const r of results) {
    if (parts.length >= MAX_RELATED_PASSAGES || size >= RELATED_BUDGET_CHARS) break;
    if (r.sourceType === 'file_chunk') {
      const path = r.sourceId.replace(/\\/g, '/');
      if (!isDocumentPath(path)) continue;
      if (!docs.has(path)) {
        try {
          const doc = await loadLiveDoc(fs, path);
          docs.set(path, doc ? blocksOf(doc) : null);
        } catch {
          docs.set(path, null);
        }
      }
      const blocks = docs.get(path);
      if (!blocks) continue;
      for (const i of locatePassageUnits(blocks.map((b) => b.text), r.text)) {
        const key = `${path}#${i}`;
        if (shown.has(key) || parts.length >= MAX_RELATED_PASSAGES) continue;
        const s = blocks[i].text.length + blocks[i].location.length + 16;
        if (parts.length > 0 && size + s > RELATED_BUDGET_CHARS) continue;
        shown.add(key);
        size += s;
        parts.push(renderBlocks(sessionId, path, [blocks[i]]));
      }
    } else if (r.sourceType === 'page_block') {
      // A canvas page's chunk is re-indexed as the page is saved, so its text
      // is the page's own.
      const title = /Source:\s*"([^"]+)"/.exec(r.contextPrefix ?? '')?.[1] ?? 'Untitled';
      const key = `page:${r.sourceId}#${r.text.slice(0, 60)}`;
      if (shown.has(key)) continue;
      shown.add(key);
      const text = r.text.trim();
      size += text.length + 40;
      const block: ISourceBlock = {
        key,
        location: `canvas page "${title}"`,
        title,
        uri: `parallx://canvas/page/${r.sourceId}`,
        text,
        document: true,
      };
      parts.push(`${labelSourceBlock(sessionId, block)}\n${text}`);
    }
  }
  return parts.join('\n\n');
}
