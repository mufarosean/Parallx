import type {
  IOpenclawSkillCatalogReportEntry,
  IOpenclawSkillPromptEntry,
} from '../services/chatRuntimeTypes.js';
import type { ISkillEntry } from './openclawSystemPrompt.js';
import type { ISkillCatalogEntry } from './openclawTypes.js';

export interface IOpenclawRuntimeSkillState {
  readonly catalog: readonly IOpenclawSkillCatalogReportEntry[];
  readonly promptEntries: readonly ISkillEntry[];
  readonly promptReportEntries: readonly IOpenclawSkillPromptEntry[];
  readonly totalCount: number;
  readonly visibleCount: number;
  readonly hiddenCount: number;
}

export function buildOpenclawRuntimeSkillState(
  catalog: readonly ISkillCatalogEntry[],
): IOpenclawRuntimeSkillState {
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

  const promptEntries: ISkillEntry[] = catalogEntries
    .filter((entry) => entry.modelVisible)
    .map((entry) => {
      const source = catalog.find((skill) => skill.name === entry.name);
      return {
        name: entry.name,
        description: source?.description ?? '',
        location: entry.location ?? '',
      };
    });

  const promptReportEntries: IOpenclawSkillPromptEntry[] = promptEntries.map((entry) => ({
    name: entry.name,
    location: entry.location,
    blockChars: `<skill><name>${entry.name}</name><description>${entry.description}</description><location>${entry.location}</location></skill>`.length,
  }));

  return {
    catalog: catalogEntries,
    promptEntries,
    promptReportEntries,
    totalCount: catalogEntries.length,
    visibleCount: promptEntries.length,
    hiddenCount: Math.max(0, catalogEntries.length - promptEntries.length),
  };
}