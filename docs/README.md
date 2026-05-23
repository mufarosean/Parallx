# Parallx Documentation Index

Canonical product docs live at this folder's root and one level deep.
Anything under `docs/archive/` is historical — read for context, not as
source-of-truth.

> **Active milestone:** M84 / SR-4: System Fitness Harness (`active`, accepted by user 2026-05-23; research gate open). Most recent closed: [M83 / SR-3: Unified Workbench Language and Extension Interaction Model](./Parallx_Milestone_83.md) (`implemented-verified`, 2026-05-23 — ratification of pre-existing model + atlas). Prior: [M82 / SR-2: Extension Contribution Model](./Parallx_Milestone_82.md) (`implemented-verified`, 2026-05-23 — Slice B `3cd80b07`, Slice A `e9320875`). Prior: [M81 / SR-1: Workbench Unification, Slice 1](./Parallx_Milestone_81.md) (`implemented-verified`, 2026-05-23).
> Branch: `systems-redesign-planning`. Frozen checkpoint: `checkpoint-pre-systems-redesign-2026-05-23` = `9b9a243`. Per M83 §9.6, every new milestone must cite `WORKBENCH_INTERACTION_MODEL.md` in its frontmatter and name the workbench primitives it touches.

## Product
- [PARALLX_MANIFEST.md](./PARALLX_MANIFEST.md) — the contract for the redesign

## Most recently closed milestones
- [Parallx_Milestone_83.md](./Parallx_Milestone_83.md) — M83 / SR-3 Unified Workbench Language and Extension Interaction Model (`implemented-verified` 2026-05-23)
- [Parallx_Milestone_82.md](./Parallx_Milestone_82.md) — M82 / SR-2 Extension Contribution Model (`implemented-verified` 2026-05-23)
- [Parallx_Milestone_81.md](./Parallx_Milestone_81.md) — M81 / SR-1 Workbench Unification (`implemented-verified` 2026-05-23)
- [Parallx_Milestone_80.md](./Parallx_Milestone_80.md) — M80 Budget Sync as a Skill+Tools Agent (`implemented-verified` 2026-05-22)

## Architecture (descriptive + proposal)
- [architecture/SYSTEM_ATLAS.md](./architecture/SYSTEM_ATLAS.md) — canonical descriptive map of the current workbench
- [architecture/WORKBENCH_INTERACTION_MODEL.md](./architecture/WORKBENCH_INTERACTION_MODEL.md) — unified-primitive workbench language (**Adopted M83 / SR-3 2026-05-23**)

## Redesign research
- [research/SYSTEMS_REDESIGN_KICKOFF.md](./research/SYSTEMS_REDESIGN_KICKOFF.md) — kickoff package + §19 decisions
- [research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md](./research/WORKBENCH_CURRENT_CODE_RESEARCH_BRIEF.md)
- [research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md](./research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md)
- [research/WORKBENCH_INTERACTION_MODEL_REVIEW.md](./research/WORKBENCH_INTERACTION_MODEL_REVIEW.md) — independent fitness review (APPROVE)
- [research/MILESTONE_DOC_TRIAGE.md](./research/MILESTONE_DOC_TRIAGE.md) — M64..M80 status triage
- [research/baselines/workbench-baseline.md](./research/baselines/workbench-baseline.md) — measurement scorecard
- [research/git/BRANCH_GOVERNANCE.md](./research/git/BRANCH_GOVERNANCE.md) — branch + commit + rollback rules
- [research/agents/](./research/agents/) — agent cards for the redesign workflow

## End users
- [USER_GUIDE.md](./USER_GUIDE.md)
- [MCP_SERVERS_USER_GUIDE.md](./MCP_SERVERS_USER_GUIDE.md)
- [ai/AI_USER_GUIDE.md](./ai/AI_USER_GUIDE.md)

## Authors (extension + MCP server developers)
- [PARALLX_EXTENSION_AUTHORING_FOR_AI.md](./PARALLX_EXTENSION_AUTHORING_FOR_AI.md)
- [PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md](./PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md)

