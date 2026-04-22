# W6 — SurfaceRouter Wiring: Domain Tracker

**Milestone:** M58 (Wake Parallx)
**Domain:** W6 — Multi-Surface Output
**Branch:** `milestone-58`
**Status:** CLOSED ✅

---

## Key files

| File | Role |
|------|------|
| `src/openclaw/openclawSurfacePlugin.ts` | `SurfaceRouter` + `ISurfacePlugin` (audit-closed, unchanged) |
| `src/services/surfaceRouterService.ts` | `ISurfaceRouterService` facade + origin-tag helpers (new) |
| `src/services/serviceTypes.ts` | DI identifier `ISurfaceRouterService` |
| `src/workbench/workbench.ts` | Phase 5 instantiation + Notifications/Status registration |
| `src/workbench/surfaces/notificationSurface.ts` | NotificationsSurfacePlugin |
| `src/workbench/surfaces/statusSurface.ts` | StatusSurfacePlugin |
| `src/services/surfaces/filesystemSurface.ts` | FilesystemSurfacePlugin |
| `src/built-in/chat/surfaces/chatSurface.ts` | ChatSurfacePlugin (trace logger, M58 scope) |
| `src/built-in/canvas/surfaces/canvasSurface.ts` | CanvasSurfacePlugin (read-only stub, M58 scope) |
| `src/built-in/chat/main.ts` | Chat activation: register Chat/Filesystem/Canvas, thread router to built-in tools |
| `src/built-in/chat/tools/surfaceTools.ts` | `surface_send` + `surface_list` tools |
| `src/built-in/chat/tools/builtInTools.ts` | Threads router to surface tools |
| `src/openclaw/openclawToolPolicy.ts` | `surfaceSendRequiresApproval(id)` helper |
| `tests/unit/surfaceRouterWiring.test.ts` | 18 integration tests (new) |

## Upstream references

| Upstream | Parallx mapping |
|----------|-----------------|
| `src/channels/ChannelPlugin` (setup/config/security/messaging/outbound) | `ISurfacePlugin` (id/capabilities/isAvailable/deliver/dispose) |
| Channel registry pattern | `SurfaceRouter` + `ISurfaceRouterService` |
| Per-channel media filtering | `ISurfaceCapabilities.supports*` |
| Outbound retry + exponential backoff + permanent-error | `_deliverWithRetry` / `DELIVERY_BACKOFF_MS` / `isPermanentDeliveryError` (ALIGNED since M46) |
| Channel origin metadata | `SURFACE_ORIGIN_KEY` + `sendWithOrigin` + `getDeliveriesByOrigin` |
| message-tool | `surface_send` |
| Channel registry inspection | `surface_list` |

---

## Scorecard

| # | Capability | Iter 0 | Iter 1 | Final |
|---|-----------|--------|--------|-------|
| W6.1 | `SurfaceRouter` instantiated as DI singleton | MISSING | ALIGNED | ✅ |
| W6.2 | `ISurfaceRouterService` registered in `serviceTypes.ts` | MISSING | ALIGNED | ✅ |
| W6.3a | ChatSurfacePlugin implemented + registered (trace-only, M58 scope) | MISSING | ALIGNED | ✅ |
| W6.3b | CanvasSurfacePlugin read-only stub registered (write path deferred to M59) | MISSING | ALIGNED | ✅ |
| W6.3c | FilesystemSurfacePlugin → `IFileService.writeFile` + sandbox | MISSING | ALIGNED | ✅ |
| W6.3d | NotificationsSurfacePlugin → `INotificationService` | MISSING | ALIGNED | ✅ |
| W6.3e | StatusSurfacePlugin → `StatusBarPart.addEntry` | MISSING | ALIGNED | ✅ |
| W6.4 | Plugins registered in Phase 5 / chat activation | MISSING | ALIGNED | ✅ |
| W6.5 | `surface_send` + `surface_list` defined + registered | MISSING | ALIGNED | ✅ |
| W6.6 | Approval gate on filesystem/canvas writes (conservative uniform posture) | MISSING | ALIGNED | ✅ |
| W6.7 | Feedback-loop guard — origin tag round-trips into metadata, consumable for W2 | MISSING | ALIGNED | ✅ |
| W6.8 | Integration tests: plugin reg, retry/backoff, loop-break, approval | MISSING | ALIGNED (18 new tests) | ✅ |
| W6.9 | UX: status bar visible, notification style unchanged, no unapproved writes | PENDING | ALIGNED | ✅ |
| W6.10 | Gate-compliance tests updated for new files | MISSING | ALIGNED | ✅ |

