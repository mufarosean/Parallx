# D6 Multi-Surface Output — Parity Audit

**Date:** 2026-03-28
**Auditor:** AI Parity Auditor (Claude Opus 4.6)
**Domain:** D6 — Multi-Surface Output
**Parallx file:** `src/openclaw/openclawSurfacePlugin.ts`
**Test file:** `tests/unit/openclawSurfacePlugin.test.ts`
**Upstream reference:** `src/channels/plugins/types.plugin.ts` (ChannelPlugin), `src/infra/outbound/deliver.ts` (delivery pipeline), `src/infra/outbound/delivery-queue-storage.ts` + `delivery-queue-recovery.ts` (queue management)

---

## Summary

| Metric | Count |
|--------|-------|
| Capabilities audited | 13 |
| ALIGNED | 11 |
| MISALIGNED | 1 |
| HEURISTIC | 0 |
| MISSING | 0 |
| N/A | 1 |

**Overall assessment:** This is the strongest Parallx adaptation of any OpenClaw domain audited. The multi-surface output plugin is a well-documented, intentional adaptation of upstream's multi-channel messaging architecture. It correctly maps the core patterns (plugin interface, registration, routing, delivery, retry, capabilities) to a desktop-workbench context. One MISALIGNED finding (retry lacks exponential backoff and error classification). Zero heuristic patchwork. Zero anti-patterns.

**Key context:** This domain is explicitly the most divergent from upstream — OpenClaw has multi-channel messaging (Telegram, Discord, Slack, etc.) while Parallx maps to multi-surface output (canvas, filesystem, notifications, status). The OPENCLAW_REFERENCE_SOURCE_MAP.md §1.2 explicitly lists "Multi-channel messaging gateway" and "Channel plugin SDK" as things Parallx does NOT need. This adaptation is a Parallx-specific design that follows upstream structural patterns without reproducing the gateway-specific details.

---

## Per-Capability Findings

### D6.1: ISurfacePlugin Interface
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 107-120)
- **Upstream reference**: `src/channels/plugins/types.plugin.ts`, `ChannelPlugin` type (lines 78-106)
- **Divergence**: Upstream `ChannelPlugin` has ~30 optional adapters (security, pairing, gateway, auth, setup, etc.). Parallx `ISurfacePlugin` has 4 members: `id`, `capabilities`, `isAvailable()`, `deliver()`, plus `IDisposable`.
- **Evidence**: The upstream adapters are channel-specific concerns (DM security, webhook pairing, OAuth gateway) that have no desktop-surface equivalent. The core delivery contract is preserved: identify the surface, check capabilities, deliver content.
- **Severity**: N/A — intentional simplification, properly documented in file header.

### D6.2: SurfaceRouter Class
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 137-295)
- **Upstream reference**: `src/infra/outbound/deliver.ts` `deliverOutboundPayloads()` (lines 496-553), `src/infra/outbound/channel-resolution.ts` `resolveOutboundChannelPlugin()`
- **Divergence**: Upstream resolves channel plugin via registry lookup + config, then delegates to `createChannelHandler()`. Parallx uses a simple `Map<string, ISurfacePlugin>` for lookup. Upstream has write-ahead queue wrapping the delivery; Parallx has in-memory queue.
- **Evidence**: `SurfaceRouter.send()` follows the same flow: resolve target → check availability → check content type support → deliver → track status. The simpler Map-based lookup is appropriate for a fixed set of desktop surfaces vs. dynamically loaded channel plugins.
- **Severity**: LOW

### D6.3: Surface Registration
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 148-175)
- **Upstream reference**: `src/plugin-sdk/core.ts` `defineChannelPluginEntry()` (lines 285-330), `api.registerChannel({ plugin })`
- **Divergence**: Upstream registration is plugin-system driven (loaded at startup via `defineChannelPluginEntry`). Parallx registration is programmatic via `registerSurface()`. Both use duplicate detection.
- **Evidence**: `registerSurface()` throws on duplicate ID, mirrors upstream behavior where `registerChannel` rejects duplicate plugin IDs. `unregisterSurface()` calls `dispose()` on the plugin, matching upstream lifecycle cleanup.
- **Severity**: N/A

### D6.4: Delivery with Retry
- **Classification**: MISALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 308-360)
- **Upstream reference**: `src/infra/outbound/delivery-queue-recovery.ts` (lines 0-220), `src/infra/outbound/delivery-queue-storage.ts` (lines 0-189)
- **Divergence**: Upstream uses a persistent write-ahead delivery queue (`enqueueDelivery` → send → `ackDelivery`/`failDelivery`) with exponential backoff (`[5s, 25s, 2m, ...]`), MAX_RETRIES=5, permanent error detection (`isPermanentDeliveryError`), and crash recovery. Parallx uses an in-memory retry loop with MAX_DELIVERY_RETRIES=3, uniform retry (no backoff), and no error classification.
- **Evidence**:
  ```typescript
  // Parallx: uniform retry, no backoff
  for (let attempt = 0; attempt <= MAX_DELIVERY_RETRIES; attempt++) {
    try {
      const success = await surface.deliver(current);
      if (success) { /* ... */ }
      current = { ...current, retries: attempt + 1 };
    } catch (err) { /* ... */ }
  }
  
  // Upstream: exponential backoff
  const BACKOFF_MS = [5_000, 25_000, 120_000, ...];
  // + isPermanentDeliveryError() for early termination
  // + write-ahead persistence for crash recovery
  ```
