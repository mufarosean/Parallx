# D1 — MCP Integration: Gap Map

**Date:** 2025-01-28
**Mapper:** Gap Mapper
**Domain:** D1 — MCP Integration
**Source Audit:** `D1_MCP_INTEGRATION_AUDIT.md`

---

## Change Plan Overview

| Gap | Capability | Files Created | Files Modified | Priority |
|-----|-----------|---------------|----------------|----------|
| G1 | Config Types + Source Annotation | `mcpTypes.ts` | `unifiedConfigTypes.ts`, `chatRuntimeTypes.ts`, `chatTypes.ts` | P0 — Foundation |
| G2 | MCP Transport + IPC Bridge | `mcpTransport.ts`, `electron/mcpBridge.cjs` | `electron/main.cjs`, `electron/preload.cjs` | P0 — Foundation |
| G3 | MCP Client Service | `mcpClientService.ts` | `serviceTypes.ts`, `workbenchServices.ts` | P0 — Core |
| G4 | Tool Discovery + Bridging | `mcpToolBridge.ts` | `openclawToolState.ts` | P1 — Integration |
| G5 | Tool Execution | (in `mcpToolBridge.ts`) | `main.ts` | P1 — Integration |
| G6 | Settings UI | `mcpSection.ts` | — | P2 — UX |
| G7 | Tests | 4 test files | — | P0 — Verification |

---

## G1: Config Types + Source Annotation (D1-1, D1-2, D1-8)

**Upstream ref:** MCP spec 2024-11-05 — server configuration schema

### New: `src/openclaw/mcp/mcpTypes.ts`

MCP protocol types for JSON-RPC 2.0 messaging and tool schemas.

```typescript
// JSON-RPC 2.0 types
interface IMcpJsonRpcRequest { jsonrpc: '2.0'; id: number; method: string; params?: unknown }
interface IMcpJsonRpcResponse { jsonrpc: '2.0'; id: number; result?: unknown; error?: { code: number; message: string } }
interface IMcpJsonRpcNotification { jsonrpc: '2.0'; method: string; params?: unknown }

// MCP tool discovery
interface IMcpToolSchema { name: string; description?: string; inputSchema: Record<string, unknown> }
interface IMcpToolsListResult { tools: IMcpToolSchema[] }

// MCP tool execution
interface IMcpToolCallParams { name: string; arguments?: Record<string, unknown> }
interface IMcpToolCallResult { content: Array<{ type: string; text?: string }>; isError?: boolean }

// MCP server initialization
interface IMcpInitializeParams { protocolVersion: string; capabilities: { tools?: {} }; clientInfo: { name: string; version: string } }
interface IMcpInitializeResult { protocolVersion: string; capabilities: { tools?: {} }; serverInfo: { name: string; version?: string } }

// Server config (stored in unified config)
interface IMcpServerConfig { id: string; name: string; transport: 'stdio' | 'sse'; command?: string; args?: string[]; url?: string; env?: Record<string, string>; enabled: boolean }
```

### Modified: `src/aiSettings/unifiedConfigTypes.ts`

Add MCP config section:
```typescript
export interface IUnifiedMcpConfig {
  readonly servers: readonly IMcpServerConfig[];
}
```

Add to `IUnifiedAIConfig`:
```diff
+ readonly mcp: IUnifiedMcpConfig;
```

### Modified: `src/services/chatRuntimeTypes.ts`

```diff
- readonly source?: 'built-in' | 'bridge';
+ readonly source?: 'built-in' | 'bridge' | 'mcp';
```

### Modified: `src/services/chatTypes.ts`

Same change to `IChatTool.source`:
```diff
- readonly source?: 'built-in' | 'bridge';
+ readonly source?: 'built-in' | 'bridge' | 'mcp';
```

---

## G2: MCP Transport + IPC Bridge (D1-3 foundation)

**Upstream ref:** MCP spec — stdio and HTTP+SSE transports

### New: `src/openclaw/mcp/mcpTransport.ts`

Transport abstraction. Defines `IMcpTransport` interface and renderer-side implementation that delegates to Electron main process via IPC.

