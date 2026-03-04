// systemPromptGenerator.test.ts — Unit tests for M15 system prompt generator (Task 1.2)

import { describe, it, expect } from 'vitest';
import {
  generateChatSystemPrompt,
  generateSystemPromptPreview,
  buildGenInputFromProfile,
} from '../../src/aiSettings/systemPromptGenerator';
import { DEFAULT_PROFILE, BUILT_IN_PRESETS } from '../../src/aiSettings/aiSettingsDefaults';
import type { AISettingsProfile } from '../../src/aiSettings/aiSettingsTypes';

describe('generateChatSystemPrompt', () => {
  it('generates a non-empty prompt for the Default preset', () => {
    const input = buildGenInputFromProfile(DEFAULT_PROFILE);
    const prompt = generateChatSystemPrompt(input);
    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(50);
    expect(prompt).toContain('Parallx workspace');
    expect(prompt).toContain('Ollama');
  });

  it('generates a non-empty prompt for the Finance Focus preset', () => {
    const financePreset = BUILT_IN_PRESETS.find(p => p.id === 'finance-focus')!;
    const input = buildGenInputFromProfile(financePreset);
    const prompt = generateChatSystemPrompt(input);
    expect(prompt).toBeTruthy();
    expect(prompt).toContain('financial');
    expect(prompt).toContain('brief and direct'); // concise tone
  });

  it('generates a non-empty prompt for the Creative Mode preset', () => {
    const creativePreset = BUILT_IN_PRESETS.find(p => p.id === 'creative-mode')!;
    const input = buildGenInputFromProfile(creativePreset);
    const prompt = generateChatSystemPrompt(input);
    expect(prompt).toBeTruthy();
    expect(prompt).toContain('written content'); // writing focus
    expect(prompt).toContain('thorough and explanatory'); // detailed tone
  });

  it('produces different prompts for different tones', () => {
    const base = buildGenInputFromProfile(DEFAULT_PROFILE);
    const concise = generateChatSystemPrompt({ ...base, tone: 'concise' });
    const detailed = generateChatSystemPrompt({ ...base, tone: 'detailed' });
    expect(concise).not.toEqual(detailed);
    expect(concise).toContain('brief and direct');
    expect(detailed).toContain('thorough and explanatory');
  });

  it('produces different prompts for different focus domains', () => {
    const base = buildGenInputFromProfile(DEFAULT_PROFILE);
    const finance = generateChatSystemPrompt({ ...base, focusDomain: 'finance' });
    const coding = generateChatSystemPrompt({ ...base, focusDomain: 'coding' });
    expect(finance).toContain('financial');
    expect(coding).toContain('code');
    expect(finance).not.toEqual(coding);
  });

  it('uses custom focus description when domain is custom', () => {
    const base = buildGenInputFromProfile(DEFAULT_PROFILE);
    const custom = generateChatSystemPrompt({
      ...base,
      focusDomain: 'custom',
      customFocusDescription: 'medieval history and heraldry',
    });
    expect(custom).toContain('medieval history and heraldry');
  });

  it('produces different prompts for different response lengths', () => {
    const base = buildGenInputFromProfile(DEFAULT_PROFILE);
    const short = generateChatSystemPrompt({ ...base, responseLength: 'short' });
    const long = generateChatSystemPrompt({ ...base, responseLength: 'long' });
    expect(short).toContain('1–3 sentences');
    expect(long).toContain('comprehensive');
    expect(short).not.toEqual(long);
  });

  it('omits empty focus line for general domain', () => {
    const base = buildGenInputFromProfile(DEFAULT_PROFILE);
    const general = generateChatSystemPrompt({ ...base, focusDomain: 'general' });
    // general focus has empty string — should not produce blank lines at end
    const lines = general.split('\n').filter(l => l.length > 0);
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });
});

describe('generateSystemPromptPreview', () => {
  it('returns a chatPrompt from a full profile', () => {
    const result = generateSystemPromptPreview(DEFAULT_PROFILE);
    expect(result.chatPrompt).toBeTruthy();
    expect(result.chatPrompt).toContain('Parallx workspace');
  });
});

describe('buildGenInputFromProfile', () => {
  it('merges cross-section fields into a single input', () => {
    const input = buildGenInputFromProfile(DEFAULT_PROFILE);
    expect(input.tone).toBe('balanced');
    expect(input.focusDomain).toBe('general');
    expect(input.responseLength).toBe('adaptive');
    expect(input.systemPromptIsCustom).toBe(false);
  });
});

describe('BUILT_IN_PRESETS', () => {
  it('contains exactly 3 presets', () => {
    expect(BUILT_IN_PRESETS).toHaveLength(3);
  });

  it('all presets are marked as built-in', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.isBuiltIn).toBe(true);
    }
  });

  it('all presets have pre-generated system prompts', () => {
    for (const preset of BUILT_IN_PRESETS) {
      expect(preset.chat.systemPrompt).toBeTruthy();
      expect(preset.chat.systemPrompt.length).toBeGreaterThan(50);
    }
  });

  it('each preset has a unique id', () => {
    const ids = BUILT_IN_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
