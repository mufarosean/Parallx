// chunkingService.ts — IChunkingService implementation (M10 Task 1.3)
//
// Splits content into chunks suitable for embedding and retrieval.
// Supports canvas pages (TipTap JSON block-level chunking) and workspace
// files (heading/paragraph-aware splitting).
//
// Key design decisions:
//   - Canvas pages chunk at block boundaries (headings start new chunks)
//   - Structural context prefix prepended to each chunk (Anthropic CR pattern)
//   - No external dependencies — zero-cost chunking
//   - Target ~256 tokens (~1024 chars) per chunk with flexible boundaries
//   - Content hash (SHA-256 via SubtleCrypto) for change detection
//
// References:
//   - Anthropic Contextual Retrieval blog
//   - docs/Parallx_Milestone_10.md DR-6, DR-8

import { Disposable } from '../platform/lifecycle.js';
import type { IChunkingService } from './serviceTypes.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Target max characters per chunk (~256 tokens at 4 chars/token).
 *  M16: Reduced from 2048 to 1024 — industry consensus is 800-1200 chars.
 *  Smaller chunks produce more precise embeddings.
 */
const MAX_CHUNK_CHARS = 1024;

/** Minimum chunk size — don't create tiny standalone chunks. */
const MIN_CHUNK_CHARS = 100;

/** Max table/code block size before forced split (2× normal max).
 * Tables and code blocks can exceed MAX_CHUNK_CHARS up to this limit
 * to preserve structural integrity (M21 D.1/D.2).
 */
const MAX_STRUCTURAL_BLOCK_CHARS = MAX_CHUNK_CHARS * 2;

/** Overlap between consecutive chunks (~50 tokens at 4 chars/token).
 * Carries the tail of one chunk into the head of the next to preserve
 * context that spans chunk boundaries (M10 DR-8 recommendation).
 * Applied to both file chunks and canvas page size-limit flushes (M16).
 * Heading boundaries remain clean breaks (no overlap).
 */
const OVERLAP_CHARS = 200;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single chunk ready for embedding. */
export interface Chunk {
  /** Source type: 'page_block' for canvas pages, 'file_chunk' for workspace files. */
  sourceType: 'page_block' | 'file_chunk';
  /** Source identifier: page UUID or workspace-relative file path. */
  sourceId: string;
  /** Zero-based position within the source. */
  chunkIndex: number;
  /** The raw text content of this chunk. */
  text: string;
  /** Structural context: "[Page: Title | Section: Heading]" */
  contextPrefix: string;
  /** SHA-256 hash of the text content for change detection. */
  contentHash: string;
}

// ─── TipTap AST Types (minimal) ──────────────────────────────────────────────

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
}

interface TipTapDoc {
  type: 'doc';
  content: TipTapNode[];
}

// ─── ChunkingService ─────────────────────────────────────────────────────────

/**
 * Content chunking service for RAG indexing.
 *
 * Splits canvas pages (TipTap JSON) and text files into chunks
 * suitable for embedding with nomic-embed-text.
 */
export class ChunkingService extends Disposable implements IChunkingService {

  // ── Canvas Page Chunking ──

  /**
   * Chunk a canvas page by its TipTap JSON content.
   * Blocks are the natural chunk boundaries.
   *
   * @param pageId — page UUID
   * @param pageTitle — page title for context prefix
   * @param contentJson — raw content JSON string from pages.content column
   * @returns array of chunks
   */
  async chunkPage(pageId: string, pageTitle: string, contentJson: string): Promise<Chunk[]> {
    const doc = this._parseTipTapContent(contentJson);
    if (!doc || !doc.content || doc.content.length === 0) {
      return [];
    }

    const chunks: Chunk[] = [];
    let currentHeading = '';
    let buffer = '';
    let bufferBlockTypes: string[] = [];

    const flush = async (overlap: boolean = false): Promise<void> => {
      const trimmed = buffer.trim();
      if (trimmed.length < MIN_CHUNK_CHARS && chunks.length > 0) {
        // Merge tiny trailing buffer into previous chunk
        const prev = chunks[chunks.length - 1];
        prev.text += '\n' + trimmed;
        prev.contentHash = await hashText(prev.text);
        buffer = '';
        bufferBlockTypes = [];
        return;
      }
      if (!trimmed) {
        buffer = '';
        bufferBlockTypes = [];
        return;
      }

      const prefix = buildContextPrefix(pageTitle, currentHeading, bufferBlockTypes[0]);
      chunks.push({
        sourceType: 'page_block',
        sourceId: pageId,
        chunkIndex: chunks.length,
        text: trimmed,
        contextPrefix: prefix,
        contentHash: await hashText(trimmed),
      });

      // M16: Carry overlap on size-limit flushes (same as file chunks).
      // Heading boundaries remain clean breaks — overlap=false there.
      if (overlap && trimmed.length > OVERLAP_CHARS) {
        buffer = trimmed.slice(-OVERLAP_CHARS);
      } else {
        buffer = '';
      }
      bufferBlockTypes = [];
    };

    for (const block of doc.content) {
      const text = extractTextFromBlock(block);
      if (!text.trim()) { continue; }

      // Headings start new chunks — clean break, no overlap
      if (block.type === 'heading') {
        await flush(false);
        currentHeading = text.trim();
      }

      buffer += (buffer ? '\n' : '') + text;
      bufferBlockTypes.push(block.type);

      // Flush if buffer exceeds target size — carry overlap
      if (buffer.length > MAX_CHUNK_CHARS) {
        await flush(true);
      }
    }

    // Flush remaining buffer — no overlap needed for last chunk
    await flush(false);

    return chunks;
  }

