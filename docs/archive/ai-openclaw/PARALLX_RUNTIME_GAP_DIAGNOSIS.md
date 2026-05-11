# Parallx Runtime Gap Diagnosis

**Status:** Active diagnosis artifact  
**Date:** 2026-03-24  
**Purpose:** Capture, in user-readable form, what the sub-100 AI-eval results are actually telling us about the current Parallx runtime after the default chat surface migration.

---

## 1. Why This Document Exists

The default chat surface migration removed workflow labels as semantic authority.

That change was correct, but the remaining below-100 AI-eval results still
matter. They should not be dismissed as stale just because the architecture has
changed.

The correct question is not:

- "Which workflow should we restore for this test?"

The correct question is:

- "What general runtime capability is still missing, such that a normal user
  phrasing does not yet produce the right evidence set, memory scope, or answer
  shape?"

This document answers that question.

---

## 2. Executive Summary

The sub-100 results do **not** show that Parallx needs to go back to the old
workflow machine.

They show that Parallx still lacks several explicit runtime contracts that a
strong claw/NemoClaw-like system would make first-class:

1. a deterministic exhaustive target-set and completeness contract;
2. a canonical entity-binding layer for ambiguous and duplicate references;
3. a compare/diff orchestration contract for multi-document contradiction work;
4. an explicit session-start and memory-layer recall contract;
5. hard conversational isolation so a greeting cannot leak into retrieval;
6. truthful bootstrap and RAG readiness semantics.

The current system is strong when the user names a clear target and weak when
the runtime must first construct the target set, bind ambiguous references, or
arbitrate among context layers.

That is the real gap.

### 2.1 Verified NemoClaw baseline

Before using NemoClaw as an architectural reference, it is important to be
precise about what NemoClaw actually handles.

Verified upstream evidence from `NVIDIA/NemoClaw` shows the following.

1. NemoClaw is primarily a runtime-control and sandboxing stack, not a
   user-turn evidence planner.
   Evidence:
   - `docs/about/how-it-works.md` describes a thin plugin plus versioned
     blueprint split.
   - `docs/reference/architecture.md` says the plugin is a thin TypeScript
     package that registers an inference provider and the `/nemoclaw` slash
     command.
   - `nemoclaw/src/index.ts` registers a provider and a slash command rather
     than a rich request-interpretation or evidence-planning layer.

2. NemoClaw explicitly owns reproducible runtime setup and policy boundaries.
   Evidence:
   - `docs/about/how-it-works.md` documents digest verification, blueprint
     planning, OpenShell resource creation, and inference routing through the
     sandbox.
   - `README.md` states that every network request, file access, and inference
     call is governed by declarative policy.
   - `docs/about/how-it-works.md` and `README.md` document operator approval
     for unknown egress through the OpenShell TUI.

3. NemoClaw explicitly uses file-backed workspace state and session-start file
   loading.
   Evidence:
   - `docs/workspace/workspace-files.md` documents `SOUL.md`, `USER.md`,
     `IDENTITY.md`, `AGENTS.md`, `MEMORY.md`, and `memory/*.md` as the
     persistent workspace files.
   - `docs/workspace/workspace-files.md` states that these files are read by the
     agent at the start of every session.

4. NemoClaw exposes more runtime state than a single vague readiness flag.
   Evidence:
   - `nemoclaw/src/commands/slash.ts` surfaces blueprint version, run ID,
     sandbox identity, and update time through `/nemoclaw status`.
   - `bin/nemoclaw.js` and `docs/reference/commands.md` expose sandbox status,
     policy listing, logs, and connect/status commands.

5. NemoClaw does **not** appear to implement the specific file-enumeration,
   compare/diff, or completeness logic we still need on the Parallx default
   chat surface.
   Evidence:
   - the published NemoClaw architecture and plugin source describe sandbox,
     provider, blueprint, policy, and state management;
   - they do not describe a turn-level file inventory planner, duplicate-file
     binder, compare/diff executor, or RAG completeness layer in the NemoClaw
     plugin itself.

The implication is important:

- NemoClaw is still the right reference for runtime discipline, explicit file
  state, approvals, reproducibility, and inspectable status.
- NemoClaw is **not** a drop-in answer for Parallx's remaining evidence-planning
  gaps.
- For those gaps, Parallx must build its own runtime contracts using the same
  discipline rather than trying to imitate old workflow semantics.

