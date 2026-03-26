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

import { estimateTokens } from './openclawTokenBudget.js';

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
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build the structured system prompt.
 *
 * Sections follow upstream buildAgentSystemPrompt structure:
 *   1. Identity
 *   2. Skills (XML-tagged, mandatory scan instruction)
 *   3. Tool summaries (name + one-line description)
 *   4. Workspace context (bootstrap files + digest)
 *   5. Context engine addition (from AssembleResult)
 *   6. Preferences & overlays
 *   7. Runtime metadata
 *   8. Behavioral rules (M11 small-model guidance)
 */
export function buildOpenclawSystemPrompt(params: IOpenclawSystemPromptParams): string {
  const sections: string[] = [];

  // 1. Identity (upstream: first line of buildAgentSystemPrompt)
  sections.push(buildIdentitySection(params.runtimeInfo));

  // 2. Skills (upstream: agents/system-prompt.ts lines 20-37)
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

  // 7. Runtime metadata (upstream: runtimeInfo section)
  sections.push(buildRuntimeSection(params.runtimeInfo));

  // 8. Behavioral rules (M11 small-model guidance — framework-level, not query-specific)
  sections.push(buildBehavioralRulesSection());

  // 9. M42: Model-tier-specific guidance
  if (params.modelTier === 'small') {
    sections.push(buildSmallModelGuidance());
  }

  // 10. M42: No-tools fallback note
  if (params.supportsTools === false) {
    sections.push(buildNoToolsFallbackNote());
  }

  return sections.join('\n\n');
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildIdentitySection(runtimeInfo: IOpenclawRuntimeInfo): string {
  return `You are Parallx, a local AI assistant for workspace knowledge management. You run on ${runtimeInfo.model} via ${runtimeInfo.provider}.`;
}

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
- If exactly one skill clearly applies: read its SKILL.md at <location>.
- If multiple could apply: choose the most specific one.
- If none clearly apply: do not read any SKILL.md.
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
 */
export function buildToolSummariesSection(tools: readonly IToolSummary[]): string {
  const lines = tools.map(t => `- **${t.name}**: ${t.description}`).join('\n');
  return `## Available Tools\n${lines}`;
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
  return `## Runtime
- Model: ${runtimeInfo.model}
- Provider: ${runtimeInfo.provider}
- Host: ${runtimeInfo.host}
- Parallx version: ${runtimeInfo.parallxVersion}`;
}

/**
 * Behavioral rules for local models.
 *
 * This is NOT output repair relocated (see Anti-Pattern: Patch-thinking).
 * This is the standard "how to behave" section that every well-configured
 * AI system has. Rules are framework-level and general.
 *
 * Do NOT add query-specific rules (e.g., "when asked about deductibles,
 * quote exact values"). That would be eval-driven patchwork.
 */
export function buildBehavioralRulesSection(): string {
  return `## Response Guidelines
- Answer from the workspace context provided above. Cite specific files and sections.
- When quoting facts (numbers, dates, names, procedures), use the exact values from the source documents.
- If the workspace context does not contain enough information to answer, say so explicitly rather than guessing.
- Be thorough. Cover all relevant aspects the user asked about.
- Use clear, structured formatting (headings, lists, bold) to organize your response.
- When multiple sources are relevant, synthesize them rather than repeating each one separately.`;
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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
