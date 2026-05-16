// distinctiveTermExtractor.ts — extract distinctive terms from document text (M76 Phase 2)
//
// "Distinctive terms" here means tokens that are likely to be content-bearing
// proper nouns or technical terms — the kind of words whose co-occurrence
// across documents suggests a real conceptual connection, not just shared
// vocabulary. Two patterns matter:
//
//   1. Multi-word capitalised phrases ("Bayesian Inference", "Black-Scholes
//      Model") — proper nouns and named concepts.
//   2. All-caps acronyms 2-7 chars ("CAPM", "VAR", "ETL") — technical
//      shorthand. We accept a small false-positive rate on common acronyms
//      ("USA", "API") since filtering them out per-workspace requires a
//      stopword list we don't have.
//
// Single capitalised words are deliberately excluded — too noisy (every
// sentence-start word would match). True proper nouns that consist of a
// single word (e.g. "Kant") are missed; that's an acceptable tradeoff for
// Phase 2.
//
// This module is dependency-free and unit-testable in isolation.

const MULTI_WORD_PHRASE = /[A-Z][a-z]+(?:[ -][A-Z][a-z]+){1,}/g;
const ACRONYM = /\b[A-Z]{2,7}\b/g;

// English determiners/possessives that often start sentences with a
// capital but aren't part of the proper noun. Stripped from the front of
// multi-word phrase matches so "The Black-Scholes Model" and "the
// Black-Scholes Model" both normalise to "Black-Scholes Model" — without
// this, two docs that disagree on the article would not co-occur.
const LEADING_DETERMINERS = /^(?:The|A|An|This|That|These|Those|My|Your|His|Her|Our|Their|It|Its|We|You|They|I) /;

const MAX_TERM_LENGTH = 50;
const MAX_TERMS_PER_SOURCE = 100;

/**
 * Extract distinctive terms from `text` and return them ranked by frequency
 * (most-frequent first). Capped at MAX_TERMS_PER_SOURCE. Terms are
 * normalised by trimming surrounding whitespace and collapsing internal
 * runs of whitespace, but case is preserved so two documents that mention
 * the same proper noun will hit the same term.
 */
export function extractDistinctiveTerms(text: string): string[] {
  if (typeof text !== 'string' || text.length === 0) return [];

  const counts = new Map<string, number>();

  const bump = (raw: string): void => {
    const term = raw.replace(/\s+/g, ' ').trim();
    if (term.length === 0 || term.length > MAX_TERM_LENGTH) return;
    counts.set(term, (counts.get(term) ?? 0) + 1);
  };

  for (const m of text.match(MULTI_WORD_PHRASE) ?? []) {
    // Strip leading English determiners so "The Black-Scholes Model" and
    // "Black-Scholes Model" hit the same term. After stripping, re-check
    // that we still have a multi-capitalised-word phrase — a match like
    // "The Bayesian" with only one remaining capital word is too vague.
    const stripped = m.replace(LEADING_DETERMINERS, '');
    if (/[A-Z][a-z]+(?:[ -][A-Z][a-z]+)+/.test(stripped)) {
      bump(stripped);
    }
  }
  for (const m of text.match(ACRONYM) ?? []) bump(m);

  // Sort by frequency desc, then by term length desc (longer terms tend to
  // be more specific), then alphabetically for determinism.
  const ranked = Array.from(counts.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    if (b[0].length !== a[0].length) return b[0].length - a[0].length;
    return a[0].localeCompare(b[0]);
  });

  return ranked.slice(0, MAX_TERMS_PER_SOURCE).map(([term]) => term);
}
