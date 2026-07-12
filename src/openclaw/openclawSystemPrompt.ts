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
   * Optional short prompt-only summary (≤120 chars). When present, the
   * prompt builder uses this verbatim; otherwise it derives a summary
   * from `description` via summarizeToolDescriptionText().
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

  // 3b. M66 — Linking templates. Auto-generated from registered LinkContracts;
  //     adding a new extension contract surfaces its URI templates here with
  //     zero core changes.
  if (params.linkContracts && params.linkContracts.length > 0) {
    sections.push(buildLinkingSection(params.linkContracts));
  }

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
    '- `link_create` — mint a `parallx://` citation URI.',
    '- `app__*` — Parallx workbench commands (open views, change settings).',
    '- extension families — `budget_*`, `planner_*`, `cron_*`, `dashboard_*`, plus `webSearch` / `webFetch`. Read each description.',
    '',
    'Routing rules:',
    '- A filesystem path (`src/foo.ts`, `docs/README.md`) → `fs_*` tools.',
    '- "page", "this page", a page title, or a UUID → `canvas_*` tools. Never call `fs_read_file` / `fs_write_file` on a canvas page UUID — UUIDs are not file paths.',
    '- Memory, lessons, USER.md, MEMORY.md, "what did we decide" → `memory_*` tools.',
    '- "what did I say earlier in another session" → `transcript_*` tools.',
    '- Ambiguous ("open my notes") → `canvas_find_pages` first; it matches title and body.',
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
  const tz = 'America/Chicago';
  let centralStr: string;
  try {
    centralStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short',
    }).format(now);
  } catch { centralStr = now.toISOString(); }
  const lines = [
    '## Runtime',
    `- Current date/time: ${centralStr} (UTC: ${now.toISOString()})`,
    `- Timezone: ${tz} (Central Time)`,
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
