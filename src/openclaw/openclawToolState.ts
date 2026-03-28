import type { IToolDefinition } from '../services/chatTypes.js';
import type {
  IOpenclawToolCapabilityReportEntry,
  IOpenclawToolFilterReason,
} from '../services/chatRuntimeTypes.js';
import { applyOpenclawToolPolicy, isToolDeniedByProfile, type IToolPermissions, type OpenclawToolProfile } from './openclawToolPolicy.js';
import type { ISkillCatalogEntry } from './openclawTypes.js';
import type { IAgentToolsConfig } from './agents/openclawAgentConfig.js';

export interface IOpenclawRuntimeToolState {
  readonly exposedDefinitions: readonly IToolDefinition[];
  readonly availableDefinitions: readonly IToolDefinition[];
  readonly reportEntries: readonly IOpenclawToolCapabilityReportEntry[];
  readonly totalCount: number;
  readonly availableCount: number;
  readonly filteredCount: number;
  readonly skillDerivedCount: number;
}

export function buildOpenclawRuntimeToolState(input: {
  readonly platformTools: readonly IToolDefinition[];
  readonly skillCatalog: readonly ISkillCatalogEntry[];
  readonly mcpTools?: readonly IToolDefinition[];
  readonly mode: OpenclawToolProfile;
  readonly permissions?: IToolPermissions;
  readonly agentTools?: IAgentToolsConfig;
}): IOpenclawRuntimeToolState {
  const reportEntries: IOpenclawToolCapabilityReportEntry[] = [];
  const platformTools = dedupeToolDefinitions(input.platformTools);
  const platformNames = new Set(platformTools.map((tool) => tool.name));

  for (const tool of platformTools) {
    const filteredReason = getToolFilteredReason(tool, input.mode, input.permissions);
    reportEntries.push({
      name: tool.name,
      source: 'platform',
      summaryChars: tool.description.length,
      schemaChars: JSON.stringify(tool.parameters ?? {}).length,
      propertiesCount: countToolProperties(tool.parameters),
      exposed: true,
      available: filteredReason === undefined,
      filteredReason,
    });
  }

  const skillDefinitions: IToolDefinition[] = [];
  for (const skill of input.skillCatalog) {
    if (skill.kind !== 'tool') {
      continue;
    }

    if (platformNames.has(skill.name)) {
      reportEntries.push({
        name: skill.name,
        source: 'skill',
        skillLocation: skill.location,
        summaryChars: skill.description.length,
        schemaChars: JSON.stringify(buildToolParameters(skill)).length,
        propertiesCount: countSkillParameters(skill),
        exposed: false,
        available: false,
        filteredReason: 'name-collision',
      });
      continue;
    }

    const toolDefinition = buildToolDefinitionFromSkillCatalogEntry(skill);
    const filteredReason = getToolFilteredReason(toolDefinition, input.mode, input.permissions);
    reportEntries.push({
      name: toolDefinition.name,
      source: 'skill',
      skillLocation: skill.location,
      summaryChars: toolDefinition.description.length,
      schemaChars: JSON.stringify(toolDefinition.parameters ?? {}).length,
      propertiesCount: countToolProperties(toolDefinition.parameters),
      exposed: true,
      available: filteredReason === undefined,
      filteredReason,
    });
    skillDefinitions.push(toolDefinition);
  }

  // MCP tools (D1)
  const mcpDefinitions: IToolDefinition[] = [];
  if (input.mcpTools) {
    for (const tool of input.mcpTools) {
      if (platformNames.has(tool.name)) {
        reportEntries.push({
          name: tool.name,
          source: 'mcp',
          summaryChars: tool.description.length,
          schemaChars: JSON.stringify(tool.parameters ?? {}).length,
          propertiesCount: countToolProperties(tool.parameters),
          exposed: false,
          available: false,
          filteredReason: 'name-collision',
        });
        continue;
      }
      const filteredReason = getToolFilteredReason(tool, input.mode, input.permissions);
      reportEntries.push({
        name: tool.name,
        source: 'mcp',
        summaryChars: tool.description.length,
        schemaChars: JSON.stringify(tool.parameters ?? {}).length,
        propertiesCount: countToolProperties(tool.parameters),
        exposed: true,
        available: filteredReason === undefined,
        filteredReason,
      });
      mcpDefinitions.push(tool);
    }
  }

  const exposedDefinitions = [...platformTools, ...skillDefinitions, ...mcpDefinitions];
  const availableDefinitions = applyOpenclawToolPolicy({
    tools: exposedDefinitions,
    mode: input.mode,
    permissions: input.permissions,
    agentTools: input.agentTools,
  });

  return {
    exposedDefinitions,
    availableDefinitions,
    reportEntries,
    totalCount: reportEntries.filter((entry) => entry.exposed).length,
    availableCount: reportEntries.filter((entry) => entry.exposed && entry.available).length,
    filteredCount: reportEntries.filter((entry) => entry.exposed && !entry.available).length,
    skillDerivedCount: reportEntries.filter((entry) => entry.source === 'skill' && entry.exposed).length,
  };
}

export function buildToolDefinitionFromSkillCatalogEntry(skill: ISkillCatalogEntry): IToolDefinition {
  return {
    name: skill.name,
    description: skill.description,
    parameters: buildToolParameters(skill),
  };
}

function buildToolParameters(skill: ISkillCatalogEntry): Record<string, unknown> {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];

  for (const param of skill.parameters ?? []) {
    properties[param.name] = {
      type: param.type,
      description: param.description,
    };
    if (param.required) {
      required.push(param.name);
    }
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

function dedupeToolDefinitions(tools: readonly IToolDefinition[]): IToolDefinition[] {
  const seen = new Set<string>();
  const unique: IToolDefinition[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      continue;
    }
    seen.add(tool.name);
    unique.push(tool);
  }
  return unique;
}

function getToolFilteredReason(
  tool: IToolDefinition,
  mode: OpenclawToolProfile,
  permissions?: IToolPermissions,
): IOpenclawToolFilterReason | undefined {
  const allowed = applyOpenclawToolPolicy({
    tools: [tool],
    mode,
    permissions,
  });
  if (allowed.length > 0) {
    return undefined;
  }
  if (permissions?.[tool.name] === 'never-allowed') {
    return 'permission-never-allowed';
  }
  if (isToolDeniedByProfile(tool.name, mode)) {
    return 'tool-profile-deny';
  }
  return 'tool-profile-not-allowed';
}

function countToolProperties(schema: unknown): number | undefined {
  if (!schema || typeof schema !== 'object') {
    return undefined;
  }
  const properties = (schema as { properties?: Record<string, unknown> }).properties;
  return properties ? Object.keys(properties).length : undefined;
}

function countSkillParameters(skill: ISkillCatalogEntry): number {
  return skill.parameters?.length ?? 0;
}