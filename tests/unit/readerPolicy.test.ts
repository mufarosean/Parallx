// readerPolicy.test.ts — what background indexing asks of the document
// reader: re-read, once, what the basic readers read; never read pictures.

import { describe, it, expect } from 'vitest';
import { isPicturePath, isReadOnRequestOnly, sourcesToRereadWithReader } from '../../src/services/readerPolicy';

describe('sourcesToRereadWithReader', () => {
  const sources = [
    { sourceType: 'file_chunk', sourceId: 'Papers/Mack.pdf', extractionPipeline: 'legacy', extractionFallback: 0 },
    { sourceType: 'file_chunk', sourceId: 'Papers/Clark.pdf', extractionPipeline: 'docling', extractionFallback: 0 },
    { sourceType: 'file_chunk', sourceId: 'Papers/Broken.pdf', extractionPipeline: 'legacy', extractionFallback: 1 },
    { sourceType: 'file_chunk', sourceId: 'notes/plan.md', extractionPipeline: 'text' },
    { sourceType: 'file_chunk', sourceId: 'notes/old.txt', extractionPipeline: null },
    { sourceType: 'page_block', sourceId: 'a-page-id', extractionPipeline: 'legacy' },
  ];

  it('picks the files the basic readers read, and nothing else', () => {
    expect([...sourcesToRereadWithReader(sources, true)]).toEqual(['Papers/Mack.pdf']);
  });

  it('leaves alone a file the reader already tried and could not read', () => {
    expect(sourcesToRereadWithReader(sources, true).has('Papers/Broken.pdf')).toBe(false);
  });

  it('picks nothing while the reader is not there', () => {
    expect(sourcesToRereadWithReader(sources, false).size).toBe(0);
  });
});

describe('pictures', () => {
  it('are known by their names, whatever the case', () => {
    for (const p of ['a.png', 'Holiday/IMG_0042.JPG', 'scan.tiff', 'x.webp', 'shot.HEIC']) expect(isPicturePath(p)).toBe(true);
    for (const p of ['a.pdf', 'notes.md', 'png', 'archive.png.zip', 'noext']) expect(isPicturePath(p)).toBe(false);
  });

  it('are left out of background indexing; documents are not', () => {
    expect(isReadOnRequestOnly('Library/2024/IMG_0042.jpg')).toBe(true);
    expect(isReadOnRequestOnly('Scans/contract.pdf')).toBe(false);
  });
});
