# Parallx Workspace Schema (Full Scope)

This document describes the canonical workspace-file format implemented by:
- JSON Schema: `src/workspace/parallx-workspace.schema.json`
- TypeScript contract + conversion: `src/workspace/workspaceManifest.ts`

## Design Goal
A workspace file is the canonical source of truth for:
- workspace identity
- explicit folder membership
- boundary/access policy
- workspace-level settings
- storage topology (canvas DB, attachments)
- serialized workbench state

## Top-Level Model

```json
{
  "manifestVersion": 1,
  "identity": {},
  "folders": [],
  "boundary": {},
  "settings": {},
  "storage": {},
  "state": {},
  "meta": {}
}
```

## Key Sections

### identity
- Stable workspace identity + metadata.
- Fields include `id`, `name`, `createdAt`, `updatedAt`, `savedAt`, optional `sourceUri`.

### folders
- Explicit workspace folder list (`uri`, `name`, `index`).
- This list defines the default access boundary.

### boundary
- Full-scope policy envelope.
- Current enforced mode: `strict` + deny-by-default outside workspace folders.

### settings
- `global` workspace settings map.
- `profiles` for named setting sets.
- `tools` for per-tool settings and workspace-state payloads.

### storage
- Declares storage topology for workspace-scoped data.
- Includes canvas DB strategy (`workspace-root-relative`) and path (`.parallx/data.db`).

### state
- Contains full serialized workbench state payload (`state.workbench`).

## Runtime Integration

Implemented commands:
- `workspace.exportToFile`: writes a canonical workspace manifest to disk.
- `workspace.importFromFile`: reads, validates, and restores workspace state from a manifest file.

Implemented strict boundary prompts:
- `file.openFile`: outside-workspace file paths require explicit folder-add before opening.
- `file.saveAs`: outside-workspace save targets require explicit folder-add before writing.
- `workspace.exportToFile` and `workspace.importFromFile`: outside-workspace paths require explicit folder-add before read/write.

## Access Boundary Integration

Implemented service:
- `WorkspaceBoundaryService` (`src/services/workspaceBoundaryService.ts`)

Current enforcement:
- Tool filesystem API (`parallx.workspace.fs`) now uses centralized boundary assertion via `WorkspaceBoundaryService`.
- Core renderer file operations now enforce boundary centrally through `FileService.setBoundaryChecker(...)` wired by the workbench.
- Tool `workspaceState` mementos are partitioned by active workspace ID to prevent cross-workspace state bleed.

## Validation Snapshot

- `npm run build` ✅
- `npm run test:unit` ✅ (full unit suite)
- `npm run test:e2e -- tests/e2e/08-workspaces.spec.ts` ✅ (18/18)

## Notes
- This schema is intentionally comprehensive and future-proofed (profiles, tool envelopes, storage descriptors), not minimal.
- `manifestVersion` is locked at `1` for this initial full-scope rollout.
