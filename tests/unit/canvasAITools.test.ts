// Unit tests for canvasAITools — M84: canvas owns the AI tools it exposes.

import { describe, it, expect, vi } from 'vitest';
import { registerCanvasAITools, canvasPageIdFromEditorId, CANVAS_TOOL_ID } from '../../src/built-in/canvas/ai/canvasAITools';
import type { IBuiltInToolDatabase } from '../../src/built-in/chat/chatTypes';
import type { ILanguageModelToolsService, IChatTool } from '../../src/services/chatTypes';

function createMockToolsService(): ILanguageModelToolsService & { registeredTools: IChatTool[] } {
  const registeredTools: IChatTool[] = [];
  return {
    registeredTools,
    registerTool(tool: IChatTool) {
      registeredTools.push(tool);
      return { dispose: vi.fn() };
    },
    getTools: () => registeredTools,
    getTool: (name: string) => registeredTools.find((t) => t.name === name),
    getToolDefinitions: () => [],
    invokeTool: vi.fn(async () => ({ content: '' })),
    onDidChangeTools: vi.fn(() => ({ dispose: vi.fn() })) as any,
    dispose: vi.fn(),
  };
}

function createMockDb(): IBuiltInToolDatabase {
  return {
    isOpen: true,
    get: vi.fn(async () => undefined),
    all: vi.fn(async () => []),
    run: vi.fn(async () => ({ changes: 1 })),
  };
}

describe('registerCanvasAITools', () => {
  it('registers the canvas page + block tools, attributed to the canvas tool', () => {
    const toolsService = createMockToolsService();
    const disposables = registerCanvasAITools({
      toolsService,
      db: createMockDb(),
      getCurrentPageId: () => undefined,
      workspaceRoot: undefined,
    });

    const names = toolsService.registeredTools.map((t) => t.name).sort();
    expect(names).toEqual([
      'canvas_create_page',
      'canvas_edit_block',
      'canvas_edit_page',
      'canvas_find_pages',
      'canvas_insert_block_after',
      'canvas_link_block',
      'canvas_list_property_definitions',
      'canvas_list_templates',
      'canvas_read_block',
      'canvas_read_page',
      'canvas_set_page_property',
      'canvas_set_page_style',
    ]);
    expect(disposables).toHaveLength(12);

    // Every canvas tool is attributed to canvas, not to chat.
    for (const tool of toolsService.registeredTools) {
      expect(tool.ownerToolId).toBe(CANVAS_TOOL_ID);
    }
  });
});

describe('canvasPageIdFromEditorId', () => {
  it('extracts the page id from a canvas editor id', () => {
    expect(canvasPageIdFromEditorId('group1:canvas:abc-123')).toBe('abc-123');
    expect(canvasPageIdFromEditorId('x:database:p-9')).toBe('p-9');
  });
  it('accepts a bare UUID', () => {
    const uuid = '12345678-1234-1234-1234-123456789abc';
    expect(canvasPageIdFromEditorId(uuid)).toBe(uuid);
  });
  it('returns undefined for non-canvas editor ids', () => {
    expect(canvasPageIdFromEditorId('group1:text:src/foo.ts')).toBeUndefined();
    expect(canvasPageIdFromEditorId(undefined)).toBeUndefined();
  });
});
