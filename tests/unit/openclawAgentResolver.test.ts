import { describe, expect, it } from 'vitest';

import { resolveAgentConfig, resolveDefaultAgentId } from '../../src/openclaw/agents/openclawAgentResolver';
import { createAgentRegistry } from '../../src/openclaw/agents/openclawAgentRegistry';
import type { IAgentConfig, IAgentDefaults } from '../../src/openclaw/agents/openclawAgentConfig';
import type { IGlobalConfigSlice } from '../../src/openclaw/agents/openclawAgentResolver';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agent(id: string, opts?: Partial<IAgentConfig>): IAgentConfig {
  return { id, name: id, ...opts };
}

const GLOBAL: IGlobalConfigSlice = {
  model: 'gpt-oss',
  temperature: 0.7,
  maxTokens: 4096,
  maxIterations: 25,
  autoRag: true,
};

// ---------------------------------------------------------------------------
// resolveAgentConfig
// ---------------------------------------------------------------------------

describe('resolveAgentConfig', () => {
  it('with known agent uses agent values', () => {
    const registry = createAgentRegistry([
      agent('test', { model: 'custom-model', temperature: 0.3, maxTokens: 2048, maxIterations: 10, autoRag: false }),
    ]);
    const resolved = resolveAgentConfig(registry, 'test', GLOBAL);
    expect(resolved.model).toBe('custom-model');
    expect(resolved.temperature).toBe(0.3);
    expect(resolved.maxTokens).toBe(2048);
    expect(resolved.maxIterations).toBe(10);
    expect(resolved.autoRag).toBe(false);
  });

  it('with unknown agent uses global defaults', () => {
    const registry = createAgentRegistry();
    const resolved = resolveAgentConfig(registry, 'unknown', GLOBAL);
    expect(resolved.id).toBe('unknown');
    expect(resolved.name).toBe('unknown');
    expect(resolved.model).toBe('gpt-oss');
    expect(resolved.temperature).toBe(0.7);
    expect(resolved.maxTokens).toBe(4096);
  });

  it('merge order: agent overrides agentDefaults overrides global', () => {
    const registry = createAgentRegistry([
      agent('test', { temperature: 0.2 }),
    ]);
    const defaults: IAgentDefaults = { temperature: 0.5, model: 'llama3' };
    const resolved = resolveAgentConfig(registry, 'test', GLOBAL, defaults);
    // Agent temperature wins over defaults
    expect(resolved.temperature).toBe(0.2);
    // Defaults model wins over global (agent has no model override)
    expect(resolved.model).toBe('llama3');
    // Global maxTokens is used (neither agent nor defaults override)
    expect(resolved.maxTokens).toBe(4096);
  });

  it('agent temperature=0.2 + global temperature=0.7 → resolved = 0.2', () => {
    const registry = createAgentRegistry([agent('a', { temperature: 0.2 })]);
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL);
    expect(resolved.temperature).toBe(0.2);
  });

  it('agent model=undefined + defaults model=llama3 + global model=gpt-oss → resolved = llama3', () => {
    const registry = createAgentRegistry([agent('a')]);
    const defaults: IAgentDefaults = { model: 'llama3' };
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL, defaults);
    expect(resolved.model).toBe('llama3');
  });

  it('tools merge: agent deny + defaults deny = combined deny list', () => {
    const registry = createAgentRegistry([
      agent('a', { tools: { deny: ['write_file'] } }),
    ]);
    const defaults: IAgentDefaults = { tools: { deny: ['run_command'] } };
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL, defaults);
    expect(resolved.tools.deny).toEqual(['run_command', 'write_file']);
  });

  it('tools merge: agent allow overrides defaults allow', () => {
    const registry = createAgentRegistry([
      agent('a', { tools: { allow: ['read_file'] } }),
    ]);
    const defaults: IAgentDefaults = { tools: { allow: ['read_file', 'write_file'] } };
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL, defaults);
    expect(resolved.tools.allow).toEqual(['read_file']);
  });

  it('resolveAgentConfig preserves identity and systemPromptOverlay from agent', () => {
    const registry = createAgentRegistry([
      agent('a', {
        identity: { name: 'Helper', theme: 'friendly', emoji: '🤖' },
        systemPromptOverlay: 'You are a specialized helper.',
      }),
    ]);
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL);
    expect(resolved.identity).toEqual({ name: 'Helper', theme: 'friendly', emoji: '🤖' });
    expect(resolved.systemPromptOverlay).toBe('You are a specialized helper.');
  });

  // Edge cases: empty arrays and undefined fields
  it('tools merge: empty agent deny + defaults deny = defaults deny only', () => {
    const registry = createAgentRegistry([
      agent('a', { tools: { deny: [] } }),
    ]);
    const defaults: IAgentDefaults = { tools: { deny: ['run_command'] } };
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL, defaults);
    expect(resolved.tools.deny).toEqual(['run_command']);
  });

  it('tools merge: agent with empty allow + defaults with allow = agent empty wins', () => {
    const registry = createAgentRegistry([
      agent('a', { tools: { allow: [] } }),
    ]);
    const defaults: IAgentDefaults = { tools: { allow: ['read_file', 'write_file'] } };
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL, defaults);
    // Agent allow is [] — not null/undefined, so ?? does NOT fall through to defaults.
    // An explicit empty allow means "allow nothing from agent perspective".
    expect(resolved.tools.allow).toEqual([]);
  });

  it('resolved config for unknown agent has empty tools object', () => {
    const registry = createAgentRegistry();
    const resolved = resolveAgentConfig(registry, 'unknown', GLOBAL);
    expect(resolved.tools).toEqual({});
    expect(resolved.tools.allow).toBeUndefined();
    expect(resolved.tools.deny).toBeUndefined();
  });

  it('agent with no tools + no defaults = empty tools', () => {
    const registry = createAgentRegistry([agent('a')]);
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL);
    expect(resolved.tools).toEqual({});
  });

  it('agent with undefined identity + undefined overlay = undefined in resolved', () => {
    const registry = createAgentRegistry([agent('a')]);
    const resolved = resolveAgentConfig(registry, 'a', GLOBAL);
    expect(resolved.identity).toBeUndefined();
    expect(resolved.systemPromptOverlay).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// resolveDefaultAgentId
// ---------------------------------------------------------------------------

describe('resolveDefaultAgentId', () => {
  it('returns correct ID', () => {
    const registry = createAgentRegistry([
      agent('a'),
      agent('b', { isDefault: true }),
    ]);
    expect(resolveDefaultAgentId(registry)).toBe('b');
  });
});
