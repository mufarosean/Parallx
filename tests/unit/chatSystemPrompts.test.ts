// Unit tests for chatSystemPrompts — M9 Cap 4 Task 4.2

import { describe, it, expect } from 'vitest';
import { ChatMode } from '../../src/services/chatTypes';
import { buildSystemPrompt } from '../../src/built-in/chat/chatSystemPrompts';
import type { ISystemPromptContext } from '../../src/built-in/chat/chatSystemPrompts';
import type { IToolDefinition } from '../../src/services/chatTypes';

// ── Helpers ──

function makeContext(overrides?: Partial<ISystemPromptContext>): ISystemPromptContext {
  return {
    workspaceName: 'Test Workspace',
    pageCount: 5,
    currentPageTitle: undefined,
    tools: undefined,
    ...overrides,
  };
}

function makeTool(name: string, description: string): IToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
      },
    },
  };
}

// ── buildSystemPrompt — mode dispatch ──

describe('buildSystemPrompt', () => {
  it('returns a non-empty string for each mode', () => {
    const ctx = makeContext();
    for (const mode of [ChatMode.Ask, ChatMode.Edit, ChatMode.Agent]) {
      const prompt = buildSystemPrompt(mode, ctx);
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it('produces different prompts for each mode', () => {
    const ctx = makeContext();
    const ask = buildSystemPrompt(ChatMode.Ask, ctx);
    const edit = buildSystemPrompt(ChatMode.Edit, ctx);
    const agent = buildSystemPrompt(ChatMode.Agent, ctx);
    expect(ask).not.toBe(edit);
    expect(edit).not.toBe(agent);
    expect(ask).not.toBe(agent);
  });
});

// ── Ask mode ──

describe('buildSystemPrompt — Ask mode', () => {
  it('includes workspace name', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext());
    expect(prompt).toContain('Test Workspace');
  });

  it('includes page count', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext({ pageCount: 12 }));
    expect(prompt).toContain('12 canvas pages');
  });

  it('includes current page title when provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext({ currentPageTitle: 'My Note' }));
    expect(prompt).toContain('My Note');
  });

  it('omits page title line when not provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext({ currentPageTitle: undefined }));
    expect(prompt).not.toContain('currently viewing');
  });

  it('handles singular page count correctly', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext({ pageCount: 1 }));
    expect(prompt).toContain('1 canvas page');
    expect(prompt).not.toContain('1 canvas pages');
  });

  it('indicates read-only tool access', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext());
    expect(prompt).toMatch(/cannot create.*modify.*delete/i);
  });
});

// ── Edit mode ──

describe('buildSystemPrompt — Edit mode', () => {
  it('includes workspace name', () => {
    const prompt = buildSystemPrompt(ChatMode.Edit, makeContext());
    expect(prompt).toContain('Test Workspace');
  });

  it('includes edit JSON schema', () => {
    const prompt = buildSystemPrompt(ChatMode.Edit, makeContext());
    expect(prompt).toContain('"operation"');
    expect(prompt).toContain('"edits"');
    expect(prompt).toContain('"explanation"');
  });

  it('mentions insert, update, delete operations', () => {
    const prompt = buildSystemPrompt(ChatMode.Edit, makeContext());
    expect(prompt).toContain('insert');
    expect(prompt).toContain('update');
    expect(prompt).toContain('delete');
  });

  it('mentions Edit mode', () => {
    const prompt = buildSystemPrompt(ChatMode.Edit, makeContext());
    expect(prompt).toMatch(/edit mode/i);
  });

  it('includes current page title when provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Edit, makeContext({ currentPageTitle: 'Research Notes' }));
    expect(prompt).toContain('Research Notes');
  });
});

// ── Agent mode ──

describe('buildSystemPrompt — Agent mode', () => {
  it('includes workspace name', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toContain('Test Workspace');
  });

  it('includes agent identity', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toMatch(/agent/i);
  });

  it('omits tool section when no tools provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ tools: [] }));
    expect(prompt).not.toContain('tools available');
  });

  it('includes tool descriptions when tools are provided', () => {
    const tools = [
      makeTool('search', 'Search the workspace'),
      makeTool('read_page', 'Read a page by ID'),
    ];
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ tools }));
    expect(prompt).toContain('search');
    expect(prompt).toContain('Search the workspace');
    expect(prompt).toContain('read_page');
    expect(prompt).toContain('Read a page by ID');
  });

  it('includes tool parameter details', () => {
    const tools = [makeTool('search', 'Search workspace')];
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ tools }));
    expect(prompt).toContain('query');
  });

  it('includes reasoning guidelines', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toContain('Guidelines');
  });

  it('mentions user confirmation for write tools', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toMatch(/confirmation/i);
  });
});

// ── Edge cases ──

describe('buildSystemPrompt — edge cases', () => {
  it('handles zero pages', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext({ pageCount: 0 }));
    expect(prompt).toContain('0 canvas pages');
  });

  it('handles empty workspace name', () => {
    const prompt = buildSystemPrompt(ChatMode.Ask, makeContext({ workspaceName: '' }));
    expect(prompt).toContain('""');
  });

  it('falls back to Ask prompt for unknown mode', () => {
    // TypeScript enum should prevent this, but just in case
    const prompt = buildSystemPrompt('unknown' as ChatMode, makeContext());
    expect(prompt).toBeTruthy();
  });
});
