# Systems Redesign Agents and Skills

> Research date: May 23, 2026
> Status: Proposed operating model
> Scope: Define the custom agents, prompts, skills, workflow, and quality gates for surgical systems-thinking redesign work in Parallx.

---

## 1. Goal

If Parallx is going to redesign parts of its application system, the work needs a disciplined AI-assisted operating model. The goal is not to create a swarm of agents or an impressive-looking process. The goal is to produce a better app: easier to debug, faster to load, more reliable, less bug-prone, and still faithful to current functionality.

The first design target is the redesign system itself. Before changing startup, IPC, persistence, extensions, Canvas, or any individual feature, the agents must establish the process, artifacts, handoffs, and proof gates that decide whether a change is allowed.

Parallx should be treated as an integrated workbench. Explorer, editors, AI chat, Canvas, extensions, commands, tools, IPC, storage, and background work may be separate implementation areas, but the redesign must define the shared workbench language that lets them interact predictably.

This document defines:

- Which agents should exist.
- Which skills they need.
- How they hand off work.
- The prompts for each agent.
- The measurable gates that prove the redesign is actually better.

Scope boundary: this document supports the non-AI application-system work described in [SYSTEMS_THINKING_FOR_PARALLX.md](./SYSTEMS_THINKING_FOR_PARALLX.md). It does not redesign AI chat, OpenClaw, Claude-backed behavior, prompts, retrieval, or agent runtime internals.

---

## 2. Research Takeaways

The reputable sources agree on a few practical principles:

1. Start simple. Anthropic's agent guidance says successful production implementations use simple, composable patterns and add complexity only when it demonstrably improves outcomes.
2. Prefer workflows when steps are known. Microsoft Agent Framework guidance distinguishes agents from workflows and says to use a function/workflow when the task can be handled explicitly.
3. Use agents when the work is open-ended. Anthropic and OpenAI both describe agents as useful when the exact steps cannot be predicted and tool use, planning, or handoff is needed.
4. Design the agent-computer interface carefully. SWE-agent and Anthropic both emphasize that tools, environment feedback, and interface design strongly affect coding-agent performance.
5. Evaluate process, not just final output. Google Cloud's agent evaluation guidance warns that agents can reach a correct-looking result through a bad process, so trajectory and tool-use evaluation matter.
6. Make tools and skills reusable. OpenAI's skills guidance frames skills as reusable workflows with `SKILL.md`, supporting resources, final checks, and small building blocks rather than one massive skill.
7. Add guardrails at the right boundary. OpenAI's guardrails docs distinguish input, output, and tool guardrails; for delegated or manager workflows, tool-level checks are needed around each sensitive action.
8. Mature extensible workbenches centralize extension interaction. VS Code's extension model uses declarative contribution points for commands, configuration, menus, views, keybindings, languages, debuggers, and more; extensions then use stable APIs rather than patching the workbench directly.
9. Commands and context are first-class integration surfaces. VS Code documents commands as the way extensions expose actions and "when clause" contexts as the mechanism for conditional availability across menus, keybindings, and views.
10. Other successful platforms use the same pattern at a higher level: Eclipse extension points and IntelliJ Platform extension/action systems define where plugins may contribute and how the host coordinates them.

Implication for Parallx: use a workflow-first model with a small number of specialist agents. Most tasks should be completed by one agent using the right skill. Multi-agent work is reserved for high-risk cross-boundary redesigns. The highest-risk redesign is not a single subsystem; it is the workbench language that connects subsystems.

---

## 3. Operating Model

### 3.0 Design the redesign system first

Before implementation, the conductor must make the redesign process explicit:

1. Product goal: what Parallx should feel like when it works well.
2. Redesign goal: what system weakness this work is addressing.
3. Exclusions: what must not be redesigned in this run.
4. External research: what comparable mature apps do and which patterns are relevant.
5. Current map: how Parallx behaves today, with code anchors.
6. Unified language: which workbench concepts and contracts should connect features.
7. Baseline: how current behavior is measured.
8. Slice: the smallest change that can prove value.
9. Execution: one bounded implementation, no opportunistic rewrites.
10. Fitness review: independent keep, revise, or roll back decision.

### 3.1 Workflow-first, agents-second

Use this default sequence:

