# OpenClaw Dead Code Audit & Parity Agent Reference

**Date**: 2026-04-07  
**Trigger**: Discovered HeartbeatRunner has zero production imports → full sweep revealed 6 dead modules  
**Parity agents restored**: Same session — recovered from git `815152d8`

---

## Dead Modules

6 files in `src/openclaw/` are fully built, tested, audited (M46), and have **zero production imports**.

| # | Module | File | Domain | Tests | Audit Status |
|---|--------|------|--------|-------|-------------|
| 1 | FollowupRunner | `openclawFollowupRunner.ts` | D1 | 21 | 8/8 CLOSED |
| 2 | HeartbeatRunner | `openclawHeartbeatRunner.ts` | D2 | 22 | 13/13 CLOSED |
| 3 | CronService | `openclawCronService.ts` | D4 | 77 | CLOSED |
| 4 | SubagentSpawner | `openclawSubagentSpawn.ts` | D5 | 34 | CLOSED |
| 5 | SurfacePlugin | `openclawSurfacePlugin.ts` | D6 | 33 | 9/9 CLOSED |
| 6 | ToolLoopSafety (deprecated shim) | `openclawToolLoopSafety.ts` | — | 0 | N/A |

**187 tests** pass against code that never runs in production.  
**38 of 44** openclaw files ARE active with production imports.

### Root Cause

The M46 domain audit process defined "done" as: build class → write tests → audit upstream → close. No domain included a **"wire into runtime"** task. Delegate-based constructors (`HeartbeatTurnExecutor`, `CronTurnExecutor`, etc.) were designed for deferred wiring that was never scheduled.

---

## Wiring Plan — Recommended Order

### 1. FollowupRunner (D1) — Low Effort

**Constructor**: Factory function `createFollowupRunner()`

| Task | File(s) | Core change? |
|------|---------|-------------|
| Import `evaluateFollowup` in turn runner or default participant | `openclawTurnRunner.ts` or `openclawDefaultParticipant.ts` | No |
| After each turn completes, call `evaluateFollowup()` on result | Turn runner post-turn hook | No |
| If followup triggered, queue next turn with delay (`FOLLOWUP_DELAY_MS`) | Turn runner or participant | No |
| Enforce `MAX_FOLLOWUP_DEPTH` (5) | Participant turn loop | No |

**Simplest to wire** — pure evaluation function, no constructors, no config, no tools.

### 2. HeartbeatRunner (D2) — Low-Medium Effort

**Constructor**: `(executor: HeartbeatTurnExecutor, getConfig: () => IHeartbeatConfig)`

| Task | File(s) | Core change? |
|------|---------|-------------|
| Add `heartbeat.enabled`, `heartbeat.intervalMs` to unified AI config | `unifiedConfigTypes.ts` | YES |
| Create `HeartbeatTurnExecutor` callback | New or inline in register file | No |
| Instantiate `HeartbeatRunner` in `registerOpenclawParticipants.ts` | `registerOpenclawParticipants.ts` | No |
| Start/stop on session lifecycle | Participant or session manager | Maybe |
| Connect file watcher + indexer events to `pushEvent()` | `built-in/chat/main.ts` | YES |

**Design decision**: Heartbeat output visible in chat or silent background?

### 3. CronService (D4) — Medium Effort

**Constructor**: `(executor: CronTurnExecutor, contextFetcher: ContextLineFetcher, heartbeatWaker: HeartbeatWaker | null)`

| Task | File(s) | Core change? |
|------|---------|-------------|
| Create `CronTurnExecutor` callback | New or inline | No |
| Create `ContextLineFetcher`: pull N recent messages from session | Session manager bridge | Maybe |
| Wire `HeartbeatWaker` to `heartbeatRunner.wake('cron')` | Requires HeartbeatRunner | No |
| Instantiate `CronService`, call `.start()`, add to disposables | `registerOpenclawParticipants.ts` | No |
| Create 8 cron tool definitions (status/list/add/update/remove/run/runs/wake) | New `cronTools.ts` | No |
| Register cron tools in `getToolDefinitions()` | Tool registration surface | YES |

**Blocker**: Without tool definitions, the AI has no interface to cron.  
**Dependencies**: HeartbeatRunner for `"next-heartbeat"` wake mode (can pass `null`).

### 4. SurfacePlugin (D6) — Medium-High Effort