**Final: 14/14 ALIGNED** (W6.3a chat surface and W6.3b canvas flagged as
scoped-read / trace-only this milestone; write paths tracked in M59 backlog.)

---

## Iteration 1

### Audit summary
See `W6_SURFACE_ROUTER_WIRING_AUDIT.md`. No drift vs upstream since `e635cedb`;
M46 D6 parity holds (13/13 still ALIGNED). All 14 wiring capabilities
non-ALIGNED at start.

### Gap map summary
See `W6_SURFACE_ROUTER_WIRING_GAP_MAP.md`. 8 new files + 5 core-file edits
(all pre-approved in M58 plan §6) + 3 gate-compliance test updates. Zero
changes to the audit-closed `openclawSurfacePlugin.ts`.

### Changes applied

| File | Change |
|------|--------|
| [src/services/surfaceRouterService.ts](../../../src/services/surfaceRouterService.ts) | **New** — `SurfaceRouterService` + `ISurfaceRouterService` + `SURFACE_ORIGIN_KEY` + `sendWithOrigin` + `getDeliveriesByOrigin` + origin constants |
| [src/services/serviceTypes.ts](../../../src/services/serviceTypes.ts) | Added `ISurfaceRouterService` DI identifier |
| [src/workbench/workbench.ts](../../../src/workbench/workbench.ts) | Phase 5: instantiate `SurfaceRouterService`, register `NotificationsSurfacePlugin` + `StatusSurfacePlugin`, bind to DI |
| [src/workbench/surfaces/notificationSurface.ts](../../../src/workbench/surfaces/notificationSurface.ts) | **New** — routes to `INotificationService.info/warn/error` by metadata.severity |
| [src/workbench/surfaces/statusSurface.ts](../../../src/workbench/surfaces/statusSurface.ts) | **New** — owns a single `StatusBarEntryAccessor`, updates on every delivery |
| [src/services/surfaces/filesystemSurface.ts](../../../src/services/surfaces/filesystemSurface.ts) | **New** — `IFileService.writeFile`, path sandbox (rel-only by default, no traversal) |
| [src/built-in/chat/surfaces/chatSurface.ts](../../../src/built-in/chat/surfaces/chatSurface.ts) | **New** — trace-only logger (IChatService has no assistant-append API today; W5 upgrades) |
| [src/built-in/canvas/surfaces/canvasSurface.ts](../../../src/built-in/canvas/surfaces/canvasSurface.ts) | **New** — read-only stub; all capabilities=false → router permanent-errors writes |
| [src/built-in/chat/tools/surfaceTools.ts](../../../src/built-in/chat/tools/surfaceTools.ts) | **New** — `surface_send` (requires-approval) + `surface_list` (always-allowed); sends stamped `origin=agent` |
| [src/built-in/chat/tools/builtInTools.ts](../../../src/built-in/chat/tools/builtInTools.ts) | Registers surface tools; threads optional `surfaceRouter` arg |
| [src/built-in/chat/main.ts](../../../src/built-in/chat/main.ts) | Resolves `ISurfaceRouterService` from DI; registers Chat + Filesystem + Canvas plugins in chat activation |
| [src/openclaw/openclawToolPolicy.ts](../../../src/openclaw/openclawToolPolicy.ts) | Added `APPROVAL_REQUIRED_SURFACES` + `surfaceSendRequiresApproval(id)` helper |
| [tests/unit/surfaceRouterWiring.test.ts](../../../tests/unit/surfaceRouterWiring.test.ts) | **New** — 18 tests: service registration, origin round-trip, history filter, tool handlers, approval posture, canvas permanent-error |
| [tests/unit/chatGateCompliance.test.ts](../../../tests/unit/chatGateCompliance.test.ts) | Registered `tools/surfaceTools.ts` + `surfaces/chatSurface.ts` |
| [tests/unit/gateCompliance.test.ts](../../../tests/unit/gateCompliance.test.ts) | Registered `surfaces/canvasSurface.ts` in canvas EXEMPT_FILES |
| [tests/unit/builtInTools.test.ts](../../../tests/unit/builtInTools.test.ts) | Tool-count expectation 22 → 24; added `surface_send`/`surface_list` to name list |

