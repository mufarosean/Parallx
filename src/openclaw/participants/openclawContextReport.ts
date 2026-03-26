import { ChatMode, type IChatParticipantRequest, type IChatResponseStream, type IToolDefinition } from '../../services/chatTypes.js';
import type {
  IDefaultParticipantServices,
  IOpenclawBootstrapDebugFile,
  IOpenclawBootstrapDebugReport,
  IOpenclawSkillPromptEntry,
  IOpenclawSystemPromptReport,
  IOpenclawToolPromptEntry,
} from '../openclawTypes.js';
import {
  buildOpenclawBootstrapContext,
  loadOpenclawBootstrapEntries,
} from './openclawParticipantRuntime.js';

export type IOpenclawPromptArtifacts = {
  systemPrompt: string;
  bootstrapReport: IOpenclawBootstrapDebugReport;
  systemPromptReport: IOpenclawSystemPromptReport;
};

export async function buildOpenclawPromptArtifacts(
  services: Pick<
    IDefaultParticipantServices,
    | 'getWorkspaceName'
    | 'readFileRelative'
    | 'unifiedConfigService'
    | 'getToolDefinitions'
    | 'getReadOnlyToolDefinitions'
    | 'getWorkflowSkillCatalog'
  >,
  mode: ChatMode,
  source: 'run' | 'estimate',
): Promise<IOpenclawPromptArtifacts> {
  const workspaceName = services.getWorkspaceName();
  const workspaceDescription = services.unifiedConfigService?.getEffectiveConfig().chat.workspaceDescription?.trim();
  const bootstrapFiles = await loadOpenclawBootstrapEntries(
    services.readFileRelative
      ? async (relativePath: string) => services.readFileRelative!(relativePath)
      : undefined,
  );
  const { sections: bootstrapSections, debug: bootstrapReport } = buildOpenclawBootstrapContext(bootstrapFiles);
  const skills = buildSkillsPrompt(services);
  const tools = buildToolsPrompt(resolveToolDefinitions(services, mode));

  const systemPromptSections: string[] = [
    'You are the OpenClaw runtime lane inside Parallx.',
    'Treat workspace files as the authoritative state. Use tools when the answer depends on current workspace contents instead of inventing state.',
    'Keep responses grounded and concise. If evidence is missing, say so clearly.',
    `Workspace: ${workspaceName}`,
  ];

  if (workspaceDescription) {
    systemPromptSections.push(`Workspace description: ${workspaceDescription}`);
  }

  if (mode === ChatMode.Edit) {
    systemPromptSections.push(
      'Edit mode is for structured canvas changes. Use read-only tools to gather context, then respond with structured edit proposals.',
    );
  } else {
    // Ask + Agent — both have full tools with approval gates
    const autonomyNote = mode === ChatMode.Agent
      ? 'Agent mode unlocks longer autonomous runs and approval-aware changes.'
      : 'Use tools proactively to gather evidence and take action. Write operations require user approval.';
    systemPromptSections.push(
      `Modes gate authority, not wakefulness. ${autonomyNote}`,
    );
  }

  systemPromptSections.push(
    '## Retrieved Context Contract',
    'When the user message contains a [Retrieved Context] block, treat those snippets as grounded workspace evidence that has already been fetched for this turn.',
    'If the retrieved snippets clearly answer the question, answer from them directly instead of claiming the file is missing or unavailable.',
    'Do not infer missing evidence from a filename or section title alone. If a retrieved snippet contains the needed facts, use it.',
    'For file counts, directory listings, or exact workspace inventory questions, verify with tools instead of relying on retrieved snippets alone.',
    'Preserve exact counts and quantities from retrieved evidence, including file totals, step totals, and sentence counts, instead of paraphrasing them away.',
    'If a retrieved source is brief, partial, or stub-like, say that explicitly instead of padding the answer with fuller-sounding content.',
    'When quoting phone numbers, policy numbers, percentages, thresholds, VINs, or other identifiers from evidence, preserve the source formatting exactly. Do not replace ASCII punctuation with typographic dashes or narrow spaces.',
    'If you use retrieved snippets in the answer, cite them with exact [N] markers that match the numbered sources in the [Retrieved Context] block. Do not invent other citation formats.',
    '# Project Context',
    'The following project context files have been loaded:',
    ...bootstrapSections,
  );

  if (skills.prompt) {
    systemPromptSections.push(
      '## Skills',
      'When a listed workflow skill clearly matches the request, prefer that skill-guided workflow over ad hoc reasoning.',
      skills.prompt,
    );
  }

  if (tools.listText) {
    systemPromptSections.push(
      '## Tools',
      'Tool names are case-sensitive. Call tools exactly as listed.',
      'When a first-class tool exists for an action, use the tool directly instead of narrating manual steps.',
      tools.listText,
      'TOOLS.md does not control tool availability; it is user guidance for how to use external tools.',
    );
  }

  const systemPrompt = systemPromptSections.join('\n\n');
  const projectContextChars = [
    'The following project context files have been loaded:',
    ...bootstrapSections,
  ].join('\n\n').length;

  return {
    systemPrompt,
    bootstrapReport,
    systemPromptReport: {
      source,
      generatedAt: Date.now(),
      workspaceName,
      bootstrapMaxChars: bootstrapReport.maxChars,
      bootstrapTotalMaxChars: bootstrapReport.totalMaxChars,
      systemPrompt: {
        chars: systemPrompt.length,
        projectContextChars,
        nonProjectContextChars: Math.max(0, systemPrompt.length - projectContextChars),
      },
      injectedWorkspaceFiles: bootstrapReport.files,
      bootstrapWarningLines: bootstrapReport.warningLines,
      skills: {
        promptChars: skills.prompt.length,
        entries: skills.entries,
      },
      tools: {
        listChars: tools.listText.length,
        schemaChars: tools.entries.reduce((sum, entry) => sum + entry.schemaChars, 0),
        entries: tools.entries,
      },
    },
  };
}