**Constructor**: `SurfaceRouter` manages registered `ISurfacePlugin` instances

| Task | File(s) | Core change? |
|------|---------|-------------|
| Create concrete surface plugins (chat, canvas, filesystem, notifications, status) | 5 new plugin implementations | Depends |
| Instantiate `SurfaceRouter`, register plugins | Registration site | No |
| Wire agent output through `SurfaceRouter.send()` instead of direct chat posting | Turn runner or participant | No |
| Create surface routing tool (optional — lets AI choose output surface) | New tool | No |

**Design decision**: Is multi-surface needed now, or is chat-only sufficient?

### 5. SubagentSpawner (D5) — High Effort

**Constructor**: `(executor: SubagentTurnExecutor, announcer: SubagentAnnouncer, contextEngine?, parentSessionId?)`

| Task | File(s) | Core change? |
|------|---------|-------------|
| Create `SubagentTurnExecutor`: isolated turn → collect response → enforce timeout | New | No |
| Solve isolated session management (sub-turns must not pollute active chat) | Session manager | YES |
| Create `SubagentAnnouncer`: post result back to parent chat | Bridge to chat UI | Maybe |
| Create `sessions_spawn` tool definition | New `subagentTools.ts` | No |
| Register tool + add approval gate | Tool registration + `openclawToolPolicy.ts` | YES |
| Wire to participant with depth limit (3) and concurrent limit (5) | `openclawDefaultParticipant.ts` | No |

**Hardest to wire** — isolated session management is an unsolved problem.

### 6. ToolLoopSafety — Delete

3-line re-export shim from `src/services/chatToolLoopSafety.ts`. File header says "scheduled for deletion." Consumers already import from canonical location. **Just delete it.**

---

## Core Files Requiring Approval

| File | What Changes |
|------|-------------|
| `src/aiSettings/unifiedConfigTypes.ts` | Heartbeat config fields |
| `src/built-in/chat/main.ts` | Event connections, tool registration |
| `src/openclaw/registerOpenclawParticipants.ts` | Instantiation of all modules |
| Tool registration surface | Cron + subagent tool definitions |
| Session manager | Isolated session support for subagents |

---

## Parity Agents — Use These for Wiring

The original OpenClaw parity agents that drove M41–M47 were repurposed into extension development agents at commit `24aa670` (April 2, 2026). They have been **restored alongside** the extension agents.

### Agent Inventory

**Parity Workflow** (for dead code wiring and future OpenClaw work):

| Agent | File | Role |
|-------|------|------|
| **Parity Orchestrator** | `.github/agents/Parity Orchestrator.agent.md` | Master orchestrator — drives audit → gap map → code → verify → UX cycles against upstream OpenClaw |
| **AI Parity Auditor** | `.github/agents/AI Parity Auditor.agent.md` | Audits `src/openclaw/` against upstream `github.com/openclaw/openclaw` source |
| **Gap Mapper** | `.github/agents/Gap Mapper.agent.md` | Maps audit findings to concrete code changes with file/line targets |
| **Parity Code Executor** | `.github/agents/Parity Code Executor.agent.md` | Implements changes from Gap Mapper plans, tracing to upstream source |
| **Parity Verification Agent** | `.github/agents/Parity Verification Agent.agent.md` | Runs tests, type checks, and validates upstream fidelity after changes |
| **Parity UX Guardian** | `.github/agents/Parity UX Guardian.agent.md` | Validates that changes don't break user-facing surfaces |

**Extension Workflow** (for building new Parallx extensions from upstream projects):

| Agent | File |
|-------|------|
| Extension Orchestrator | `.github/agents/Extension Orchestrator.agent.md` |
| Source Analyst | `.github/agents/Source Analyst.agent.md` |
| Architecture Mapper | `.github/agents/Architecture Mapper.agent.md` |
| Code Executor | `.github/agents/Code Executor.agent.md` |
| Verification Agent | `.github/agents/Verification Agent.agent.md` |
| UX Guardian | `.github/agents/UX Guardian.agent.md` |

**Migration Workflow** (M53 storage migration):