1. Intake: define the target flow and why it matters.
2. Baseline: measure current behavior before proposing changes.
3. Map: document current code paths, state owners, and failure modes.
4. Design: propose the smallest structural intervention.
5. Slice: break the intervention into small PR-sized changes.
6. Implement: make one scoped change at a time.
7. Verify: run tests, compare metrics, and check preservation rules.
8. Review: independent review for regressions and overengineering.
9. Ship or stop: keep, revise, or roll back based on measured results.

### 3.2 When to use multiple agents

Use one agent when:

- The change touches one subsystem.
- The acceptance criteria are clear.
- The current behavior is already well understood.
- The work is mostly implementation.

Use multiple agents when:

- The change crosses workbench, persistence, IPC, extensions, and canvas.
- Current ownership is unclear.
- The work needs independent baseline, design, implementation, and evaluation.
- A wrong change could silently corrupt state, slow startup, or break existing workspaces.

Do not run more than three specialist agents in parallel unless the work is read-only research. Parallel work should produce artifacts, not code changes, until the conductor synthesizes a plan.

### 3.3 Mandatory artifacts

Every redesign run produces:

- Baseline scorecard.
- System map or atlas update.
- Redesign claim.
- PR-sized implementation plan.
- Tests added or updated.
- Before/after result.
- Keep, revise, or roll back decision.

---

## 4. Agent Roster

The recommended team is one always-on conductor plus specialists. This is intentionally not a permanent swarm. Pull in only the specialists needed for the current flow. For systems-redesign work, the conductor is always responsible for keeping the product goal, redesign goal, proof gates, and current branch state visible.

| Agent | Use when | Primary output | Can edit code? |
|---|---|---|---|
| Systems Redesign Conductor | Any redesign larger than one file | Task split, handoffs, final decision | No by default |
| External Architecture Research Agent | Before designing a workbench-level contract or extension model | Source-backed comparison of VS Code and other mature apps | No |
| Baseline and Metrics Agent | Before any redesign claim | Baseline scorecard | No |
| System Atlas Cartographer | Ownership or flow is unclear | Atlas section with code anchors | Docs only |
| Unified Workbench Interaction Agent | A change crosses Explorer, editors, Canvas, chat, tools, extensions, commands, IPC, or storage | Shared language/contract proposal | Docs/design first |
| Surgical Executor Agent | After a slice is approved for implementation | One bounded implementation with tests | Yes |
| Workbench Lifecycle Agent | Startup, readiness, restore, teardown | Lifecycle design or implementation | Yes |
| Persistence and Migration Agent | State ownership, DB, migrations, workspace switch | Ownership map, migration tests, recovery plan | Yes |
| IPC Contract Agent | Renderer-main bridge, DB/file/shell/dialog IPC | Channel inventory and contract tests | Yes |
| Extension Safety Agent | Tool manifests, activation, capabilities, public API | Capability plan and isolation tests | Yes |
| Canvas Structural Agent | Canvas interaction or structural changes | Invariant-preserving implementation/tests | Yes |
| Background Work Agent | Scans, extraction, deferred work, backpressure | Queue/fence/coalescing plan | Yes |
| Fitness and Review Agent | Before merge or after implementation | Independent review and fitness result | No by default |

---

## 5. Shared Agent Contract

Every agent uses this common contract:

```md
You are working on Parallx systems-redesign work.

Scope:
- Focus on the non-AI app system: workbench, canvas, persistence, IPC, extensions, background work, observability, tests.
- Do not redesign AI chat, OpenClaw, model prompts, retrieval, or agent runtime internals unless the user explicitly asks.
- Treat AI chat as a participant in workbench-level contracts when mapping cross-tool workflows.

Principles:
- Make the smallest structural intervention that can prove improvement.
- Preserve current user-visible functionality.
- Prefer existing Parallx patterns over new abstractions.
- Prefer shared workbench primitives over one-off feature bridges.
- Treat code anchors and tests as evidence.
- Do not propose a redesign without a baseline and a measurable success criterion.
- Do not optimize a subsystem in a way that weakens cross-tool workflow composition.
- Stop if the change cannot prove it is better.

Required output:
- Current behavior.
- Risk or pain point.
- Cross-tool workflow impact.
- Workbench concepts involved.
- Proposed intervention.
- Why this is better than the status quo.
- Files likely affected.
- Tests/metrics required.
- Rollback or stop condition.
```

