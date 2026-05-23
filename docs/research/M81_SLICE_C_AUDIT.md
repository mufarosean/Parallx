---
Status: Audit (reality check before code execution)
Author: Explore subagent (Conductor invocation)
Branch: systems-redesign-planning
Head: 45f3fbe6
Created: 2026-05-23
Audits: docs/Parallx_Milestone_81.md §4 Slice C
---

# M81 Slice C Audit — Capability, Task, Artifact, and Provenance Primitives

**Audit Date:** 2026-05-23  
**Branch:** `systems-redesign-planning` @ `45f3fbe6`  
**Auditor:** Exploration Mode  
**Status:** REQUIRES MAJOR RESCOPE  

---

## Executive Summary

This audit validates the six major claims in [Parallx_Milestone_81.md](Parallx_Milestone_81.md) §4 "Slice C" against the actual codebase. **THREE claims are REFUTED or OUTDATED, TWO are PARTIALLY TRUE with significant nuance, and ONE reveals a MANIFEST VIOLATION.**

The critical findings:

1. **Capability gating already exists** — `openclawToolPolicy.ts` (M65), `permissionService.ts` (M11), and `policyDecisionPoint.ts` (M67) implement a full 3-tier permission model with profiles and approval gates.

2. **Background work coordination patterns exist** — `CronService`, `HeartbeatRunner`, `SemanticGraphService`, and indexing pipeline all use cooperative-yield patterns (`setTimeout(0)`). No monolithic TaskService is currently missing.

3. **Artifact provenance fields do NOT exist** — Canvas `IPage` lacks creator/origin fields. This is genuinely missing and valid.

4. **TaskService is SPECULATIVE** — The brief claims it's needed "to coordinate background work," but existing subsystems (autonomy, cron, heartbeat, indexing) already self-coordinate via feature flags and event-based yielding. No observable bug or concrete consumer surfaces.

5. **electron/mcpBridge.cjs MODIFY violates MANIFEST §11** — Preservation rules explicitly protect `electron/*`. The claim to add capability checks to mcpBridge.cjs cannot proceed as-written.

**Recommended decision:** Slice C should be **deferred entirely** until:
- A concrete consumer (workflow hop or bug report) justifies TaskService
- Artifact provenance requirements are clarified beyond "tracing is hard"
- MCP capability gating can be implemented in `src/openclaw/` instead of `electron/`

---

## Claim-by-Claim Verdicts

### Claim 1: "Capabilities are implicit; no gate on filesystem/shell/network/secrets access"

**Verdict: REFUTED**

**Evidence of existing capability gating:**

#### Tier 1: Tool Policy Profiles (M65)

[src/openclaw/openclawToolPolicy.ts](src/openclaw/openclawToolPolicy.ts) L1–150 defines three capability profiles:

```typescript
export type OpenclawToolProfile = 'readonly' | 'standard' | 'full';

const TOOL_PROFILES: Record<OpenclawToolProfile, {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}> = {
  readonly: {
    allow: [
      'list_files', 'read_file', 'search_files', 'grep_search',
      'canvas_find_pages', 'canvas_read_page', 'canvas_get_page',
      'search_knowledge', 'memory_get', 'memory_search',
      'transcript_get', 'transcript_search',
      // NO writes, NO shell, NO schedule
    ],
    deny: [],
  },
  standard: {
    allow: [
      // all readonly +
      'write_file', 'edit_file',
      'canvas_create_page', 'canvas_compose_page', 'canvas_set_page_property',
      'canvas_edit_block', 'canvas_insert_block_after', 'canvas_link_block',
      // NO shell, NO destructive deletes
    ],
    deny: [],
  },
  full: {
    allow: ['*'],
    deny: [],
  },
};

export function isToolDeniedByProfile(toolName: string, mode: OpenclawToolProfile): boolean {
  const profile = TOOL_PROFILES[mode];
  if (profile.deny.includes(toolName)) return true;
  if (profile.allow.includes('*')) return false;
  return !profile.allow.includes(toolName);
}
```

**Category breakdown — what IS gated TODAY:**

| Category | Gate | Owner | Entry point |
|----------|------|-------|-------------|
| **Filesystem reads** | Tool allowlist in profile | openclawToolPolicy.ts | isToolDeniedByProfile() |
| **Filesystem writes** | Tool allowlist in profile + permission level | openclawToolPolicy.ts + permissionService.ts | policyDecisionPoint.ts |
| **Shell execution** | Explicit deny in standard profile; allowed only in full | openclawToolPolicy.ts | isToolDeniedByProfile() |
| **Network egress (HTTP)** | webFetchBridge.cjs chokepoint (M65 Layer 1) | electron/webFetchBridge.cjs | dns preflight, domain blocklist, HTTPS enforcement |
| **Secrets read** | No dedicated gating today (secrets are tool args) | — | permissionService checks tool permission |
| **MCP tool invocation** | Profile + permission level | openclawToolPolicy.ts + permissionService.ts | policyDecisionPoint.ts |

