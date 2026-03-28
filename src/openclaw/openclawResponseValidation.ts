/**
 * OpenClaw response validation — citation extraction.
 *
 * Upstream reference: OpenClaw uses model output as-is. No content repair,
 * no index remapping, no pre-classification.
 *
 * What this file provides:
 *   - validateCitations: extracts which ragSources the model referenced (for UI)
 *
 * Removed (agent autonomy — M41 anti-patterns):
 *   - Citation index remapping (output repair)
 *   - assessEvidence: regex pre-classification of query difficulty (pre-classification)
 *   - buildEvidenceConstraint: per-query prompt injection (invented, not upstream)
 */

// ---------------------------------------------------------------------------
// Citation extraction
// ---------------------------------------------------------------------------

export interface IValidatedCitations {
  /** The model's markdown, returned unmodified. */
  readonly markdown: string;
  /** Citations actually referenced in the markdown — unreferenced ones filtered out. */
  readonly attributableSources: readonly { uri: string; label: string; index: number }[];
}

const CITATION_REF_RE = /\[(\d+)\]/g;

/**
 * Extract which ragSources were referenced in the model's markdown output.
 *
 * Upstream alignment: OpenClaw does not rewrite model output. This function
 * identifies referenced sources for UI display (citation chips) but does NOT
 * remap or modify the markdown. The model's output is returned as-is.
 */
export function validateCitations(
  markdown: string,
  ragSources: readonly { uri: string; label: string; index: number }[],
): IValidatedCitations {
  if (!markdown || ragSources.length === 0) {
    return { markdown, attributableSources: [] };
  }

  const validIndices = new Set(ragSources.map(s => s.index));
  const referencedValidIndices = new Set<number>();
  let match: RegExpExecArray | null;

  CITATION_REF_RE.lastIndex = 0;
  while ((match = CITATION_REF_RE.exec(markdown)) !== null) {
    const idx = parseInt(match[1], 10);
    if (validIndices.has(idx)) {
      referencedValidIndices.add(idx);
    }
  }

  const attributableSources = ragSources.filter(s => referencedValidIndices.has(s.index));

  return { markdown, attributableSources };
}
