# D1 — MCP Integration: Structural Audit

**Date:** 2025-01-28
**Auditor:** AI Parity Auditor
**Domain:** D1 — MCP (Model Context Protocol) Integration
**Planned location:** `src/openclaw/mcp/`
**Codebase state:** Zero MCP code exists. All 8 capabilities are greenfield.

---

## Iteration 1 — Structural Audit

### Summary Matrix

| # | Capability | Classification | Integration Surface | Notes |
|---|-----------|----------------|---------------------|-------|
| D1-1 | MCP Config Types | **MISSING** | `unifiedConfigTypes.ts` | `IUnifiedAIConfig` has no `mcp` section. Need `IMcpServerConfig` and `IUnifiedMcpConfig` |
| D1-2 | MCP Config Persistence | **MISSING** | `unifiedConfigTypes.ts`, config service | New section on `IUnifiedAIConfig`, read/write via existing unified config service |
| D1-3 | MCP Client Service | **MISSING** | `workbenchServices.ts` | New `IMcpClientService` — lifecycle manager for stdio/SSE connections. DI-registered. |
| D1-4 | MCP Tool Discovery | **MISSING** | New file in `src/openclaw/mcp/` | `tools/list` JSON-RPC call after connection. Returns MCP tool schemas. |
| D1-5 | MCP Tool Bridging | **MISSING** | `chatTypes.ts` (`IToolDefinition`), `openclawToolState.ts` | Convert MCP tool schemas → `IToolDefinition[]`, register as `IChatTool` |
| D1-6 | MCP Tool Execution | **MISSING** | `chatTypes.ts` (`IChatTool`), `openclawAttempt.ts` | `tools/call` JSON-RPC → `IToolResult`. Register as `IChatTool` entries with `source: 'mcp'` |
| D1-7 | MCP Settings UI | **MISSING** | `toolsSection.ts` | New `McpSection` in AI Settings — add/remove/connect servers, status display |
| D1-8 | MCP Source Annotation | **MISSING** | `chatRuntimeTypes.ts` (`IChatRuntimeToolMetadata.source`) | `source` union is `'built-in' | 'bridge'` — needs `'mcp'` added |

### Dependency Chain

```
D1-1 (Config Types) → D1-2 (Config Persistence) → D1-8 (Source Annotation)
    → D1-3 (MCP Client Service) → D1-4 (Tool Discovery)
    → D1-5 (Tool Bridging) → D1-6 (Tool Execution)
    → D1-7 (Settings UI)
```

### Key Architectural Finding: Electron IPC Required

- `contextIsolation: true`, `nodeIntegration: false` in `electron/main.cjs`
- MCP stdio transport MUST go through IPC to Electron main process (like `doclingBridge.cjs`)
- New IPC handlers needed: `mcp:spawn`, `mcp:send`, `mcp:kill`, `mcp:onMessage`
- SSE transport can run in renderer via `EventSource` API

### New Files Required

| File | Purpose |
|------|---------|
| `src/openclaw/mcp/mcpTypes.ts` | MCP protocol types: JSON-RPC, tools/list, tools/call |
| `src/openclaw/mcp/mcpTransport.ts` | Transport interface + IPC-based stdio implementation |
| `src/openclaw/mcp/mcpClientService.ts` | Client lifecycle, connection management, tool discovery |
| `src/openclaw/mcp/mcpToolBridge.ts` | MCP→IChatTool conversion + registration |
| `src/aiSettings/ui/sections/mcpSection.ts` | AI Settings section for MCP server management |
| `electron/mcpBridge.cjs` | Main process IPC handlers for stdio child processes |
| `tests/unit/mcp/mcpTypes.test.ts` | JSON-RPC framing tests |
| `tests/unit/mcp/mcpTransport.test.ts` | Transport lifecycle tests |
| `tests/unit/mcp/mcpClientService.test.ts` | Client service tests |
| `tests/unit/mcp/mcpToolBridge.test.ts` | Tool bridge tests |

### Existing Files to Modify

