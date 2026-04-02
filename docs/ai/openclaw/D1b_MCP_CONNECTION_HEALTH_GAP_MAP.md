# D1b — MCP Connection Health: Gap Map

**Date:** 2026-03-30
**Mapper:** Parity Orchestrator (on behalf of Gap Mapper)
**Input:** `D1b_MCP_CONNECTION_HEALTH_AUDIT.md`
**Approach:** Option B — Add ping/health/reconnection to existing architecture

---

## Implementation Plan Overview

| Iteration | Gaps Addressed | Files Changed |
|-----------|---------------|---------------|
| **1** | D1b-1, D1b-2, D1b-3, D1b-4 | `mcpTypes.ts`, `mcpClientService.ts`, `serviceTypes.ts`, tests |
| **2** | D1b-5, D1b-6, D1b-8 | `mcpClientService.ts`, `mcpTypes.ts`, `mcpTransport.ts`, tests |
| **3** | D1b-7 + refinement | `mcpSection.ts`, edge cases, test coverage |

---

## Iteration 1: Ping Support + Health Tracking (D1b-1, D1b-2, D1b-3, D1b-4)

### Change 1.1: Add server request type to `mcpTypes.ts`

**File:** `src/openclaw/mcp/mcpTypes.ts`
**Upstream ref:** MCP spec `ping` method — `{ jsonrpc: "2.0", id: N, method: "ping" }`

Add `IJsonRpcServerRequest` to distinguish server-initiated requests from notifications.
Add `IMcpHealthInfo` for per-server health tracking.

```typescript
// Server-initiated request (has id + method, needs response)
export interface IJsonRpcServerRequest {
  readonly jsonrpc: '2.0';
  readonly id: number | string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

// Per-server health metrics
export interface IMcpHealthInfo {
  readonly lastPingAt: number | null;    // timestamp of last successful ping
  readonly lastPingLatencyMs: number | null;
  readonly consecutiveFailures: number;
  readonly isHealthy: boolean;
}
```

### Change 1.2: Rewrite `_handleMessage()` in `mcpClientService.ts`

**File:** `src/openclaw/mcp/mcpClientService.ts`
**Upstream ref:** SDK Client handles 3 message types: responses, server requests, notifications

Replace single-path `_handleMessage` with 3-way dispatch:
1. **Response** (has `id`, no `method`) → existing pending-map resolution
2. **Server request** (has `id` AND `method`) → `_handleServerRequest()` → respond
3. **Notification** (has `method`, no `id`) → emit `onDidReceiveNotification`

```typescript
private _handleMessage(serverId: string, data: string): void {
    let parsed: any;
    try { parsed = JSON.parse(data); } catch { return; }
    if (parsed.jsonrpc !== '2.0') return;

    const hasId = parsed.id != null;
    const hasMethod = typeof parsed.method === 'string';

    if (hasId && hasMethod) {
        // Server-initiated request (e.g., ping) — needs response
        this._handleServerRequest(serverId, parsed);
    } else if (hasId && !hasMethod) {
        // Response to our pending request
        this._handleResponse(parsed);
    } else if (hasMethod && !hasId) {
        // Notification — no response needed
        this._onDidReceiveNotification.fire({ serverId, method: parsed.method, params: parsed.params });
    }
}
```

### Change 1.3: Add `_handleServerRequest()` method

Responds to `ping` with `{ result: {} }`. Unknown methods get error response.

### Change 1.4: Add `ping(serverId)` method

Sends `{ method: "ping" }` request and measures round-trip latency.
Updates health info on success. Rejects on timeout (5s, tighter than 30s request default).

### Change 1.5: Add periodic health check timer

`_startHealthMonitor(serverId)` starts a 30s interval ping timer per server.
`_stopHealthMonitor(serverId)` clears the timer on disconnect.
Timer fires `ping()`, updates health state, fires `onDidChangeStatus` on health change.

### Change 1.6: Add `getHealthInfo()` and events to interface

**File:** `src/services/serviceTypes.ts`

Add to `IMcpClientService`:
- `ping(serverId: string): Promise<number>` — returns latency in ms
- `getHealthInfo(serverId: string): IMcpHealthInfo | undefined`
- `readonly onDidReceiveNotification: Event<{ serverId: string; method: string; params?: Record<string, unknown> }>`

### Tests for Iteration 1

| Test | Description |
|------|-------------|
| Server ping request gets `{ result: {} }` response | D1b-1 core |
| Unknown server request gets error response | D1b-2 robustness |
| `ping()` returns latency on success | D1b-3 core |
| `ping()` rejects on timeout (5s) | D1b-3 timeout |
| Health monitor fires periodic pings | D1b-3 timer |
| Health info tracks consecutive failures | D1b-4 |
| `onDidReceiveNotification` fires for notifications | D1b-6 preview |

---

## Iteration 2: Reconnection + Notification Handling (D1b-5, D1b-6, D1b-8)

### Change 2.1: Add reconnection config to `IMcpServerConfig`

**File:** `src/openclaw/mcp/mcpTypes.ts`

```typescript
export interface IMcpServerConfig {
  // ...existing...
  readonly autoReconnect?: boolean;          // default: true
  readonly maxReconnectAttempts?: number;     // default: 5
  readonly reconnectBaseDelayMs?: number;     // default: 1000
}
```

### Change 2.2: Add reconnection logic to `McpClientService`

On `_handleClose()`, if `autoReconnect` is enabled:
1. Fire `reconnecting` status
2. Exponential backoff: `baseDelay * 2^attempt` (capped at 30s)
3. Re-create transport, re-run initialize handshake
4. Re-refresh tools via `onDidReconnect` event
5. After `maxReconnectAttempts`, give up and fire `error` status

### Change 2.3: Add `reconnecting` to `McpConnectionState`

**File:** `src/openclaw/mcp/mcpTypes.ts`

```typescript
export type McpConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
```

### Change 2.4: Notification event wiring

The `onDidReceiveNotification` event from Iteration 1 covers D1b-6.
MCP notifications include `notifications/tools/list_changed`, `notifications/resources/list_changed`, etc.
Wire `notifications/tools/list_changed` to auto-refresh the tool bridge.

### Tests for Iteration 2

| Test | Description |
|------|-------------|
| Auto-reconnect attempts on unexpected close | D1b-5 core |
| Reconnect uses exponential backoff | D1b-5 timing |
| Reconnect gives up after max attempts | D1b-5 limit |
| Reconnect re-runs handshake | D1b-5 protocol |
| Manual disconnect does not trigger reconnect | D1b-5 guard |
| `notifications/tools/list_changed` triggers refresh | D1b-6 |
| Reconnection config defaults | D1b-8 |

---

## Iteration 3: Refinement + UI (D1b-7)

### Change 3.1: Health indicators in MCP Settings

**File:** `src/aiSettings/ui/sections/mcpSection.ts`

Add to existing server status display:
- Green/yellow/red health dot based on ping state
- Last ping latency value
- "Reconnecting..." state in status badge
- Manual reconnect button (visible when disconnected/error)

### Change 3.2: Edge case hardening

- Ping during reconnection should be rejected immediately
- Multiple rapid connects to same server shouldn't race
- Disposal during reconnection timer should clean up
- Health monitor cleanup on server removal

### Tests for Iteration 3

| Test | Description |
|------|-------------|
| Ping during reconnect is rejected | Edge case |
| Dispose cancels reconnection timer | Cleanup |
| Health monitor stops on server removal | Cleanup |
| McpSection shows health status | UI |
| Reconnect button triggers reconnection | UI |
