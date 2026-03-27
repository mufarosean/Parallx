import { ChatMode, type IChatParticipantRequest, type IChatResponseStream, type IToolDefinition } from '../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IOpenclawBootstrapDebugReport,
  IOpenclawSystemPromptReport,
} from '../openclawTypes.js';
import {
  buildOpenclawBootstrapContext,
  loadOpenclawBootstrapEntries,
} from './openclawParticipantRuntime.js';
import type { IBootstrapFile, IOpenclawRuntimeInfo } from '../openclawSystemPrompt.js';
import { buildOpenclawRuntimeSkillState } from '../openclawSkillState.js';
import { buildOpenclawRuntimeToolState } from '../openclawToolState.js';
import { buildOpenclawPromptArtifacts as buildRuntimePromptArtifacts } from '../openclawPromptArtifacts.js';
import { resolveToolProfile } from '../openclawToolPolicy.js';

export type IOpenclawPromptArtifacts = {
  systemPrompt: string;
  bootstrapReport: IOpenclawBootstrapDebugReport;
  systemPromptReport: IOpenclawSystemPromptReport;
};

export async function buildOpenclawPromptArtifacts(
  services: Pick<
    IDefaultParticipantServices,
    | 'getActiveModel'
    | 'getWorkspaceName'
    | 'readFileRelative'
    | 'unifiedConfigService'
    | 'getToolDefinitions'
    | 'getReadOnlyToolDefinitions'
    | 'getSkillCatalog'
    | 'getToolPermissions'
    | 'getWorkspaceDigest'
  >,
  mode: ChatMode,
  source: 'run' | 'estimate',
): Promise<IOpenclawPromptArtifacts> {
  const workspaceName = services.getWorkspaceName();
  const bootstrapEntries = await loadOpenclawBootstrapEntries(
    services.readFileRelative
      ? async (relativePath: string) => services.readFileRelative!(relativePath)
      : undefined,
  );
  const { debug: bootstrapReport } = buildOpenclawBootstrapContext(bootstrapEntries);
  const bootstrapFiles: IBootstrapFile[] = bootstrapEntries
    .filter((entry) => !entry.missing && entry.content)
    .map((entry) => ({ name: entry.name, content: entry.content! }));
  const skillCatalog = services.getSkillCatalog?.() ?? [];
  const skillState = buildOpenclawRuntimeSkillState(skillCatalog);
  const toolState = buildOpenclawRuntimeToolState({
    platformTools: resolveToolDefinitions(services, mode),
    skillCatalog,
    mode: resolveToolProfile(mode),
    permissions: services.getToolPermissions?.(),
  });
  const runtimeInfo: IOpenclawRuntimeInfo = {
    model: services.getActiveModel?.() ?? 'unknown',
    provider: 'ollama',
    host: 'localhost',
    parallxVersion: '0.1.0',
  };
  const { systemPrompt, report } = buildRuntimePromptArtifacts({
    source,
    workspaceName,
    bootstrapFiles,
    bootstrapReport,
    workspaceDigest: (await services.getWorkspaceDigest?.()) ?? '',
    skillState,
    toolState,
    runtimeInfo,
  });

  return {
    systemPrompt,
    bootstrapReport,
    systemPromptReport: report,
  };
}

export async function tryHandleOpenclawContextCommand(
  services: Pick<
    IDefaultParticipantServices,
    | 'getActiveModel'
    | 'getWorkspaceName'
    | 'readFileRelative'
    | 'unifiedConfigService'
    | 'getToolDefinitions'
    | 'getReadOnlyToolDefinitions'
    | 'getSkillCatalog'
    | 'getToolPermissions'
    | 'getModelContextLength'
    | 'getLastSystemPromptReport'
    | 'reportSystemPromptReport'
    | 'getWorkspaceDigest'
  >,
  request: Pick<IChatParticipantRequest, 'command' | 'text' | 'mode'>,
  response: IChatResponseStream,
): Promise<{ handled: boolean; report?: IOpenclawSystemPromptReport }> {
  if (request.command !== 'context') {
    return { handled: false };
  }

  const args = request.text.trim();
  const sub = args.split(/\s+/).filter(Boolean)[0]?.toLowerCase() ?? '';

  if (!sub || sub === 'help') {
    response.markdown([
      '## /context',
      '',
      'Try:',
      '- `/context list` for the short breakdown',
      '- `/context detail` for per-skill and per-tool detail',
      '- `/context json` for the machine-readable report',
    ].join('\n'));
    return { handled: true };
  }

  if (sub !== 'list' && sub !== 'show' && sub !== 'detail' && sub !== 'deep' && sub !== 'json') {
    response.markdown([
      'Unknown `/context` mode.',
      'Use: `/context`, `/context list`, `/context detail`, or `/context json`.',
    ].join('\n'));
    return { handled: true };
  }

  const existingReport = services.getLastSystemPromptReport?.();
  const report = existingReport?.source === 'run'
    ? existingReport
    : (await buildOpenclawPromptArtifacts(services, request.mode, 'estimate')).systemPromptReport;

  if (!existingReport) {
    services.reportSystemPromptReport?.(report);
  }

  if (sub === 'json') {
    response.markdown('```json\n' + JSON.stringify(report, null, 2) + '\n```');
    return { handled: true, report };
  }

  response.markdown(formatContextReport(report, sub === 'detail' || sub === 'deep', services.getModelContextLength?.()));
  return { handled: true, report };
}

