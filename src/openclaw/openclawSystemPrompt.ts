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
import { summarizeToolDescriptionText } from './openclawToolDescriptionSummary.js';
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
  /**
   * Optional short prompt-only summary (≤120 chars). When present, the
   * prompt builder uses this verbatim; otherwise it derives a summary
   * from `description` via summarizeToolDescriptionText().
   *
   * Upstream parity: src/agents/tool-description-presets.ts —
   * upstream's `coreToolSummaries` map is the equivalent.
   */
  readonly displaySummary?: string;
}

/**
 * M66 — One descriptor per registered LinkContract kind. Flattened from
 * `LinkResolverService.allContracts()` so the prompt builder doesn't need to
 * know about the link service's internal types.
 */
export interface IOpenclawLinkContractKindDescriptor {
  readonly kind: string;
  readonly uriTemplate: string;
  readonly description: string;
  readonly examples?: readonly string[];
}

export interface IOpenclawLinkContractDescriptor {
  readonly segment: string;
  readonly displayName: string;
  readonly extensionId: string;
  readonly kinds: readonly IOpenclawLinkContractKindDescriptor[];
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
  /** When true, render `<skill>` entries without `<description>` (upstream compact form). */
  readonly skillsCompact?: boolean;
  /** Optional warning line prepended to the skills section (truncation notice). */
  readonly skillsTruncationNote?: string;
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
  /**
   * M66 — Registered `parallx://` link contracts. When present, a `## Linking`
   * section is auto-generated from this list so the AI knows every URI
   * template it can mint via `parallx_link`. The whole point is that adding
   * a new extension contract makes the AI aware of it with zero core changes.
   */
  readonly linkContracts?: readonly IOpenclawLinkContractDescriptor[];
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

  // 1. Skills (upstream: agents/system-prompt.ts buildSkillsSection)
  if (params.skills.length > 0) {
    sections.push(buildSkillsSection(params.skills, {
      compact: params.skillsCompact,
      truncationNote: params.skillsTruncationNote,
    }));
  }

  // 3. Tool summaries (upstream: buildToolSummaryMap in pi-embedded-runner/system-prompt.ts)
  if (params.tools.length > 0) {
    sections.push(buildToolSummariesSection(params.tools));
  }

  // 3b. M66 — Linking templates. Auto-generated from registered LinkContracts;
  //     adding a new extension contract surfaces its URI templates here with
  //     zero core changes.
  if (params.linkContracts && params.linkContracts.length > 0) {
    sections.push(buildLinkingSection(params.linkContracts));
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
 * Skills section following upstream pattern.
 *
 * Upstream parity (raw.githubusercontent.com/openclaw/openclaw/main):
 *   - src/agents/system-prompt.ts `buildSkillsSection` — 4-line preamble,
 *     heading `## Skills`, parameterized read tool name.
 *   - src/agents/skills/workspace.ts `formatSkillsForPrompt` /
 *     `formatSkillsCompact` — pretty-printed `<skill>` XML; compact form
 *     drops `<description>` to preserve catalog awareness over content.
 *
 * Parallx adaptation:
 *   - Default read tool name is `read_file` (Parallx's tool registry name).
 *   - Skill `location` is workspace-relative (`.parallx/skills/<n>/SKILL.md`),
 *     so upstream's `~/` home-prefix compaction is not applied — paths are
 *     already minimal.
 */
export function buildSkillsSection(
  skills: readonly ISkillEntry[],
  opts?: {
    /** Tool name embedded in the scan instruction. Defaults to `read_file`. */
    readonly readToolName?: string;
    /** When true, emit name+location only (mirrors upstream `formatSkillsCompact`). */
    readonly compact?: boolean;
    /** Optional warning line prepended to the section (truncation notice). */
    readonly truncationNote?: string;
  },
): string {
  const readToolName = opts?.readToolName ?? 'read_file';
  const compact = opts?.compact === true;

  const entries = skills
    .map(s => {
      const inner = [
        `    <name>${escapeXml(s.name)}</name>`,
        compact ? undefined : `    <description>${escapeXml(s.description)}</description>`,
        `    <location>${escapeXml(s.location)}</location>`,
      ].filter((line): line is string => line !== undefined).join('\n');
      return `  <skill>\n${inner}\n  </skill>`;
    })
    .join('\n');

  const truncationLine = opts?.truncationNote ? `${opts.truncationNote}\n` : '';

  return `## Skills
${truncationLine}Scan <available_skills>. If one clearly applies, read its SKILL.md at exact <location> with \`${readToolName}\`, then follow it.
If several apply, choose the most specific. If none clearly apply, read none.
One skill up front max. Never guess/fabricate skill paths.
External API writes: batch when safe, avoid tight loops, respect 429/Retry-After.
<available_skills>
${entries}
</available_skills>`;
}

/**
 * Tool summaries section.
 *
 * Upstream parity (raw.githubusercontent.com/openclaw/openclaw/main):
 *   - src/agents/system-prompt.ts — emits a single flat `## Tooling` section
 *     with `- name: summary` bullets. No subheadings.
 *   - src/agents/tool-description-presets.ts — short `displaySummary` text
 *     (≤7 words) is the source of each bullet's right-hand side.
 *
 * Parallx M65 parity fix (divergence 2 + 3 + 4):
 *   - Single flat heading (`## Tooling`).
 *   - Per-tool: prefer `displaySummary`; else summarize `description` via
 *     `summarizeToolDescriptionText` (120-char sentence-boundary cut,
 *     strips JSON/schema/action blocks).
 *   - No more `### Canvas Pages` / `### Workspace Files` / etc.
 *     subheadings — those bloated the prompt and confused small models
 *     without matching upstream behaviour.
 */
export function buildToolSummariesSection(tools: readonly IToolSummary[]): string {
  const lines: string[] = ['## Tooling'];
  for (const tool of tools) {
    const summary = tool.displaySummary
      || summarizeToolDescriptionText(tool.description)
      || tool.name;
    lines.push(`- ${tool.name}: ${summary}`);
  }
  return lines.join('\n');
}

/**
 * M66 — Linking section. Auto-generated from registered LinkContracts.
 *
 * Tells the AI:
 *   - That Parallx resources are citable via `parallx://` URIs.
 *   - The exact URI templates that are live in this workspace right now.
 *   - To prefer `parallx_link` over hand-constructing URIs.
 *
 * Adding a new extension contract surfaces its templates here automatically.
 * Reviewers should reject any PR that adds a hardcoded segment branch in
 * this function — every URI template comes from a registered contract.
 */
export function buildLinkingSection(
  contracts: readonly IOpenclawLinkContractDescriptor[],
): string {
  const lines: string[] = [
    '## Linking',
    'Every cite-able Parallx resource (canvas pages, files, PDFs, media,',
    'budget items, graph nodes, web research results, past chat sessions)',
    'has a stable `parallx://` URI. When you reference one of these in your',
    'reply, emit a markdown link with the `parallx://` URI so the user can',
    'click through. Prefer the `parallx_link` tool to mint URIs — it',
    'validates the target against the templates below before returning a',
    'link.',
    '',
    'URI templates available in this workspace:',
  ];
  for (const c of contracts) {
    for (const k of c.kinds) {
      const example = k.examples && k.examples.length > 0
        ? ` (e.g. ${k.examples[0]})`
        : '';
      lines.push(`- ${c.displayName} / ${k.kind} — \`${k.uriTemplate}\`: ${k.description}${example}`);
    }
  }
  return lines.join('\n');
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
  const toolsIdx = mutableSections.findIndex(s => s.startsWith('## Tooling'));

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
