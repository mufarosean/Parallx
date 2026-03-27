# F3 System Prompt Builder — Iteration 1 Audit

**Auditor:** AI Parity Auditor  
**Date:** 2026-04-17  
**Domain:** F3 — System Prompt Builder + Prompt Artifacts  
**Upstream baseline:** OpenClaw commit e635cedb  
**Parallx Files Audited:** 8 files in `src/openclaw/`

---

## Summary

| Metric | Value |
|--------|-------|
| Capabilities audited | 20 |
| ALIGNED | 8 |
| MISALIGNED | 11 |
| MISSING | 1 |

---

## Per-Capability Findings

### ALIGNED (8)

| # | Capability | File | Evidence |
|---|---|---|---|
| F3-1 | Multi-section structured builder | `openclawSystemPrompt.ts` | `buildOpenclawSystemPrompt` produces ordered sections matching upstream `buildAgentSystemPrompt` multi-section structure (agents/system-prompt.ts:110-400). Sections composed sequentially, joined by `\n\n`. |
| F3-2 | Identity section | `openclawSystemPrompt.ts` | `buildIdentitySection` emits opening line with model name and provider. Upstream: first line of `buildAgentSystemPrompt`. Correct position (section 1). |
| F3-4 | Skills section uses XML-tagged entries | `openclawSystemPrompt.ts` | `buildSkillsSection` wraps each skill in `<skill><name>…</name><description>…</description><location>…</location></skill>` inside `<available_skills>` block. Matches upstream `agents/skills/workspace.ts:633-724` XML pattern. |
| F3-7 | Workspace context (bootstrap files + digest) | `openclawSystemPrompt.ts` | `buildWorkspaceSection` iterates bootstrap files in M11 layering order (SOUL.md → AGENTS.md → TOOLS.md), appends workspace digest (~2000 tokens). Matches upstream `resolveBootstrapContextForRun` (bootstrap-files.ts:47-118). Skips empty files. |
| F3-8 | Context engine addition positioning | `openclawSystemPrompt.ts` | `systemPromptAddition` injected at section 5 (after workspace context, before preferences). Documented adaptation: upstream appends at end; Parallx places earlier because local models weight earlier prompt content more heavily. Acceptable Parallx adaptation. |
| F3-14 | No-tools fallback note | `openclawSystemPrompt.ts` | `buildNoToolsFallbackNote` emits structured instructions for models without native tool calling. Gated by `supportsTools === false`. Upstream: no equivalent (cloud models always support tools). Parallx-specific adaptation for local model compatibility. |
| F3-15 | Budget-aware system prompt truncation | `openclawSystemPrompt.ts` | `truncateSystemPromptToBudget` truncates variable sections (workspace context first, then tool summaries) when total exceeds `systemBudgetTokens`. Safety, identity, and skills are never truncated. Matches upstream size-management via `agents.defaults.bootstrapMaxChars`. |
| F3-20 | Token budget computation (M11 10/30/30/30) | `openclawTokenBudget.ts` | `computeTokenBudget` splits context window into System 10%, RAG 30%, History 30%, User 30%. `estimateTokens` re-exported from `tokenBudgetService`. `estimateMessagesTokens` accounts for 4-token role overhead per message. Matches M11 spec and upstream budget patterns. |

### MISALIGNED (11)

