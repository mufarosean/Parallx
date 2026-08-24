import { describe, expect, it, vi } from 'vitest';

import {
  buildOpenclawSystemPrompt,
  buildSkillsSection,
  buildToolSummariesSection,
  buildWorkspaceSection,
  buildRuntimeSection,
  buildMemorySection,
  estimateSystemPromptTokens,
  type IBootstrapFile,
  type IOpenclawRuntimeInfo,
  type IOpenclawSystemPromptParams,
  type ISkillEntry,
  type IToolSummary,
} from '../../src/openclaw/openclawSystemPrompt';
import { resolveModelTier } from '../../src/openclaw/openclawModelTier';
import { buildOpenclawPromptArtifacts, type IOpenclawPromptArtifactInput } from '../../src/openclaw/openclawPromptArtifacts';
import { buildOpenclawRuntimeSkillState } from '../../src/openclaw/openclawSkillState';
import { buildOpenclawRuntimeToolState } from '../../src/openclaw/openclawToolState';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function createRuntimeInfo(overrides?: Partial<IOpenclawRuntimeInfo>): IOpenclawRuntimeInfo {
  return {
    model: 'qwen2.5:7b-instruct',
    provider: 'ollama',
    host: 'localhost:11434',
    parallxVersion: '0.42.0',
    ...overrides,
  };
}

function createBootstrapFiles(): IBootstrapFile[] {
  return [
    { name: 'SOUL.md', content: 'You are a helpful assistant.' },
    { name: 'AGENTS.md', content: 'Agent definitions here.' },
    { name: 'TOOLS.md', content: 'Tool configuration.' },
  ];
}

function createSkills(): ISkillEntry[] {
  return [
    { name: 'search-workspace', description: 'Search workspace files', location: '/skills/search.md' },
    { name: 'create-document', description: 'Create new documents', location: '/skills/create.md' },
  ];
}

function createTools(): IToolSummary[] {
  return [
    { name: 'readFile', description: 'Read a file from disk' },
    { name: 'searchFiles', description: 'Search files by content' },
  ];
}

