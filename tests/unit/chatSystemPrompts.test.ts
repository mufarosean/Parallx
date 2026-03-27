// Unit tests for chatSystemPrompts — M9 Cap 4 Task 4.2, M10 Phase 4

import { describe, it, expect } from 'vitest';
import { ChatMode } from '../../src/services/chatTypes';
import { buildSystemPrompt } from '../../src/built-in/chat/config/chatSystemPrompts';
import type { ISystemPromptContext } from '../../src/built-in/chat/config/chatSystemPrompts';
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
    for (const mode of [ChatMode.Agent, ChatMode.Edit, ChatMode.Agent]) {
      const prompt = buildSystemPrompt(mode, ctx);
      expect(prompt).toBeTruthy();
      expect(typeof prompt).toBe('string');
      expect(prompt.length).toBeGreaterThan(50);
    }
  });

  it('produces different prompts for each mode', () => {
    const ctx = makeContext();
    const ask = buildSystemPrompt(ChatMode.Agent, ctx);
    const edit = buildSystemPrompt(ChatMode.Edit, ctx);
    const agent = buildSystemPrompt(ChatMode.Agent, ctx);
    // M41 Phase 9: Ask now shares Agent prompt
    expect(ask).toBe(agent);
    expect(edit).not.toBe(agent);
  });
});

// ── Parallx identity (Task 4.2) ──

describe('buildSystemPrompt — Parallx identity', () => {
  it('includes Parallx identity in Agent mode', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toContain('Parallx AI');
    expect(prompt).toContain('second-brain');
  });

  it('mentions Ollama and local-only', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toContain('Ollama');
    expect(prompt).toContain('locally');
  });
});

// ── Agent mode context ──

describe('buildSystemPrompt — Agent mode context', () => {
  it('includes workspace name', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toContain('Test Workspace');
  });

  it('includes page count', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ pageCount: 12 }));
    expect(prompt).toContain('12 canvas pages');
  });

  it('includes file count when provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ fileCount: 42 }));
    expect(prompt).toContain('42 files');
  });

  it('omits file count when zero or undefined', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ fileCount: 0 }));
    expect(prompt).not.toContain('0 file');
  });

  it('includes current page title when provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ currentPageTitle: 'My Note' }));
    expect(prompt).toContain('My Note');
  });

  it('omits page title line when not provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ currentPageTitle: undefined }));
    expect(prompt).not.toContain('Currently viewing');
  });

  it('handles singular page count correctly', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ pageCount: 1 }));
    expect(prompt).toContain('1 canvas page');
    expect(prompt).not.toContain('1 canvas pages');
  });

  it('includes RAG context note when RAG is available', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ isRAGAvailable: true }));
    expect(prompt).toContain('semantic search');
  });

  it('includes tool-first guidance for coverage and enumeration tasks', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ isRAGAvailable: true }));
    expect(prompt).toContain('For exhaustive file-by-file or folder-wide coverage');
    expect(prompt).toContain('use read-only tools to enumerate and read the relevant files');
    expect(prompt).toContain('ALWAYS verify with tools');
  });

  it('omits RAG note when RAG is not available', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ isRAGAvailable: false }));
    expect(prompt).not.toContain('semantic search');
  });

  it('shows indexing status when indexing', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ isIndexing: true }));
    expect(prompt).toContain('building');
  });

  it('shows ready status when RAG is ready', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ isRAGAvailable: true, isIndexing: false }));
    expect(prompt).toContain('ready');
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
    expect(prompt).toMatch(/agent mode/i);
  });

  it('frames Agent mode as authority expansion rather than wakefulness', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toContain('the AI is already awake');
    expect(prompt).toContain('Modes gate authority, not wakefulness');
  });

  it('omits tool section when no tools provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ tools: [] }));
    // The "TOOLS:" section listing individual tools should be absent.
    expect(prompt).not.toMatch(/^TOOLS:\s*$/m);
    expect(prompt).not.toContain('- search:');
  });

  it('does NOT include tool descriptions in prompt text (tools sent via API parameter)', () => {
    const tools = [
      makeTool('search', 'Search the workspace'),
      makeTool('read_page', 'Read a page by ID'),
    ];
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ tools }));
    // Tool descriptions should NOT appear in the system prompt — they are sent
    // via the Ollama API tools parameter to prevent small models from narrating
    // about tool calls instead of using the structured tool API.
    expect(prompt).not.toContain('- search:');
    expect(prompt).not.toContain('- read_page:');
    expect(prompt).not.toMatch(/^TOOLS:/m);
  });

  it('does NOT include tool parameter details in prompt text', () => {
    const tools = [makeTool('search', 'Search workspace')];
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ tools }));
    // Parameters should not appear in the system prompt text
    expect(prompt).not.toContain('query: string');
  });

  it('includes rules section', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toContain('RULES');
  });

  it('includes tool-first guidance in Agent mode too', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ isRAGAvailable: true }));
    expect(prompt).toContain('For exhaustive file-by-file or folder-wide coverage');
    expect(prompt).toContain('ALWAYS verify with tools');
  });

  it('mentions user confirmation for write tools', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext());
    expect(prompt).toMatch(/confirm/i);
  });
});

