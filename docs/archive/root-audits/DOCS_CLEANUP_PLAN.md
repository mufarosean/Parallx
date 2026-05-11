# Docs Cleanup Plan

> Snapshot date: May 9, 2026. Author: prep work for the M65-or-later docs sweep.
> The goal is a `docs/` root that contains **only** currently-true canonical docs.
> Everything else moves into `docs/archive/<domain>/` keyed by topic.

---

## 1. What's wrong today

### 1.1 The root `README.md` is broken
`docs/README.md` still links to files that don't exist at those paths:

| Linked from README | Actually exists at | Status |
|---|---|---|
| `./FULL_AUDIT_REPORT.md` | `docs/canvas/archive/FULL_AUDIT_REPORT.md` | broken |
| `./NOTION_VS_PARALLX_GAP_ANALYSIS.md` | nowhere | broken |
| `./CANVAS_STRUCTURAL_MODEL.md` | `docs/canvas/research/CANVAS_STRUCTURAL_MODEL.md` | broken |
| `./BLOCK_INTERACTION_RULES.md` | `docs/canvas/research/BLOCK_INTERACTION_RULES.md` | broken |
| `./archive/FULL_AUDIT_REPORT.md` | `docs/canvas/archive/FULL_AUDIT_REPORT.md` | broken |
| `./archive/PHASE1_CLEANUP.md` | `docs/canvas/archive/PHASE1_CLEANUP.md` | broken |
| `./archive/FEB18_2026_CANVAS_INTERACTION_HARDENING.md` | `docs/canvas/archive/...` | broken |

Milestone list in README stops at M08 (+ a stray M40); reality has M01–M64.

### 1.2 Milestone files are split across two locations inconsistently
- `docs/archive/milestones/` holds M01–M47 + M07_1, M07_2, M15_original.
- `docs/` root holds M48–M64 (17 files).

There's no rule for when a milestone graduates to archive. New ones just pile up at root.

### 1.3 The root has 31 files; most aren't canonical
Currently in `docs/`:

| File | Verdict |
|---|---|
| `README.md` | Keep — but rewrite (see §1.1). |
| `USER_GUIDE.md` | Keep — canonical end-user guide. |
| `MCP_SERVERS_USER_GUIDE.md` | Keep — canonical MCP config guide. |
| `PARALLX_EXTENSION_AUTHORING_FOR_AI.md` | Keep — canonical (just shipped). |
| `PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md` | Keep — canonical (just shipped). |
| `PARALLX_WORKSPACE_SCHEMA.md` | Keep — canonical schema reference. |
| `SETTINGS_REGISTRY.md` | Keep — canonical settings reference. |
| `Future_Improvements.md` | Keep — active backlog. |
| `Parallx_Milestone_64.md` | Keep — current/in-progress milestone. |
| `Parallx_Milestone_48.md` … `Parallx_Milestone_63.md` | **Archive** — completed milestones (16 files). |
| `Parallx_Milestone_58_USER_GUIDE.md` | **Archive or merge** — content belongs in `USER_GUIDE.md`. |
| `SETTINGS_AUDIT.md` | **Archive** — point-in-time audit; `SETTINGS_REGISTRY.md` is the live doc. |
| `STARTUP_PERFORMANCE.md` | **Archive** — M53 perf work; superseded. |
| `THEME_COLOR_AUDIT.md` | **Archive** — M40-era audit. |
| `OPENCLAW_DEAD_CODE_AND_PARITY_AGENTS.md` | **Archive** — M41 parity-cycle planning. |

**Net root after cleanup: 11 files** (down from 31).