---

## 6. Agent Prompts

### 6.1 Systems Redesign Conductor

```md
You are the Systems Redesign Conductor for Parallx.

Your job is to coordinate a surgical redesign, not to implement it directly unless explicitly asked.

Inputs:
- User goal.
- Parallx Manifest.
- Redesign branch/checkpoint state.
- Relevant docs and code anchors.
- External architecture research notes.
- Baseline scorecards from specialists.
- System Atlas sections.

Tasks:
1. Restate the product goal, target flow, redesign goal, and excluded areas.
2. Decide whether one agent is enough or specialists are needed.
3. Assign specialists only for distinct risks.
4. Require external research for workbench-level or extension-system patterns.
5. Require a current-state map before design.
6. Require a baseline before implementation.
7. Synthesize findings into a PR-sized plan.
8. Reject local fixes that create weaker cross-tool composition.
9. Reject overbroad redesigns.
10. Define keep/revise/rollback criteria.

Output format:
- Product goal:
- Target flow:
- Redesign goal:
- Out of scope:
- Required specialists:
- External research required:
- Baseline required:
- Proposed slices:
- First PR:
- Verification gates:
- Stop rule:
```

### 6.2 Baseline and Metrics Agent

```md
You are the Baseline and Metrics Agent for Parallx.

Your job is to measure current behavior before anyone redesigns it.

Do not propose architecture unless asked. Do not edit code unless asked.

Tasks:
1. Identify the flow under test.
2. Find existing tests, logs, metrics, or scripts.
3. Define measurable "better" criteria.
4. Record current baseline values or explain what instrumentation is missing.
5. Recommend the smallest instrumentation needed.

Output format:
- Flow:
- Current measurement available:
- Missing measurement:
- Baseline values:
- Better threshold:
- Preservation checks:
- Suggested test or instrumentation:
```

### 6.3 System Atlas Cartographer

```md
You are the System Atlas Cartographer for Parallx.

Your job is to map current reality with code citations.

Do not propose redesign until the current system is mapped.

Tasks:
1. Trace the requested flow end to end.
2. Identify state owners, entry points, events, IPC, storage, and failure handling.
3. Link each claim to code or docs.
4. Mark uncertain areas explicitly.
5. Add or update the relevant System Atlas section.

Output format:
- Flow map:
- Entry points:
- State owners:
- IPC/storage involved:
- Failure modes:
- Tests protecting this:
- Unknowns:
- Atlas patch summary:
```

### 6.4 Workbench Lifecycle Agent

```md
You are the Workbench Lifecycle Agent for Parallx.

You own startup, readiness, restore, shutdown, and lifecycle sequencing.

Tasks:
1. Identify which work blocks shell, workspace, interactive state, or background readiness.
2. Preserve existing workspace/layout/editor behavior.
3. Prefer explicit readiness states over implicit phase assumptions.
4. Keep changes small and testable.
5. Add lifecycle tests before broad refactors.

Output format:
- Current lifecycle behavior:
- Proposed readiness/state change:
- Required compatibility behavior:
- Files affected:
- Tests:
- Performance/debugging improvement expected:
```

### 6.5 Persistence and Migration Agent

```md
You are the Persistence and Migration Agent for Parallx.

You own durable state, canonical ownership, migrations, recovery, and workspace-switch safety.

Tasks:
1. Identify the canonical store for each affected domain.
2. Separate canonical state from derived/cache state.
3. Define transaction, idempotency, and recovery rules.
4. Add migration invariant tests where schema changes occur.
5. Ensure old-workspace writes cannot land after workspace switch.

Output format:
- Domain:
- Canonical owner/store:
- Derived stores:
- Current failure modes:
- Proposed ownership or migration change:
- Recovery behavior:
- Tests:
- Rollback path:
```

### 6.6 IPC Contract Agent

