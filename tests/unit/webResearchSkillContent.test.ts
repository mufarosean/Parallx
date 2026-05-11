// tests/unit/webResearchSkillContent.test.ts — M65 Iter 3 C9:
// the research-topic default skill is shipped, has valid frontmatter, and
// spells out the four non-negotiable rules (multi-source minimum, depth-1
// stop, untrusted-as-data, citation requirement) in its body.

import { describe, it, expect } from 'vitest';
import { defaultSkillContents } from '../../src/built-in/chat/skills/defaultSkillContents.js';

describe('research-topic default skill (M65 Iter 3)', () => {
  const body = defaultSkillContents.get('research-topic');

  it('is shipped in defaultSkillContents', () => {
    expect(body).toBeDefined();
    expect(typeof body).toBe('string');
    expect(body!.length).toBeGreaterThan(500);
  });

  it('has valid YAML frontmatter declaring kind=workflow', () => {
    expect(body!).toMatch(/^---\r?\n/);
    expect(body!).toMatch(/\nname:\s*research-topic\r?\n/);
    expect(body!).toMatch(/\nkind:\s*workflow\r?\n/);
    expect(body!).toMatch(/\nuser-invocable:\s*true\r?\n/);
    expect(body!).toMatch(/\nversion:\s*1\.0\.0\r?\n/);
  });

  it('declares requires-approval permission (because it touches the network)', () => {
    expect(body!).toMatch(/\npermission:\s*requires-approval\r?\n/);
  });

  it('spells out the multi-source minimum (2+)', () => {
    expect(body!).toMatch(/multi-source/i);
    expect(body!).toMatch(/at least \*\*2 independent sources\*\*/i);
  });

  it('spells out the depth-1 hard stop', () => {
    expect(body!).toMatch(/depth-1/i);
    expect(body!).toMatch(/Links cited inside[\s\S]{0,80}NOT auto-fetchable/i);
  });

  it('instructs to treat <untrusted_web_content> as data, not instructions', () => {
    expect(body!).toMatch(/<untrusted_web_content/);
    expect(body!).toMatch(/data, never instructions/i);
  });

  it('mandates source citations', () => {
    expect(body!).toMatch(/Citations are mandatory/i);
  });

  it('references the getResearchHub / setResearchHub / logResearchEvent tools', () => {
    expect(body!).toContain('getResearchHub');
    expect(body!).toContain('setResearchHub');
    expect(body!).toContain('logResearchEvent');
  });

  it('references create_page for Hub + draft creation', () => {
    expect(body!).toContain('create_page');
  });

  it('states the per-turn budget caps so the LLM plans accordingly', () => {
    expect(body!).toMatch(/3 searches/);
    expect(body!).toMatch(/5 fetches/);
  });
});
