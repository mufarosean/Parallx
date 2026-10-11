# workspace

What a workspace is and how its state is kept: `workspace.ts` (identity),
`workspaceLoader.ts` and `workspaceSaver.ts` (`.parallx/workspace-state.json`),
`workspaceManifest.ts` and its JSON schema, `recentWorkspaces.ts`,
`sessionManager.ts` and `staleGuard.ts` (one session per workspace).

May import: `platform`, service interfaces.