function createBaseParams(overrides?: Partial<IOpenclawSystemPromptParams>): IOpenclawSystemPromptParams {
  return {
    bootstrapFiles: createBootstrapFiles(),
    workspaceDigest: 'Project contains insurance policy documents.',
    skills: createSkills(),
    tools: createTools(),
    runtimeInfo: createRuntimeInfo(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// buildOpenclawSystemPrompt — section ordering
// ---------------------------------------------------------------------------

describe('buildOpenclawSystemPrompt', () => {
  it('starts with the persona/identity section (SOUL.md), then skills', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    // Persona leads: SOUL.md is pulled out of Workspace Context and emitted
    // first as `## Identity`, before Skills/Tooling/etc.
    expect(prompt.startsWith('## Identity\n')).toBe(true);
    expect(prompt).toContain('You are a helpful assistant.');
    // Skills still present, just after identity.
    expect(prompt.indexOf('## Skills')).toBeGreaterThan(prompt.indexOf('## Identity'));
  });

  it('includes skills section with scan instruction', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Skills');
    expect(prompt).toContain('Scan <available_skills>');
    expect(prompt).toContain('<available_skills>');
  });

  it('includes upstream-parity skill discipline lines', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    // Mirrors upstream agents/system-prompt.ts buildSkillsSection preamble.
    expect(prompt).toContain('One skill up front max');
    expect(prompt).toContain('Never guess/fabricate skill paths');
    expect(prompt).toContain('External API writes: batch when safe');
  });

  it('omits skills section when no skills provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ skills: [] }));
    expect(prompt).not.toContain('<available_skills>');
    // No skills section emitted at all when list is empty.
    expect(prompt).not.toMatch(/^## Skills\n/m);
  });

  it('includes tool summaries with correct heading', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Tooling');
    // Should NOT have old headings
    expect(prompt).not.toContain('## Available Tools');
    expect(prompt).not.toContain('Tool availability (filtered by policy)');
  });

  it('omits tools section when no tools provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ tools: [] }));
    expect(prompt).not.toContain('## Tooling');
  });

  // ── M85: capability sections are gated on their tool's presence ──

  it('renders ## Planning only when plan_update is in the catalog', () => {
    const without = buildOpenclawSystemPrompt(createBaseParams());
    expect(without).not.toContain('## Planning');

    const withPlan = buildOpenclawSystemPrompt(createBaseParams({
      tools: [...createTools(), { name: 'plan_update', description: 'Maintain your plan' }],
    }));
    expect(withPlan).toContain('## Planning');
    expect(withPlan).toContain('plan_update');
    expect(withPlan).toContain('SURVIVES context compaction');
  });

  it('renders ## Subagents only when sessions_spawn is in the catalog', () => {
    const without = buildOpenclawSystemPrompt(createBaseParams());
    expect(without).not.toContain('## Subagents');

    const withSpawn = buildOpenclawSystemPrompt(createBaseParams({
      tools: [...createTools(), { name: 'sessions_spawn', description: 'Delegate to a subagent' }],
    }));
    expect(withSpawn).toContain('## Subagents');
    expect(withSpawn).toContain('sessions_spawn');
    // The delegation policy: the model is taught WHEN, not just THAT.
    expect(withSpawn).toContain('When to delegate');
    expect(withSpawn).toContain('When NOT to delegate');
    expect(withSpawn).toContain('knows NOTHING about this conversation');
  });

  it('includes workspace context section (persona split out to Identity)', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Workspace Context');
    // SOUL.md is now the top-level `## Identity` section, not a Workspace file.
    expect(prompt).not.toContain('### SOUL.md');
    expect(prompt).toContain('### AGENTS.md');
    expect(prompt).toContain('### Workspace Overview');
  });

  it('includes systemPromptAddition when provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({
      systemPromptAddition: 'Retrieved context: deductible is $500.',
    }));
    expect(prompt).toContain('Retrieved context: deductible is $500.');
  });

  it('includes preferences when provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({
      preferencesPrompt: 'User prefers concise answers.',
    }));
    expect(prompt).toContain('## User Preferences');
    expect(prompt).toContain('User prefers concise answers.');
  });

  it('includes prompt overlay when provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({
      promptOverlay: 'Always cite page numbers.',
    }));
    expect(prompt).toContain('## Active Rules');
    expect(prompt).toContain('Always cite page numbers.');
  });

  // D8-5: Agent identity overlay
  it('includes agent identity section when agentIdentity is provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({
      agentIdentity: { name: 'HelperBot', theme: 'friendly and concise', emoji: '🤖' },
    }));
    expect(prompt).toContain('## Agent Identity');
    expect(prompt).toContain('Name: HelperBot');
    expect(prompt).toContain('Theme: friendly and concise');
    expect(prompt).toContain('Emoji: 🤖');
  });

  it('excludes agent identity section when agentIdentity is undefined', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).not.toContain('## Agent Identity');
  });

  it('includes partial agent identity when only some fields set', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({
      agentIdentity: { name: 'OnlyName' },
    }));
    expect(prompt).toContain('## Agent Identity');
    expect(prompt).toContain('Name: OnlyName');
    expect(prompt).not.toContain('Theme:');
    expect(prompt).not.toContain('Emoji:');
  });

  // D8-5: Agent system prompt overlay
  it('includes agent instructions section when agentSystemPromptOverlay is provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({
      agentSystemPromptOverlay: 'You specialize in insurance claims.',
    }));
    expect(prompt).toContain('## Agent Instructions');
    expect(prompt).toContain('You specialize in insurance claims.');
  });

  it('excludes agent instructions when agentSystemPromptOverlay is undefined', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).not.toContain('## Agent Instructions');
  });

  it('includes both agent identity and agent instructions when both provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({
      agentIdentity: { name: 'ClaimsBot', emoji: '📋' },
      agentSystemPromptOverlay: 'Focus on claims processing.',
    }));
    expect(prompt).toContain('## Agent Identity');
    expect(prompt).toContain('## Agent Instructions');
    // Identity should come before Instructions
    const identityIdx = prompt.indexOf('## Agent Identity');
    const instructionsIdx = prompt.indexOf('## Agent Instructions');
    expect(identityIdx).toBeLessThan(instructionsIdx);
  });

  it('includes runtime section', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Runtime');
    expect(prompt).toContain('qwen2.5:7b-instruct');
    expect(prompt).toContain('ollama');
  });

  it('includes small model guidance when modelTier is small', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ modelTier: 'small' }));
    expect(prompt).toContain('## Small Model Guidance');
    expect(prompt).toContain('step-by-step');
  });

  it('excludes small model guidance for non-small tiers', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ modelTier: 'large' }));
    expect(prompt).not.toContain('## Small Model Guidance');
  });

  it('includes no-tools fallback when supportsTools is false', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ supportsTools: false }));
    expect(prompt).toContain('## Tool Calling Not Available');
  });

  it('excludes no-tools fallback when supportsTools is true or absent', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ supportsTools: true }));
    expect(prompt).not.toContain('## Tool Calling Not Available');
    const prompt2 = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt2).not.toContain('## Tool Calling Not Available');
  });

  it('section order: Identity → Workspace → Skills → Tools → Runtime', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    const order = [
      prompt.indexOf('## Identity'),
      prompt.indexOf('## Workspace Context'),
      prompt.indexOf('## Skills\n'),
      prompt.indexOf('## Tooling'),
      prompt.indexOf('## Runtime'),
    ];
    for (let i = 1; i < order.length; i++) {
      expect(order[i]).toBeGreaterThan(order[i - 1]);
    }
  });
});