### 2.2 Verified OpenClaw baseline

Because Parallx is closer in product shape to OpenClaw than to NemoClaw, the
more important upstream comparison is what OpenClaw itself explicitly owns.

Verified upstream evidence from `openclaw/openclaw` shows the following.

1. OpenClaw owns the session/control plane explicitly.
   Evidence:
   - `docs/help/faq.md` describes the Gateway as the always-on control plane.
   - `docs/reference/session-management-compaction.md` states that the Gateway
     is the source of truth for session state.
   - `docs/concepts/session.md` documents `sessions.json` plus `*.jsonl`
     transcripts as the two persistence layers.

2. OpenClaw uses a workspace-root bootstrap model for runtime context.
   Evidence:
   - `docs/concepts/agent.md` says OpenClaw uses a single workspace directory as
     the agent's working directory.
   - `docs/concepts/agent.md` also says that on the first turn of a new session,
     OpenClaw injects the contents of `AGENTS.md`, `SOUL.md`, `TOOLS.md`,
     `BOOTSTRAP.md`, `IDENTITY.md`, and `USER.md` into the agent context.
   - `docs/concepts/agent-workspace.md` and `docs/start/openclaw.md` document
     the workspace layout and startup files in more detail.

3. OpenClaw makes memory layers explicit and file-backed.
   Evidence:
   - `docs/concepts/memory.md` says memory is plain Markdown in the agent
     workspace and the files are the source of truth.
   - `docs/concepts/memory.md` defines the two default memory layers:
     `memory/YYYY-MM-DD.md` and optional `MEMORY.md`.
   - `docs/concepts/agent-workspace.md` says daily memory should read today +
     yesterday on session start and `MEMORY.md` should only load in the main,
     private session.

4. OpenClaw separates transcript persistence from memory.
   Evidence:
   - `docs/reference/session-management-compaction.md` distinguishes the session
     store (`sessions.json`) from append-only transcript files (`*.jsonl`).
   - `docs/concepts/session.md` and `docs/start/openclaw.md` document transcript
     locations separately from workspace memory files.

5. OpenClaw exposes explicit memory tools and memory-flush behavior.
   Evidence:
   - `docs/concepts/memory.md` says memory search tools come from the active
     memory plugin.
   - `docs/cli/memory.md` documents the `openclaw memory` surface.
   - `docs/concepts/compaction.md` and `docs/concepts/memory.md` document a
     silent pre-compaction memory flush.
   - `docs/automation/hooks.md` documents the bundled `session-memory` hook,
     which writes session context to workspace memory on `/new` or `/reset`.

6. OpenClaw owns runtime boundaries and tool wiring, but broad evidence
   gathering is still largely model-led through tools rather than a dedicated
   deterministic planner.
   Evidence:
   - `docs/concepts/agent.md` says the embedded runtime is built on the Pi core,
     while session management, discovery, and tool wiring are OpenClaw-owned.
   - `docs/tools/index.md` lists the built-in read/write/edit/exec/browser/web
     tools.
   - `docs/concepts/context.md` describes context as OpenClaw-built system
     prompt plus conversation history plus tool calls/results and injected
     workspace files.
   - the published OpenClaw docs do not describe a deterministic exhaustive file
     inventory planner, duplicate-target resolver, or compare/diff execution
     contract for normal grounded turns.

The implication is also important:

- OpenClaw is the strongest upstream reference for file-backed session start,
  workspace-root prompt injection, explicit memory layers, transcript
  separation, and gateway-owned runtime state.
- OpenClaw still does not appear to solve Parallx's remaining broad evidence
  planning gaps with a deterministic inventory/completeness contract.
- So Parallx should copy OpenClaw's explicit runtime/file-state discipline while
  adding stronger evidence-planning contracts for the desktop second-brain use
  case.

---

## 3. What The Results Actually Show

### 3.1 What is already strong

The main AI quality suite shows that Parallx is already strong at:

1. single-document factual recall;
2. narrow exact-value retrieval;
3. follow-up understanding;
4. hallucination guardrails on clearly scoped asks;
5. source attribution and citation behavior;
6. clean social response behavior in many ordinary turns.

That means the core retrieval substrate, synthesis path, and general grounding
model are not the main problem.

### 3.2 What is still weak