function formatContextReport(
  report: IOpenclawSystemPromptReport,
  detailed: boolean,
  contextWindow?: number,
): string {
  const skillNames = Array.from(new Set(report.skills.entries.map((entry) => entry.name)));
  const toolNames = report.tools.entries.map((entry) => entry.name);
  const lines: string[] = [
    detailed ? '🧠 Context breakdown (detailed)' : '🧠 Context breakdown',
    `Workspace: ${report.workspaceName ?? '(unknown)'}`,
    `Bootstrap max/file: ${formatInt(report.bootstrapMaxChars)} chars`,
    `Bootstrap max/total: ${formatInt(report.bootstrapTotalMaxChars)} chars`,
    `System prompt (${report.source}): ${formatCharsAndTokens(report.systemPrompt.chars)} (Project Context ${formatCharsAndTokens(report.systemPrompt.projectContextChars)})`,
  ];

  if (report.bootstrapWarningLines.length > 0) {
    lines.push('', `⚠ Bootstrap context is over configured limits: ${report.bootstrapWarningLines.length} warning line(s).`);
    for (const warningLine of report.bootstrapWarningLines) {
      lines.push(`- ${warningLine}`);
    }
  }

  lines.push('', 'Injected workspace files:');
  for (const file of report.injectedWorkspaceFiles) {
    lines.push(formatBootstrapFileLine(file));
  }

  lines.push(
    '',
    `Skills list (system prompt text): ${formatCharsAndTokens(report.skills.promptChars)} (${report.skills.visibleCount}/${report.skills.totalCount} visible)`,
    `Skills: ${formatNameList(skillNames, 20)}`,
    `Hidden skills: ${report.skills.hiddenCount}`,
    `Tool list (system prompt text): ${formatCharsAndTokens(report.tools.listChars)} (${report.tools.availableCount}/${report.tools.totalCount} available)`,
    `Tool schemas (JSON): ${formatCharsAndTokens(report.tools.schemaChars)} (counts toward context; not shown as text)`,
    `Skill-derived capabilities: ${report.tools.skillDerivedCount}`,
    `Filtered tools: ${report.tools.filteredCount}`,
    `Tools: ${formatNameList(toolNames, 30)}`,
  );

  if (report.promptProvenance) {
    lines.push(
      '',
      'Current turn provenance:',
      `- Raw user input: ${formatCharsAndTokens(report.promptProvenance.rawUserInput.length)}`,
      `- Parsed user text: ${formatCharsAndTokens(report.promptProvenance.parsedUserText.length)}`,
      `- Context query text: ${formatCharsAndTokens(report.promptProvenance.contextQueryText.length)}`,
      `- Participant: ${report.promptProvenance.participantId ?? '(default)'}`,
      `- Command: ${report.promptProvenance.command ?? '(none)'}`,
      `- Attachments: ${report.promptProvenance.attachmentCount}`,
      `- History turns seeded: ${report.promptProvenance.historyTurns}`,
      `- Model message count: ${report.promptProvenance.modelMessageCount}`,
      `- Model roles: ${report.promptProvenance.modelMessageRoles.join(', ')}`,
    );

    if (detailed) {
      lines.push(
        '',
        'Final current-user payload:',
        '```text',
        report.promptProvenance.finalUserMessage,
        '```',
      );
    }
  }

  if (detailed) {
    const topSkills = formatListTop(report.skills.entries.map((entry) => ({ name: entry.name, value: entry.blockChars })), 30);
    const topToolSchema = formatListTop(report.tools.entries.filter((entry) => entry.available).map((entry) => ({ name: entry.name, value: entry.schemaChars })), 30);
    const topToolSummary = formatListTop(report.tools.entries.filter((entry) => entry.available).map((entry) => ({ name: entry.name, value: entry.summaryChars })), 30);
    const toolParamLines = report.tools.entries
      .filter((entry) => entry.available && typeof entry.propertiesCount === 'number')
      .sort((left, right) => (right.propertiesCount ?? 0) - (left.propertiesCount ?? 0))
      .slice(0, 30)
      .map((entry) => `- ${entry.name}: ${entry.propertiesCount} params`);
    const filteredTools = report.tools.entries
      .filter((entry) => entry.exposed && !entry.available)
      .slice(0, 30)
      .map((entry) => `- ${entry.name} (${entry.source}${entry.skillLocation ? `; ${entry.skillLocation}` : ''}; ${entry.filteredReason ?? 'filtered'})`);

    if (topSkills.lines.length > 0) {
      lines.push('', 'Top skills (prompt entry size):', ...topSkills.lines);
      if (topSkills.omitted > 0) {
        lines.push(`… (+${topSkills.omitted} more skills)`);
      }
    }

    const hiddenSkills = report.skills.catalog
      .filter((entry) => !entry.modelVisible)
      .slice(0, 30)
      .map((entry) => `- ${entry.name} (${entry.kind}; ${entry.modelVisibilityReason})`);
    if (hiddenSkills.length > 0) {
      lines.push('', 'Hidden skills:', ...hiddenSkills);
      if (report.skills.hiddenCount > hiddenSkills.length) {
        lines.push(`… (+${report.skills.hiddenCount - hiddenSkills.length} more hidden skills)`);
      }
    }

    lines.push('', 'Top tools (schema size):', ...topToolSchema.lines);
    if (topToolSchema.omitted > 0) {
      lines.push(`… (+${topToolSchema.omitted} more tools)`);
    }

    lines.push('', 'Top tools (summary text size):', ...topToolSummary.lines);
    if (topToolSummary.omitted > 0) {
      lines.push(`… (+${topToolSummary.omitted} more tools)`);
    }

    if (toolParamLines.length > 0) {
      lines.push('', 'Tools (param count):', ...toolParamLines);
    }

    if (filteredTools.length > 0) {
      lines.push('', 'Filtered tools:', ...filteredTools);
      if (report.tools.filteredCount > filteredTools.length) {
        lines.push(`… (+${report.tools.filteredCount - filteredTools.length} more filtered tools)`);
      }
    }
  }

  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    lines.push('', `Context window: ${formatInt(contextWindow)} tok`);
  }

  return lines.join('\n');
}

