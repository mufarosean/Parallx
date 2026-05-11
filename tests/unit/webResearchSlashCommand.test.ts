// tests/unit/webResearchSlashCommand.test.ts — M65 Iter 3 C4:
// `/research <topic>` registers in OPENCLAW_COMMANDS, expands its template
// without touching the URL-provenance set, and is discoverable through the
// command registry facade.

import { describe, it, expect } from 'vitest';
import { createOpenclawCommandRegistry } from '../../src/openclaw/openclawDefaultRuntimeSupport.js';

describe('/research slash command (C4)', () => {
  const reg = createOpenclawCommandRegistry();

  it('exists in the built-in command registry', () => {
    const all = reg.getRegisteredCommands();
    const names = all.map(c => c.name);
    expect(names).toContain('research');
  });

  it('parses "/research rust async runtimes"', () => {
    const parsed = reg.parseSlashCommand('/research rust async runtimes');
    expect(parsed.commandName).toBe('research');
    expect(parsed.command?.name).toBe('research');
    expect(parsed.remainingText).toBe('rust async runtimes');
  });

  it('expands the template with {input}', () => {
    const parsed = reg.parseSlashCommand('/research rust async runtimes');
    const expanded = reg.applyCommandTemplate(parsed.command!, parsed.remainingText);
    expect(expanded).toContain('research-topic skill');
    expect(expanded).toContain('rust async runtimes');
  });

  it('template references the research-topic skill (defense in depth — verifies the LLM is steered to the skill, not free-form URL fetching)', () => {
    const parsed = reg.parseSlashCommand('/research foo');
    const expanded = reg.applyCommandTemplate(parsed.command!, parsed.remainingText);
    expect(expanded).toMatch(/research-topic skill/i);
  });

  it('does NOT contain any URL pattern in the template body (no provenance bypass)', () => {
    const parsed = reg.parseSlashCommand('/research foo');
    const expanded = reg.applyCommandTemplate(parsed.command!, parsed.remainingText);
    // The slash command template MUST NOT inject https:// URLs — those can
    // only come from the user's literal message, prior webSearch results,
    // or prior webFetch finalUrls (M65 Layer 2).
    expect(expanded).not.toMatch(/https?:\/\//i);
  });

  it('is marked built-in', () => {
    const parsed = reg.parseSlashCommand('/research x');
    expect(parsed.command?.isBuiltIn).toBe(true);
  });
});
