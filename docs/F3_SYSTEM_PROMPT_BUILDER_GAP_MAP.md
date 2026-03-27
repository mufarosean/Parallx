# F3 — System Prompt Builder — Gap Map (Change Plans)

**Gap Mapper:** AI Senior Architect  
**Date:** 2026-04-17  
**Domain:** F3 — System Prompt Builder + Prompt Artifacts  
**Input:** `docs/F3_SYSTEM_PROMPT_BUILDER_AUDIT.md`  
**Upstream baseline:** OpenClaw commit e635cedb  

---

## Change Plan Overview

| Gap ID | Severity | Classification | Summary | Dependency |
|--------|----------|----------------|---------|------------|
| F3-3 | HIGH | MISALIGNED → ALIGNED | Add safety section (no self-preservation, human oversight) | None |
| F3-5 | MEDIUM | MISALIGNED → ALIGNED | Add skills scan instruction + constraint + rate-limit guidance | None |
| F3-6 | LOW | MISALIGNED → ALIGNED | Fix tool summaries to upstream format (plain name: desc) | None |
| F3-9 | MEDIUM | MISALIGNED → ALIGNED | Add preferences and overlay sections to builder | None |
| F3-10 | LOW | MISALIGNED → ALIGNED | Complete runtime section (optional OS/arch/shell fields) | None |
| F3-11 | HIGH | MISALIGNED → ALIGNED | Replace query-specific behavioral patches with framework-level rules | None |
| F3-12 | HIGH | MISALIGNED → ALIGNED | Create model tier resolution module (small/medium/large) | None |
| F3-13 | MEDIUM | MISALIGNED → ALIGNED | Add model-tier-conditional guidance sections | Depends on F3-12 |
| F3-16 | HIGH | MISALIGNED → ALIGNED | Wire modelTier, supportsTools, systemBudgetTokens through artifacts layer | Depends on F3-12 |
| F3-17 | MEDIUM | MISALIGNED → ALIGNED | Add skill state runtime with model-visibility filter | None |
| F3-18 | HIGH | MISSING → ALIGNED | Create comprehensive unit test suite | Depends on all above |
| F3-19 | MEDIUM | MISALIGNED → ALIGNED | Add tool state runtime: dedup, policy filter, collision detection | None |

**Dependency order:** F3-3, F3-5, F3-6, F3-9, F3-10, F3-11, F3-12 (parallel) → F3-13, F3-16, F3-17, F3-19 → F3-18

---

## Change Plan: F3-3 — Safety Section

### Gap
System prompt had no safety section. No guardrails against self-preservation, manipulation, or safeguard bypass.

### Upstream citation
`agents/system-prompt.ts:378-385` — explicit safety rules block.

### File: `src/openclaw/openclawSystemPrompt.ts`

**Action:** Add `buildSafetySection()` function. Insert after identity section (position 1b). Content:
- No independent goals (self-preservation, replication, resource acquisition, power-seeking)
- Prioritize safety and human oversight; pause on conflicting instructions
- No manipulation to expand access or disable safeguards
- No self-copying or unauthorized system prompt modification

---

## Change Plan: F3-5 — Skills Constraint Instructions

### Gap
Skills section listed XML entries but lacked the mandatory scan instruction, select-one constraint, and rate-limit/API-write guidance.

### Upstream citation
`agents/system-prompt.ts:20-37` — scan instruction pattern.  
`agents/skills/workspace.ts:633-724` — XML skill entries with mandatory scan.

### File: `src/openclaw/openclawSystemPrompt.ts` — `buildSkillsSection()`

**Action:** Rewrite skills section preamble:
- "Before replying: scan `<available_skills>` `<description>` entries."
- Select most specific if multiple apply; select exactly one if clearly applicable
- "Constraints: never read more than one skill up front; only read after selecting."
- Rate-limit guidance: prefer fewer larger writes, avoid tight one-item loops, serialize bursts, respect 429/Retry-After.

---

## Change Plan: F3-6 — Tool Summaries Format

### Gap
Tool section used bold `**name**` formatting and `## Available Tools` heading.

### Upstream citation
`pi-embedded-runner/system-prompt.ts:74` — `buildToolSummaryMap`: plain `name: description`.

### File: `src/openclaw/openclawSystemPrompt.ts` — `buildToolSummariesSection()`

