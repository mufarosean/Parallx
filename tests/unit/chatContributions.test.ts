// chatContributions.test.ts — chat skills and slash commands a tool brings
// while it runs: offered beside the workspace's own, never written into the
// workspace, gone when the tool is turned off.

import { describe, it, expect } from 'vitest';
import { registerContributedSkill, registerContributedSlashCommand, getContributedSkills, contributedSkillFile } from '../../src/services/chatContributions';
import { SkillLoaderService } from '../../src/services/skillLoaderService';
import { createReadFileTool } from '../../src/built-in/chat/tools/fileTools';

const skill = (name: string, desc = 'Does a thing.') => `---\nname: ${name}\ndescription: ${desc}\nversion: 1.0.0\nkind: workflow\n---\n\n# ${name}\n\nSteps.\n`;

describe('skills a tool brings', () => {
  it('appear in the skill list while the tool runs; a workspace skill of the same name wins', async () => {
    const loader = new SkillLoaderService();
    const files: Record<string, string> = { '.parallx/skills/mine/SKILL.md': skill('mine', 'My own.') };
    loader.setFileSystem({
      readFile: async (p) => files[p],
      listDirs: async () => Object.keys(files).map((k) => k.split('/')[2]),
      exists: async (p) => p === '.parallx/skills' || p in files,
      listFiles: async () => [],
    } as any);
    await loader.scanSkills();
    const d1 = registerContributedSkill('tool-skill', { content: skill('tool-skill'), ownerToolId: 'acme' });
    const d2 = registerContributedSkill('mine', { content: skill('mine', 'The tool\'s.'), ownerToolId: 'acme' });
    loader.setContributedSkills(getContributedSkills());
    expect(loader.skills.map((s) => s.name).sort()).toEqual(['mine', 'tool-skill']);
    expect(loader.getSkill('mine')?.description).toBe('My own.');
    expect(loader.getSkill('tool-skill')?.relativePath).toBe('.parallx/skills/tool-skill/SKILL.md');
    await loader.scanSkills(); // a rescan of the workspace keeps the tool's
    expect(loader.getSkill('tool-skill')).toBeDefined();
    d1.dispose(); d2.dispose(); // the tool is turned off
    loader.setContributedSkills(getContributedSkills());
    expect(loader.skills.map((s) => s.name)).toEqual(['mine']);
  });

  it('the model reads a tool skill by its location, with no file in the workspace', async () => {
    const d = registerContributedSkill('tool-skill', { content: skill('tool-skill'), ownerToolId: 'acme' });
    expect(contributedSkillFile('.parallx/skills/tool-skill/SKILL.md')).toContain('# tool-skill');
    const tool = createReadFileTool({
      workspaceRootName: 'ws',
      readdir: async () => [],
      exists: async () => false,
      readFileContent: async () => { throw new Error('ENOENT'); },
    });
    const r = await tool.handler({ path: '.parallx/skills/tool-skill/SKILL.md' }, { isCancellationRequested: false } as any);
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('# tool-skill');
    d.dispose();
    const gone = await tool.handler({ path: '.parallx/skills/tool-skill/SKILL.md' }, { isCancellationRequested: false } as any);
    expect(gone.isError).toBe(true);
  });

  it('names are checked and cannot be taken from another tool', () => {
    expect(() => registerContributedSlashCommand({ name: 'Bad Name', description: '', promptTemplate: 'x', ownerToolId: 'a' })).toThrow();
    const d = registerContributedSlashCommand({ name: 'go', description: '', promptTemplate: 'x {input}', ownerToolId: 'a' });
    expect(() => registerContributedSlashCommand({ name: 'go', description: '', promptTemplate: 'y', ownerToolId: 'b' })).toThrow(/already registered/);
    d.dispose();
  });
});
