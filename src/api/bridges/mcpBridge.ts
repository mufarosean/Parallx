// mcpBridge.ts — bridges parallx.mcp to ILanguageModelToolsService (M63 P0)
//
// Provides extensions a stable surface for invoking MCP tools registered with
// the host. MCP tools are namespaced as `mcp__<serverId>__<toolName>` (see
// openclaw/mcp/mcpToolBridge.ts:80).

import type {
  ILanguageModelToolsService,
  ICancellationToken,
} from '../../services/chatTypes.js';
import { Emitter } from '../../platform/events.js';

/**
 * Public token shape exposed to extensions. Mirrors ICancellationToken but
 * without an Event dependency.
 */
export interface IMcpInvokeToken {
  readonly isCancellationRequested: boolean;
}

/**
 * Public result shape exposed to extensions. Wraps IToolResult.content (a flat
 * string) into the `{type:'text',text}[]` shape that mirrors MCP's wire format
 * so extensions can be ported to a real MCP client later without churn.
 */
export interface IMcpInvokeResult {
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly isError?: boolean;
}

export interface IMcpToolInfo {
  readonly name: string;
  readonly description?: string;
}

const NOOP_EMITTER = new Emitter<void>();
const NOOP_EVENT = NOOP_EMITTER.event;
const NEVER_CANCELLED: ICancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: NOOP_EVENT,
};

export class McpBridge {
  constructor(
    _toolId: string,
    private readonly _service: ILanguageModelToolsService,
  ) {
    void _toolId;
  }

  async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
    token?: IMcpInvokeToken,
  ): Promise<IMcpInvokeResult> {
    const cancellation: ICancellationToken = token
      ? { isCancellationRequested: token.isCancellationRequested, onCancellationRequested: NOOP_EVENT }
      : NEVER_CANCELLED;
    const result = await this._service.invokeTool(toolName, args, cancellation);
    return {
      content: [{ type: 'text', text: result.content }],
      isError: result.isError,
    };
  }

  listTools(): readonly IMcpToolInfo[] {
    return this._service.getTools()
      .filter(t => t.name.startsWith('mcp__'))
      .map(t => ({ name: t.name, description: t.description }));
  }
}
