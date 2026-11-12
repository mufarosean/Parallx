// readerPolicy.ts — what the indexer asks of the document reader.
//
// Two rules, both about work done in the background:
//
// 1. A document read by the basic readers before the document reader was set
//    up is read again, once, now that it is: its tables, headings and layout
//    were lost the first time. A document the reader already tried and could
//    not read is left alone, or it would be tried again on every pass.
//
// 2. Pictures are not read in the background. A workspace can hold a photo
//    library, and reading every photo for text would run the processor for
//    hours to find nothing. A picture of a page is read when it is asked for
//    (opened, quoted, handed to the chat).

/** What the index remembers about one source (vectorStoreService's IndexingMeta, the part used here). */
export interface IIndexedSourceInfo {
  readonly sourceType: string;
  readonly sourceId: string;
  readonly extractionPipeline?: string | null;
  readonly extractionFallback?: number | boolean | null;
}

/**
 * Files to read again although they have not changed: read by the basic
 * readers, never yet tried with the document reader.
 */
export function sourcesToRereadWithReader(sources: readonly IIndexedSourceInfo[], readerAvailable: boolean): Set<string> {
  const out = new Set<string>();
  if (!readerAvailable) return out;
  for (const s of sources) {
    if (s.sourceType === 'file_chunk' && s.extractionPipeline === 'legacy' && !s.extractionFallback) out.add(s.sourceId);
  }
  return out;
}

const PICTURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif', '.webp', '.heic', '.heif', '.avif']);

/** Is `path` a picture, by its name? */
export function isPicturePath(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot >= 0 && PICTURE_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/** Does background indexing leave this file to be read on request? */
export function isReadOnRequestOnly(path: string): boolean {
  return isPicturePath(path);
}