| Agent | File |
|-------|------|
| Migration Orchestrator | `.github/agents/Migration Orchestrator.agent.md` |
| Impact Analyst | `.github/agents/Impact Analyst.agent.md` |
| Migration Executor | `.github/agents/Migration Executor.agent.md` |
| Migration Verifier | `.github/agents/Migration Verifier.agent.md` |
| Regression Sentinel | `.github/agents/Regression Sentinel.agent.md` |

### When to Use Which

| Task | Use |
|------|-----|
| Wire dead modules into runtime (this doc) | **Parity agents** — they understand the OpenClaw upstream contracts and the `src/openclaw/` codebase |
| New upstream parity work against `openclaw/openclaw` | **Parity agents** |
| Build a new Parallx extension by studying an open-source project | **Extension agents** |
| Migrate storage domains (M53) | **Migration agents** |

### History

The parity agents were the original agent framework, created at commit `815152d8` (March 27, 2026) during M41–M47. Every audit doc in `docs/archive/audits/` credits "AI Parity Auditor" and "Parity Orchestrator" by name. At commit `24aa670` (April 2, 2026), they were renamed/repurposed into the extension development framework. The originals were restored on April 7, 2026 from git history.

---

## Parity Agent Workflow — How It Works

The parity workflow is a strict iterative loop driven by the **Parity Orchestrator**. Each domain (or wiring task) goes through this cycle until all capabilities reach ALIGNED status.

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                     PARITY ORCHESTRATOR                         │
│                                                                 │
│  For each domain / wiring task:                                 │
│                                                                 │
│    ┌──────────┐     ┌────────────┐     ┌───────────────┐        │
│    │  AUDIT   │────▶│  DOCUMENT  │────▶│   GAP MAP     │        │
│    │ (Auditor)│     │  (AUDIT.md)│     │   (Mapper)    │        │
│    └──────────┘     └────────────┘     └──────┬────────┘        │
│         ▲                                     │                 │
│         │           ┌────────────┐     ┌──────▼────────┐        │
│         │           │  DOCUMENT  │◀────│   DOCUMENT    │        │
│         │           │(GAP_MAP.md)│     │(TRACKER init) │        │
│         │           └─────┬──────┘     └───────────────┘        │
│         │                 │                                     │
│         │           ┌─────▼──────┐     ┌───────────────┐        │
│         │           │   CODE     │────▶│   VERIFY      │        │
│         │           │  EXECUTE   │     │  (Verifier)   │        │
│         │           └────────────┘     └──────┬────────┘        │
│         │                                     │                 │
│         │           ┌────────────┐     ┌──────▼────────┐        │
│         └───────────│    UX      │◀────│   TRACKER     │        │
│         re-audit    │ (Guardian) │     │   UPDATE      │        │
│         if gaps     └────────────┘     └───────────────┘        │
│         remain                                                  │
│                     ┌────────────┐                              │
│                     │   COMMIT   │  ← after domain CLOSED       │
│                     └────────────┘                              │
└─────────────────────────────────────────────────────────────────┘
```

### 12-Step Procedure

| Step | Action | Agent | Output | Gate |
|------|--------|-------|--------|------|
| 1 | **AUDIT** — Audit Parallx code against upstream OpenClaw | AI Parity Auditor | Gap report: per-capability ALIGNED/MISALIGNED/MISSING | — |
| 2 | **DOCUMENT AUDIT** — Save audit report | Orchestrator | `docs/{ID}_{NAME}_AUDIT.md` | **Must exist before step 3** |
| 3 | **GAP MAP** — Produce exact change plan from audit | Gap Mapper | File-level diff plan with upstream citations | — |
| 4 | **DOCUMENT GAP MAP** — Save gap map | Orchestrator | `docs/{ID}_{NAME}_GAP_MAP.md` | **Must exist before step 5** |
| 5 | **DOCUMENT TRACKER** — Create/update domain tracker | Orchestrator | `docs/{ID}_{NAME}_TRACKER.md` | — |
| 6 | **CODE EXECUTE** — Implement changes from gap map | Parity Code Executor | Code changes in workspace | — |
| 7 | **VERIFY** — Run full test suite + type check | Parity Verification Agent | Pass/fail with diagnostics | **Full suite, not targeted** |
| 8 | **UPDATE TRACKER** — Record iteration results | Orchestrator | Updated TRACKER.md | — |
| 9 | **UX VALIDATE** — Check user-facing surfaces | Parity UX Guardian | UX impact assessment | — |
| 10 | **DECISION GATE** — All ALIGNED + tests pass + UX clean? | Orchestrator | Proceed to closure OR loop to step 1 | — |
| 11 | **CLOSURE** — Finalize: update tracker to CLOSED, verify all 3 docs exist | Orchestrator | Domain CLOSED ✅ | **All 3 docs must exist** |
| 12 | **COMMIT** — Commit domain work | Orchestrator | Git commit | **Must commit before next domain** |

### 6 Principles (M41 — enforced by all parity agents)

| # | Principle |
|---|-----------|
| P1 | **Framework, not fixes** — every change must be systemic, not a point fix |
| P2 | **OpenClaw is the blueprint** — upstream source is the parity target, not existing Parallx code |
| P3 | **Study source, then build** — read the upstream function before writing Parallx's version |
| P4 | **Not installing OpenClaw** — we adapt patterns for desktop, not run OpenClaw itself |
| P5 | **No deterministic solutions** — never hardcode answers or regex-match to canned responses |
| P6 | **Don't invent when upstream has a proven approach** — use their solution |

### 7 Anti-Patterns (NEVER)

| Anti-Pattern | Description |
|-------------|-------------|
| Preservation bias | Keeping code because it exists, even when wrong |
| Patch-thinking | Adding fixes on top of broken code instead of replacing the broken layer |
| Output repair | Post-processing model output to fix what the prompt should prevent |
| Pre-classification | Regex/keyword routing instead of letting the model decide |
| Eval-driven patchwork | Writing code to pass a specific test instead of fixing the system |
| Wrapper framing | Treating Parallx as a thin wrapper around something else |
| Subtractive framing | Defining Parallx by what it removes from OpenClaw |

---

## Upstream OpenClaw Source — Location

**There is no local clone of the upstream OpenClaw repository.**

The parity work was done by fetching source files directly from GitHub during audit sessions. The upstream source is preserved in two reference documents:

| Document | Path | Content |
|----------|------|---------|
| **Reference Source Map** | `docs/ai/openclaw/OPENCLAW_REFERENCE_SOURCE_MAP.md` | Upstream file index with extracted function signatures, types, and control flow for all major modules |
| **Pipeline Reference** | `docs/ai/openclaw/OPENCLAW_PIPELINE_REFERENCE.md` | Full 4-layer execution pipeline signatures (L1–L4) extracted from commit `e635cedb` |
| **Gap Matrix** | `docs/ai/openclaw/OPENCLAW_GAP_MATRIX.md` | 43-capability gap status across all domains |

### Upstream Coordinates

| Field | Value |
|-------|-------|
| **Repository** | `https://github.com/openclaw/openclaw` |
| **Baseline commit** | `e635cedb` (indexed 2026-03-20) |
| **DeepWiki** | `https://deepwiki.com/openclaw/openclaw` |