// ---------------------------------------------------------------------------
// buildSkillsSection
// ---------------------------------------------------------------------------

describe('buildSkillsSection', () => {
  it('emits upstream-parity heading and preamble', () => {
    // Mirrors upstream agents/system-prompt.ts buildSkillsSection.
    const section = buildSkillsSection(createSkills());
    expect(section.startsWith('## Skills\n')).toBe(true);
    expect(section).toContain('Scan <available_skills>. If one clearly applies, read its SKILL.md at exact <location>');
    expect(section).toContain('If several apply, choose the most specific. If none clearly apply, read none.');
    expect(section).toContain('One skill up front max. Never guess/fabricate skill paths.');
    expect(section).toContain('External API writes: batch when safe, avoid tight loops, respect 429/Retry-After.');
  });

  it('pretty-prints <skill> entries (upstream formatSkillsForPrompt parity)', () => {
    const section = buildSkillsSection(createSkills());
    expect(section).toContain('  <skill>\n    <name>search-workspace</name>');
    expect(section).toContain('    <description>Search workspace files</description>');
    expect(section).toContain('    <location>/skills/search.md</location>');
    expect(section).toContain('  </skill>');
  });

  it('parameterizes the read tool name (default fs_read_file)', () => {
    const defaultSection = buildSkillsSection(createSkills());
    expect(defaultSection).toContain('with `fs_read_file`');
    const custom = buildSkillsSection(createSkills(), { readToolName: 'cat' });
    expect(custom).toContain('with `cat`');
    expect(custom).not.toContain('with `fs_read_file`');
  });

  it('compact mode drops <description> (upstream formatSkillsCompact parity)', () => {
    const section = buildSkillsSection(createSkills(), { compact: true });
    expect(section).toContain('<name>search-workspace</name>');
    expect(section).toContain('<location>/skills/search.md</location>');
    expect(section).not.toContain('<description>');
  });

  it('prepends truncation note when provided', () => {
    const note = '⚠️ Skills truncated: included 2 of 99.';
    const section = buildSkillsSection(createSkills(), { truncationNote: note });
    // Note appears after heading, before the scan instruction line.
    const headingIdx = section.indexOf('## Skills');
    const noteIdx = section.indexOf(note);
    const scanIdx = section.indexOf('Scan <available_skills>');
    expect(noteIdx).toBeGreaterThan(headingIdx);
    expect(scanIdx).toBeGreaterThan(noteIdx);
  });

  it('escapes XML special characters', () => {
    const section = buildSkillsSection([
      { name: 'find & replace', description: 'Search <regex> patterns', location: '/skills/"test".md' },
    ]);
    expect(section).toContain('&amp;');
    expect(section).toContain('&lt;regex&gt;');
    expect(section).toContain('&quot;test&quot;');
  });

  // M81 Phase 6 — agentskills.io subfolder alignment.
  it('emits <bundle> with <file> children when skill has bundledFiles', () => {
    const section = buildSkillsSection([
      {
        name: 'my-skill',
        description: 'A skill with a script',
        location: '.parallx/skills/my-skill/SKILL.md',
        bundledFiles: [
          '.parallx/skills/my-skill/scripts/helper.py',
          '.parallx/skills/my-skill/references/notes.md',
        ],
      },
    ]);
    expect(section).toContain('<bundle>');
    expect(section).toContain('<file>.parallx/skills/my-skill/scripts/helper.py</file>');
    expect(section).toContain('<file>.parallx/skills/my-skill/references/notes.md</file>');
    expect(section).toContain('</bundle>');
  });

  it('does NOT emit <bundle> for skills without bundledFiles (no regression)', () => {
    // Skill entry created the legacy way — no bundledFiles property at all.
    const legacyOnly = buildSkillsSection(createSkills());
    expect(legacyOnly).not.toContain('<bundle>');
    expect(legacyOnly).not.toContain('<file>');

    // Skill entry explicitly with empty array — also must not emit <bundle>.
    const explicitEmpty = buildSkillsSection([
      { name: 'no-bundle', description: 'desc', location: '/x.md', bundledFiles: [] },
    ]);
    expect(explicitEmpty).not.toContain('<bundle>');
  });
});