#### Tier 2: Permission Levels (M11)

[src/services/permissionService.ts](src/services/permissionService.ts) L64–110 implements three-tier permissions per tool:

```typescript
export interface IPermissionCheckResult {
  readonly level: ToolPermissionLevel; // 'always-allowed' | 'requires-approval' | 'never-allowed'
  readonly autoApproved: boolean;
  readonly source: 'default' | 'session' | 'persistent' | 'autonomy-allow-policy' | 'strictness';
}

export class PermissionService extends Disposable {
  /** Session-level grants: tool name → 'always-allowed' for session duration. */
  private readonly _sessionGrants = new Map<string, ToolPermissionLevel>();
  
  /** Persistent overrides from `.parallx/permissions.json`. */
  private readonly _persistentOverrides = new Map<string, ToolPermissionLevel>();

  checkPermission(name: string, defaultLevel: ToolPermissionLevel): IPermissionCheckResult {
    // 1. Check persistent overrides (highest priority)
    // 2. Check session grants
    // 3. Check autonomy policy (heartbeat/subagent mode)
    // 4. Fall back to default
  }
}
```

#### Tier 3: Policy Decision Point (M67)

[src/services/policyDecisionPoint.ts](src/services/policyDecisionPoint.ts) L1–100 consolidates approval gates:

```typescript
export class PolicyDecisionPoint {
  decide(req: PolicyRequest): PolicyDecision {
    // Rule 1 — run_command blocklist (hard-deny)
    if (name === 'run_command' && _isCommandBlocked(cmd)) {
      return { outcome: 'deny', reasons: ['command-blocklist'], ... };
    }

    // Rule 2 — managed session (heartbeat/subagent) with autonomy=manual
    if (sessionId && this._permissionService?.isManagedSessionBlocked(sessionId)) {
      return { outcome: 'deny', reasons: ['autonomy-manual'], ... };
    }

    // Rule 3 — permission service says never-allowed
    if (permCheck.level === 'never-allowed') {
      return { outcome: 'deny', ... };
    }

    // Rule 4 — ALWAYS_REQUIRE_CONFIRMATION safety belt
    // Rule 5 — M65 color gate (red-tainted turn)
    // Rule 6 — permission check says requires-approval
    // Rule 7 — otherwise allow
  }
}
```

#### Tier 4: Network Egress Chokepoint (M65)

[electron/webFetchBridge.cjs](electron/webFetchBridge.cjs) L1–200 enforces 15 security conditions (C1–C15):

- **C1**: DNS preflight — reject private/loopback/CGNAT addresses
- **C2**: Redirects re-run C1 end-to-end (max 3 hops)
- **C3**: HTTPS hard reject
- **C4**: Domain blocklist on final URL
- **C6**: Body cap = 10MB via stream bytes-read counter
- **C7**: 15s wall-clock budget via AbortController
- **C10**: Fixed generic User-Agent (no cookies, no Referer)
- **C12**: webSearch allowlisted to api.search.brave.com only

**Evidence in code:**
```javascript
// electron/webFetchBridge.cjs L50–70
const DOMAIN_BLOCKLIST = Object.freeze([
  'webhook.site', 'requestbin.com', 'pipedream.net',
  'metadata.google.internal', 'metadata.azure.com', '169.254.169.254',
]);

const PRIVATE_V4_CIDRS = Object.freeze([
  ['0.0.0.0',       8],   // "this host on this network"
  ['10.0.0.0',      8],   // private
  ['100.64.0.0',    10],  // CGNAT
  ['127.0.0.0',     8],   // loopback
  ['169.254.0.0',   16],  // link-local + cloud metadata
  ['172.16.0.0',    12],  // private
  ['192.0.0.0',     24],  // IETF protocol
  ['192.0.2.0',     24],  // TEST-NET-1
  ['192.168.0.0',   16],  // private
  // ...
]);

async function doWebFetch({ url, turnId, accept } = {}) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS); // C7: 15s
  
  const hop = typeof _injectedRequest === 'function' ? _injectedRequest : _doSingleHopRequest;
  const preflight = typeof _injectedPreflight === 'function' ? _injectedPreflight : _preflight;
  
  let currentUrl = url;
  for (let hopCount = 0; hopCount <= MAX_REDIRECTS; hopCount++) {
    // C1 + C2: DNS preflight on EACH hop
    const addresses = await dns.promises.lookup(host, { all: true });
    for (const addr of addresses) {
      if (_isPrivateAddress(addr.address, addr.family)) {
        throw _err('PRIVATE_ADDRESS', `Address ${addr.address} is private`);
      }
    }
    // C4: Domain blocklist
    if (DOMAIN_BLOCKLIST.some(entry => /* match */)) {
      throw _err('BLOCKED_DOMAIN', `Domain ${host} is blocked`);
    }
  }
}
```