### How Source Was Consumed

The AI Parity Auditor fetched upstream files directly from GitHub during audit sessions (e.g., `heartbeat-runner.ts` ~1200 lines, `subagent-spawn.ts` ~847 lines, `cron-tool.ts` ~541 lines). Extracted signatures and control flow were recorded in the Reference Source Map and individual audit docs in `docs/archive/audits/`.

### Related Documentation

| Path | Content |
|------|---------|
| `docs/archive/audits/D1_FOLLOWUP_RUNNER_AUDIT.md` through `D6_MULTI_SURFACE_OUTPUT_AUDIT.md` | Per-domain audits with upstream citations |
| `docs/archive/audits/D*_*_GAP_MAP.md` | Per-domain change plans |
| `docs/archive/audits/D*_*_TRACKER.md` | Per-domain progress trackers |
| `docs/archive/milestones/Parallx_Milestone_46.md` | M46 Autonomy Mechanisms — the milestone that built the 6 dead modules |
| `docs/archive/milestones/Parallx_Milestone_47.md` | M47 Parity Extension — 8 additional domains |
| `docs/archive/milestones/Parallx_Milestone_41.md` | M41 Vision — the foundational principles and anti-patterns |
| `docs/archive/clawrallx-planning/` | Early redesign planning docs |

**Note:** The parity agents were fully updated on April 7, 2026 with correct paths to `docs/ai/openclaw/` reference documents. All agent files now point to this document at `docs/OPENCLAW_DEAD_CODE_AND_PARITY_AGENTS.md`.