**Action:**
- Change heading to `Tool availability (filtered by policy):`
- Change format from `**name**: description` to `- name: description`
- One line per tool, no bold, no markdown formatting on name

---

## Change Plan: F3-9 — Preferences and Overlay Sections

### Gap
Builder accepted `preferencesPrompt` and `promptOverlay` params but never emitted sections for them.

### Upstream citation
`agents/system-prompt.ts` — user preferences and pattern rules injected as dedicated sections.

### File: `src/openclaw/openclawSystemPrompt.ts` — `buildOpenclawSystemPrompt()`

**Action:**
- After context engine addition (section 5), add preferences section: `## User Preferences\n${preferencesPrompt}`
- After preferences, add overlay section: `## Active Rules\n${promptOverlay}`
- Both gated by non-empty check

---

## Change Plan: F3-10 — Runtime Metadata Section

### Gap
Runtime section was incomplete — missing optional OS, architecture, shell fields.

### Upstream citation
`agents/system-prompt.ts` — runtimeInfo includes platform metadata.

### File: `src/openclaw/openclawSystemPrompt.ts` — `buildRuntimeSection()`

**Action:**
- Add conditional lines for `os`, `arch`, `shell` from `IOpenclawRuntimeInfo`
- Format: `- OS: ${os}`, `- Architecture: ${arch}`, `- Shell: ${shell}`
- Only emit when values are present (optional chaining)

---

## Change Plan: F3-11 — Behavioral Rules (Framework-Level)

### Gap
Behavioral section contained query-specific patches (eval-driven patchwork). Violated M41 Anti-Pattern A1: Patch-thinking.

### Upstream citation
`agents/system-prompt.ts` — framework-level behavioral rules only.

### File: `src/openclaw/openclawSystemPrompt.ts` — `buildBehavioralRulesSection()`

**Action:** Replace entire section with framework-level rules:
- Answer from workspace context, cite specific files
- Use exact values from source documents for facts
- Acknowledge information gaps explicitly
- Be thorough, cover all relevant aspects
- Use structured formatting (headings, lists, bold)
- Synthesize multiple sources rather than repeating each

**Explicitly NOT included (M41 violation):** Query-specific rules about deductibles, policy numbers, or claim procedures. Those are eval-driven patches.

---

## Change Plan: F3-12 — Model Tier Resolution

### Gap
No model tier resolution existed. All models received identical prompt content.

### Upstream citation
`buildAgentSystemPrompt` adjusts based on model capabilities. Parallx local models are parameter-size-named.

### File: `src/openclaw/openclawModelTier.ts` (NEW)

**Action:** Create new module:
- Type: `ModelTier = 'small' | 'medium' | 'large'`
- Function: `resolveModelTier(modelName: string): ModelTier`
- Pattern: extract numeric `\d+[bB]` from model name → `≤8` = small, `≤32` = medium, `>32` = large
- Default (no match): `medium` (safe for cloud models like gpt-4o, claude)

---

## Change Plan: F3-13 — Model-Tier-Conditional Guidance

### Gap
No conditional sections for different model sizes.

### Upstream citation
`buildAgentSystemPrompt` — adjusts guidance based on capabilities.

### File: `src/openclaw/openclawSystemPrompt.ts`

**Action:**
- Add `buildSmallModelGuidance()`: step-by-step reasoning encouragement, conciseness cues, uncertainty acknowledgment, focus on most relevant files
- Gate with `params.modelTier === 'small'` (section 9)
- Add `buildNoToolsFallbackNote()`: structured text output instructions when `supportsTools === false` (section 10)
- Both as functions, both conditional in main builder

---

## Change Plan: F3-16 — Prompt Artifacts Layer Wiring

### Gap
`buildOpenclawPromptArtifacts` did not forward `modelTier`, `supportsTools`, or `systemBudgetTokens` to the system prompt builder.

### Upstream citation
`attempt.ts:1672-3222` — attempt layer wires all model capabilities to prompt builder.

### File: `src/openclaw/openclawPromptArtifacts.ts`

**Action:**
- Add `modelTier`, `supportsTools`, `systemBudgetTokens` to `IOpenclawPromptArtifactInput`
- Forward `modelTier` directly to `buildOpenclawSystemPrompt` params
- Forward `supportsTools` with fallback: `input.supportsTools ?? input.toolState.availableDefinitions.length > 0`
- Forward `systemBudgetTokens` directly

