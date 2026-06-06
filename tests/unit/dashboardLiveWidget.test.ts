import { describe, expect, it } from 'vitest';

import {
  buildLivePrompt,
  normalizeLiveConfig,
} from '../../src/built-in/dashboard/widgets/liveWidget';

describe('liveWidget config + prompt', () => {
  it('normalizes missing/non-string fields to empty strings', () => {
    expect(normalizeLiveConfig(undefined)).toEqual({ prompt: '', skill: '' });
    expect(normalizeLiveConfig({ prompt: 'hi' })).toEqual({ prompt: 'hi', skill: '' });
    expect(normalizeLiveConfig({ prompt: 42, skill: ['x'] })).toEqual({ prompt: '', skill: '' });
  });

  it('embeds the instanceId and the dashboard_render_widget directive', () => {
    const prompt = buildLivePrompt({ prompt: 'A donut chart of my week.', skill: '' }, 'widget_live_1');
    expect(prompt).toContain('A donut chart of my week.');
    expect(prompt).toContain('dashboard_render_widget tool with instanceId "widget_live_1"');
  });

  it('instructs the model to produce self-contained HTML with no external resources', () => {
    const prompt = buildLivePrompt({ prompt: 'Build a gauge.', skill: '' }, 'w');
    expect(prompt).toMatch(/self-contained HTML/i);
    expect(prompt).toMatch(/no external resources/i);
    expect(prompt).toMatch(/no markdown/i);
  });

  it('points the model at the theme variables so it does not hardcode colors', () => {
    const prompt = buildLivePrompt({ prompt: 'x', skill: '' }, 'w');
    expect(prompt).toContain('var(--px-accent)');
    expect(prompt).toMatch(/do not hardcode colors/i);
  });

  it('forbids light backgrounds and mandates light text (dark theme)', () => {
    const prompt = buildLivePrompt({ prompt: 'x', skill: '' }, 'w');
    expect(prompt).toMatch(/do not set a white or light background/i);
    expect(prompt).toMatch(/text must be light/i);
  });

  it('steers charts away from hand-computed SVG arc paths', () => {
    const prompt = buildLivePrompt({ prompt: 'x', skill: '' }, 'w');
    expect(prompt).toMatch(/conic-gradient/i);
    expect(prompt).toMatch(/avoid hand-written svg arc/i);
  });

  it('requires charts to be sized so they are never clipped into a half-shape', () => {
    const prompt = buildLivePrompt({ prompt: 'x', skill: '' }, 'w');
    expect(prompt).toMatch(/never be clipped|aspect-ratio: 1|square box/i);
  });

  it('prepends a skill directive before the prompt when a skill is set', () => {
    const prompt = buildLivePrompt({ prompt: 'Chart it.', skill: 'dashboard-charts' }, 'w');
    expect(prompt).toContain('Use the `dashboard-charts` skill for this task.');
    expect(prompt.indexOf('dashboard-charts')).toBeLessThan(prompt.indexOf('Chart it.'));
  });

  it('omits the skill directive when no skill is set', () => {
    const prompt = buildLivePrompt({ prompt: 'Do a thing.', skill: '   ' }, 'w');
    expect(prompt).not.toContain('skill for this task');
  });
});