The remaining failures cluster around asks where the runtime must do more than
"retrieve something relevant":

1. build the full file set for a workspace-wide or folder-wide request;
2. bind two same-name or otherwise ambiguous files;
3. align two documents and surface contradictions or differences;
4. choose correctly between daily memory, durable memory, and transcript-like
   prior context;
5. guarantee that a conversational turn stays fully isolated from retrieval;
6. truthfully declare when the workspace is actually ready for RAG.

Those are control-plane problems, not merely prompt-shaping problems.

---

## 4. Missing Runtime Contracts

### 4.1 Exhaustive target-set and completeness contract

For broad requests such as:

- summarize each file in this workspace;
- summarize each file in the policies folder;
- give me an overview of the notes folder;
- extract all deductible amounts from every policy document;

the runtime should be able to answer these questions before synthesis:

1. What is the exact set of files in scope?
2. Which of those files were actually read?
3. Which were skipped, truncated, or never reached?
4. Is the answer exhaustive, partial, or representative?

Parallx already has partial pieces of this:

- coverage-mode signaling in the route and context plan;
- structural enumeration;
- deterministic read steps;
- evidence coverage calculation.

But the current implementation still behaves like "best effort exhaustive"
rather than a strict runtime contract.

Relevant hotspots:

- `src/built-in/chat/utilities/chatContextPlanner.ts`
- `src/built-in/chat/utilities/chatEvidenceGatherer.ts`
- `src/built-in/chat/utilities/chatContextAssembly.ts`

Verified NemoClaw evidence:

- `docs/about/how-it-works.md` shows NemoClaw's control plane explicitly plans
  and applies sandbox resources before runtime execution.
- `docs/reference/architecture.md` and `nemoclaw/src/index.ts` show that this
  control plane is kept outside the chat turn itself, with the plugin staying
  thin and orchestration owned by the blueprint/runtime side.

Parallx implementation implication:

- Parallx should treat exhaustive coverage the same way NemoClaw treats sandbox
  creation and policy application: as an explicit pre-synthesis runtime phase
  with inspectable outputs, not as a soft prompt hint.

Verified OpenClaw evidence:

- `docs/concepts/agent.md` and `docs/concepts/context.md` show that OpenClaw
  explicitly injects workspace bootstrap files and then lets the embedded agent
  runtime operate with tool calls/results inside context.
- `docs/tools/index.md` shows that OpenClaw provides the read/write/edit and
  related tools needed for exploration, but the published architecture does not
  describe a deterministic exhaustive file inventory pass for normal grounded
  turns.

Parallx implementation implication from OpenClaw:

- Parallx should not restore a hidden summary workflow. It should add a runtime
  phase that constructs the exact target set before model synthesis, because the
  broad-exploration contract is the piece OpenClaw's published model does not
  provide for our product shape.

Observed missing property:

- the runtime can label a request exhaustive without guaranteeing a complete
  and inspectable target set.

This is the main issue behind the below-100 broad-summary and broad-extraction
stress cases.

### 4.2 Canonical entity-binding contract

User phrasing is often ambiguous in a normal way:

- compare the two how-to-file documents;
- summarize the notes folder;
- compare auto-policy-2024 and auto-policy-2023;
- tell me about everything in here.

The runtime needs a strong binding layer that resolves these references into a
canonical set of document targets before retrieval and synthesis begin.

Today, Parallx still relies too heavily on phrase-pattern extraction and bounded
workspace scans.

Relevant hotspot:

- `src/built-in/chat/utilities/chatScopeResolver.ts`

Verified NemoClaw evidence:

- `docs/workspace/workspace-files.md` and the generated workspace references
  make the workspace file set explicit, file-backed, and inspectable inside a
  known root (`/sandbox/.openclaw/workspace/`).
- NemoClaw's published runtime docs do not show a fuzzy hidden path; they show
  a concrete workspace root and explicit file inventory for persistent state.

Parallx implementation implication:

- Parallx should strengthen its entity binder around an explicit runtime
  inventory of candidate files and folders rather than expanding regex-based
  phrasing patches.

Verified OpenClaw evidence:

- `docs/concepts/agent.md` defines the workspace as the agent's only working
  directory.
- `docs/concepts/agent-workspace.md` documents a known file map under that
  workspace.
- OpenClaw therefore starts from a stable workspace root and explicit file set,
  but its published docs do not show a duplicate-document binding contract for
  natural-language comparison asks.

