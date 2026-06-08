// federatedArtifact.ts — the Commons protocol's data model + the SOVEREIGNTY
// FIREWALL (Build-11). The first cell of the federation.
//
// THE_LIVING_SYSTEM L3: sovereign agents federate to learn from each other —
// WITHOUT raw or personal data ever leaving a machine. That privacy guarantee
// cannot be a promise; it has to be enforced by construction. So an agent never
// shares its beliefs (those are about its human, and personal). It may only emit
// GENERIC, non-identifying PATTERNS — insight about tools, file-types, and
// workflows that is true for anyone — and every candidate passes the firewall
// below before it can cross. The firewall is default-deny: if it can't be shown
// to be generic, it does not leave.
//
// What actually crosses the wire is an IFederatedArtifact: a generic pattern, a
// pseudonymous origin id (never the user), a provenance hash, and a timestamp.
// No paths, no content, no identity. Pure + deterministic; the firewall is the
// most-tested thing in the system because it is the privacy boundary.

export type FederatedArtifactKind = 'pattern';

export interface IFederatedArtifact {
  readonly id: string;
  readonly kind: FederatedArtifactKind;
  /** A generic, non-personal insight (e.g. "after editing a source file, its test is often edited next"). */
  readonly content: string;
  /** A stable pseudonym for the contributing node — NEVER the human's identity. */
  readonly originId: string;
  /** Hash of (content) for integrity/dedup; not reversible to anything personal. */
  readonly provenanceHash: string;
  readonly createdMs: number;
}

export interface IShareReview {
  readonly allowed: boolean;
  readonly reason: string;
}

/** Max length of a shareable pattern — long text is almost certainly specific
 *  content, not a generic insight, so it's rejected. */
const MAX_PATTERN_CHARS = 240;

/**
 * Markers that mean the content is personal / identifying and must NEVER leave
 * the machine. Default-deny: any hit blocks sharing. Conservative by design —
 * a false reject (a generic insight wrongly blocked) costs nothing; a false
 * allow (personal data leaking) is the one failure the whole system forbids.
 */
const PERSONAL_MARKERS: readonly { readonly re: RegExp; readonly why: string }[] = [
  { re: /[A-Za-z]:[\\/]/, why: 'a Windows file path' },
  { re: /(^|\s)[~/](Users|home|Documents|Desktop|Downloads)\b/i, why: 'a filesystem path' },
  { re: /\/[\w.-]+\/[\w.-]+/, why: 'a path-like string' },
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/, why: 'an email address' },
  { re: /\b\d{1,3}(\.\d{1,3}){3}\b/, why: 'an IP address' },
  { re: /\b(my|i['’]?m|i am|the user|user['’]?s|their name|they live|they work at)\b/i, why: 'a reference to the specific user' },
  { re: /\b\d{4}-\d{2}-\d{2}\b/, why: 'a specific date' },
  { re: /[\w-]{32,}/, why: 'a long unique token (likely an id or secret)' },
];

/**
 * Review a candidate pattern for sharing. Default-deny: only generic, short,
 * marker-free content is allowed to cross the boundary. Pure.
 */
export function reviewForSharing(content: string): IShareReview {
  const c = (content ?? '').trim();
  if (!c) return { allowed: false, reason: 'empty — nothing to share' };
  if (c.length > MAX_PATTERN_CHARS) {
    return { allowed: false, reason: `too long (${c.length} > ${MAX_PATTERN_CHARS} chars) — likely specific content, not a generic pattern` };
  }
  for (const m of PERSONAL_MARKERS) {
    if (m.re.test(c)) return { allowed: false, reason: `blocked — contains ${m.why}` };
  }
  return { allowed: true, reason: 'generic pattern — no personal markers, within length' };
}

/** FNV-1a 32-bit hex (re-used from the ledger; small + deterministic). */
export function hashContent(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Build a shareable artifact from a candidate pattern — but ONLY if the firewall
 * allows it. Returns the artifact, or the review explaining the rejection. This
 * is the single chokepoint through which anything reaches the wire. Pure.
 */
export function makeArtifact(
  content: string,
  originId: string,
  nowMs: number,
  genId: () => string,
): { artifact: IFederatedArtifact } | { rejected: IShareReview } {
  const review = reviewForSharing(content);
  if (!review.allowed) return { rejected: review };
  const clean = content.trim();
  return {
    artifact: {
      id: genId(),
      kind: 'pattern',
      content: clean,
      originId,
      provenanceHash: hashContent(clean),
      createdMs: nowMs,
    },
  };
}
