// mcpTransport.ts — MCP transport abstraction (D1)
//
// Bridges JSON-RPC messages to/from an MCP server process via Electron IPC.
// The renderer cannot spawn child processes directly (contextIsolation: true,
// nodeIntegration: false), so all stdio goes through the main process via
// window.parallxElectron.mcp.* IPC calls.

import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import type { McpConnectionState } from './mcpTypes.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Transport Interface
// ═══════════════════════════════════════════════════════════════════════════════

export interface IMcpTransport {
  readonly status: McpConnectionState;
  connect(): Promise<void>;
  send(message: string): Promise<void>;
  close(): Promise<void>;
  readonly onMessage: Event<string>;
  readonly onClose: Event<number | null>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Electron IPC Bridge Detection
// ═══════════════════════════════════════════════════════════════════════════════

// Check for `window.parallxElectron` first
const electronApi: any = typeof window !== 'undefined' && (window as any).parallxElectron;

// ═══════════════════════════════════════════════════════════════════════════════
// Stdio Transport (via Electron IPC)
// ═══════════════════════════════════════════════════════════════════════════════

export class McpStdioTransport implements IMcpTransport {
  private _status: McpConnectionState = 'disconnected';
  private readonly _onMessage = new Emitter<string>();
  private readonly _onClose = new Emitter<number | null>();
  private _unsubMessage?: () => void;
  private _unsubExit?: () => void;

  readonly onMessage = this._onMessage.event;
  readonly onClose = this._onClose.event;

  constructor(
    private readonly _serverId: string,
    private readonly _command: string,
    private readonly _args: readonly string[],
    private readonly _env?: Readonly<Record<string, string>>,
  ) {}

  get status(): McpConnectionState { return this._status; }

  async connect(): Promise<void> {
    if (!electronApi?.mcp) throw new Error('MCP IPC bridge not available');
    this._status = 'connecting';

    this._unsubMessage = electronApi.mcp.onMessage((serverId: string, data: string) => {
      if (serverId === this._serverId) this._onMessage.fire(data);
    });
    this._unsubExit = electronApi.mcp.onExit((serverId: string, code: number | null) => {
      if (serverId === this._serverId) {
        this._status = 'disconnected';
        this._onClose.fire(code);
      }
    });

    const result = await electronApi.mcp.spawn(this._serverId, this._command, [...this._args], this._env ?? {});
    if (result?.error) {
      this._status = 'error';
      throw new Error(`MCP spawn failed: ${result.error}`);
    }
    this._status = 'connected';
  }

  async send(message: string): Promise<void> {
    if (!electronApi?.mcp) throw new Error('MCP IPC bridge not available');
    await electronApi.mcp.send(this._serverId, message);
  }

  async close(): Promise<void> {
    if (!electronApi?.mcp) return;
    this._status = 'disconnected';
    this._unsubMessage?.();
    this._unsubExit?.();
    await electronApi.mcp.kill(this._serverId);
    this._onMessage.dispose();
    this._onClose.dispose();
  }
}