- **Severity**: MEDIUM — The missing exponential backoff could cause rapid retry storms for slow surfaces. The lack of error classification means permanent errors waste all retries. Write-ahead persistence is arguably N/A for a single-process desktop app (no crash recovery needed during active delivery).

### D6.5: Content Type Filtering
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 95-104, 387-396)
- **Upstream reference**: `src/channels/plugins/types.core.ts` `ChannelCapabilities` (lines 219-240), `src/channels/plugins/media-limits.ts`
- **Divergence**: Upstream `ChannelCapabilities` tracks chatTypes, polls, reactions, edit, unsend, media, threads, etc. Parallx `ISurfaceCapabilities` tracks supportsText, supportsStructured, supportsBinary, supportsActions, maxContentSize.
- **Evidence**: The `isContentSupported()` helper maps content type to capabilities. Both systems check capabilities before delivery. The capability dimensions differ because surfaces have different concerns than messaging channels, but the pattern is the same.
- **Severity**: N/A

### D6.6: Broadcast
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 237-261)
- **Upstream reference**: No direct upstream equivalent — OpenClaw's message-tool targets a specific channel
- **Divergence**: Upstream delivers to a single channel per message invocation. Parallx `broadcast()` delivers to all surfaces that support the content type. This is a Parallx-specific enhancement.
- **Evidence**: `broadcast()` iterates all surfaces, filters by availability and content type support, then calls `send()` for each. This is appropriate for a desktop workbench where an AI response might update chat, canvas, and status simultaneously.
- **Severity**: N/A — Parallx-specific enhancement, not a divergence.

### D6.7: Delivery History
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 299-303, 354-357)
- **Upstream reference**: `src/infra/outbound/delivery-queue-storage.ts` queue management, `moveToFailed()` for exhausted entries
- **Divergence**: Upstream persists queue entries to disk (JSONL files in `delivery-queue/`), moves exhausted entries to `failed/`. Parallx keeps an in-memory array bounded by `MAX_DELIVERY_QUEUE_SIZE=100`, trimming oldest entries.
- **Evidence**: The bounded history prevents unbounded memory growth, which maps to upstream's pruning pattern (MAX_RETRIES → failed/). Desktop in-memory is appropriate given no crash recovery requirements.
- **Severity**: LOW

### D6.8: Well-Known Surface IDs
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 35-39)
- **Upstream reference**: `src/channels/plugins/types.core.ts` `ChannelId` type, individual plugin IDs ("telegram", "discord", "slack", etc.)
- **Divergence**: Upstream defines channel IDs as string literals per plugin. Parallx defines `SURFACE_CHAT`, `SURFACE_CANVAS`, `SURFACE_FILESYSTEM`, `SURFACE_NOTIFICATIONS`, `SURFACE_STATUS` as constants.
- **Evidence**: Constants are properly exported and tested. Five desktop-appropriate surfaces covering the main output modalities.
- **Severity**: N/A

### D6.9: ISurfaceDelivery Interface
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 68-81)
- **Upstream reference**: `src/auto-reply/types.ts` `ReplyPayload`, `src/infra/outbound/payloads.ts` `NormalizedOutboundPayload`
- **Divergence**: Upstream `ReplyPayload` has text, mediaUrl, mediaUrls. Parallx `ISurfaceDelivery` has id, surfaceId, contentType, content (generic), metadata, createdAt, status, retries, error. The Parallx type bundles tracking info (status, retries) into the delivery record.
- **Evidence**: The Parallx type is actually more self-contained — upstream needs separate queue entry metadata (`QueuedDelivery.retryCount`, `lastError`) in addition to payload. Parallx combines them into one record.
- **Severity**: N/A

### D6.10: Disposal & Cleanup
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 115, 370-379)
- **Upstream reference**: `src/channels/plugins/types.plugin.ts` `lifecycle?: ChannelLifecycleAdapter`, channel plugin teardown patterns
- **Divergence**: Upstream channels have optional `lifecycle` adapter. Parallx uses `IDisposable` from the VS Code-style platform lifecycle model. `SurfaceRouter.dispose()` disposes all surfaces, clears the map, and drains queues.
- **Evidence**: Tests verify all surfaces are disposed and history is cleared on router disposal.
- **Severity**: N/A

### D6.11: Constants
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (lines 29-32)
- **Upstream reference**: `src/infra/outbound/delivery-queue-recovery.ts` `MAX_RETRIES=5`, `BACKOFF_MS`
- **Divergence**: Parallx uses `MAX_DELIVERY_QUEUE_SIZE=100` (no upstream equivalent — upstream uses disk) and `MAX_DELIVERY_RETRIES=3` (upstream `MAX_RETRIES=5`). Parallx values are lower, appropriate for in-memory desktop operation.
- **Evidence**: Tests verify both constants are within reasonable bounds (10-1000 for queue, 1-10 for retries).
- **Severity**: LOW

