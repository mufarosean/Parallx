---
Status: implemented-verified — ratifies pre-existing artifacts (WORKBENCH_INTERACTION_MODEL.md, SYSTEM_ATLAS.md, WORKBENCH_INTERACTION_MODEL_REVIEW.md APPROVE verdict) as the canonical workbench language for all SR-4+ milestones; proof gate established 2026-05-23
Milestone: M83 / SR-3: Unified Workbench Language and Extension Interaction Model
Branch: systems-redesign-planning
Created: 2026-05-23
Parent baseline: master @ 9b9a243 (checkpoint-pre-systems-redesign-2026-05-23)
Predecessors: M81 / SR-1 (implemented-verified 2026-05-23), M82 / SR-2 (implemented-verified 2026-05-23)
Supersedes: None
Manifest: docs/PARALLX_MANIFEST.md (§5 product goal, §10 primitives, §11 preservation, §14 sequential handoffs, §17 milestone lifecycle, §22 verification)
Interaction model: docs/architecture/WORKBENCH_INTERACTION_MODEL.md (canonical — adopted by this milestone)
Atlas: docs/architecture/SYSTEM_ATLAS.md (canonical — adopted by this milestone)
Review: docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md (APPROVE verdict — §1)
External brief: docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md
Baseline: docs/research/baselines/workbench-baseline.md
Governance: docs/research/git/BRANCH_GOVERNANCE.md
Conductor: Systems Redesign Conductor
---

# Parallx Milestone 83 / SR-3: Unified Workbench Language and Extension Interaction Model

## 1. Goal

Define and **adopt** the central language that lets every workbench surface — Explorer, editors, AI chat, Canvas, extensions — behave like one workbench instead of a collection of loosely-coupled features.

The deliverables required by the systems-redesign roadmap ([SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md §M83](docs/research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md) L275–L292) are:

1. `docs/architecture/WORKBENCH_INTERACTION_MODEL.md`
2. External research notes for comparable mature plugin/workbench architectures.
3. Workbench-level concept model: workspace, resource, surface, selection, context, command, tool, contribution, capability, event, task, artifact, provenance.
4. Universal service map: command registry, contribution registry, context/selection service, resource/link resolver, tool registry, task/job service, extension API bridge, IPC contract layer, capability service, event bus, persistence ownership registry, status/notification, trace/diagnostics.
5. Compatibility plan for existing built-ins and extensions.
6. Exception policy for one-off bridges.

All six deliverables already exist as artifacts produced during M81 / SR-1 pre-work and refined during M82 / SR-2 execution. **M83 ratifies them as canonical** and elevates the model's proof-gate clause to a manifest-level constraint enforced on every subsequent milestone.

## 2. User Workflows Protected

Same primary workflow as M81 and M82 ([PARALLX_MANIFEST.md §5](docs/PARALLX_MANIFEST.md)):

> User opens a workspace → AI chat references workspace resources → user or AI creates Canvas pages/blocks → reopens workspace.

This milestone introduces **no behavioural changes**. Every existing user-visible flow continues to function exactly as before. The contract being added is *governance-only*: future cross-tool work must be described in the language of the adopted model.

## 3. Scope

### In scope (this milestone)

- **Adopt** `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` as the canonical workbench-interaction language. Frontmatter `Status` flips from `Draft (pending Fitness & Review)` to `Adopted (M83 / SR-3, 2026-05-23)`.
- **Adopt** `docs/architecture/SYSTEM_ATLAS.md` as the canonical system-ownership and bridge inventory. Already referenced as such by M81 / M82 — this milestone makes the adoption explicit.
- **Establish the proof gate** ([SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md §M83](docs/research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md) L290–L292): no new cross-tool interaction is approved for implementation without naming the workbench concepts it involves and the tests that protect them.
- **Cross-reference table** (§9 below) mapping each of the six required deliverables to its pre-existing artifact location.
- **Update `docs/README.md`** to show M83 as the most recently closed milestone.

### Out of scope (explicitly deferred)

