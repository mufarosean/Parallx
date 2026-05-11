import type {
  IOpenclawSkillCatalogReportEntry,
  IOpenclawSkillPromptEntry,
} from '../services/chatRuntimeTypes.js';
import { buildSkillsSection, type ISkillEntry } from './openclawSystemPrompt.js';
import type { ISkillCatalogEntry } from './openclawTypes.js';

/**
 * Upstream parity (raw.githubusercontent.com/openclaw/openclaw/main):
 *   - src/agents/skills/workspace.ts `DEFAULT_MAX_SKILLS_IN_PROMPT = 150`
 *   - src/agents/skills/workspace.ts `DEFAULT_MAX_SKILLS_PROMPT_CHARS = 18_000`
 *   - src/agents/skills/workspace.ts `applySkillsPromptLimits` — try full,
 *     fall back to compact (name + location only), then binary-search the
 *     largest prefix that fits the char budget.
 */
const DEFAULT_MAX_SKILLS_IN_PROMPT = 150;
const DEFAULT_MAX_SKILLS_PROMPT_CHARS = 18_000;

export interface IOpenclawRuntimeSkillState {
  readonly catalog: readonly IOpenclawSkillCatalogReportEntry[];
  readonly promptEntries: readonly ISkillEntry[];
  readonly promptReportEntries: readonly IOpenclawSkillPromptEntry[];
  readonly totalCount: number;
  readonly visibleCount: number;
  readonly hiddenCount: number;
  /**
   * True when the section was emitted in compact form (description omitted)
   * because the full form exceeded `maxSkillsPromptChars`. Mirrors upstream
   * `applySkillsPromptLimits` `compact` flag.
   */
  readonly compact: boolean;
  /**
   * True when one or more visible skills were dropped from the prompt due to
   * `maxSkillsInPrompt` or `maxSkillsPromptChars` limits. Mirrors upstream
   * `applySkillsPromptLimits` `truncated` flag.
   */
  readonly truncated: boolean;
  /**
   * Warning line to prepend to the skills section when truncated/compact.
   * Empty string when neither flag is set. Mirrors upstream
   * `applySkillsPromptLimits` `truncationNote` text.
   */
  readonly truncationNote: string;
}

export interface IOpenclawSkillStateBuildOptions {
  /** Default 150, mirrors upstream `DEFAULT_MAX_SKILLS_IN_PROMPT`. */
  readonly maxSkillsInPrompt?: number;
  /** Default 18_000, mirrors upstream `DEFAULT_MAX_SKILLS_PROMPT_CHARS`. */
  readonly maxSkillsPromptChars?: number;
}

export function buildOpenclawRuntimeSkillState(
  catalog: readonly ISkillCatalogEntry[],
  opts?: IOpenclawSkillStateBuildOptions,
): IOpenclawRuntimeSkillState {
  const maxCount = Math.max(0, opts?.maxSkillsInPrompt ?? DEFAULT_MAX_SKILLS_IN_PROMPT);
  const maxChars = Math.max(0, opts?.maxSkillsPromptChars ?? DEFAULT_MAX_SKILLS_PROMPT_CHARS);

  const catalogEntries: IOpenclawSkillCatalogReportEntry[] = catalog.map((skill) => {
    const modelVisible = skill.kind === 'workflow' && skill.disableModelInvocation !== true;
    return {
      name: skill.name,
      kind: skill.kind,
      location: skill.location,
      modelVisible,
      modelVisibilityReason: modelVisible
        ? 'workflow-visible'
        : skill.kind !== 'workflow'
          ? 'non-workflow'
          : 'model-invocation-disabled',
    };
  });

  const visibleEntries: ISkillEntry[] = catalogEntries
    .filter((entry) => entry.modelVisible)
    .map((entry) => {
      const source = catalog.find((skill) => skill.name === entry.name);
      return {
        name: entry.name,
        description: source?.description ?? '',
        location: entry.location ?? '',
      };
    });

  // Upstream: agents/skills/workspace.ts applySkillsPromptLimits
  // 1. Apply count cap, 2. try full format, 3. drop to compact, 4. binary-search prefix.
  const visibleCount = visibleEntries.length;
  let candidates = visibleEntries.slice(0, maxCount);
  let truncated = visibleCount > candidates.length;
  let compact = false;

  if (maxChars > 0) {
    const fits = (entries: readonly ISkillEntry[], isCompact: boolean): boolean =>
      buildSkillsSection(entries, { compact: isCompact }).length <= maxChars;

    if (!fits(candidates, false)) {
      // Full format exceeds budget — try compact (mirrors upstream fallback).
      compact = true;
      if (!fits(candidates, true)) {
        // Compact still too large — binary-search largest fitting prefix.
        let lo = 0;
        let hi = candidates.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (fits(candidates.slice(0, mid), true)) {
            lo = mid;
          } else {
            hi = mid - 1;
          }
        }
        candidates = candidates.slice(0, lo);
        truncated = true;
      }
    }
  }

  // Upstream: agents/skills/workspace.ts resolveWorkspaceSkillPromptState `truncationNote`.
  const truncationNote = truncated
    ? `⚠️ Skills truncated: included ${candidates.length} of ${visibleCount}${compact ? ' (compact format, descriptions omitted)' : ''}.`
    : compact
      ? '⚠️ Skills catalog using compact format (descriptions omitted).'
      : '';

  const promptReportEntries: IOpenclawSkillPromptEntry[] = candidates.map((entry) => ({
    name: entry.name,
    location: entry.location,
    blockChars: compact
      ? `  <skill>\n    <name>${entry.name}</name>\n    <location>${entry.location}</location>\n  </skill>`.length
      : `  <skill>\n    <name>${entry.name}</name>\n    <description>${entry.description}</description>\n    <location>${entry.location}</location>\n  </skill>`.length,
  }));

  return {
    catalog: catalogEntries,
    promptEntries: candidates,
    promptReportEntries,
    totalCount: catalogEntries.length,
    visibleCount,
    hiddenCount: Math.max(0, catalogEntries.length - visibleCount),
    compact,
    truncated,
    truncationNote,
  };
}