| # | Capability | File | Gap | Upstream Pattern |
|---|---|---|---|---|
| F3-3 | Safety section | `openclawSystemPrompt.ts` | No safety section existed. Prompt started with identity, jumped directly to skills. | Upstream: `system-prompt.ts:378-385` — explicit safety rules (no self-preservation, no power-seeking, human oversight priority, no manipulation). Required section in every system prompt. |
| F3-5 | Skills constraint instructions | `openclawSystemPrompt.ts` | Skills section listed entries but lacked mandatory scan instruction, select-one constraint, rate-limit guidance, and API-write serialization advice. | Upstream: `agents/system-prompt.ts:20-37` — scan `<available_skills>`, select most specific, never read >1 up front, respect rate limits and 429/Retry-After. |
| F3-6 | Tool summaries format | `openclawSystemPrompt.ts` | Tool section used bold `**name**` formatting and a `## Available Tools` heading inconsistent with upstream. | Upstream: `buildToolSummaryMap` (pi-embedded-runner/system-prompt.ts:74) — plain `name: description` one-liner format. Heading: "Tool availability (filtered by policy)". |
| F3-9 | Preferences and overlay sections | `openclawSystemPrompt.ts` | User preferences prompt and file-pattern overlay were not included in the system prompt output. Builder accepted the params but did not emit sections. | Upstream: user preferences and pattern rules injected as dedicated sections. Parallx M11 defines overlay layering from rules/ files. |
| F3-10 | Runtime metadata section | `openclawSystemPrompt.ts` | Runtime section was incomplete — missing optional fields (OS, architecture, shell) and did not match upstream `## Runtime` heading and line format. | Upstream: runtimeInfo section includes model, provider, host, version, and platform metadata. |
| F3-11 | Behavioral rules section | `openclawSystemPrompt.ts` | Behavioral section contained query-specific eval-driven patches (e.g., "when asked about deductibles, quote exact values") instead of framework-level guidance. Violated M41 Anti-Pattern: Patch-thinking. | Upstream: framework-level rules only — cite sources, use exact values, acknowledge gaps, structured formatting. No query-specific instructions. |
| F3-12 | Model tier resolution | N/A (file missing) | No model tier resolution existed. All models received identical prompt content regardless of parameter size. | Upstream: `buildAgentSystemPrompt` adjusts sections based on model capabilities. Local models vary dramatically (3B–72B), requiring tier-aware guidance. Pattern: extract parameter count from model name → categorize. |
| F3-13 | Model-tier-conditional guidance | `openclawSystemPrompt.ts` | No conditional sections for small vs. large models. A 7B model received the same verbosity and complexity as a 70B model. | Upstream: adjusts guidance based on model size. Small models need step-by-step encouragement and conciseness cues. Parallx adaptation: `## Small Model Guidance` section for ≤8B. |
| F3-16 | Prompt artifacts layer wiring | `openclawPromptArtifacts.ts` | `buildOpenclawPromptArtifacts` did not forward `modelTier`, `supportsTools`, or `systemBudgetTokens` to the system prompt builder. These params existed in the builder interface but were never populated. | Upstream: attempt layer passes model capabilities and budget constraints to prompt builder. All builder params that affect output must be wired end-to-end. |
| F3-17 | Skill state runtime visibility filter | `openclawSkillState.ts` | Skill catalog was passed to prompt builder unfiltered. All skills (workflow, tool, disabled) appeared in the system prompt. | Upstream: only model-visible skills (workflow kind + `disableModelInvocation !== true`) appear in the system prompt. Non-workflow skills and disabled skills are hidden from the model. |
| F3-19 | Tool state runtime processing | `openclawToolState.ts` | Tool definitions passed to builder without deduplication, policy filtering, or name-collision detection for skill-derived tools. | Upstream: tool state layer deduplicates by name (first wins), applies policy profile filtering (readonly/standard/full), and detects name collisions between platform tools and skill-derived tools. |

### MISSING (1)

| # | Capability | Gap | Upstream Pattern |
|---|---|---|---|
| F3-18 | Unit test coverage | Zero unit tests existed for system prompt builder, prompt artifacts, model tier resolution, skill state, or tool state. | Framework-level: every structural module requires test coverage. Upstream has integration tests for prompt assembly. Parallx requires unit tests per M41 convergence protocol. |

---

## Critical Finding: Prompt Quality Gap

```
Upstream buildAgentSystemPrompt (system-prompt.ts:110-400):
  1. Identity → 2. Safety → 3. Skills (XML + constraints) → 4. Tools (name: desc)
  → 5. Workspace → 6. Context addition → 7. Preferences → 8. Overlay
  → 9. Runtime → 10. Behavioral rules → 11. Model-tier guidance

Parallx buildOpenclawSystemPrompt (BEFORE audit):
  1. Identity → 2. Skills (XML, no constraints) → 3. Tools (wrong format)
  → 4. Workspace → 5. Context addition → 6. Behavioral (query-specific patches)
  
  MISSING: Safety, Preferences, Overlay, Runtime (partial), Model tier,
           Scan instruction, Rate-limit guidance, Framework-level behavioral rules
```

**Impact:** The system prompt was structurally incomplete. Missing safety rules meant no guardrails against self-preservation or manipulation behaviors. Missing scan instruction meant models processed skills incorrectly. Missing model-tier guidance meant 7B models received prompts optimized for much larger models. Query-specific behavioral patches violated M41's anti-patchwork principle.

---

## Upstream Reference Map

| Upstream File | Lines | What it defines | F3 Capabilities |
|---------------|-------|-----------------|-----------------|
| `agents/system-prompt.ts` | 110-400 | `buildAgentSystemPrompt`: ~30 params, multi-section output | F3-1, F3-2, F3-3, F3-9, F3-10, F3-11, F3-13 |
| `agents/system-prompt.ts` | 378-385 | Safety rules section | F3-3 |
| `agents/system-prompt.ts` | 20-37 | Skills section with constraints | F3-4, F3-5 |
| `agents/skills/workspace.ts` | 633-724 | XML skill entries with scan instruction | F3-4, F3-5 |
| `pi-embedded-runner/system-prompt.ts` | 74 | `buildToolSummaryMap`: Record<name, description> | F3-6 |
| `agents/bootstrap-files.ts` | 47-118 | `resolveBootstrapContextForRun`: bootstrap loading | F3-7, F3-15 |
| `context-engine/types.ts` | 104-230 | `AssembleResult` — systemPromptAddition | F3-8 |
| `attempt.ts` | 1672-3222 | `runEmbeddedAttempt`: prompt artifacts wiring | F3-16 |