Parallx implementation implication from OpenClaw:

- Parallx should adopt the same stable-workspace-root mindset, then add an
  explicit binder that can resolve ambiguous file references against that
  inventory before retrieval or compare/diff execution begins.

Observed missing property:

- entity binding is still opportunistic and pattern-sensitive instead of being a
  durable runtime-owned contract.

This is the main issue behind duplicate-filename comparison misses and some of
the weak folder-overview cases.

### 4.3 Compare/diff orchestration contract

Multi-document reasoning should not depend on the model noticing a difference
incidentally from whichever snippets happen to arrive.

For real comparison work, the runtime should own the structure:

1. resolve both targets;
2. read both targets or equivalent authoritative evidence;
3. align the comparable fields;
4. hand the model an explicit contrast-ready evidence bundle.

Parallx currently has prompt guidance and skill-language around comparison, but
the execution contract is still weaker than it needs to be.

Relevant hotspots:

- `src/built-in/chat/utilities/chatScopeResolver.ts`
- `src/built-in/chat/utilities/chatExecutionPlanner.ts`
- `src/built-in/chat/utilities/chatEvidenceGatherer.ts`

Verified NemoClaw evidence:

- `docs/reference/architecture.md` and `docs/about/how-it-works.md` show a
  clear upstream pattern: runtime concerns are decomposed into explicit phases
  and owned by distinct layers instead of being left as an undifferentiated
  chat behavior.
- NemoClaw does not publish a built-in compare/diff turn executor in the plugin
  layer, which means this capability is not solved there by a hidden semantic
  router.

Parallx implementation implication:

- Parallx should implement compare/diff as an explicit runtime execution shape:
  bind targets, gather both evidence sets, align fields, then synthesize.
  The lesson from NemoClaw is the explicit staged ownership, not a direct code
  transplant.

Verified OpenClaw evidence:

- `docs/tools/index.md` and `docs/concepts/context.md` show that OpenClaw gives
  the model a tool-rich runtime and contextual bootstrap files.
- `docs/concepts/agent.md` says runtime boundaries and tool wiring are
  OpenClaw-owned layers on top of the Pi core.
- The published docs still do not describe a first-class compare/diff runtime
  operator for ordinary workspace questions.

Parallx implementation implication from OpenClaw:

- Parallx should keep the model/tool loop, but add a dedicated compare/diff
  evidence phase when the user intent requires two-target alignment. That is the
  missing contract between OpenClaw-style model-led tool use and Parallx's
  higher-precision workspace QA demands.

Observed missing property:

- comparison and contradiction handling are not yet owned by one explicit
  runtime contract.

This is the main issue behind the policy-difference and duplicate-document
comparison misses.

### 4.4 Explicit memory-layer startup and recall contract

The memory-layer tests are correct to demand a clear distinction among:

1. durable memory;
2. daily memory;
3. transcript/session history;
4. fresh-session behavior.

The intended OpenClaw/NemoClaw-aligned direction is already documented in the
repo: continuity should be explicit, file-backed, and layered.

But the live runtime still mixes multiple recall paths and uses query heuristics
to decide scope.

Relevant hotspot:

- `src/built-in/chat/data/chatDataService.ts`

Verified NemoClaw evidence:

- `docs/workspace/workspace-files.md` states that the workspace files are read
  by the agent at the start of every session.
- the same document makes the memory layers explicit: `MEMORY.md` plus daily
  `memory/YYYY-MM-DD.md` files.
- the workspace references also describe persistence behavior and manual backup
  and restore, reinforcing that continuity is file-backed and inspectable.

Parallx implementation implication:

- Parallx should replace fuzzy memory-layer arbitration with a visible session
  startup contract and explicit layer precedence. The right borrowing from
  NemoClaw is the explicit file-backed session start, not hidden recall.

Verified OpenClaw evidence:

- `docs/concepts/agent.md` documents startup injection of workspace bootstrap
  files on the first turn of a new session.
- `docs/concepts/memory.md` defines `memory/YYYY-MM-DD.md` and `MEMORY.md` as
  the file-backed layers, with `MEMORY.md` limited to the main private session.
- `docs/reference/session-management-compaction.md` separates transcripts from
  memory files.
- `docs/automation/hooks.md` documents `session-memory` as a hook-based write
  path rather than a hidden prompt side effect.

