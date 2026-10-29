// skillDrafts.test.ts — the AI drafts a skill; you decide
// (docs/SKILL_AUTHORING_BRIEF.md steps 1 and 2).
import { describe, it, expect, vi } from 'vitest';
import { createSkillDraftTool, draftSkillFile } from '../../src/built-in/chat/tools/skillDraftTool';
import { registerSkillDraftCommands } from '../../src/built-in/chat/utilities/skillDraftCommands';
import { SkillLoaderService, parseSkillFrontmatter, validateSkillManifest } from '../../src/services/skillLoaderService';
import { URI } from '../../src/platform/uri';

const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as never;

describe('skill drafts', () => {
  it('skill_draft writes a draft the loader can parse, marked as the agent\'s, into _drafts only', async () => {
    const writes = new Map<string, string>();
    const tool = createSkillDraftTool({ writeFile: async (p, c) => { writes.set(p, c); }, isPathAllowed: () => true });
    const r = await tool.handler({ name: 'weekly-budget-review', description: 'When the user asks to review: the week\'s spending', steps: '1. Read {{account}}\n2. Flag anything over budget (changes things)', allowedTools: ['budget_summary', 'bad name!'] }, token, { sessionId: 'chat-9' });
    expect(r.isError).toBeFalsy();
    const [path, text] = [...writes][0];
    expect(path).toBe('.parallx/skills/_drafts/weekly-budget-review/SKILL.md');
    const parsed = parseSkillFrontmatter(text)!;
    expect(validateSkillManifest(parsed, path)?.name).toBe('weekly-budget-review');
    expect(parsed.frontmatter['description']).toBe('When the user asks to review: the week\'s spending');
    expect(parsed.frontmatter['source']).toBe('agent');
    expect(parsed.frontmatter['derived-from']).toBe('chat-9');
    expect(text).toContain('allowed-tools: [budget_summary]');
    expect(text).toContain('{{account}}');
  });

  it('refuses a bad name or a missing part', async () => {
    const tool = createSkillDraftTool({ writeFile: vi.fn(), isPathAllowed: () => true });
    expect((await tool.handler({ name: '../escape', description: 'd', steps: 's' }, token)).isError).toBe(true);
    expect((await tool.handler({ name: 'ok-name', description: '', steps: 's' }, token)).isError).toBe(true);
  });

  it('the loader never loads a draft', async () => {
    const service = new SkillLoaderService();
    const listDirs = vi.fn(async () => ['_drafts', 'real-skill']);
    service.setFileSystem({
      listDirs, exists: vi.fn(async () => true),
      readFile: vi.fn(async (p: string) => draftSkillFile({ name: p.includes('_drafts') ? 'drafted' : 'real-skill', description: 'x', steps: '1. y' })),
    } as never);
    await service.scanSkills();
    expect(service.skills.map((s) => s.name)).toEqual(['real-skill']);
  });

  it('Add moves the draft into the skills folder; a name in use is refused; Dismiss trashes it', async () => {
    const root = URI.parse('file:///ws');
    const present = new Set(['file:///ws/.parallx/skills/_drafts', 'file:///ws/.parallx/skills/_drafts/tidy-notes', 'file:///ws/.parallx/skills/_drafts/tidy-notes/SKILL.md', 'file:///ws/.parallx/skills/_drafts/dup', 'file:///ws/.parallx/skills/_drafts/dup/SKILL.md', 'file:///ws/.parallx/skills/dup']);
    const files = {
      exists: vi.fn(async (u: URI) => present.has(u.toString())),
      readdir: vi.fn(async () => [{ name: 'tidy-notes', type: 2 }, { name: 'dup', type: 2 }]),
      readFile: vi.fn(async () => ({ content: draftSkillFile({ name: 'tidy-notes', description: 'Tidy my notes', steps: '1. a', sessionId: 's1' }) })),
      rename: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
    };
    const map = new Map<string, (...a: unknown[]) => unknown>();
    registerSkillDraftCommands({ registerCommand: (id, fn) => { map.set(id, fn); return { dispose() {} }; } }, files, () => root, vi.fn());

    const list = await map.get('parallx.skills.drafts')!() as { drafts: { name: string; description: string; derivedFrom?: string }[] };
    expect(list.drafts.map((d) => d.name)).toEqual(['dup', 'tidy-notes']);
    expect(list.drafts[1]).toMatchObject({ description: 'Tidy my notes', derivedFrom: 's1' });

    expect(await map.get('parallx.skills.addDraft')!('tidy-notes')).toEqual({ added: true });
    expect(files.rename.mock.calls[0].map(String)).toEqual(['file:///ws/.parallx/skills/_drafts/tidy-notes', 'file:///ws/.parallx/skills/tidy-notes']);
    expect(await map.get('parallx.skills.addDraft')!('dup')).toMatchObject({ added: false, reason: expect.stringContaining('already exists') });

    expect(await map.get('parallx.skills.dismissDraft')!('tidy-notes')).toBe(true);
    expect(files.delete).toHaveBeenCalledWith(expect.anything(), { recursive: true, useTrash: true });
    expect(await map.get('parallx.skills.addDraft')!('../../etc')).toMatchObject({ added: false });
  });
});