  // ── File Chunking ──

  /**
   * Chunk a text file by headings and paragraphs.
   *
   * @param filePath — workspace-relative file path
   * @param content — file text content
   * @param language — optional language hint (e.g., 'markdown', 'typescript')
   * @returns array of chunks
   */
  async chunkFile(filePath: string, content: string, language?: string): Promise<Chunk[]> {
    if (!content.trim()) { return []; }

    const isMarkdown = language === 'markdown' ||
      filePath.endsWith('.md') ||
      filePath.endsWith('.mdx');

    if (isMarkdown) {
      return this._chunkMarkdown(filePath, content);
    }

    return this._chunkPlainText(filePath, content, language);
  }

  // ── Markdown Splitting ──

  private async _chunkMarkdown(filePath: string, content: string): Promise<Chunk[]> {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];
    let currentHeading = '';
    let buffer = '';

    const flush = async (overlap: boolean = false): Promise<void> => {
      const trimmed = buffer.trim();
      if (!trimmed) {
        buffer = '';
        return;
      }

      // Merge tiny chunks into previous
      if (trimmed.length < MIN_CHUNK_CHARS && chunks.length > 0) {
        const prev = chunks[chunks.length - 1];
        prev.text += '\n\n' + trimmed;
        prev.contentHash = await hashText(prev.text);
        buffer = '';
        return;
      }

      const prefix = buildContextPrefix(filePath, currentHeading);
      chunks.push({
        sourceType: 'file_chunk',
        sourceId: filePath,
        chunkIndex: chunks.length,
        text: trimmed,
        contextPrefix: prefix,
        contentHash: await hashText(trimmed),
      });

      // Carry tail of flushed text into next chunk for overlap
      // Only when flushing due to size limit, not at heading boundaries
      if (overlap && trimmed.length > OVERLAP_CHARS) {
        buffer = trimmed.slice(-OVERLAP_CHARS);
      } else {
        buffer = '';
      }
    };

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // ── D.1: Detect Markdown table blocks (lines starting with |) ──
      if (line.trimStart().startsWith('|')) {
        // Flush any accumulated text before the table
        await flush(false);

        // Collect the entire table block
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trimStart().startsWith('|')) {
          tableLines.push(lines[i]);
          i++;
        }

        const tableText = tableLines.join('\n');
        const tableHeader = tableLines.length >= 2
          ? tableLines[0] + '\n' + tableLines[1] // header row + separator
          : tableLines[0] ?? '';

