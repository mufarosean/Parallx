import { describe, expect, it } from 'vitest';

import {
  buildOpenclawSystemPrompt,
  buildSkillsSection,
  buildToolSummariesSection,
  buildWorkspaceSection,
  buildRuntimeSection,
  buildBehavioralRulesSection,
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
  it('produces identity section first', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt.startsWith('You are Parallx')).toBe(true);
  });

  it('includes safety section after identity', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    const identityEnd = prompt.indexOf('\n\n');
    const safetyStart = prompt.indexOf('## Safety');
    expect(safetyStart).toBeGreaterThan(identityEnd);
    // Safety should come before Skills
    const skillsStart = prompt.indexOf('## Skills');
    expect(safetyStart).toBeLessThan(skillsStart);
  });

  it('includes all mandatory safety lines', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('do not pursue self-preservation');
    expect(prompt).toContain('Prioritize safety and human oversight');
    expect(prompt).toContain('Do not manipulate or persuade');
  });

  it('includes skills section with scan instruction', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Skills (mandatory)');
    expect(prompt).toContain('scan <available_skills>');
    expect(prompt).toContain('<available_skills>');
  });

  it('includes skill constraint instructions', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('never read more than one skill up front');
    expect(prompt).toContain('rate limits');
  });

  it('omits skills section when no skills provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ skills: [] }));
    expect(prompt).not.toContain('## Skills');
    expect(prompt).not.toContain('<available_skills>');
  });

  it('includes tool summaries with correct heading', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('Tool availability (filtered by policy):');
    // Should NOT have old heading
    expect(prompt).not.toContain('## Available Tools');
  });

  it('omits tools section when no tools provided', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams({ tools: [] }));
    expect(prompt).not.toContain('Tool availability');
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

  it('includes runtime section', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Runtime');
    expect(prompt).toContain('qwen2.5:7b-instruct');
    expect(prompt).toContain('ollama');
  });

  it('includes behavioral rules section', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    expect(prompt).toContain('## Response Guidelines');
    expect(prompt).toContain('Answer from the workspace context');
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

  it('section order: Identity → Safety → Skills → Tools → Workspace → Runtime → Behavioral', () => {
    const prompt = buildOpenclawSystemPrompt(createBaseParams());
    const order = [
      prompt.indexOf('You are Parallx'),
      prompt.indexOf('## Safety'),
      prompt.indexOf('## Skills (mandatory)'),
      prompt.indexOf('Tool availability'),
      prompt.indexOf('## Workspace Context'),
      prompt.indexOf('## Runtime'),
      prompt.indexOf('## Response Guidelines'),
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
  it('wraps entries in XML tags', () => {
    const section = buildSkillsSection(createSkills());
    expect(section).toContain('<skill>');
    expect(section).toContain('<name>search-workspace</name>');
    expect(section).toContain('<description>Search workspace files</description>');
    expect(section).toContain('<location>/skills/search.md</location>');
    expect(section).toContain('</skill>');
  });

  it('includes mandatory scan instruction', () => {
    const section = buildSkillsSection(createSkills());
    expect(section).toContain('Before replying: scan <available_skills> <description> entries.');
  });

  it('includes constraint and rate-limit lines', () => {
    const section = buildSkillsSection(createSkills());
    expect(section).toContain('Constraints: never read more than one skill up front');
    expect(section).toContain('rate limits');
    expect(section).toContain('prefer fewer larger writes');
  });

  it('names read_file tool explicitly', () => {
    const section = buildSkillsSection(createSkills());
    expect(section).toContain('using read_file');
  });

  it('includes fabrication guard', () => {
    const section = buildSkillsSection(createSkills());
    expect(section).toContain('NEVER describe a skill');
    expect(section).toContain('always read the actual SKILL.md file first');
  });

  it('includes explicit user naming case', () => {
    const section = buildSkillsSection(createSkills());
    expect(section).toContain('user explicitly names a skill');
    expect(section).toContain('using read_file');
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
  it('uses correct heading format', () => {
    const section = buildToolSummariesSection(createTools());
    expect(section).toMatch(/^Tool availability \(filtered by policy\):/);
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
// buildBehavioralRulesSection
// ---------------------------------------------------------------------------

describe('buildBehavioralRulesSection', () => {
  it('includes Response Guidelines heading', () => {
    const section = buildBehavioralRulesSection();
    expect(section).toContain('## Response Guidelines');
  });

  it('includes citation and accuracy guidance', () => {
    const section = buildBehavioralRulesSection();
    expect(section).toContain('Cite specific files');
    expect(section).toContain('exact values from the source');
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

  it('preserves safety section even when truncating', () => {
    const params = createBaseParams({ systemBudgetTokens: 100 });
    const prompt = buildOpenclawSystemPrompt(params);
    // Safety section should survive truncation (only workspace and tools are truncated)
    expect(prompt).toContain('## Safety');
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
