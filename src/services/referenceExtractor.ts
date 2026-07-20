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
/**
 * M88 S3 — markdown link targets: `[label](target)`. Returns raw targets
 * for the caller to resolve against indexed files. Excludes images
 * (`![alt](…)`), external schemes, and pure-anchor links. Pure.
 */
export function extractMarkdownLinkTargets(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = new Set<string>();
  // Negative lookbehind excludes image syntax; the target group stops at
  // ')' and strips an optional "title" suffix and #fragment.
  const re = /(?<!!)\[[^\]]*\]\(([^()\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let target = m[1].trim();
    if (!target || target.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) continue; // http:, mailto:, parallx: …
    const hash = target.indexOf('#');
    if (hash >= 0) target = target.slice(0, hash);
    try { target = decodeURIComponent(target); } catch { /* keep raw */ }
    if (target) out.add(target);
  }
  return [...out];
}

/**
 * M88 S3 — wiki-link titles: `[[Title]]` / `[[Title|alias]]`. Returns the
 * title half; the caller resolves against known page/file titles. Pure.
 */
export function extractWikiLinkTitles(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = new Set<string>();
  const re = /\[\[([^\][|]+)(?:\|[^\][]*)?\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const title = m[1].trim();
    if (title) out.add(title);
  }
  return [...out];
}

/**
 * M88 S3 — resolve a markdown link target relative to the linking file's
 * folder into a normalized workspace-relative path ('/' separators, no
 * './', '../' collapsed). `baseDir` is '' for root-level / page sources.
 * Pure string math — no fs.
 */
export function resolveRelativeTarget(baseDir: string, target: string): string {
  const joined = (target.startsWith('/') ? target.slice(1) : `${baseDir ? baseDir + '/' : ''}${target}`)
    .replace(/\\/g, '/');
  const parts: string[] = [];
  for (const seg of joined.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

export interface TitleEntry {
  readonly key: string;   // opaque id for the caller (e.g. "page_block:abc")
  readonly title: string;
}

/**
 * M88 S3 — the cross-type bridge: find which known TITLES a text mentions
 * ("cites"). A PDF that names another paper's title links to it with no
 * LLM involved. Guards against noise: titles under 6 chars are skipped,
 * single lowercase common words are skipped, and matches must sit on word
 * boundaries. Case-insensitive. Pure; O(titles × 1 indexOf scan).
 */
export function findTitleMentions(text: string, titles: readonly TitleEntry[]): string[] {
  if (typeof text !== 'string' || text.length === 0 || titles.length === 0) return [];
  const haystack = text.toLowerCase();
  const out: string[] = [];
  for (const entry of titles) {
    const title = entry.title.trim();
    if (title.length < 6) continue;
    if (/^[a-z]+$/.test(title)) continue; // one bare lowercase word ≈ noise
    const needle = title.toLowerCase();
    let idx = haystack.indexOf(needle);
    let hit = false;
    while (idx >= 0 && !hit) {
      const before = idx === 0 ? '' : haystack[idx - 1];
      const after = idx + needle.length >= haystack.length ? '' : haystack[idx + needle.length];
      if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) hit = true;
      else idx = haystack.indexOf(needle, idx + 1);
    }
    if (hit) out.push(entry.key);
  }
  return out;
}

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
