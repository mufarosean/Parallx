// chatWorkspaceDigest.ts — DEPRECATED no-op (see comment below)
//
// History: this module used to compute a workspace "digest" that listed
// every canvas page, every workspace file, and inlined any README.md, and
// injected the result into the system prompt under a "Workspace Overview"
// heading. It looked authoritative but it was actively harmful:
//
//   - It went stale the moment a page was created/renamed/deleted.
//   - It ate hundreds of tokens of prompt budget per turn.
//   - It duplicated information the agent's own tools (`canvas_find_pages`,
//     `list_files`, `read_file`, `search_knowledge`) already surface
//     on demand, with current content.
//   - It encouraged the model to answer from the listing instead of
//     actually reading anything ("I see Bugs 3.0 in your workspace —
//     it says…"), which inverted the intended tool-use loop.
//
// The function is kept (returning `undefined`) so the existing optional
// hook in chatDataService.getWorkspaceDigest stays type-stable; consumers
// degrade gracefully because every call site already treats the digest
// as optional. Do not bring back inline workspace listings. If the AI
// needs to know what's in the workspace, it should call a tool.
//
// Bootstrap files (SOUL.md / AGENTS.md / TOOLS.md) are still inlined
// from a separate path in `buildWorkspaceSection` — those are explicit,
// user-authored configuration, not auto-generated listings. They stay.

export interface IChatDigestDatabaseService {
  readonly isOpen?: boolean;
  all<T>(sql: string): Promise<T[]>;
}

export interface IChatDigestFsAccessor {
  readdir(relativePath: string): Promise<readonly { name: string; type: 'file' | 'directory' }[]>;
  exists(relativePath: string): Promise<boolean>;
  readFileContent(relativePath: string): Promise<{ content: string }>;
}

export interface IChatWorkspaceDigestDeps {
  readonly databaseService?: IChatDigestDatabaseService;
  readonly fsAccessor?: IChatDigestFsAccessor;
  readonly getContextLength: () => Promise<number>;
}

/**
 * Always returns `undefined`. See file-level comment. The AI explores the
 * workspace via tools (`canvas_find_pages`, `list_files`, `read_file`, etc.) —
 * never via an inline prompt listing.
 */
export async function computeChatWorkspaceDigest(
  _deps: IChatWorkspaceDigestDeps,
): Promise<string | undefined> {
  return undefined;
}
