// Unit tests for LanguageModelToolsService — M9 Cap 6 Task 6.1

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LanguageModelToolsService } from '../../src/services/languageModelToolsService';
import { PermissionService } from '../../src/services/permissionService';
import type { IChatTool, IToolResult, ICancellationToken } from '../../src/services/chatTypes';
import type { ILanguageModelToolsRuntimeMetadata } from '../../src/services/languageModelToolsService';

// ── Helpers ──

function createToken(cancelled = false): ICancellationToken {
  return {
    isCancellationRequested: cancelled,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })) as any,
  };
}

function createTool(overrides: Partial<IChatTool> = {}): IChatTool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    parameters: { type: 'object', properties: {} },
    handler: vi.fn(async () => ({ content: 'OK' })),
    requiresConfirmation: false,
    ...overrides,
  };
}

// ── Tests ──

describe('LanguageModelToolsService', () => {
  let service: LanguageModelToolsService;

  beforeEach(() => {
    service = new LanguageModelToolsService();
  });

  // ── Registration ──

  describe('registerTool', () => {
    it('registers a tool and makes it queryable', () => {
      service.registerTool(createTool({ name: 'my_tool' }));
      expect(service.getTool('my_tool')).toBeDefined();
      expect(service.getTool('my_tool')!.name).toBe('my_tool');
    });

    it('fires onDidChangeTools on registration', () => {
      const listener = vi.fn();
      service.onDidChangeTools(listener);

      service.registerTool(createTool());
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('throws when registering duplicate tool name', () => {
      service.registerTool(createTool({ name: 'dup' }));
      expect(() => service.registerTool(createTool({ name: 'dup' }))).toThrow('already registered');
    });

    it('returns disposable that unregisters the tool', () => {
      const disposable = service.registerTool(createTool({ name: 'removable' }));
      expect(service.getTool('removable')).toBeDefined();

      disposable.dispose();
      expect(service.getTool('removable')).toBeUndefined();
    });

    it('fires onDidChangeTools on unregistration', () => {
      const listener = vi.fn();
      const disposable = service.registerTool(createTool());
      service.onDidChangeTools(listener);

      disposable.dispose();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  // ── Queries ──

  describe('getTools', () => {
    it('returns empty array when no tools registered', () => {
      expect(service.getTools()).toEqual([]);
    });

    it('returns all registered tools', () => {
      service.registerTool(createTool({ name: 'a' }));
      service.registerTool(createTool({ name: 'b' }));
      const tools = service.getTools();
      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name).sort()).toEqual(['a', 'b']);
    });
  });

  describe('getTool', () => {
    it('returns undefined for unknown tools', () => {
      expect(service.getTool('nonexistent')).toBeUndefined();
    });
  });

  describe('getToolDefinitions', () => {
    it('returns Ollama-formatted tool definitions', () => {
      service.registerTool(createTool({
        name: 'search',
        description: 'Search pages',
        parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
      }));

      const defs = service.getToolDefinitions();
      expect(defs).toHaveLength(1);
      expect(defs[0]).toEqual({
        name: 'search',
        description: 'Search pages',
        parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
      });
    });
  });

  // ── Invocation ──

  describe('invokeTool', () => {
    it('returns error for unknown tool', async () => {
      const result = await service.invokeTool('missing', {}, createToken());
      expect(result.isError).toBe(true);
      expect(result.content).toContain('not found');
    });

    it('invokes tool handler and returns result', async () => {
      const handler = vi.fn(async () => ({ content: 'search results' }));
      service.registerTool(createTool({ name: 'my_search', handler }));

      const result = await service.invokeTool('my_search', { query: 'test' }, createToken());
      expect(handler).toHaveBeenCalledWith({ query: 'test' }, expect.any(Object));
      expect(result.content).toBe('search results');
      expect(result.isError).toBeUndefined();
    });

    it('handles tool handler errors gracefully', async () => {
      service.registerTool(createTool({
        name: 'failing',
        handler: async () => { throw new Error('boom'); },
      }));

      const result = await service.invokeTool('failing', {}, createToken());
      expect(result.isError).toBe(true);
      expect(result.content).toContain('boom');
    });

    it('returns cancelled error when token is already cancelled', async () => {
      service.registerTool(createTool({ name: 'skip' }));

      const result = await service.invokeTool('skip', {}, createToken(true));
      expect(result.isError).toBe(true);
      expect(result.content).toContain('cancelled');
    });
  });

  // ── Confirmation ──

  describe('confirmation gates', () => {
    it('invokes tool without confirmation when requiresConfirmation is false', async () => {
      const handler = vi.fn(async () => ({ content: 'ok' }));
      service.registerTool(createTool({ requiresConfirmation: false, handler }));

      const result = await service.invokeTool('test_tool', {}, createToken());
      expect(handler).toHaveBeenCalled();
      expect(result.content).toBe('ok');
    });

    it('returns error when tool requires approval but no permission service wired', async () => {
      service.registerTool(createTool({ requiresConfirmation: true }));

      const result = await service.invokeTool('test_tool', {}, createToken());
      expect(result.isError).toBe(true);
      expect(result.content).toContain('requires approval');
    });

    it('invokes tool when permission service approves', async () => {
      const handler = vi.fn(async () => ({ content: 'created' }));
      service.registerTool(createTool({ requiresConfirmation: true, handler }));

      const permissionService = new PermissionService();
      const confirm = vi.fn(async () => 'allow-once' as const);
      permissionService.setConfirmationHandler(confirm);
      service.setPermissionService(permissionService);

      const result = await service.invokeTool('test_tool', { title: 'New Page' }, createToken());
      expect(confirm).toHaveBeenCalledWith('test_tool', 'A test tool', { title: 'New Page' });
      expect(handler).toHaveBeenCalled();
      expect(result.content).toBe('created');
    });

    it('returns rejection when permission service rejects', async () => {
      const handler = vi.fn(async () => ({ content: 'should not reach' }));
      service.registerTool(createTool({ requiresConfirmation: true, handler }));

      const permissionService = new PermissionService();
      permissionService.setConfirmationHandler(vi.fn(async () => 'reject' as const));
      service.setPermissionService(permissionService);

      const result = await service.invokeTool('test_tool', {}, createToken());
      expect(handler).not.toHaveBeenCalled();
      expect(result.content).toBe('Tool execution rejected by user');
      expect(result.isError).toBe(true);
    });

    it('bypasses confirmation when autoApprove is enabled on permission service', async () => {
      const handler = vi.fn(async () => ({ content: 'auto-ok' }));
      service.registerTool(createTool({ requiresConfirmation: true, handler }));

      const permissionService = new PermissionService();
      permissionService.setAutoApprove(true);
      expect(permissionService.autoApprove).toBe(true);
      service.setPermissionService(permissionService);

      const result = await service.invokeTool('test_tool', {}, createToken());
      expect(handler).toHaveBeenCalled();
      expect(result.content).toBe('auto-ok');
    });

    it('emits runtime-controlled approval lifecycle events', async () => {
      const handler = vi.fn(async () => ({ content: 'created' }));
      service.registerTool(createTool({
        name: 'bridge_write',
        description: 'Write bridge output',
        requiresConfirmation: true,
        handler,
        source: 'bridge',
        ownerToolId: 'sample.bridge',
      }));

      const permissionService = new PermissionService();
      permissionService.setConfirmationHandler(vi.fn(async () => 'allow-once' as const));
      service.setPermissionService(permissionService);

      const events: Array<{ type: string; metadata: ILanguageModelToolsRuntimeMetadata; approved?: boolean; result?: IToolResult }> = [];
      const result = await service.invokeToolWithRuntimeControl(
        'bridge_write',
        { path: 'notes.md' },
        createToken(),
        {
          onValidated: (metadata) => events.push({ type: 'validated', metadata }),
          onApprovalRequested: (metadata) => events.push({ type: 'approval-requested', metadata }),
          onApprovalResolved: (metadata, approved) => events.push({ type: 'approval-resolved', metadata, approved }),
          onExecuted: (metadata, executionResult) => events.push({ type: 'executed', metadata, result: executionResult }),
        },
      );

      expect(result.content).toBe('created');
      expect(events.map((event) => event.type)).toEqual([
        'validated',
        'approval-requested',
        'approval-resolved',
        'executed',
      ]);
      expect(events[0]?.metadata.source).toBe('bridge');
      expect(events[0]?.metadata.ownerToolId).toBe('sample.bridge');
      expect(events[2]?.approved).toBe(true);
      expect(events[3]?.result?.content).toBe('created');
    });
  });

  // ── Dispose ──

  describe('dispose', () => {
    it('can be disposed without error', () => {
      service.registerTool(createTool());
      expect(() => service.dispose()).not.toThrow();
    });
  });
});