export async function tryHandleOpenclawContextCommand(
  services: Pick<
    IDefaultParticipantServices,
    | 'getWorkspaceName'
    | 'readFileRelative'
    | 'unifiedConfigService'
    | 'getToolDefinitions'
    | 'getReadOnlyToolDefinitions'
    | 'getWorkflowSkillCatalog'
    | 'getModelContextLength'
    | 'getLastSystemPromptReport'
    | 'reportSystemPromptReport'
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
    `Skills list (system prompt text): ${formatCharsAndTokens(report.skills.promptChars)} (${skillNames.length} skills)`,
    `Skills: ${formatNameList(skillNames, 20)}`,
    `Tool list (system prompt text): ${formatCharsAndTokens(report.tools.listChars)}`,
    `Tool schemas (JSON): ${formatCharsAndTokens(report.tools.schemaChars)} (counts toward context; not shown as text)`,
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
    const topToolSchema = formatListTop(report.tools.entries.map((entry) => ({ name: entry.name, value: entry.schemaChars })), 30);
    const topToolSummary = formatListTop(report.tools.entries.map((entry) => ({ name: entry.name, value: entry.summaryChars })), 30);
    const toolParamLines = report.tools.entries
      .filter((entry) => typeof entry.propertiesCount === 'number')
      .sort((left, right) => (right.propertiesCount ?? 0) - (left.propertiesCount ?? 0))
      .slice(0, 30)
      .map((entry) => `- ${entry.name}: ${entry.propertiesCount} params`);

    if (topSkills.lines.length > 0) {
      lines.push('', 'Top skills (prompt entry size):', ...topSkills.lines);
      if (topSkills.omitted > 0) {
        lines.push(`… (+${topSkills.omitted} more skills)`);
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
  }

  if (typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0) {
    lines.push('', `Context window: ${formatInt(contextWindow)} tok`);
  }

  return lines.join('\n');
}

function buildSkillsPrompt(
  services: Pick<IDefaultParticipantServices, 'getWorkflowSkillCatalog'>,
): { prompt: string; entries: IOpenclawSkillPromptEntry[] } {
  const catalog = services.getWorkflowSkillCatalog?.() ?? [];
  const entries = catalog
    .filter((skill) => skill.kind === 'workflow')
    .map((skill) => {
      const block = `- ${skill.name}: ${skill.description}`;
      return {
        name: skill.name,
        blockChars: block.length,
      };
    });

  return {
    prompt: catalog
      .filter((skill) => skill.kind === 'workflow')
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n'),
    entries,
  };
}

function buildToolsPrompt(
  toolDefinitions: readonly IToolDefinition[],
): { listText: string; entries: IOpenclawToolPromptEntry[] } {
  const entries = toolDefinitions.map((tool) => ({
    name: tool.name,
    summaryChars: tool.description.length,
    schemaChars: JSON.stringify(tool.parameters ?? {}).length,
    propertiesCount: countToolProperties(tool.parameters),
  }));

  return {
    listText: toolDefinitions.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n'),
    entries,
  };
}

function resolveToolDefinitions(
  services: Pick<IDefaultParticipantServices, 'getToolDefinitions' | 'getReadOnlyToolDefinitions'>,
  mode: ChatMode,
): readonly IToolDefinition[] {
  return mode === ChatMode.Edit
    ? services.getReadOnlyToolDefinitions()
    : services.getToolDefinitions();
}

function countToolProperties(parameters: Record<string, unknown>): number | undefined {
  const properties = parameters?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return undefined;
  }
  return Object.keys(properties as Record<string, unknown>).length;
}

function formatBootstrapFileLine(file: IOpenclawBootstrapDebugFile): string {
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