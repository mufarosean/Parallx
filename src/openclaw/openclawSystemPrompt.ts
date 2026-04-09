/**
 * Structured system prompt builder for the OpenClaw execution pipeline.
 *
 * Upstream evidence:
 *   - agents/system-prompt.ts:110-400 — buildAgentSystemPrompt: ~30 params, multi-section output
 *   - agents/skills/workspace.ts:633-724 — XML skill entries with mandatory scan instruction
 *   - pi-embedded-runner/system-prompt.ts:74 — buildToolSummaryMap: Record<name, description>
 *   - agents/bootstrap-files.ts:47-118 — resolveBootstrapContextForRun: per-file/total budget
 *
 * Parallx adaptation:
 *   - M11: Prompt file layering SOUL.md → AGENTS.md → TOOLS.md → rules/
 *   - M11: Workspace digest (~2000 tokens) included
 *   - M11: Small model guidance (behavioral rules)
 *   - M9: Token estimation chars / 4
 */

import { estimateTokens, trimTextToBudget } from './openclawTokenBudget.js';
import type { IAgentIdentityConfig } from './agents/openclawAgentConfig.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IBootstrapFile {
  readonly name: string;
  readonly content: string;
}

export interface ISkillEntry {
  readonly name: string;
  readonly description: string;
  readonly location: string;
}

export interface IToolSummary {
  readonly name: string;
  readonly description: string;
}

export interface IOpenclawRuntimeInfo {
  readonly model: string;
  readonly provider: string;
  readonly host: string;
  readonly parallxVersion: string;
  readonly os?: string;
  readonly arch?: string;
  readonly shell?: string;
}