| File | Change |
|------|--------|
| `src/services/chatRuntimeTypes.ts` | Add `'mcp'` to `IChatRuntimeToolMetadata.source` union |
| `src/services/chatTypes.ts` | Add `'mcp'` to `IChatTool.source` union |
| `src/aiSettings/unifiedConfigTypes.ts` | Add `IMcpServerConfig`, `IUnifiedMcpConfig`, `mcp` field on `IUnifiedAIConfig` |
| `src/services/serviceTypes.ts` | Add `IMcpClientService` service identifier |
| `src/workbench/workbenchServices.ts` | DI registration for `McpClientService` |
| `src/openclaw/openclawToolState.ts` | Accept MCP tools as third source |
| `electron/main.cjs` | Load `mcpBridge.cjs` IPC handlers |
| `electron/preload.cjs` | Expose `mcp` API to renderer |

### Security Considerations

- **Command injection:** Use `spawn` with explicit args array (never `exec`/shell)
- **Env isolation:** Only pass declared `env` vars, don't inherit full `process.env`
- **URL validation:** For SSE transport, validate URLs are localhost/LAN only
- **Tool namespacing:** Prefix with `mcp__` or rely on existing dedupe

### Cross-Domain Integration

| Domain | Integration |
|--------|-------------|
| D4 (Runtime Hooks) | MCP tools get `before_tool_call`/`after_tool_call` hooks for free via `IChatRuntimeToolInvocationObserver` |
| D8 (Agent Config) | Agent tool allow/deny lists filter MCP tools through `applyOpenclawToolPolicy` |
| D6 (Diagnostics) | MCP connection health can feed into `/doctor` checks |

---

## Iteration 2 — Refinement Audit

### Findings (21 total: 4 HIGH, 10 MEDIUM, 7 LOW)

| ID | Severity | File | Issue | Status |
|----|----------|------|-------|--------|
| R-01 | HIGH | mcpClientService.ts | `_rejectPendingForServer` was no-op | **FIXED** — tracks `pendingIds: Set<number>` per server |
| R-02 | HIGH | all | Zero tests | **FIXED** — 65 tests across 4 files |
| R-03 | HIGH | mcpClientService.ts | No `jsonrpc: '2.0'` validation on responses | **FIXED** — guard added |
| R-04 | HIGH | mcpBridge.cjs | Missing Windows env vars (SYSTEMROOT, TEMP, etc.) | **FIXED** — platform-specific additions |
| R-05 | MEDIUM | mcpClientService.ts | Double status-fire race on disconnect | **FIXED** — entry removed before close |
| R-06 | MEDIUM | mcpClientService.ts | Pending rejected after transport close | **FIXED** — reject before close |
| R-10 | MEDIUM | mcpToolBridge.ts | No auto-cleanup on disconnect | **FIXED** — subscribes to onDidChangeStatus |
| R-15 | LOW | mcpToolBridge.ts | Dispose iteration over mutating map | **FIXED** — collect keys first |
| R-17 | LOW | mcpClientService.ts | Config not stored in entry | **FIXED** — config stored in IServerEntry |

### Deferred (acceptable for closure)
R-07, R-08, R-09, R-11, R-12, R-13, R-14, R-16, R-18, R-19, R-20, R-21 — UI polish, spec extensions, edge cases.

---

## Iteration 3 — Parity Check

### Final Matrix (8/8 ALIGNED)

| # | Capability | Classification |
|---|-----------|----------------|
| D1-1 | MCP Config Types | **ALIGNED** |
| D1-2 | MCP Config Persistence | **ALIGNED** |
| D1-3 | MCP Client Service | **ALIGNED** |
| D1-4 | MCP Tool Discovery | **ALIGNED** |
| D1-5 | MCP Tool Bridging | **ALIGNED** |
| D1-6 | MCP Tool Execution | **ALIGNED** |
| D1-7 | MCP Settings UI | **ALIGNED** |
| D1-8 | MCP Source Annotation | **ALIGNED** |

### M41 Anti-Pattern Check: CLEAN
