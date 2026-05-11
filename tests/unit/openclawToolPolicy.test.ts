import { beforeEach, describe, expect, it } from 'vitest';

import {
  applyOpenclawToolPolicy,
  isToolDeniedByProfile,
  resolveToolProfile,
  getToolColor,
  markTurnTainted,
  isTurnTainted,
  beginNewTurn,
  resetSession,
  resolveColorGate,
  _resetColorGateRegistryForTests,
} from '../../src/openclaw/openclawToolPolicy';
import {
  buildOpenclawRuntimeToolState,
  buildToolDefinitionFromSkillCatalogEntry,
} from '../../src/openclaw/openclawToolState';
import type { IToolDefinition } from '../../src/services/chatTypes';
import type { ISkillCatalogEntry } from '../../src/openclaw/openclawTypes';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tool(name: string): IToolDefinition {
  return { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } };
}

function skill(name: string, kind: 'tool' | 'prompt' = 'tool'): ISkillCatalogEntry {
  return {
    name,
    kind,
    description: `${name} skill`,
    tags: [],
    location: `/skills/${name}`,
    parameters: [{ name: 'input', type: 'string', description: 'input', required: true }],
  };
}

// ---------------------------------------------------------------------------
// applyOpenclawToolPolicy
// ---------------------------------------------------------------------------