// ---------------------------------------------------------------------------
// buildToolSummariesSection
// ---------------------------------------------------------------------------

describe('buildToolSummariesSection', () => {
  // Post-M66 prompt fix: the per-tool bullet catalog was pure duplication of
  // what the Ollama chat template already injects via `<tools>{tool|tojson}</tools>`.
  // This section is now a short preamble that tells the model how to read the
  // schema-provided tool list — no per-tool content.

  it('emits the `## Tooling` heading', () => {
    const section = buildToolSummariesSection(createTools());
    expect(section).toMatch(/^## Tooling/);
  });

  it('explains tool definitions are in the function-calling schema', () => {
    const section = buildToolSummariesSection(createTools());
    expect(section).toContain('function-calling schema');
    expect(section).toContain('read it before calling');
  });

  it('states tool names are case-sensitive and references TOOLS.md', () => {
    const section = buildToolSummariesSection(createTools());
    expect(section).toContain('case-sensitive');
    expect(section).toContain('TOOLS.md');
  });

  it('instructs the model to prefer the more specific tool', () => {
    const section = buildToolSummariesSection(createTools());
    expect(section).toContain('prefer the more specific');
  });

  it('emits no per-tool bullets', () => {
    const tools: IToolSummary[] = [
      { name: 'canvas_read_page', description: 'Read a canvas page' },
      { name: 'fs_list_files', description: 'List workspace files' },
      { name: 'memory_read', description: 'Read memory' },
    ];
    const section = buildToolSummariesSection(tools);
    const toolLines = section.split('\n').filter(l => /^- [a-z_]+:/i.test(l));
    expect(toolLines.length).toBe(0);
    expect(section).not.toContain('### Canvas Pages');
    expect(section).not.toContain('### Workspace Files');
    expect(section).not.toContain('### Memory');
  });

  it('output is stable when no tool declares a category', () => {
    // Tools without `category` fall into the no-map branch — the section is
    // the bare preamble + selection guidance, identical regardless of inputs.
    const a = buildToolSummariesSection([{ name: 'x', description: 'X' }]);
    const b = buildToolSummariesSection([
      { name: 'y', description: 'Y' },
      { name: 'z', description: 'Z' },
    ]);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildWorkspaceSection
// ---------------------------------------------------------------------------

describe('buildWorkspaceSection', () => {
  it('includes all bootstrap files', () => {
    const section = buildWorkspaceSection(createBootstrapFiles(), 'Digest text.');
    expect(section).toContain('### SOUL.md');
    expect(section).toContain('### AGENTS.md');
    expect(section).toContain('### TOOLS.md');
  });

  it('includes workspace digest', () => {
    const section = buildWorkspaceSection(createBootstrapFiles(), 'Project overview here.');
    expect(section).toContain('### Workspace Overview');
    expect(section).toContain('Project overview here.');
  });

  it('preserves bootstrap file order', () => {
    const section = buildWorkspaceSection(createBootstrapFiles(), '');
    const soulIdx = section.indexOf('### SOUL.md');
    const agentsIdx = section.indexOf('### AGENTS.md');
    const toolsIdx = section.indexOf('### TOOLS.md');
    expect(soulIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(toolsIdx);
  });

  it('skips bootstrap files with empty content', () => {
    const files: IBootstrapFile[] = [
      { name: 'SOUL.md', content: 'Soul content' },
      { name: 'EMPTY.md', content: '' },
    ];
    const section = buildWorkspaceSection(files, 'Digest.');
    expect(section).toContain('### SOUL.md');
    expect(section).not.toContain('### EMPTY.md');
  });
});

// ---------------------------------------------------------------------------
// buildRuntimeSection
// ---------------------------------------------------------------------------

describe('buildRuntimeSection', () => {
  it('includes all mandatory fields', () => {
    const section = buildRuntimeSection(createRuntimeInfo());
    expect(section).toContain('## Runtime');
    expect(section).toContain('Model: qwen2.5:7b-instruct');
    expect(section).toContain('Provider: ollama');
    expect(section).toContain('Host: localhost:11434');
    expect(section).toContain('Parallx version: 0.42.0');
  });

  it('anchors the clock to the MACHINE timezone, never a hardcoded one', () => {
    const section = buildRuntimeSection(createRuntimeInfo());
    // The invariant is "whatever this machine reports" — the old code
    // hardcoded America/Chicago, which only worked on machines that
    // happen to BE in Central time.
    const machineTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(section).toContain(`Timezone: ${machineTz}`);
    expect(section).not.toContain('(Central Time)');
    // The model is told zone-less times are the user's local time.
    expect(section).toContain('local timezone');
  });

  it('includes optional OS/arch/shell when present', () => {
    const section = buildRuntimeSection(createRuntimeInfo({
      os: 'win32',
      arch: 'x64',
      shell: 'powershell',
    }));
    expect(section).toContain('OS: win32');
    expect(section).toContain('Architecture: x64');
    expect(section).toContain('Shell: powershell');
  });

  it('omits optional fields when absent', () => {
    const section = buildRuntimeSection(createRuntimeInfo());
    expect(section).not.toContain('OS:');
    expect(section).not.toContain('Architecture:');
    expect(section).not.toContain('Shell:');
  });
});

// ---------------------------------------------------------------------------
// buildMemorySection (M81 Phase 8 — index + topic-files model)
// ---------------------------------------------------------------------------

describe('buildMemorySection', () => {
  it('teaches the index model: MEMORY.md is an INDEX, not a content file', () => {
    const section = buildMemorySection();
    // The whole point of Phase 8 is that MEMORY.md is an INDEX of pointers.
    expect(section).toContain('## Memory');
    expect(section).toContain('`MEMORY.md` is an');
    expect(section).toContain('INDEX');
    expect(section).toContain('lessons/<slug>.md');
  });

  it('names all three identity files', () => {
    const section = buildMemorySection();
    expect(section).toContain('.parallx/SOUL.md');
    expect(section).toContain('.parallx/USER.md');
    expect(section).toContain('.parallx/AGENTS.md');
  });

  it('explains how to open a lesson body on demand', () => {
    const section = buildMemorySection();
    // memory_read with a name= slug is the preferred path; fs_read_file fallback also documented.
    expect(section).toContain('memory_read name=<slug>');
    expect(section).toContain('fs_read_file lessons/<slug>.md');
  });

  it('lists all three tools in one family', () => {
    const section = buildMemorySection();
    expect(section).toContain('memory_read');
    expect(section).toContain('memory_search');
    expect(section).toContain('memory_write');
    // memory_write must mention the lesson file= action so the model knows it exists.
    expect(section).toContain('file=lesson');
  });

  it('describes the YYYY-MM-DD daily log layer', () => {
    const section = buildMemorySection();
    expect(section).toMatch(/YYYY-MM-DD\.md/);
    expect(section).toMatch(/daily logs?/i);
  });

  it('includes the user-corrections write trigger', () => {
    const section = buildMemorySection();
    // The correction trigger MUST be explicit — this is the one missing in
    // the pre-Phase-8 wording. Look for the verb "corrects" plus the
    // example phrasing the spec calls out.
    expect(section).toMatch(/corrects you/i);
    expect(section).toContain("don't do X");
    expect(section).toContain('use Z instead of W');
  });

  it('routes corrections to a lesson file, not USER.md or daily', () => {
    const section = buildMemorySection();
    // The correction line MUST direct the agent to memory_write file=lesson.
    expect(section).toMatch(/correct[^.]*memory_write file=lesson/i);
  });

  it('includes USER.md and lesson write triggers explicitly', () => {
    const section = buildMemorySection();
    expect(section).toMatch(/states a preference[^.]*file=USER/);
    expect(section).toMatch(/file=lesson/);
    expect(section).toMatch(/file=daily/);
  });

  it('describes cap discipline — remove an old lesson before adding when index is full', () => {
    const section = buildMemorySection();
    expect(section).toMatch(/cap/i);
    // The agent must be told to remove an obsolete entry before retrying the add.
    expect(section).toMatch(/action=remove/);
  });

  it('keeps the "verify before acting on memory" staleness warning', () => {
    const section = buildMemorySection();
    // Carried over from the Phase 5 version — memory can go stale, agent must verify.
    expect(section).toMatch(/can go stale/i);
  });
});

// ---------------------------------------------------------------------------
// estimateSystemPromptTokens
// ---------------------------------------------------------------------------

describe('estimateSystemPromptTokens', () => {
  it('returns a positive number for standard params', () => {
    const tokens = estimateSystemPromptTokens(createBaseParams());
    expect(tokens).toBeGreaterThan(0);
  });

  it('returns approximately chars/4 of the built prompt', () => {
    const params = createBaseParams();
    const prompt = buildOpenclawSystemPrompt(params);
    const tokens = estimateSystemPromptTokens(params);
    // estimateTokens = Math.ceil(chars / 4)
    expect(tokens).toBe(Math.ceil(prompt.length / 4));
  });
});

// ---------------------------------------------------------------------------
// Budget-aware truncation
// ---------------------------------------------------------------------------

describe('budget-aware truncation', () => {
  it('does not truncate when under budget', () => {
    // The prompt embeds a live timestamp; two builds straddling a
    // millisecond tick differ by one digit and fail the identity check.
    // Freeze the clock, as the runtime-section tests below already do.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T13:00:00.000Z'));
    try {
      const params = createBaseParams({ systemBudgetTokens: 100000 });
      const withBudget = buildOpenclawSystemPrompt(params);
      const withoutBudget = buildOpenclawSystemPrompt(createBaseParams());
      expect(withBudget).toBe(withoutBudget);
    } finally {
      vi.useRealTimers();
    }
  });

  it('truncates when over budget', () => {
    // Use a very small budget to force truncation
    const params = createBaseParams({ systemBudgetTokens: 50 });
    const prompt = buildOpenclawSystemPrompt(params);
    // Should be shorter than the untruncated version
    const full = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt.length).toBeLessThan(full.length);
  });

  it('preserves skills section even when truncating', () => {
    const params = createBaseParams({ systemBudgetTokens: 100 });
    const prompt = buildOpenclawSystemPrompt(params);
    // Skills section should survive truncation (only workspace and tools are truncated)
    expect(prompt).toMatch(/^## Skills\n/m);
  });
});

// ---------------------------------------------------------------------------
// resolveModelTier
// ---------------------------------------------------------------------------

describe('resolveModelTier', () => {
  it('returns small for ≤8B models', () => {
    expect(resolveModelTier('qwen2.5:7b-instruct')).toBe('small');
    expect(resolveModelTier('llama3:8b')).toBe('small');
    expect(resolveModelTier('phi-3:3b')).toBe('small');
  });

  it('returns medium for 9-32B models', () => {
    expect(resolveModelTier('gpt-oss:20b')).toBe('medium');
    expect(resolveModelTier('qwen2.5:14b')).toBe('medium');
    expect(resolveModelTier('llama3:32b')).toBe('medium');
  });

  it('returns large for >32B models', () => {
    expect(resolveModelTier('llama3:70b')).toBe('large');
    expect(resolveModelTier('qwen2.5:72b-instruct')).toBe('large');
  });

  it('returns medium for unrecognized patterns', () => {
    expect(resolveModelTier('gpt-4o')).toBe('medium');
    expect(resolveModelTier('claude-3.5-sonnet')).toBe('medium');
    expect(resolveModelTier('custom-model')).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// buildOpenclawPromptArtifacts
// ---------------------------------------------------------------------------

describe('buildOpenclawPromptArtifacts', () => {
  function createArtifactInput(overrides?: Partial<IOpenclawPromptArtifactInput>): IOpenclawPromptArtifactInput {
    return {
      source: 'run',
      workspaceName: 'test-workspace',
      bootstrapFiles: createBootstrapFiles(),
      bootstrapReport: {
        maxChars: 5000,
        totalMaxChars: 15000,
        totalRawChars: 3000,
        totalInjectedChars: 3000,
        files: [],
        warningLines: [],
      },
      workspaceDigest: 'Test digest.',
      skillState: {
        catalog: [],
        promptEntries: [],
        promptReportEntries: [],
        totalCount: 0,
        visibleCount: 0,
        hiddenCount: 0,
      },
      toolState: {
        exposedDefinitions: [],
        availableDefinitions: [],
        reportEntries: [],
        totalCount: 0,
        availableCount: 0,
        filteredCount: 0,
        skillDerivedCount: 0,
      },
      runtimeInfo: createRuntimeInfo(),
      ...overrides,
    };
  }

  it('produces a system prompt string and report', () => {
    const result = buildOpenclawPromptArtifacts(createArtifactInput());
    expect(typeof result.systemPrompt).toBe('string');
    expect(result.systemPrompt.length).toBeGreaterThan(0);
    expect(result.report.source).toBe('run');
    expect(result.report.generatedAt).toBeGreaterThan(0);
  });

  it('forwards modelTier to the system prompt builder', () => {
    const result = buildOpenclawPromptArtifacts(createArtifactInput({ modelTier: 'small' }));
    expect(result.systemPrompt).toContain('## Small Model Guidance');
  });

  it('forwards systemBudgetTokens to the builder', () => {
    // Freeze the clock so both prompt builds embed the exact same
    // "Current date/time" line — otherwise sub-millisecond drift between
    // the two calls makes the strings differ by a single digit.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-22T13:00:00.000Z'));
    try {
      const result = buildOpenclawPromptArtifacts(createArtifactInput({ systemBudgetTokens: 100000 }));
      // Should produce the same prompt as without budget (under budget)
      const noBudget = buildOpenclawPromptArtifacts(createArtifactInput());
      expect(result.systemPrompt).toBe(noBudget.systemPrompt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses explicit supportsTools over tool count fallback', () => {
    // No tools available, but explicit supportsTools=true should not trigger fallback
    const result = buildOpenclawPromptArtifacts(createArtifactInput({ supportsTools: false }));
    expect(result.systemPrompt).toContain('## Tool Calling Not Available');

    const result2 = buildOpenclawPromptArtifacts(createArtifactInput({ supportsTools: true }));
    expect(result2.systemPrompt).not.toContain('## Tool Calling Not Available');
  });

  it('falls back to tool count when supportsTools is undefined', () => {
    // No tools → supportsTools defaults to false (0 > 0 is false)
    const noTools = buildOpenclawPromptArtifacts(createArtifactInput());
    expect(noTools.systemPrompt).toContain('## Tool Calling Not Available');

    // With tools → supportsTools defaults to true
    const withTools = buildOpenclawPromptArtifacts(createArtifactInput({
      toolState: {
        exposedDefinitions: [],
        availableDefinitions: [{ name: 'readFile', description: 'Read file', parameters: {} }],
        reportEntries: [],
        totalCount: 1,
        availableCount: 1,
        filteredCount: 0,
        skillDerivedCount: 0,
      },
    }));
    expect(withTools.systemPrompt).not.toContain('## Tool Calling Not Available');
  });

  it('report includes correct prompt size metrics', () => {
    const result = buildOpenclawPromptArtifacts(createArtifactInput());
    expect(result.report.systemPrompt.chars).toBe(result.systemPrompt.length);
    expect(result.report.systemPrompt.projectContextChars).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// buildOpenclawRuntimeSkillState
// ---------------------------------------------------------------------------

describe('buildOpenclawRuntimeSkillState', () => {
  it('filters only workflow skills as model-visible', () => {
    const state = buildOpenclawRuntimeSkillState([
      { name: 'search', kind: 'workflow', description: 'Search files', location: '/skills/search.md' },
      { name: 'tool-a', kind: 'tool', description: 'A tool skill', location: '/skills/tool-a.md' },
    ] as any);
    expect(state.promptEntries.length).toBe(1);
    expect(state.promptEntries[0].name).toBe('search');
    expect(state.visibleCount).toBe(1);
    expect(state.hiddenCount).toBe(1);
    expect(state.totalCount).toBe(2);
  });

  it('excludes workflow skills with disableModelInvocation', () => {
    const state = buildOpenclawRuntimeSkillState([
      { name: 'hidden', kind: 'workflow', description: 'Hidden', location: '/hidden.md', disableModelInvocation: true },
    ] as any);
    expect(state.promptEntries.length).toBe(0);
    expect(state.hiddenCount).toBe(1);
  });

  it('returns empty entries for empty catalog', () => {
    const state = buildOpenclawRuntimeSkillState([]);
    expect(state.promptEntries.length).toBe(0);
    expect(state.totalCount).toBe(0);
    expect(state.visibleCount).toBe(0);
    expect(state.hiddenCount).toBe(0);
    expect(state.compact).toBe(false);
    expect(state.truncated).toBe(false);
    expect(state.truncationNote).toBe('');
  });

  // M65b parity: upstream agents/skills/workspace.ts applySkillsPromptLimits
  it('caps prompt entries at maxSkillsInPrompt (upstream DEFAULT_MAX_SKILLS_IN_PROMPT parity)', () => {
    const catalog = Array.from({ length: 5 }, (_, i) => ({
      name: `s${i}`,
      kind: 'workflow' as const,
      description: 'd',
      location: `/skills/s${i}.md`,
    }));
    const state = buildOpenclawRuntimeSkillState(catalog as any, { maxSkillsInPrompt: 3 });
    expect(state.promptEntries.length).toBe(3);
    expect(state.visibleCount).toBe(5);
    expect(state.truncated).toBe(true);
    expect(state.truncationNote).toContain('included 3 of 5');
  });

  it('falls back to compact format when full exceeds maxSkillsPromptChars', () => {
    const catalog = Array.from({ length: 3 }, (_, i) => ({
      name: `skill-${i}`,
      kind: 'workflow' as const,
      description: 'X'.repeat(200), // long description forces compact fallback
      location: `/skills/skill-${i}.md`,
    }));
    const state = buildOpenclawRuntimeSkillState(catalog as any, { maxSkillsPromptChars: 800 });
    expect(state.compact).toBe(true);
    // All 3 skills fit in compact form (name + location only).
    expect(state.promptEntries.length).toBe(3);
    expect(state.truncationNote).toContain('compact format');
  });

  it('binary-searches largest fitting prefix when compact still too large', () => {
    const catalog = Array.from({ length: 20 }, (_, i) => ({
      name: `skill-${i}`,
      kind: 'workflow' as const,
      description: 'd',
      location: `/skills/skill-${i}.md`,
    }));
    // Budget that allows a few entries in compact form but cannot fit all 20.
    const state = buildOpenclawRuntimeSkillState(catalog as any, { maxSkillsPromptChars: 700 });
    expect(state.compact).toBe(true);
    expect(state.truncated).toBe(true);
    expect(state.promptEntries.length).toBeGreaterThan(0);
    expect(state.promptEntries.length).toBeLessThan(20);
    expect(state.truncationNote).toContain('compact format, descriptions omitted');
  });
});

// ---------------------------------------------------------------------------
// buildOpenclawRuntimeToolState
// ---------------------------------------------------------------------------

describe('buildOpenclawRuntimeToolState', () => {
  it('deduplicates tools with same name', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [
        { name: 'readFile', description: 'Read a file', parameters: {} },
        { name: 'readFile', description: 'Read a file (duplicate)', parameters: {} },
      ],
      skillCatalog: [],
      mode: 'full',
    });
    // Should keep first, dedup the second
    expect(state.availableDefinitions.filter(t => t.name === 'readFile').length).toBe(1);
  });

  it('applies tool policy filtering', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [
        { name: 'fs_write_file', description: 'Write a file', parameters: {} },
      ],
      skillCatalog: [],
      mode: 'readonly',
    });
    // readonly profile denies fs_write_file
    expect(state.availableCount).toBe(0);
    expect(state.filteredCount).toBe(1);
  });

  it('detects name collisions between platform and skill tools', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [
        { name: 'readFile', description: 'Platform read', parameters: {} },
      ],
      skillCatalog: [
        { name: 'readFile', kind: 'tool', description: 'Skill read', location: '/skills/read.md' },
      ] as any,
      mode: 'full',
    });
    const collision = state.reportEntries.find(
      e => e.source === 'skill' && e.filteredReason === 'name-collision',
    );
    expect(collision).toBeDefined();
  });
});