### D6.12: Test Coverage
- **Classification**: ALIGNED
- **Parallx file**: `tests/unit/openclawSurfacePlugin.test.ts`
- **Upstream reference**: N/A (Parallx-specific tests)
- **Divergence**: None — this is Parallx test infrastructure.
- **Evidence**: 26 tests across 6 describe blocks:
  - Surface registration (6 tests): register, retrieve, duplicate rejection, unregister, unknown unregister, dispose guard
  - Send (7 tests): success, unknown surface, unavailable, unsupported type, metadata, history recording, dispose guard
  - Retry logic (4 tests): soft failure retry, exception retry, max retries exhausted, failed history recording
  - Broadcast (4 tests): multi-surface, skip unavailable, skip unsupported type, dispose guard
  - Dispose (2 tests): surface disposal, history clearing
  - Constants (3 tests): surface IDs, queue size, retry count
- **Severity**: N/A — all 26 tests pass.

### D6.13: No Anti-Patterns
- **Classification**: ALIGNED
- **Parallx file**: `src/openclaw/openclawSurfacePlugin.ts` (entire file)
- **Upstream reference**: M41 anti-pattern checklist
- **Divergence**: None detected.
- **Evidence**:
  - No regex routing or keyword detection
  - No heuristic patchwork
  - No output repair or post-processing overrides
  - No pre-classification bypassing the model
  - Clean interface-based design with proper separation
  - Explicit upstream traceability in file header comments
  - All adaptation decisions are documented in JSDoc comments
- **Severity**: N/A

---

## Upstream Mapping Summary

| Upstream Pattern | Parallx Adaptation | Status |
|-----------------|-------------------|--------|
| `ChannelPlugin` interface | `ISurfacePlugin` interface | ALIGNED — simplified to core lifecycle |
| `resolveOutboundChannelPlugin()` | `SurfaceRouter._surfaces.get()` | ALIGNED — Map lookup |
| `api.registerChannel()` | `router.registerSurface()` | ALIGNED — programmatic registration |
| `deliverOutboundPayloads()` + write-ahead queue | `router.send()` + in-memory retry | MISALIGNED — no backoff/error classification |
| `ChannelCapabilities` | `ISurfaceCapabilities` | ALIGNED — domain-appropriate dimensions |
| Multi-channel message-tool | `router.broadcast()` | ALIGNED — Parallx enhancement |
| `delivery-queue-storage.ts` bounded queue | `_deliveryHistory` bounded array | ALIGNED — in-memory appropriate |
| Channel IDs ("telegram", "discord", etc.) | Surface IDs (chat, canvas, filesystem, etc.) | ALIGNED — desktop-appropriate |
| `ReplyPayload` + `QueuedDelivery` | `ISurfaceDelivery` (combined) | ALIGNED — self-contained record |
| `ChannelLifecycleAdapter` | `IDisposable` pattern | ALIGNED — platform convention |
| `MAX_RETRIES=5`, `BACKOFF_MS` | `MAX_DELIVERY_RETRIES=3`, `MAX_DELIVERY_QUEUE_SIZE=100` | ALIGNED — lower values for desktop |

---

## N/A Upstream Features (Not Applicable to Desktop Surfaces)

These upstream ChannelPlugin capabilities have no desktop-surface equivalent:

| Upstream Feature | Reason N/A |
|-----------------|-----------|
| `setup` / `setupWizard` | Surfaces are built-in, not user-configured |
| `pairing` | No DM approval flow for desktop surfaces |
| `security` | No DM policy / allowlist for local surfaces |
| `gateway` / `gatewayMethods` | No webhook HTTP endpoints |
| `auth` | No OAuth / token management per surface |
| `groups` / `mentions` | No group chat semantics |
| `threading` | No reply-to-mode for surfaces |
| `messaging.targetResolver` | No target resolution (surfaces are known) |
| `configSchema` / config validation | Surfaces have no per-surface config |
| Crash recovery (`delivery-queue-storage.ts`) | Single-process desktop, no daemon restart |
| `mirror` / cross-context delivery | No cross-channel mirroring for desktop |

---

## Recommendations

### Fix (MISALIGNED)

**D6.4 — Add exponential backoff and error classification to retry logic:**
- Add a simple backoff schedule (e.g., `[100, 500, 2000]` ms) to `_deliverWithRetry()`
- Optionally classify errors as permanent (surface reports "not supported") vs. transient (network/timeout)
- This is a LOW-risk improvement that brings retry behavior closer to upstream's `delivery-queue-recovery.ts` pattern
- Priority: LOW — the current uniform retry is functional, backoff would improve resilience

### No Action Needed

All other capabilities are ALIGNED. The adaptation is well-documented, correctly maps upstream patterns to desktop context, and has comprehensive test coverage. No heuristic patchwork detected.
