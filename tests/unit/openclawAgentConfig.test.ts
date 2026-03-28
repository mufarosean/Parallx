import { describe, expect, it } from 'vitest';

import { DEFAULT_AGENT_CONFIGS } from '../../src/openclaw/agents/openclawAgentConfig';

describe('DEFAULT_AGENT_CONFIGS', () => {
  it('has exactly 3 entries', () => {
    expect(DEFAULT_AGENT_CONFIGS).toHaveLength(3);
  });

  it('has exactly one default agent', () => {
    const defaults = DEFAULT_AGENT_CONFIGS.filter(a => a.isDefault);
    expect(defaults).toHaveLength(1);
  });

  it('all have unique IDs', () => {
    const ids = DEFAULT_AGENT_CONFIGS.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all have non-empty name', () => {
    for (const agent of DEFAULT_AGENT_CONFIGS) {
      expect(agent.name).toBeTruthy();
    }
  });

  it('built-in IDs are default, workspace, canvas', () => {
    const ids = DEFAULT_AGENT_CONFIGS.map(a => a.id);
    expect(ids).toEqual(['default', 'workspace', 'canvas']);
  });
});