describe('applyOpenclawToolPolicy', () => {
  it('full profile allows all tools', () => {
    const tools = [tool('read_file'), tool('write_file'), tool('run_command')];
    const result = applyOpenclawToolPolicy({ tools, mode: 'full' });
    expect(result).toHaveLength(3);
  });

  it('standard profile denies run_command', () => {
    const tools = [tool('read_file'), tool('run_command'), tool('write_file')];
    const result = applyOpenclawToolPolicy({ tools, mode: 'standard' });
    expect(result.map(t => t.name)).toEqual(['read_file', 'write_file']);
  });

  it('readonly profile excludes write/edit/delete/run/create (allowlist semantics)', () => {
    // M65 parity fix: profiles are now allowlists, not deny-lists.
    // `read_file` is on the readonly allow list; `write_file`, `edit_file`,
    // `delete_file`, `run_command`, `create_page` are not — they are excluded
    // by absence from the allowlist (mirrors upstream tool-policy-shared.ts).
    // A bare `search` name is also excluded (not on the allowlist).
    const tools = [
      tool('read_file'), tool('write_file'), tool('edit_file'),
      tool('delete_file'), tool('run_command'), tool('create_page'),
      tool('find_pages'),
    ];
    const result = applyOpenclawToolPolicy({ tools, mode: 'readonly' });
    expect(result.map(t => t.name)).toEqual(['read_file', 'find_pages']);
  });

  it('returns empty array for empty input', () => {
    const result = applyOpenclawToolPolicy({ tools: [], mode: 'full' });
    expect(result).toEqual([]);
  });

  it('never-allowed permission overrides profile allow', () => {
    const tools = [tool('read_file'), tool('search')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      permissions: { search: 'never-allowed' },
    });
    expect(result.map(t => t.name)).toEqual(['read_file']);
  });

  it('requires-approval tools are NOT removed (approval handled elsewhere)', () => {
    const tools = [tool('write_file')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      permissions: { write_file: 'requires-approval' },
    });
    expect(result).toHaveLength(1);
  });

  it('always-allowed tools pass through', () => {
    const tools = [tool('read_file')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      permissions: { read_file: 'always-allowed' },
    });
    expect(result).toHaveLength(1);
  });

  // D8-6: Agent tool policy filter stage
  it('agentTools deny removes tool even in full profile', () => {
    const tools = [tool('read_file'), tool('write_file'), tool('search')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      agentTools: { deny: ['write_file'] },
    });
    expect(result.map(t => t.name)).toEqual(['read_file', 'search']);
  });

  it('agentTools allow restricts to listed tools only', () => {
    const tools = [tool('read_file'), tool('write_file'), tool('search')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      agentTools: { allow: ['read_file', 'search'] },
    });
    expect(result.map(t => t.name)).toEqual(['read_file', 'search']);
  });

  it('agentTools deny + allow combined: deny takes priority', () => {
    const tools = [tool('read_file'), tool('write_file'), tool('search')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      agentTools: { allow: ['read_file', 'write_file'], deny: ['write_file'] },
    });
    expect(result.map(t => t.name)).toEqual(['read_file']);
  });

  it('agentTools with empty allow array has no filtering effect', () => {
    const tools = [tool('read_file'), tool('write_file')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      agentTools: { allow: [] },
    });
    expect(result).toHaveLength(2);
  });

  it('agentTools with empty deny array has no filtering effect', () => {
    const tools = [tool('read_file'), tool('write_file')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      agentTools: { deny: [] },
    });
    expect(result).toHaveLength(2);
  });

  it('agentTools undefined has no filtering effect', () => {
    const tools = [tool('read_file'), tool('write_file')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'full',
      agentTools: undefined,
    });
    expect(result).toHaveLength(2);
  });

  it('profile deny takes priority over permission level', () => {
    const tools = [tool('run_command')];
    const result = applyOpenclawToolPolicy({
      tools,
      mode: 'standard',
      permissions: { run_command: 'always-allowed' },
    });
    expect(result).toHaveLength(0);
  });

  it('does not mutate input array', () => {
    const tools = Object.freeze([tool('run_command'), tool('read_file')]);
    const result = applyOpenclawToolPolicy({ tools, mode: 'standard' });
    expect(result).toHaveLength(1);
    expect(tools).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// isToolDeniedByProfile
// ---------------------------------------------------------------------------

describe('isToolDeniedByProfile', () => {
  it('returns true for denied tools in readonly', () => {
    expect(isToolDeniedByProfile('write_file', 'readonly')).toBe(true);
    expect(isToolDeniedByProfile('edit_file', 'readonly')).toBe(true);
    expect(isToolDeniedByProfile('delete_file', 'readonly')).toBe(true);
    expect(isToolDeniedByProfile('run_command', 'readonly')).toBe(true);
    expect(isToolDeniedByProfile('create_page', 'readonly')).toBe(true);
  });

  it('returns false for tools on the readonly allowlist', () => {
    // M65 parity fix: readonly is now an allowlist. Tools on the list pass.
    expect(isToolDeniedByProfile('read_file', 'readonly')).toBe(false);
    expect(isToolDeniedByProfile('find_pages', 'readonly')).toBe(false);
  });

  it('excludes tools not on the readonly allowlist', () => {
    // Unknown tool names (e.g. MCP tools without `profiles` membership)
    // are excluded from non-`full` profiles by default.
    expect(isToolDeniedByProfile('some_random_mcp_tool', 'readonly')).toBe(true);
  });

  it('returns true for run_command in standard', () => {
    expect(isToolDeniedByProfile('run_command', 'standard')).toBe(true);
  });

  it('returns false for write_file in standard', () => {
    expect(isToolDeniedByProfile('write_file', 'standard')).toBe(false);
  });

  it('returns false for any tool in full', () => {
    expect(isToolDeniedByProfile('run_command', 'full')).toBe(false);
    expect(isToolDeniedByProfile('write_file', 'full')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveToolProfile
// ---------------------------------------------------------------------------

describe('resolveToolProfile', () => {
  it('edit mode returns standard', () => {
    expect(resolveToolProfile('edit')).toBe('standard');
  });

  it('ask mode returns full', () => {
    expect(resolveToolProfile('ask')).toBe('full');
  });

  it('agent mode returns full', () => {
    expect(resolveToolProfile('agent')).toBe('full');
  });

  it('undefined mode returns full', () => {
    expect(resolveToolProfile(undefined)).toBe('full');
  });

  it('unknown mode returns full', () => {
    expect(resolveToolProfile('unknown')).toBe('full');
  });
});

// ---------------------------------------------------------------------------
// buildOpenclawRuntimeToolState
// ---------------------------------------------------------------------------

describe('buildOpenclawRuntimeToolState', () => {
  it('counts are consistent: total = available + filtered', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [tool('read_file'), tool('write_file'), tool('run_command')],
      skillCatalog: [],
      mode: 'standard',
    });
    expect(state.totalCount).toBe(state.availableCount + state.filteredCount);
  });

  it('deduplicates platform tools', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [tool('read_file'), tool('read_file'), tool('read_file')],
      skillCatalog: [],
      mode: 'full',
    });
    expect(state.exposedDefinitions).toHaveLength(1);
    expect(state.totalCount).toBe(1);
  });

  it('includes skill-derived tools in exposed definitions', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [tool('read_file')],
      skillCatalog: [skill('custom_search')],
      mode: 'full',
    });
    expect(state.exposedDefinitions).toHaveLength(2);
    expect(state.skillDerivedCount).toBe(1);
  });

  it('marks skill with name collision as not exposed', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [tool('read_file')],
      skillCatalog: [skill('read_file')],
      mode: 'full',
    });
    expect(state.exposedDefinitions).toHaveLength(1);
    const collided = state.reportEntries.find(e => e.source === 'skill');
    expect(collided?.exposed).toBe(false);
    expect(collided?.filteredReason).toBe('name-collision');
  });

  it('skips non-tool skills', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [skill('my_prompt', 'prompt')],
      mode: 'full',
    });
    expect(state.exposedDefinitions).toHaveLength(0);
    expect(state.skillDerivedCount).toBe(0);
  });

  it('filteredReason is tool-profile-deny for denied tools', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [tool('write_file')],
      skillCatalog: [],
      mode: 'readonly',
    });
    const entry = state.reportEntries.find(e => e.name === 'write_file');
    expect(entry?.filteredReason).toBe('tool-profile-deny');
    expect(entry?.available).toBe(false);
  });

  it('filteredReason is permission-never-allowed for blocked permissions', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [tool('search')],
      skillCatalog: [],
      mode: 'full',
      permissions: { search: 'never-allowed' },
    });
    const entry = state.reportEntries.find(e => e.name === 'search');
    expect(entry?.filteredReason).toBe('permission-never-allowed');
  });

  it('empty inputs return empty state', () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [],
      mode: 'full',
    });
    expect(state.totalCount).toBe(0);
    expect(state.availableCount).toBe(0);
    expect(state.filteredCount).toBe(0);
    expect(state.skillDerivedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildToolDefinitionFromSkillCatalogEntry
// ---------------------------------------------------------------------------

describe('buildToolDefinitionFromSkillCatalogEntry', () => {
  it('creates tool definition with name and description', () => {
    const def = buildToolDefinitionFromSkillCatalogEntry(skill('my_tool'));
    expect(def.name).toBe('my_tool');
    expect(def.description).toBe('my_tool skill');
  });

  it('builds parameters schema from skill parameters', () => {
    const s = skill('my_tool');
    const def = buildToolDefinitionFromSkillCatalogEntry(s);
    const params = def.parameters as { type: string; properties: Record<string, any>; required?: string[] };
    expect(params.type).toBe('object');
    expect(params.properties.input).toBeDefined();
    expect(params.required).toContain('input');
  });

  it('handles skill with no parameters', () => {
    const s: ISkillCatalogEntry = { name: 'empty', kind: 'tool', description: 'empty', tags: [], location: '/skills/empty' };
    const def = buildToolDefinitionFromSkillCatalogEntry(s);
    const params = def.parameters as { type: string; properties: Record<string, any> };
    expect(params.type).toBe('object');
    expect(Object.keys(params.properties)).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// M65 Iter 2 � Tool color gating (Layer 5)
// ---------------------------------------------------------------------------

describe('getToolColor (M65 Iter 2)', () => {
  it('classifies web tools as red', () => {
    expect(getToolColor('webSearch')).toBe('red');
    expect(getToolColor('webFetch')).toBe('red');
  });

  it('classifies consequential writes as blue', () => {
    expect(getToolColor('write_file')).toBe('blue');
    expect(getToolColor('edit_file')).toBe('blue');
    expect(getToolColor('create_page')).toBe('blue');
    expect(getToolColor('compose_page')).toBe('blue');
    expect(getToolColor('set_page_property')).toBe('blue');
    expect(getToolColor('set_page_style')).toBe('blue');
    expect(getToolColor('edit_block')).toBe('blue');
    expect(getToolColor('insert_block_after')).toBe('blue');
    expect(getToolColor('link_block')).toBe('blue');
    expect(getToolColor('surface_send')).toBe('blue');
  });

  it('classifies read-only tools as green (uncolored)', () => {
    expect(getToolColor('read_file')).toBe('green');
    expect(getToolColor('find_pages')).toBe('green');
    expect(getToolColor('search_knowledge')).toBe('green');
  });

  it('classifies unknown tool names as green', () => {
    expect(getToolColor('totally_unknown_tool')).toBe('green');
  });
});

describe('tainted-turn registry (M65 Iter 2)', () => {
  beforeEach(() => _resetColorGateRegistryForTests());

  it('isTurnTainted returns false for fresh session', () => {
    expect(isTurnTainted('session-a')).toBe(false);
  });

  it('markTurnTainted flips isTurnTainted to true', () => {
    markTurnTainted('session-a');
    expect(isTurnTainted('session-a')).toBe(true);
  });

  it('beginNewTurn clears taint for that session', () => {
    markTurnTainted('session-a');
    markTurnTainted('session-b');
    beginNewTurn('session-a');
    expect(isTurnTainted('session-a')).toBe(false);
    expect(isTurnTainted('session-b')).toBe(true);
  });

  it('resetSession removes session from registry', () => {
    markTurnTainted('session-a');
    resetSession('session-a');
    expect(isTurnTainted('session-a')).toBe(false);
  });

  it('falsy sessionId is a no-op (no global taint)', () => {
    markTurnTainted(undefined);
    markTurnTainted('');
    expect(isTurnTainted(undefined)).toBe(false);
    expect(isTurnTainted('')).toBe(false);
    expect(isTurnTainted('session-a')).toBe(false);
  });

  it('registry is bounded (LRU cap 64)', () => {
    for (let i = 0; i < 70; i++) {
      markTurnTainted(`s-${i}`);
    }
    // Oldest entries evicted; most recent survive.
    expect(isTurnTainted('s-0')).toBe(false);
    expect(isTurnTainted('s-69')).toBe(true);
  });
});

describe('resolveColorGate (M65 Iter 2)', () => {
  beforeEach(() => _resetColorGateRegistryForTests());

  it('blue tool in untainted turn ? no gate (null)', () => {
    expect(resolveColorGate('write_file', 'session-a')).toBeNull();
  });

  it('blue tool in tainted turn ? requires-approval', () => {
    markTurnTainted('session-a');
    expect(resolveColorGate('write_file', 'session-a')).toBe('requires-approval');
  });

  it('red tool returns null (its own permission posture applies)', () => {
    markTurnTainted('session-a');
    expect(resolveColorGate('webFetch', 'session-a')).toBeNull();
    expect(resolveColorGate('webSearch', 'session-a')).toBeNull();
  });

  it('green tool returns null even in tainted turn', () => {
    markTurnTainted('session-a');
    expect(resolveColorGate('read_file', 'session-a')).toBeNull();
  });

  it('blue tool with no sessionId returns null (no gate)', () => {
    markTurnTainted('session-a');
    expect(resolveColorGate('write_file', undefined)).toBeNull();
  });

  it('beginNewTurn re-opens blue tools (taint resets per turn)', () => {
    markTurnTainted('session-a');
    expect(resolveColorGate('write_file', 'session-a')).toBe('requires-approval');
    beginNewTurn('session-a');
    expect(resolveColorGate('write_file', 'session-a')).toBeNull();
  });

  it('taint of session-a does not affect session-b', () => {
    markTurnTainted('session-a');
    expect(resolveColorGate('write_file', 'session-b')).toBeNull();
  });
});