- Any new code in `src/**`. M83 is a documentation / governance milestone. No service, no contribution processor, no bridge is added or modified.
- Rewriting the model. The model was reviewed and APPROVED in `WORKBENCH_INTERACTION_MODEL_REVIEW.md` §1. M83 does not relitigate that decision.
- Building the "system fitness harness" (`npm run test:system-fitness`). That is M84 / SR-4 scope.
- Replacing one-off bridges. The model defines a replacement plan (§4) and an exception policy (§3.3, summarised in §9.6 below); the actual replacement work is deferred to SR-4+ milestones.
- Modifying anti-list files (electron/*, openclaw/*, canvas hot-path files, chatAgentService.ts). None are touched.

## 4. Out Of Scope — Anti-List (cannot be touched without explicit user approval)

This milestone modifies **no `src/**` files**. Anti-list compliance is trivially preserved because nothing executable is touched.

Documentation-only changes are made to:

- `docs/Parallx_Milestone_83.md` (this file, new).
- `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` (frontmatter status flip only).
- `docs/README.md` (active-milestone pointer, recently-closed list, status counts).

## 5. Agents Assigned

| Slice | Agent | Card |
|---|---|---|
| Plan + adoption decision | Systems Redesign Conductor | [docs/research/agents/systems-redesign-conductor.md](docs/research/agents/systems-redesign-conductor.md) |
| Pre-existing research artifacts (model, atlas, external brief, baseline) | Research / Atlas / Baseline agents (work already complete; see commits `01ad9c1`, `08af9e0f` and earlier) | n/a |
| Fitness review of the model | Fitness and Review Agent (already returned APPROVE — [WORKBENCH_INTERACTION_MODEL_REVIEW.md §1](docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md)) | [docs/research/agents/fitness-and-review-agent.md](docs/research/agents/fitness-and-review-agent.md) |
| Status-flip and README commit | Git and Release Steward | [docs/research/agents/git-and-release-steward.md](docs/research/agents/git-and-release-steward.md) |

No Surgical Executor is required: there is no implementation slice.

## 6. Current-State Research Required (before adoption) — ✅ COMPLETE

| Required artifact | Location | Status |
|---|---|---|
| System ownership table | [SYSTEM_ATLAS.md §2](docs/architecture/SYSTEM_ATLAS.md) | ✅ exists |
| Primary workflow map | [SYSTEM_ATLAS.md §3](docs/architecture/SYSTEM_ATLAS.md) | ✅ exists |
| Cross-tool bridge inventory | [SYSTEM_ATLAS.md §4](docs/architecture/SYSTEM_ATLAS.md) | ✅ exists |
| Duplicate-contract inventory | [SYSTEM_ATLAS.md §5](docs/architecture/SYSTEM_ATLAS.md) | ✅ exists |
| IPC contract index | [SYSTEM_ATLAS.md §6](docs/architecture/SYSTEM_ATLAS.md) | ✅ exists |
| Test coverage map | [SYSTEM_ATLAS.md §7](docs/architecture/SYSTEM_ATLAS.md) | ✅ exists |

## 7. External Research Required (before adoption) — ✅ COMPLETE

The Workbench External Architecture Research Brief ([docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md](docs/research/WORKBENCH_EXTERNAL_ARCHITECTURE_RESEARCH_BRIEF.md)) compares VS Code contribution points, commands, context keys, Eclipse RCP, IntelliJ Platform, and other comparable workbenches. The review ([WORKBENCH_INTERACTION_MODEL_REVIEW.md §3](docs/research/WORKBENCH_INTERACTION_MODEL_REVIEW.md)) confirms the model adopts good external patterns (VS Code contributions, context keys, activation events) and avoids known anti-patterns (Eclipse XML manifests, OSGi complexity, `InvalidRegistryObjectException` control flow).

## 8. Baseline And Metrics Required (before adoption) — ✅ COMPLETE (no new measurement needed)

M83 is a documentation milestone and does not regress runtime behaviour. The existing baseline scorecard ([docs/research/baselines/workbench-baseline.md](docs/research/baselines/workbench-baseline.md)) and the extension-activation H15 baseline established in M82 are sufficient. No new measurement is required because no code paths change.

## 9. Workbench Concepts Involved — Deliverable Cross-Reference

This section is the **substantive content** of M83: it ties each roadmap-required deliverable to its existing location, so future milestones can cite the model unambiguously.

### 9.1 Workbench-level concept model

The thirteen primitives — workspace, resource, surface, selection, context, command, tool, contribution, capability, event, task, artifact, provenance — are defined in:

| Primitive | Definition | Code anchor |
|---|---|---|
| Workspace | [WORKBENCH_INTERACTION_MODEL.md §2.1](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/workspace/workspace.ts` |
| Resource | [§2.2](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/workspace/resource.ts` |
| Surface | [§2.3](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/workbench/surfaces/*` |
| Selection | [§2.4](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/services/selectionService.ts` |
| Context | [§2.5](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/services/contextKeyService.ts` |
| Command | [§2.6](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/services/commandService.ts` |
| Tool | [§2.7](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/tools/toolRegistry.ts` |
| Contribution | [§2.8](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/contributions/contributionRegistry.ts` (M81 Slice B) |
| Capability | [§2.9](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/openclaw/openclawToolPolicy.ts` (M65) |
| Event | [§2.10](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/platform/events.ts` |
| Task | [§2.11](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | (future — flagged in atlas §8 uncertainty markers) |
| Artifact | [§2.12](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | various (canvas pages, chat threads) |
| Provenance | [§2.13](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) | `src/services/provenanceService.ts` (M81 Slice C) |

### 9.2 Universal service map

The service map listed in the roadmap (command registry, contribution registry, context/selection service, resource/link resolver, tool registry, task/job service, extension API bridge, IPC contract layer, capability service, event bus, persistence ownership registry, status/notification, trace/diagnostics) is folded into the model's primitive definitions and into [SYSTEM_ATLAS.md §2 System Ownership Table](docs/architecture/SYSTEM_ATLAS.md). Future SR-4+ milestones may consolidate it into a dedicated "service catalog" appendix if needed; it is not required for adoption.

### 9.3 Compatibility plan for existing built-ins and extensions

Defined in [WORKBENCH_INTERACTION_MODEL.md §7 Compatibility and Migration Strategy](docs/architecture/WORKBENCH_INTERACTION_MODEL.md). Key commitments (§1.3, §7):

- Existing workspaces open and restore with the same layout and editor state.
- Canvas pages and blocks persist and are recoverable.
- Extension manifests remain valid; activation events still work.
- Keybindings and command IDs remain stable unless explicitly migrated with a deprecation period.
- IPC contracts are replaced with typed equivalents; old contracts have shims.

These commitments are enforced by the existing preservation tests and by the milestone-level anti-lists.

### 9.4 Compatibility result observed in M81 and M82

Both predecessor milestones shipped against the model without regressing the primary workflow:

- M81 Slice A added a typed `SelectionEvent` broadcast through the existing `SelectionService` without breaking the one-off dispatcher.
- M81 Slice B introduced the `ContributionRegistry` orchestrator with per-processor try/catch isolation.
- M81 Slice C wired Canvas page provenance through the model's Provenance primitive.
- M82 Slice A added `contributes.canvas.blockTypes[]` and `api.canvas.registerBlockType`.
- M82 Slice B added `contributes.chat.participants[]` and `api.chat.registerParticipant`, with the participant shape pinned verbatim to VS Code's `contributes.chatParticipants`.

Both milestones cite this model in their frontmatter (`Interaction model:` line). M83 makes that citation a manifest-level requirement.

### 9.5 Exception policy for one-off bridges

Defined cumulatively across [WORKBENCH_INTERACTION_MODEL.md §10 Risks and Anti-Patterns](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) (one-off bridges flagged as an anti-pattern) and [§4 Cross-Tool Bridge Replacement Plan](docs/architecture/WORKBENCH_INTERACTION_MODEL.md) (every bridge in [SYSTEM_ATLAS §4.1 One-Off Bridges](docs/architecture/SYSTEM_ATLAS.md) has a named replacement).

**Operational rule established by M83:** any future milestone that introduces a new bridge between two surfaces must either (a) route it through an existing model primitive (typed event bus, capability service, command, contribution) **or** (b) document an explicit exception in its milestone doc citing this section, naming the surfaces involved and the replacement path that will close the exception. Exceptions are time-bounded; the Conductor will not approve an exception without a follow-up milestone entry that closes it.

### 9.6 Proof gate (canonical)

Quoting [SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md §M83](docs/research/SYSTEMS_REDESIGN_CLEANUP_AND_MILESTONES.md):

> - Explorer, editor, AI chat, Canvas, and extension workflows can be described using the shared model.
> - No new cross-tool interaction is approved without naming its workbench concepts and tests.
> - Existing extension behavior has a migration or compatibility path.

M81 and M82 already demonstrate (a) the model describes each surface and (b) every cross-tool addition names its concepts. M83 elevates this from a roadmap aspiration to a milestone-creation requirement: from this point forward, every new milestone's frontmatter MUST include an `Interaction model:` line citing the relevant `WORKBENCH_INTERACTION_MODEL.md §x` section, and every "Workbench Concepts Involved" section MUST name the primitives the milestone touches.

## 10. Implementation Slices

None. M83 is documentation-only. The three documentation actions are bundled into a single commit:

1. Create `docs/Parallx_Milestone_83.md` (this file).
2. Flip frontmatter `Status:` in `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` from `Draft (pending Fitness & Review)` → `Adopted (M83 / SR-3, 2026-05-23)`.
3. Update `docs/README.md` (active-milestone pointer = none; most-recently-closed list prepends M83; status-counts increment `implemented-verified` from 11 to 12).

## 11. Verification Plan

Documentation-only milestone. Verification reduces to:

- **No source files modified.** `git show <closeout-commit> --stat` must list only the three `docs/` paths above.
- **No tests regressed.** No code changed; the existing 3203/1-skip suite remains the verification baseline.
- **Cross-references resolve.** Every `[link](path)` in this milestone doc points at an existing file (the cross-reference table is the substantive content).
- **Frontmatter consistency.** The Status line in `WORKBENCH_INTERACTION_MODEL.md` reflects adoption.

## 12. Preservation Checklist

- ✅ Manifest §11 preservation: no preservation-list files touched.
- ✅ Manifest §5 primary workflow: unchanged (no code).
- ✅ Manifest §22 verification contract: trivially satisfied; no behavioural change.
- ✅ Anti-list (canvasDataService, canvasPersistence, blockRegistry, chatAgentService, electron/*, openclaw/*): untouched.
- ✅ External extensions, MCP servers, AI tools: unaffected (no API surface changes).

## 13. Commit Plan

Single commit (per Manifest §13 — one commit per milestone status transition):

```
docs(M83): adopt workbench interaction model + atlas as canonical (M83 / SR-3)
```

Body summarises: deliverables already exist; review APPROVED; frontmatter flipped on the model; README updated; proof gate now manifest-level constraint.

Footer: `Rollback: git revert HEAD.`

## 14. Rollback Plan

Single-commit revert. Because nothing executable changes, rollback is purely a documentation operation:

```
git revert <m83-closeout-commit>
```

This restores `WORKBENCH_INTERACTION_MODEL.md` to `Draft` status and removes M83's adoption record. No state migration, no schema rollback, no test re-baseline needed.

## 15. Closeout Evidence

- `docs/Parallx_Milestone_83.md` created.
- `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` Status: `Adopted (M83 / SR-3, 2026-05-23)`.
- `docs/README.md` reflects M83 as most-recently-closed; status count `implemented-verified` = 12.
- Pre-existing review (`WORKBENCH_INTERACTION_MODEL_REVIEW.md` §1) verdict `APPROVE` stands as the Fitness & Review for this milestone — no new review pass required because no new design content was authored; only an adoption record.

## 16. Stop / Escalation Conditions

The Conductor must stop and surface to the user if any of the following holds at closeout time:

- A `src/**` file would need to be modified to ratify the model.
- The review verdict for the model becomes anything other than APPROVE.
- The compatibility plan in §7 of the model is found to be invalidated by M81 or M82's actual implementation.
- The proof gate cannot be enforced because some existing milestone artifact (M81 or M82) does not in fact cite the model.

None of these conditions hold at the time of authoring. M83 closes in a single commit.

## 17. Status Trail

| Date | Status | Change | Commit |
|---|---|---|---|
| 2026-05-23 | `planning` | Drafted by Conductor as M82 successor. All six roadmap deliverables already exist as pre-existing artifacts; M83 is a ratification milestone. | (this commit) |
| 2026-05-23 | `active` | All gates (research, atlas, baseline, preservation, review) satisfied by pre-existing artifacts; no implementation slice required. | (this commit) |
| 2026-05-23 | `implemented-verified` | Model adopted (frontmatter flipped). Atlas adopted (already canonical). Proof gate now manifest-level. README updated. Closeout. | (this commit) |