### Verification

- **Targeted**: `npx vitest run tests/unit/surfaceRouterWiring.test.ts
  tests/unit/openclawSurfacePlugin.test.ts` → 51/51 passed (18 new + 33
  pre-existing).
- **Full suite**: `npx vitest run` → **130 files, 2341 tests, 0 failures**
  (duration ~6.0 s).
- **Type check**: `npx tsc --noEmit` → clean, 0 errors.
- **Pre-existing 33 `openclawSurfacePlugin.test.ts` tests**: all still green
  (the module itself was not touched).

### UX Guardian pass

- **Status bar**: new entry `parallx.surface.status` added on Phase 5 with
  empty text (invisible while idle). A W2 heartbeat tick would update it via
  `surface_send({surfaceId:'status',...})`. No visible regression in the
  status-bar rendering; contribution API is unchanged.
- **Notifications**: deliveries route through the existing
  `INotificationService.info/warn/error` — same DOM, same CSS, same
  `parallx-notifications-container`. Severity routed from `metadata.severity`
  ∈ `info|warn|error` (default info). No new styling.
- **Approval flow**: `surface_send` is `permissionLevel: 'requires-approval'`,
  so every agent invocation surfaces through the existing confirmation UI
  (same path as `write_file` / `run_command`). `surface_list` is
  always-allowed (read-only). No new approval dialog introduced.
- **Filesystem writes**: `FilesystemSurfacePlugin` respects the existing
  `IFileService` boundary checker (.parallxignore / workspace sandbox) via
  `writeFile`. Rejects traversal, rejects absolute paths unless
  explicitly allowed in delivery metadata.
- **Canvas**: read-only stub — any agent attempt to write hits a permanent
  "does not support" error immediately; no partial writes, no retries.
- **Chat**: trace-only logger. Does not alter transcript rendering at all.
- **No new settings, commands, keybindings, menus, or DOM surfaces**
  contributed by W6.

### Feedback-loop guard summary

- Metadata key: `SURFACE_ORIGIN_KEY = '_origin'` (stamped by
  `sendWithOrigin`).
- Origin constants: `ORIGIN_USER / ORIGIN_AGENT / ORIGIN_HEARTBEAT /
  ORIGIN_CRON / ORIGIN_SUBAGENT`.
- All tool-initiated `surface_send` calls stamp `ORIGIN_AGENT`.
- Consumers skip their own echoes via
  `router.getDeliveriesByOrigin(ORIGIN_HEARTBEAT)` or by reading
  `getDeliveryOrigin(delivery)` on history entries.
- Covered by 3 dedicated integration tests in
  `surfaceRouterWiring.test.ts`.

### Deferred items for W2 (heartbeat handoff)

- W2's `HeartbeatRunner` should:
  1. Call `surfaceRouter.sendWithOrigin({surfaceId:'status', content:'…'},
     ORIGIN_HEARTBEAT)` for its tick display.
  2. When reacting to system events, filter
     `surfaceRouter.getDeliveriesByOrigin(ORIGIN_HEARTBEAT)` out of any
     event-history consulted during scheduling decisions.
- W2 may want to loosen the `surface_send` approval gate for the
  `status`/`notifications` surfaces via an AI-settings permission-map
  update. The per-surface helper `surfaceSendRequiresApproval(id)` already
  returns the right answer — only the tool-level gate needs to become
  argument-aware. Suggested path: split `surface_send` into
  `surface_notify` (always-allowed, chat/notifications/status) and
  `surface_write` (requires-approval, filesystem/canvas) at that time.
- The chat surface upgrade (real assistant-append) lands in W5 along with
  the sub-agent quoted-card path.
- Canvas write upgrade is on the M59 backlog (plan §10).

### Decision

All 14 wiring capabilities ALIGNED. Full test suite (2341/2341) + type
check green. No regressions in UX surfaces. W6 **CLOSED**.
