/**
 * OpenClaw citation check — every citation is checked before the answer is shown.
 *
 * Reading tools label each block of source text they return ([S3]; see
 * services/sourceHandles.ts). The model cites with those labels. Before the
 * answer is final, this module checks each one:
 *
 *   - the label exists (the model read that block in this chat);
 *   - the cited block supports the sentence: numbers in the sentence appear
 *     in the block (a number taken from the wrong page is the common wrong
 *     citation), or the sentence's words do;
 *   - a hand-written `parallx://` link was made by link_create (which checks
 *     its target) or is a label's own link;
 *   - an answer drawn from documents read this turn cites them at all.
 *
 * Problems go back to the model once, as a note it answers by rewriting
 * (openclawAttempt.ts); the app never rewrites the answer's words. Then the
 * labels become links, and a citation that still fails is shown as
 * Unverified, so a wrong link never looks like a good one.
 *
 * Pure functions, no model calls: instant, and the same for a local model
 * as for a cloud one.
 */

import type { ISourceHandle } from '../services/sourceHandles.js';

export interface ICitationContext {
  /** The session's handle with this id, if it issued one. */
  lookup(id: string): ISourceHandle | undefined;
  /** Every handle the session holds: where a better source is looked for. */
  readonly sessionHandles: readonly ISourceHandle[];
  /** Handles issued (or read again) in this turn. */
  readonly turnHandles: readonly ISourceHandle[];
  /** Whether link_create made (and so checked) this link in the session. */
  isLinkMinted(uri: string): boolean;
}

export type CitationProblem =
  | { readonly kind: 'unknown-label'; readonly label: string; readonly claim: string }
  | { readonly kind: 'unsupported'; readonly label: string; readonly claim: string; readonly missing: readonly string[]; readonly better?: string }
  | { readonly kind: 'unchecked-link'; readonly uri: string; readonly text: string }
  | { readonly kind: 'uncited' };

/** One `[S3]` or `[S3, S5]` in the answer. */
export interface ILabelCitation {
  readonly start: number;
  readonly end: number;
  readonly claim: string;
  /** Per label: undefined when it checks out, else why not. */
  readonly labels: readonly { readonly id: string; readonly problem?: string }[];
}

/** One `[text](parallx://…)` link the model wrote. */
export interface ILinkCitation {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly uri: string;
  readonly problem?: string;
}

export interface ICitationReport {
  readonly problems: readonly CitationProblem[];
  readonly labels: readonly ILabelCitation[];
  readonly links: readonly ILinkCitation[];
}

const LABEL_GROUP_RE = /\[\s*(S\d{1,4}(?:\s*[,;]\s*S\d{1,4})*)\s*\](?!\()/gi;
const PARALLX_LINK_RE = /\[([^\]\n]*)\]\((parallx:\/\/[^)\s]+)(?:\s+"[^"\n]*")?\)/g;

