/**
 * MCP tool results keep their image blocks for the running turn instead of
 * dropping them (docs/BROWSER_AGENT_IMPLEMENTATION_CONTRACT.md, Stage E).
 */

import { describe, it, expect } from 'vitest';
import { McpToolBridge } from '../../src/openclaw/mcp/mcpToolBridge';
import type { IChatTool, ICancellationToken } from '../../src/services/chatTypes';

async function toolReturning(content: unknown[]) {
  const registered: IChatTool[] = [];
  const client = {
    onDidChangeStatus: () => ({ dispose() {} }),
    onDidReceiveNotification: () => ({ dispose() {} }),
    listTools: async () => [{ name: 'shot', description: 'Shot', inputSchema: { type: 'object', properties: {} } }],
    callTool: async () => ({ content }),
  };
  const tools = { registerTool: (t: IChatTool) => { registered.push(t); return { dispose() {} }; } };
  const bridge = new McpToolBridge(client as any, tools as any);
  await bridge.refreshTools('srv');
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as unknown as ICancellationToken;
  return registered[0].handler({}, token);
}

describe('McpToolBridge images', () => {
  it('keeps image blocks alongside the text', async () => {
    const r = await toolReturning([{ type: 'text', text: 'Here it is' }, { type: 'image', data: 'iVBOR', mimeType: 'image/png' }]);
    expect(r.content).toBe('Here it is');
    expect(r.images).toEqual([expect.objectContaining({ kind: 'image', mimeType: 'image/png', data: 'iVBOR', id: 'mcp:srv:shot:0' })]);
  });

  it('says what came back when there is only an image', async () => {
    const r = await toolReturning([{ type: 'image', data: 'iVBOR', mimeType: 'image/png' }]);
    expect(r.content).toBe('(1 image)');
    expect(r.images).toHaveLength(1);
  });

  it('is unchanged for text-only results', async () => {
    const r = await toolReturning([{ type: 'text', text: 'plain' }]);
    expect(r).toEqual({ content: 'plain', isError: undefined });
  });
});
