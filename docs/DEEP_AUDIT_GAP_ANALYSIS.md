# Parallx Deep Audit — Gap Analysis

> **Branch:** `m42-surface-adapt-discover` | **Baseline:** 0 compile errors, 2,446 tests pass  
> **Date:** Post-M42 | **Purpose:** Triage gaps → narrow, keep Parallx-specific, or skip

---

## How to Read This Document

Every gap is categorized by **severity** and **recommendation**:

| Tag | Meaning |
|-----|---------|
| 🔴 CRITICAL | Bugs or missing logic that will cause user-visible failures |
| 🟡 PARITY | Feature exists upstream (OpenClaw/VS Code) but missing in Parallx |
| 🟢 PARALLX | Parallx-specific design choice — works differently on purpose |
| ⚪ SKIP | Not relevant for a local-first Markdown workspace app |

**Action needed from you:** For each gap, confirm the recommendation or override it.

---

## 1 — CRITICAL GAPS (🔴)

These are bugs or missing implementations that cause silent failures or incorrect behavior today.

### 1.1 Malformed Tool JSON Silent Drop
- **Where:** `ollamaProvider.ts` ~L683-708
- **Problem:** If Ollama returns a tool call with malformed JSON, it's `console.warn`'d and silently skipped. User sees incomplete response, no error indication.
- **Upstream:** VS Code validates tool call JSON schema against `IToolDefinition.parameters`.
- **Recommendation:** 🔴 NARROW — Add validation + surface error to user.

### 1.2 Evidence Assessment Functions Are Stubs
- **Where:** `openclawContextEngine.ts` L172-198, `openclawResponseValidation.ts`
- **Problem:** `assessEvidence()` and `buildEvidenceConstraint()` are imported and called but the implementations are stubs. The re-retrieval code path exists but assessment always returns a default, so re-retrieval never triggers.
- **Upstream:** Full evidence grading with citation extraction + extractive fallback.
- **Recommendation:** 🔴 NARROW — Wire real implementation or remove dead code path.

### 1.3 No Automatic Compact Trigger
- **Where:** `openclawContextEngine.ts` L202-261
- **Problem:** `compact()` must be called manually (via `/compact` command). When conversation exceeds context window, history is just truncated — no auto-summarization.
- **Upstream:** Auto-triggers on overflow detection before next turn.
- **Recommendation:** 🔴 NARROW — Add overflow detector that auto-invokes compact before turn.

### 1.4 No Mid-Stream Context Overflow Detection
- **Where:** `openclawAttempt.ts` tool loop
- **Problem:** `numCtx` set once at request start. During tool loop, tool results accumulate (`MAX_TOOL_RESULT_CHARS = 20,000` per tool is ad-hoc). No check that accumulated context still fits.
- **Upstream:** Re-budgets after each tool call in loop.
- **Recommendation:** 🔴 NARROW — Add tool-loop budget check after each tool result append.

### 1.5 Stream Drop = Silent Incomplete Response
- **Where:** `ollamaProvider.ts` L605-631
- **Problem:** If network drops mid-stream, partial markdown is returned to UI with no error indicator. Token counts lost (only in final chunk). User sees an incomplete answer and may think it's complete.
- **Upstream:** Retry logic with exponential backoff on stream failures.
- **Recommendation:** 🔴 NARROW — Add stream-failure indicator + optional retry prompt.

---

## 2 — UPSTREAM PARITY GAPS (🟡)

Features that exist in VS Code Copilot Chat / OpenClaw but are absent or stubbed in Parallx.

### 2.1 Implicit Context Variables (#selection, #activeFile)
- **Where:** Chat input / variable resolution
- **Problem:** VS Code supports `#selection`, `#activeFile`, `#terminal` as implicit context. Parallx has `#file` via `resolveFileVariable` but no selection or active-file injection.
- **Recommendation:** 🟡 NARROW — `#activeFile` is useful for "explain this document". `#selection` less relevant (no code editor).

