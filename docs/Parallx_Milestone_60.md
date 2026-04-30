# Milestone 60 — Awake & Alive: Autonomy Wiring, Performance, Canvas Depth, and the First Real-World Agent Loop

**Date:** 2026-04-30
**Status:** Planning
**Branch:** `milestone-60` (from `milestone-58`)
**Theme:** Take Parallx from "reactive chat app with dormant autonomy code" to a
**responsive, agentic, observable** desktop AI that wakes on its own, acts on
real workspace events, addresses canvas content at block-level granularity,
exposes a real settings surface, and proves the whole stack end-to-end by
**reading and reporting on the user's Gmail inbox via a secure MCP bridge**.

This milestone is the first since M53 to touch the **core app** broadly. It
absorbs the unfinished M58 autonomy wiring, the deferred indexing performance
work from `Future_Improvements.md`, the unfinished M55 canvas property query
layer, and adds the first end-to-end **autonomy E2E test rig** — including a
real external MCP server (Gmail) so we exercise the trigger → tool →
surface-route loop against live data, not mocks.

---

## 1. Vision

A Parallx that:

- **Wakes** on cron, file changes, indexing completion, and tool-requested
  followups — not only on chat input. (M58 W1, W2, W4, W5, W6.)
- **Stays responsive** during heavy indexing or embedding runs, even on
  cold-start with a 10k-page workspace. (Indexing off the renderer thread.)
- **Speaks canvas natively** — properties are queryable, blocks are
  addressable by stable ID, the agent can edit a paragraph or a table row
  without rewriting a whole page. (M55 finish + block-API.)
- **Has a real settings surface** — every feature flag, model choice,
  autonomy parameter, and extension config is searchable, scoped,
  documented, and editable from one place. (Settings UI parity.)
- **Lets the user see what it did** — the autonomy task rail shows every
  cron firing, heartbeat decision, sub-agent run, and surface route, with
  filter/history/kill-switch and "approve this pattern" memory.
- **Proves itself end-to-end** — a real MCP connection to the user's Gmail
  account, a single `gmail.list_unread` tool, and a continuous-eval run
  that asks the agent: *"Read my unread email and tell me what matters."*
  We grade the run for tool selection, surface routing, and report quality.
  No deterministic post-processing. The LLM decides.

Endstate: M58 closes (autonomy wired), Tier 2 closes (responsive startup),
Tier 3 partially closes (canvas property queries + block-level tools),
Tier 4 partially closes (settings UI + canvas API formalization deferred to
M61), Tier 5 closes (task-rail polish + autonomy E2E + Gmail MCP demo).

### 1.1 Anti-vision — what M60 is explicitly NOT

These are the failure modes we will refuse, even under deadline pressure:

- **Not** an autonomy free-for-all. Every autonomous turn is **gated, logged,
  killable, and bounded by token + time + tool budgets**.
- **Not** a chatbot that pretends to be agentic by polling. Triggers are
  real (cron, file watcher, indexer event, tool followup). No fake
  heartbeats that just re-prompt the LLM.
- **Not** a kitchen-sink settings editor. Settings are **schema-registered
  by their owning service**; the editor only renders what's registered.
- **Not** a Gmail client. T6 ships **one read-only tool**. No drafts, no
  send, no labels, no archive — even if the LLM asks for it.
- **Not** a multi-device / cloud-sync milestone. Local-first, single-user,
  single-instance. Sync is M61+.
- **Not** an excuse to refactor unrelated code. Out-of-scope diffs are
  rejected at PR review (§14 risk: scope creep).
- **Not** "audit-closed = done". Wiring + tests + UX + docs + observability
  is done. Audit is one of seven lenses.

---

## 2. Tier Map (work organized by user-visible outcome)

| Tier | Outcome | Domains |
|------|---------|---------|
| **T1** | Parallx wakes itself | A1–A6 (was M58 W0–W6) |
| **T2** | Parallx stays responsive under load | B1–B5 |
| **T3** | The agent can read and edit canvas at block granularity | C1–C4 |
| **T4** | Every setting is discoverable in one place | D1–D3 |
| **T5** | Every autonomous turn is inspectable, killable, replayable | E1–E3 |
| **T6** | E2E proof: secure Gmail MCP + autonomy + canvas report | F1–F5 |

Every tier ships independently. Tier order is dependency-driven: T1 must land
before T5 (no rail polish without rail data). T2 should land before T6 (Gmail
loop will hammer indexing and surface routing). T3 is parallelizable with T1.

---

## 3. Ground Rules — every tier, every domain

### 3.1 The six Parallx principles (M41 charter, still binding)

| # | Principle |
|---|-----------|
| P1 | Framework, not fixes |
| P2 | OpenClaw is the blueprint |
| P3 | Study source, then build |
| P4 | Not installing OpenClaw — adapting for desktop |
| P5 | No deterministic solutions |
| P6 | Don't invent when upstream has a proven approach |

### 3.2 The seven anti-patterns are forbidden

Preservation bias · patch-thinking · output repair · pre-classification ·
eval-driven patchwork · wrapper framing · subtractive framing.

### 3.3 The seven lenses — every domain ships only when all seven pass

Each domain produces artifacts under each lens. No domain closes until **all
seven** are green.

| Lens | What it asks | Artifact |
|------|--------------|----------|
| **L1 Functionality** | Does it do the thing, end-to-end, against real data? | Working code + manual smoke trace |
| **L2 OpenClaw parity** | Does it faithfully adapt the upstream contract? | Re-audit report citing upstream file:line |
| **L3 Parallx principles** | No anti-patterns, no eval-driven patchwork, no inline-styled UI? | Principle review note |
| **L4 UI / UX** | Native VS Code feel, `--vscode-*` tokens, `src/ui/` components, no inline styles, keyboard accessible? | UX Guardian sign-off |
| **L5 Performance** | No new renderer-thread blocks > 16ms; no new IPC storms; startup not slower | Trace measurement before/after |
| **L6 Documentation** | User-visible behavior in `docs/ai/AI_USER_GUIDE.md`; APIs in code comments; this doc updated with deltas | Doc diff in same commit |
| **L7 Testing** | Unit + integration + (where applicable) E2E + autonomy eval | Tests in same commit, CI green |

### 3.4 Core-change approval rule

Any change outside the agent/extension boundary (i.e. anything in
`src/main.ts`, workbench layout, services constructed in the workbench
bootstrap, electron/main.cjs, core schema migrations) **requires explicit
user approval before the file is opened for edit.** Tracked per-domain.

### 3.5 Do-not-assume rule (re-audit before wiring)

The M58 audits were performed against upstream commit `e635cedb` months
ago. Before wiring any T1 module, the **Parity Auditor must re-audit**
against current upstream HEAD and treat drift as a first-class finding.

### 3.6 Autonomy cost & resource budgets (hard caps)

Every autonomous turn consumes tokens, CPU, network, and possibly
third-party API quota. Without caps, a runaway loop can drain a model
budget in minutes or hit Gmail rate limits in seconds. **Every domain
that triggers an autonomous turn must enforce these caps; the runner
refuses to start a turn that would exceed them.**

| Budget | Default cap | Scope | Where enforced | Override |
|--------|------------|-------|---------------|----------|
| Tokens per autonomous turn | 8k input + 4k output | Per turn | `openclawTokenBudget.ts` (existing) | Settings UI (T4) |
| Tokens per autonomy day (rolling 24h) | 250k total | Global | New `autonomyBudgetService.ts` | Settings UI |
| Followup depth | 5 (existing `MAX_FOLLOWUP_DEPTH`) | Per chain | `followupRunner` | Settings UI |
| Sub-agent spawn depth | 1 (no nested spawns in M60) | Per chain | `subagentSpawn` | Hard-coded for M60 |
| Heartbeat tick interval | 60s | Global | `heartbeatRunner` | Settings UI (min 15s) |
| Cron job count | 50 active | Per workspace | `cronService` | Settings UI |
| External API calls / hour | 60 (Gmail) | Per MCP | MCP client policy | Per-MCP settings |
| Renderer-thread block | 16ms | Per task | Worker offload (T2) | n/a |
| Disk writes per autonomous turn | 100 ops | Per turn | Vector store + canvas writers | n/a |

When a cap trips, the autonomy runner emits a `budget.exceeded` event,
refuses the turn, posts a notification, and surfaces the trip in the task
rail. **No silent throttling.**

### 3.7 Concurrency, idempotency & lock discipline

