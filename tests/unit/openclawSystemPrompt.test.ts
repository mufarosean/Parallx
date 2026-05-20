import { describe, expect, it } from 'vitest';

import {
  buildOpenclawSystemPrompt,
  buildSkillsSection,
  buildToolSummariesSection,
  buildWorkspaceSection,
  buildRuntimeSection,
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
  it('starts with skills section (identity now in SOUL.md bootstrap)', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    // M65b parity: heading is `## Skills` (upstream agents/system-prompt.ts buildSkillsSection),
    // not `## Skills (mandatory)`.
    expect(prompt.startsWith('## Skills\n')).toBe(true);
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

  it('includes workspace context section', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Workspace Context');
    expect(prompt).toContain('### SOUL.md');
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

  it('section order: Skills → Tools → Workspace → Runtime', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    const order = [
      prompt.indexOf('## Skills\n'),
      prompt.indexOf('## Tooling'),
      prompt.indexOf('## Workspace Context'),
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

  it('parameterizes the read tool name (default read_file)', () => {
    const defaultSection = buildSkillsSection(createSkills());
    expect(defaultSection).toContain('with `read_file`');
    const custom = buildSkillsSection(createSkills(), { readToolName: 'cat' });
    expect(custom).toContain('with `cat`');
    expect(custom).not.toContain('with `read_file`');
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
});

// ---------------------------------------------------------------------------
// buildToolSummariesSection
// ---------------------------------------------------------------------------

describe('buildToolSummariesSection', () => {
  it('uses flat `## Tooling` heading (upstream parity)', () => {
    // M65 parity fix (divergence 2): single flat heading, no per-domain
    // subheadings. Mirrors upstream src/agents/system-prompt.ts.
    const section = buildToolSummariesSection(createTools());
    expect(section).toMatch(/^## Tooling/);
  });

  it('lists tools without bold formatting', () => {
    const section = buildToolSummariesSection(createTools());
    expect(section).toContain('- readFile: Read a file from disk');
    expect(section).not.toContain('**readFile**');
  });

  it('has one line per tool', () => {
    const tools = createTools();
    const section = buildToolSummariesSection(tools);
    const toolLines = section.split('\n').filter(l => l.startsWith('- '));
    expect(toolLines.length).toBe(tools.length);
  });

  it('emits a single flat list (no per-domain subheadings)', () => {
    // M65 parity fix (divergence 2): upstream system-prompt.ts emits one
    // flat list under `## Tooling` — no `### Canvas Pages`, `### Workspace
    // Files`, etc. The old groupings were a Parallx-only invention that
    // bloated the prompt and confused small models.
    const tools: IToolSummary[] = [
      { name: 'canvas_read_page', description: 'Read a canvas page' },
      { name: 'list_files', description: 'List workspace files' },
      { name: 'memory_get', description: 'Read memory' },
      { name: 'mcp__github__create_issue', description: 'Create a GitHub issue' },
    ];
    const section = buildToolSummariesSection(tools);

    expect(section).not.toContain('### Canvas Pages');
    expect(section).not.toContain('### Workspace Files');
    expect(section).not.toContain('### Memory');
    expect(section).not.toContain('### Other');

    // Each tool listed exactly once, all under the single `## Tooling`.
    const headingMatches = section.match(/^## Tooling$/gm) ?? [];
    expect(headingMatches.length).toBe(1);
    const toolLines = section.split('\n').filter(l => l.startsWith('- '));
    expect(toolLines.length).toBe(4);
  });

  it('prefers displaySummary over description', () => {
    // M65 parity fix (divergence 4): per-tool `displaySummary` (short,
    // prompt-only) is the source of the catalog bullet, falling back to
    // a summarized version of `description`. Mirrors upstream
    // tool-description-presets.ts coreToolSummaries map.
    const tools: IToolSummary[] = [
      {
        name: 'run_command',
        description: 'A very long description that goes on and on with all the details that should not be in the prompt catalog because it would bloat the system prompt.',
        displaySummary: 'Run a shell command.',
      },
    ];
    const section = buildToolSummariesSection(tools);
    expect(section).toContain('- run_command: Run a shell command.');
    expect(section).not.toContain('A very long description');
  });

  it('summarizes long descriptions when displaySummary is absent', () => {
    // M65 parity fix (divergence 3): when displaySummary is absent the
    // builder calls summarizeToolDescriptionText (port of upstream
    // tool-description-summary.ts) to trim to 120 chars at a sentence
    // boundary and strip structured doc blocks (JSON/ACTIONS:/etc.).
    const longDesc =
      'Execute a shell command in the workspace directory and return the output. ' +
      'Commands run with a 30-second timeout. Dangerous commands are blocked.\n\n' +
      'ACTIONS:\n- run\n- list';
    const section = buildToolSummariesSection([
      { name: 'run_command', description: longDesc },
    ]);
    // First sentence is included; ACTIONS: block is stripped.
    expect(section).toContain('Execute a shell command in the workspace directory');
    expect(section).not.toContain('ACTIONS:');
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
    const params = createBaseParams({ systemBudgetTokens: 100000 });
    const withBudget = buildOpenclawSystemPrompt(params);
    const withoutBudget = buildOpenclawSystemPrompt(createBaseParams());
    expect(withBudget).toBe(withoutBudget);
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
    const result = buildOpenclawPromptArtifacts(createArtifactInput({ systemBudgetTokens: 100000 }));
    // Should produce the same prompt as without budget (under budget)
    const noBudget = buildOpenclawPromptArtifacts(createArtifactInput());
    expect(result.systemPrompt).toBe(noBudget.systemPrompt);
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
        { name: 'write_file', description: 'Write a file', parameters: {} },
      ],
      skillCatalog: [],
      mode: 'readonly',
    });
    // readonly profile denies write_file
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
