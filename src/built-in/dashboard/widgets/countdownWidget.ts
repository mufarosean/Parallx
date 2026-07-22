// countdownWidget.ts — a live countdown to a target date.
//
// Static + client-ticking, same family as the clock widget: no refresh handler,
// the display is derived entirely from config + the current time. Shows the
// remaining days / hours / minutes (and seconds, optionally) until a target
// moment, or a finished state once it has passed.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface CountdownConfig {
  readonly title: string;
  /** Target moment, parsed with Date.parse. ISO ("2026-12-25" or with time). */
  readonly target: string;
  readonly showSeconds: boolean;
}

const DEFAULT_CONFIG: CountdownConfig = {
  title: 'New Year',
  target: `${new Date().getFullYear() + 1}-01-01`,
  showSeconds: false,
};

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/></svg>';

function normalizeConfig(raw: unknown): CountdownConfig {
  const cfg = (raw ?? {}) as Partial<CountdownConfig>;
  return {
    title: typeof cfg.title === 'string' ? cfg.title : '',
    target: typeof cfg.target === 'string' ? cfg.target : '',
    showSeconds: cfg.showSeconds === true,
  };
}

interface Remaining { days: number; hours: number; minutes: number; seconds: number; }

function breakdown(ms: number): Remaining {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    days: Math.floor(total / 86_400),
    hours: Math.floor((total % 86_400) / 3_600),
    minutes: Math.floor((total % 3_600) / 60),
    seconds: total % 60,
  };
}

export const COUNTDOWN_WIDGET: WidgetTypeRegistration<CountdownConfig> = {
  typeId: 'parallx.dashboard.countdown',
  displayName: 'Countdown',
  description: 'Counts down to a date you set — a launch, a trip, a deadline. Ticks live.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 2 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      title: {
        type: 'string',
        label: 'What are you counting down to?',
        placeholder: 'e.g. Product launch',
      },
      target: {
        type: 'string',
        label: 'Target date',
        description: 'A date like 2026-12-25, or with a time: 2026-12-25 18:00.',
        placeholder: 'YYYY-MM-DD',
      },
      showSeconds: {
        type: 'boolean',
        label: 'Show seconds',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<CountdownConfig>): WidgetHandle {
    container.classList.add('cdw');
    let config = normalizeConfig(ctx.config);

    const title = document.createElement('div');
    title.className = 'cdw__title';

    const body = document.createElement('div');
    body.className = 'cdw__body';

    const caption = document.createElement('div');
    caption.className = 'cdw__caption';

    container.appendChild(title);
    container.appendChild(body);
    container.appendChild(caption);

    function targetMs(): number | null {
      if (!config.target.trim()) return null;
      const ms = Date.parse(config.target);
      return Number.isFinite(ms) ? ms : null;
    }

    function unit(value: number, label: string): string {
      return `<span class="cdw__unit"><span class="cdw__num">${value}</span><span class="cdw__lbl">${label}</span></span>`;
    }

    function tick(): void {
      title.textContent = config.title || 'Countdown';
      const tgt = targetMs();

      if (tgt === null) {
        body.innerHTML = '<span class="cdw__empty">Set a target date in settings</span>';
        caption.textContent = '';
        container.classList.remove('cdw--done');
        return;
      }

      const diff = tgt - Date.now();
      if (diff <= 0) {
        container.classList.add('cdw--done');
        body.innerHTML = '<span class="cdw__done-text">Done</span>';
        caption.textContent = new Date(tgt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
        return;
      }

      container.classList.remove('cdw--done');
      const r = breakdown(diff);
      const parts = [unit(r.days, r.days === 1 ? 'day' : 'days'), unit(r.hours, 'hrs'), unit(r.minutes, 'min')];
      if (config.showSeconds) parts.push(unit(r.seconds, 'sec'));
      body.innerHTML = parts.join('');
      caption.textContent = new Date(tgt).toLocaleDateString(undefined, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
    }

    tick();
    let interval = setInterval(tick, config.showSeconds ? 1_000 : 30_000);

    const sub = ctx.onDidChangeConfig((next) => {
      config = normalizeConfig(next);
      clearInterval(interval);
      interval = setInterval(tick, config.showSeconds ? 1_000 : 30_000);
      tick();
    });

    return {
      dispose() {
        clearInterval(interval);
        sub.dispose();
      },
    };
  },
};