Parallx implementation implication from OpenClaw:

- Parallx should move to an explicit startup read and explicit memory-layer
  rules that match the user-visible files, and keep transcript recall separate
  from memory recall.

Observed missing property:

- the runtime does not yet have one simple, inspectable contract for when daily
  memory wins, when durable memory wins, when transcripts are eligible, and
  what a fresh session loads by default.

This is the main issue behind the memory-layer failure modes.

### 4.5 Hard conversational isolation

A conversational route should mean more than "the router called it
conversational."

It should mean the whole runtime respects a hard isolation boundary:

1. no retrieval;
2. no memory recall;
3. no page context pull;
4. no citation behavior;
5. no latent grounding fallback.

The remaining T30 shortfall shows that conversational classification can still
coexist with a retrieval attempt in later runtime handling.

Relevant hotspots:

- `src/built-in/chat/utilities/chatTurnRouter.ts`
- `src/built-in/chat/utilities/chatTurnContextPreparation.ts`
- `src/built-in/chat/utilities/chatContextSourceLoader.ts`

Verified NemoClaw evidence:

- `docs/about/how-it-works.md` and `README.md` repeatedly describe strict
  policy boundaries around network, filesystem, and inference.
- `docs/reference/commands.md` and `nemoclaw/src/commands/slash.ts` show that
  runtime status and operator actions are exposed through explicit commands and
  monitoring surfaces rather than hidden side effects.

Parallx implementation implication:

- Conversational isolation should be treated like a policy boundary: once the
  route is conversational, downstream context/retrieval lanes should be closed
  by invariant, not merely by convention.

Verified OpenClaw evidence:

- `docs/concepts/context.md` defines context composition explicitly as system
  prompt + history + tool calls/results + injected files.
- `docs/concepts/agent.md` and `docs/reference/session-management-compaction.md`
  show that OpenClaw treats runtime boundaries and session lifecycle as
  first-class owned layers.

Parallx implementation implication from OpenClaw:

- If a turn is conversational, Parallx should exclude retrieval and workspace
  context assembly from the run inputs entirely, the same way OpenClaw treats
  context assembly as a deliberate owned step rather than an accidental leak.

Observed missing property:

- conversational handling is correct at the route level but not yet enforced as
  an end-to-end runtime invariant.

### 4.6 Truthful bootstrap and RAG readiness semantics

The workspace-bootstrap diagnostic is also a real signal.

The problem is not just latency. The bigger issue is that the runtime still
equates "initial index complete" with a meaningful readiness state, even though
the indexing pipeline remains bounded, selective, and partially best-effort.

Relevant hotspots:

- `src/services/indexingPipeline.ts`
- `src/built-in/chat/data/chatDataService.ts`

Verified NemoClaw evidence:

- `nemoclaw/src/commands/slash.ts` exposes run ID, blueprint version, sandbox
  name, and update time.
- `bin/nemoclaw.js` and `docs/reference/commands.md` expose connect, status,
  logs, and policy-list surfaces for inspecting runtime state.
- `docs/about/how-it-works.md` documents reproducible setup and versioned
  blueprint application rather than reducing runtime state to a single boolean.

Parallx implementation implication:

- Parallx should replace the coarse `isInitialIndexComplete` user story with
  richer readiness state: inventory known, index partial/full, skipped files
  known, and retrieval-safe versus exhaustive-safe readiness.

Verified OpenClaw evidence:

- `docs/help/faq.md`, `docs/start/openclaw.md`, and
  `docs/reference/session-management-compaction.md` expose concrete state
  locations, status surfaces, and operational diagnostics.
- OpenClaw's design does not collapse all runtime readiness into one opaque
  boolean; it exposes separate session, workspace, model, and runtime state.

Parallx implementation implication from OpenClaw:

- Parallx should expose indexing and retrieval readiness as an inspectable state
  model rather than a single yes/no flag. That aligns better with OpenClaw's
  explicit operational surfaces and avoids overstating completeness.

Observed missing property:

- the runtime cannot yet honestly say whether the workspace inventory is fully
  known, partially known, or only shallowly indexed.

This weakens both user trust and runtime policy decisions that depend on RAG
availability.

---

## 5. Test-Failure Mapping

The key below-100 results map to runtime gaps like this:

