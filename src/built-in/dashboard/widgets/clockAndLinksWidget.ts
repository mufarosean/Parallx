// clockAndLinksWidget.ts — static "At a glance" widget.
//
// Renders the current date/time (auto-ticking client-side) plus a small
// list of user-configured quick links. No refresh handler — content is
// either time-derived (client) or static-from-config.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface QuickLink {
  readonly label: string;
  readonly url: string;
}

type ClockFormat = '12h' | '24h';

interface ClockAndLinksConfig {
  readonly greetingName: string;
  readonly clockFormat: ClockFormat;
  readonly showSeconds: boolean;
  readonly links: readonly QuickLink[];
}

const DEFAULT_CONFIG: ClockAndLinksConfig = {
  greetingName: '',
  clockFormat: '12h',
  showSeconds: false,
  links: [],
};

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';

function pad(n: number): string { return n.toString().padStart(2, '0'); }

function formatGreeting(name: string): string {
  const hour = new Date().getHours();
  const period = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return name ? `${period}, ${name}.` : `${period}.`;
}

export const CLOCK_AND_LINKS_WIDGET: WidgetTypeRegistration<ClockAndLinksConfig> = {
  typeId: 'parallx.dashboard.clock-and-links',
  displayName: 'Clock & quick links',
  description: 'Time, date, and a customizable set of one-click shortcuts.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 2 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      greetingName: {
        type: 'string',
        label: 'Your name (optional)',
        placeholder: 'e.g. Mufaro',
        description: 'Used in the greeting. Leave blank to show just "Good morning."',
      },
      clockFormat: {
        type: 'enum',
        label: 'Clock format',
        options: [
          { value: '12h', label: '12-hour (3:45 PM)' },
          { value: '24h', label: '24-hour (15:45)' },
        ],
      },
      showSeconds: {
        type: 'boolean',
        label: 'Show seconds in the clock',
      },
      links: {
        type: 'string-list',
        label: 'Quick links',
        description: 'One per line, in the form "Label | https://example.com".',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<ClockAndLinksConfig>): WidgetHandle {
    container.classList.add('clw');
    let currentConfig = normalizeConfig(ctx.config);

    const clock = document.createElement('div');
    clock.className = 'clw__clock';

    const greeting = document.createElement('div');
    greeting.className = 'clw__greeting';

    const time = document.createElement('div');
    time.className = 'clw__time';

    const date = document.createElement('div');
    date.className = 'clw__date';

    clock.appendChild(greeting);
    clock.appendChild(time);
    clock.appendChild(date);
    container.appendChild(clock);

    const linksWrap = document.createElement('div');
    linksWrap.className = 'clw__links';
    container.appendChild(linksWrap);

    function tick(): void {
      const now = new Date();
      greeting.textContent = formatGreeting(currentConfig.greetingName);
      time.textContent = formatTime(now, currentConfig.clockFormat, currentConfig.showSeconds);
      date.textContent = now.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      });
    }

    function renderLinks(): void {
      linksWrap.innerHTML = '';
      if (currentConfig.links.length === 0) {
        const hint = document.createElement('span');
        hint.className = 'clw__links-hint';
        hint.textContent = 'Add quick links from this widget\'s ⋯ menu.';
        linksWrap.appendChild(hint);
        return;
      }
      for (const link of currentConfig.links) {
        const a = document.createElement('a');
        a.className = 'clw__link';
        a.href = link.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = link.label;
        a.title = link.url;
        linksWrap.appendChild(a);
      }
    }

    tick();
    renderLinks();
    const interval = setInterval(tick, currentConfig.showSeconds ? 1_000 : 30_000);

    const configSub = ctx.onDidChangeConfig((next) => {
      currentConfig = normalizeConfig(next);
      // Re-create the interval with the right cadence if seconds toggle changed.
      clearInterval(interval);
      const newInterval = setInterval(tick, currentConfig.showSeconds ? 1_000 : 30_000);
      // We can't reassign a const — capture in module-level closure via box.
      (tick as any)._interval = newInterval;
      tick();
      renderLinks();
    });

    return {
      dispose() {
        clearInterval(interval);
        const stored = (tick as any)._interval as ReturnType<typeof setInterval> | undefined;
        if (stored) clearInterval(stored);
        configSub.dispose();
      },
    };
  },
};

function formatTime(now: Date, format: ClockFormat, withSeconds: boolean): string {
  if (format === '24h') {
    const base = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return withSeconds ? `${base}:${pad(now.getSeconds())}` : base;
  }
  const h24 = now.getHours();
  const period = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const base = `${h12}:${pad(now.getMinutes())}`;
  const body = withSeconds ? `${base}:${pad(now.getSeconds())}` : base;
  return `${body} ${period}`;
}

function normalizeConfig(raw: unknown): ClockAndLinksConfig {
  const cfg = (raw ?? {}) as Partial<ClockAndLinksConfig> & { links?: unknown };
  return {
    greetingName: typeof cfg.greetingName === 'string' ? cfg.greetingName : '',
    clockFormat: cfg.clockFormat === '24h' ? '24h' : '12h',
    showSeconds: cfg.showSeconds === true,
    links: parseLinks(cfg.links),
  };
}

function parseLinks(raw: unknown): readonly QuickLink[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        if (typeof item === 'string') return parseLinkLine(item);
        if (item && typeof item === 'object' && 'label' in item && 'url' in item) {
          const { label, url } = item as { label: unknown; url: unknown };
          if (typeof label === 'string' && typeof url === 'string' && label && url) {
            return { label, url };
          }
        }
        return null;
      })
      .filter((x): x is QuickLink => x !== null);
  }
  if (typeof raw === 'string') {
    return raw.split('\n').map(parseLinkLine).filter((x): x is QuickLink => x !== null);
  }
  return [];
}

function parseLinkLine(line: string): QuickLink | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('|').map(s => s.trim());
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { label: parts[0], url: parts[1] };
  }
  if (parts.length === 1) {
    // Tolerate a bare URL — use the host as the label.
    try {
      const u = new URL(parts[0]);
      return { label: u.hostname, url: parts[0] };
    } catch {
      return null;
    }
  }
  return null;
}