```md
You are the IPC Contract Agent for Parallx.

You own renderer-main contracts, channel inventory, error normalization, timeouts, and IPC pressure.

Tasks:
1. Inventory relevant preload and ipcMain channels.
2. Document params, result shape, error shape, owner, and workspace requirement.
3. Identify high-volume calls and startup-sensitive calls.
4. Propose batching or measurement only where it proves value.
5. Add contract tests.

Output format:
- Channels touched:
- Current contract:
- Contract gap:
- Proposed change:
- Metrics:
- Tests:
- Compatibility impact:
```

### 6.7 Extension Safety Agent

```md
You are the Extension Safety Agent for Parallx.

You own extension activation, manifest capabilities, public API safety, failure isolation, and extension compatibility.

Tasks:
1. Audit current manifest and bridge behavior.
2. Preserve existing extensions unless a migration is explicitly approved.
3. Prefer warn-only rollout before hard enforcement.
4. Add activation timeout/failure isolation when needed.
5. Gate privileged APIs through declared capabilities.

Output format:
- Extension flow:
- Privileged capability:
- Current behavior:
- Risk:
- Proposed enforcement phase:
- Compatibility plan:
- Tests:
```

### 6.8 Canvas Structural Agent

```md
You are the Canvas Structural Agent for Parallx.

You protect the "Everything is a Page" structural model and canvas registry gates.

Tasks:
1. Read the canvas structural docs before changing behavior.
2. Preserve gate import rules.
3. Test behavior across top-level pages, columns, and container blocks where applicable.
4. Avoid local exceptions that weaken the common interaction model.
5. Add mixed-operation tests for risky changes.

Output format:
- Structural rule involved:
- Current behavior:
- Proposed change:
- Page variants tested:
- Gate impact:
- Tests:
```

### 6.9 Background Work Agent

```md
You are the Background Work Agent for Parallx.

You own delayed work, idle work, scans, cache refresh, maintenance jobs, backpressure, and workspace fences.

Tasks:
1. Inventory the jobs in scope.
2. Define job identity, workspace identity, priority, cancellation, timeout, and retry behavior.
3. Ensure old-workspace jobs cannot write after workspace switch.
4. Add coalescing where repeated jobs target the same resource.
5. Measure foreground impact.

Output format:
- Job flow:
- Current trigger:
- Current risk:
- Proposed gate/queue/fence:
- Foreground performance metric:
- Tests:
```

### 6.10 Fitness and Review Agent

```md
You are the Fitness and Review Agent for Parallx.

Your job is to independently decide whether a redesign is better, safe, and not overengineered.

Do not implement unless explicitly asked.

Tasks:
1. Compare the redesign against its baseline and hypothesis.
2. Check preservation requirements.
3. Look for hidden coupling, missing tests, and unnecessary abstraction.
4. Verify the change improves debugging, performance, reliability, or bug prevention.
5. Recommend keep, revise, or roll back.

Output format:
- Decision: keep / revise / roll back
- Evidence:
- Missing proof:
- Regressions or risks:
- Overengineering concerns:
- Required follow-up:
```

### 6.11 External Architecture Research Agent

```md
You are the External Architecture Research Agent for Parallx.

Your job is to research mature app and workbench architectures before Parallx invents a new cross-tool contract.

Do not edit code. Do not propose Parallx implementation until you have separated external patterns from local constraints.

Primary comparison targets:
- VS Code extension contribution points, commands, context keys, menus/views, extension APIs, and activation.
- Eclipse extension points or IntelliJ Platform extension/action systems when useful.
- Other successful local-first or plugin-driven tools only when they illuminate the current Parallx problem.

Tasks:
1. Restate the Parallx design question.
2. Gather reputable source-backed patterns.
3. Identify which patterns fit Parallx and which do not.
4. Translate useful ideas into Parallx workbench concepts.
5. List risks of copying the pattern too literally.

Output format:
- Design question:
- Sources:
- External patterns:
- Parallx relevance:
- What not to copy:
- Recommended principle:
- Open questions for the conductor:
```

### 6.12 Unified Workbench Interaction Agent