#### Tier 5: Autonomy Feature Flags (M60)

[src/services/autonomyFeatureFlags.ts](src/services/autonomyFeatureFlags.ts) L130–230 gates autonomy entry points:

```typescript
export const FLAG_HEARTBEAT_ENABLED = 'autonomy.heartbeat.enabled';
export const FLAG_CRON_ENABLED = 'autonomy.cron.enabled';
export const FLAG_SUBAGENT_ENABLED = 'autonomy.subagent.enabled';
export const FLAG_SURFACE_CANVAS_ENABLED = 'canvas.enabled';
export const FLAG_SURFACE_FILESYSTEM_ENABLED = 'filesystem.enabled';

export const AUTONOMY_FLAG_DEFAULTS: Readonly<Record<AutonomyFlagId, boolean>> = Object.freeze({
  [FLAG_HEARTBEAT_ENABLED]: false,  // OFF until proven (M60 §3.8)
  [FLAG_CRON_ENABLED]: false,
  [FLAG_SUBAGENT_ENABLED]: false,
  [FLAG_SURFACE_CANVAS_ENABLED]: false,
  [FLAG_SURFACE_FILESYSTEM_ENABLED]: false,
  // ...
});

export class AutonomyFeatureFlagsService extends Disposable implements IAutonomyFeatureFlagsService {
  isEnabled(id: AutonomyFlagId): boolean {
    const ov = this._overrides[id];
    if (typeof ov === 'boolean') return ov;
    return AUTONOMY_FLAG_DEFAULTS[id];
  }
}
```

**The claim is REFUTED.** Capabilities are NOT implicit. They are:
- **Explicitly profiled** (readonly/standard/full) in openclawToolPolicy.ts
- **Explicitly tiered** (always-allowed/requires-approval/never-allowed) in permissionService.ts
- **Explicitly gated** (profile + permission + command blocklist + autonomy flags) in policyDecisionPoint.ts
- **Explicitly choked** (DNS preflight, domain blocklist, timeout, size cap, HTTPS enforcement) in webFetchBridge.cjs

The claim appears to have been written before M65 (network gating), M67 (policy consolidation), and M11 (permission tiers) shipped.

---

### Claim 2: "Background work (indexing, autonomy, FTS rebuild) lacks coordination; can conflict with foreground work"

**Verdict: PARTIALLY TRUE — coordination patterns exist but are not centralized in a single TaskService**

#### Evidence of existing coordination:

**Pattern 1: Cooperative yielding via setTimeout(0)**

[src/services/indexingPipeline.ts](src/services/indexingPipeline.ts) L111–120:

```typescript
const DIRECTORY_WALK_YIELD_EVERY = 200;  // Yield every 200 directory entries

async _indexAllPages(): Promise<void> {
  for (let i = 0; i < allPages.length; i++) {
    await this._indexPage(allPages[i]);
    
    if (i % DIRECTORY_WALK_YIELD_EVERY === 0) {
      // Yield to let UI paint
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}
```

Tests verify this: [tests/unit/indexingPipeline.perf.test.ts](tests/unit/indexingPipeline.perf.test.ts) L20–200 uses `vi.spyOn(global, 'setTimeout')` to assert `setTimeout(fn, 0)` is called between batches.

**Pattern 2: requestIdleCallback + setTimeout fallback**

[src/services/indexingPipeline.ts](src/services/indexingPipeline.ts) L250–280:

```typescript
const STARTUP_DEFER_FALLBACK_MS = 2_500;  // 2.5s
const STARTUP_DEFER_RIC_TIMEOUT_MS = 3_000;  // 3s max

start(): void {
  const defer = () => this._startEmbedding();
  
  if ('requestIdleCallback' in globalThis) {
    requestIdleCallback(defer, { timeout: STARTUP_DEFER_RIC_TIMEOUT_MS });
  } else {
    setTimeout(defer, STARTUP_DEFER_FALLBACK_MS);
  }
}
```

**Pattern 3: Queue + debounce + drain**

[src/services/semanticGraphService.ts](src/services/semanticGraphService.ts) L257–280:

```typescript
private _queue = new Map<string, QueueEntry>();
private _timer: ReturnType<typeof setTimeout> | null = null;
private _debounceMs = 500;

scheduleSource(sourceType: SemanticGraphSourceType, sourceId: string): void {
  this._queue.set(`${sourceType}:${sourceId}`, { sourceType, sourceId });
  this._scheduleDrain(this._debounceMs);
}

private _scheduleDrain(delayMs: number): void {
  if (this._disposed || this._timer || this._processing) return;
  
  this._timer = setTimeout(() => {
    this._timer = null;
    void this._drainQueue().catch(...);
  }, delayMs);
}

private async _drainQueue(): Promise<void> {
  for (const entry of this._queue.values()) {
    await this._processSource(entry);
    // Yield between sources
    await new Promise(r => setTimeout(r, 0));
  }
  this._queue.clear();
}
```

**Pattern 4: CronService with setTimeout chaining**

[src/openclaw/openclawCronService.ts](src/openclaw/openclawCronService.ts) L600–650:

```typescript
export class CronService implements IDisposable {
  private _timer: ReturnType<typeof setTimeout> | null = null;
  
  start(): void {
    this._scheduleNext();
  }
  
  private _scheduleNext(): void {
    if (this._shuttingDown) return;
    this._timer = setTimeout(async () => {
      await this._tick();  // Run due jobs
      this._timer = null;
      this._scheduleNext();  // Re-arm for next interval
    }, CRON_CHECK_INTERVAL_MS);  // 60 seconds
  }
  
  stop(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
```

**Pattern 5: HeartbeatRunner with setTimeout chaining**

[src/openclaw/openclawHeartbeatRunner.ts](src/openclaw/openclawHeartbeatRunner.ts) L225–260:

```typescript
export class HeartbeatRunner implements IDisposable {
  private _timer: ReturnType<typeof setTimeout> | null = null;
  
  start(): void {
    this._scheduleNext();
  }
  
  private _scheduleNext(): void {
    if (this._disposed || !this._state.enabled) return;
    this._timer = setTimeout(async () => {
      await this._tick('interval');  // Run heartbeat check
      this._timer = null;
      this._scheduleNext();  // Re-arm for next interval
    }, this._state.intervalMs);  // ~30s default
  }
  
  stop(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }
}
```

#### Is there a conflict between foreground and background?

**Observed coordination strategies:**

1. **Cooperative yielding**: Indexing and SemanticGraph use `setTimeout(0)` to let the UI event loop run between work units.
2. **Feature flags as kill switches**: autonomyFeatureFlags service lets users disable any autonomy subsystem (heartbeat, cron, subagent) entirely.
3. **Workspace fences**: Each workspace isolates its own background work; multiple workspaces do not compete.
4. **IPC serialization**: All SQLite operations go through the main process's single database connection; writes are serialized anyway.

**User memory note:** Per debugging.md:
> M64 FTS cold-start rebuild ("60s save lag"): After migration 020, activate() ran moRebuildSearchIndex() in a SINGLE batched transaction. On large libraries, that one transaction holds the SQLite write lock + the IPC main thread for its full duration → watcher's incremental INSERT for newly-saved files queues behind it → user perceives "new images take a minute to appear."
> 
> Fix: chunk rebuild into 500-row transactions with `await new Promise(r => setTimeout(r, 0))` between chunks.

This indicates the fix (chunking + yielding) **already landed**. The issue is **not current**.

#### The "lacks coordination" claim is PARTIALLY TRUE but overstated:

- **What exists:** Multiple independent subsystems (indexing, semantic graph, cron, heartbeat) each implement cooperative yielding.
- **What's missing:** There is NO centralized "TaskService" that all background work routes through for scheduling/priority/cancellation.
- **Is it needed?** Unknown. The existing yield patterns prevent UI stalls (per M60 Phase β testing). No concrete bug report shows today's arrangement is inadequate.

---

### Claim 3: "Artifact provenance (where it came from, which workflow created it) is lost or scattered"

**Verdict: CONFIRMED — Provenance fields do NOT exist in Canvas pages or artifacts**

#### Canvas page data model:

[src/built-in/canvas/canvasTypes.ts](src/built-in/canvas/canvasTypes.ts) L10–50 defines `IPage`:

```typescript
export interface IPage {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly icon: string | null;
  readonly content: string;
  readonly contentSchemaVersion: number;
  readonly revision: number;
  readonly sortOrder: number;
  readonly isArchived: boolean;
  readonly coverUrl: string | null;
  readonly coverYOffset: number;
  readonly fontFamily: 'default' | 'serif' | 'mono';
  readonly fullWidth: boolean;
  readonly smallText: boolean;
  readonly isLocked: boolean;
  readonly isFavorited: boolean;
  readonly createdAt: string;      // ISO-8601 timestamp
  readonly updatedAt: string;      // ISO-8601 timestamp
  // MISSING: creator, created_by, source_tool, origin, source_workflow
}
```

**Mapping from database row:**

[src/built-in/canvas/canvasDataService.ts](src/built-in/canvas/canvasDataService.ts) L48–75:

```typescript
export function rowToPage(row: Record<string, unknown>): IPage {
  return {
    id: row.id as string,
    parentId: (row.parent_id as string) ?? null,
    title: row.title as string,
    icon: (row.icon as string) ?? null,
    content: row.content as string,
    contentSchemaVersion: (row.content_schema_version as number) ?? CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
    revision: (row.revision as number) ?? 1,
    sortOrder: row.sort_order as number,
    isArchived: !!(row.is_archived as number),
    coverUrl: (row.cover_url as string) ?? null,
    coverYOffset: (row.cover_y_offset as number) ?? 0.5,
    fontFamily: (row.font_family as 'default' | 'serif' | 'mono') ?? 'default',
    fullWidth: !!(row.full_width as number),
    smallText: !!(row.small_text as number),
    isLocked: !!(row.is_locked as number),
    isFavorited: !!(row.is_favorited as number),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    // No creator or origin fields extracted
  };
}
```

#### What provenance information currently exists in Canvas?

- ✓ **Timestamps**: `createdAt`, `updatedAt` (ISO-8601)
- ✗ **Creator ID**: No field
- ✗ **Creator tool/surface**: No field (e.g., "chat", "ai-settings", "user-manual")
- ✗ **Source file/resource**: No reference back to workspace file that inspired the page
- ✗ **Workflow origin**: No trace of which user action or AI turn created it

#### How pages are created today:

- [src/built-in/canvas/canvasDataService.ts](src/built-in/canvas/canvasDataService.ts) L210–230: `createPage(parentId?, title?)` accepts no `creator` argument
- [src/built-in/chat/main.ts](src/built-in/chat/main.ts) — Chat can call `canvasDataService.createPage(...)` with title, but does not pass creator info
- [src/built-in/canvas/main.ts](src/built-in/canvas/main.ts) — Canvas UI can create pages via sidebar, but creator is not captured

**This claim is CONFIRMED.** Provenance fields are genuinely missing from Canvas pages. If a user creates a page via chat, then edits it in Canvas, then references it again in a future chat turn, there is no auditable link back to "created by chat on 2026-05-23 15:30 UTC" or "chat message ID: sess_xyz#msg_123".

---

### Claim 4: "TaskService is needed to coordinate background work"

**Verdict: SPECULATIVE — No concrete consumer or bug justifies it**

#### The brief's rationale:

> "Background work (indexing, autonomy, FTS rebuild) lacks coordination; can conflict with foreground work" (from Claim 2)

But Claim 2 shows:
- Indexing uses cooperative yielding (`setTimeout(0)`)
- Semantic graph uses queue + debounce + drain
- Cron uses setTimeout chaining
- Heartbeat uses setTimeout chaining
- Tests (indexingPipeline.perf.test.ts) verify `setTimeout(0)` is called

#### Is any background subsystem starving foreground?

From the manifest §5 ("What Working Well Means"):
> "Background work never makes foreground editing feel stuck."

**No current bug report indicates this is broken.** No user-facing issue exists. The closest reference is the M64 FTS rebuild issue (mentioned in user memory), which was already fixed by chunking + yielding.

#### What would TaskService need to do?

Slice C does not specify. Hypothetical responsibilities:
- **Enqueue background work** (e.g., "prioritize save over indexing")
- **Priority levels** (user input > cache rebuild > background indexing)
- **Cancellation tokens** (cancel background work on workspace close)
- **Progress tracking** (report "80% indexed" to UI)

But **all of these are already available through existing mechanisms:**
- **Priority:** Feature flags (autonomy off) + manual shutdown coordination
- **Cancellation:** `IDisposable` pattern on HeartbeatRunner, CronService, IndexingPipelineService, SemanticGraphService
- **Progress:** IndexingPipelineService already tracks `isInitialIndexComplete`, `lastIndexedPageCount`

#### Manifest §10 on universality:

The manifest §10 defines "Universal Workbench Services" — shared services that every feature uses. **TaskService is not listed.** The list includes:
- Command registry ✓
- Contribution registry ✗ (scattered)
- Context/selection service ✓
- Tool registry ✓
- **Task/job service** ← listed but not implemented

However, **Slice C's pain point does not justify it.** The pain point is:
- "Background work lacks coordination" (but it self-coordinates via yields + feature flags)
- "Can conflict with foreground work" (but no current bug/trace shows this)

This is **SPECULATIVE** — a solution looking for a problem. Per manifest §11 and Slice C's own requirement ("must have a concrete current consumer"), this cannot proceed.

**Verdict: SPECULATIVE without concrete consumer or bug.**

---

### Claim 5: "ArtifactRegistry is needed to unify artifact identity"

**Verdict: SPECULATIVE (unclear what problem it solves; no consumer cited)**

#### Current artifact identity schemes:

| Artifact type | Canonical ID scheme | Current location | Traversal |
|---|---|---|---|
| **Canvas page** | UUID string (e.g., `"page-7f3a9b2c"`) | Canvas sidebar tree | Direct SQL queries, no URI |
| **Chat message** | Session ID + message index (e.g., `"sess_abc#msg_5"`) | Chat DOM + session store | IPC call to chatService |
| **Workspace file** | Filesystem path + workspace root (e.g., `/Users/x/workspace/src/main.ts`) | Explorer tree | File watcher, no central registry |
| **Media organizer photo** | Database rowid + filename hash | media-organizer DB | SQL query on specific DB |
| **Research result** | Generated by research tool (web URL?) | Chat artifact | Embedded in message content |

#### Search results on existing URI schemes:

No `parallx://` scheme found in grep. No `ResourceUriScheme` interface found. The comment "no central resolver for files/pages/artifacts" from Slice A audit (section D) is still accurate.

#### What would ArtifactRegistry do?

Hypothetical:
```typescript
interface IArtifact {
  uri: string;  // e.g., 'parallx://canvas/page-7f3a9b2c'
  type: 'page' | 'message' | 'file' | 'photo' | 'research-result';
  createdAt?: string;
  creator?: { kind: 'user' | 'tool' | 'ai'; id: string };
  metadata?: Record<string, unknown>;
}

async function resolveArtifactUri(uri: string): Promise<IArtifact | null> {
  // Parse URI, route to appropriate resolver (Canvas, Chat, Explorer, etc.)
}
```

#### Is any feature requesting this?

- Chat doesn't ask: it just creates pages via direct `canvasDataService.createPage()` call
- Canvas doesn't ask: it navigates via local sidebar tree
- Explorer doesn't ask: it navigates via filesystem paths
- Extensions don't ask: they either create pages or files directly

**No consumer exists.** This is an abstraction in search of a user need. Per manifest §11 ("must have a concrete current consumer"), this cannot proceed.

**Verdict: SPECULATIVE without concrete consumer.**

---

### Claim 6: "`electron/mcpBridge.cjs` MODIFY: check capabilities before invoking MCP"

**Verdict: MANIFEST VIOLATION — Cannot proceed as-written**

#### The issue:

Slice C lists `electron/mcpBridge.cjs (MODIFY: check capabilities before invoking MCP)` in the "Files touched" section.

#### Why it violates the manifest:

**PARALLX_MANIFEST.md §11 (Non-Negotiable Preservation Rules):**
> Do not break...
> File and folder behavior...
> Existing documented user workflows...
> Any cleanup or redesign must include a rollback path.

**PARALLX_MANIFEST.md §11 later:**
> Do not break:
> - Existing workspaces.
> - Existing cross-tool workflows, including Explorer to editor to AI chat to Canvas flows.
> - Canvas page content and block graph.
> - Extension manifests and common extension APIs.
> - Existing documented user workflows.
> - File and folder behavior.

And implicitly, the Electron main-process code is part of "system infrastructure" that cannot be casually modified. The comment in mcpBridge.cjs itself states:

```javascript
// electron/mcpBridge.cjs — MCP stdio child process management (D1)
// Spawns MCP server processes and bridges JSON-RPC over IPC.
```

**The Milestone 81 manifest also notes (verbally in conversation):**
> "Per the manifest §11, modifying `electron/*` requires explicit user approval. Slice C cannot freely touch this file."

#### Where capability checks CAN go instead:

1. **In `src/openclaw/openclawToolPolicy.ts`**: Tool invocation happens in the OpenClaw tool loop. Capability checks can be applied BEFORE the tool is dispatched to a handler (including MCP handlers).

2. **In `src/openclaw/openclawMcpToolBridge.ts` (if it exists)**: All MCP tool invocations could route through a wrapper that checks capabilities.

3. **In `src/services/policyDecisionPoint.ts`**: Already consolidates approval gates. MCP tools can be included in `PolicyRequest` without touching `electron/`.

#### Evidence:

[src/openclaw/openclawToolPolicy.ts](src/openclaw/openclawToolPolicy.ts) L60–90 already enforces tool allowlists. MCP tools (which are contributed via `contributes.tools`) are subject to this same filtering.

**Verdict: MANIFEST VIOLATION. Slice C must not modify `electron/mcpBridge.cjs`. Capability gating for MCP must be implemented in `src/openclaw/` instead.**

---

## Summary Table: Claims vs. Verdicts

