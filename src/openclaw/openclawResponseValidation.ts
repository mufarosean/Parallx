/**
 * OpenClaw response validation — citation remapping + evidence assessment.
 *
 * Upstream reference: OpenClaw uses model output as-is. The only post-processing
 * is structural — citation remapping, payload normalization. No content repair.
 *
 * What this file provides:
 *   - validateCitations: structural citation index remapping (ALIGNED)
 *   - assessEvidence: pre-model quality signal for context engine input shaping (ALIGNED)
 *   - buildEvidenceConstraint: prompt constraint injection when evidence is weak (ALIGNED)
 *
 * What was removed (F6 audit, output repair anti-pattern):
 *   - buildExtractiveFallback: synthesized response without model (OUTPUT REPAIR)
 *   - extractCoverageFocusTerms: insurance-domain hardcoding (HEURISTIC)
 *   - roleBonus / scoreLine: domain-specific scoring (HEURISTIC)
 */

// ---------------------------------------------------------------------------
// Citation validation (M1)
// ---------------------------------------------------------------------------

export interface IValidatedCitations {
  /** Markdown with citation indices remapped to match ragSources order. */
  readonly markdown: string;
  /** Citations actually referenced in the markdown — unreferenced ones filtered out. */
  readonly attributableSources: readonly { uri: string; label: string; index: number }[];
}

const CITATION_REF_RE = /\[(\d+)\]/g;

/**
 * Validate and clean up citations in the model's markdown response.
 *
 * 1. Detects all `[N]` references in the response text.
 * 2. When the model used arbitrary indices that don't match ragSources,
 *    attempt to remap them (by first-appearance order → sorted source order).
 * 3. Filter to only attributable citations (referenced in text).
 */
export function validateCitations(
  markdown: string,
  ragSources: readonly { uri: string; label: string; index: number }[],
): IValidatedCitations {
  if (!markdown || ragSources.length === 0) {
    return { markdown, attributableSources: [] };
  }

  // Collect all [N] references from the text
  const validIndices = new Set(ragSources.map(s => s.index));
  const referencedIndices: number[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;

  CITATION_REF_RE.lastIndex = 0;
  while ((match = CITATION_REF_RE.exec(markdown)) !== null) {
    const idx = parseInt(match[1], 10);
    if (!seen.has(idx)) {
      seen.add(idx);
      referencedIndices.push(idx);
    }
  }

  if (referencedIndices.length === 0) {
    return { markdown, attributableSources: [] };
  }

  // Check for index mismatch — try to remap
  let remappedMarkdown = markdown;
  const unmatchedRefs = referencedIndices.filter(idx => !validIndices.has(idx));
  if (unmatchedRefs.length > 0 && referencedIndices.length === ragSources.length) {
    const sortedSources = [...ragSources].sort((a, b) => a.index - b.index);
    const remap = new Map<number, number>();
    for (let i = 0; i < referencedIndices.length; i++) {
      remap.set(referencedIndices[i], sortedSources[i].index);
    }
    remappedMarkdown = markdown.replace(CITATION_REF_RE, (_, num: string) => {
      const mapped = remap.get(parseInt(num, 10));
      return mapped != null ? `[${mapped}]` : `[${num}]`;
    });
  }

  // Filter to attributable citations (only those referenced in final text)
  CITATION_REF_RE.lastIndex = 0;
  const finalRefs = new Set<number>();
  while ((match = CITATION_REF_RE.exec(remappedMarkdown)) !== null) {
    finalRefs.add(parseInt(match[1], 10));
  }
  const attributableSources = ragSources.filter(s => finalRefs.has(s.index));

  return { markdown: remappedMarkdown, attributableSources };
}

// ---------------------------------------------------------------------------
// Evidence assessment — pre-model quality signal for context engine
// ---------------------------------------------------------------------------

/**
 * Assess whether retrieved context is sufficient, weak, or insufficient.
 *
 * This is used as an INPUT shaping signal in the context engine's assemble()
 * method. When evidence is weak/insufficient, a constraint is injected into
 * the system prompt to guide the model's behavior — NOT to repair its output.
 *
 * Upstream rationale: OpenClaw doesn't have this exact function, but the
 * pattern of adjusting prompt context based on retrieval quality is sound.
 * This is a Parallx adaptation for weak local models that need explicit
 * guidance when evidence is thin.
 */
export function assessEvidence(
  query: string,
  retrievedContextText: string,
  ragSources: readonly { uri: string; label: string; index?: number }[],
): { status: 'sufficient' | 'weak' | 'insufficient'; reasons: string[] } {
  const normalizedContext = retrievedContextText.toLowerCase();
  const queryTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));

  const matchedTerms = [...new Set(queryTerms.filter(t => normalizedContext.includes(t)))];
  const sectionCount = (retrievedContextText.match(/^\[\d+\]\s+Source:/gim) ?? []).length;
  const wordCount = query.split(/\s+/).filter(Boolean).length;
  const normalizedQuery = query.toLowerCase();
  const isHard = wordCount >= 12
    || /\b(and|then|after|compare|versus|vs\.?|workflow|steps)\b/i.test(normalizedQuery)
    || ((normalizedQuery.match(/\b(what|how|where|who|when|which)\b/g) ?? []).length >= 2);

  const reasons: string[] = [];

  if (!retrievedContextText.trim() || ragSources.length === 0) {
    return { status: 'insufficient', reasons: ['no-grounded-sources'] };
  }
  if (matchedTerms.length === 0) {
    return { status: 'insufficient', reasons: ['no-query-term-overlap'] };
  }

  if (isHard && ragSources.length < 2) reasons.push('hard-query-low-source-coverage');
  if (isHard && sectionCount < 2) reasons.push('hard-query-low-section-coverage');
  if (matchedTerms.length < Math.min(isHard ? 3 : 2, queryTerms.length)) reasons.push('limited-focus-overlap');
  if (retrievedContextText.length < (isHard ? 400 : 120)) reasons.push('thin-evidence-set');

  if (reasons.length >= 2 || reasons.includes('hard-query-low-source-coverage')) {
    return { status: 'weak', reasons };
  }
  return { status: 'sufficient', reasons };
}

/**
 * Build a constraint string for the model prompt when evidence is weak/insufficient.
 *
 * This is INPUT shaping — it instructs the model how to behave given limited
 * context. It does NOT modify model output after generation.
 */
export function buildEvidenceConstraint(
  _query: string,
  assessment: { status: string; reasons: string[] },
): string {
  if (assessment.status === 'insufficient') {
    return 'Response Constraint: The retrieved evidence is insufficient. Answer narrowly with caveats, ask a clarifying question, or state that the available documents do not contain enough information to answer fully.';
  }
  return 'Response Constraint: Keep the answer narrow and explicitly grounded in the available evidence. Do not speculate beyond what the retrieved context supports.';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set(['what', 'when', 'where', 'which', 'with', 'your', 'this', 'that', 'have', 'from', 'into']);
