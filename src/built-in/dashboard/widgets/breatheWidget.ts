// breatheWidget.ts — a breathing circle for the space between two tasks.
//
// A soft circle grows on the inhale, holds, and shrinks on the exhale,
// with the phase named underneath. The pace is yours to set; box
// breathing (4-4-4-4) is the default. Pure CSS transitions driven by a
// phase timer; no sound, no tracking, nothing to finish.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface BreatheConfig {
  readonly inhale: number;
  readonly hold: number;
  readonly exhale: number;
  readonly rest: number;
}

const DEFAULT_CONFIG: BreatheConfig = { inhale: 4, hold: 4, exhale: 4, rest: 4 };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9" opacity="0.4"/></svg>';

function seconds(v: unknown, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(20, Math.max(1, n));
}

function normalizeConfig(raw: unknown): BreatheConfig {
  const cfg = (raw ?? {}) as Partial<BreatheConfig>;
  return {
    inhale: seconds(cfg.inhale, DEFAULT_CONFIG.inhale),
    hold: seconds(cfg.hold, DEFAULT_CONFIG.hold),
    exhale: seconds(cfg.exhale, DEFAULT_CONFIG.exhale),
    rest: seconds(cfg.rest, DEFAULT_CONFIG.rest),
  };
}

type Phase = 'inhale' | 'hold' | 'exhale' | 'rest';
const PHASE_LABEL: Record<Phase, string> = {
  inhale: 'Breathe in', hold: 'Hold', exhale: 'Breathe out', rest: 'Rest',
};

export const BREATHE_WIDGET: WidgetTypeRegistration<BreatheConfig> = {
  typeId: 'parallx.dashboard.breathe',
  displayName: 'Breathing Circle',
  description: 'A soft circle that breathes at the pace you set. For the space between two tasks.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 3, rowSpan: 3 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      inhale: { type: 'number', label: 'Inhale (seconds)' },
      hold: { type: 'number', label: 'Hold (seconds)' },
      exhale: { type: 'number', label: 'Exhale (seconds)' },
      rest: { type: 'number', label: 'Rest (seconds)' },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<BreatheConfig>): WidgetHandle {
    container.classList.add('brw');
    let config = normalizeConfig(ctx.config);

    const stage = document.createElement('div');
    stage.className = 'brw__stage';
    const circle = document.createElement('div');
    circle.className = 'brw__circle';
    stage.appendChild(circle);
    const label = document.createElement('div');
    label.className = 'brw__label';
    container.appendChild(stage);
    container.appendChild(label);

    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    function enter(phase: Phase): void {
      if (disposed) return;
      const dur = config[phase];
      label.textContent = PHASE_LABEL[phase];
      // The circle eases toward its size over the whole phase; hold and
      // rest keep the previous size (transition to the same scale).
      circle.style.transitionDuration = `${dur}s`;
      if (phase === 'inhale') circle.classList.add('brw__circle--full');
      if (phase === 'exhale') circle.classList.remove('brw__circle--full');
      const next: Phase = phase === 'inhale' ? 'hold'
        : phase === 'hold' ? 'exhale'
        : phase === 'exhale' ? 'rest'
        : 'inhale';
      timer = setTimeout(() => enter(next), dur * 1000);
    }

    enter('inhale');

    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      if (timer) clearTimeout(timer);
      circle.classList.remove('brw__circle--full');
      enter('inhale');
    });

    return {
      dispose() {
        disposed = true;
        if (timer) clearTimeout(timer);
        sub.dispose();
      },
    };
  },
};
