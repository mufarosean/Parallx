// tests/unit/documentClassifier.test.ts — Unit tests for DocumentClassifier (M21 B.1)

import { describe, it, expect, beforeEach } from 'vitest';
import { DocumentClassifier } from '../../src/services/documentClassifier';

describe('DocumentClassifier', () => {
  let classifier: DocumentClassifier;

  beforeEach(() => {
    classifier = new DocumentClassifier();
  });

  // ── Text / Code files ───────────────────────────────────────────────────

  describe('text files', () => {
    const textExts = ['.md', '.txt', '.ts', '.tsx', '.js', '.py', '.json', '.html', '.css', '.yaml', '.rs', '.go', '.java', '.sql', '.csv'];

    for (const ext of textExts) {
      it(`classifies ${ext} as text`, () => {
        const result = classifier.classify(`/workspace/file${ext}`);
        expect(result.documentClass).toBe('text');
        expect(result.confidence).toBe(1.0);
      });
    }
  });

  // ── Office documents (always digital) ───────────────────────────────────

  describe('office documents', () => {
    const officeExts = ['.docx', '.xlsx', '.xls', '.xlsm', '.xlsb', '.ods', '.numbers', '.pptx', '.ppt', '.epub'];

    for (const ext of officeExts) {
      it(`classifies ${ext} as digital-doc`, () => {
        const result = classifier.classify(`/workspace/report${ext}`);
        expect(result.documentClass).toBe('digital-doc');
        expect(result.confidence).toBe(1.0);
      });
    }
  });

  // ── PDF (default digital, refinable) ────────────────────────────────────

  describe('PDF classification', () => {
    it('classifies .pdf as digital-doc by default', () => {
      const result = classifier.classify('/workspace/paper.pdf');
      expect(result.documentClass).toBe('digital-doc');
      expect(result.confidence).toBe(0.7); // Lower confidence, needs refinement
    });
  });

  // ── Images ──────────────────────────────────────────────────────────────

  describe('images', () => {
    const imageExts = ['.png', '.jpg', '.jpeg', '.tiff', '.tif', '.bmp', '.webp'];

    for (const ext of imageExts) {
      it(`classifies ${ext} as image`, () => {
        const result = classifier.classify(`/workspace/scan${ext}`);
        expect(result.documentClass).toBe('image');
        expect(result.confidence).toBe(1.0);
      });
    }
  });

  // ── Unsupported ─────────────────────────────────────────────────────────

  describe('unsupported', () => {
    it('classifies unknown extension as unsupported', () => {
      const result = classifier.classify('/workspace/archive.rar');
      expect(result.documentClass).toBe('unsupported');
    });

    it('classifies file without extension as unsupported', () => {
      const result = classifier.classify('/workspace/Makefile');
      expect(result.documentClass).toBe('unsupported');
    });

    it('handles empty path gracefully', () => {
      const result = classifier.classify('');
      expect(result.documentClass).toBe('unsupported');
    });
  });

  // ── PDF Scan Detection Refinement ───────────────────────────────────────

  describe('refinePdfClassification', () => {
    it('classifies high-density PDF as digital', () => {
      // 500 chars/page is well above the 100 threshold
      const result = classifier.refinePdfClassification(5000, 10);
      expect(result.documentClass).toBe('digital-doc');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('classifies low-density PDF as scanned', () => {
      // 50 chars/page is below the 100 threshold
      const result = classifier.refinePdfClassification(500, 10);
      expect(result.documentClass).toBe('scanned-doc');
      expect(result.confidence).toBeGreaterThan(0.8);
    });

    it('classifies zero-page PDF as scanned', () => {
      const result = classifier.refinePdfClassification(0, 0);
      expect(result.documentClass).toBe('scanned-doc');
    });

    it('classifies PDF at threshold boundary as digital', () => {
      // Exactly 100 chars/page — at threshold
      const result = classifier.refinePdfClassification(1000, 10);
      expect(result.documentClass).toBe('digital-doc');
    });

    it('classifies PDF just below threshold as scanned', () => {
      // 99 chars/page — just below
      const result = classifier.refinePdfClassification(990, 10);
      expect(result.documentClass).toBe('scanned-doc');
    });

    it('accepts custom threshold', () => {
      // 200 chars/page, threshold 300 → scanned
      const result = classifier.refinePdfClassification(2000, 10, 300);
      expect(result.documentClass).toBe('scanned-doc');
    });
  });

  // ── Utility Methods ─────────────────────────────────────────────────────

  describe('isSupported', () => {
    it('returns true for text files', () => {
      expect(classifier.isSupported('/workspace/file.md')).toBe(true);
    });

    it('returns true for rich documents', () => {
      expect(classifier.isSupported('/workspace/file.pdf')).toBe(true);
    });

    it('returns true for images', () => {
      expect(classifier.isSupported('/workspace/scan.png')).toBe(true);
    });

    it('returns false for unknown formats', () => {
      expect(classifier.isSupported('/workspace/file.rar')).toBe(false);
    });
  });

  describe('isRichDocument', () => {
    it('returns true for PDF', () => {
      expect(classifier.isRichDocument('/workspace/file.pdf')).toBe(true);
    });

    it('returns true for images', () => {
      expect(classifier.isRichDocument('/workspace/scan.jpg')).toBe(true);
    });

    it('returns true for PPTX', () => {
      expect(classifier.isRichDocument('/workspace/slides.pptx')).toBe(true);
    });

    it('returns false for text', () => {
      expect(classifier.isRichDocument('/workspace/file.md')).toBe(false);
    });
  });
});