### 2.2 Followup Suggestions
- **Where:** Chat response rendering
- **Problem:** VS Code shows clickable followup suggestions after assistant responses. Parallx has no followup provider.
- **Recommendation:** 🟡 NARROW — Improves discoverability. Can use model to generate 2-3 followups.

### 2.3 Slash Command Provider Registry
- **Where:** `chatAgentService.ts` / command resolution
- **Problem:** VS Code has a formal `ISlashCommandProvider` extension point. Parallx has hardcoded built-in commands (`/init`, `/context`, `/compact`) but no registry for extensions.
- **Recommendation:** 🟡 NARROW (low priority) — Registry pattern is cleaner but not blocking.

### 2.4 Semantic Session Search (Stub)
- **Where:** `chatService.ts`
- **Problem:** `searchSessions()` exists but is a substring-match stub. VS Code has embedding-based semantic search across chat history.
- **Recommendation:** 🟡 NARROW — Useful for "find that conversation where we discussed X".

### 2.5 Edit Mode Not Wired to Canvas
- **Where:** `chatModeService.ts` — Edit mode exists in mode list but has no special behavior
- **Problem:** In VS Code, Edit mode enables inline code edits with diff preview. In Parallx, Edit mode behaves identically to Agent mode.
- **Recommendation:** 🟡 NARROW — Wire Edit mode to canvas inline editing (apply markdown suggestions as tracked changes).

### 2.6 Variable Resolution Not Integrated in Execution
- **Where:** `openclawTurnPreprocessing.ts` / `chatVariableService.ts`
- **Problem:** `chatVariableService` exists but `resolveVariables` is not called during turn preprocessing. Variables like `#file:path` rely on mention resolution instead.
- **Recommendation:** 🟡 NARROW (medium) — Unify mention resolution and variable resolution.

### 2.7 Token Budget Enforcement During Streaming
- **Where:** `tokenBudgetService.ts` + `openclawAttempt.ts`
- **Problem:** Token budget is pre-flight only. The elastic allocator runs once before the request. No adaptive re-allocation during tool loop or streaming.
- **Recommendation:** 🟡 NARROW — At minimum, re-budget between tool calls in the loop.

### 2.8 Approval Strictness Config Not Wired
- **Where:** `permissionService.ts` / approval UI in `main.ts`
- **Problem:** The approval UI renders (Accept/Session/Always/Reject) and works, but the strictness level config (`always-ask`, `trust-reads`, `trust-all`) from settings is not enforced in the permission check logic.
- **Recommendation:** 🟡 NARROW — Wire the existing config to the approval gate.

### 2.9 No Approval Audit Log
- **Where:** `permissionService.ts`
- **Problem:** Tool approvals are not logged. No record of what the user approved or rejected. VS Code persists per-session approval decisions.
- **Recommendation:** 🟡 NARROW (low) — Add simple session-scoped approval record.

### 2.10 Thinking Tag State Cleanup on Model Switch
- **Where:** `ollamaProvider.ts` L127
- **Problem:** `_inThinkTag` (thinking block parser state) and `_noThinkModels` cache persist across model switches. If user switches from a thinking model to a non-thinking model mid-session, stale state may cause parsing artifacts.
- **Recommendation:** 🟡 NARROW — Reset parser state on model switch.

---

## 3 — PARALLX-SPECIFIC (🟢)

Design choices that differ from upstream intentionally.

### 3.1 NDJSON Streaming (Not SSE)
- **Where:** `ollamaProvider.ts`
- **Detail:** Uses raw HTTP chunked transfer with newline-delimited JSON instead of SSE. This is correct for Ollama's API — Ollama doesn't speak SSE.
- **Recommendation:** 🟢 KEEP — Correct for local Ollama. No change needed.