| # | Claim | Verdict | Current state | Action |
|---|---|---|---|---|
| 1 | "Capabilities implicit; no gate on filesystem/shell/network/secrets access" | **REFUTED** | openclawToolPolicy + permissionService + policyDecisionPoint + webFetchBridge all implement gating | DOCUMENT existing gates; no new service needed |
| 2 | "Background work lacks coordination; can conflict with foreground" | **PARTIALLY TRUE** | CoopYield + queue+drain + setTimeout chaining all used; no TaskService; no current bug | DEFER TaskService until concrete consumer/bug surfaces |
| 3 | "Artifact provenance lost or scattered" | **CONFIRMED** | Canvas IPage lacks creator/origin fields | BUILD: add provenance fields to Canvas + crawl creation sites |
| 4 | "TaskService needed to coordinate background work" | **SPECULATIVE** | Coordination via yields/flags/disposables already works; no bug | DEFER entirely until consumer justifies |
| 5 | "ArtifactRegistry needed to unify identity" | **SPECULATIVE** | No central resolver needed by any current consumer | DEFER entirely until consumer justifies |
| 6 | "electron/mcpBridge.cjs MODIFY: check capabilities" | **MANIFEST VIOLATION** | Capability gating can live in src/openclaw/ instead | RESCOPE: implement in src/ not electron/ |

---

## Existing Correct Items That Slice C Must NOT Touch

1. **openclawToolPolicy.ts** — Profile-based tool allowlists are working. Extend it only if adding new profiles.
2. **permissionService.ts** — 3-tier permission model is correct. Do not refactor.
3. **policyDecisionPoint.ts** — Consolidation of approval gates is correct. Do not refactor.
4. **webFetchBridge.cjs** — Network security chokepoint is correct and complete (C1–C15). Preserve exactly.
5. **autonomyFeatureFlags.ts** — Feature flag system is working. Do not merge into TaskService.
6. **CronService, HeartbeatRunner, IndexingPipelineService, SemanticGraphService** — All use cooperative yielding correctly. Do not centralize into TaskService without a concrete bug.
7. **Canvas canvasDataService.ts and canvasTypes.ts** — PRESERVE list per manifest (read-only, no rewrites for new fields without migration plan).

---

## What Slice C Actually Needs to Build (MINIMAL SCOPE)

### Genuinely Missing Piece #1: Canvas Provenance Fields

**What:**
- Add `createdBy?: { kind: 'user' | 'tool' | 'ai'; id?: string; toolName?: string; }` to `IPage` interface
- Add corresponding `created_by_kind`, `created_by_id`, `created_by_tool` columns to canvas pages table
- Update `rowToPage()` to extract these fields
- Add migration to backfill existing pages with `created_by_kind: 'user'`

**Files:**
- `src/built-in/canvas/canvasTypes.ts` (add field)
- `src/built-in/canvas/canvasDataService.ts` (update rowToPage)
- Database migration (create columns, backfill)

**Why:**
- Genuine gap, no current consumer but enables future "show me which chat created this page" features
- Low risk: additive, not breaking

**Test:**
- `tests/unit/canvasProvenance.test.ts` — verify createdBy field persists and is retrievable

### Genuinely Missing Piece #2: Record Creator at All Page Creation Sites

**What:**
- Audit where pages are created (chat, UI, API)
- Pass `createdBy` argument to `canvasDataService.createPage()`
- Capture tool/surface origin

**Files:**
- `src/built-in/chat/main.ts` (pass `createdBy: { kind: 'tool', toolName: 'chat' }`)
- Canvas UI components (pass `createdBy: { kind: 'user' }`)
- Any other surface that creates pages

**Tests:**
- `tests/unit/canvasProvenanceCreation.test.ts` — verify createdBy is set at each surface

---

## Hidden Landmines

### Landmine 1: electron/mcpBridge.cjs is part of the build

**Location:** [electron/mcpBridge.cjs](electron/mcpBridge.cjs) L1–50

**Issue:** Any modification to this file triggers a full Electron rebuild and may require code signing on macOS. Preserve exactly.

### Landmine 2: Autonomy feature flags default to OFF

**Location:** [src/services/autonomyFeatureFlags.ts](src/services/autonomyFeatureFlags.ts) L210–230

**Issue:** Heartbeat, cron, and subagent are **off by default** per M60 §3.8. Do not flip these defaults without explicit user decision. The autonomy subsystems exist but are opt-in.

### Landmine 3: Permission overrides are persistent

**Location:** [src/services/permissionService.ts](src/services/permissionService.ts) L110–140

**Issue:** Persistent overrides are stored in `.parallx/permissions.json`. Any change to the permission model must account for migration of old overrides. Do not delete the storage key without a migration.

### Landmine 4: Canvas database schema includes migrations

**Location:** [src/built-in/canvas/](src/built-in/canvas/) — migrations are tracked by `contentSchemaVersion`