// ── Token budget ──

describe('buildSystemPrompt — token budget', () => {
  it('keeps Ask prompt under 2000 tokens (estimated chars/4)', () => {
    const tools = Array.from({ length: 11 }, (_, i) => makeTool(`tool_${i}`, `Description for tool ${i}`));
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({
      tools,
      currentPageTitle: 'My Long Page Title',
      fileCount: 100,
      isRAGAvailable: true,
    }));
    expect(Math.ceil(prompt.length / 4)).toBeLessThan(2000);
  });

  it('keeps Agent prompt under 2000 tokens (estimated chars/4)', () => {
    const tools = Array.from({ length: 11 }, (_, i) => makeTool(`tool_${i}`, `Description for tool ${i}`));
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({
      tools,
      currentPageTitle: 'My Long Page Title',
      fileCount: 100,
      isRAGAvailable: true,
    }));
    expect(Math.ceil(prompt.length / 4)).toBeLessThan(2000);
  });
});

// ── Edge cases ──

describe('buildSystemPrompt — edge cases', () => {
  it('handles zero pages', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ pageCount: 0 }));
    expect(prompt).toContain('0 canvas pages');
  });

  it('handles empty workspace name', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ workspaceName: '' }));
    expect(prompt).toContain('""');
  });

  it('falls back to Ask prompt for unknown mode', () => {
    // TypeScript enum should prevent this, but just in case
    const prompt = buildSystemPrompt('unknown' as ChatMode, makeContext());
    expect(prompt).toBeTruthy();
  });

  it('does not include page name or file name listings', () => {
    // M10 Phase 4: static listings removed in favour of RAG
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ pageCount: 5 }));
    expect(prompt).not.toContain('Canvas pages in this workspace:');
    expect(prompt).not.toContain('Files and folders at the workspace root:');
  });
});

// ── M39: Skill catalog injection ──

