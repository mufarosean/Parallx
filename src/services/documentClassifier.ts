// src/services/documentClassifier.ts — Routes files to the appropriate extraction pipeline
//
// Examines file extension (and, for PDFs, content heuristics) to determine
// whether a file should be read directly (text), processed via Docling
// (digital or scanned), or skipped.
//
// Reference: docs/Parallx_Milestone_21.md Phase B — Task B.1

import { Disposable } from '../platform/lifecycle.js';

// ─── Classification Types ───────────────────────────────────────────────────

/**
 * What kind of document this is, determining the extraction pipeline.
 */
export type DocumentClass =
  | 'text'           // .md, .ts, .py, etc. — read directly (existing path)
  | 'canvas'         // TipTap JSON pages — existing chunkPage() path
  | 'digital-doc'    // Clean PDF, DOCX, PPTX, XLSX — Docling standard pipeline
  | 'scanned-doc'    // Scanned/image-heavy PDF — Docling + OCR
  | 'image'          // .png, .jpg, .tiff — Docling OCR
  | 'unsupported';   // Unknown format — skip

/**
 * Result of classifying a document.
 */
export interface ClassificationResult {
  /** The document class determining pipeline routing. */
  documentClass: DocumentClass;
  /** How confident the classifier is (0.0–1.0). */
  confidence: number;
  /** Human-readable reason for the classification. */
  reason: string;
}

// ─── Extension Sets ─────────────────────────────────────────────────────────

/**
 * Text/code file extensions that are read directly.
 * Mirrors INDEXABLE_EXTENSIONS from indexingPipeline.ts.
 */
const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.ts', '.tsx', '.js', '.jsx', '.json',
  '.py', '.css', '.scss', '.html', '.htm', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.sh', '.bash', '.zsh',
  '.rs', '.go', '.java', '.kt', '.swift', '.c', '.cpp', '.h', '.hpp',
  '.rb', '.lua', '.sql', '.graphql', '.gql', '.env', '.gitignore',
  '.dockerfile', '.csv', '.mdx', '.svelte', '.vue',
]);

/**
 * Rich document extensions handled by Docling (or legacy fallback).
 * Expanded from M10's set to include PPTX (new via Docling).
 */
const RICH_DOC_EXTENSIONS = new Set([
  '.pdf',
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers',
  '.docx',
  '.pptx',  // New: PowerPoint via Docling
  '.ppt',   // Legacy PowerPoint via Docling
  '.epub',  // E-books via Docling
]);

/**
 * Image extensions that can be processed via Docling OCR.
 */
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.webp',
]);

/**
 * Extensions that are always digital docs (no scan detection needed).
 */
const ALWAYS_DIGITAL_EXTENSIONS = new Set([
  '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers',
  '.docx', '.pptx', '.ppt',
  '.epub',
]);

// ─── Classifier Service ─────────────────────────────────────────────────────

/**
 * Classifies documents to determine which extraction pipeline to use.
 *
 * Pure logic — no I/O. PDF scan detection (which requires reading the file)
 * is handled separately in the indexing pipeline using the heuristic from B.2.
 */
export class DocumentClassifier extends Disposable {

  /**
   * Classify a file by its extension.
   *
   * For PDFs, returns `'digital-doc'` by default. The caller should use
   * `refinePdfClassification()` to upgrade to `'scanned-doc'` if the
   * PDF has low text density.
   *
   * @param filePath — The file path (only extension is examined).
   * @returns Classification result.
   */
  classify(filePath: string): ClassificationResult {
    const ext = this._getExtension(filePath);

    if (!ext) {
      return { documentClass: 'unsupported', confidence: 1.0, reason: 'No file extension' };
    }

    // Text / code files — read directly
    if (TEXT_EXTENSIONS.has(ext)) {
      return { documentClass: 'text', confidence: 1.0, reason: `Text file (${ext})` };
    }

    // Images — OCR via Docling
    if (IMAGE_EXTENSIONS.has(ext)) {
      return { documentClass: 'image', confidence: 1.0, reason: `Image file (${ext})` };
    }

    // Always-digital Office formats (not PDF — no scan detection needed)
    if (ALWAYS_DIGITAL_EXTENSIONS.has(ext)) {
      return { documentClass: 'digital-doc', confidence: 1.0, reason: `Office document (${ext})` };
    }

    // PDF — default to digital, caller can refine with scan detection
    if (ext === '.pdf') {
      return { documentClass: 'digital-doc', confidence: 0.7, reason: 'PDF (default digital, may need scan detection)' };
    }

    // Other rich document formats (future)
    if (RICH_DOC_EXTENSIONS.has(ext)) {
      return { documentClass: 'digital-doc', confidence: 0.8, reason: `Rich document (${ext})` };
    }

    return { documentClass: 'unsupported', confidence: 1.0, reason: `Unknown extension (${ext})` };
  }

  /**
   * Refine a PDF classification based on text density.
   *
   * Call this after a lightweight text extraction (e.g. pdf-parse on first
   * 3 pages) to determine if the PDF is scanned.
   *
   * @param extractedChars — Total characters extracted from the PDF.
   * @param pageCount — Number of pages in the PDF.
   * @param threshold — Chars-per-page threshold. Below this → scanned. Default: 100.
   * @returns Updated classification result.
   */
  refinePdfClassification(
    extractedChars: number,
    pageCount: number,
    threshold: number = 100,
  ): ClassificationResult {
    if (pageCount <= 0) {
      return { documentClass: 'scanned-doc', confidence: 0.6, reason: 'PDF with 0 pages — likely scanned or empty' };
    }

    const density = extractedChars / pageCount;

    if (density < threshold) {
      return {
        documentClass: 'scanned-doc',
        confidence: 0.85,
        reason: `PDF text density ${Math.round(density)} chars/page < ${threshold} threshold — likely scanned`,
      };
    }

    return {
      documentClass: 'digital-doc',
      confidence: 0.9,
      reason: `PDF text density ${Math.round(density)} chars/page ≥ ${threshold} threshold — digital`,
    };
  }

  /**
   * Check if a file extension is supported for indexing at all.
   */
  isSupported(filePath: string): boolean {
    const ext = this._getExtension(filePath);
    if (!ext) return false;
    return TEXT_EXTENSIONS.has(ext) || RICH_DOC_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
  }

  /**
   * Check if a file extension requires rich document extraction (Docling or legacy).
   */
  isRichDocument(filePath: string): boolean {
    const ext = this._getExtension(filePath);
    if (!ext) return false;
    return RICH_DOC_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private _getExtension(filePath: string): string | null {
    const lastDot = filePath.lastIndexOf('.');
    if (lastDot < 0 || lastDot === filePath.length - 1) return null;
    // Handle paths with slashes after the dot (no extension)
    const afterDot = filePath.slice(lastDot);
    if (afterDot.includes('/') || afterDot.includes('\\')) return null;
    return afterDot.toLowerCase();
  }
}

// ── Exports for tests ─────────────────────────────────────────────────────

export { TEXT_EXTENSIONS, RICH_DOC_EXTENSIONS, IMAGE_EXTENSIONS, ALWAYS_DIGITAL_EXTENSIONS };
