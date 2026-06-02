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
   * so the model can `read_file` the path on demand (Execution stage of
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
   * up front and stops cross-routing (e.g. calling `read_file` on a canvas
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

  // 3a. Memory section. The model already has `memory_get`/`memory_search`
  //     in the tools array, but small models need to be told the memory
  //     subsystem *exists* and when to consult it. Without this section the
  //     model never calls memory tools unless the user explicitly says
  //     "search memory". Self-contained — no SOUL.md or workspace file
  //     dependency.
  sections.push(buildMemorySection());

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
 * Tooling section — category map + selection guidance.
 *
 * The model already has the full tool array (name + description + parameters)
 * injected by Ollama's chat template. Re-listing each tool here as
 * `- name: summary` bullets only duplicates that and burns tokens. What the
 * tool array does NOT convey is which **surface** each tool family operates
 * on. Empirically (M81 P10 trigger), small/medium models will reach for
 * `read_file` when handed a canvas page reference, or call `canvas_read_page`
 * when handed a filesystem path. The category map closes that gap.
 *
 * What this section emits:
 *   1. A category → tool-names map grouped by `IToolSummary.category`.
 *   2. A short routing rubric ("if the user says X, prefer Y").
 *   3. The preamble noting that tool descriptions are the canonical signal.
 *
 * Tools without a category are listed under an "other" bucket — extension
 * tools that don't yet declare one still appear. If no tool in the list
 * carries a category, the map is suppressed and the preamble alone is
 * emitted (keeps behaviour stable for stripped-down test/eval rigs).
 *
 * Upstream parity:
 *   - OpenClaw `src/agents/system-prompt.ts` Tooling section: short preamble
 *     style; we extend it with the category map (Parallx-specific because
 *     Parallx mixes canvas-DB tools with workspace-file tools — upstream
 *     only has files).
 *   - Anthropic skill docs: tool descriptions are the selection signal —
 *     don't duplicate them in prose. We don't; we add orthogonal routing.
 */
export function buildToolSummariesSection(tools: readonly IToolSummary[]): string {
  const lines: string[] = [
    '## Tooling',
    'Tool definitions (name, description, parameters) are provided in the function-calling schema for this turn. Each tool\'s description states what it does and when to use it — read it before calling. Tool names are case-sensitive snake_case (lowercase words joined by underscores, e.g. `read_file`, `canvas_read_page`, `budget_pull_emails`); copy each name exactly as written in the schema.',
  ];

  const categoryMap = groupToolsByCategory(tools);
  if (categoryMap.size > 0) {
    lines.push(
      '',
      'Every tool belongs to a **category** that names the surface it operates on. Pick tools from the category that matches the resource type in the user\'s request:',
      '',
    );
    for (const { label, blurb, toolNames } of orderCategoryEntries(categoryMap)) {
      lines.push(`- **${label}** — ${blurb}`);
      lines.push(`  Tools: ${toolNames.map(n => `\`${n}\``).join(', ')}`);
    }
    lines.push(
      '',
      'Routing rules:',
      '- If the user names a path like `src/foo.ts`, `docs/README.md`, or anything that looks like a filesystem path → **file-system** tools.',
      '- If the user says "page", "canvas page", "this page", "the page I\'m on", names a page title, or supplies a UUID → **canvas** tools. Never call `read_file` / `write_file` on a canvas page UUID — UUIDs are not file paths.',
      '- If the user references memory, lessons, USER.md, MEMORY.md, dailies, or "what did we decide" → **memory** tools.',
      '- If the user asks about past chats or "what did I say earlier in another session" → **transcript** tools.',
      '- If ambiguous ("open my notes"), prefer `canvas_find_pages` first — it matches title and body and surfaces the right candidate.',
      'When two tools in the same category could apply, prefer the more specific one (e.g. `canvas_read_page` over `canvas_find_pages` when the title is known; `grep_search` over `search_knowledge` for exact-text matches).',
    );
  } else {
    lines.push(
      'When two tools could apply, prefer the more specific one (e.g. `canvas_read_page` over `canvas_find_pages` when you already know the page title; `grep_search` over `search_knowledge` when the user wants an exact-text match).',
    );
  }

  lines.push(
    '',
    'TOOLS.md (in the workspace, when present) carries workspace-specific usage guidance, not tool availability.',
  );
  return lines.join('\n');
}

/**
 * M81 Phase 10 — short human-readable blurb per category. Lives next to the
 * `ToolCategory` union so the prompt builder doesn't need to repeat the
 * "what surface does this name refer to" knowledge in every test.
 */
interface ICategoryDescriptor {
  readonly label: string;
  readonly blurb: string;
  /** Sort order in the prompt (lower = first). Surfaces the model uses most go first. */
  readonly order: number;
}

const CATEGORY_DESCRIPTORS: Record<ToolCategory, ICategoryDescriptor> = {
  'canvas':      { label: 'canvas',      blurb: 'canvas page DB (titles, UUIDs, blocks, properties). Pages are NOT files on disk.', order: 10 },
  'file-system': { label: 'file-system', blurb: 'workspace files on disk under the workspace root (paths like `src/foo.ts`).',       order: 20 },
  'memory':      { label: 'memory',      blurb: '`.parallx/memory/` — USER.md, MEMORY.md index, lesson files, and daily logs.',     order: 30 },
  'transcript':  { label: 'transcript',  blurb: 'past chat sessions stored under `.parallx/sessions/`.',                              order: 40 },
  'linking':     { label: 'linking',     blurb: 'mint canonical `parallx://` URIs that cite workspace resources.',                    order: 50 },
  'surface':     { label: 'surface',     blurb: 'route a message to a Parallx UI surface (chat, canvas, etc.).',                      order: 60 },
  'subagent':    { label: 'subagent',    blurb: 'spawn a subagent to run a focused task in its own session.',                         order: 70 },
  'autonomy':    { label: 'autonomy',    blurb: 'read the autonomy / agent task log.',                                                order: 80 },
  'cron':        { label: 'cron',        blurb: 'schedule, list, and cancel recurring or one-shot tasks.',                            order: 90 },
  'app-control': { label: 'app-control', blurb: 'execute Parallx workbench commands (open views, focus panels, etc.).',               order: 100 },
  'terminal':    { label: 'terminal',    blurb: 'run shell commands on the host machine.',                                            order: 110 },
};

interface IGroupedCategoryEntry {
  readonly category: ToolCategory | 'other';
  readonly label: string;
  readonly blurb: string;
  readonly toolNames: readonly string[];
  /** Sort key in the prompt (lower = first). */
  readonly order: number;
}

function groupToolsByCategory(tools: readonly IToolSummary[]): Map<ToolCategory | 'other', string[]> {
  const map = new Map<ToolCategory | 'other', string[]>();
  let sawAnyCategory = false;
  for (const t of tools) {
    if (t.category) {
      sawAnyCategory = true;
      const bucket = map.get(t.category) ?? [];
      bucket.push(t.name);
      map.set(t.category, bucket);
    } else {
      const bucket = map.get('other') ?? [];
      bucket.push(t.name);
      map.set('other', bucket);
    }
  }
  // If no tool has a category, suppress the map entirely — the preamble alone
  // is enough and we don't want to emit a single "other" bucket holding
  // everything.
  if (!sawAnyCategory) { return new Map(); }
  return map;
}

function orderCategoryEntries(
  map: Map<ToolCategory | 'other', string[]>,
): IGroupedCategoryEntry[] {
  const entries: IGroupedCategoryEntry[] = [];
  for (const [category, names] of map.entries()) {
    if (category === 'other') {
      // Extension tools rarely declare a `ToolCategory`, so they'd otherwise
      // pile into one undifferentiated "other" blob. Split the bucket by
      // tool-name namespace (the segment before the first underscore) so each
      // extension's family reads as its own labelled group. Names are
      // snake_case (normalized at registration), so `budget_pull_emails` and
      // `budget_record_transaction` group under `budget`. Tools with no
      // namespace fall through to a residual "other" group.
      // Snake_case is universal, so splitting on the first underscore would
      // make every lone tool its own one-item "namespace". Only form a group
      // when at least two tools share the prefix (a real extension family);
      // otherwise the tool stays in the residual "other" bucket.
      const byPrefix = new Map<string, string[]>();
      for (const name of names) {
        const sep = name.indexOf('_');
        const ns = sep > 0 ? name.slice(0, sep) : '';
        const bucket = byPrefix.get(ns) ?? [];
        bucket.push(name);
        byPrefix.set(ns, bucket);
      }
      const namespaced = new Map<string, string[]>();
      const bare: string[] = [];
      for (const [ns, bucket] of byPrefix) {
        if (ns && bucket.length >= 2) namespaced.set(ns, bucket);
        else bare.push(...bucket);
      }
      // Namespaced groups, alphabetised, after the known categories.
      const nsList = [...namespaced.keys()].sort();
      nsList.forEach((ns, i) => {
        entries.push({
          category: 'other',
          label: ns,
          blurb: `\`${ns}_*\` extension tools — copy each name exactly.`,
          toolNames: namespaced.get(ns)!.slice().sort(),
          order: 1000 + i,
        });
      });
      // Residual tools with no namespace go last.
      if (bare.length > 0) {
        entries.push({
          category: 'other',
          label: 'other',
          blurb: 'tools without a declared category — read each tool\'s description for usage.',
          toolNames: bare.slice().sort(),
          order: 9999,
        });
      }
    } else {
      const desc = CATEGORY_DESCRIPTORS[category];
      entries.push({
        category,
        label: desc.label,
        blurb: desc.blurb,
        toolNames: [...names].sort(),
        order: desc.order,
      });
    }
  }
  entries.sort((a, b) => a.order - b.order);
  return entries;
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
 * The tools `memory_get` / `memory_search` / `memory_edit` carry their own
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
    '- `lessons/<slug>.md` — durable lessons (tool-use gotchas, workarounds, project conventions, things to remember across sessions). Read a body on demand with `memory_get name=<slug>` (preferred) or `read_file lessons/<slug>.md`.',
    '- `YYYY-MM-DD.md` — date-stamped daily logs. Unbounded; append-only narrative of what happened today.',
    '',
    '**Three tools, one family**:',
    '- `memory_get` — read USER.md, MEMORY.md (the index), a daily log by date, OR a specific lesson body via `name=<slug>`.',
    '- `memory_search` — semantic search across all of `.parallx/memory/` (index + lesson bodies + dailies).',
    '- `memory_edit` — add / replace / remove on USER.md, MEMORY.md sections, daily logs, AND lessons (via `file=lesson` with `slug` + `description` + `entry`).',
    '',
    '**Read memory before answering** when the user references prior context ("you said earlier…", "what did we decide…"), asks what you know about a person/project/topic, or you\'re about to make a recommendation that hinges on a past decision. Scan the index in MEMORY.md for matching descriptions — if one fits, open the lesson body. Prefer `memory_search` for topic recall, `memory_get` when you know the exact file or slug.',
    '',
    '**Write memory** when you\'ve learned something durable. Call `memory_edit` proactively in these cases:',
    '- The user states a preference about how you should behave ("I prefer X", "always do Y", "use Z") → `file=USER`.',
    '- The user reveals a stable fact about themselves (role, project, environment, constraints) → `file=USER`.',
    '- **The user corrects you** ("don\'t do X", "that\'s wrong, it\'s Y", "use Z instead of W", "you got that backwards") → `memory_edit file=lesson action=add` with a slug like `correction-<topic>`. A correction is not a passing preference — record the exact thing you got wrong and the right answer so you don\'t repeat the mistake. Cite the cue explicitly in the body.',
    '- You notice a tool-use pattern that should not be repeated (you called the wrong tool, missed an argument, hit a known failure mode) → `file=lesson`.',
    '- A workaround or gotcha emerges that future sessions will need (a known bug, an upstream limitation, a non-obvious fix) → `file=lesson`.',
    '- A project-level decision is made or a non-obvious fact about the project surfaces ("we\'re going with Postgres", "this repo uses 2-space indent") → `file=lesson` (MEMORY.md is the index that surfaces it).',
    '- Something noteworthy happened today and the user will want to look it up later → `file=daily`.',
    '',
    '**Cap discipline** — USER.md and the MEMORY.md index are bounded. When `memory_edit add` would exceed the cap, the tool returns the current entries and an error. Pick the least-relevant existing lesson and `memory_edit file=lesson action=remove slug=<old>` before retrying the add. The cap is a curation forcing function: only the most durable, generally-applicable lessons stay in the index.',
    '',
    'If memory contains a claim that names a specific file, function, or value, verify it against the current workspace before acting on it — memory can go stale.',
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