### File: `src/openclaw/openclawAttempt.ts`

**Action:**
- Import and call `resolveModelTier(context.runtimeInfo.model)` in `executeOpenclawAttempt`
- Pass result as `modelTier` to `buildOpenclawPromptArtifacts`
- Compute `systemBudgetTokens: Math.floor(context.tokenBudget * 0.10)`
- Add `participantId` to prompt provenance

---

## Change Plan: F3-17 — Skill State Runtime Visibility Filter

### Gap
Skill catalog was passed unfiltered to prompt builder. All skill kinds appeared in system prompt.

### Upstream citation
Upstream filters skills to model-visible only: workflow kind + `disableModelInvocation !== true`.

### File: `src/openclaw/openclawSkillState.ts` (NEW)

**Action:** Create runtime skill state builder:
- Interface: `IOpenclawRuntimeSkillState` with catalog, promptEntries, promptReportEntries, counts
- Function: `buildOpenclawRuntimeSkillState(catalog)`
- Filter: `skill.kind === 'workflow' && skill.disableModelInvocation !== true` → model-visible
- Map visible skills to `ISkillEntry` format for prompt builder
- Compute report entries with block char estimation for XML
- Track totalCount, visibleCount, hiddenCount

---

## Change Plan: F3-19 — Tool State Runtime Processing

### Gap
Tool definitions passed to builder without deduplication, policy filtering, or collision detection.

### Upstream citation
Upstream tool state: dedup by name, apply policy profile, detect skill-platform collisions.

### File: `src/openclaw/openclawToolState.ts` (NEW)

**Action:** Create runtime tool state builder:
- Interface: `IOpenclawRuntimeToolState` with exposed/available definitions, report entries, counts
- Function: `buildOpenclawRuntimeToolState({ platformTools, skillCatalog, mode, permissions? })`
- Deduplication: first wins for same-name platform tools
- Policy profile: `readonly` / `standard` / `full` via existing `applyOpenclawToolPolicy`
- Skill-derived tools: build `IToolDefinition` from skill catalog entries where `kind === 'tool'`
- Collision detection: if skill tool name matches platform tool name → mark `filteredReason: 'name-collision'`, exclude from available
- Report: per-tool entry with source, sizes, exposed/available/filteredReason

---

## Change Plan: F3-18 — Unit Test Suite

### Gap
Zero unit tests for any module in the F3 domain.

### Upstream citation
Framework-level: M41 convergence protocol requires test coverage for every structural module.

### File: `tests/unit/openclawSystemPrompt.test.ts` (NEW)

**Action:** Create comprehensive test suite covering:

1. **buildOpenclawSystemPrompt** (15 tests):
   - Identity section first
   - Safety section after identity, before skills
   - All mandatory safety lines present
   - Skills section with scan instruction
   - Skills constraint instructions
   - Skills omitted when empty
   - Tool summaries correct format
   - Tools omitted when empty
   - Workspace context includes bootstrap + digest
   - systemPromptAddition included
   - Preferences included
   - Overlay included
   - Runtime section
   - Behavioral rules section
   - Section ordering (Identity → Safety → Skills → Tools → Workspace → Runtime → Behavioral)

2. **buildSkillsSection** (4 tests): XML tags, scan instruction, constraints, XML escaping

3. **buildToolSummariesSection** (3 tests): heading, line format, one line per tool

4. **buildWorkspaceSection** (4 tests): bootstrap files, digest, order, empty file skip

5. **buildRuntimeSection** (3 tests): mandatory fields, optional fields, omit absent

6. **buildBehavioralRulesSection** (2 tests): heading, citation/accuracy guidance

7. **estimateSystemPromptTokens** (2 tests): positive number, chars/4 match

8. **Budget-aware truncation** (3 tests): no truncation under budget, truncation over budget, safety preserved

9. **resolveModelTier** (4 tests): small (≤8B), medium (9-32B), large (>32B), unrecognized defaults

10. **buildOpenclawPromptArtifacts** (5 tests): produces report, forwards modelTier, forwards budget, supportsTools explicit vs. fallback, report metrics

11. **buildOpenclawRuntimeSkillState** (3 tests): workflow filter, disableModelInvocation exclusion, empty catalog

12. **buildOpenclawRuntimeToolState** (3 tests): dedup, policy filtering, name collision

**Total: 56 tests**