        if (tableText.length <= MAX_STRUCTURAL_BLOCK_CHARS) {
          // Table fits within 2× max — keep it as a single chunk
          buffer = tableText;
          await flush(false);
        } else {
          // Table exceeds 2× max — split at row boundaries, prefix with header
          let rowBuffer = tableHeader;
          for (let r = 2; r < tableLines.length; r++) {
            const nextRow = tableLines[r];
            if ((rowBuffer + '\n' + nextRow).length > MAX_CHUNK_CHARS && rowBuffer.trim()) {
              buffer = rowBuffer;
              await flush(false);
              // Start new chunk with header prefix for context
              rowBuffer = tableHeader + '\n' + nextRow;
            } else {
              rowBuffer += '\n' + nextRow;
            }
          }
          if (rowBuffer.trim()) {
            buffer = rowBuffer;
            await flush(false);
          }
        }
        continue;
      }

      // Detect markdown headings (# through ###)
      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        await flush(false); // heading = clean break, no overlap
        currentHeading = headingMatch[2].trim();
      }

      buffer += (buffer ? '\n' : '') + line;
      i++;

      if (buffer.length > MAX_CHUNK_CHARS) {
        await flush(true); // size limit = carry overlap
      }
    }

    await flush(false); // final flush — no overlap needed
    return chunks;
  }

  // ── Plain Text / Code Splitting ──

  private async _chunkPlainText(
    filePath: string,
    content: string,
    language?: string,
  ): Promise<Chunk[]> {
    const lines = content.split('\n');
    const chunks: Chunk[] = [];
    let buffer = '';

    const flush = async (overlap: boolean = false): Promise<void> => {
      const trimmed = buffer.trim();
      if (!trimmed) {
        buffer = '';
        return;
      }

      const prefix = buildContextPrefix(filePath, undefined, language);
      chunks.push({
        sourceType: 'file_chunk',
        sourceId: filePath,
        chunkIndex: chunks.length,
        text: trimmed,
        contextPrefix: prefix,
        contentHash: await hashText(trimmed),
      });

      // Carry tail of flushed text into next chunk for overlap
      if (overlap && trimmed.length > OVERLAP_CHARS) {
        buffer = trimmed.slice(-OVERLAP_CHARS);
      } else {
        buffer = '';
      }
    };

    for (const line of lines) {
      buffer += (buffer ? '\n' : '') + line;

      if (buffer.length > MAX_CHUNK_CHARS) {
        // Try to break at a blank line for cleaner chunks
        const lastBlank = buffer.lastIndexOf('\n\n');
        if (lastBlank > MIN_CHUNK_CHARS) {
          const toFlush = buffer.slice(0, lastBlank);
          const remainder = buffer.slice(lastBlank + 2);
          const prefix = buildContextPrefix(filePath, undefined, language);
          const flushedText = toFlush.trim();
          chunks.push({
            sourceType: 'file_chunk',
            sourceId: filePath,
            chunkIndex: chunks.length,
            text: flushedText,
            contextPrefix: prefix,
            contentHash: await hashText(flushedText),
          });
          // Carry overlap from flushed text into the remainder
          if (flushedText.length > OVERLAP_CHARS) {
            buffer = flushedText.slice(-OVERLAP_CHARS) + '\n' + remainder;
          } else {
            buffer = remainder;
          }
        } else {
          await flush(true); // size limit = carry overlap
        }
      }
    }

    await flush(false); // final flush — no overlap needed
    return chunks;
  }

  // ── TipTap Parsing ──

  /**
   * Parse content JSON, handling both envelope format and raw doc format.
   */
  private _parseTipTapContent(contentJson: string): TipTapDoc | null {
    if (!contentJson) { return null; }

    try {
      const parsed = JSON.parse(contentJson);
      if (!parsed || typeof parsed !== 'object') { return null; }

      // Handle schema-envelope format: { schemaVersion, doc: { type: "doc", content: [...] } }
      if (parsed.doc && typeof parsed.doc === 'object' && parsed.doc.type === 'doc') {
        return parsed.doc as TipTapDoc;
      }

      // Handle raw doc format: { type: "doc", content: [...] }
      if (parsed.type === 'doc' && Array.isArray(parsed.content)) {
        return parsed as TipTapDoc;
      }

      return null;
    } catch {
      return null;
    }
  }
}

// ─── Helpers (module-level) ──────────────────────────────────────────────────

/**
 * Build a structural context prefix for a chunk.
 * Follows the Anthropic Contextual Retrieval pattern using free
 * structural metadata instead of LLM-generated context.
 *
 * @param source — page title or file path
 * @param section — nearest heading (if any)
 * @param typeOrLang — block type or file language
 * @returns prefix string like '[Page: "Title" | Section: "Heading"]'
 */
function buildContextPrefix(
  source: string,
  section?: string,
  typeOrLang?: string,
): string {
  const parts = [`Source: "${source}"`];
  if (section) { parts.push(`Section: "${section}"`); }
  if (typeOrLang && typeOrLang !== 'paragraph' && typeOrLang !== 'text') {
    parts.push(`Type: ${typeOrLang}`);
  }
  return `[${parts.join(' | ')}]`;
}

/**
 * Recursively extract plain text from a TipTap block node.
 * Handles nested structures: lists, blockquotes, tables, etc.
 */
function extractTextFromBlock(node: TipTapNode): string {
  // Leaf text node
  if (node.type === 'text' && typeof node.text === 'string') {
    return node.text;
  }

  // Atom blocks with no text content
  if (node.type === 'image' || node.type === 'horizontalRule' ||
      node.type === 'pageBlock' || node.type === 'databaseInline' ||
      node.type === 'bookmark') {
    return '';
  }

  // Math blocks — extract LaTeX
  if ((node.type === 'mathBlock' || node.type === 'inlineMath') && node.attrs?.['latex']) {
    return String(node.attrs['latex']);
  }

  // Code blocks — prepend language tag
  if (node.type === 'codeBlock') {
    const lang = node.attrs?.['language'] || '';
    const code = (node.content || []).map(extractTextFromBlock).join('');
    return lang ? `\`\`\`${lang}\n${code}\n\`\`\`` : code;
  }

  // Recursive: collect text from children
  if (!node.content || !Array.isArray(node.content)) {
    return '';
  }

  return node.content.map(extractTextFromBlock).join(
    // Add newlines between block-level children
    isInlineType(node.type) ? '' : '\n',
  );
}

/** Whether a TipTap node type is inline (text-level). */
function isInlineType(type: string): boolean {
  return type === 'text' || type === 'inlineMath';
}

/**
 * Compute SHA-256 hash of text content using SubtleCrypto.
 * Returns hex string.
 */
async function hashText(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export { buildContextPrefix, extractTextFromBlock, hashText };