Key responsibilities:
- `IMcpTransport`: `connect()`, `send(message)`, `onMessage`, `close()`, `status`
- `McpStdioTransport`: Uses `window.parallxElectron.mcp.spawn/send/kill/onMessage` IPC
- `McpSseTransport`: Uses `EventSource` API directly in renderer (no IPC needed)
- State machine: `disconnected → connecting → connected → disconnecting → disconnected`

### New: `electron/mcpBridge.cjs`

Electron main process module for MCP stdio child processes.

Key responsibilities:
- `setupMcpBridge(ipcMain, mainWindow)` — register IPC handlers
- `mcp:spawn(serverId, command, args, env)` — spawn child process, pipe JSON-RPC over stdin/stdout
- `mcp:send(serverId, message)` — write to child's stdin  
- `mcp:kill(serverId)` — terminate child process
- Forward child stdout lines to renderer via `mainWindow.webContents.send('mcp:message', serverId, data)`
- Clean up all child processes on app quit

Security: `spawn()` with `{ shell: false }`, explicit args array, filtered env vars.

### Modified: `electron/main.cjs`

```diff
+ const { setupMcpBridge } = require('./mcpBridge.cjs');
  // ... in createWindow() after mainWindow is created:
+ setupMcpBridge(ipcMain, mainWindow);
```

### Modified: `electron/preload.cjs`

```diff
+ mcp: {
+   spawn: (serverId, command, args, env) => ipcRenderer.invoke('mcp:spawn', serverId, command, args, env),
+   send: (serverId, message) => ipcRenderer.invoke('mcp:send', serverId, message),
+   kill: (serverId) => ipcRenderer.invoke('mcp:kill', serverId),
+   onMessage: (callback) => {
+     const handler = (_event, serverId, data) => callback(serverId, data);
+     ipcRenderer.on('mcp:message', handler);
+     return () => ipcRenderer.removeListener('mcp:message', handler);
+   },
+   onExit: (callback) => {
+     const handler = (_event, serverId, code) => callback(serverId, code);
+     ipcRenderer.on('mcp:exit', handler);
+     return () => ipcRenderer.removeListener('mcp:exit', handler);
+   },
+ },
```

---

## G3: MCP Client Service (D1-3, D1-4)

**Upstream ref:** MCP spec — client lifecycle, initialize handshake

### New: `src/openclaw/mcp/mcpClientService.ts`

`McpClientService` implements `IMcpClientService` — manages connections to MCP servers.

Key responsibilities:
- `connectServer(config: IMcpServerConfig)` → initializes transport, performs MCP `initialize` handshake
- `disconnectServer(serverId: string)` → gracefully close transport
- `getServerStatus(serverId: string)` → connection state
- `listTools(serverId: string)` → calls `tools/list`, returns `IMcpToolSchema[]`
- `callTool(serverId: string, name: string, args: Record<string, unknown>)` → calls `tools/call`, returns `IMcpToolCallResult`
- JSON-RPC request/response correlation via pending-promise map with timeout
- Reconnect: up to 3 attempts with exponential backoff for stdio crashes
- Lifecycle: dispose kills all child processes

### Modified: `src/services/serviceTypes.ts`

```typescript
export const IMcpClientService = createServiceIdentifier<IMcpClientService>('IMcpClientService');

export interface IMcpClientService extends IDisposable {
  connectServer(config: IMcpServerConfig): Promise<void>;
  disconnectServer(serverId: string): Promise<void>;
  getServerStatus(serverId: string): McpConnectionState;
  getConnectedServers(): readonly string[];
  listTools(serverId: string): Promise<readonly IMcpToolSchema[]>;
  callTool(serverId: string, name: string, args: Record<string, unknown>): Promise<IMcpToolCallResult>;
  readonly onDidChangeStatus: Event<{ serverId: string; status: McpConnectionState }>;
}
```

### Modified: `src/workbench/workbenchServices.ts`