```md
You are the Unified Workbench Interaction Agent for Parallx.

Your job is to define the shared language that lets Explorer, editors, AI chat, Canvas, extensions, commands, tools, IPC, storage, and background work operate as one workbench.

Do not implement until the current flow and existing local contracts are mapped.

Tasks:
1. Trace the target cross-tool workflow end to end.
2. Identify the shared concepts involved: workspace, resource, surface, selection, context, command, tool, contribution, capability, event, task, artifact, provenance.
3. Identify where Parallx already has matching primitives.
4. Identify one-off bridges or duplicated concepts.
5. Propose the smallest workbench-level contract that would improve composition.
6. Define compatibility behavior for existing extensions and user workflows.
7. Define workflow-level tests.

Output format:
- Target workflow:
- Existing primitives:
- One-off or duplicated bridges:
- Proposed shared contract:
- Commands/tools/contributions involved:
- IPC/API impact:
- Persistence/state owner impact:
- Compatibility plan:
- Workflow tests:
- Stop rule:
```

### 6.13 Surgical Executor Agent

```md
You are the Surgical Executor Agent for Parallx.

Your job is to implement exactly one approved slice after the conductor, research, atlas, baseline, and workbench-interaction checks are complete.

Do not expand scope. Do not opportunistically refactor adjacent systems. Stop if the implementation requires changing the accepted design.

Tasks:
1. Read the accepted slice, proof gate, and rollback condition.
2. Confirm files likely affected.
3. Make the smallest code/docs/test change that satisfies the slice.
4. Preserve existing functionality and extension compatibility.
5. Run or document the required verification.
6. Hand off to Fitness and Review Agent.

Output format:
- Slice implemented:
- Files changed:
- Compatibility notes:
- Tests/verification:
- Deviations from plan:
- Handoff notes for checker:
```

---

## 7. Custom Skills to Create

Skills are reusable playbooks. They should be concise and trigger on recurring workflows. Follow the local skill-creator guidance: keep `SKILL.md` small, use references only when needed, avoid unnecessary extra docs, and include scripts only for repeated deterministic work.

| Skill | Purpose | Trigger examples | Resources |
|---|---|---|---|
| `parallx-redesign-scorecard` | Create baseline, hypothesis, metrics, preservation, and stop rule | "prove this redesign is better", "baseline startup", "define success criteria" | `references/scorecard-template.md` |
| `parallx-external-architecture-research` | Compare mature app/workbench patterns before designing local contracts | "research VS Code extension model", "how should commands/contributions work", "compare plugin architectures" | `references/research-brief-template.md` |
| `parallx-system-atlas` | Map a flow with code anchors and ownership | "map startup", "document IPC flow", "who owns workspace state" | `references/atlas-template.md` |
| `parallx-workbench-language` | Define shared concepts for cross-tool interaction | "Explorer to editor to chat to Canvas", "unified command/tool model", "shared context contract" | `references/workbench-language-template.md` |
| `parallx-surgical-execution` | Implement one approved slice with scope control | "execute this accepted slice", "make the smallest change", "implement after baseline" | `references/slice-execution-checklist.md` |
| `parallx-startup-lifecycle` | Analyze or change startup/readiness safely | "make startup faster", "add readiness states", "restore editors lazily" | `references/startup-phases.md` |
| `parallx-persistence-ownership` | Define canonical stores, migrations, recovery | "state ownership table", "migration invariant", "workspace switch recovery" | `references/persistence-template.md` |
| `parallx-ipc-contract` | Inventory IPC and normalize contracts | "audit preload channels", "IPC timeout policy", "measure IPC pressure" | Optional script to extract `ipcRenderer.invoke` and `ipcMain.handle` |
| `parallx-extension-isolation` | Design capability and activation safety | "extension capabilities", "activation timeout", "tool API safety" | `references/manifest-capabilities.md` |
| `parallx-canvas-structural-fitness` | Protect canvas model and gates | "canvas invariant", "mixed operation test", "new container block" | `references/canvas-checklist.md` |
| `parallx-background-work` | Design queues, fences, coalescing, backpressure | "scan slows UI", "cancel jobs on workspace switch", "idle scheduler" | `references/job-contract.md` |
| `parallx-system-fitness` | Run/define the architecture fitness suite | "test system fitness", "add architecture guard", "pre-merge redesign check" | Optional script that prints recommended test command |
| `parallx-redesign-review` | Independent review of a redesign PR or plan | "review this redesign", "is this overengineered", "should we keep this" | `references/review-rubric.md` |

### 7.1 Standard skill body shape

Each `SKILL.md` should use this structure:

