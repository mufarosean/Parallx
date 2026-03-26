// chatSkillMatcher.ts — Skill activation (M39/M41)
//
// Activates a skill by resolving its body template with the user's text.
// Deterministic tag-based matching has been removed — skill selection is
// now model-directed via the <available_skills> catalog in the system prompt.

import type {
  IActivatedSkill,
  IQueryScope,
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