function resolveToolDefinitions(
  services: Pick<IDefaultParticipantServices, 'getToolDefinitions' | 'getReadOnlyToolDefinitions'>,
  mode: ChatMode,
): readonly IToolDefinition[] {
  return mode === ChatMode.Edit
    ? services.getReadOnlyToolDefinitions()
    : services.getToolDefinitions();
}

function formatBootstrapFileLine(file: IOpenclawBootstrapDebugReport['files'][number]): string {
  const status = file.missing ? 'MISSING' : file.truncated ? 'TRUNCATED' : 'OK';
  const raw = file.missing ? '0' : formatCharsAndTokens(file.rawChars);
  const injected = file.missing ? '0' : formatCharsAndTokens(file.injectedChars);
  return `- ${file.name}: ${status} | raw ${raw} | injected ${injected}`;
}

function formatListTop(
  entries: Array<{ name: string; value: number }>,
  cap: number,
): { lines: string[]; omitted: number } {
  const sorted = [...entries].sort((left, right) => right.value - left.value);
  const top = sorted.slice(0, cap);
  return {
    lines: top.map((entry) => `- ${entry.name}: ${formatCharsAndTokens(entry.value)}`),
    omitted: Math.max(0, sorted.length - top.length),
  };
}

function formatNameList(names: string[], cap: number): string {
  if (names.length === 0) {
    return '(none)';
  }

  return names.length <= cap
    ? names.join(', ')
    : `${names.slice(0, cap).join(', ')}, ... (+${names.length - cap} more)`;
}

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / 4);
}

function formatInt(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCharsAndTokens(chars: number): string {
  return `${formatInt(chars)} chars (~${formatInt(estimateTokensFromChars(chars))} tok)`;
}