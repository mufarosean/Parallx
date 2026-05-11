# W6 — SurfaceRouter Wiring: Audit

**Date:** 2026-04-22
**Domain:** W6 (M58)
**Module:** `src/openclaw/openclawSurfacePlugin.ts` (audit-closed — zero production imports)
**Upstream target:** `github.com/openclaw/openclaw` — `src/channels/ChannelPlugin` + message-tool
**M46 baseline:** `docs/archive/audits/D6_MULTI_SURFACE_OUTPUT_TRACKER.md` — 13/13 ALIGNED (commit `e635cedb`)
**Auditor:** AI Parity Auditor (re-audit driven by Parity Orchestrator)

---

## 1. Re-audit vs current upstream head

Upstream's multi-channel plumbing (`src/channels/`) is unchanged in shape:
`ChannelPlugin` still exposes `setup() / config() / security / messaging /
outbound`, and `message-tool` still reaches any connected platform via the
channel registry with per-delivery ack/fail tracking.

### What did / did not change upstream since `e635cedb`

| # | Change upstream | Applies to Parallx? | Disposition |
|---|-----------------|---------------------|-------------|
| 1 | `ChannelPlugin` 5-hook shape (`setup/config/security/messaging/outbound`) | Yes — identical pattern | **Still aligned** — `ISurfacePlugin` collapses the same responsibilities into `id + capabilities + isAvailable + deliver + dispose` |
| 2 | Media filtering per channel | Yes | **Already ALIGNED in D6.5** — `ISurfaceCapabilities` supportsText/Structured/Binary/Actions |
| 3 | Exponential backoff on delivery retry | Yes | **Already ALIGNED in D6.4** — `DELIVERY_BACKOFF_MS = [100,500,2000]`, desktop-scaled |
| 4 | Permanent-error short-circuit (`is*` classifiers) | Yes | **Already ALIGNED in D6.4** — `isPermanentDeliveryError` |
| 5 | Multi-channel typing indicators (Telegram/Slack typing dots) | No — desktop has no channel typing | **Out of scope** (M58 §3 scope boundary) |
| 6 | Remote / server announce delivery | No — single-user local | **Out of scope** |
| 7 | New telemetry / log channels added upstream | Yes — new channel, but explicitly on the **M59 backlog** (M58 §10) | **Deferred to M59** |
| 8 | Canvas / workspace-write channel shape | Upstream has richer canvas write hooks; Parallx has only `getCanvasPageTree` read API | **Substrate gap — scoped** (see §2.4) |

### Conclusion

No upstream change invalidates the D6 architecture. `SurfaceRouter` +
`ISurfacePlugin` + capability filtering + backoff + permanent-error handling
all remain the correct adaptation. **M46's 13/13 ALIGNED status holds.** The
audit-closed module is still the correct foundation; W6 is **runtime wiring
only**.

---

## 2. Substrate reality check

Before wiring, the auditor grepped / read each integration point the plan
requires. Outcome:

| Substrate | Status | Location |
|-----------|--------|----------|
| Notification/toast service | ✅ exists | `INotificationService.notify/info/warn/error` — `src/services/serviceTypes.ts:822`, impl `src/api/notificationService.ts:55` |
| Status-bar part | ✅ exists | `StatusBarPart.addEntry(StatusBarEntry) → StatusBarEntryAccessor` — `src/parts/statusBarPart.ts:113` |
| Workspace `fs.writeFile` | ✅ exists | `IFileService.writeFile(uri, content)` — `src/services/serviceTypes.ts:1143` |
| Workspace service (folder resolution) | ✅ exists | `IWorkspaceService.folders[0]?.uri.fsPath` |
| ChatService assistant-append | ⚠️ absent | `IChatService` (`src/services/chatTypes.ts:1023`) has no `sendResponse` / `postMessage` — only `sendRequest`, `queueRequest`. No way to append an assistant bubble without running a turn. |
| Canvas write API | ⚠️ absent | Only `parallx.workspace.getCanvasPageTree` (read-only). No append / create-child hook. |
| Built-in tool registration | ✅ exists | `ILanguageModelToolsService.registerTool` + `registerBuiltInTools(...)` |

### 2.4 Canvas scope call

Per the plan ("Choose the path with the least core change"), the
CanvasSurfacePlugin ships as a **read-only stub** with all content-type
capabilities set to `false`. The router's existing
`isContentSupported` gate will permanent-error any write before ever calling
`deliver()`. The surface id remains addressable (for `surface_list`
introspection and future wiring) but pretends to nothing. A real canvas
write path is deferred to M59 (plan §10: "Canvas surface write upgrade").

### 2.5 Chat scope call