describe('buildSystemPrompt — skill catalog', () => {
  const catalogEntries = [
    { name: 'exhaustive-summary', description: 'Summarize every file in the workspace', kind: 'workflow' as const, tags: ['workflow', 'summary'] },
    { name: 'folder-overview', description: 'Overview of a folder structure', kind: 'workflow' as const, tags: ['workflow', 'overview'] },
  ];

  it('includes skill catalog section when skills are provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ skillCatalog: catalogEntries }));
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('</available_skills>');
    expect(prompt).toContain('exhaustive-summary');
    expect(prompt).toContain('folder-overview');
  });

  it('includes skill catalog section in Agent mode', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ skillCatalog: catalogEntries }));
    expect(prompt).toContain('<available_skills>');
    expect(prompt).toContain('exhaustive-summary');
  });

  it('omits skill catalog when no skills provided', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ skillCatalog: undefined }));
    expect(prompt).not.toContain('<available_skills>');
  });

  it('omits skill catalog when empty array', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ skillCatalog: [] }));
    expect(prompt).not.toContain('<available_skills>');
  });

  it('does not include skill catalog in Edit mode', () => {
    const prompt = buildSystemPrompt(ChatMode.Edit, makeContext({ skillCatalog: catalogEntries }));
    expect(prompt).not.toContain('<available_skills>');
  });

  it('includes behavioral instruction text', () => {
    const prompt = buildSystemPrompt(ChatMode.Agent, makeContext({ skillCatalog: catalogEntries }));
    expect(prompt).toContain('Skills (mandatory)');
    expect(prompt).toContain('read its SKILL.md at <location>');
  });

  it('skill catalog adds reasonable token overhead', () => {
    const fourSkills = [
      { name: 'exhaustive-summary', description: 'Summarize every file in the workspace', kind: 'workflow' as const, tags: ['workflow'] },
      { name: 'folder-overview', description: 'Overview of a folder structure', kind: 'workflow' as const, tags: ['workflow'] },
      { name: 'document-comparison', description: 'Compare two or more documents', kind: 'workflow' as const, tags: ['workflow'] },
      { name: 'scoped-extraction', description: 'Extract specific information across scope', kind: 'workflow' as const, tags: ['workflow'] },
    ];

    const withoutSkills = buildSystemPrompt(ChatMode.Agent, makeContext());
    const withSkills = buildSystemPrompt(ChatMode.Agent, makeContext({ skillCatalog: fourSkills }));

    const addedTokens = Math.ceil((withSkills.length - withoutSkills.length) / 4);
    expect(addedTokens).toBeLessThan(500);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// M39 Phase C: buildSkillInstructionSection
// ═══════════════════════════════════════════════════════════════════════════════

import { buildSkillInstructionSection } from '../../src/built-in/chat/config/chatSystemPrompts.js';
import type { IActivatedSkill } from '../../src/built-in/chat/chatTypes.js';

describe('buildSkillInstructionSection', () => {
  const mockSkill: IActivatedSkill = {
    manifest: {
      name: 'exhaustive-summary',
      description: 'Summarize every file',
      version: '1.0.0',
      author: 'parallx',
      permission: 'auto-allow',
      parameters: [],
      tags: ['workflow', 'summary'],
      body: 'Step 1: Enumerate files\nStep 2: Read each\nStep 3: Summarize',
      relativePath: '.parallx/skills/exhaustive-summary/SKILL.md',
      kind: 'workflow',
      disableModelInvocation: false,
      userInvocable: true,
    },
    resolvedBody: 'Step 1: Enumerate files\nStep 2: Read each\nStep 3: Summarize',
    activatedBy: 'planner',
  };

  it('wraps content in <skill_instructions> tags', () => {
    const section = buildSkillInstructionSection(mockSkill);
    expect(section).toContain('<skill_instructions>');
    expect(section).toContain('</skill_instructions>');
  });

  it('includes the skill name', () => {
    const section = buildSkillInstructionSection(mockSkill);
    expect(section).toContain('exhaustive-summary');
  });

  it('includes the resolved body', () => {
    const section = buildSkillInstructionSection(mockSkill);
    expect(section).toContain('Step 1: Enumerate files');
    expect(section).toContain('Step 3: Summarize');
  });

  it('includes activation source', () => {
    const section = buildSkillInstructionSection(mockSkill);
    expect(section).toContain('planner');
  });

  it('includes behavioral instruction for the model', () => {
    const section = buildSkillInstructionSection(mockSkill);
    expect(section).toContain('Follow these step-by-step instructions');
    expect(section).toContain('Do not skip steps');
  });
});
