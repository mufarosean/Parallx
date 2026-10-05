// quoteLocator.ts — find where a quoted passage sits in a document.
//
// A citation is only useful when it lands on the spot the claim came from.
// The AI quotes a passage; this module finds it in the document's own text,
// split into the units the document is addressed by (PDF pages, text lines,
// spreadsheet cells), and says which unit it starts and ends in. The AI never
// computes a page, line or cell itself.
//
// Matching ignores what text extraction and retyping change: case, spacing
// and line breaks, punctuation and quote styles, hyphens at line ends,
// ligatures. Only letters and digits are compared (the "skeleton"), so
// "The ultimate loss is NOT the same as the expected loss!" matches the
// page text "the ulti-\nmate loss is not the same as the expected loss".
//
// Pure functions, no I/O: the file locator (fileLocator.ts) reads the file
// and hands the units in.

/** Shortest quote (letters and digits only) that can be located reliably. */
export const MIN_QUOTE_SKELETON_LENGTH = 12;

/** Most matches reported for one quote. */
const MAX_MATCHES = 20;

const KEEP_CHAR = /[\p{L}\p{N}]/u;

interface Skeleton {
  /** Lower-cased letters and digits only. */
  readonly text: string;
  /** For each skeleton character, its offset in the original string. */
  readonly offsets: readonly number[];
}

function skeletonOf(source: string): Skeleton {
  let text = '';
  const offsets: number[] = [];
  for (let i = 0; i < source.length; i++) {
    const code = source.charCodeAt(i);
    if (code < 128) {
      // ASCII fast path: most of any document.
      if ((code >= 48 && code <= 57) || (code >= 97 && code <= 122)) { text += source[i]; offsets.push(i); }
      else if (code >= 65 && code <= 90) { text += String.fromCharCode(code + 32); offsets.push(i); }
      continue;
    }
    // NFKC per character: ligatures (ﬁ → fi), math letters (𝑥 → x),
    // full-width forms and the like become plain letters. A character may
    // expand to several. Astral characters span two UTF-16 units.
    const cp = source.codePointAt(i) ?? code;
    const width = cp > 0xffff ? 2 : 1;
    const folded = String.fromCodePoint(cp).normalize('NFKC').toLowerCase();
    for (const ch of folded) {
      if (KEEP_CHAR.test(ch)) {
        text += ch;
        offsets.push(i);
      }
    }
    i += width - 1;
  }
  return { text, offsets };
}

/** Letters and digits of a quote, lower-cased: what matching compares. */
export function quoteSkeleton(quote: string): string {
  return skeletonOf(quote).text;
}

/** True when the quote has enough letters and digits to be located. */
export function isLocatableQuote(quote: string): boolean {
  return quoteSkeleton(quote).length >= MIN_QUOTE_SKELETON_LENGTH;
}

/**
 * A passage as the document has it, ready to hand to a viewer's find: words
 * split by a line-end hyphen are joined (as the PDF viewer's find does to the
 * page text) and whitespace is collapsed.
 */