/** Code (fenced and inline) blanked out, offsets kept: citations inside code are not citations. */
function maskCode(md: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return md.replace(/```[\s\S]*?(```|$)/g, blank).replace(/`[^`\n]*`/g, blank);
}

/** The sentence a citation at `at` stands for: the text before it, back to a sentence end. */
function claimBefore(masked: string, at: number): string {
  const lineStart = masked.lastIndexOf('\n', at - 1) + 1;
  const before = masked.slice(lineStart, at);
  const sentences = before.split(/(?<=[.!?])\s+(?=\S)/).filter((s) => s.trim());
  let claim = sentences[sentences.length - 1] ?? '';
  // "… is 1.05. [S3]" — the label follows the sentence it cites.
  if (wordsOf(cleanClaim(claim)).length < 3 && sentences.length > 1) {
    claim = `${sentences[sentences.length - 2]} ${claim}`;
  }
  return cleanClaim(claim);
}

/** A claim as plain words: labels, link targets and markup removed. */
function cleanClaim(text: string): string {
  return text
    .replace(LABEL_GROUP_RE, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>#|$\\]/g, ' ')
    .replace(/^\s*(?:[-+]|\d{1,3}[.)])\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── What a claim says, and whether a block says it ──

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'they', 'them', 'then', 'than', 'there', 'their', 'what', 'when', 'where',
  'which', 'will', 'would', 'should', 'could', 'into', 'about', 'does', 'also', 'more', 'most', 'some', 'such', 'only',
  'other', 'each', 'used', 'using', 'between', 'these', 'those', 'being', 'been', 'were', 'your', 'very', 'just',
  'because', 'while', 'after', 'before', 'over', 'under', 'same', 'both', 'like', 'make', 'made', 'many', 'much',
  'here', 'well', 'even', 'must', 'shall', 'says', 'said', 'note', 'notes', 'page', 'pages', 'source', 'line',
]);

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && (w.endsWith('ing') || w.endsWith('ed'))) return w.replace(/(ing|ed)$/, '');
  if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function wordsOf(text: string): string[] {
  const words = text.toLowerCase().match(/\p{L}[\p{L}'-]{3,}/gu) ?? [];
  return [...new Set(words.filter((w) => !STOPWORDS.has(w)).map(stem))];
}

/** Numbers that identify a fact: two or more digits, or a decimal. */
function numbersOf(text: string): string[] {
  const found = text.match(/(?<![\p{L}\d.])\d[\d,]*(?:\.\d+)?%?/gu) ?? [];
  return [...new Set(found
    .map((n) => n.replace(/,(?=\d{3}\b)/g, '').replace(/,/g, ''))
    .filter((n) => n.replace(/[^\d]/g, '').length >= 2 || n.includes('.')))];
}

/** Whether a number in a claim appears in a block: as written, rounded, or as a percent. */
function numberIn(claimNumber: string, blockNumbers: readonly number[]): boolean {
  const percent = claimNumber.endsWith('%');
  const raw = claimNumber.replace('%', '');
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return true;
  const places = raw.includes('.') ? raw.split('.')[1].length : 0;
  const round = (v: number) => Math.round(v * 10 ** places) / 10 ** places;
  const candidates = [value, percent ? value / 100 : value * 100];
  return blockNumbers.some((b) => candidates.some((c) => Math.abs(round(b) - c) < 1e-9 || Math.abs(b - c) < 1e-9));
}

interface ISupport {
  readonly numbers: readonly string[];
  readonly missing: readonly string[];
  readonly overlap: number;
  readonly words: number;
}

function supportOf(claim: string, blockText: string): ISupport {
  const numbers = numbersOf(claim);
  const blockNumbers = numbersOf(blockText).map((n) => parseFloat(n.replace('%', ''))).filter(Number.isFinite);
  const missing = numbers.filter((n) => !numberIn(n, blockNumbers));
  const words = wordsOf(claim);
  const blockWords = new Set(wordsOf(blockText));
  const shared = words.filter((w) => blockWords.has(w)).length;
  return { numbers, missing, overlap: words.length ? shared / words.length : 1, words: words.length };
}

/** The verdict: does the block back the claim? */
function supports(s: ISupport): boolean {
  if (s.numbers.length > 0) {
    // A number from the wrong page is the wrong citation; a strong match of
    // words still passes a sentence whose figure was worked out from the block.
    return s.missing.length < s.numbers.length || s.overlap >= 0.6;
  }
  return s.words < 4 || s.overlap >= 0.25;
}

/** The read block that backs a claim better than the ones cited, if one clearly does. */
function betterSource(claim: string, cited: readonly string[], ctx: ICitationContext): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const h of ctx.sessionHandles) {
    if (cited.includes(h.id)) continue;
    const s = supportOf(claim, h.text);
    if (s.numbers.length > 0 ? s.missing.length > 0 : s.overlap < 0.5) continue;
    const score = s.overlap + (s.numbers.length - s.missing.length);
    if (!best || score > best.score) best = { id: h.id, score };
  }
  return best?.id;
}

// ── The check ──

export function checkCitations(markdown: string, ctx: ICitationContext): ICitationReport {
  const masked = maskCode(markdown);
  const problems: CitationProblem[] = [];
  const labels: ILabelCitation[] = [];
  const links: ILinkCitation[] = [];

  for (const m of masked.matchAll(LABEL_GROUP_RE)) {
    const start = m.index ?? 0;
    const ids = m[1].split(/[,;]/).map((s) => s.trim().toUpperCase());
    const claim = claimBefore(masked, start);
    const handles = ids.map((id) => ctx.lookup(id));
    const known = handles.filter((h): h is ISourceHandle => !!h);
    // Several labels on one sentence back it together.
    const together = known.length > 0 ? supportOf(claim, known.map((h) => h.text).join('\n')) : undefined;
    const backed = together ? supports(together) : false;
    const better = !backed && together ? betterSource(claim, ids, ctx) : undefined;
    const firstKnown = handles.findIndex(Boolean);
    const verdicts = ids.map((id, i) => {
      if (!handles[i]) {
        problems.push({ kind: 'unknown-label', label: id, claim });
        return { id, problem: 'no block was read with this label' };
      }
      if (!backed) {
        if (i === firstKnown) {
          problems.push({ kind: 'unsupported', label: ids.filter((_, k) => handles[k]).join(', '), claim, missing: together!.missing, ...(better ? { better } : {}) });
        }
        return { id, problem: together!.missing.length > 0 ? `the source does not contain ${together!.missing.join(', ')}` : 'the source does not say this' };
      }
      return { id };
    });
    labels.push({ start, end: start + m[0].length, claim, labels: verdicts });
  }

  const handleUris = new Set(ctx.sessionHandles.map((h) => h.uri));
  for (const m of masked.matchAll(PARALLX_LINK_RE)) {
    const start = m.index ?? 0;
    const uri = markdown.slice(start, start + m[0].length).match(/\((parallx:\/\/[^)\s]+)/)?.[1] ?? m[2];
    const text = markdown.slice(start + 1, start + 1 + m[1].length);
    const ok = ctx.isLinkMinted(uri) || handleUris.has(uri);
    if (!ok) problems.push({ kind: 'unchecked-link', uri, text });
    links.push({ start, end: start + m[0].length, text, uri, ...(ok ? {} : { problem: 'this link was not checked' }) });
  }

  // Read documents this turn, then answered from them without citing any.
  const documents = ctx.turnHandles.filter((h) => h.document);
  if (labels.length === 0 && !links.some((l) => !l.problem) && documents.length > 0) {
    const prose = cleanClaim(masked.replace(/\n+/g, ' '));
    const sentences = prose.split(/(?<=[.!?])\s+/).filter((s) => wordsOf(s).length >= 3);
    if (prose.length >= 120 && sentences.length >= 2) {
      const s = supportOf(prose, documents.map((h) => h.text).join('\n'));
      if (s.overlap >= 0.35 || s.numbers.length - s.missing.length >= 1) problems.push({ kind: 'uncited' });
    }
  }

  return { problems, labels, links };
}

// ── The note back to the model ──

function quoteClaim(claim: string): string {
  const c = claim.length > 140 ? `${claim.slice(0, 137)}…` : claim;
  return `"${c}"`;
}

export function buildCitationCorrection(problems: readonly CitationProblem[]): string {
  const lines = ['[Citation check] Your answer has not been shown to the user yet. Fix its citations first:'];
  for (const p of problems) {
    switch (p.kind) {
      case 'unknown-label':
        lines.push(`- ${quoteClaim(p.claim)} cites [${p.label}], but no block you read is labelled ${p.label}. Cite the label shown on the block the fact came from (read the source again if needed).`);
        break;
      case 'unsupported': {
        const what = p.missing.length > 0 ? `does not contain ${p.missing.join(', ')}` : 'does not say this';
        lines.push(`- ${quoteClaim(p.claim)} cites [${p.label}], but that block ${what}.${p.better ? ` [${p.better}] does: cite it instead.` : ' Cite the block it came from, or remove the claim if no block you read says it.'}`);
        break;
      }
      case 'unchecked-link':
        lines.push(`- The link "${p.text}" (${p.uri}) was written by hand, so it is unchecked. Cite the block's label instead, or make the link with link_create.`);
        break;
      case 'uncited':
        lines.push('- The answer uses what you read but cites nothing. Put the label of the block each fact came from right after its sentence, like "… is 1.05 [S3]."');
        break;
    }
  }
  lines.push('Write the whole answer again with these fixed, keeping the rest as it was. Do not mention this check.');
  return lines.join('\n');
}