| Eval surface | Real missing capability |
|--------------|-------------------------|
| Stress broad summaries (`S-T01`, `S-T02`, `S-T03`, `S-T08`, behaviorally `S-T09`) | deterministic exhaustive target-set and completeness contract |
| Stress broad extraction (`S-T06`) | exhaustive target-set contract plus source-to-fact attribution discipline |
| Stress comparisons (`S-T04`, `S-T05`) | canonical entity binding plus compare/diff orchestration |
| Memory-layer failures | explicit memory-layer startup and recall contract |
| `T30` conversational leakage | hard conversational isolation |
| Workspace bootstrap diagnostic | truthful readiness semantics |

This is the right level of diagnosis because it explains the failures without
turning each failing test into a bespoke hardcoded behavior.

---

## 6. What Upstream Evidence Means Here

The upstream evidence clarifies two things at once.

### 6.1 What NemoClaw explicitly gives us

NemoClaw gives us a strong reference for:

1. thin plugin, explicit runtime separation;
2. versioned orchestration outside the chat loop;
3. file-backed session-start state;
4. explicit approval and policy boundaries;
5. inspectable runtime state such as run IDs, sandbox status, and policy state.

### 6.2 What OpenClaw explicitly gives us

OpenClaw gives us a strong reference for:

1. gateway-owned session and transcript control;
2. workspace-root bootstrap file injection on new sessions;
3. explicit file-backed memory layers and transcript separation;
4. hook-based memory flush and explicit memory tools;
5. tool-rich model-led runtime with clear workspace and context boundaries.

### 6.3 What neither upstream stack directly gives us for Parallx

Neither NemoClaw nor OpenClaw appears to publish a ready-made answer for:

1. exhaustive file enumeration for grounded workspace QA;
2. duplicate-target binding in normal user phrasing;
3. compare/diff orchestration for document contradictions;
4. RAG completeness semantics for a desktop second-brain workspace.

So claw-like discipline does **not** mean copying either upstream literally.

It means the runtime should own the control-plane questions explicitly:

1. What files are in scope?
2. What evidence was actually gathered?
3. Is this answer exhaustive or partial?
4. Which memory layer is being invoked, and why?
5. What is loaded at fresh session start?
6. Is the system actually ready to rely on RAG?

The model should then own synthesis over a well-formed runtime bundle.

That is the distinction between borrowing upstream discipline and inventing
another opaque workflow layer.

It is also the distinction between:

- reintroducing hidden workflows;
- and building the explicit runtime contracts that make workflow labels
  unnecessary.

---

## 7. Architectural Direction Confirmed By This Diagnosis

This diagnosis supports the current Milestone 40 direction rather than
reversing it.

The explicit NemoClaw evidence makes the implementation direction sharper:

1. adopt NemoClaw's explicit runtime ownership pattern;
2. adopt NemoClaw's file-backed session-start clarity;
3. adopt NemoClaw's inspectable state and policy-boundary mindset;
4. do **not** assume NemoClaw already solved Parallx's evidence-planning and
  workspace-grounding gaps for us.

The explicit OpenClaw evidence sharpens it further:

1. adopt OpenClaw's gateway-owned session model;
2. adopt OpenClaw's workspace-root bootstrap-file startup model;
3. adopt OpenClaw's file-backed memory and transcript separation;
4. keep the model/tool loop, but add stronger runtime contracts where Parallx
  needs completeness, target binding, and compare/diff precision.

### 7.1 What should not happen

We should not:

1. restore workflow labels as semantic authority;
2. patch each failing phrasing with another lexical special case;
3. treat every AI-eval miss as proof that the old workflow machine was right.

### 7.2 What should happen

We should strengthen the runtime contracts in this order:

1. exhaustive target-set and completeness contract;
2. canonical entity-binding contract;
3. compare/diff orchestration contract;
4. explicit session-start and memory-layer contract;
5. hard conversational isolation;
6. truthful readiness semantics.

This sequence preserves the redesign goal:

- runtime-owned;
- evidence-led;
- synthesis-first;

while addressing the real causes of the remaining quality gaps.

---

## 8. Status Note

This document is a diagnosis artifact, not a claim that the above runtime
contracts have already been implemented.

It exists so the remaining work can be discussed and executed at the right
architectural level, with the context preserved in a user-readable repo file
rather than only in transient chat history or internal memory notes.