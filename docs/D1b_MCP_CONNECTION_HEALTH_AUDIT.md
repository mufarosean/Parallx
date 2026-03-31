# D1b — MCP Connection Health: Structural Audit

**Date:** 2026-03-30
**Auditor:** Parity Orchestrator (on behalf of AI Parity Auditor)
**Domain:** D1b — MCP Connection Health (extension of D1 MCP Integration)
**Scope:** MCP ping, server-initiated request handling, connection health monitoring, reconnection
**Baseline:** D1 CLOSED ✅ (8/8 ALIGNED, 65 tests)

---

## Background

D1 (MCP Integration) was closed with 8/8 capabilities ALIGNED. However, the D1 scope
covered: config types, persistence, client service, tool discovery, bridging, execution,
settings UI, and source annotation. It did **not** scope MCP protocol-level ping, connection
health monitoring, or reconnection — capabilities that OpenClaw handles via the official
`@modelcontextprotocol/sdk` Client class.

This audit addresses the gaps discovered during the MCP parity review.

---

## Upstream Reference: OpenClaw MCP Implementation

OpenClaw uses `@modelcontextprotocol/sdk` `Client` in `pi-bundle-mcp-runtime.ts`:
- `new Client({ name: "openclaw-bundle-mcp", version: "0.0.0" }, {})`
- SDK auto-handles: ping send/respond, JSON-RPC framing, all transport types
- `connectWithTimeout()` wraps `client.connect(transport)` with configurable timeout
- `disposeSession()` cleanly closes client + transport
- Health monitor with configurable `staleThreshold` and `maxRestarts`

The SDK's `Client` class (from `@modelcontextprotocol/sdk/client/index.js`):
- Responds to incoming `ping` requests automatically with `{ result: {} }`
- Provides `client.ping()` method for outbound health checks
- Handles all JSON-RPC 2.0 message types (responses, requests, notifications)
- Supports server-initiated requests beyond ping

---

## Parallx MCP Architecture

Parallx cannot use the SDK directly in the renderer due to Electron security:
- `contextIsolation: true`, `nodeIntegration: false`
- MCP stdio requires IPC bridge to main process (`electron/mcpBridge.cjs`)
- `McpStdioTransport` bridges via `window.parallxElectron.mcp.*`

This is a valid Parallx adaptation (P4). The gaps are in the JSON-RPC handling layer.

---

## Iteration 1 — Gap Classification

| # | Capability | Classification | Current State | Gap Description |
|---|-----------|----------------|---------------|-----------------|
| D1b-1 | Respond to server ping requests | **MISSING** | `_handleMessage()` line 182: `if (parsed.id == null) return;` drops server-initiated requests | Server sends `{ jsonrpc: "2.0", id: N, method: "ping" }` — gets silently dropped |
| D1b-2 | Handle server-initiated requests | **MISSING** | Same line — any server request (not just ping) is dropped | No dispatch for server→client JSON-RPC requests |
| D1b-3 | Periodic ping for health check | **MISSING** | No timer, no `ping()` method | Cannot detect stale/dead connections |
| D1b-4 | Connection health state tracking | **MISSING** | Only tracks `McpConnectionState` (connecting/connected/disconnected/error) | No last-ping-time, latency, failure-count metrics |
| D1b-5 | Reconnection on connection loss | **MISSING** | `_handleClose` fires `disconnected` and stops | No automatic recovery attempt |
| D1b-6 | Server notification handling | **MISSING** | Notifications (no id, has method) are silently dropped | Should at least be emitted for observability |
| D1b-7 | Health status in MCP Settings UI | **MISSING** | Status badge only shows connected/disconnected | No ping latency, health indicator, or reconnect control |
| D1b-8 | Reconnection config | **MISSING** | `IMcpServerConfig` has no reconnection parameters | Need `maxReconnectAttempts`, `reconnectDelayMs` options |

### Severity Classification

| Severity | Capabilities | Rationale |
|----------|-------------|-----------|
| **HIGH** | D1b-1, D1b-2 | Protocol violation — MCP spec requires responding to ping |
| **MEDIUM** | D1b-3, D1b-5 | Connection can silently die without detection or recovery |
| **LOW** | D1b-4, D1b-6, D1b-7, D1b-8 | Observability and UX improvements |

---

## Critical Finding: Protocol Violation in `_handleMessage()`

```typescript
// mcpClientService.ts line 182
private _handleMessage(_serverId: string, data: string): void {
    // ...JSON parse...
    if (parsed.jsonrpc !== '2.0') return;
    if (parsed.id == null) return; // ← DROPS ALL server requests AND notifications
    // ...only handles responses matching pending map...
}
```

This line conflates two different message types:
1. **Notifications** (no `id`, has `method`) — informational, no response needed
2. **Server requests** (has `id`, has `method`) — REQUIRE a response

The fix must distinguish these: if a message has `method` AND `id`, it's a server request
that needs a response. If it has `method` but NO `id`, it's a notification.