### 3.2 Workspace-Scoped AI Config
- **Where:** `.parallx/ai-config.json`
- **Detail:** Parallx stores AI configuration per-workspace in a `.parallx/` folder within the workspace. VS Code uses global settings + extension settings.
- **Recommendation:** 🟢 KEEP — Core Parallx differentiator. Workspace portability.

### 3.3 Skills as JSON Manifests
- **Where:** `src/built-in/chat/skills/builtInSkillManifests.ts`
- **Detail:** Parallx defines skills as declarative JSON manifests with triggers and prompts. VS Code uses procedural skill registration via API.
- **Recommendation:** 🟢 KEEP — Cleaner, more auditable. Users can eventually add custom skills as JSON.

### 3.4 Three Participants (Expert/Navigator/Librarian)
- **Where:** `registerOpenclawParticipants.ts`
- **Detail:** Parallx registers 3 domain-specific participants vs VS Code's single `@workspace` agent. Each has different system prompt and tool access.
- **Recommendation:** 🟢 KEEP — Better for domain specialization in workspace context.

### 3.5 Canvas/Sidebar Integration
- **Where:** Canvas rendering, sidebar panels
- **Detail:** Parallx renders AI-suggested changes in the canvas as tracked changes. VS Code uses inline diff in code editor.
- **Recommendation:** 🟢 KEEP — Correct UX for document-first (not code-first) workflow.

### 3.6 Graph-Based Document Relationships
- **Where:** `tools/graph-v3/`
- **Detail:** Parallx builds a relationship graph between workspace documents. VS Code has no equivalent — it relies on language server symbol index.
- **Recommendation:** 🟢 KEEP — Core differentiator for connected knowledge.

### 3.7 Keep-Alive Model Pinning
- **Where:** `ollamaProvider.ts` — `keep_alive: '30m'`
- **Detail:** Prevents Ollama from unloading model between requests. Trades RAM for response speed.
- **Recommendation:** 🟢 KEEP — Essential for local-first UX where cold starts destroy flow.

### 3.8 PDF/Document Extraction Pipeline
- **Where:** `electron/documentExtractor.cjs`, `tools/docling-bridge/`
- **Detail:** Parallx extracts text from PDFs, DOCXs via Docling bridge. No VS Code equivalent.
- **Recommendation:** 🟢 KEEP — Core feature for insurance/legal document workflows.

### 3.9 Model Probing & Tier Detection
- **Where:** `languageModelsService.ts` — probeModelCapabilities()
- **Detail:** Auto-detects model capabilities (thinking, tools, vision) and assigns tier. VS Code knows model caps from API metadata.
- **Recommendation:** 🟢 KEEP — Necessary for local Ollama where model metadata is sparse.

### 3.10 Autonomy Level Selector
- **Where:** `chatModePicker.ts` — Manual/Allow Reads/Allow Safe/Custom
- **Detail:** Parallx has granular autonomy control. VS Code has binary "auto-approve" toggle.
- **Recommendation:** 🟢 KEEP — Better trust model for tool execution.

---

## 4 — NOT RELEVANT (⚪)

Upstream features that don't apply to Parallx's use case.

### 4.1 Inline Chat (Editor Overlay)
- **Detail:** VS Code shows a chat widget inline in the code editor at cursor position.
- **Why Skip:** Parallx is document-first. The canvas editor handles inline interactions differently. No code cursor context.
- **Recommendation:** ⚪ SKIP

### 4.2 Terminal Chat Integration
- **Detail:** VS Code has `@terminal` participant and terminal context injection.
- **Why Skip:** Parallx doesn't have a terminal. Users work with documents, not code.
- **Recommendation:** ⚪ SKIP

### 4.3 Notebook Chat
- **Detail:** VS Code integrates chat with Jupyter notebooks.
- **Why Skip:** Parallx is not a notebook environment.
- **Recommendation:** ⚪ SKIP

### 4.4 Quick Chat (Lightweight Overlay)
- **Detail:** VS Code has a quick-chat dropdown (Cmd+Shift+I) for one-shot questions.
- **Why Skip:** Parallx's sidebar chat is always visible. Quick chat adds UX complexity without clear benefit.
- **Recommendation:** ⚪ SKIP (revisit if users request it)

