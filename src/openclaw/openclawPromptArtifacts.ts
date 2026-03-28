import type {
  IOpenclawBootstrapDebugReport,
  IOpenclawSystemPromptReport,
} from '../services/chatRuntimeTypes.js';
import {
  buildOpenclawSystemPrompt,
  buildSkillsSection,
  buildToolSummariesSection,
  buildWorkspaceSection,
  type IBootstrapFile,
  type IOpenclawRuntimeInfo,
} from './openclawSystemPrompt.js';
import type { IOpenclawRuntimeSkillState } from './openclawSkillState.js';
import type { IOpenclawRuntimeToolState } from './openclawToolState.js';
import type { IAgentIdentityConfig } from './agents/openclawAgentConfig.js';

export interface IOpenclawPromptArtifactInput {
  readonly source: 'run' | 'estimate';
  readonly workspaceName?: string;
  readonly bootstrapFiles: readonly IBootstrapFile[];
  readonly bootstrapReport: IOpenclawBootstrapDebugReport;
  readonly workspaceDigest: string;
  readonly skillState: IOpenclawRuntimeSkillState;
  readonly toolState: IOpenclawRuntimeToolState;
  readonly runtimeInfo: IOpenclawRuntimeInfo;
  readonly systemPromptAddition?: string;
  readonly preferencesPrompt?: string;
  readonly promptOverlay?: string;
  readonly promptProvenance?: IOpenclawSystemPromptReport['promptProvenance'];
  /** M42: Model tier for conditional guidance (small/medium/large). */
  readonly modelTier?: 'small' | 'medium' | 'large';
  /** Whether the model supports native tool calling (orthogonal to tool count). */
  readonly supportsTools?: boolean;
  /** Token budget for system prompt (typically 10% of context window). */
  readonly systemBudgetTokens?: number;
  /** D8: Per-agent identity overlay. */
  readonly agentIdentity?: IAgentIdentityConfig;
  /** D8: Per-agent system prompt overlay text. */
  readonly agentSystemPromptOverlay?: string;
}

export function buildOpenclawPromptArtifacts(
  input: IOpenclawPromptArtifactInput,
): { systemPrompt: string; report: IOpenclawSystemPromptReport } {
  const toolSummaries = input.toolState.availableDefinitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));

  const systemPrompt = buildOpenclawSystemPrompt({
    bootstrapFiles: input.bootstrapFiles,
    workspaceDigest: input.workspaceDigest,
    skills: input.skillState.promptEntries,
    tools: toolSummaries,
    runtimeInfo: input.runtimeInfo,
    systemPromptAddition: input.systemPromptAddition,
    preferencesPrompt: input.preferencesPrompt,
    promptOverlay: input.promptOverlay,
    modelTier: input.modelTier,
    supportsTools: input.supportsTools ?? input.toolState.availableDefinitions.length > 0,
    systemBudgetTokens: input.systemBudgetTokens,
    agentIdentity: input.agentIdentity,
    agentSystemPromptOverlay: input.agentSystemPromptOverlay,
  });

  const workspaceSection = buildWorkspaceSection(input.bootstrapFiles, input.workspaceDigest);
  const skillsSection = input.skillState.promptEntries.length > 0
    ? buildSkillsSection(input.skillState.promptEntries)
    : '';
  const toolSection = input.toolState.availableDefinitions.length > 0
    ? buildToolSummariesSection(toolSummaries)
    : '';

  return {
    systemPrompt,
    report: {
      source: input.source,
      generatedAt: Date.now(),
      workspaceName: input.workspaceName,
      promptText: systemPrompt,
      bootstrapMaxChars: input.bootstrapReport.maxChars,
      bootstrapTotalMaxChars: input.bootstrapReport.totalMaxChars,
      systemPrompt: {
        chars: systemPrompt.length,
        projectContextChars: workspaceSection.length,
        nonProjectContextChars: Math.max(0, systemPrompt.length - workspaceSection.length),
      },
      injectedWorkspaceFiles: input.bootstrapReport.files,
      bootstrapWarningLines: input.bootstrapReport.warningLines,
      skills: {
        promptChars: skillsSection.length,
        totalCount: input.skillState.totalCount,
        visibleCount: input.skillState.visibleCount,
        hiddenCount: input.skillState.hiddenCount,
        entries: input.skillState.promptReportEntries,
        catalog: input.skillState.catalog,
      },
      tools: {
        listChars: toolSection.length,
        schemaChars: input.toolState.availableDefinitions.reduce((sum, tool) => sum + JSON.stringify(tool.parameters ?? {}).length, 0),
        totalCount: input.toolState.totalCount,
        availableCount: input.toolState.availableCount,
        filteredCount: input.toolState.filteredCount,
        skillDerivedCount: input.toolState.skillDerivedCount,
        entries: input.toolState.reportEntries,
      },
      promptProvenance: input.promptProvenance,
    },
  };
}