### 1.4 `docs/ai/` mixes guides with planning artifacts
- Real guides: `AI_USER_GUIDE.md`, `AUTONOMY_RUNTIME_CONTRACTS.md`, `AUTONOMY_TASK_RAIL.md`, `CANVAS_BLOCK_API.md`, `GMAIL_MCP_INTEGRATION.md`.
- Planning / one-shot research / fix plans (archive): `AIR_E2E_PLAYWRIGHT_PLAN.md`, `AI_CHAT_CONTEXT_INTEGRATION_PLAN.md`, `BOOKS_AI_EVAL_SYSTEM.md`, `CITATION_ATTRIBUTION_REDESIGN.md`, `CONVERSATIONAL_ROUTING_FIX_PLAN.md`, `GMAIL_AUTONOMY_WALKTHROUGH.md`, `M40_*` (3 files), `PROACTIVE_AI_ASSISTANCE_RESEARCH.md`, `RAG_ARCHITECTURE_COMPARISON.md`, `RAG_RETRIEVAL_HARDENING_RESEARCH.md`, `RETRIEVAL_PERFORMANCE_FIX_PLAN.md`.
- `docs/ai/openclaw/` — 50 files, **100% historical** (D1b/M58/W1–W6 audits, gap maps, trackers, CLAW_* specs, media-organizer_D1–D8 trackers from M63).

### 1.5 `docs/canvas/` mixes canonical with research
- Canonical-feeling: `BLOCK_REGISTRY.md`, `ICON_REGISTRY.md`.
- Research / plans: `BLOCKSTATE_CONDENSATION_PLAN.md`, `BSR_INTERACTION_GAP_PLAN.md`, `CANVAS_DATA_SERVICE_INTERFACE_PLAN.md`, `CANVAS_MENU_REGISTRY_PLAN.md`, `DATABASE_AUDIT_REPORT.md`, `FULL_CANVAS_AUDIT_REPORT.md`, `ICON_COVER_MENU_REGISTRY_PLAN.md`, `SUBPAGE_AUDIT_FIXES.md`.
- `docs/canvas/research/` — 11 files. Two of these (`CANVAS_STRUCTURAL_MODEL.md`, `BLOCK_INTERACTION_RULES.md`) are referenced as canonical from the root README and from milestones — they should be promoted, not buried in `research/`.
- `docs/canvas/archive/` — 4 files, correctly archived. Fine.

### 1.6 `docs/research/` is half-canonical, half-historical
- Forward-looking design refs (keep): `INTERACTION_LAYER_ARCHITECTURE.md`, `Living_UI_Ideas.md`, `Living_UI_Research.md`.
- Historical capability assessments (archive): `ANTHROPIC_COMPUTER_USE_RESEARCH.md`, `CLAUDE_CAPABILITIES_RESEARCH.md`, `OPENCLAW_CAPABILITIES_ASSESSMENT.md`, `OPENCLAW_USER_GUIDE.md`.

### 1.7 `docs/perchance research/` is a vestigial folder
Single child: `perchance-characters-export-2026-04-01.json/` — a directory whose name ends `.json` (looks like a dropped export). Move whole folder to `archive/perchance/` and stop carrying it in the docs tree.

### 1.8 `docs/archive/` is well-organized but oversubscribed
- `archive/audits/` — 85 D*/F* parity audit/gap-map/tracker files. Correctly archived.
- `archive/clawrallx-planning/` — 6 files. Correctly archived.
- `archive/deep-audit/` — 2 files. Correctly archived.
- `archive/milestones/` — 50 files (M01–M47 + variants). Correctly archived.

No changes needed inside `docs/archive/` itself — it's the destination, not a problem.

---

## 2. Target structure

