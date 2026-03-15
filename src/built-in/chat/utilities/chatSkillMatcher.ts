// chatSkillMatcher.ts — Deterministic skill matching & activation (M39 Phase C)
//
// Matches user intent to a workflow skill using tag overlap + keyword matching.
// No LLM calls — purely deterministic and fast (< 10ms).

import type {
  ISkillCatalogEntry,
  ISkillMatchResult,
  IActivatedSkill,
  IChatTurnRoute,
  IQueryScope,
  WorkflowType,
} from '../chatTypes.js';
import type { ISkillManifest } from '../../../services/skillLoaderService.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Workflow → tag mapping
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Maps a WorkflowType to the tags a skill must have to be considered a match.
 * A skill matches if it has ALL required tags.
 */
const WORKFLOW_TAG_MAP: ReadonlyMap<WorkflowType, readonly string[]> = new Map([
  ['folder-summary',        ['workflow', 'summary']],
  ['document-summary',      ['workflow', 'summary']],
  ['exhaustive-extraction', ['workflow', 'extraction']],
  ['comparative',           ['workflow', 'comparison']],
  ['scoped-topic',          ['workflow', 'extraction']],
]);

/**
 * Minimum number of keyword overlaps required for a match
 * beyond tag matching.
 */
const MIN_KEYWORD_OVERLAP = 1;

// ═══════════════════════════════════════════════════════════════════════════════
// Public API
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Match user intent to a workflow skill using deterministic tag + keyword matching.
 *
 * Strategy:
 * 1. Map the route's `workflowType` to required skill tags
 * 2. Filter catalog to skills with all required tags
 * 3. Among tag-matched skills, score by keyword overlap with user text
 * 4. Return the best match, or `{ matched: false }` if none qualifies
 */
export function matchWorkflowSkill(
  userText: string,
  route: IChatTurnRoute,
  _scope: IQueryScope | undefined,
  catalog: readonly ISkillCatalogEntry[],
): ISkillMatchResult {
  // Only grounded routes with a workflow type can trigger skills
  if (route.kind !== 'grounded' || !route.workflowType) {
    return { matched: false, reason: 'Non-grounded route or no workflow type' };
  }

  const workflowType = route.workflowType;

  // generic-grounded and mixed don't map to skills
  if (workflowType === 'generic-grounded' || workflowType === 'mixed') {
    return { matched: false, reason: `Workflow type '${workflowType}' does not map to a skill` };
  }

  const requiredTags = WORKFLOW_TAG_MAP.get(workflowType);
  if (!requiredTags || requiredTags.length === 0) {
    return { matched: false, reason: `No tag mapping for workflow type '${workflowType}'` };
  }

  // Phase 1: Filter by required tags
  const tagMatches = catalog.filter(skill => {
    const skillTags = new Set(skill.tags.map(t => t.toLowerCase()));
    return requiredTags.every(t => skillTags.has(t.toLowerCase()));
  });

  if (tagMatches.length === 0) {
    return { matched: false, reason: `No skills have required tags [${requiredTags.join(', ')}]` };
  }

  // Phase 2: Score by keyword overlap with user text
  const userWords = _extractKeywords(userText);
  let bestSkill: ISkillCatalogEntry | undefined;
  let bestScore = 0;

  for (const skill of tagMatches) {
    const descWords = _extractKeywords(skill.description);
    const overlap = _countOverlap(userWords, descWords);
    if (overlap > bestScore) {
      bestScore = overlap;
      bestSkill = skill;
    }
  }

  if (!bestSkill || bestScore < MIN_KEYWORD_OVERLAP) {
    // Fall back to first tag-matched skill if keyword matching is inconclusive
    // This ensures tag-matched skills still activate even with terse user phrasing
    bestSkill = tagMatches[0];
    return {
      matched: true,
      skill: bestSkill,
      reason: `Tag match [${requiredTags.join(', ')}] for workflow '${workflowType}' (fallback — low keyword overlap)`,
    };
  }

  return {
    matched: true,
    skill: bestSkill,
    reason: `Tag match [${requiredTags.join(', ')}] + ${bestScore} keyword overlap(s) for workflow '${workflowType}'`,
  };
}

/**
 * Activate a matched skill: load full body and apply $ARGUMENTS substitution.
 */
export function activateSkill(
  manifest: ISkillManifest,
  userText: string,
  activatedBy: 'planner' | 'user',
  scope?: IQueryScope,
): IActivatedSkill {
  const resolvedBody = manifest.body.replaceAll('$ARGUMENTS', userText);
  return {
    manifest,
    resolvedBody,
    activatedBy,
    scope,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Internal helpers
// ═══════════════════════════════════════════════════════════════════════════════

/** Common stop words to exclude from keyword matching. */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'of', 'in', 'to',
  'for', 'with', 'on', 'at', 'by', 'from', 'up', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'own', 'same', 'than', 'too',
  'very', 'just', 'it', 'its', 'this', 'that', 'these', 'those',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his',
  'she', 'her', 'they', 'them', 'their', 'what', 'which', 'who',
  'whom', 'how', 'when', 'where', 'why',
]);

/**
 * Extract meaningful keywords from text, lowercased, stop words removed.
 */
function _extractKeywords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  return new Set(words.filter(w => !STOP_WORDS.has(w)));
}

/**
 * Count words in common between two keyword sets.
 */
function _countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const word of a) {
    if (b.has(word)) { count++; }
  }
  return count;
}
