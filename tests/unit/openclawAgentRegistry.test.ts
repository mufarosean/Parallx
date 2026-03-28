import { describe, expect, it } from 'vitest';

import { AgentRegistry, createAgentRegistry } from '../../src/openclaw/agents/openclawAgentRegistry';
import type { IAgentConfig } from '../../src/openclaw/agents/openclawAgentConfig';
import { DEFAULT_AGENT_CONFIGS } from '../../src/openclaw/agents/openclawAgentConfig';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function agent(id: string, opts?: Partial<IAgentConfig>): IAgentConfig {
  return { id, name: id, ...opts };
}

// ---------------------------------------------------------------------------
// AgentRegistry
// ---------------------------------------------------------------------------

describe('AgentRegistry', () => {
  it('constructor populates from initial configs', () => {
    const registry = createAgentRegistry(DEFAULT_AGENT_CONFIGS);
    expect(registry.list()).toHaveLength(3);
  });

  it('register() adds a new agent', () => {
    const registry = createAgentRegistry();
    registry.register(agent('custom'));
    expect(registry.get('custom')).toBeDefined();
    expect(registry.get('custom')!.id).toBe('custom');
  });

  it('register() replaces existing agent with same ID', () => {
    const registry = createAgentRegistry([agent('a', { name: 'Original' })]);
    registry.register(agent('a', { name: 'Replaced' }));
    expect(registry.get('a')!.name).toBe('Replaced');
    expect(registry.list()).toHaveLength(1);
  });

  it('unregister() removes agent and returns true', () => {
    const registry = createAgentRegistry([agent('a')]);
    expect(registry.unregister('a')).toBe(true);
    expect(registry.get('a')).toBeUndefined();
  });

  it('unregister() returns false for unknown ID', () => {
    const registry = createAgentRegistry();
    expect(registry.unregister('nonexistent')).toBe(false);
  });

  it('get() returns correct agent by ID', () => {
    const registry = createAgentRegistry([agent('x', { name: 'AgentX' })]);
    expect(registry.get('x')!.name).toBe('AgentX');
  });

  it('get() returns undefined for unknown ID', () => {
    const registry = createAgentRegistry();
    expect(registry.get('nope')).toBeUndefined();
  });

  it('getDefault() returns agent with isDefault:true', () => {
    const registry = createAgentRegistry([
      agent('a'),
      agent('b', { isDefault: true }),
      agent('c'),
    ]);
    expect(registry.getDefault().id).toBe('b');
  });

  it('getDefault() returns first agent when none marked default', () => {
    const registry = createAgentRegistry([agent('first'), agent('second')]);
    expect(registry.getDefault().id).toBe('first');
  });

  it('getDefault() throws when registry is empty', () => {
    const registry = createAgentRegistry();
    expect(() => registry.getDefault()).toThrow('AgentRegistry: no agents registered');
  });

  it('list() returns all agents', () => {
    const registry = createAgentRegistry([agent('a'), agent('b'), agent('c')]);
    const ids = registry.list().map(a => a.id);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('listIds() returns all IDs', () => {
    const registry = createAgentRegistry([agent('x'), agent('y')]);
    expect(registry.listIds()).toEqual(['x', 'y']);
  });
});