export interface IOpenclawSystemPromptParams {
  /** Bootstrap files: AGENTS.md, SOUL.md, TOOLS.md content (loaded via platform) */
  readonly bootstrapFiles: readonly IBootstrapFile[];
  /** Pre-computed workspace summary (~2000 tokens, M11) */
  readonly workspaceDigest: string;
  /** Skill entries from the skill catalog */
  readonly skills: readonly ISkillEntry[];
  /** Tool name + description pairs for prompt injection */
  readonly tools: readonly IToolSummary[];
  /** Runtime metadata */
  readonly runtimeInfo: IOpenclawRuntimeInfo;
  /** Additional system prompt content from context engine assemble() */
  readonly systemPromptAddition?: string;
  /** User preferences from preference extraction */
  readonly preferencesPrompt?: string;
  /** Prompt overlay from active file pattern rules */
  readonly promptOverlay?: string;
  /** M42: Model tier derived from parameter size — adjusts behavioral guidance */
  readonly modelTier?: 'small' | 'medium' | 'large';
  /** M42: Whether the model supports tool calling */
  readonly supportsTools?: boolean;
  /** D5: Whether the model supports vision/image input */
  readonly supportsVision?: boolean;
  /** Whether this turn has explicit file or selection attachments. */
  readonly hasExplicitAttachments?: boolean;
  /** Token budget for system prompt (typically 10% of context window).
   *  When set, variable sections are truncated if total exceeds budget. */
  readonly systemBudgetTokens?: number;
  /** D8: Per-agent identity overlay. */
  readonly agentIdentity?: IAgentIdentityConfig;
  /** D8: Per-agent system prompt overlay text. */
  readonly agentSystemPromptOverlay?: string;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the structured system prompt.
 *
 * Sections follow upstream buildAgentSystemPrompt structure:
 *   1. Skills (XML-tagged, mandatory scan instruction)
 *   2. Tool summaries (name + one-line description)
 *   3. Workspace context (bootstrap files + digest)
 *   4. Context engine addition (from AssembleResult)
 *   5. Preferences & overlays
 *   6. Runtime metadata
 *   7. Conditional guidance (small model, no-tools, vision, attachments)
 *
 * Identity, safety, and response guidelines are now in SOUL.md (bootstrap).
 */
export function buildOpenclawSystemPrompt(params: IOpenclawSystemPromptParams): string {
  const sections: string[] = [];

  // 1. Skills (upstream: agents/system-prompt.ts lines 20-37)
  if (params.skills.length > 0) {
    sections.push(buildSkillsSection(params.skills));
  }

  // 3. Tool summaries (upstream: buildToolSummaryMap in pi-embedded-runner/system-prompt.ts)
  if (params.tools.length > 0) {
    sections.push(buildToolSummariesSection(params.tools));
  }

  // 4. Workspace context (upstream: bootstrap files + context files)
  sections.push(buildWorkspaceSection(params.bootstrapFiles, params.workspaceDigest));

  // 5. Context engine addition (upstream: systemPromptAddition from AssembleResult)
  //    Parallx adaptation: kept at position 5 (after workspace context, before preferences)
  //    rather than upstream's end-of-prompt position. Context engine output is semantically
  //    closest to workspace context, and placing it here keeps the prompt flow coherent
  //    for local models that weight earlier prompt content more heavily.
  if (params.systemPromptAddition) {
    sections.push(params.systemPromptAddition);
  }

  // 6. Preferences & overlay (Parallx: user preferences + file-pattern rules)
  if (params.preferencesPrompt) {
    sections.push(`## User Preferences\n${params.preferencesPrompt}`);
  }
  if (params.promptOverlay) {
    sections.push(`## Active Rules\n${params.promptOverlay}`);
  }

  // 6b. D8: Agent identity overlay (per-agent personality)
  if (params.agentIdentity) {
    const identityParts: string[] = [];
    if (params.agentIdentity.name) {
      identityParts.push(`Name: ${params.agentIdentity.name}`);
    }
    if (params.agentIdentity.theme) {
      identityParts.push(`Theme: ${params.agentIdentity.theme}`);
    }
    if (params.agentIdentity.emoji) {
      identityParts.push(`Emoji: ${params.agentIdentity.emoji}`);
    }
    if (identityParts.length > 0) {
      sections.push(`## Agent Identity\n${identityParts.join('\n')}`);
    }
  }

  // 6c. D8: Agent system prompt overlay (per-agent instructions)
  if (params.agentSystemPromptOverlay) {
    sections.push(`## Agent Instructions\n${params.agentSystemPromptOverlay}`);
  }

  // 7. Runtime metadata (upstream: runtimeInfo section)
  sections.push(buildRuntimeSection(params.runtimeInfo));

  // 8. M42: Model-tier-specific guidance
  if (params.modelTier === 'small') {
    sections.push(buildSmallModelGuidance());
  }

  // 9. M42: No-tools fallback note
  if (params.supportsTools === false) {
    sections.push(buildNoToolsFallbackNote());
  }

  // 10. D5: Vision model guidance
  if (params.supportsVision) {
    sections.push(buildVisionGuidanceSection());
  }

  // 11. File attachment guidance (when user explicitly attaches files/selections)
  if (params.hasExplicitAttachments) {
    sections.push(buildAttachmentGuidanceSection());
  }

  let result = sections.join('\n\n');

  // Budget-aware truncation: if total exceeds systemBudgetTokens,
  // truncate variable sections (workspace context first, then tool summaries).
  if (params.systemBudgetTokens && params.systemBudgetTokens > 0) {
    const currentTokens = estimateTokens(result);
    if (currentTokens > params.systemBudgetTokens) {
      result = truncateSystemPromptToBudget(sections, params.systemBudgetTokens);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

/**
 * Skills section following upstream XML pattern.
 *
 * Upstream: agents/system-prompt.ts lines 20-37
 * Pattern: XML-tagged entries with mandatory scan instruction.
 */
export function buildSkillsSection(skills: readonly ISkillEntry[]): string {
  const entries = skills
    .map(s => `<skill><name>${escapeXml(s.name)}</name><description>${escapeXml(s.description)}</description><location>${escapeXml(s.location)}</location></skill>`)
    .join('\n');

  return `## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> using read_file, then follow its instructions step by step.
- If the user explicitly names a skill (e.g. "use the X skill"): read that skill's SKILL.md at <location> using read_file, then follow its instructions.
- If multiple could apply: choose the most specific one.
- If none clearly apply: do not read any SKILL.md.
- NEVER describe a skill's instructions from memory or the description alone — always read the actual SKILL.md file first.
Constraints: never read more than one skill up front; only read after selecting.
When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight one-item loops, serialize bursts when possible, and respect 429/Retry-After.
<available_skills>
${entries}
</available_skills>`;
}

/**
 * Tool summaries section.
 *
 * Upstream: buildToolSummaryMap in pi-embedded-runner/system-prompt.ts line 74
 * One line per tool: name + description. This supplements the API tool schema
 * with human-readable context in the prompt text.
 *
 * Tools are grouped by domain so the model can distinguish canvas page tools
 * from file system tools, memory tools, etc.
 */

/** Domain groups — order determines section order in the prompt. */
const TOOL_GROUPS: readonly { readonly heading: string; readonly names: ReadonlySet<string> }[] = [
  {
    heading: 'Canvas Pages',
    names: new Set([
      'search_workspace', 'read_page', 'read_current_page', 'list_pages',
      'get_page_properties', 'create_page', 'list_property_definitions',
      'set_page_property', 'find_pages_by_property',
    ]),
  },
  {
    heading: 'Workspace Files',
    names: new Set(['list_files', 'read_file', 'search_files', 'grep_search']),
  },
  {
    heading: 'Knowledge Index',
    names: new Set(['search_knowledge']),
  },
  {
    heading: 'Memory',
    names: new Set(['memory_get', 'memory_search']),
  },
  {
    heading: 'Session Transcripts',
    names: new Set(['transcript_get', 'transcript_search']),
  },
  {
    heading: 'File Editing',
    names: new Set(['write_file', 'edit_file', 'delete_file']),
  },
  {
    heading: 'Terminal',
    names: new Set(['run_command']),
  },
];

export function buildToolSummariesSection(tools: readonly IToolSummary[]): string {
  const grouped = new Map<string, IToolSummary[]>();
  const ungrouped: IToolSummary[] = [];

  for (const tool of tools) {
    let placed = false;
    for (const group of TOOL_GROUPS) {
      if (group.names.has(tool.name)) {
        let arr = grouped.get(group.heading);
        if (!arr) { arr = []; grouped.set(group.heading, arr); }
        arr.push(tool);
        placed = true;
        break;
      }
    }
    if (!placed) { ungrouped.push(tool); }
  }

  const parts: string[] = [];
  for (const group of TOOL_GROUPS) {
    const items = grouped.get(group.heading);
    if (items && items.length > 0) {
      parts.push(`### ${group.heading}`);
      for (const t of items) { parts.push(`- ${t.name}: ${t.description}`); }
    }
  }
  // MCP tools, extension tools, or any future tools that don't match a group
  if (ungrouped.length > 0) {
    if (parts.length > 0) { parts.push('### Other'); }
    for (const t of ungrouped) { parts.push(`- ${t.name}: ${t.description}`); }
  }

  return `Tool availability (filtered by policy):\n${parts.join('\n')}`;
}

/**
 * Workspace context section.
 *
 * Combines:
 *   - Bootstrap files (SOUL.md → AGENTS.md → TOOLS.md per M11 layering)
 *   - Workspace digest (~2000 tokens per M11)
 *
 * Upstream: resolveBootstrapContextForRun from bootstrap-files.ts:47-118
 */
export function buildWorkspaceSection(
  bootstrapFiles: readonly IBootstrapFile[],
  workspaceDigest: string,
): string {
  const parts: string[] = [];

  // Bootstrap files in M11 layering order
  for (const file of bootstrapFiles) {
    if (file.content) {
      parts.push(`### ${file.name}\n${file.content}`);
    }
  }

  // Workspace digest
  if (workspaceDigest) {
    parts.push(`### Workspace Overview\n${workspaceDigest}`);
  }

  return `## Workspace Context\n${parts.join('\n\n')}`;
}

/**
 * Runtime metadata section.
 *
 * Upstream: runtimeInfo section in buildAgentSystemPrompt
 */
export function buildRuntimeSection(runtimeInfo: IOpenclawRuntimeInfo): string {
  const lines = [
    '## Runtime',
    `- Model: ${runtimeInfo.model}`,
    `- Provider: ${runtimeInfo.provider}`,
    `- Host: ${runtimeInfo.host}`,
    `- Parallx version: ${runtimeInfo.parallxVersion}`,
  ];
  if (runtimeInfo.os) { lines.push(`- OS: ${runtimeInfo.os}`); }
  if (runtimeInfo.arch) { lines.push(`- Architecture: ${runtimeInfo.arch}`); }
  if (runtimeInfo.shell) { lines.push(`- Shell: ${runtimeInfo.shell}`); }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Estimation helper
// ---------------------------------------------------------------------------

/**
 * Estimate the token count of the built system prompt.
 * Useful for budget planning before sending to the model.
 */
export function estimateSystemPromptTokens(params: IOpenclawSystemPromptParams): number {
  const prompt = buildOpenclawSystemPrompt(params);
  return estimateTokens(prompt);
}

// ---------------------------------------------------------------------------
// M42 Phase 2: Model-tier guidance
// ---------------------------------------------------------------------------

/**
 * Extra guidance for small models (≤8B parameters).
 * Encourages step-by-step reasoning and concise output to stay within
 * the smaller context window and attention capacity.
 */
function buildSmallModelGuidance(): string {
  return `## Small Model Guidance
- Think step-by-step before answering complex questions.
- Keep responses concise — prefer short paragraphs over long prose.
- When uncertain, say so rather than generating plausible-sounding guesses.
- Focus on the most relevant workspace files rather than trying to reference everything.`;
}

/**
 * Fallback note when the model doesn't support tool calling.
 * Instructs the model to produce structured text output instead.
 */
function buildNoToolsFallbackNote(): string {
  return `## Tool Calling Not Available
This model does not support native tool calling. When you need to perform actions (search files, read documents, run commands), describe what you would do in a structured format:
- Action: [tool name]
- Input: [parameters]
The system will interpret these and execute them on your behalf.`;
}

function buildVisionGuidanceSection(): string {
  return [
    '## Vision Capabilities',
    'You can analyze images attached to user messages. When the user includes an image:',
    '- Describe what you see clearly and specifically',
    '- Reference visual elements (text, diagrams, UI, photos) in your response',
    '- If the image relates to the workspace content, connect visual observations to workspace context',
    'When no image is attached, respond normally to text input.',
  ].join('\n');
}

function buildAttachmentGuidanceSection(): string {
  return [
    '## Attached Context',
    'The user has explicitly attached files or text selections to this message.',
    'Their content appears at the beginning of the user message, marked with `## Attached File:` or `## Selected Text from:`, followed by `---` and the user\'s actual question.',
    'Treat the attached content as the primary context for your response:',
    '- Answer based on the attached content first, supplementing with workspace context when relevant.',
    '- Quote specific sections from the attached content when citing facts.',
    '- If the user\'s question can be fully answered from the attachment, do so directly.',
    '- The attachment content IS present in the message — look for `## Attached File:` headers.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Budget-aware truncation of system prompt sections.
 * Truncation priority: workspace context first (largest variable section),
 * then tool summaries. Skills are never truncated.
 */
function truncateSystemPromptToBudget(
  sections: readonly string[],
  budgetTokens: number,
): string {
  const mutableSections = [...sections];

  // Find truncatable sections
  const workspaceIdx = mutableSections.findIndex(s => s.startsWith('## Workspace Context'));
  const toolsIdx = mutableSections.findIndex(s => s.startsWith('Tool availability'));

  // Try truncating workspace first
  if (workspaceIdx >= 0) {
    const sectionBudget = Math.floor(budgetTokens * 0.3);
    mutableSections[workspaceIdx] = trimTextToBudget(mutableSections[workspaceIdx], sectionBudget).text;
    const candidate = mutableSections.join('\n\n');
    if (estimateTokens(candidate) <= budgetTokens) {
      return candidate;
    }
  }

  // Then truncate tools
  if (toolsIdx >= 0) {
    const sectionBudget = Math.floor(budgetTokens * 0.15);
    mutableSections[toolsIdx] = trimTextToBudget(mutableSections[toolsIdx], sectionBudget).text;
  }

  return mutableSections.join('\n\n');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