// ── The answer as shown: labels become links ──

function linkText(text: string): string {
  return text.replace(/[[\]\\]/g, (c) => `\\${c}`);
}

function titleAttr(text: string): string {
  return text.replace(/"/g, "'");
}

/**
 * The answer with every label turned into its link and every citation that
 * failed the check marked Unverified (its link text says so and its title
 * says why). Text outside citations is untouched.
 */
export function renderCitedAnswer(markdown: string, report: ICitationReport, ctx: ICitationContext): string {
  const edits: { start: number; end: number; text: string }[] = [];
  for (const c of report.labels) {
    const parts = c.labels.map(({ id, problem }) => {
      const h = ctx.lookup(id);
      if (!h) return `${id} · Unverified`;
      return problem
        ? `[${linkText(`${h.title} · Unverified`)}](${h.uri} "${titleAttr(`Unverified: ${problem}`)}")`
        : `[${linkText(h.title)}](${h.uri})`;
    });
    // "is 1.05 [S3]." reads "is 1.05 (Clark.pdf, page 13)."
    edits.push({ start: c.start, end: c.end, text: `(${parts.join('; ')})` });
  }
  for (const l of report.links) {
    if (!l.problem) continue;
    edits.push({ start: l.start, end: l.end, text: `[${linkText(`${l.text} · Unverified`)}](${l.uri} "${titleAttr(`Unverified: ${l.problem}`)}")` });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = markdown;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}
