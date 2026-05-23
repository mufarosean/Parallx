# Branch Governance — Systems Redesign

> Owner: Git and Release Steward (agent card: [agents/git-and-release-steward.md](../agents/git-and-release-steward.md))
> Status: Active
> Created: May 23, 2026
> Authority: [PARALLX_MANIFEST.md §2, §19, §20](../../PARALLX_MANIFEST.md)

This document is the operating contract for git on the Parallx systems redesign. The Steward updates it after every significant branch event.

---

## 1. Ref Inventory (as of `a9c6e17`)

| Ref | Commit | Role |
|---|---|---|
| `master` | `9b9a243` | Current-app baseline — frozen for redesign duration |
| `origin/master` | `9b9a243` | In sync with `master` |
| `checkpoint-pre-systems-redesign-2026-05-23` | `9b9a243` | Permanent restore point |
| `systems-redesign-planning` (HEAD) | `a9c6e17` | Active redesign branch (docs only so far) |
| `origin/systems-redesign-planning` | `6f193e1` | Remote tracking (behind local) |

Verified via:
- `git rev-parse master origin/master checkpoint-pre-systems-redesign-2026-05-23 systems-redesign-planning`
- `git status --short --branch`
- `git rev-list --left-right --count master...HEAD` → `0    12`

## 2. Branch Topology

```
master ── 9b9a243 ── checkpoint-pre-systems-redesign-2026-05-23
                  └── systems-redesign-planning ── ... ── a9c6e17 (HEAD)
                                                  └── origin/systems-redesign-planning (behind)
```

Working tree: clean. No untracked work outside the kickoff package.

## 3. Rules (manifest §19, §20)

1. **Never** edit `master` or the checkpoint branch without explicit per-action user approval.
2. **Never** rewrite history (`rebase -i`, `commit --amend` of pushed commits, `push --force`, `reset --hard`).
3. **Never** delete `checkpoint-pre-systems-redesign-2026-05-23`.
4. **Never** merge to `master` until the consolidation milestone (a future M-doc) provides before/after evidence.
5. **Never** bypass safety hooks (`--no-verify`).
6. All redesign work stays on `systems-redesign-planning` or a clearly-named child branch.
7. One commit, one clear purpose. Do not mix kickoff/atlas/baseline/app-code/tests in a single commit.
8. Commit message format: `<type>(<scope>): <intent>` with rollback note in body for any C4 commit.
   - Allowed types: `docs`, `test`, `feat`, `fix`, `refactor`, `perf`, `build`, `chore`.
   - Allowed scopes during this redesign: redesign-kickoff, atlas, governance, milestones, baselines, workbench, canvas, chat, explorer, editor, extension-api, ipc, persistence, capability, tasks, ui.
9. Every C4 implementation commit must reference an accepted slice ID from the active milestone and include a `Rollback:` line.
10. Each phase boundary (C0 → C1 → C2 → C3 → C4) is recorded as a Steward entry in §6 below.

## 4. Commit Plan (post-kickoff)

| # | Phase | Purpose | Scope ceiling |
|---|---|---|---|
| C0.0 | Done (`a9c6e17`) | Kickoff + agent cards | `docs/research/SYSTEMS_REDESIGN_KICKOFF.md` + `docs/research/agents/` |
| C0.1 | Now | Branch governance | `docs/research/git/BRANCH_GOVERNANCE.md` |
| C0.2 | Next | Artifact directory scaffolding | empty/index files under `docs/architecture/`, `docs/research/baselines/`, `docs/research/reviews/` |
| C0.3 | C0 | Milestone status labels `M64..M80` | frontmatter only |
| C0.4 | C0 | Archive moves for superseded milestones | `git mv` to `docs/archive/milestones/`, zero deletions |
| C1.x | After C0 acceptance | README doc index rewrite | `docs/README.md` |
| C2.x | After C1 | System Atlas | `docs/architecture/SYSTEM_ATLAS.md` |
| C2.y | After atlas | External + current-code research briefs | `docs/research/WORKBENCH_*_RESEARCH_BRIEF.md` |
| C3.x | After C2 | Baseline scorecard + characterization tests | `docs/research/baselines/` + `tests/` (no behavior change) |
| C3.y | After C3.x | Workbench interaction model + review | `docs/architecture/WORKBENCH_INTERACTION_MODEL.md` + review note |
| C3.z | After review | Active milestone `M81 / SR-1` | `docs/Parallx_Milestone_81.md` |
| C4.* | After M81 accepted | One implementation slice per commit | Files named in the slice scope only |

## 5. Rollback Paths

| Situation | Rollback |
|---|---|
| Docs-only commit causes confusion | `git revert <sha>` on `systems-redesign-planning` |
| Atlas / interaction model proves wrong | `git revert <sha>` (docs-only) |
| C4 slice fails review | `git revert <sha>` on `systems-redesign-planning` (preserves history) |
| Branch becomes irrecoverable | `git switch -c systems-redesign-planning-recovery checkpoint-pre-systems-redesign-2026-05-23` and re-apply accepted slices |
| Catastrophic ref damage | `git reflog` recovery — checkpoint branch is permanent and never moved |

`master` is never the rollback target during redesign. The checkpoint branch is.

## 6. Event Log

| Date | Commit | Event |
|---|---|---|
| 2026-05-23 | `a9c6e17` | Kickoff + 9 agent cards committed |
| 2026-05-23 | (next) | Branch governance committed |

## 7. Merge-Readiness Gate (future)

The branch becomes merge-ready to `master` only when **all** of the following are true:
- System Atlas exists and matches current code.
- Baseline scorecard exists with measured numbers.
- Workbench interaction model accepted by Fitness and Review Agent.
- At least one C4 slice has shipped and been reviewed.
- A consolidation milestone provides before/after evidence per manifest §12.
- User explicitly approves merge.

Until then: no `master` updates, no fast-forwards, no rebases.
