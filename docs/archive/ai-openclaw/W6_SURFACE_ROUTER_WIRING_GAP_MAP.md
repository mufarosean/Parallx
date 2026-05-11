# W6 — SurfaceRouter Wiring: Gap Map

**Domain:** W6 (M58)
**Source audit:** `W6_SURFACE_ROUTER_WIRING_AUDIT.md`
**Scope:** Runtime wiring only — zero changes to the audit-closed
`openclawSurfacePlugin.ts`.

---

## 1. File-level change plan

### 1.1 New files (additive — no core-file approval needed)

| File | Purpose | Upstream tie |
|------|---------|--------------|
| `src/services/surfaceRouterService.ts` | `ISurfaceRouterService` interface + `SurfaceRouterService` class wrapping `SurfaceRouter`; origin-tag helpers (`SURFACE_ORIGIN_KEY`, `sendWithOrigin`, `getDeliveriesByOrigin`) | Channel registry facade; channel outbound metadata convention |
| `src/workbench/surfaces/notificationSurface.ts` | `NotificationsSurfacePlugin` → `INotificationService.info/warn/error` | `ChannelPlugin.outbound` (notification channel) |
| `src/workbench/surfaces/statusSurface.ts` | `StatusSurfacePlugin` → single `StatusBarEntry` accessor | `ChannelPlugin.outbound` (status channel) |
| `src/services/surfaces/filesystemSurface.ts` | `FilesystemSurfacePlugin` → `IFileService.writeFile`, path sandbox | `ChannelPlugin.outbound` (file/disk channel) |
| `src/built-in/chat/surfaces/chatSurface.ts` | `ChatSurfacePlugin` — trace-only logger (no assistant-append API available in M58) | `ChannelPlugin.outbound` (chat/default channel) |
| `src/built-in/canvas/surfaces/canvasSurface.ts` | `CanvasSurfacePlugin` — read-only stub (all capabilities=false → permanent-error on any write) | Canvas channel (deferred write) |
| `src/built-in/chat/tools/surfaceTools.ts` | `createSurfaceSendTool`, `createSurfaceListTool` | `message-tool` send + channel registry list |
| `tests/unit/surfaceRouterWiring.test.ts` | 18 integration tests: service facade, origin round-trip, loop-guard filter, tool handlers, approval policy helper | — |

### 1.2 Modified files (core — pre-approved in M58 plan §6)

| File | Change | Why |
|------|--------|-----|
| `src/services/serviceTypes.ts` | Add `ISurfaceRouterService` DI identifier (`createServiceIdentifier<ISurfaceRouterServiceType>`) | W6.2 — DI binding site |
| `src/workbench/workbench.ts` | Phase 5: instantiate `SurfaceRouterService`, register Notifications + Status plugins, bind to DI | W6.1/W6.4 |
| `src/built-in/chat/main.ts` | Resolve `ISurfaceRouterService` from DI; register Chat + Filesystem + Canvas plugins; thread router into `registerBuiltInTools` | W6.3/W6.4 |
| `src/built-in/chat/tools/builtInTools.ts` | Accept optional `surfaceRouter` arg; register `surface_send` + `surface_list` | W6.5 |
| `src/openclaw/openclawToolPolicy.ts` | Add `APPROVAL_REQUIRED_SURFACES` set + `surfaceSendRequiresApproval(id)` helper | W6.6 |

### 1.3 Modified test files (gate compliance coverage)

| File | Change | Why |
|------|--------|-----|
| `tests/unit/chatGateCompliance.test.ts` | Add `tools/surfaceTools.ts` + `surfaces/chatSurface.ts` to `FOLDER_RULES` | Every new chat `.ts` file must be tracked |
| `tests/unit/gateCompliance.test.ts` | Add `surfaces/canvasSurface.ts` to canvas `EXEMPT_FILES` | Canvas-scope coverage |
| `tests/unit/builtInTools.test.ts` | Update tool-count expectation `22 → 24` + add `surface_send` / `surface_list` to the sorted-names list | Tool count changed |

---

## 2. Design decisions documented

### 2.1 Approval posture (W6.6)

`surface_send` ships as `permissionLevel: 'requires-approval'` uniformly.
Per-surface differential (filesystem/canvas gated, chat/notifications/status
free) is *expressed* through `surfaceSendRequiresApproval(id)` and surfaced
on tool results as `approvalRequiredForSurface`, but the **tool-level gate
is uniform** this milestone. Rationale: `IChatTool.permissionLevel` is
per-name, not per-argument, and the AI-settings permission editor needed
for per-surface loosening is a W2+ deliverable (plan §5 W6 footnote:
"ship with a conservative permission map; users can loosen via AI settings
later — that's W2+ work, not W6").

### 2.2 Feedback-loop guard (W6.7)

Origin-tag scheme:

1. All agent-initiated sends flow through
   `sendWithOrigin({...}, ORIGIN_AGENT)`, which writes `_origin: 'agent'`
   into delivery metadata.
2. Heartbeat / cron / subagent will use their own origin constants
   (`ORIGIN_HEARTBEAT`, `ORIGIN_CRON`, `ORIGIN_SUBAGENT`) when W2/W4/W5
   wire in.
3. A consumer that shouldn't react to its own echoes calls
   `router.getDeliveriesByOrigin(ORIGIN_HEARTBEAT)` (or reads
   `getDeliveryOrigin(d)` per event) and filters them out.

This gives the W2 heartbeat everything it needs on day one: a tag to stamp
on outbound ticks and a query to skip them on the way back in.
Implementation is covered by `surfaceRouterWiring.test.ts` tests
*"sendWithOrigin stamps the origin tag"*, *"preserves caller-supplied
metadata while still stamping the origin"*, and *"feedback-loop guard:
getDeliveriesByOrigin filters delivery history"*.

### 2.3 Plugin ownership split

- **Workbench Phase 5** — router + Notifications + Status (services live there).
- **Chat activation** — Chat + Filesystem + Canvas (services live there).

This avoids forcing `IChatService` / `IFileService` into `workbench.ts`'s
already-busy `_initializeToolLifecycle` just to construct plugins.

### 2.4 Canvas scope (deferred to M59)

`CanvasSurfacePlugin` has every `supports*` capability set to `false`. The
router's existing `isContentSupported` check in `SurfaceRouter.send` rejects
any write as `"Surface canvas does not support content type: X"`, which
`isPermanentDeliveryError` classifies as permanent → zero retries. The
surface id remains addressable for introspection (`surface_list` reports
it with all-false capabilities).

Real canvas writes (append-to-page, create-child) require a canvas
data-service write API that doesn't exist today. M59 backlog.

### 2.5 Chat surface scope

`ChatSurfacePlugin` is a trace-only logger for M58. `IChatService` has no
assistant-append-without-turn API. A full chat-append path is a W5 concern
(sub-agent quoted card in parent chat) and will likely introduce its own
primitive — at which point this plugin gets upgraded or superseded.

---

## 3. Out-of-scope items (carry to M59 / W2)

- Real canvas writes (append-to-page / create-child)
- Chat surface assistant-append (tied to W5 sub-agent card)
- Per-surface AI-settings approval editor (W2+ AI settings work)
- Telemetry / log surface plugin (plan §10)
- Full heartbeat origin-skip enforcement (origin *plumbing* ships W6;
  consumer *enforcement* ships W2)
