# Milestone 47 — Parity Extension: 8 Domains, 3 Iterations

**Status:** In Progress  
**Branch:** `m47-parity-extension`  
**Depends on:** Milestone 46 (commit `9efa836` on `m46-autonomy-mechanisms`)  
**Baseline:** 137 test files, 2638 tests, 0 failures, 0 tsc errors

---

## Vision

M41–M46 achieved structural parity with OpenClaw's core runtime (execution pipeline, context engine, system prompt builder, tool policy, routing, response quality, RAG, DI, memory, participant runtime). M47 extends this to 8 additional capability domains identified through broader gap research against the upstream OpenClaw project.

The goal: every AI capability surface in Parallx either faithfully implements an upstream OpenClaw pattern or is a documented Parallx adaptation with clear rationale. No heuristic patchwork, no invented patterns, no point fixes.

---

## Domains (Execution Order)

| # | Domain | ID | Description | Primary Files |
|---|--------|----|-------------|---------------|
| 1 | Agent Configuration | D8 | Config-driven agent definitions replacing hardcoded participants | `src/openclaw/agents/`, `src/aiSettings/` |
| 2 | Chat Commands | D2 | Full slash command surface: /status, /new, /models, /doctor, /think, /usage, /tools, /verbose | `src/openclaw/openclawDefaultRuntimeSupport.ts` |
| 3 | Doctor/Diagnostics | D3 | End-to-end health checks in panel tab | `src/built-in/diagnostics/` |
| 4 | Observability/Usage | D7 | Token counts, budget, timing in diagnostics surface | `src/built-in/chat/widgets/chatTokenStatusBar.ts` |
| 5 | Compaction Depth | D6 | Identifier preservation, quality audit, retry-with-quality-check | `src/openclaw/openclawContextEngine.ts` |
| 6 | Runtime Hooks | D4 | before_tool_call, after_tool_call, message hooks | `src/openclaw/openclawHooks.ts` |
| 7 | MCP Integration | D1 | MCP client in AI Settings, tool discovery via MCP protocol | `src/openclaw/mcp/` |
| 8 | Media/Vision | D5 | VLM support via Ollama vision models | `src/openclaw/openclawAttempt.ts` |

---

## Iteration Structure

Each domain goes through 3 iterations:

| Iteration | Focus | Gate |
|-----------|-------|------|
| **1: STRUCTURAL** | Build correct architecture, core contracts + implementation | Compiles, unit tests pass, audit shows ALIGNED on core capabilities |
| **2: REFINEMENT** | Edge cases, error handling, test coverage, UX integration | Full test suite passes, no regressions, UX Guardian clean |
| **3: PARITY CHECK** | Final audit, cross-domain cohesion, full test sweep | All capabilities ALIGNED, full suite green, domain CLOSED |

---

## Cross-Domain Cohesion

- D8 (Agent Config) feeds D2 (commands can be agent-aware)
- D2 (Commands) provides /doctor which surfaces D3 (Diagnostics)
- D3 (Diagnostics) consumes D7 (Observability) data
- D4 (Hooks) can intercept D1 (MCP) tool calls
- D5 (Vision) uses D8 (agent config) for model selection
- D6 (Compaction) is used by D2 (/compact command)

---

## UI Surface Decisions

- **MCP Config:** AI Settings panel
- **Doctor/Diagnostics:** Panel tabs (Console/Output area) — keep Indexing on its own tab
- **Usage/Observability:** Combined diagnostics surface (same panel)
- **Agent Config:** AI Settings, replacing hardcoded participants
- **Chat Commands:** All shipped together (no partial rollout)
- **Token Status:** Status bar popup (existing `chatTokenStatusBar.ts`)

---

## Deferred

- **D9: Web Search** — private mode, VPN constraints — deferred to future milestone
- **D10: Plugin SDK** — MCP covers the extensibility use case

---

## Progress

| Domain | Status | Iter 1 | Iter 2 | Iter 3 | Tests Added | Commit |
|--------|--------|--------|--------|--------|-------------|--------|
| D8: Agent Configuration | 🔄 IN PROGRESS | | | | | |
| D2: Chat Commands | ⏳ Not Started | | | | | |
| D3: Doctor/Diagnostics | ⏳ Not Started | | | | | |
| D7: Observability/Usage | ⏳ Not Started | | | | | |
| D6: Compaction Depth | ⏳ Not Started | | | | | |
| D4: Runtime Hooks | ⏳ Not Started | | | | | |
| D1: MCP Integration | ⏳ Not Started | | | | | |
| D5: Media/Vision | ⏳ Not Started | | | | | |