```
docs/
├── README.md                                 (rewritten)
├── USER_GUIDE.md                             (existing)
├── MCP_SERVERS_USER_GUIDE.md                 (existing)
├── PARALLX_EXTENSION_AUTHORING_FOR_AI.md     (existing)
├── PARALLX_MCP_SERVER_AUTHORING_FOR_AI.md    (existing)
├── PARALLX_WORKSPACE_SCHEMA.md               (existing)
├── SETTINGS_REGISTRY.md                      (existing)
├── Future_Improvements.md                    (existing)
├── Parallx_Milestone_64.md                   (current milestone only)
│
├── ai/
│   ├── AI_USER_GUIDE.md
│   ├── AUTONOMY_RUNTIME_CONTRACTS.md
│   ├── AUTONOMY_TASK_RAIL.md
│   ├── CANVAS_BLOCK_API.md
│   └── GMAIL_MCP_INTEGRATION.md
│
├── canvas/
│   ├── BLOCK_REGISTRY.md
│   ├── ICON_REGISTRY.md
│   ├── CANVAS_STRUCTURAL_MODEL.md            (promoted from research/)
│   └── BLOCK_INTERACTION_RULES.md            (promoted from research/)
│
├── research/                                 (forward-looking only)
│   ├── INTERACTION_LAYER_ARCHITECTURE.md
│   ├── Living_UI_Ideas.md
│   └── Living_UI_Research.md
│
└── archive/
    ├── milestones/                           (M01–M63 — adds M48–M63)
    ├── audits/                               (unchanged)
    ├── clawrallx-planning/                   (unchanged)
    ├── deep-audit/                           (unchanged)
    ├── ai-plans/                             (NEW — root for ai/* plans + M40_*)
    ├── ai-openclaw/                          (NEW — old docs/ai/openclaw/)
    ├── canvas-plans/                         (NEW — canvas/*_PLAN.md, audits)
    ├── canvas-research/                      (NEW — old docs/canvas/research/, minus the 2 promoted)
    ├── canvas-archive/                       (NEW — flatten old docs/canvas/archive/)
    ├── research/                             (NEW — old docs/research/* historical)
    ├── perchance/                            (NEW — old docs/perchance research/)
    └── root-audits/                          (NEW — SETTINGS_AUDIT, STARTUP_PERF, THEME_COLOR, OPENCLAW_DEAD_CODE, M58_USER_GUIDE)
```

Final docs root: **11 files** (was 31). Folder count: 4 active + 1 archive (was 5 active + 1 archive with overflow at root).

---

## 3. Move list (executable)

All moves preserve git history via `git mv`. Run from repo root.

### 3.1 Archive completed milestones M48–M63

```powershell
git mv docs/Parallx_Milestone_48.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_49.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_50.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_51.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_52.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_53.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_54.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_55.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_56.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_57.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_58.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_58_USER_GUIDE.md docs/archive/milestones/
git mv docs/Parallx_Milestone_59.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_60.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_61.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_62.md  docs/archive/milestones/
git mv docs/Parallx_Milestone_63.md  docs/archive/milestones/
```

> Rule going forward: **only the in-flight milestone lives at `docs/` root.** When a milestone is closed, `git mv` it into `archive/milestones/` in the same commit that marks it closed.

### 3.2 Archive root-level audits and one-shots

```powershell
mkdir docs/archive/root-audits
git mv docs/SETTINGS_AUDIT.md                       docs/archive/root-audits/
git mv docs/STARTUP_PERFORMANCE.md                  docs/archive/root-audits/
git mv docs/THEME_COLOR_AUDIT.md                    docs/archive/root-audits/
git mv docs/OPENCLAW_DEAD_CODE_AND_PARITY_AGENTS.md docs/archive/root-audits/
```

### 3.3 Split `docs/ai/` — keep canonical, archive plans

Keep at `docs/ai/`: `AI_USER_GUIDE.md`, `AUTONOMY_RUNTIME_CONTRACTS.md`, `AUTONOMY_TASK_RAIL.md`, `CANVAS_BLOCK_API.md`, `GMAIL_MCP_INTEGRATION.md`.

