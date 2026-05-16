// referenceExtractor.ts — extract workspace references from document text (M76 Phase 2)
//
// Scans canvas page block text and file chunk text for explicit references
// that resolve to workspace items. Emits one entry per match; the caller is
// responsible for filtering to entries whose target is actually indexed.
//
// Supported reference syntaxes:
//   - parallx://page/<pageId>             — canonical M66 short form
//   - parallx://canvas/page/<pageId>      — canonical M66 long form
//   - parallx://canvas/page/<pageId>/...  — block-level link; resolves to page
//
// File-target references (parallx://file/...) are not part of Parallx's
// canonical link format today and are not extracted. If a future milestone
// adds them, this module is where they get added.
//
// This module is intentionally dependency-free aside from the URI parser so
// it can be unit-tested in isolation.

import { parseParallxUri } from '../links/parallxUri.js';
import type { SemanticGraphSourceType } from './semanticGraphService.js';

export interface ExtractedReference {
  /** Type of the indexed source the reference points to. */
  readonly targetType: SemanticGraphSourceType;
  /** Source ID (page ID, file path) the reference points to. */
  readonly targetId: string;
}

/**
 * Pull every plausible `parallx://` URI out of `text`, parse each, and
 * return one ExtractedReference per URI that resolves to a workspace item
 * type the semantic graph indexes (currently page_block only). Duplicates
 * are de-duplicated by target id.
 *
 * Performance: pure regex + URI parse, no I/O. Safe to call from the
 * indexing-time edge producer path.
 */
export function extractWorkspaceReferences(text: string): ExtractedReference[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  // Match anything that looks like a parallx URI. Stops at whitespace, common
  // markup delimiters, and quote characters so we don't gobble surrounding
  // markdown punctuation. The URI parser does the real validation.
  const matches = text.match(/parallx:\/\/[^\s)>"'`\]]+/gi);
  if (!matches || matches.length === 0) return [];

  const seen = new Set<string>();
  const out: ExtractedReference[] = [];

  for (const rawMatch of matches) {
    // Strip trailing sentence/clause punctuation that often abuts a URI in
    // prose ("see parallx://page/abc." or "..., parallx://page/abc,"). The
    // URI parser would otherwise accept the trailing char as part of the
    // last path segment.
    const raw = rawMatch.replace(/[.,;:!?]+$/, '');
    const parsed = parseParallxUri(raw);
    if (!parsed) continue;

    // parallx://page/<pageId>  →  segment='page', pathSegments=['<pageId>']
    if (parsed.segment === 'page' && parsed.pathSegments.length >= 1) {
      const pageId = parsed.pathSegments[0];
      if (pageId && !seen.has(`page_block:${pageId}`)) {
        seen.add(`page_block:${pageId}`);
        out.push({ targetType: 'page_block', targetId: pageId });
      }
      continue;
    }

    // parallx://canvas/page/<pageId>[/...]  →  segment='canvas', pathSegments=['page', '<pageId>', ...]
    if (parsed.segment === 'canvas' && parsed.kind === 'page' && parsed.pathSegments.length >= 2) {
      const pageId = parsed.pathSegments[1];
      if (pageId && !seen.has(`page_block:${pageId}`)) {
        seen.add(`page_block:${pageId}`);
        out.push({ targetType: 'page_block', targetId: pageId });
      }
      continue;
    }
  }

  return out;
}
