// chatSkillMatcher.ts — Skill activation (M39/M41/M45)
//
// Activates a skill by resolving its body template with the user's text.
// Supports both slash-command activation and free-text skill detection.
//
// Free-text detection (M45): When the user says "use the X skill" or similar,
// detect the skill name from the text and activate it — matching the upstream
// OpenClaw pattern where skills are activated before the model sees the turn.

import type {
  IActivatedSkill,
  IQueryScope,
  ISkillCatalogEntry,
} from '../chatTypes.js';
import type { ISkillManifest } from '../../../services/skillLoaderService.js';

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

/**
 * Detect a skill name mentioned in free-text input.
 *
 * Matches phrases like:
 *   - "use the deep-research skill"
 *   - "run the fact-check skill"
 *   - "follow the deep-research skill"
 *   - "apply the summarize skill"
 *   - "use deep-research skill"
 *
 * Returns the matched skill name or undefined if no skill was mentioned.
 */
export function detectFreeTextSkillName(
  text: string,
  catalog: readonly ISkillCatalogEntry[],
): string | undefined {
  if (catalog.length === 0) { return undefined; }

  const lower = text.toLowerCase();

  // Build a set of known skill names for matching
  const skillNames = catalog.map(s => s.name.toLowerCase());

  // Pattern: "use/run/follow/apply/execute (the) <skill-name> (skill/workflow)"
  for (const skillName of skillNames) {
    // Escape regex special characters in skill names
    const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `\\b(?:use|run|follow|apply|execute|activate|invoke|try)\\s+(?:the\\s+)?${escaped}(?:\\s+(?:skill|workflow))?\\b`,
      'i',
    );
    if (pattern.test(lower)) {
      // Return the original-cased name from the catalog
      const entry = catalog.find(s => s.name.toLowerCase() === skillName);
      if (entry) { return entry.name; }
    }
  }

  // Pattern: "<skill-name> skill" (e.g. "deep-research skill")
  for (const skillName of skillNames) {
    const escaped = skillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escaped}\\s+skill\\b`, 'i');
    if (pattern.test(lower)) {
      const entry = catalog.find(s => s.name.toLowerCase() === skillName);
      if (entry) { return entry.name; }
    }
  }

  return undefined;
}