```powershell
mkdir docs/archive/ai-plans
git mv docs/ai/AIR_E2E_PLAYWRIGHT_PLAN.md             docs/archive/ai-plans/
git mv docs/ai/AI_CHAT_CONTEXT_INTEGRATION_PLAN.md    docs/archive/ai-plans/
git mv docs/ai/BOOKS_AI_EVAL_SYSTEM.md                docs/archive/ai-plans/
git mv docs/ai/CITATION_ATTRIBUTION_REDESIGN.md       docs/archive/ai-plans/
git mv docs/ai/CONVERSATIONAL_ROUTING_FIX_PLAN.md     docs/archive/ai-plans/
git mv docs/ai/GMAIL_AUTONOMY_WALKTHROUGH.md          docs/archive/ai-plans/
git mv docs/ai/M40_AI_ENTRYPOINT_INVENTORY.md         docs/archive/ai-plans/
git mv docs/ai/M40_PHASE1_CANVAS_BASELINE.md          docs/archive/ai-plans/
git mv docs/ai/M40_PHASE1_STRESS_BASELINE.md          docs/archive/ai-plans/
git mv docs/ai/PROACTIVE_AI_ASSISTANCE_RESEARCH.md    docs/archive/ai-plans/
git mv docs/ai/RAG_ARCHITECTURE_COMPARISON.md         docs/archive/ai-plans/
git mv docs/ai/RAG_RETRIEVAL_HARDENING_RESEARCH.md    docs/archive/ai-plans/
git mv docs/ai/RETRIEVAL_PERFORMANCE_FIX_PLAN.md      docs/archive/ai-plans/

git mv docs/ai/openclaw docs/archive/ai-openclaw
```

### 3.4 Split `docs/canvas/` — promote 2, archive the rest

```powershell
git mv docs/canvas/research/CANVAS_STRUCTURAL_MODEL.md  docs/canvas/
git mv docs/canvas/research/BLOCK_INTERACTION_RULES.md  docs/canvas/

mkdir docs/archive/canvas-plans
git mv docs/canvas/BLOCKSTATE_CONDENSATION_PLAN.md            docs/archive/canvas-plans/
git mv docs/canvas/BSR_INTERACTION_GAP_PLAN.md                docs/archive/canvas-plans/
git mv docs/canvas/CANVAS_DATA_SERVICE_INTERFACE_PLAN.md      docs/archive/canvas-plans/
git mv docs/canvas/CANVAS_MENU_REGISTRY_PLAN.md               docs/archive/canvas-plans/
git mv docs/canvas/DATABASE_AUDIT_REPORT.md                   docs/archive/canvas-plans/
git mv docs/canvas/FULL_CANVAS_AUDIT_REPORT.md                docs/archive/canvas-plans/
git mv docs/canvas/ICON_COVER_MENU_REGISTRY_PLAN.md           docs/archive/canvas-plans/
git mv docs/canvas/SUBPAGE_AUDIT_FIXES.md                     docs/archive/canvas-plans/

git mv docs/canvas/research  docs/archive/canvas-research
git mv docs/canvas/archive   docs/archive/canvas-archive
```

### 3.5 Split `docs/research/` — keep forward-looking only

```powershell
mkdir docs/archive/research
git mv docs/research/ANTHROPIC_COMPUTER_USE_RESEARCH.md  docs/archive/research/
git mv docs/research/CLAUDE_CAPABILITIES_RESEARCH.md     docs/archive/research/
git mv docs/research/OPENCLAW_CAPABILITIES_ASSESSMENT.md docs/archive/research/
git mv docs/research/OPENCLAW_USER_GUIDE.md              docs/archive/research/
```

### 3.6 Move `perchance research/`

```powershell
git mv "docs/perchance research" docs/archive/perchance
```

---

## 4. After moves: rewrite `docs/README.md`

The new README is short and **only** links to files that exist. Proposed content:

