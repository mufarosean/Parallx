// tests/unit/webResearchSlashCommand.test.ts — M65 Iter 3 C4:
// `/research <topic>` is Web Research's own command: offered while it runs
// (api.chat.registerSlashCommand), gone when it is turned off. Its template
// expands without touching the URL-provenance set.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createOpenclawCommandRegistry } from '../../src/openclaw/openclawDefaultRuntimeSupport.js';
import { registerContributedSlashCommand, registerContributedSkill } from '../../src/services/chatContributions.js';

const registered: Array<{ dispose(): void }> = [];
beforeAll(async () => {
  const ext: any = await import('../../ext/web-research/main.js');
  // What api.chat gives the extension (apiFactory), minus the rest of the api.
  ext.__test__.registerChatContributions({
    chat: {
      registerSlashCommand: (cmd: any) => { const d = registerContributedSlashCommand({ ...cmd, ownerToolId: 'parallx.web-research' }); registered.push(d); return d; },
      registerSkill: (content: string) => { const d = registerContributedSkill('research-topic', { content, ownerToolId: 'parallx.web-research' }); registered.push(d); return d; },
    },
  });
});
afterAll(() => { for (const d of registered) d.dispose(); });

describe('/research slash command (C4)', () => {
  const reg = createOpenclawCommandRegistry();

  it('is offered while Web Research runs', () => {
    expect(reg.getRegisteredCommands().map(c => c.name)).toContain('research');
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

  it('is not built in: it comes from the extension', () => {
    const parsed = reg.parseSlashCommand('/research x');
    expect(parsed.command?.isBuiltIn).toBe(false);
  });

  it('is gone when Web Research is turned off', () => {
    for (const d of registered) d.dispose();
    expect(reg.getRegisteredCommands().map(c => c.name)).not.toContain('research');
    expect(reg.parseSlashCommand('/research x').command).toBeUndefined();
  });
});