```diff
+ import { IMcpClientService } from '../services/serviceTypes.js';
+ import { McpClientService } from '../openclaw/mcp/mcpClientService.js';
  // ...
+ const mcpClientService = new McpClientService();
+ services.registerInstance(IMcpClientService, mcpClientService);
```

---

## G4: Tool Discovery + Bridging (D1-4, D1-5)

**Upstream ref:** MCP spec — tools/list, tool schema format

### New: `src/openclaw/mcp/mcpToolBridge.ts`

Bridges MCP tools into the chat runtime tool system.

Key responsibilities:
- `McpToolBridge.refreshTools()` — for each connected server, call `listTools()`, convert schemas → `IChatTool[]`, register via `ILanguageModelToolsService.registerTool()`
- Schema conversion: `IMcpToolSchema.inputSchema` → `IToolDefinition.parameters`
- Tool handler: wraps `mcpClientService.callTool()` with MCP→IToolResult conversion
- Source annotation: `source: 'mcp'`, `ownerToolId: serverId`
- Tool naming: `mcp__{serverId}__{toolName}` to avoid collisions
- Deregisters old tools on refresh (handles server reconnect with new tool set)

### Modified: `src/openclaw/openclawToolState.ts`

Add `mcpTools` as third input source:
```diff
export function buildOpenclawRuntimeToolState(input: {
  readonly platformTools: readonly IToolDefinition[];
  readonly skillCatalog: readonly ISkillCatalogEntry[];
+ readonly mcpTools?: readonly IToolDefinition[];
  readonly mode: OpenclawToolProfile;
  ...
```

MCP tools flow through the same dedupe and policy pipeline.

---

## G5: Tool Execution (D1-6)

Tool execution is already covered by G4's handler wrapping — `callTool()` is called inside the `IChatTool.handler`. The handler:

1. Receives `(args, cancellationToken)`
2. Extracts `serverId` from the tool's `ownerToolId`
3. Calls `mcpClientService.callTool(serverId, originalToolName, args)`
4. Converts `IMcpToolCallResult` → `IToolResult`
5. Returns result

### Modified: `src/built-in/chat/main.ts`

Wire MCP tool bridge into participant initialization:
```diff
+ if (api.services.has(IMcpClientService)) {
+   // MCP tools are already registered via ILanguageModelToolsService by McpToolBridge
+   // No additional wiring needed — they flow through getTools()
+ }
```

---

## G6: Settings UI (D1-7)

### New: `src/aiSettings/ui/sections/mcpSection.ts`

MCP section in AI Settings panel. Follows existing section pattern (e.g., `toolsSection.ts`).

Key features:
- List configured MCP servers with status indicators (connected/disconnected/error)
- Add server form: name, transport type, command/args or URL
- Remove server button
- Enable/disable toggle per server
- Connect/disconnect action buttons
- Status display: connection state, discovered tool count

---

## G7: Tests

### New: `tests/unit/mcp/mcpTypes.test.ts`
- JSON-RPC message serialization/deserialization
- Config validation

### New: `tests/unit/mcp/mcpTransport.test.ts`
- Transport state machine (mock IPC)
- Message framing (newline-delimited JSON)
- Error handling (process exit, parse errors)

### New: `tests/unit/mcp/mcpClientService.test.ts`
- Connect/disconnect lifecycle
- Initialize handshake
- Request/response correlation with timeout
- Reconnect with backoff
- Tool listing and calling

### New: `tests/unit/mcp/mcpToolBridge.test.ts`
- Schema conversion (MCP → IToolDefinition)
- Tool registration/deregistration lifecycle
- Tool name prefixing
- Handler execution and result conversion
- Source annotation verification

---

## Implementation Order

1. **G1** — Config types + source annotation (pure types, no runtime)
2. **G2** — Transport + IPC bridge (enables all runtime operations)
3. **G3** — Client service (core connection management)
4. **G4** — Tool bridging (connects MCP to chat runtime)
5. **G5** — Execution wiring (minimal, mostly done in G4)
6. **G6** — Settings UI (consumes all layers)
7. **G7** — Tests (interspersed throughout, one test file per module)