function documentWording(passage: string): string {
  return passage
    .replace(/(\p{L})[-\u00AD\u2010][ \t]*\r?\n\s*(\p{L})/gu, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface QuoteMatch {
  /** Index of the unit the quote starts in (0-based). */
  readonly startUnit: number;
  /** Index of the unit the quote ends in (0-based). */
  readonly endUnit: number;
  /** The matched passage as the document has it, whitespace collapsed. */
  readonly text: string;
}

/**
 * Find a quote in a document split into units (pages, lines, cells). A match
 * may run across units. Returns matches in document order; empty when the
 * quote is not there or is too short to locate.
 */
export function locateQuote(units: readonly string[], quote: string): QuoteMatch[] {
  const needle = quoteSkeleton(quote);
  if (needle.length < MIN_QUOTE_SKELETON_LENGTH) return [];

  // One string for the whole document; unitStarts maps an offset back to its
  // unit. The separator has no letters or digits, so it never affects a match.
  const unitStarts: number[] = [];
  let joined = '';
  for (let i = 0; i < units.length; i++) {
    unitStarts.push(joined.length);
    joined += units[i] ?? '';
    joined += '\n';
  }
  const hay = skeletonOf(joined);

  const unitAt = (offset: number): number => {
    let lo = 0;
    let hi = unitStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (unitStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const matches: QuoteMatch[] = [];
  let from = 0;
  while (matches.length < MAX_MATCHES) {
    const at = hay.text.indexOf(needle, from);
    if (at < 0) break;
    const startOffset = hay.offsets[at];
    let endOffset = hay.offsets[at + needle.length - 1];
    // Keep both halves of an astral character that ends the match.
    const endCode = joined.charCodeAt(endOffset);
    if (endCode >= 0xd800 && endCode <= 0xdbff) endOffset += 1;
    matches.push({
      startUnit: unitAt(startOffset),
      endUnit: unitAt(endOffset),
      text: documentWording(joined.slice(startOffset, endOffset + 1)),
    });
    from = at + needle.length;
  }
  return matches;
}

/**
 * Which units a passage of the document (for example a search chunk) comes
 * from. Chunk text can differ from the page text in layout (headings, table
 * markup), so a few probes from its start, middle and end are looked up and
 * every unit a probe lands in is returned, sorted. Empty when none is found.
 */
export function locatePassageUnits(units: readonly string[], passage: string): number[] {
  const skel = quoteSkeleton(passage);
  const PROBE = 40;
  if (skel.length < MIN_QUOTE_SKELETON_LENGTH) return [];
  const probes = skel.length <= PROBE
    ? [skel]
    : [skel.slice(0, PROBE), skel.slice(Math.floor((skel.length - PROBE) / 2), Math.floor((skel.length - PROBE) / 2) + PROBE), skel.slice(-PROBE)];

  const unitSkeletons = units.map((u) => quoteSkeleton(u ?? ''));
  const joined = unitSkeletons.join('');
  const starts: number[] = [];
  let pos = 0;
  for (const s of unitSkeletons) { starts.push(pos); pos += s.length; }
  const unitAt = (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const found = new Set<number>();
  for (const probe of probes) {
    const at = joined.indexOf(probe);
    if (at < 0) continue;
    found.add(unitAt(at));
    found.add(unitAt(at + probe.length - 1));
  }
  return [...found].sort((a, b) => a - b);
}

/**
 * The page label for a passage of a PDF ("page 13 of 30", "pages 13 to 14 of
 * 30"), or '' when the passage cannot be placed on its pages.
 */
export function pageLabelForPassage(pages: readonly string[], passage: string): string {
  const found = locatePassageUnits(pages, passage);
  if (found.length === 0) return '';
  const first = found[0] + 1;
  const last = found[found.length - 1] + 1;
  return first === last ? `page ${first} of ${pages.length}` : `pages ${first} to ${last} of ${pages.length}`;
}

/** Spreadsheet column letters for a 0-based column index: 0 → A, 27 → AB. */
export function columnLetters(index: number): string {
  let n = Math.max(0, Math.floor(index)) + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/**
 * Parse an A1-style cell reference ("B206", "$b$206") into 0-based row and
 * column. Returns undefined for anything else.
 */
export function parseCellRef(ref: string): { row: number; col: number } | undefined {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(ref.trim());
  if (!m) return undefined;
  const letters = m[1].toUpperCase();
  let col = 0;
  for (const ch of letters) col = col * 26 + (ch.charCodeAt(0) - 64);
  const row = parseInt(m[2], 10);
  if (row < 1) return undefined;
  return { row: row - 1, col: col - 1 };
}

/**
 * PDF text for reading, one block per page. Each page STARTS with its
 * header, so the text under a header is that page's text. Page numbers are
 * the PDF's own (1 = first page of the file), which is what the viewer's page
 * box shows and what a link's `page` takes; they are not the numbers printed
 * on the pages.
 */
export function formatPagesForReading(pageTexts: readonly string[], firstPage = 1, lastPage = pageTexts.length): string {
  const total = pageTexts.length;
  const from = Math.max(1, Math.min(firstPage, total));
  const to = Math.max(from, Math.min(lastPage, total));
  const blocks: string[] = [];
  for (let p = from; p <= to; p++) {
    blocks.push(`===== Page ${p} of ${total} =====\n${(pageTexts[p - 1] ?? '').trim()}`);
  }
  return blocks.join('\n\n');
}
