import { describe, expect, it } from 'vitest';

import {
  buildCustomAiPrompt,
  normalizeCustomAiConfig,
} from '../../src/built-in/dashboard/widgets/customAiWidget';

describe('customAiWidget config + prompt', () => {
  it('normalizes missing fields to empty strings', () => {
    expect(normalizeCustomAiConfig(undefined)).toEqual({ prompt: '', skill: '' });
    expect(normalizeCustomAiConfig({ prompt: 'hi' })).toEqual({ prompt: 'hi', skill: '' });
    expect(normalizeCustomAiConfig({ prompt: 'hi', skill: 'morning-news' })).toEqual({
      prompt: 'hi',
      skill: 'morning-news',
    });
    // Non-string values are coerced away.
    expect(normalizeCustomAiConfig({ prompt: 42, skill: ['x'] })).toEqual({ prompt: '', skill: '' });
  });

  it('embeds the widget instanceId and the dashboard_render_widget directive', () => {
    const prompt = buildCustomAiPrompt({ prompt: 'Summarize my unread email.', skill: '' }, 'widget_abc');
    expect(prompt).toContain('Summarize my unread email.');
    expect(prompt).toContain('dashboard_render_widget tool with instanceId "widget_abc"');
  });

  it('prepends a skill directive when a skill is set', () => {
    const prompt = buildCustomAiPrompt(
      { prompt: 'Brief me on the markets.', skill: 'market-snapshot' },
      'widget_xyz',
    );
    expect(prompt).toContain('Use the `market-snapshot` skill for this task.');
    // The skill directive comes before the user prompt.
    expect(prompt.indexOf('market-snapshot')).toBeLessThan(prompt.indexOf('Brief me on the markets.'));
  });

  it('omits the skill directive entirely when no skill is set', () => {
    const prompt = buildCustomAiPrompt({ prompt: 'Do a thing.', skill: '   ' }, 'widget_1');
    expect(prompt).not.toContain('skill for this task');
  });
});