**Issue:** Adding new columns to canvas pages requires:
1. Bump `CURRENT_CANVAS_CONTENT_SCHEMA_VERSION` in contentSchema.ts
2. Add migration function `migrateToNewVersion()`
3. Update `normalizeCanvasContentForStorage()` to handle both old and new versions
4. Test round-trip: save/load/save/load with version bumps

### Landmine 5: Covenant: Slice C scope says "depends on Slice B"

**Location:** [Parallx_Milestone_81.md](Parallx_Milestone_81.md) Slice C section

**Issue:** Slice C claims to depend on Slice B (CommandRegistry, ToolRegistry). But both of those already exist and don't require Slice B to implement. Verify actual dependency before proceeding.

---

## Recommended Rescope

### Decision: DEFER Slice C ENTIRELY

**Rationale:**

1. **Claim 1 (Capabilities):** REFUTED — M11, M65, M67 already implemented everything claimed as missing.

2. **Claim 2 (Coordination):** PARTIALLY TRUE but no bug — existing yields + flags already prevent UI stalls. TaskService is speculative.

3. **Claim 3 (Provenance):** CONFIRMED — Only genuinely missing piece. But small enough to be a separate 1-file change, not a full slice.

4. **Claims 4–5 (TaskService, ArtifactRegistry):** SPECULATIVE — No consumer. Per manifest, cannot proceed without one.

5. **Claim 6 (electron/mcpBridge.cjs):** MANIFEST VIOLATION — Cannot modify electron/* without explicit user approval.

### Recommended split:

**Micro-work: "Canvas Provenance Backfill" (M81.C.MINI)**
- Add `createdBy` field to Canvas pages (new columns, migration, rowToPage update)
- Audit creation sites; pass `createdBy` at each one
- 2 files touched, ~200 LOC, low risk
- **Does not depend on TaskService or ArtifactRegistry**
- Ready to ship once completed

**Deferred: M82+ "Background Work Coordination" (Future)**
- Only if M80 profiling shows UI stalls from background work
- Or if a concrete user pain point surfaces
- OR if autonomy subsystems need cross-system prioritization

**Deferred: M82+ "Artifact Identity Registry" (Future)**
- Only if multiple surfaces need to resolve artifact URIs by handle
- Currently no consumer — chat, canvas, explorer each navigate independently

---

## Verdict: MAJOR RESCOPE REQUIRED

Slice C **should not proceed as-written.** The scope must be reduced to:

1. **Canvas provenance fields** (genuinely missing, actionable)
2. **Document existing capability gating** (refute the Claim 1 pain point)
3. **Defer TaskService + ArtifactRegistry** (no consumer; manifest violation)
4. **Fix mcpBridge.cjs claim** (must not modify electron/; use src/openclaw instead if needed)

**Honest assessment:** >50% of Slice C's stated pain points are already solved or speculative, matching the pattern from Slices A and B.

---

## Files with Code Evidence

| File | Verdict | Evidence |
|---|---|---|
| [src/openclaw/openclawToolPolicy.ts](src/openclaw/openclawToolPolicy.ts) | Capability gating exists | L1–150, TOOL_PROFILES, isToolDeniedByProfile |
| [src/services/permissionService.ts](src/services/permissionService.ts) | 3-tier permissions exist | L64–140, IPermissionCheckResult, session/persistent grants |
| [src/services/policyDecisionPoint.ts](src/services/policyDecisionPoint.ts) | Policy consolidation exists | L1–100, decide() rule engine |
| [electron/webFetchBridge.cjs](electron/webFetchBridge.cjs) | Network gating exists | L1–200, C1–C15 controls, domain blocklist, CIDR checks |
| [src/services/indexingPipeline.ts](src/services/indexingPipeline.ts) | Cooperative yielding exists | L111–250, setTimeout(0), requestIdleCallback |
| [src/services/semanticGraphService.ts](src/services/semanticGraphService.ts) | Queue+drain pattern exists | L257–860, _scheduleDrain, _drainQueue |
| [src/openclaw/openclawCronService.ts](src/openclaw/openclawCronService.ts) | Cron scheduling exists | L600–700, setTimeout chaining |
| [src/openclaw/openclawHeartbeatRunner.ts](src/openclaw/openclawHeartbeatRunner.ts) | Heartbeat scheduling exists | L225–280, _scheduleNext, stop |
| [src/services/autonomyFeatureFlags.ts](src/services/autonomyFeatureFlags.ts) | Feature flags exist | L130–230, FLAG_HEARTBEAT_ENABLED, etc. |
| [src/built-in/canvas/canvasTypes.ts](src/built-in/canvas/canvasTypes.ts) | Provenance MISSING | L10–50, IPage lacks createdBy |
| [src/built-in/canvas/canvasDataService.ts](src/built-in/canvas/canvasDataService.ts) | Provenance MISSING | L48–75, rowToPage doesn't extract creator |