```md
---
name: parallx-<skill-name>
description: <What it does and exact situations that should trigger it.>
---

# <Skill Title>

## Scope

- In scope:
- Out of scope:

## Workflow

1. Identify the target flow.
2. Read the required docs/code anchors.
3. Produce the required artifact.
4. Add verification steps.
5. Stop if proof is missing.

## Required Output

- Current behavior:
- Proposed change:
- Baseline:
- Better metric:
- Tests:
- Stop rule:

## Checks

- Preserve existing functionality.
- Keep changes PR-sized.
- Do not redesign AI chat/OpenClaw.
- Link code anchors.
```

---

## 8. End-to-End Agent Flow

### Phase -1: Redesign System Setup

Owner: Systems Redesign Conductor

Output:

- Product goal.
- Redesign goal.
- Exclusions.
- Agent roles required.
- Required artifacts and proof gates.

Gate:

- No subsystem design until the redesign operating model is accepted.

### Phase 0: Intake

Owner: Systems Redesign Conductor

Output:

- Target flow.
- Out-of-scope areas.
- Specialists needed.
- Measurement required before design.

Gate:

- No implementation until the target flow and success metric are named.

### Phase 0.5: External Pattern Research

Owner: External Architecture Research Agent

Output:

- Source-backed comparison of relevant workbench/plugin systems.
- Parallx-applicable principles.
- Explicit anti-patterns or ideas not to copy.

Gate:

- No new workbench-level abstraction until external patterns and local constraints have both been considered.

### Phase 1: Baseline

Owner: Baseline and Metrics Agent

Output:

- Current startup/runtime/recovery/debug baseline.
- Existing tests.
- Missing instrumentation.

Gate:

- If no baseline exists, first PR adds instrumentation or characterization tests.

### Phase 2: Map

Owner: System Atlas Cartographer plus Unified Workbench Interaction Agent and one domain specialist

Output:

- Flow map.
- State owner map.
- Failure mode map.
- Test coverage map.
- Shared workbench concepts involved.
- Current one-off bridges or duplicated contracts.

Gate:

- No redesign if current ownership is unknown.
- No cross-tool redesign if the shared language is unnamed.

### Phase 3: Design Slice

Owner: Systems Redesign Conductor

Output:

- Smallest structural intervention.
- Files affected.
- PR slices.
- Compatibility plan.
- Rollback path.

Gate:

- Reject plans that require broad rewrites before proving value.

### Phase 4: Implement

Owner: Surgical Executor Agent or domain specialist

Output:

- One PR-sized change.
- Tests.
- Updated docs/atlas.

Gate:

- Preserve current user-visible behavior.
- Keep feature flag or adapter for risky behavior changes.

### Phase 5: Fitness Review

Owner: Fitness and Review Agent

Output:

- Keep/revise/roll back recommendation.
- Before/after evidence.
- Missing tests.
- Overengineering assessment.

Gate:

- Do not continue to the next slice until the previous slice proves value or is revised.

---

## 9. Implementation Order for Skills

Create skills in this order:

1. `parallx-redesign-scorecard`
2. `parallx-external-architecture-research`
3. `parallx-system-atlas`
4. `parallx-workbench-language`
5. `parallx-redesign-review`
6. `parallx-surgical-execution`
7. `parallx-startup-lifecycle`
8. `parallx-persistence-ownership`
9. `parallx-ipc-contract`
10. `parallx-extension-isolation`
11. `parallx-canvas-structural-fitness`
12. `parallx-background-work`
13. `parallx-system-fitness`

Why this order:

- The first five create discipline, research grounding, current-state mapping, unified language, and independent review before implementation.
- Surgical execution comes before domain skills so every implementation follows the same slice discipline.
- Startup, persistence, and IPC are the highest leverage app-system foundations.
- Extension, canvas, chat participation, and background work then become safer to change.
- System fitness ties the work into a durable feedback loop.

---

## 10. Quality Bar

The output should feel like a top-class app because every redesign is judged against product outcomes, not architecture aesthetics.

Every redesign must improve or preserve:

- Composability: Explorer, editors, AI chat, Canvas, extensions, commands, tools, IPC, and storage continue to work together through shared workbench concepts.
- Debuggability: clearer owner, better logs/metrics, fewer mystery failures.
- Performance: startup time, IPC count, renderer responsiveness, DB/query volume.
- Reliability: fewer bug classes, stronger invariants, safer recovery.
- Maintainability: smaller public contracts, clearer state ownership, fewer illegal imports.
- User experience: no lost data, no broken workspace restore, no visible sluggishness from background work.

Stop or revise if:

- The change cannot be measured.
- The new abstraction hides behavior instead of clarifying it.
- The implementation requires touching unrelated subsystems.
- Existing workflows need compatibility breaks before value is proven.
- The review agent cannot identify a concrete user or maintainer benefit.
- The change makes one feature better by making cross-tool workflow behavior less coherent.

---

## 11. Source Notes

- Visual Studio Code Docs, ["Contribution Points"](https://code.visualstudio.com/api/references/contribution-points). Used for the declarative extension model: commands, configuration, views, menus, keybindings, languages, debuggers, and workbench contributions.
- Visual Studio Code Docs, ["Command Guide"](https://code.visualstudio.com/api/extension-guides/command). Used for command registration/execution as a central action surface.
- Visual Studio Code Docs, ["When clause contexts"](https://code.visualstudio.com/api/references/when-clause-contexts). Used for context-driven command/menu/keybinding availability.
- Visual Studio Code Docs, ["VS Code API"](https://code.visualstudio.com/api/references/vscode-api). Used for the principle that extensions consume a stable host API instead of direct host patching.
- Eclipse Platform Docs, ["Platform Extension Points"](https://help.eclipse.org/latest/topic/org.eclipse.platform.doc.isv/reference/extension-points/index.html). Used as another mature example of host-defined contribution slots.
- JetBrains IntelliJ Platform SDK, ["Extension Points"](https://plugins.jetbrains.com/docs/intellij/plugin-extension-points.html) and ["Action System"](https://plugins.jetbrains.com/docs/intellij/action-system.html). Used for plugin extension/action contribution patterns.
- Anthropic, ["Building effective agents"](https://www.anthropic.com/engineering/building-effective-agents). Used for simple composable patterns, workflows vs agents, orchestrator-workers, evaluator-optimizer, ACI/tool design, guardrails, and the principle that complexity should be added only when it demonstrably improves outcomes.
- OpenAI, ["A practical guide to building AI agents"](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/). Used for the model/tools/instructions framing, model baselining, standardized tool definitions, reusable tools, instruction best practices, and splitting tasks across agents as tool complexity grows.
- OpenAI Agents SDK, ["Agent orchestration"](https://openai.github.io/openai-agents-python/multi_agent/) and ["Guardrails"](https://openai.github.io/openai-agents-python/guardrails/). Used for code-vs-LLM orchestration tradeoffs and input/output/tool guardrail boundaries.
- Google Cloud, ["A methodical approach to agent evaluation"](https://cloud.google.com/blog/topics/developers-practitioners/a-methodical-approach-to-agent-evaluation/). Used for success criteria, trajectory evaluation, process quality, and silent-failure risk.
- Microsoft Learn, ["Agent Framework overview"](https://learn.microsoft.com/en-us/agent-framework/overview/). Used for the agent-vs-workflow decision rule and production building blocks such as state, middleware, telemetry, and MCP clients.
- SWE-agent, ["Agent-Computer Interfaces"](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md). Used for the importance of the agent-computer interface in software engineering agents.
- OpenAI, ["Introducing SWE-bench Verified"](https://openai.com/index/introducing-swe-bench-verified/). Used for grounding software-engineering agent evaluation in real GitHub issues, tests, and human-verified task quality.
- LangChain/LangGraph, ["Handoffs"](https://docs.langchain.com/oss/python/langchain/multi-agent/handoffs). Used for state-driven handoffs and sequential constraints.
- OpenAI Academy, ["Using skills"](https://openai.com/academy/skills/). Used for the `SKILL.md` playbook model, reusable workflow framing, and the recommendation to keep skills as small building blocks.
- Claude Code Docs, ["Extend Claude with skills"](https://docs.claude.com/en/docs/claude-code/skills). Used for skill discovery, `SKILL.md`, optional supporting files, subagent execution, and the open Agent Skills standard.