### 4.5 Language Server Symbol Index
- **Detail:** VS Code uses LSP symbol providers for code navigation context.
- **Why Skip:** Parallx works with Markdown/documents. Graph relationships replace symbol index.
- **Recommendation:** ⚪ SKIP

### 4.6 Extension API for Chat Participants
- **Detail:** VS Code has a public extension API for registering chat participants.
- **Why Skip:** Parallx is a standalone Electron app, not an extension host. Participants are built-in.
- **Recommendation:** ⚪ SKIP (until plugin system needed)

### 4.7 Copilot Completions (Ghost Text)
- **Detail:** VS Code shows inline code completions as ghost text while typing.
- **Why Skip:** Ghost text for Markdown is low value. Parallx focuses on chat-driven assistance.
- **Recommendation:** ⚪ SKIP

### 4.8 Multi-Provider Model Routing
- **Detail:** VS Code routes to GitHub Copilot, Azure OpenAI, or local models via provider registry.
- **Why Skip:** Parallx targets local Ollama. Multi-provider adds complexity without current need.
- **Recommendation:** ⚪ SKIP (until OpenAI/Anthropic API support requested)

---

## 5 — SUMMARY MATRIX

| # | Gap | Severity | Recommendation | Effort |
|---|-----|----------|---------------|--------|
| 1.1 | Malformed tool JSON silent drop | 🔴 | NARROW | S |
| 1.2 | Evidence assessment stubs | 🔴 | NARROW | M |
| 1.3 | No auto-compact trigger | 🔴 | NARROW | M |
| 1.4 | No mid-stream overflow detection | 🔴 | NARROW | M |
| 1.5 | Stream drop = silent incomplete | 🔴 | NARROW | S |
| 2.1 | No #activeFile context | 🟡 | NARROW | S |
| 2.2 | No followup suggestions | 🟡 | NARROW | M |
| 2.3 | No slash command registry | 🟡 | NARROW (low) | M |
| 2.4 | Semantic session search stub | 🟡 | NARROW | L |
| 2.5 | Edit mode not wired | 🟡 | NARROW | L |
| 2.6 | Variable resolution not integrated | 🟡 | NARROW | M |
| 2.7 | Token budget streaming enforcement | 🟡 | NARROW | M |
| 2.8 | Approval strictness not wired | 🟡 | NARROW | S |
| 2.9 | No approval audit log | 🟡 | NARROW (low) | S |
| 2.10 | Thinking tag state on model switch | 🟡 | NARROW | S |
| 3.1–3.10 | Parallx-specific features | 🟢 | KEEP | — |
| 4.1–4.8 | Irrelevant upstream features | ⚪ | SKIP | — |

**Effort key:** S = small (< 50 LOC), M = medium (50-200 LOC), L = large (200+ LOC)

---

## 6 — RECOMMENDED NEXT MILESTONE SCOPE

If narrowing all 🔴 CRITICAL + high-priority 🟡 PARITY gaps:

**Phase 1 — Reliability (🔴 1.1, 1.3, 1.4, 1.5):**
- Tool call JSON validation + user error surfacing
- Auto-compact trigger on overflow
- Tool-loop budget re-check
- Stream failure indicator

**Phase 2 — Completeness (🔴 1.2, 🟡 2.1, 2.7, 2.8, 2.10):**
- Wire evidence assessment or remove dead path
- Add #activeFile implicit context
- Token re-budget in tool loop
- Wire approval strictness config
- Reset parser state on model switch

**Phase 3 — Discoverability (🟡 2.2, 2.6):**
- Followup suggestion provider
- Unify variable + mention resolution

**Deferred (🟡 2.3, 2.4, 2.5, 2.9):**
- Slash command registry
- Semantic session search
- Edit mode canvas wiring
- Approval audit log
