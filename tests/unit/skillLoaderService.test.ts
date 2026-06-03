// Unit tests for skillLoaderService — M39 Phase A

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseSkillFrontmatter,
  validateSkillManifest,
  manifestToToolDefinition,
  SkillLoaderService,
} from '../../src/services/skillLoaderService';
import type { ISkillManifest, ISkillFileSystem } from '../../src/services/skillLoaderService';

// ═══════════════════════════════════════════════════════════════════════════════
// parseSkillFrontmatter
// ═══════════════════════════════════════════════════════════════════════════════

describe('parseSkillFrontmatter', () => {
  it('parses basic tool skill frontmatter', () => {
    const content = `---
name: fs_read_file
description: Read the contents of a file
version: 1.0.0
author: parallx
permission: always-allowed
tags: [filesystem, read]
---

# fs_read_file
Some body content.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter['name']).toBe('fs_read_file');
    expect(result!.frontmatter['description']).toBe('Read the contents of a file');
    expect(result!.frontmatter['tags']).toEqual(['filesystem', 'read']);
    expect(result!.body).toContain('# fs_read_file');
  });

  it('parses workflow skill with kind field', () => {
    const content = `---
name: exhaustive-summary
description: Summarize every file in the workspace
kind: workflow
tags: [workflow, summary]
---

# Exhaustive Summary
Step-by-step instructions.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter['kind']).toBe('workflow');
  });

  it('parses hyphenated keys (disable-model-invocation)', () => {
    const content = `---
name: my-skill
description: A skill
disable-model-invocation: true
user-invocable: false
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter['disable-model-invocation']).toBe(true);
    expect(result!.frontmatter['user-invocable']).toBe(false);
  });

  it('parses camelCase keys (disableModelInvocation)', () => {
    const content = `---
name: my-skill
description: A skill
disableModelInvocation: true
userInvocable: false
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter['disableModelInvocation']).toBe(true);
    expect(result!.frontmatter['userInvocable']).toBe(false);
  });

  it('parses YAML folded scalar (>)', () => {
    const content = `---
name: my-skill
description: >
  Summarize every file in the workspace.
  Use when the user asks to summarize all files.
version: 1.0.0
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter['description']).toBe(
      'Summarize every file in the workspace. Use when the user asks to summarize all files.',
    );
  });

  it('parses YAML literal scalar (|)', () => {
    const content = `---
name: my-skill
description: |
  Line one.
  Line two.
version: 1.0.0
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.frontmatter['description']).toBe('Line one.\nLine two.');
  });

  it('parses parameters list', () => {
    const content = `---
name: fs_read_file
description: Read a file
parameters:
  - name: path
    type: string
    description: File path
    required: true
tags: []
---

Body.`;

    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    const params = result!.frontmatter['parameters'] as Record<string, unknown>[];
    expect(params).toHaveLength(1);
    expect(params[0]['name']).toBe('path');
    expect(params[0]['type']).toBe('string');
    expect(params[0]['required']).toBe(true);
  });

  it('returns null for content without frontmatter', () => {
    expect(parseSkillFrontmatter('# Just a heading')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateSkillManifest
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateSkillManifest', () => {
  it('returns null when name is missing', () => {
    const parsed = { frontmatter: { description: 'A skill' }, body: '' };
    expect(validateSkillManifest(parsed, 'test')).toBeNull();
  });

  it('returns null when description is missing', () => {
    const parsed = { frontmatter: { name: 'my-skill' }, body: '' };
    expect(validateSkillManifest(parsed, 'test')).toBeNull();
  });

  it('defaults kind to "tool" when omitted', () => {
    const parsed = { frontmatter: { name: 'my-tool', description: 'A tool' }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest).not.toBeNull();
    expect(manifest!.kind).toBe('tool');
  });

  it('accepts kind: "workflow"', () => {
    const parsed = { frontmatter: { name: 'my-wf', description: 'A workflow', kind: 'workflow' }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.kind).toBe('workflow');
  });

  it('falls back to "tool" for invalid kind values', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y', kind: 'invalid' }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.kind).toBe('tool');
  });

  it('defaults disableModelInvocation to false', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y' }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.disableModelInvocation).toBe(false);
  });

  it('reads disableModelInvocation from camelCase key', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y', disableModelInvocation: true }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.disableModelInvocation).toBe(true);
  });

  it('reads disable-model-invocation from hyphenated key', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y', 'disable-model-invocation': true }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.disableModelInvocation).toBe(true);
  });

  it('defaults userInvocable to true', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y' }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.userInvocable).toBe(true);
  });

  it('reads userInvocable: false', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y', userInvocable: false }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.userInvocable).toBe(false);
  });

  it('reads user-invocable: false (hyphenated)', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y', 'user-invocable': false }, body: '' };
    const manifest = validateSkillManifest(parsed, 'test');
    expect(manifest!.userInvocable).toBe(false);
  });

  it('preserves body content', () => {
    const parsed = { frontmatter: { name: 'x', description: 'y' }, body: '# Instructions\nDo this.' };
    const manifest = validateSkillManifest(parsed, 'skills/x/SKILL.md');
    expect(manifest!.body).toBe('# Instructions\nDo this.');
    expect(manifest!.relativePath).toBe('skills/x/SKILL.md');
  });

  it('validates a complete workflow skill manifest', () => {
    const parsed = {
      frontmatter: {
        name: 'exhaustive-summary',
        description: 'Summarize every file in the workspace.',
        version: '1.0.0',
        author: 'parallx',
        kind: 'workflow',
        permission: 'always-allowed',
        tags: ['workflow', 'summary', 'exhaustive'],
        disableModelInvocation: false,
        userInvocable: true,
      },
      body: '# Exhaustive Summary\n\nStep 1: Enumerate files...',
    };

    const manifest = validateSkillManifest(parsed, '.parallx/skills/exhaustive-summary/SKILL.md');
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe('exhaustive-summary');
    expect(manifest!.kind).toBe('workflow');
    expect(manifest!.disableModelInvocation).toBe(false);
    expect(manifest!.userInvocable).toBe(true);
    expect(manifest!.tags).toEqual(['workflow', 'summary', 'exhaustive']);
    expect(manifest!.permission).toBe('always-allowed');
    expect(manifest!.body).toContain('Step 1');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// manifestToToolDefinition
// ═══════════════════════════════════════════════════════════════════════════════

describe('manifestToToolDefinition', () => {
  it('converts a tool manifest to IChatTool', () => {
    const manifest: ISkillManifest = {
      name: 'fs_read_file',
      description: 'Read a file',
      version: '1.0.0',
      author: 'parallx',
      permission: 'always-allowed',
      parameters: [{ name: 'path', type: 'string', description: 'File path', required: true }],
      tags: ['filesystem'],
      body: '',
      relativePath: '.parallx/skills/fs_read_file/SKILL.md',
      kind: 'tool',
      disableModelInvocation: false,
      userInvocable: true,
    };

    const tool = manifestToToolDefinition(manifest);
    expect(tool.name).toBe('fs_read_file');
    expect(tool.requiresConfirmation).toBe(false);
    expect((tool.parameters as any).properties['path']).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SkillLoaderService
// ═══════════════════════════════════════════════════════════════════════════════

describe('SkillLoaderService', () => {
  let service: SkillLoaderService;
  let mockFs: ISkillFileSystem;

  const TOOL_SKILL = `---
name: fs_read_file
description: Read a file
version: 1.0.0
permission: always-allowed
tags: [filesystem]
---

Read file body.`;

  const WORKFLOW_SKILL = `---
name: exhaustive-summary
description: Summarize every file in the workspace
version: 1.0.0
kind: workflow
tags: [workflow, summary, exhaustive]
---

# Exhaustive Summary Workflow

1. Call fs_list_files
2. For each file, call fs_read_file
3. Produce a summary`;

  beforeEach(() => {
    service = new SkillLoaderService();
    mockFs = {
      readFile: vi.fn(async (path: string) => {
        if (path.includes('fs_read_file')) { return TOOL_SKILL; }
        if (path.includes('exhaustive-summary')) { return WORKFLOW_SKILL; }
        return '';
      }),
      listDirs: vi.fn(async () => ['fs_read_file', 'exhaustive-summary']),
      exists: vi.fn(async () => true),
    };
    service.setFileSystem(mockFs);
  });

  it('scans and loads both tool and workflow skills', async () => {
    await service.scanSkills();
    expect(service.skills).toHaveLength(2);

    const toolSkill = service.getSkill('fs_read_file');
    expect(toolSkill).toBeDefined();
    expect(toolSkill!.kind).toBe('tool');

    const wfSkill = service.getSkill('exhaustive-summary');
    expect(wfSkill).toBeDefined();
    expect(wfSkill!.kind).toBe('workflow');
  });

  it('emits change event with both skill types', async () => {
    const listener = vi.fn();
    service.onDidChangeSkills(listener);

    await service.scanSkills();

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0];
    expect(event.added).toHaveLength(2);
    expect(event.removed).toHaveLength(0);
  });

  it('getToolDefinitions returns tool skills only (workflow skills have no tool parameters)', async () => {
    await service.scanSkills();
    const tools = service.getToolDefinitions();
    // Only tool-kind skills produce tool definitions
    expect(tools).toHaveLength(1);
  });

  it('getSkillCatalog filtered for workflow returns only workflow skills', async () => {
    await service.scanSkills();
    const catalog = service.getSkillCatalog().filter(s => s.kind === 'workflow');
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe('exhaustive-summary');
    expect(catalog[0].kind).toBe('workflow');
    expect(catalog[0].tags).toContain('workflow');
  });

  it('getWorkflowSkillCatalog excludes disableModelInvocation skills', async () => {
    const PRIVATE_WF = `---
name: private-workflow
description: A private workflow
kind: workflow
disableModelInvocation: true
tags: [workflow]
---

Private instructions.`;

    (mockFs.listDirs as ReturnType<typeof vi.fn>).mockResolvedValue([
      'fs_read_file', 'exhaustive-summary', 'private-workflow',
    ]);
    (mockFs.readFile as ReturnType<typeof vi.fn>).mockImplementation(async (path: string) => {
      if (path.includes('fs_read_file')) { return TOOL_SKILL; }
      if (path.includes('exhaustive-summary')) { return WORKFLOW_SKILL; }
      if (path.includes('private-workflow')) { return PRIVATE_WF; }
      return '';
    });

    await service.scanSkills();
    const catalog = service.getSkillCatalog().filter(s => s.kind === 'workflow' && !s.disableModelInvocation);
    expect(catalog).toHaveLength(1);
    expect(catalog[0].name).toBe('exhaustive-summary');
  });

  it('reload removes a deleted skill', async () => {
    await service.scanSkills();
    expect(service.skills).toHaveLength(2);

    // Mock deletion
    (mockFs.exists as ReturnType<typeof vi.fn>).mockResolvedValue(false);

    const listener = vi.fn();
    service.onDidChangeSkills(listener);

    await service.reloadSkill('fs_read_file');

    expect(service.getSkill('fs_read_file')).toBeUndefined();
    expect(listener).toHaveBeenCalledWith({ added: [], removed: ['fs_read_file'] });
  });

  // M81 Phase 6 — bundled scripts/references/assets discovery
  it('discovers bundled files under scripts/, references/, assets/ (agentskills.io subfolder alignment)', async () => {
    const TEST_SKILL = `---
name: test-skill
description: A skill with bundled files
version: 1.0.0
permission: always-allowed
tags: [test]
---

Body.`;

    const fs: ISkillFileSystem = {
      readFile: vi.fn(async () => TEST_SKILL),
      listDirs: vi.fn(async (parent: string) => {
        if (parent === '.parallx/skills') { return ['test-skill']; }
        return [];
      }),
      listFiles: vi.fn(async (parent: string) => {
        if (parent === '.parallx/skills/test-skill/scripts') {
          return ['helper.py'];
        }
        if (parent === '.parallx/skills/test-skill/references') {
          return ['notes.md'];
        }
        if (parent === '.parallx/skills/test-skill/assets') {
          return [];
        }
        return [];
      }),
      exists: vi.fn(async (path: string) => {
        // Skill SKILL.md + the three bundle folders all exist
        if (path === '.parallx/skills' || path.endsWith('SKILL.md')) { return true; }
        if (path === '.parallx/skills/test-skill/scripts') { return true; }
        if (path === '.parallx/skills/test-skill/references') { return true; }
        if (path === '.parallx/skills/test-skill/assets') { return true; }
        return false;
      }),
    };

    const svc = new SkillLoaderService();
    svc.setFileSystem(fs);
    await svc.scanSkills();

    const catalog = svc.getSkillCatalog();
    expect(catalog).toHaveLength(1);
    const entry = catalog[0];
    expect(entry.name).toBe('test-skill');
    expect(entry.bundledFiles).toEqual([
      '.parallx/skills/test-skill/references/notes.md',
      '.parallx/skills/test-skill/scripts/helper.py',
    ]);
  });

  it('emits empty bundledFiles when no subfolders exist (existing skills load unchanged)', async () => {
    await service.scanSkills();
    const catalog = service.getSkillCatalog();
    expect(catalog).toHaveLength(2);
    for (const entry of catalog) {
      expect(entry.bundledFiles).toEqual([]);
    }
  });

  it('does not call listFiles when filesystem does not provide it (backward compatible)', async () => {
    // Mock fs without listFiles — should not throw, bundledFiles stays []
    const fs: ISkillFileSystem = {
      readFile: vi.fn(async () => `---
name: legacy-skill
description: No bundle support
tags: []
---
body`),
      listDirs: vi.fn(async () => ['legacy-skill']),
      exists: vi.fn(async () => true),
    };
    const svc = new SkillLoaderService();
    svc.setFileSystem(fs);
    await svc.scanSkills();
    const catalog = svc.getSkillCatalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0].bundledFiles).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// End-to-end: parse → validate for workflow SKILL.md content
// ═══════════════════════════════════════════════════════════════════════════════

describe('workflow skill round-trip', () => {
  it('parses and validates a full workflow SKILL.md', () => {
    const content = `---
name: exhaustive-summary
description: >
  Summarize every file in the workspace or a specified folder.
  Use when the user asks to summarize all files, each file,
  or every document in the workspace.
version: 1.0.0
author: parallx
kind: workflow
permission: always-allowed
tags: [workflow, summary, exhaustive]
---

# Exhaustive File Summary

When the user asks to summarize all/each/every file:

1. **Enumerate**: Call fs_list_files to get the complete file list
2. **Iterate**: For each file, call fs_read_file
3. **Combine**: Present all summaries
4. **Verify coverage**: Count your summaries against the file list`;

    const parsed = parseSkillFrontmatter(content);
    expect(parsed).not.toBeNull();

    const manifest = validateSkillManifest(parsed!, '.parallx/skills/exhaustive-summary/SKILL.md');
    expect(manifest).not.toBeNull();
    expect(manifest!.name).toBe('exhaustive-summary');
    expect(manifest!.kind).toBe('workflow');
    expect(manifest!.description).toContain('Summarize every file');
    expect(manifest!.description).toContain('each file');
    expect(manifest!.tags).toContain('workflow');
    expect(manifest!.tags).toContain('exhaustive');
    expect(manifest!.body).toContain('Exhaustive File Summary');
    expect(manifest!.body).toContain('**Enumerate**');
    expect(manifest!.disableModelInvocation).toBe(false);
    expect(manifest!.userInvocable).toBe(true);
  });
});
