# Parallx Documentation Index

Canonical product docs live at this folder's root and one level deep.
Anything under `docs/archive/` is historical — read for context, not as
source-of-truth.

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

---

## Going-forward rules

1. **Milestone files**: only the in-flight milestone lives at `docs/` root.
   On close, `git mv` it into `archive/milestones/` in the same commit that
   marks it closed.
2. **Plans, fix plans, gap maps, audits, trackers, "research" docs**: these
   are point-in-time artifacts. Land them in `docs/archive/<domain>/` from
   day one (or at the latest, when the work closes). They never live at the
   canonical root.
3. **Canonical docs at root and at one level (`ai/`, `canvas/`, `research/`)**
   must satisfy: (a) all links resolve, (b) all factual claims are still
   true, (c) reviewed at the close of every third milestone.
4. **README.md** is the single index. Every canonical doc must be linked
   from it. If it's not in the README, it's not canonical.