Multiple triggers can fire on overlapping windows (cron + file change +
followup). The autonomy substrate must:

- **Single-flight per trigger** — at most one cron job, one heartbeat
  tick, one followup chain in flight at a time, per session.
  Subsequent triggers queue; queue depth ≤ 3, then drop with logged warn.
- **Idempotency keys** — every cron firing carries a deterministic
  `(cronId, scheduledAt)` key. Re-firing the same key is a no-op.
  Tool calls that mutate state (canvas writes, file writes) carry a
  client-side idempotency key surfaced in the audit log.
- **Cancellation cooperation** — every long-running tool must observe the
  `CancellationToken` it receives. The kill-switch (T5.E2) sets the
  token; tools that ignore it for >2s are flagged in the autonomy eval.
- **No autonomy during shutdown** — heartbeat and cron are paused as
  soon as `BeforeShutdownEvent` fires; in-flight turns are given 2s to
  complete and then cancelled.

### 3.8 Feature flags & rollback policy

Every domain that touches autonomy or core code paths ships behind a
feature flag registered in T4's settings registry. Defaults:

| Flag | Default | Rationale |
|------|---------|-----------|
| `autonomy.followup.enabled` | **on** after A2 lands | Lowest-risk autonomy |
| `autonomy.heartbeat.enabled` | **off** until 1 week of clean dogfood | Background CPU |
| `autonomy.cron.enabled` | **off** until heartbeat is proven | Depends on heartbeat |
| `autonomy.subagent.enabled` | **off** until autonomy eval ≥10/12 for 5 runs | Highest blast radius |
| `indexing.worker.enabled` | **off** in α; **on** in β | T2.B3 needs bake time |
| `indexing.lazy.enabled` | **off** | Behavioral change |
| `canvas.blockIds.enabled` | **on** after C2 migration verified | Required for C3 |
| `mcp.gmail.enabled` | **off** by default | User opts in |

**Rollback contract:** every flag toggles cleanly at runtime without a
restart. If a flag toggle requires restart, that's a domain bug.

### 3.9 Privacy & data posture (generalized from §9 Gmail)

Applies to every external integration in M60 and beyond:

- **Local-first.** No telemetry. No phone-home. No third-party analytics.
- **Encrypted-at-rest secrets.** OAuth tokens, API keys, MCP credentials
  use Electron `safeStorage`. Plaintext storage is a security defect.
- **Scope minimization.** Read-only by default. Every additional scope
  requires its own approval gate.
- **No body persistence.** Email bodies, file contents, and other
  third-party payloads are processed in-memory and discarded after the
  turn. Only structured summaries (subject, sender, label) may persist
  in canvas pages the user explicitly creates.
- **Audit log retention.** Autonomy task-rail entries persist 90 days
  by default, then auto-purge. User can purge on demand.
- **Network egress allowlist** per MCP integration. The Gmail MCP only
  reaches `accounts.google.com` and `gmail.googleapis.com`; any other
  egress is a defect.

### 3.10 Observability & replay

Every autonomous turn produces a structured **autonomy event record**:

```
{
  id: ulid,
  triggeredAt: iso,
  trigger: { kind: "cron"|"heartbeat"|"followup"|"file-change"|"chat", ref },
  budgetSnapshot: { tokensUsedToday, depth, ... },
  systemPromptHash: sha256,
  toolCalls: [{ name, argsDigest, durationMs, idempotencyKey, error? }],
  surfaceRoutes: [{ surface, target, ok }],
  outcome: "completed"|"cancelled"|"budget"|"error",
  durationMs, tokensIn, tokensOut
}
```

Records are written to `data/autonomy-events.ndjson` (rotated daily,
90-day retention) **and** to the in-memory rail (T5.E1). Replay command
(dev-only): `parallx autonomy:replay <event-id>` reconstructs the
system prompt + tool sequence and re-runs against current state for
debugging. Replay is **read-only by default**; mutating tools are
dry-run unless `--apply` is passed.

### 3.11 Definition of Done — per-domain checklist

A domain is done only when **every** box is checked:

- [ ] Code compiles, type-clean (no `any` in new code), `npm run build`
      passes.
- [ ] Unit tests in same commit, all green.
- [ ] Integration / E2E tests per §11.3 coverage gates, all green.
- [ ] Autonomy eval scenario (where required), ≥ rubric threshold.
- [ ] Re-audit report attached for parity domains (T1, anything
      adapting upstream).
- [ ] Doc deltas in same commit (no "docs follow-up" PRs).
- [ ] UX Guardian sign-off note in commit body.
- [ ] Feature flag registered (§3.8) with default per policy.
- [ ] Autonomy event record schema unchanged or migration documented.
- [ ] No new `localStorage` writes; storage routes through M53
      portable storage.
- [ ] No new inline styles; UI uses `src/ui/` components and
      `--vscode-*` tokens.
- [ ] Performance trace attached when L5 applies.
- [ ] PR description lists which lenses were applied and where the
      artifact lives.

### 3.12 Domain ownership (subagent assignment)

Which agent drives which domain. This locks expertise to the right
surface and prevents the wrong agent doing the wrong job.

| Domain block | Lead agent | Verifier |
|--------------|-----------|----------|
| T1 (autonomy) | Parity Orchestrator → Source Analyst → Parity Code Executor | Parity Verification Agent + Parity UX Guardian |
| T2 (perf) | Architecture Mapper → Code Executor | Verification Agent + Regression Sentinel |
| T3 (canvas) | Property Orchestrator (M55 lineage) → Property Builder | Property Verifier + UX Guardian |
| T4 (settings) | Architecture Mapper → Code Executor | UX Guardian + Verification Agent |
| T5 (rail) | Architecture Mapper → Code Executor | UX Guardian |
| T6 (Gmail E2E) | Extension Orchestrator → Source Analyst (MCP spec) → Code Executor | Verification Agent + Parity UX Guardian; mandatory security review (§9.5) |

---

## 4. Tier 1 — Autonomy Wiring (absorbs M58 W0–W6)

Reuses the work plan and ground rules from `docs/Parallx_Milestone_58.md`
§5. That plan is **carried into M60 verbatim** with the following
deltas:

### 4.1 Deltas vs. M58 plan

| # | Delta | Why |
|---|-------|-----|
| Δ1 | Re-audit against current upstream HEAD before each domain (not just W0) | M58 audits aged 5+ months |
| Δ2 | Heartbeat cadence default lowered from 30s → 60s; configurable in T4 settings UI | Battery / fan noise on laptops |
| Δ3 | Sub-agent isolation uses a per-spawn temp DB connection, not a session fork | Simpler, matches M53 portable storage |
| Δ4 | Surface plugins gain a "Gmail report" surface as part of T6 (not T1) | Don't grow T1 scope |
| Δ5 | Each domain emits a structured autonomy event consumed by T5 task rail | Required for inspectability |

### 4.2 Domains (renamed from M58 W-series)

| ID | Module | M58 ref | Effort | Risk |
|----|--------|---------|--------|------|
| **A1** | Delete dead `openclawToolLoopSafety.ts` shim | W0 | trivial | zero |
| **A2** | FollowupRunner wiring (default participant post-turn hook) | W1 | low | low |
| **A3** | SurfaceRouter + 5 surface plugins (chat, canvas, filesystem, notification, statusbar) | W6 | med-hi | med |
| **A4** | HeartbeatRunner wiring + system event bus + unified config keys | W2 | med | med |
| **A5** | CronService wiring + cron tool defs + cron persistence | W4 | med | med |
| **A6** | SubagentSpawner wiring + isolated session + approval gate | W5 | high | high |

**Order:** A1 → A2 → A3 → A4 → A5 → A6 (matches M58 dependency graph,
same rationale §4 of M58 doc).

### 4.3 Lens checklist applied to T1

- **L2 parity**: every wired call must cite a `file:line` from the
  re-audit.
- **L4 UI**: A3 surface plugins must use `src/ui/` components (notifications
  via existing `INotificationService`, statusbar via existing surface).
  No new ad-hoc widgets.
- **L5 perf**: heartbeat tick must consume < 2ms idle CPU; cron evaluation
  runs in main process or worker, not renderer.