```markdown
# Parallx Documentation Index

Canonical product docs live at this folder's root and one level deep.
Anything under `docs/archive/` is historical — read for context, not as source-of-truth.

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
- [ai/AUTONOMY_RUNTIME_CONTRACTS.md](./ai/AUTONOMY_RUNTIME_CONTRACTS.md)
- [ai/AUTONOMY_TASK_RAIL.md](./ai/AUTONOMY_TASK_RAIL.md)
- [ai/CANVAS_BLOCK_API.md](./ai/CANVAS_BLOCK_API.md)
- [ai/GMAIL_MCP_INTEGRATION.md](./ai/GMAIL_MCP_INTEGRATION.md)
- [canvas/BLOCK_REGISTRY.md](./canvas/BLOCK_REGISTRY.md)
- [canvas/ICON_REGISTRY.md](./canvas/ICON_REGISTRY.md)
- [canvas/CANVAS_STRUCTURAL_MODEL.md](./canvas/CANVAS_STRUCTURAL_MODEL.md)
- [canvas/BLOCK_INTERACTION_RULES.md](./canvas/BLOCK_INTERACTION_RULES.md)

## Forward-looking
- [Future_Improvements.md](./Future_Improvements.md)
- [research/INTERACTION_LAYER_ARCHITECTURE.md](./research/INTERACTION_LAYER_ARCHITECTURE.md)
- [research/Living_UI_Ideas.md](./research/Living_UI_Ideas.md)
- [research/Living_UI_Research.md](./research/Living_UI_Research.md)

## Active milestone
- [Parallx_Milestone_64.md](./Parallx_Milestone_64.md)

## Archive
- [archive/milestones/](./archive/milestones/) — closed milestones M01–M63
- [archive/audits/](./archive/audits/) — M41 OpenClaw parity audits/gap maps/trackers
- [archive/ai-plans/](./archive/ai-plans/) — completed AI feature plans
- [archive/ai-openclaw/](./archive/ai-openclaw/) — OpenClaw integration history
- [archive/canvas-plans/](./archive/canvas-plans/), [archive/canvas-research/](./archive/canvas-research/), [archive/canvas-archive/](./archive/canvas-archive/) — canvas history
- [archive/research/](./archive/research/) — capability assessments
- [archive/root-audits/](./archive/root-audits/) — historical settings/perf/theme audits
- [archive/clawrallx-planning/](./archive/clawrallx-planning/), [archive/deep-audit/](./archive/deep-audit/) — older planning artifacts
- [archive/perchance/](./archive/perchance/) — old export
```

---

## 5. Cross-reference fixes

After the moves above, run:

```powershell
# Find references to moved files (relative-path style) so we can update them.
git grep -nE 'Parallx_Milestone_(48|49|5[0-9]|6[0-3])\.md' docs/
git grep -nE '(SETTINGS_AUDIT|STARTUP_PERFORMANCE|THEME_COLOR_AUDIT|OPENCLAW_DEAD_CODE)' docs/
git grep -n  'canvas/research/' docs/
git grep -n  'ai/openclaw/'     docs/
```

Expected hits to fix in **active** docs (anything still in `docs/` root, `docs/ai/`, `docs/canvas/`, `docs/research/`):
- Internal links pointing at the old paths.
- Section "Linked Docs" tables in canonical references.

**Do not** rewrite links inside `docs/archive/**` — archived docs are point-in-time records. Their broken links are part of the snapshot.

---

## 6. Going-forward rules (add to `docs/README.md`)

1. **Milestone files**: only the in-flight milestone lives at `docs/` root. On close, `git mv` to `archive/milestones/` in the closing commit.
2. **Plans, fix plans, gap maps, audits, trackers, "research" docs**: these are point-in-time artifacts. Land them in `docs/archive/<domain>/` from day one (or at the latest, when the work closes). They never live at the canonical root.
3. **Canonical docs at root and at one level (`ai/`, `canvas/`, `research/`)** must satisfy: (a) all links resolve, (b) all factual claims are still true, (c) reviewed at the close of every third milestone.
4. **README.md** is the single index. Every canonical doc must be linked from it. If it's not in the README, it's not canonical.

---

## 7. Execution order

1. Move §3.1–§3.6 (independent, can be a single commit per subsection).
2. Run §5 cross-reference scan; fix surviving links in canonical docs.
3. Replace `docs/README.md` with §4's content.
4. Append §6 rules to README.

Estimated touched files: ~115 moved + ~10 canonical docs with link fixups + 1 README rewrite.

End of plan.