## Reference
- [PARALLX_WORKSPACE_SCHEMA.md](./PARALLX_WORKSPACE_SCHEMA.md)
- [SETTINGS_REGISTRY.md](./SETTINGS_REGISTRY.md)
- [WORKFLOWS.md](./WORKFLOWS.md)
- [ai/AUTONOMY_RUNTIME_CONTRACTS.md](./ai/AUTONOMY_RUNTIME_CONTRACTS.md)
- [ai/AUTONOMY_TASK_RAIL.md](./ai/AUTONOMY_TASK_RAIL.md)
- [ai/CANVAS_BLOCK_API.md](./ai/CANVAS_BLOCK_API.md)
- [ai/GMAIL_MCP_INTEGRATION.md](./ai/GMAIL_MCP_INTEGRATION.md)
- [canvas/BLOCK_REGISTRY.md](./canvas/BLOCK_REGISTRY.md)
- [canvas/ICON_REGISTRY.md](./canvas/ICON_REGISTRY.md)
- [canvas/CANVAS_STRUCTURAL_MODEL.md](./canvas/CANVAS_STRUCTURAL_MODEL.md)
- [canvas/BLOCK_INTERACTION_RULES.md](./canvas/BLOCK_INTERACTION_RULES.md)

## Forward-looking / pre-M81 research (retained for reference)
- [Future_Improvements.md](./Future_Improvements.md)
- [research/INTERACTION_LAYER_ARCHITECTURE.md](./research/INTERACTION_LAYER_ARCHITECTURE.md)
- [research/Living_UI_Ideas.md](./research/Living_UI_Ideas.md)
- [research/Living_UI_Research.md](./research/Living_UI_Research.md)
- [research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md](./research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md) — pre-manifest sketch; superseded by the manifest + M81
- [research/SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md](./research/SYSTEMS_REDESIGN_AGENTS_AND_SKILLS.md) — pre-manifest sketch; superseded by `research/agents/`
- [research/SYSTEMS_THINKING_FOR_PARALLX.md](./research/SYSTEMS_THINKING_FOR_PARALLX.md)

## Milestone status (M64..M80)
Every milestone doc M64..M80 now carries a canonical `> **Triage Status (2026-05-23):**` line at the top.
Authoritative table: [research/MILESTONE_DOC_TRIAGE.md](./research/MILESTONE_DOC_TRIAGE.md). Canonical label set
is defined in [PARALLX_MANIFEST.md](./PARALLX_MANIFEST.md) §17.

Summary (17 milestones):
- `implemented-verified` (12): M64, M65, M70, M73, M74, M75, M77, M78, M80, M81, M82, M83
- `implemented-unverified` (1): M68
- `partial` (2): M67, M79
- `planning` (5): M66, M69, M71, M72, M76
- `active` (1): **M84**
- `superseded` / `archived` (0): none in this pass

## Archive
- [archive/milestones/](./archive/milestones/) - closed milestones M01-M63
- [archive/audits/](./archive/audits/) - M41 OpenClaw parity audits/gap maps/trackers
- [archive/ai-plans/](./archive/ai-plans/) - completed AI feature plans
- [archive/ai-openclaw/](./archive/ai-openclaw/) - OpenClaw integration history
- [archive/canvas-plans/](./archive/canvas-plans/), [archive/canvas-research/](./archive/canvas-research/), [archive/canvas-archive/](./archive/canvas-archive/) - canvas history
- [archive/research/](./archive/research/) - capability assessments
- [archive/root-audits/](./archive/root-audits/) - historical settings/perf/theme audits
- [archive/clawrallx-planning/](./archive/clawrallx-planning/), [archive/deep-audit/](./archive/deep-audit/) - older planning artifacts
- [archive/perchance/](./archive/perchance/) - old export

---

## Going-forward rules

1. **The manifest is the contract.** [PARALLX_MANIFEST.md](./PARALLX_MANIFEST.md)
   defines the redesign workflow, agent roles, branch boundary, and verification
   contract. No code changes without an active milestone that traces to the
   manifest.
2. **Milestone files**: only in-flight milestones live at `docs/` root.
   On close, `git mv` into `archive/milestones/` in the same commit that
   marks it closed. Every milestone must carry a canonical `Triage Status`
   line per manifest §17.
3. **Plans, fix plans, gap maps, audits, trackers, ad-hoc research**: these
   are point-in-time artifacts. Land them in `docs/archive/<domain>/` from
   day one (or at the latest, when the work closes). They never live at the
   canonical root.
4. **Canonical docs at root and at one level (`ai/`, `architecture/`, `canvas/`,
   `research/`)** must satisfy: (a) all links resolve, (b) all factual claims
   are still true, (c) reviewed at the close of every third milestone.
5. **README.md** is the single index. Every canonical doc must be linked
   from it. If it's not in the README, it's not canonical.
6. **Branch discipline.** `master` and `checkpoint-pre-systems-redesign-2026-05-23`
   are immutable. All redesign work lives on `systems-redesign-planning` until
   merge-readiness criteria in [research/git/BRANCH_GOVERNANCE.md](./research/git/BRANCH_GOVERNANCE.md)
   pass. No `--no-verify`, no force-pushes, no checkpoint deletions.