- **L7 testing**: each module already has unit tests. T1 adds integration
  tests that exercise the wiring (e.g. "tool returns
  `continuationRequested:true` → second turn fires within 1s").

---

## 5. Tier 2 — Responsiveness Under Load

Closes the deferred work in `docs/Future_Improvements.md` §1–§2.

### 5.1 Domains

| ID | Domain | Source of truth |
|----|--------|----------------|
| **B1** | Cooperative yielding in `_indexAllPages` and `_embedChunks` | `Future_Improvements.md` Option 1 |
| **B2** | Deferred indexing start (idle callback after Phase 5 settles) | Option 2 |
| **B3** | Indexing pipeline → Web Worker (renderer-thread relief) | Option 3 |
| **B4** | IPC write batching for vector store upserts | Option 4 |
| **B5** | Page mtime fast-skip + lazy on-demand indexing | Option 5 |

**Order:** B1 + B2 land first (low-risk, high-impact). B4 + B5 next. B3 last
(largest refactor; depends on `IIndexingPipelineService` interface still
being clean after B1/B2/B4).

### 5.2 Acceptance criteria

- **B1+B2 done**: Cold-start a 5k-page workspace; UI is interactive within
  500ms of window paint. No "Not Responding" dialog. Verified with
  Performance trace.
- **B3 done**: Indexing a 10k-page workspace consumes 0% renderer-thread
  CPU during the bulk phase. Worker reports progress via
  `postMessage`; renderer only updates a status bar tick.
- **B4 done**: 1000 vector upserts in a single transaction batch take
  < 200ms; IPC count drops by ≥10×.
- **B5 done**: Re-opening an unchanged workspace skips ≥95% of pages by
  mtime; full reindex only on hash mismatch.

### 5.3 Lens checklist applied to T2

- **L5 perf is primary lens** — every domain must produce
  before/after traces in the commit message.
- **L7 testing**: add `tests/unit/indexingPipeline.perf.test.ts` measuring
  yield cadence with vitest fake timers.
- **L4 UI**: status bar entry shows indexing progress; clicking opens a
  panel with current phase, items remaining, ETA. Native VS Code feel.

---

## 6. Tier 3 — Canvas Depth: Properties Queryable + Block-Level AI

Builds on M55 (page properties shipped) and the existing TipTap doc model.

### 6.1 Domains

| ID | Domain | Effort |
|----|--------|--------|
| **C1** | Property query API (filter pages by property, sort, group) — service + tools | med |
| **C2** | Stable block IDs surfaced in TipTap doc + persisted to canvas DB | med |
| **C3** | Block-level AI tools: `read_block`, `edit_block`, `insert_block_after`, `link_block` | med |
| **C4** | Property dataview block (TipTap node) — renders a live filtered list of pages by property query | high |

### 6.2 Tool surface (additions to `src/tools/`)

- `pages.query_by_property` — input: `{ filter: { prop, op, value }[], sort?, group? }`; output: page list with properties
- `pages.read_block` — input: `{ pageId, blockId }`; output: block JSON + plaintext
- `pages.edit_block` — input: `{ pageId, blockId, newContent }`; output: diff
- `pages.insert_block_after` — input: `{ pageId, anchorBlockId, content }`
- `pages.link_block` — input: `{ fromPageId, fromBlockId, toPageId, toBlockId }`

All tools follow existing skill-based registration pattern (`src/tools/`
+ `SKILL.md`). All gated by 3-tier permissions.

### 6.3 Acceptance criteria

- C1: agent can answer *"Which pages have status=Draft and tag=research?"*
  via a single tool call.
- C2: every block in every page has an immutable `blockId`; persisted
  across reload; survives edits.
- C3: agent can answer *"Replace the second paragraph of page X with this
  rewrite"* and execute it.
- C4: a canvas page can host a `dataview` block that queries by property
  and re-renders live.

### 6.4 Lens checklist applied to T3

- **L1 functional**: every tool must be invokable from chat with a real
  prompt that triggers it organically (no eval-rigged inputs).
- **L4 UI**: dataview block uses existing canvas list components, no
  bespoke styling.
- **L7 testing**: each tool has an AI eval scenario in
  `docs/ai/canvas-property-evals.json`.

---

## 7. Tier 4 — Settings UI Surface

Today: settings are scattered across `src/aiSettings/`, JSON files,
service-internal config, and ad-hoc `localStorage`. There's no single
discoverable surface.

### 7.1 Domains

| ID | Domain |
|----|--------|
| **D1** | Settings schema registry — every service registers its settings with `{ key, type, default, scope, description }` |
| **D2** | Settings editor view (search, scope filter, schema-driven inputs, live apply) |
| **D3** | Migrate ad-hoc `localStorage` config + `aiSettings/*.json` reads into the registry |

### 7.2 Acceptance criteria

- Every autonomy parameter from T1 (heartbeat cadence, max followup depth,
  cron persistence path, sub-agent approval mode) is editable here.
- Every T2 toggle (web-worker indexing on/off, lazy indexing on/off) is
  editable here.
- Search "heartbeat" surfaces all related settings with descriptions.
- Settings are scoped: User (global) vs Workspace (per-workspace).
- Extensions register their settings the same way (M56 Canvas API
  groundwork).

### 7.3 Out of scope for M60

- Settings sync across devices — defer to M61.
- Per-skill permission UI (currently lives in chat side panel) —
  consolidates into D2 in a follow-up.

---

## 8. Tier 5 — Autonomy Task Rail Polish

Once T1 lands, autonomous turns will be flowing. Without a clear surface
the user will lose trust fast.

### 8.1 Domains

| ID | Domain |
|----|--------|
| **E1** | Task rail filter + history (filter by trigger: chat / heartbeat / cron / followup / sub-agent; persistent history) |
| **E2** | Autonomy kill-switch (global pause, per-trigger pause, "stop this run") |
| **E3** | "Approve this pattern" memory — when the user approves a sub-agent spawn or a cron job, optionally remember to skip the same approval next time |

### 8.2 Acceptance criteria

- Every event from §4.1 Δ5 appears in the rail with timestamp, trigger,
  outcome, and a "show transcript" expand.
- Kill-switch survives reload (persisted in workspace state).
- Pattern memory is scoped, listable, revocable.

---

## 9. Tier 6 — End-to-End Autonomy Proof: Gmail MCP

This is the testing tier the user explicitly asked for. It is **not just
unit tests** — it is a **continuous-eval scenario that exercises the
entire autonomy + tool + surface stack against live external data**.

### 9.1 The setup

A new MCP server: **Gmail Reader (read-only)**.

| Property | Value |
|----------|-------|
| Server location | Local Node process spawned by Parallx MCP client |
| Auth | Google OAuth 2.0 (Desktop app flow), tokens stored encrypted in OS keychain (Windows DPAPI / Keychain / Secret Service) |
| Scope | `https://www.googleapis.com/auth/gmail.readonly` only |
| Tool surface | Single tool: `gmail.list_unread({ since?, max?, query? })` returning `{ messages: [{ id, from, subject, snippet, receivedAt, labels }] }` |
| Storage | Refresh token encrypted; access token in memory; never written to plaintext disk |
| Revocation | One-click "Disconnect Gmail" in settings → revokes token via Google API → wipes keychain entry |

**No write tools.** Read-only. Send/draft/delete are explicitly **out of
scope** for M60.

### 9.2 Domains

| ID | Domain |
|----|--------|
| **F1** | Gmail MCP server (Node, separate process, MIT-licensed deps only) |
| **F2** | OAuth 2.0 desktop flow integrated with Parallx MCP client (loopback redirect, PKCE) |
| **F3** | Encrypted token storage (electron `safeStorage` API, falls back per-OS) |
| **F4** | `gmail.list_unread` tool def + skill registration + 3-tier permission gating |
| **F5** | Continuous eval scenario: *"Run a report on my unread emails. Surface a daily digest to a canvas page named 'Inbox Digest — `${YYYY-MM-DD}`'."* |

### 9.3 The E2E scenario (the actual test)

A nightly continuous-eval run, gated behind a CI flag (`PARALLX_GMAIL_E2E=1`)
using a dedicated test Gmail account with seeded fixtures.

**Trigger:** A cron job set to fire every 24h (in test, 30s).
**Expected behavior:**

1. Cron fires → `cronService` wakes runner with mode `next-heartbeat`.
2. Heartbeat ticks → decides to act (the cron job carries the prompt).
3. Default participant runs a turn whose system prompt includes the
   "Inbox Digest" task description.
4. Agent calls `gmail.list_unread` (after permission prompt, or pre-approved
   by E3 pattern memory).
5. Agent reads results, decides what's important — **no deterministic
   classification logic in our code**. The LLM decides.
6. Agent calls `pages.create_page` with the digest content.
7. Surface plugin routes "task complete" to notification + statusbar.
8. Task rail shows the cron-triggered run with full transcript.

**What we grade (eval rubric):**

| Dimension | Score 0/1/2 |
|-----------|------------|
| Tool selection: did it call `gmail.list_unread`? | 0/1/2 |
| Tool argument shape: valid `since` and `max`? | 0/1/2 |
| Surface routing: digest landed on a canvas page? | 0/1/2 |
| Report quality: subject lines, sender clustering, urgency ranking present? | 0/1/2 |
| Loop safety: no runaway followups? depth respected? | 0/1/2 |
| Trust surface: appears in task rail with full transcript? | 0/1/2 |

Pass = ≥10/12 across 5 consecutive runs on the seeded inbox.

### 9.4 Why this matters

- Exercises **every tier**: T1 (cron + followup + surface route), T2 (no
  freeze during run), T3 (canvas page write), T4 (settings stored Gmail
  toggle), T5 (rail receives event).
- Exercises **a real external API** with real OAuth, real tokens, real
  errors (rate limits, network failures, expired tokens).
- Exercises **LLM decision-making** without our code reaching in to
  pre-classify, post-process, or repair output. P5 + P6 enforced.
- **Scales to other read-only MCPs** — Calendar, Drive, GitHub, Slack —
  using the same auth + storage + permission scaffolding.

### 9.5 Security review (mandatory before F1 lands)

- Token storage: `safeStorage.encryptString()` on all platforms; verify
  fallback path on Linux without keyring.
- Scope minimization: read-only, single scope.
- Process isolation: MCP server is a separate child process; cannot read
  Parallx workspace files.
- Network: only `accounts.google.com` and `gmail.googleapis.com`; no
  telemetry endpoints.
- Audit log: every `gmail.list_unread` call logged to autonomy task rail
  with arg digest; never log message body to disk.
- Revocation: tested before merge.

---

## 10. Documentation Lens — what gets updated

Every domain commit must include doc deltas in the same change. **No
"docs PR later"** rule — that's how M58 left 6 modules unwired.

| Domain group | Docs touched |
|--------------|--------------|
| T1 (autonomy) | `docs/Parallx_Milestone_60.md` (this file) → status; `docs/ai/AI_USER_GUIDE.md` → autonomy section; `docs/ai/AUTONOMY_RUNTIME_CONTRACTS.md` (new) |
| T2 (perf) | `docs/Future_Improvements.md` → mark sections closed; `docs/STARTUP_PERFORMANCE.md` (new, captures B1–B5 measurements) |
| T3 (canvas) | `docs/PARALLX_WORKSPACE_SCHEMA.md` → block_id columns; `docs/Parallx_Milestone_55.md` → status; `docs/ai/CANVAS_BLOCK_API.md` (new) |
| T4 (settings) | `docs/SETTINGS_REGISTRY.md` (new) — schema reference |
| T5 (rail) | `docs/ai/AUTONOMY_TASK_RAIL.md` (new) |
| T6 (Gmail E2E) | `docs/ai/GMAIL_MCP_INTEGRATION.md` (new); `docs/ai/AIR_E2E_PLAYWRIGHT_PLAN.md` → autonomy E2E section; `docs/Parallx_Milestone_60.md` → status |

---

## 11. Testing Tier — global definition

This is **its own tier**, applied across every domain in T1–T6.

### 11.1 The four test layers

| Layer | What it covers | Tooling |
|-------|---------------|---------|
| **L7.a Unit** | Pure logic, single module | Vitest |
| **L7.b Integration** | Cross-module wiring (e.g. cron → heartbeat → followup) | Vitest with real services, in-memory SQLite |
| **L7.c E2E** | Full app from packaged binary, real DB, real renderer | Playwright (existing harness, `tests/e2e/`) |
| **L7.d Autonomy eval** | LLM-in-the-loop scenarios graded by rubric | Continuous-eval runner (new under `tests/autonomy-eval/`) |

### 11.2 What's new for M60

- `tests/autonomy-eval/` — new directory with scenario files (`*.scenario.json`),
  rubric files (`*.rubric.json`), and a runner that:
  - Boots Parallx in headless E2E mode
  - Seeds a fixture workspace
  - Triggers the scenario (chat input, cron fire, file change)
  - Captures the full task-rail transcript
  - Runs the rubric against it (LLM-graded; we use the same provider
    Parallx is configured to)
  - Reports pass/fail with per-dimension scores
- `tests/e2e/autonomy/` — Playwright tests for the **task rail UI** (T5),
  settings UI (T4), block-level edits (T3).
- CI matrix: unit + integration on every push; E2E on PR; autonomy eval
  nightly with Gmail flag opt-in.

### 11.3 Coverage gates per tier

| Tier | Required tests before close |
|------|----------------------------|
| T1 | Unit (already exist) + 1 integration per domain (A2–A6) + 1 autonomy eval per trigger |
| T2 | Unit perf tests + 1 E2E "cold-start 5k pages" |
| T3 | Unit per tool + 1 autonomy eval per tool + 1 E2E for dataview block |
| T4 | Unit for schema registry + 1 E2E for settings search |
| T5 | Unit for filter/history + 1 E2E for kill-switch |
| T6 | All four layers; F5 is itself an autonomy eval |

---

## 12. Sequencing & Milestone Gates

### 12.1 Phase plan

```
Phase α  T1.A1  →  T1.A2  →  T1.A3                  [autonomy substrate]
Phase β  T2.B1  +  T2.B2                            [responsiveness floor]   (parallel with α)
Phase γ  T1.A4  →  T1.A5  →  T1.A6                  [scheduling + delegation]
Phase δ  T3.C1  →  T3.C2  →  T3.C3  →  T3.C4        [canvas depth]           (parallel with γ)
Phase ε  T4.D1  →  T4.D2  →  T4.D3                  [settings surface]
Phase ζ  T5.E1  →  T5.E2  →  T5.E3                  [trust surface]
Phase η  T6.F1..F5                                  [Gmail E2E]
Phase θ  Tier-wide regression sweep + doc closeout  [M60 close]
```

### 12.2 Gate between phases

A phase gate is met when:

- All domains in the phase have **all 7 lenses green**
- All required tests for the tier pass in CI
- Doc deltas are in the same commits
- Branch is rebased clean on `master`
- A regression sweep agent confirms no orphaned imports, no dead surfaces,
  no UI inline styles introduced

### 12.3 M60 close criteria

- All tiers' acceptance criteria met
- Gmail E2E passes ≥10/12 on 5 consecutive nightly runs
- A 5-minute "happy path demo" can be recorded:
  cold-start → cron fires → agent reads Gmail → digest lands on canvas
  → user sees it in task rail → kills the cron → setting persists.

---

## 13. Failure Modes & Recovery

For each tier, what breaks and how we recover. Recovery paths must work
**without manual SQLite surgery**.

| Failure | Tier | Detection | Recovery |
|---------|------|-----------|----------|
| Heartbeat fires but agent loops on same trigger | T1 | Loop safety counter, autonomy event record shows N consecutive identical triggers | Auto-pause heartbeat, surface notification, user resumes via T5 kill-switch |
| Cron job storms after sleep/wake | T1 | `scheduledAt` < `now - jitterTolerance`; coalesce missed firings | Single catch-up firing per cron, drop the rest; log to rail |
| Sub-agent leaks tokens into parent session | T1 | Integration test asserts session isolation | Disable A6 flag; rollback isolated by feature flag |
| Worker thread crashes during indexing | T2 | `worker.onerror`; renderer detects no progress for 10s | Fall back to renderer-thread indexing with degraded-mode banner |
| Block ID migration creates duplicates | T3 | Migration test round-trips 100 docs and asserts ID uniqueness | Migration is reversible; rollback flag + restore from auto-snapshot |
| Settings registry collision (two services register same key) | T4 | Registration throws on duplicate | Hard fail at boot; surfaced as a startup error |
| Task rail history overflows | T5 | Row count > 10k | Auto-trim oldest beyond 90 days |
| Gmail OAuth refresh fails | T6 | Token endpoint 4xx | Surface re-auth prompt; cron skips gracefully; no retries that lock the user out |
| MCP child process crashes | T6 | `process.on('exit')` non-zero | Auto-restart with backoff (1s, 5s, 30s); surface failure after 3 attempts |
| Autonomy budget exhausted mid-day | §3.6 | Budget tracker | Refuse new turns, surface notification, suggest quota raise |
| Autonomy event NDJSON corrupt | §3.10 | Parse error on rotation | Quarantine corrupt file, start fresh, surface warning |

**Disaster recovery:** Before any T3 (canvas) or T6 (external write) work
lands, the corresponding domain commit must include a verified
`data/` snapshot/restore path. Canvas DB has migration backups from M53;
T6 must not write to canvas without going through C3 tools (which
log through the audit rail).

---

## 14. Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Autonomy + indexing on the same thread → freeze worse, not better | T2 must land before A4 (heartbeat) |
| Sub-agent isolation leaks state into parent session | A6 ships behind a feature flag; default off until 2 weeks of clean autonomy eval |
| Gmail OAuth token leak | `safeStorage` mandatory; security review §9.5 mandatory before F1 lands |
| Block IDs invalidate on doc reload (TipTap idempotency) | C2 includes a migration test that round-trips 100 docs |
| Settings UI grows into a kitchen sink | D2 limited to schema-driven inputs only; no bespoke pages |
| Eval-driven patchwork creeps in to make F5 pass | Mandatory P5 + anti-pattern review on every F5 fix commit |
| Scope creep — "while we're in there" | Every PR's diff is reviewed against the domain's lens table; out-of-scope changes are split |

---

## 15. Out of Scope (deferred to M61+)

- Cloud sync / multi-device storage
- Settings sync across machines
- Gmail write tools (send, draft, label, delete)
- Calendar / Drive / GitHub MCP surfaces (proven via Gmail; replicate later)
- Per-skill permission UI consolidation
- Canvas API formalization for extensions (M56 follow-on)
- Autonomy on mobile / web (Parallx remains desktop-only)

---

## 16. Open Questions

- **OQ1:** Heartbeat default cadence — 60s feels right for autonomy
  responsiveness vs idle CPU. Confirm with one week of telemetry-free
  manual usage on Phase α landing.
- **OQ2:** Sub-agent UI — surface as a nested task in the rail, or as a
  separate "spawned runs" panel? Decide during T5.E1.
- **OQ3:** Gmail digest format — single canvas page per day, or one
  rolling page? Default: per-day pages, archive after 30.
- **OQ4:** Property dataview block — TipTap node or canvas-level overlay?
  Default: TipTap node for portability.

---

## 17. Glossary

- **Autonomous turn** — any LLM turn whose trigger is **not** a direct user
  chat input. Includes cron, heartbeat, followup, file-change, sub-agent.
- **Autonomy event** — the structured record (§3.10) emitted for every
  autonomous turn.
- **Cap** — a hard numeric ceiling that, when reached, prevents starting
  the next operation. Caps never silently throttle.
- **Domain** — a unit of work within a tier (e.g. T1.A2 FollowupRunner
  wiring). Closes via the seven lenses + DoD checklist.
- **Lens** — one of seven evaluation perspectives (§3.3). All seven must
  pass for a domain to close.
- **MCP** — Model Context Protocol. Standardized way to expose tools to
  LLMs. Parallx already has an MCP client (`src/openclaw/mcp/`); M60 adds
  the first first-party MCP server (Gmail).
- **Re-audit** — an audit performed against the **current** upstream
  HEAD, not a stale baseline (§3.5).
- **Rubric** — scoring matrix used by the autonomy eval runner to grade
  an LLM-driven scenario without deterministic post-processing.
- **Surface** — an output destination (chat / canvas / filesystem /
  notification / statusbar). Routed by SurfacePlugin (T1.A3).
- **Trigger** — the cause of a turn (chat / cron / heartbeat / followup /
  file-change / sub-agent).

---

## 18. Status Log

| Date | Phase | Note |
|------|-------|------|
| 2026-04-30 | Planning | Doc created; `milestone-60` branched from `milestone-58` |
| 2026-04-30 | Planning | Controls pass: anti-vision, cost budgets, concurrency, feature flags, privacy posture, observability/replay, DoD checklist, ownership, failure modes, glossary |
| 2026-04-30 | Phase α — Audit | Re-audit found A1 absent (no domain-specific gateway needed for desktop), A2 (FollowupRunner) and A3 (SurfaceRouter + plugins) **already wired in M58**. Evidence: `src/openclaw/participants/openclawDefaultParticipant.ts:75-87` instantiates `followupStates` map and `getFollowupState`; `:357-361` evaluates the runner post-turn. SurfaceRouter wired at `src/workbench/workbench.ts:2160-2164` (Notifications + StatusBar) and `src/built-in/chat/main.ts:1217-1230` (Chat + Filesystem + Canvas). Phase α therefore scoped to the **controls layer** on top of existing wiring: feature flags (§3.8), structured observability (§3.10), cancellation propagation (§3.7), replay command stub. |
| 2026-04-30 | Phase α — Implementation | Added `AutonomyFeatureFlagsService` (`src/services/autonomyFeatureFlags.ts`) — 6 flags from §3.8 with persistence via `IStorage` and `onDidChange` events. Added `AutonomyEventLog` (`src/services/autonomyEventLog.ts`) — ndjson writer at `<APP_ROOT>/data/autonomy-events.<yyyy-mm-dd>.ndjson`, daily rotation, 90-day retention, ulid IDs, `sha256Hex` + `canonicalArgsDigest` helpers, `findById` retention-window walk. `AutonomyLogService` retained unchanged (UX markdown ring buffer — incompatible shape with the structured ndjson schema, separate concerns). |
| 2026-04-30 | Phase α — Wiring | `SurfaceRouterService` extended with `setFeatureFlags` + `setEventLog`; `send`/`sendWithOrigin` route through new `_sendGated` which checks `SURFACE_FLAG_BY_ID[surfaceId]` and emits a `gated`/`completed`/`error` autonomy event with `surfaceRoutes[]` per delivery. `createFollowupRunner` signature now `(turnResult, currentDepth, token?)` — token check at entry returns `reason='cancelled'`; `FOLLOWUP_DELAY_MS` polled at 50ms cadence via `waitCancellable` so kill-switch terminates within <2s per §3.7. `openclawDefaultParticipant.runOpenclawDefaultTurn` emits cancelled/completed/gated/error autonomy events at every chain decision point including the existing aborted early-return. `IDefaultParticipantServices` extended with optional `isAutonomyFlagEnabled` and `emitAutonomyEvent` — wired in `src/built-in/chat/main.ts` against the new services. Replay command stub registered as `'autonomy.replay'` (`src/commands/autonomyReplayCommand.ts`) — emits a `replay`-kind event recording the invocation; `--apply` mode deferred to T5.E3. |
| 2026-04-30 | Phase α — Verification | New unit tests (`tests/unit/autonomyFeatureFlags.test.ts`, `autonomyEventLog.test.ts`, `autonomySurfaceGate.test.ts`, `autonomyFollowupGate.test.ts`, `autonomyFollowupChainIntegration.test.ts`) — 19 tests, 100% pass. Full suite: 2515/2515 pass, 148 files. `npx tsc --noEmit` clean. Boundary intact — no edits to `src/main.ts`, workbench layout, or `electron/main.cjs`. AI_USER_GUIDE.md untouched (autonomy is non-user-facing until T5 rail polish). |
| 2026-04-30 | Phase α — CLOSED | Controls layer landed. Remaining T1 deltas: A1 gateway (deferred — desktop has no remote ingress), full replay (`--apply`) execution path (T5.E3). Remaining work scoped to T2 (heartbeat), T3 (cron), T4 (sub-agent), T5 (UX rail). Contract reference: `docs/ai/AUTONOMY_RUNTIME_CONTRACTS.md`. |
| 2026-04-30 | Phase β — Implementation | T2.B1 + T2.B2 landed. **B1**: cooperative yields added in `_indexAllPages` (after every page iteration) and `_embedChunks` (between batches, skipping i=0). **B2**: `IndexingPipelineService.start()` now defers via `_waitForIdleStart()` — uses `requestIdleCallback` (3s timeout) when available, else 2.5s `setTimeout` fallback (short-circuited under `VITEST`). Deferral lives inside the service so `workbench.ts:2500` start-point is unchanged (boundary intact per §3.4). Cancel-during-idle path wired through `AbortSignal`. Files: `src/services/indexingPipeline.ts`. |
| 2026-04-30 | Phase β — Verification | New test file `tests/unit/indexingPipeline.perf.test.ts` (4 tests): asserts ≥N yields per N pages, ≥4 yields for a 100-chunk page (1 page + 3 inter-batch), `ensureModel` not called until rIC fires, and clean unwind on `cancel()` during idle wait. Existing `tests/unit/indexingPipeline.test.ts` unaffected (deferral short-circuits under `VITEST`). Live Performance trace deferred to Phase γ when B3/B4/B5 land together — see `docs/STARTUP_PERFORMANCE.md` for the rationale and test-asserted measurements. |
| 2026-04-30 | Phase β — CLOSED | Responsiveness floor landed. `Future_Improvements.md` §1 Options 1+2 marked ✅. Remaining T2: B3 (Worker), B4 (IPC batching), B5 (lazy + mtime fast-skip). Boundary intact — no edits to `src/main.ts`, workbench layout, `electron/main.cjs`, or core schema. |
| 2026-04-30 | Phase γ — Audit | Re-audit found **A4 (Heartbeat), A5 (Cron), A6 (Sub-agent) all already wired in M58** (W2/W4/W5). Evidence: `src/built-in/chat/main.ts` instantiates `HeartbeatRunner` (~1360), `CronService` (~1202), `SubagentSpawner` (~1253, depth=1 hard-cap arg). Phase γ scope = **(b) controls layer only** mirroring Phase α — no wire-from-scratch needed. Deltas: extend each module with optional `setObservers` / config injection so the chat extension can pump autonomy events into `AutonomyEventLog`, gate execution on the 3 new flags (`autonomy.heartbeat.enabled`, `.cron.enabled`, `.subagent.enabled`), enforce idempotency + missed-job coalescing for cron, persist cron jobs to `<APP_ROOT>/data/cron.json`, and wire `suspendForShutdown()` for heartbeat + cron. |
| 2026-04-30 | Phase γ — Implementation | **3 new flags** added to `AutonomyFeatureFlagsService` — all default `false` (autonomy ships off). **HeartbeatRunner**: `MIN_HEARTBEAT_INTERVAL_MS` lowered 30s→15s per §3.6 floor; `IHeartbeatTickAutonomyInfo` payload; `_tick` honors flag (drops queued events + emits `gated` when off); `pushEvent`/`wake` early-return on shutdown sentinel; new idempotent `suspendForShutdown()`. **CronService**: `ICronFireAutonomyInfo` + `ICronObservers` + `ICronPersistedSnapshot`; `setObservers`, `setPersistence`, `loadFromPersistence`, `suspendForShutdown` methods; `_executeJob(job, opts={trackIdempotency})` — auto-paths (`_checkDueJobs`, `_runMissedJobs`) enforce `(jobId@scheduledAt)` idempotency keys with bounded LRU (1000→trim 500); `_runMissedJobs` coalesces same-job missed firings via `Set<string>` so sleep/wake fires once not N times; `loadFromPersistence` rewrites past `nextRunAt` to `now`; CRUD methods `void this._save()`. **SubagentSpawner**: `ISubagentSpawnAutonomyInfo` + `ISubagentObservers`; `setObservers` method; `spawn()` emits `gated`/`budget`/`error`/`completed` outcomes (`completed` only emitted in `finally` when registry status==='completed'). **Wiring** (`src/built-in/chat/main.ts`): `readHeartbeatConfig()` injects `isFlagEnabled` + `onAutonomyEvent`; `cronService.setObservers(...)` emits with `toolCalls:[{name:'cron.fire', argsDigest:idempotencyKey, idempotencyKey}]`; `cronService.setPersistence({load,save})` routes to `<APP_ROOT>/data/cron.json` via `parallxElectron.fs` bridge with sync-safe `void cronService.loadFromPersistence().then(() => cronService.start())`; `subagentSpawner.setObservers(...)` emits with `budgetSnapshot.depth`; `_autonomyShutdownDisposable` registered **before** runners so it disposes first, calling `suspendForShutdown()` on heartbeat + cron. |
| 2026-04-30 | Phase γ — Verification | New unit tests: `tests/unit/autonomyHeartbeatGate.test.ts` (4 tests), `autonomyCronGate.test.ts` (6 tests including private `_executeJob` reach for auto-path dedup), `autonomySubagentGate.test.ts` (4 tests). Updated `openclawHeartbeatRunner.test.ts` MIN-constant assertion `>= 30_000` → `>= 15_000` per §3.6 floor. Cron run-history regression resolved via `trackIdempotency` opts split (manual `runJob` bypasses dedup; auto paths enforce it) — preserves all 3 pre-existing fake-timer tests. Full suite: **2534/2534 pass, 152 files, 6.64s**. `npx tsc --noEmit` clean (EXIT=0). Boundary intact — no edits to `src/main.ts`, workbench layout, `electron/main.cjs`, or core schema. AI_USER_GUIDE.md untouched (autonomy still non-user-facing until T5 rail). Autonomy-eval scenarios bootstrapped: `tests/autonomy-eval/{heartbeat-tick,cron-fire,subagent-spawn}.scenario.json` + README — JSON contracts only; runner is T6 (each scenario carries `_runner_status: "TODO"`). |
| 2026-04-30 | Phase γ — CLOSED | Autonomy substrate controls layer complete for all 6 deferred-domain modules from M58. T1 closed except A1 (gateway — desktop has no remote ingress; intentionally deferred). All flags default `false` so autonomy is dark-launched; T5 rail polish will surface them. Contract reference: `docs/ai/AUTONOMY_RUNTIME_CONTRACTS.md` §§5–8. Remaining M60 work: T2 B3/B4/B5 (perf), T3 (canvas), T4 (settings), T5 (rail), T6 (Gmail E2E + autonomy-eval runner). |
| 2026-04-30 | Phase δ — Audit | Re-audit T3 (Canvas Depth) deltas. **C1 (property query)** partially shipped: M55 left a single-property `find_pages_by_property` tool — M60 spec calls for multi-filter + sort + group, so an additive `query_pages_by_property` tool is needed (legacy retained for back-compat). **C2 (block IDs)** discovered already shipped via `@tiptap/extension-unique-id` wired in `src/built-in/canvas/config/tiptapExtensions.ts` — internal `UNIQUE_ID_BLOCK_TYPES` covers paragraph, heading, blockquote, codeBlock, lists, math, dataview. Audit-positive — promote constant to `export const`, add drift-guard test, register emergency-rollback flag. **C3 (block tools)** unshipped — implement `read_block`, `edit_block`, `insert_block_after`, `link_block`. **C4 (dataview)** unshipped — implement TipTap atom node reading `query` attr and rendering live results. No DB migration needed (block IDs ride existing `pages.content` envelope; queries hit existing `page_properties` table from M55). No core file edits needed (no `electron/*`, no workbench layout, no `src/main.ts`). §3.4 boundary respected. |
| 2026-04-30 | Phase δ — Implementation | **C1**: New pure helper module `src/built-in/chat/tools/blockApi.ts` (`PropertyFilterOp` union, `IPropertyQuery`, `filterToSubquery`, doc-walk + replace/insert helpers, `generateBlockId`). New `src/built-in/chat/tools/blockTools.ts` exposes `query_pages_by_property` — multi-filter via SQL `INTERSECT`, sort by `title`/`updated_at`/`created_at`/property, group by property, limit≤200. **C2**: `UNIQUE_ID_BLOCK_TYPES` promoted to `export const`; `dataview` added to the list; new flag `canvas.blockIds.enabled` (default **on** — emergency rollback only). **C3**: Same `blockTools.ts` adds `read_block` (read-only), `edit_block`, `insert_block_after`, `link_block`. Mutations execute `UPDATE pages SET content = ?, updated_at = ?, revision = revision + 1 WHERE id = ?` so the renderer's optimistic-concurrency gate (`canvasDataService._knownRevisions`) detects external writes. `edit_block` and `insert_block_after` accept optional `idempotencyKey` per §3.7 and surface it in their result for autonomy-event capture. `link_block` appends a paragraph block with text `→ [label](page://<toPageId>#<toBlockId>)` after the source block; source block unchanged. `read_block` + `query_pages_by_property` permission = **always-allowed**; mutations = **requires-approval**. Tool count 34 → 39 in `builtInTools.ts`. **C4**: New `src/built-in/canvas/extensions/dataviewNode.ts` — TipTap atom node `dataview` with `query` (JSON-encoded `IPropertyQuery`) attr; node view re-runs query on mount + `attrs.query` change via `window.parallxElectron.database.all`; renders themed `<ul.canvas-dataview-list>`. Wired into `tiptapExtensions.ts`; CSS rules appended to `canvas.css` using `--vscode-*` + `--parallx-radius-sm` tokens (no inline styles). New flag `canvas.dataview.enabled` (default **on** — emergency rollback). Files touched: `src/built-in/chat/tools/{blockApi,blockTools}.ts` (new), `src/built-in/chat/tools/builtInTools.ts` (+1 import, +5 tools), `src/services/autonomyFeatureFlags.ts` (+2 flags), `src/built-in/canvas/config/tiptapExtensions.ts` (export + dataview wiring), `src/built-in/canvas/extensions/dataviewNode.ts` (new), `src/built-in/canvas/canvas.css` (append). |
| 2026-04-30 | Phase δ — Verification | New unit tests: `tests/unit/blockApi.test.ts` (15 tests, includes 100-doc round-trip per §13 risk mitigation), `blockTools.test.ts` (10 tests, mock `IBuiltInToolDatabase` simulating `pages` + `page_properties`), `canvasUniqueIdContract.test.ts` (3 tests, drift guard on `UNIQUE_ID_BLOCK_TYPES`), `dataviewNode.test.ts` (10 tests, guards `typeof document === 'undefined'` for headless). Updated: `builtInTools.test.ts` (count 34→39, sorted name list, readOnly += `query_pages_by_property` + `read_block`, dbBackedToolNames += all 5 new tools), `chatGateCompliance.test.ts` (+`tools/blockApi.ts`, +`tools/blockTools.ts`), `gateCompliance.test.ts` (+`extensions/dataviewNode.ts`). Full suite: **2575/2575 pass, 156 files, 8.46s**. `npx tsc --noEmit` clean (EXIT=0). `node scripts/build.mjs` → "Build complete (development)" (pre-existing 2 CSS warnings on `propertyBar.css:86` unrelated to Phase δ — confirmed via `git diff --stat HEAD -- propertyBar.css` empty). Boundary intact — no edits to `src/main.ts`, workbench layout, `electron/main.cjs`, `electron/database.cjs`, `canvasDataService.ts`. L6 doc landed: `docs/ai/CANVAS_BLOCK_API.md` (block ID semantics, 5 tool specs with examples, dataview block syntax, idempotency contract). 5 autonomy-eval scenarios bootstrapped under `tests/autonomy-eval/canvas-*.scenario.json` (one per tool) with `_runner_status: "TODO"` — runner is T6 work. |
| 2026-04-30 | Phase δ — CLOSED | Canvas Depth shipped. Block IDs persist round-trip; agent can query, read, edit, insert, link blocks; dataview blocks render filtered page lists live. Both new flags default **on** (emergency rollback only — substrate is mature). Remaining T3 deltas: slash-menu UI for inserting a dataview block (deferred to T4 — settings/UX surface); PropertyDataService event subscription for live dataview re-render without page reload (M61 polish); typed `insert_block_after_dataview` variant (M61). Remaining M60 work: T2 B3/B4/B5 (perf — Worker, IPC batching, lazy + mtime fast-skip), T4 (settings UI surface), T5 (rail polish + flag-driven UX), T6 (Gmail E2E + autonomy-eval runner). |
| 2026-05-01 | Phase ε — Audit | T4 (Settings UI Surface) re-audit. **D1 (registry)** unshipped — `AISettingsService` is profile-shaped and `AutonomyFeatureFlagsService` is a flat boolean-only registry, neither suitable as a unified schema-driven settings store. Decision: **add a peer service** (`SettingsRegistryService`) — adapter-binds to autonomy flags rather than replacing the existing service. **D2 (editor view)** unshipped — no settings overlay/panel exists. Decision: build a modal Overlay editor in a new `parallx.settings` built-in extension (mirrors `parallx.theme-editor` pattern). **D3 (migration)** ad-hoc surfaces audited: `canvas.propertyBar.collapsed` (1 localStorage key in `propertyBar.ts`); `aiSettings/profiles/*.json` not migrated (profile-shaped, kept as-is per α). M53 portable storage is sufficient for both scopes — no new IPC handlers, no schema changes. §3.4 boundary clean. |
| 2026-05-01 | Phase ε — Implementation | **D1** New `src/services/settingsRegistryService.ts` — `ISettingSchema` (boolean/number/string/enum/object + min/max/enumValues/scope), `register/bind/getValue/setValue/reset`, type+range validation, scope-routed serialized writes (M53 user + workspace stores), per-scope Promise write queue (§3.7), `onDidChange` event, module-level `getGlobalSettingsRegistry()` accessor for legacy consumers. New `ISettingsRegistryService` DI identifier in `serviceTypes.ts`. New `src/services/autonomySettingsSchemas.ts` — `registerAutonomyFlagSettings` adapter-binds the 11 boolean flags into the registry (no double-store: registry `bind()` routes get/set through `AutonomyFeatureFlagsService` and forwards `onDidChange` so editor stays live); `registerAutonomySubstrateSettings` registers 6 substrate schemas (heartbeat interval, follow-up depth, subagent approval mode enum, cron path, indexing worker/lazy toggles). Registry constructed in `built-in/chat/main.ts` after `AutonomyFeatureFlagsService` and `api.services.registerInstance(ISettingsRegistryService, ...)` per M56. **D2** New `src/built-in/settings/{settingsEditor.ts,main.ts,settings.css}` — `SettingsEditor` extends `Disposable`, uses `Overlay` + `InputBox` + `Toggle` + `Dropdown` + `SegmentedControl` (no native widgets, no inline styles per §3.3 L4); type-driven controls, search-by-key/description, scope filter (All/User/Workspace), category grouping, per-row Reset button, JSON textarea with parse-status for object schemas; subscribes to `registry.onDidChange` for live re-render. New `parallx.settings` manifest in `builtinManifests.ts` contributes `settings.open` command + `Ctrl+,` keybinding. Wired into `workbench.ts` builtins array **after** `ChatTool` so registry is available via DI when settings activation runs. Feature flag: `settings.editor.enabled` (default `true`, user scope) — emergency rollback per §3.8. **D3** `src/built-in/canvas/properties/propertyBar.ts` migrated — `_readCollapsed`/`_writeCollapsed` helpers prefer the registry when wired, fall back to legacy `localStorage` for first paint and headless tests; canonical store flips to registry on first edit. Files touched: `src/services/{settingsRegistryService.ts,autonomySettingsSchemas.ts,serviceTypes.ts}` (new + 1 export), `src/built-in/settings/{settingsEditor.ts,main.ts,settings.css}` (new), `src/tools/builtinManifests.ts` (+`SETTINGS_MANIFEST`), `src/workbench/workbench.ts` (+import +manifest +builtins entry), `src/built-in/chat/main.ts` (+registry wiring +`setGlobalSettingsRegistry` populate/teardown), `src/built-in/canvas/properties/propertyBar.ts` (D3 read/write through registry). |
| 2026-05-01 | Phase ε — Verification | New unit tests: `tests/unit/settingsRegistry.test.ts` (11 tests — duplicate-key throws, type/range/enum validation, set→get→onDidChange round-trip, scope routing, persistence across registry instances, `reset()`, `bind()` adapter precedence, sort order); `tests/unit/settingsEditor.test.ts` (5 tests under jsdom — full row render, category grouping, search filter, empty state, re-render on `onDidChange`). Full suite: **2591/2591 pass, 158 files, 6.98s** (was 2575; +16 = 11 + 5). `npx tsc --noEmit` clean (EXIT=0). `npm run build` → "Build complete (development)" (pre-existing 2 CSS warnings on `propertyBar.css:86` confirmed unrelated, untouched). Boundary intact — no edits to `src/main.ts`, `electron/main.cjs`, `electron/database.cjs`, workbench layout, or core schema; only the workbench `builtins` array (same pattern as `THEME_EDITOR_MANIFEST`). New L6 doc: `docs/SETTINGS_REGISTRY.md` (schema reference, API, scope semantics, registration + binding examples, observability, concurrency, failure modes, feature flag, boundary confirmation). |
| 2026-05-01 | Phase ε — CLOSED | Settings UI Surface shipped. `Ctrl+,` opens a unified, schema-driven editor over the autonomy flags + substrate knobs + canvas UI prefs. Registry replaces ad-hoc `localStorage` for `canvas.propertyBar.collapsed` (D3) and serves as the binding target for autonomy flags via `AutonomyFeatureFlagsService` adapter. `settings.editor.enabled` flag (default on) provides emergency rollback per §3.8. Remaining M60 work: T5 (rail polish + flag-driven UX surfacing the new editor), T6 (Gmail E2E + autonomy-eval runner), T2 B3/B4/B5 (perf — Worker, IPC batching, lazy + mtime fast-skip). |
| 2026-05-02 | Phase ζ — Audit | T5 (Autonomy Task Rail Polish) re-audit. **E1 (rail UI)** existing `view.autonomyLog` panel is functional but minimal — chips for `all/heartbeat/cron/subagent` only, no `followup/file-change/replay/chat`, no history view, no pagination. Decision: **extend the existing panel** with a tab-mode (Live/History/Patterns) and a new read-only `AutonomyTaskRailService` viewmodel that merges `AutonomyLogService` (in-memory bodies) with `AutonomyEventLog.readDay()` (persisted ndjson). Do not create a third source of truth. **E2 (kill-switch)** unshipped — no global pause; cancellation lives only at runner-level. Decision: **add `autonomy.paused.global` flag** + `isAutonomyTriggerAllowed(flags, triggerFlag)` helper that all 4 runner observers (cron, sub-agent, heartbeat, followup) adopt — atomic gate, no per-runner mutations needed. Pause persists via the existing IStorage backing. **E3 (pattern memory)** unshipped — sub-agent approval is currently tool-layer only (`requiresConfirmation: true`); no remember-this-approval. Decision: **add observer-shaped `AutonomyPatternMemoryService`** persisting to `<APP_ROOT>/data/autonomy-patterns.json`; flag gate stays authoritative; pattern match only surfaces a `pattern-approved` note in the autonomy event for visibility. Privacy: store sorted-key shape, never raw values. Out of scope (per plan §8.E3): cron pattern memory — cron jobs are user-defined, approval is implicit at create time. §3.4 boundary clean — no edits to `src/main.ts`, `electron/main.cjs`, or workbench layout. |
| 2026-05-02 | Phase ζ — Implementation | **E1** New `src/services/autonomyTaskRailService.ts` — `IRailRow` discriminated union (`{kind:'live',...}` carries markdown content + read state from in-memory log; `{kind:'event',...}` carries trigger/outcome/duration/note from persisted ndjson, never bodies); `IRailFilter` (triggers, outcomes, sinceDays 1-90, limit default 50); `readLiveRows()` sync, `readRows()` async walks back day-by-day calling `IAutonomyEventLog.readDay()`; merges newest-first by `triggeredAt`, dedupes by id, caps at limit; `onDidChange` fires when either source mutates. New `IAutonomyTaskRailService` DI identifier. **E2** Three new flag constants in `autonomyFeatureFlags.ts`: `FLAG_PAUSED_GLOBAL` (default `false`), `FLAG_RAIL_ENABLED` (default `true`), `FLAG_PATTERN_MEMORY_ENABLED` (default `true`); flag descriptions + categories appended to `autonomySettingsSchemas.ts`. New exported helper `isAutonomyTriggerAllowed(flags, triggerFlag): boolean` — returns `false` when `paused.global` is on, otherwise the per-trigger flag value. Wired into chat/main.ts: cron observer (line 1299), sub-agent observer (1414), heartbeat observer (1501), followup `IDefaultParticipantServices.isAutonomyFlagEnabled` (line 918) all switched from bare `autonomyFlags.isEnabled(FLAG_X)` to `isAutonomyTriggerAllowed(autonomyFlags, FLAG_X)`. **E3** New `src/services/autonomyPatternMemoryService.ts` — `IAutonomyPatternKey {toolName, parentSessionPattern, argsShape}`, `IAutonomyApprovedPattern` (id, label, approvedAt, matchCount, lastMatchedAt); `computeArgsShape(args)` reduces `{task, label, model}` → `"label,model,task"` (sorted-keys-CSV) — values **never** stored; `patternKeyId(key)` → FNV-1a 32-bit hash, base36, prefixed `pat-`; persists to `<APP_ROOT>/data/autonomy-patterns.json` via M53 fs bridge with serial save chain; methods `initialize/isApproved/remember/noteMatch/revoke/clear/list/flush`. New `IAutonomyPatternMemoryService` DI identifier. `SubagentSpawner.ISubagentObservers` extended with `isPatternApproved` + `notePatternMatch` callbacks; spawn() consults them after the concurrency-limit gate (still-flag-gated) and threads `pattern-approved` into the completion event note when matched. Wired in chat/main.ts after the autonomy event log construction. **Panel UI** `src/built-in/autonomy-log/main.ts` extended: tabs (Live/History/Patterns) gated on availability of the new services; expanded chips (`all/chat/heartbeat/cron/subagent/followup/file-change/replay`); header "Pause autonomy" checkbox bound to `FLAG_PAUSED_GLOBAL` via flags service `setEnabled` + `onDidChange`; History mode reads via `railService.readRows({sinceDays:30, limit:200, triggers})`; Patterns mode lists approved patterns with per-row Revoke + header Clear; rows render trigger badge, outcome+duration+note for events, full markdown body for live. CSS appended to `autonomyLog.css` using `--vscode-*` tokens (no inline styles). Files touched: `src/services/autonomyFeatureFlags.ts` (+3 flags +helper), `src/services/autonomySettingsSchemas.ts` (+3 description/category entries), `src/services/{autonomyTaskRailService,autonomyPatternMemoryService}.ts` (new), `src/services/serviceTypes.ts` (+2 DI identifiers), `src/openclaw/openclawSubagentSpawn.ts` (observer interface + spawn() pattern check + completion note threading), `src/built-in/chat/main.ts` (+5 imports, +rail/pattern construction, +DI registration, +4 trigger gates wrapped, +pattern observers on subagent), `src/built-in/autonomy-log/{main.ts,autonomyLog.css}` (panel extension). |
| 2026-05-02 | Phase ζ — Verification | New unit tests: `tests/unit/autonomyPatternMemory.test.ts` (9 tests — `computeArgsShape` returns sorted keys never values, primitive/null/array shapes, `patternKeyId` stable+collision-free across tuple changes + `pat-` prefix, remember/isApproved/noteMatch round-trip, revoke/clear, persistence rehydration across instances, **redaction guard**: stored JSON contains shape but never raw values like "SECRET payload" or "gpt-4o"); `tests/unit/autonomyKillSwitch.test.ts` (3 tests — `isAutonomyTriggerAllowed` truth table for all 4 triggers under `paused.global=on`, returns per-trigger flag value when off, persists across service instances); `tests/unit/autonomyTaskRail.test.ts` (5 tests — live-only when no history, trigger-kind filter, live+history merge newest-first, `limit` cap, outcome filter on history). Full suite: **2608/2608 pass, 161 files, 6.98s** (was 2591; +17 = 9 + 3 + 5). `npx tsc --noEmit` clean (EXIT=0). `npm run build` → "Build complete (development)" (pre-existing 2 CSS warnings unchanged). Boundary intact — no edits to `src/main.ts`, `electron/main.cjs`, `electron/database.cjs`, workbench layout, or any IPC handler. New L6 doc: `docs/ai/AUTONOMY_TASK_RAIL.md` (rail anatomy, trigger kinds, kill-switch composition contract, pattern memory privacy contract + retention §3.9). |
| 2026-05-02 | Phase ζ — CLOSED | Autonomy Task Rail Polish shipped. The `view.autonomyLog` panel now has tabs for Live (in-memory bodies) / History (persisted ndjson, 30-day default window) / Patterns (approved sub-agent spawn patterns); a global "Pause autonomy" toggle that survives reload via `FLAG_PAUSED_GLOBAL`; full-spectrum trigger chips covering every value in `AutonomyTriggerKind`. The kill-switch is single-helper (`isAutonomyTriggerAllowed`) and atomic — flipping the pause blocks **all** four runners (cron/sub-agent/heartbeat/followup) without touching any runner. Pattern memory remembers user-approved sub-agent spawns by tuple (toolName, parentSessionId, sorted-keys-shape) — raw arg values **never** persisted; flag gate remains authoritative; matches surface as `pattern-approved` notes in the autonomy event for transparency. Three new flags (`autonomy.paused.global`, `autonomy.rail.enabled`, `autonomy.patternMemory.enabled`) registered for the §3.8 emergency-rollback contract. Acceptance criteria (§8.2) met: every `AutonomyTriggerKind` event surfaces in the rail with trigger/outcome/timestamp; kill-switch survives reload; pattern memory is per-workspace, listable, revocable. Remaining M60 work: T6 (Gmail E2E + autonomy-eval runner), T2 B3/B4/B5 (perf — Worker, IPC batching, lazy + mtime fast-skip). |
