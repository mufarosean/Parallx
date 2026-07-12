// toolResourceRegistry.ts — per-session read-before-edit registry (M85 Slice C)
//
// The harness principle this enforces: an agent must not edit what it has not
// seen. A from-memory anchor out of a stale context can still match content
// whose surroundings changed — uniqueness checks alone can't catch that.
// Read tools mark a resource as "seen" for the session; content-mutating
// tools refuse to run until the current content has actually been read.
//
// One registry for every resource surface — workspace files (fs_* tools) and
// canvas pages (canvas_* tools) — keyed by a namespaced resource key so the
// two can never collide. Lives in the services layer so both the chat and
// canvas built-ins can import it without crossing built-in boundaries.
//
// Fail-open by design: invocations without a session context (heartbeat,
// legacy invoke paths, tests) are not gated — the registry hardens the agent
// loop without breaking other surfaces.

const MAX_SESSIONS = 64;
const MAX_KEYS_PER_SESSION = 512;

const _seenBySession = new Map<string, Set<string>>();

/** Registry key for a workspace file. Windows paths are case-insensitive and
 *  both slash styles appear in model output. */
export function fileResourceKey(path: string): string {
  return `file:${path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()}`;
}

/** Registry key for a canvas page. */
export function pageResourceKey(pageId: string): string {
  return `page:${pageId.toLowerCase()}`;
}

/** Record that the session has seen this resource's current content. */
export function markResourceSeen(sessionId: string, resourceKey: string): void {
  let set = _seenBySession.get(sessionId);
  if (!set) {
    // FIFO-evict the oldest session when at capacity (Map preserves insertion order).
    if (_seenBySession.size >= MAX_SESSIONS) {
      const oldest = _seenBySession.keys().next().value;
      if (oldest !== undefined) { _seenBySession.delete(oldest); }
    }
    set = new Set<string>();
    _seenBySession.set(sessionId, set);
  }
  if (set.size >= MAX_KEYS_PER_SESSION) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) { set.delete(oldest); }
  }
  set.add(resourceKey);
}

/** Whether the session has seen this resource. */
export function wasResourceSeen(sessionId: string, resourceKey: string): boolean {
  return _seenBySession.get(sessionId)?.has(resourceKey) ?? false;
}

/** Drop a session's registry (call on session delete). */
export function clearResourceRegistry(sessionId: string): void {
  _seenBySession.delete(sessionId);
}

/** Test-only: reset all registry state. */
export function _resetResourceRegistryForTest(): void {
  _seenBySession.clear();
}