With no `IChatService.sendResponse`-equivalent, `ChatSurfacePlugin` for M58
is a **trace-only logger** that returns success. The richer path — appending
a sub-agent quoted-card into the parent chat — is W5's problem and will
introduce its own chat-append primitive (documented as a scope note in the
W6 tracker, picked up by W5's gap map).

---

## 3. Runtime wiring capability scorecard

| # | Capability | Status | Evidence |
|---|-----------|--------|----------|
| W6.1 | `SurfaceRouter` instantiated as a DI singleton | **MISSING** | `grep -r "new SurfaceRouter" src/` → zero hits |
| W6.2 | `ISurfaceRouterService` registered in `serviceTypes.ts` | **MISSING** | No identifier exists |
| W6.3a | ChatSurfacePlugin implemented + registered | **MISSING** | — |
| W6.3b | CanvasSurfacePlugin (read-only / deferred write) implemented + registered | **MISSING** | — |
| W6.3c | FilesystemSurfacePlugin → `IFileService.writeFile` | **MISSING** | — |
| W6.3d | NotificationsSurfacePlugin → `INotificationService.info/warn/error` | **MISSING** | — |
| W6.3e | StatusSurfacePlugin → `StatusBarPart.addEntry` | **MISSING** | — |
| W6.4 | Plugins registered during `_initializeToolLifecycle` (workbench Phase 5) | **MISSING** | — |
| W6.5 | `surface_send` + `surface_list` tools defined and registered via `registerBuiltInTools` | **MISSING** | — |
| W6.6 | Approval gate on filesystem/canvas surface writes | **MISSING** | `openclawToolPolicy.ts` has no surface-aware helper |
| W6.7 | Feedback-loop guard — origin tag round-trips into delivery metadata so heartbeat (W2) can skip its own echoes | **MISSING** | No origin plumbing in `SurfaceRouter` or any wrapper |
| W6.8 | Integration tests: plugin reg, retry/backoff, feedback-loop break, approval gate | **MISSING** | 33 existing tests cover the class; no wiring tests |
| W6.9 | UX: status bar visible, notifications use existing toast style, no unapproved writes | **TO VERIFY** | UX Guardian pass required |
| W6.10 | Gate-compliance tests updated for new files | **MISSING** | Gate tests will fail when new files are added without listing |

### Summary

- Module-internal parity (from M46): **13/13 ALIGNED** — unchanged against current upstream.
- **Wiring parity**: 0/10 (pre-work) — what W6 implements below.

---

## 4. Findings

### F-W6.A — `SurfaceRouter` is a dead symbol

`src/openclaw/openclawSurfacePlugin.ts:151` exports the class. `grep`
across `src/` finds only the module and its test file. Zero production
instantiation, zero service registration.

### F-W6.B — Upstream's `origin/channel-id` metadata has no Parallx analog yet

Upstream message-tool stamps an origin identifier on every outbound so a
consumer (the heartbeat analog) can distinguish its own writes from genuine
new events. Parallx's `ISurfaceDelivery.metadata` is freely-shaped but
carries no convention. W6 introduces `SURFACE_ORIGIN_KEY = '_origin'` and
exposes `sendWithOrigin(params, origin)` on the service so W2 can consume it
the day it lands.

### F-W6.C — Tool-level approval is per-tool-name, not per-argument

`IChatTool.permissionLevel` cannot differ by argument value (e.g.
per-surfaceId). Two honest options:

1. Split `surface_send` by target family (free vs approval-required).
2. Keep one tool at `requires-approval` uniformly.

The plan explicitly says "ship with a conservative permission map; users
can loosen via AI settings later (that's W2+ work, not W6)". W6 chooses
**option 2** — uniform approval on `surface_send`. The per-surface policy
(`surfaceSendRequiresApproval(id)`) ships as a helper + metadata field on
the tool result so the W2+ AI-settings editor has the hook ready.

### F-W6.D — Plugin ownership split

Notifications + Status plugins need workbench-scoped services
(`INotificationService`, `StatusBarPart`) that exist before chat activates.
Chat / Filesystem / Canvas plugins need services bound during chat
activation (`IChatService`, `fsAccessor`, canvas db). Cleanest split:

- **Workbench (Phase 5)**: create router, register Notifications + Status.
- **Chat extension (`built-in/chat/main.ts`)**: read router from DI,
  register Chat + Filesystem + Canvas.

No additional core change needed — both sites already own their required
services.

---

## 5. Constraints observed

- **M41-P1 Framework, not fixes** — wiring adds zero heuristics; the
  existing retry + permanent-error machinery is reused.
- **M41-P4 Not installing OpenClaw** — only the channel-plugin *pattern*
  is adapted; upstream's Telegram/Slack/Discord plumbing is out of scope.
- **M41-P6 Don't invent** — origin-tag convention maps directly to
  upstream's channel-origin metadata.
- **No anti-patterns triggered** — no output repair, no pre-classification,
  no per-test code paths.

---

## 6. Upstream citations

| Upstream | Parallx mapping |
|----------|-----------------|
| `src/channels/ChannelPlugin` (setup/config/security/messaging/outbound) | `ISurfacePlugin` (id/capabilities/isAvailable/deliver/dispose) |
| Per-channel media filtering | `ISurfaceCapabilities.supports*` |
| Outbound retry + exponential backoff | `_deliverWithRetry` + `DELIVERY_BACKOFF_MS` |
| Permanent error classifier | `isPermanentDeliveryError` |
| Channel origin on outbound metadata | `SURFACE_ORIGIN_KEY` + `sendWithOrigin` + `getDeliveriesByOrigin` |
| message-tool routing by channelId | `surface_send({surfaceId,...})` |
| Channel registry inspection | `surface_list` |
