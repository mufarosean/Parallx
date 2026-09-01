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
import type { ToolCategory } from '../services/chatTypes.js';

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
  /**
   * M81 Phase 6 — workspace-relative paths of bundled files discovered
   * under `<skill>/scripts/`, `<skill>/references/`, `<skill>/assets/`.
   * Surfaced to the agent inside a `<bundle>` child of the `<skill>` XML
   * so the model can `fs_read_file` the path on demand (Execution stage of
   * progressive disclosure). Omit or supply an empty array when the
   * skill has no bundled files — no `<bundle>` block is emitted in that
   * case.
   */
  readonly bundledFiles?: readonly string[];
}

export interface IToolSummary {
  readonly name: string;
  readonly description: string;
  /**
   * Optional short prompt-only summary (≤120 chars). Consumed by prompt
   * introspection (openclawPromptArtifacts) — buildToolSummariesSection no
   * longer renders per-tool summaries (the function-calling schema carries
   * descriptions), and the runtime summarizer that once derived one from
   * `description` was never wired and is deleted (HARNESS.md §1.5).
   *
   * Upstream parity: src/agents/tool-description-presets.ts —
   * upstream's `coreToolSummaries` map is the equivalent.
   */
  readonly displaySummary?: string;
  /**
   * M81 Phase 10 — coarse feature-area grouping. When present on at least
   * one tool, `buildToolSummariesSection` emits a category-to-tools map so
   * the model sees the surface boundary (canvas vs file-system vs memory…)
   * up front and stops cross-routing (e.g. calling `fs_read_file` on a canvas
   * page UUID).
   */
  readonly category?: ToolCategory;
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
   * template it can mint via `link_create`. The whole point is that adding
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
 * Section order — stable prefix first, the single volatile section last:
 *   0. Identity / persona (SOUL.md), emitted first so the model anchors on
 *      who it is.
 *   1. Workspace context (remaining bootstrap files + digest) — the grounding
 *      block (user + project), kept next to identity.
 *   2. Skills (XML-tagged, mandatory scan instruction)
 *   3. Tooling (category map + routing)
 *   4. Memory, then Linking
 *   5. Context engine addition, preferences, agent overlays
 *   6. Conditional guidance (small model, no-tools, vision, attachments)
 *   7. Runtime metadata — LAST. It holds the only volatile content (the live
 *      clock), so everything above stays a byte-stable, cache-reusable prefix.
 *
 * Persona/identity content lives in SOUL.md (bootstrap), surfaced at the top.
 */
export function buildOpenclawSystemPrompt(params: IOpenclawSystemPromptParams): string {
  const sections: string[] = [];

  // 0. Identity / persona — lead with SOUL.md so the model anchors on who it
  //    is before tooling or workspace detail. Pulled out of the bootstrap file
  //    list so it is NOT also rendered inside Workspace Context further down.
  const soulFile = params.bootstrapFiles.find((f) => /(^|\/)SOUL\.md$/i.test(f.name));
  const workspaceBootstrapFiles = soulFile
    ? params.bootstrapFiles.filter((f) => f !== soulFile)
    : params.bootstrapFiles;
  if (soulFile && soulFile.content) {
    sections.push(`## Identity\n${soulFile.content}`);
  }

  // 1. Workspace context — the grounding block (who the user is, what the
  //    project is) sits right after identity so the model has its framing
  //    before any capability detail. All stable content, so it stays in the
  //    cache prefix.
  sections.push(buildWorkspaceSection(workspaceBootstrapFiles, params.workspaceDigest));

  // 2. Skills (upstream: agents/system-prompt.ts buildSkillsSection)
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

  // 3a. Memory section. The model already has `memory_read`/`memory_search`
  //     in the tools array, but small models need to be told the memory
  //     subsystem *exists* and when to consult it. Without this section the
  //     model never calls memory tools unless the user explicitly says
  //     "search memory". Self-contained — no SOUL.md or workspace file
  //     dependency.
  sections.push(buildMemorySection());

  // 3a-ii. M85 — Planning discipline. Gated on plan_update availability so
  //        the guidance never references a tool the model can't call.
  if (params.tools.some((t) => t.name === 'plan_update')) {
    sections.push(buildPlanningSection());
  }

  // 3a-iii. M85 follow-up — Delegation discipline. Same "the model must be
  //         told the subsystem exists" reasoning as the Memory section:
  //         sessions_spawn was never called because nothing taught WHEN.
  if (params.tools.some((t) => t.name === 'sessions_spawn')) {
    sections.push(buildSubagentsSection());
  }

  // HARNESS.md §3.6 — shared canvas teaching, once, only when canvas tools
  // are present (mirror of the sessions_spawn gating above).
  if (params.tools.some((t) => t.name.startsWith('canvas_'))) {
    sections.push(buildCanvasSection());
  }

  // 3b. M66 — Linking templates. Auto-generated from registered LinkContracts;
  //     adding a new extension contract surfaces its URI templates here with
  //     zero core changes.
  if (params.linkContracts && params.linkContracts.length > 0) {
    sections.push(buildLinkingSection(params.linkContracts));
  }

  // 3c. M102 — Concept maps. Unconditional: this is a rendering capability of
  //     the reply itself, not a tool, so there is nothing to gate on.
  sections.push(buildConceptMapSection());

  // 5. Context engine addition (upstream: systemPromptAddition from AssembleResult).
  //    Holds retrieved/assembled context for the turn. Placed after the
  //    capability sections and before preferences so it reads as supporting
  //    detail, not core framing.
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

  // 12. Runtime metadata — emitted LAST. It carries the only volatile content
  //     (the live wall clock), so keeping it at the tail leaves every section
  //     above byte-stable across turns, letting local runtimes reuse the prompt
  //     prefix instead of re-prefilling the whole system message each turn.
  //     Everything above this point is the stable cache prefix.
  sections.push(buildRuntimeSection(params.runtimeInfo));

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
 *   - Default read tool name is `fs_read_file` (Parallx's tool registry name).
 *   - Skill `location` is workspace-relative (`.parallx/skills/<n>/SKILL.md`),
 *     so upstream's `~/` home-prefix compaction is not applied — paths are
 *     already minimal.
 */
export function buildSkillsSection(
  skills: readonly ISkillEntry[],
  opts?: {
    /** Tool name embedded in the scan instruction. Defaults to `fs_read_file`. */
    readonly readToolName?: string;
    /** When true, emit name+location only (mirrors upstream `formatSkillsCompact`). */
    readonly compact?: boolean;
    /** Optional warning line prepended to the section (truncation notice). */
    readonly truncationNote?: string;
  },
): string {
  const readToolName = opts?.readToolName ?? 'fs_read_file';
  const compact = opts?.compact === true;

  const entries = skills
    .map(s => {
      // M81 Phase 6 — render <bundle> child when bundledFiles is non-empty.
      // Existing skills without bundled files render exactly as before.
      const bundle = s.bundledFiles && s.bundledFiles.length > 0
        ? `    <bundle>\n${s.bundledFiles.map(f => `      <file>${escapeXml(f)}</file>`).join('\n')}\n    </bundle>`
        : undefined;
      const inner = [
        `    <name>${escapeXml(s.name)}</name>`,
        compact ? undefined : `    <description>${escapeXml(s.description)}</description>`,
        `    <location>${escapeXml(s.location)}</location>`,
        bundle,
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
 * Tooling section — surface-prefix legend + routing rubric.
 *
 * The function-calling schema already injects every tool's name, description,
 * and parameters, so this section does NOT re-list tools (that was the old
 * category map — pure duplication that burned tokens). What the schema does
 * NOT convey is which **surface** a tool acts on. Since every tool name now
 * carries a surface prefix (`fs_`, `canvas_`, `memory_`, …), a one-line legend
 * plus a short routing rubric is enough to stop small models cross-routing
 * (e.g. calling `fs_read_file` on a canvas page UUID). The output is static —
 * it does not depend on the tool list.
 *
 * Parity: OpenClaw's Tooling section is a short preamble; Anthropic's guidance
 * is that tool descriptions are the selection signal and shouldn't be
 * duplicated in prose. We don't duplicate; we add orthogonal surface routing.
 */
export function buildToolSummariesSection(_tools: readonly IToolSummary[]): string {
  // The function-calling schema already carries every tool's name, description,
  // and parameters, so this section does NOT re-list tools. Each tool name now
  // carries a surface PREFIX (fs_, canvas_, memory_, …), so a one-line legend +
  // routing rubric is enough to keep the model from cross-routing (e.g. calling
  // `fs_read_file` on a canvas page UUID). `_tools` is unused by design.
  return [
    '## Tooling',
    'Tool definitions (name, description, parameters) are provided in the function-calling schema for this turn. Each tool\'s description states what it does and when to use it — read it before calling. Tool names are case-sensitive snake_case; copy each name exactly as written in the schema.',
    '',
    'Every tool name carries a **surface prefix** so you always know which resource it acts on:',
    '- `canvas_*` — canvas pages (titles, UUIDs, blocks, properties). Pages are NOT files on disk.',
    '- `fs_*` — workspace files on disk, e.g. `fs_read_file`, `fs_write_file`, `fs_grep_search`, `fs_search_knowledge` (paths like `src/foo.ts`).',
    '- `memory_*` — workspace memory (`.parallx/memory/`).',
    '- `transcript_*` — past chat sessions.',
    '- `terminal_run_command` — shell commands on the host.',
    '- `python_*` — the workspace\'s own Python environment: run a `.py` file, install packages, list what is installed.',
    '- `notebook_*` — `.ipynb` notebooks: create, read, edit a cell, run cells against the workspace kernel.',
    '- `link_create` — mint a `parallx://` citation URI.',
    '- `sessions_spawn` — delegate a self-contained bulk task to an isolated subagent (see the Subagents section).',
    '- `app__*` — Parallx workbench commands (open views, change settings).',
    '- extension families — `budget_*`, `planner_*`, `cron_*`, `dashboard_*`, plus `webSearch` / `webFetch`. Read each description.',
    '',
    'Routing rules:',
    '- A filesystem path (`src/foo.ts`, `docs/README.md`) → `fs_*` tools.',
    '- "page", "this page", a page title, or a UUID → `canvas_*` tools. Never call `fs_read_file` / `fs_write_file` on a canvas page UUID — UUIDs are not file paths.',
    '- Memory, lessons, USER.md, MEMORY.md, "what did we decide" → `memory_*` tools.',
    '- "what did I say earlier in another session" → `transcript_*` tools.',
    '- Ambiguous ("open my notes") → `canvas_find_pages` first; it matches title and body.',
    '- Running Python → `python_run_script` or `notebook_run`, NOT `terminal_run_command`. The dedicated tools use the workspace\'s own environment, stream output live, and allow far longer runs; the shell tool buffers and times out at 30s. Only fall back to the shell when neither is offered this turn (they appear only where the workspace has enabled Python).',
    '- A `.ipynb` path → `notebook_*` tools. Never `fs_read_file` / `fs_write_file` on a notebook — you would be reading and rewriting raw nbformat JSON by hand. `notebook_read` gives you cells and outputs; `notebook_create` writes a valid file.',
    '- Notebook vs script: a notebook when the user wants to keep the results (outputs are saved in the file, and cells share one kernel so state carries between them); a script when they want a repeatable command-line job.',
    'When two tools could apply, prefer the more specific one (`canvas_read_page` over `canvas_find_pages` when you know the title; `fs_grep_search` over `fs_search_knowledge` for exact-text matches).',
    '- **Read before you edit** — enforced by the tools: `fs_edit_file` (and overwriting an existing file) requires a prior `fs_read_file` this session; `canvas_edit_page` / `canvas_edit_block` / `canvas_insert_block_after` require a prior `canvas_read_page` (or `canvas_read_block`). Edit against the CURRENT content you just read, never from memory of an earlier state.',
    '',
    'TOOLS.md (in the workspace, when present) carries workspace-specific usage guidance, not tool availability.',
  ].join('\n');
}

/**
 * M66 — Linking section. Auto-generated from registered LinkContracts.
 *
 * Tells the AI:
 *   - That Parallx resources are citable via `parallx://` URIs.
 *   - The exact URI templates that are live in this workspace right now.
 *   - To prefer `link_create` over hand-constructing URIs.
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
    'click through. Prefer the `link_create` tool to mint URIs — it',
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
/**
 * Concept maps (M102).
 *
 * A rendering capability of the reply, not a tool — a ```mindmap fence in the
 * answer draws as a small diagram. The section exists because the model will
 * never reach for a syntax nothing told it about; the same reasoning as the
 * Memory and Delegation sections, which went unused until something taught
 * WHEN to use them.
 *
 * The "when NOT to" half carries most of the weight. Left to itself a model
 * will decorate every answer with a diagram, and a map of things that were
 * already a list is noise that costs the reader more than it gives.
 */
export function buildConceptMapSection(): string {
  return [
    '## Concept maps',
    'A fenced ```mindmap block in your reply renders as a small diagram.',
    'Its syntax is an indented list — indentation is the only thing that',
    'matters, and a child is any line indented further than the line above:',
    '',
    '```mindmap',
    'Parameter risk',
    '  does not diversify across years',
    '    every year shares the same estimated parameters',
    '  widens the predictive distribution',
    'Process risk',
    '  averages out across years',
    '```',
    '',
    'Write ```mindmap vertical for a top-down tree (good for wide, shallow',
    'maps). Labels may carry inline $LaTeX$; it renders as real math.',
    '',
    'Use one when the answer is about how several ideas RELATE — what depends',
    'on what, what splits into what, how two things differ and where they',
    'meet. Draw the map first, then explain it in prose; the map is the',
    'skeleton of the explanation, never a replacement for one.',
    '',
    'Do NOT use one for a sequence of steps, a plain list, a comparison of',
    'two things, or anything with fewer than four nodes. Prose is better for',
    'all of those, and a diagram of something that was already a list makes',
    'the reply longer without making it clearer. Most answers need no map.',
    '',
    'Keep it under about 15 nodes and 3 levels deep. Label nodes with short',
    'claims or names, not sentences. The reader can click any node to ask a',
    'follow-up about it.',
  ].join('\n');
}

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
  // Current date/time + timezone are injected on every prompt build so the
  // model never has to guess "what day is it" from training-data cutoff or
  // hallucinate. Local models in particular have no other source of truth
  // for the wall clock; without this, asking "what's today's date?" returns
  // a stale or fabricated answer. Cost is ~2 lines (~30 tokens).
  const now = new Date();
  // The MACHINE's timezone — never a hardcoded one. Every downstream date
  // consumer (planner tools, Date.parse of zone-less ISO strings, local
  // formatting) works in machine-local time; anchoring the model's clock to
  // any other zone makes it compute "tomorrow 3pm" against the wrong wall
  // clock and every scheduled task lands hours off.
  let tz = 'local';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'local'; } catch { /* keep 'local' */ }
  let localStr: string;
  try {
    localStr = new Intl.DateTimeFormat('en-US', {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short',
    }).format(now);
  } catch { localStr = now.toISOString(); }
  const lines = [
    '## Runtime',
    `- Current date/time: ${localStr} (UTC: ${now.toISOString()})`,
    `- Timezone: ${tz} — the user's local timezone. Times you pass to tools or say to the user are LOCAL; only add a Z/offset suffix when you explicitly mean UTC.`,
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
 * Memory section — tells the model the workspace memory subsystem exists,
 * what the layers are for, and when to read or write.
 *
 * M81 Phase 8: MEMORY.md is no longer a single content file — it is now an
 * INDEX of pointers to per-topic lesson files. Lesson bodies live at
 * `.parallx/memory/lessons/<slug>.md` and are read on demand, never auto-
 * loaded. This mirrors the skill catalog shape (name + description +
 * location in the prompt, body fetched with a tool call) and the Claude
 * Code auto-memory pattern (index + topic files, progressive disclosure).
 *
 * The tools `memory_read` / `memory_search` / `memory_write` carry their own
 * per-tool descriptions in the function schema, but small models routinely
 * fail to use them unless the system prompt explicitly names the surface
 * and the write triggers. This block does both.
 */
export function buildMemorySection(): string {
  return [
    '## Memory',
    'You have a single workspace memory surface, split across identity files (auto-loaded every turn) and a curated memory store you read and write yourself.',
    '',
    '**Identity files** — already in your context, no tool call needed:',
    '- `.parallx/SOUL.md` — your personality and constraints.',
    '- `.parallx/USER.md` — facts about the user (identity, preferences, current focus). Bounded ~1,500 chars.',
    '- `.parallx/AGENTS.md` — project context and conventions.',
    '',
    '**Curated memory store** — at `.parallx/memory/`:',
    '- `MEMORY.md` is an **INDEX**, bounded ~2,500 chars. Each line is `- [Title](lessons/<slug>.md) — one-line description` pointing at a lesson file. The index is in your context every turn; lesson bodies are NOT.',
    '- `lessons/<slug>.md` — durable lessons (tool-use gotchas, workarounds, project conventions, things to remember across sessions). Read a body on demand with `memory_read name=<slug>` (preferred) or `fs_read_file lessons/<slug>.md`.',
    '- `YYYY-MM-DD.md` — date-stamped daily logs. Unbounded; append-only narrative of what happened today.',
    '',
    '**Three tools, one family**:',
    '- `memory_read` — read USER.md, MEMORY.md (the index), a daily log by date, OR a specific lesson body via `name=<slug>`.',
    '- `memory_search` — semantic search across all of `.parallx/memory/` (index + lesson bodies + dailies).',
    '- `memory_write` — add / replace / remove on USER.md, MEMORY.md sections, daily logs, AND lessons (via `file=lesson` with `slug` + `description` + `entry`).',
    '',
    '**Read memory before answering** when the user references prior context ("you said earlier…", "what did we decide…"), asks what you know about a person/project/topic, or you\'re about to make a recommendation that hinges on a past decision. Scan the index in MEMORY.md for matching descriptions — if one fits, open the lesson body. Prefer `memory_search` for topic recall, `memory_read` when you know the exact file or slug.',
    '',
    '**Write memory** when you\'ve learned something durable. Call `memory_write` proactively in these cases:',
    '- The user states a preference about how you should behave ("I prefer X", "always do Y", "use Z") → `file=USER`.',
    '- The user reveals a stable fact about themselves (role, project, environment, constraints) → `file=USER`.',
    '- **The user corrects you** ("don\'t do X", "that\'s wrong, it\'s Y", "use Z instead of W", "you got that backwards") → `memory_write file=lesson action=add` with a slug like `correction-<topic>`. A correction is not a passing preference — record the exact thing you got wrong and the right answer so you don\'t repeat the mistake. Cite the cue explicitly in the body.',
    '- You notice a tool-use pattern that should not be repeated (you called the wrong tool, missed an argument, hit a known failure mode) → `file=lesson`.',
    '- A workaround or gotcha emerges that future sessions will need (a known bug, an upstream limitation, a non-obvious fix) → `file=lesson`.',
    '- A project-level decision is made or a non-obvious fact about the project surfaces ("we\'re going with Postgres", "this repo uses 2-space indent") → `file=lesson` (MEMORY.md is the index that surfaces it).',
    '- Something noteworthy happened today and the user will want to look it up later → `file=daily`.',
    '',
    '**Cap discipline** — USER.md and the MEMORY.md index are bounded. When `memory_write add` would exceed the cap, the tool returns the current entries and an error. Pick the least-relevant existing lesson and `memory_write file=lesson action=remove slug=<old>` before retrying the add. The cap is a curation forcing function: only the most durable, generally-applicable lessons stay in the index.',
    '',
    'If memory contains a claim that names a specific file, function, or value, verify it against the current workspace before acting on it — memory can go stale.',
  ].join('\n');
}

/**
 * M85 follow-up — Delegation discipline. Rendered only when `sessions_spawn`
 * is in the tool catalog. The core sell is context conservation: bulk work
 * comes back as one distilled answer instead of raw dumps in the main
 * conversation.
 */
/**
 * HARNESS.md §3.6 — the shared canvas teaching, stated ONCE. Rendered only
 * when canvas tools are in the catalog. Everything here used to be repeated
 * across 17 canvas tool descriptions (the `canvas_*` family was ~14K chars
 * of schema prose, most of it the same five lessons); the descriptions now
 * carry only per-tool mechanics and this section carries the model.
 */
export function buildCanvasSection(): string {
  return [
    '## Canvas',
    'Canvas pages live in the workspace page DATABASE, not on disk — `canvas_*` tools never touch files (use `fs_*` for files on disk: .md, .txt, code).',
    '',
    '**IDs**: `canvas_create_page` auto-generates the UUID and returns it — never pass one, and REUSE the returned id for every follow-up edit to that page (re-creating makes duplicates). If you only have a title, `canvas_read_page` accepts titles and the literal "current" directly — do NOT call `canvas_find_pages` first for a known title. Block ids come from `canvas_read_page` (each top-level block is prefixed `[blockId]`).',
    '',
    '**Block content is MARKDOWN**: `## X` → heading, `- [ ] X` → to-do, `- X` → bullet, `1. X` → numbered, `> [!note] …` → callout, `> X` → quote, fenced code → code block. Multi-line content may expand into several blocks.',
    '',
    '**Property values by kind**: text → string, number → number, checkbox → boolean, tags/multi-select → a REAL JSON array of strings, never a stringified array.',
    '',
    '**Databases** are special pages: rows are pages, columns are typed properties, `values` are keyed by PROPERTY NAME. A page has at most ONE home database. Inspect schema + rows with `canvas_query_database` before adding or editing.',
    '',
    'Edits to a page open in the editor stream in live — no need to reopen. Before creating a blank page, check `canvas_list_templates` for a matching template.',
  ].join('\n');
}

export function buildSubagentsSection(): string {
  return [
    '## Subagents',
    'You can delegate a self-contained task to a subagent with `sessions_spawn`. The subagent runs in an ISOLATED session with its own fresh context and full tools, does the work, and returns only its final answer to you.',
    '',
    'When to delegate — the test is "would doing this inline flood my context with material I only need a conclusion from?":',
    '- Sweeping many files or pages to answer one question ("scan src/services and list every service that touches SQLite").',
    '- Digesting a long document into a structured summary.',
    '- Researching a side question whose intermediate findings you don\'t need verbatim.',
    '',
    'When NOT to delegate: single-tool jobs (just call the tool), tasks needing conversation context the subagent won\'t have, or edits you must supervise step-by-step.',
    '',
    'How to write the task prompt — the subagent knows NOTHING about this conversation:',
    '- Include every path, page title, constraint, and definition it needs.',
    '- State the exact shape of the answer you want back (a list, a table, a yes/no with evidence).',
    '- Treat the returned answer as a report to spot-check, not ground truth — verify load-bearing claims before acting on them.',
    '',
    'Each spawn is a real model run and requires user approval; subagents cannot spawn further subagents.',
  ].join('\n');
}

/**
 * M85 — Planning discipline section (the planning organ). Rendered only when
 * `plan_update` is in the tool catalog. The behavioral contract mirrors what
 * makes harness-managed agents stay on track over long multi-step work: an
 * externalized plan, updated AS the work proceeds, that survives context
 * compaction because it lives outside conversation history.
 */
export function buildPlanningSection(): string {
  return [
    '## Planning',
    'You have a durable working plan for this session, maintained with `plan_update`. It is re-shown to you every turn under `## Active Plan` and SURVIVES context compaction — treat it as your mission anchor, not decoration.',
    '',
    'When to plan:',
    '- Any task with 3+ distinct steps, any task that will span multiple tool calls or messages, or any task the user describes as a project/milestone → call `plan_update` BEFORE starting work: one-line `goal`, the ordered `steps`, and `note` = your immediate next action.',
    '- Single-step or purely conversational requests → no plan needed.',
    '',
    'While working:',
    '- Mark the step you are working on `active` (one at a time) and completed steps `done` AS YOU FINISH THEM — not in a batch at the end. The statuses are how you re-orient after an interruption or compaction.',
    '- Keep `note` current: what is in flight right now + what happens next. After any context compaction, re-read the Active Plan and the note before doing anything else.',
    '- If the user changes direction, update the plan FIRST, then proceed — a stale plan is worse than no plan.',
    '- When every step is done and verified, call `plan_update` with `clear: true`.',
  ].join('\n');
}

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

  // Try truncating workspace first. trimTextToBudget keeps the end of the
  // text, so naive trimming would drop the "## Workspace Context" header —
  // breaking downstream consumers that locate the section by its heading.
  // Preserve the heading line by trimming only the body. M81 Phase 1 exposed
  // this issue when USER.md content pushed the section past budget.
  if (workspaceIdx >= 0) {
    const sectionBudget = Math.floor(budgetTokens * 0.3);
    mutableSections[workspaceIdx] = trimSectionPreservingHeader(
      mutableSections[workspaceIdx], sectionBudget,
    );
    const candidate = mutableSections.join('\n\n');
    if (estimateTokens(candidate) <= budgetTokens) {
      return candidate;
    }
  }

  // Then truncate tools (same header-preserving rule)
  if (toolsIdx >= 0) {
    const sectionBudget = Math.floor(budgetTokens * 0.15);
    mutableSections[toolsIdx] = trimSectionPreservingHeader(
      mutableSections[toolsIdx], sectionBudget,
    );
  }

  return mutableSections.join('\n\n');
}

function trimSectionPreservingHeader(section: string, budgetTokens: number): string {
  const newlineIdx = section.indexOf('\n');
  if (newlineIdx < 0) {
    return trimTextToBudget(section, budgetTokens).text;
  }
  const header = section.slice(0, newlineIdx);
  const body = section.slice(newlineIdx + 1);
  const headerTokens = estimateTokens(header + '\n');
  const bodyBudget = Math.max(0, budgetTokens - headerTokens);
  const trimmedBody = trimTextToBudget(body, bodyBudget).text;
  return trimmedBody ? `${header}\n${trimmedBody}` : header;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
