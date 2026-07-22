// weatherWidget.ts — AI-backed local weather widget.
//
// Uses the same push model as the news brief: on refresh it asks the active
// chat session to look up the current conditions + short forecast for the
// configured location with its web-research tools, then deliver clean Markdown
// back to this widget via the shared `dashboard_render_widget` tool. We never invent
// weather here — the AI fetches it and reports only what the sources say.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { renderMarkdownToDom } from './markdownRenderer.js';

type Units = 'imperial' | 'metric';

interface WeatherConfig {
  readonly location: string;
  readonly units: Units;
  readonly forecastDays: number;
}

const DEFAULT_CONFIG: WeatherConfig = {
  location: 'San Antonio, Texas',
  units: 'imperial',
  forecastDays: 3,
};

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 16.5"/><path d="M16 14v6"/><path d="M8 14v6"/><path d="M12 16v6"/></svg>';

export const WEATHER_WIDGET: WidgetTypeRegistration<WeatherConfig> = {
  typeId: 'parallx.dashboard.weather',
  displayName: 'Weather',
  description: 'AI-fetched current conditions and a short forecast for your area. Add a refresh schedule to keep it current.',
  icon: ICON_SVG,
  category: 'ai',
  defaultSize: { colSpan: 4, rowSpan: 3 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      location: {
        type: 'string',
        label: 'Location',
        description: 'City or region to report on.',
        placeholder: 'San Antonio, Texas',
      },
      units: {
        type: 'enum',
        label: 'Units',
        options: [
          { value: 'imperial', label: 'Fahrenheit (°F)' },
          { value: 'metric', label: 'Celsius (°C)' },
        ],
      },
      forecastDays: {
        type: 'number',
        label: 'Forecast days',
        description: '0 for current conditions only, up to 7.',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  async refresh(ctx: WidgetRefreshContext<WeatherConfig>): Promise<string | null> {
    const api = ctx.api as { commands?: { executeCommand<T>(id: string, arg?: unknown): Promise<T> } };
    if (!api.commands?.executeCommand) {
      throw new Error('Chat tool not available. Ensure the Chat extension is enabled.');
    }
    const cfg = normalize(ctx.config);
    const prompt = buildPrompt(cfg, ctx.instanceId);

    // Default (M86 C4): isolated background agent turn; result lands via
    // dashboard_render_widget mid-turn — return null to avoid clobbering it.
    if (ctx.mode !== 'chat') {
      const res = await api.commands.executeCommand<{ ok: boolean; error?: string }>(
        'chat.runBackgroundPrompt',
        { text: prompt, origin: 'dashboard', originLabel: `[dashboard · Weather · ${cfg.location}]` },
      );
      if (!res?.ok) throw new Error(res?.error || 'Background refresh failed.');
      return null;
    }

    // Escape hatch ("Run in chat"): visible run through the active session.
    await api.commands.executeCommand('chat.submitPrompt', { text: prompt });

    const prior = stripRefreshBanner((ctx.cachedOutput ?? '').trim());
    if (prior) return `_Updating weather for ${cfg.location}…_\n\n${prior}`;
    return `_Fetching current conditions for ${cfg.location}… the report will appear here when ready._`;
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<WeatherConfig>): WidgetHandle {
    container.classList.add('dashboard-md');

    const surface = document.createElement('div');
    surface.className = 'dashboard-md__surface';
    container.appendChild(surface);

    function paint(cached: string | null): void {
      surface.innerHTML = '';
      if (!cached) {
        const empty = document.createElement('div');
        empty.className = 'dashboard-md__empty';
        empty.innerHTML = `
          <strong>No weather yet</strong>
          <p>Click the refresh icon above. The AI looks up current conditions for your configured location.</p>
        `;
        surface.appendChild(empty);
        return;
      }
      const body = document.createElement('div');
      body.className = 'dashboard-md__body';
      body.appendChild(renderMarkdownToDom(cached));
      surface.appendChild(body);
    }

    function paintError(message: string): void {
      surface.innerHTML = '';
      const err = document.createElement('div');
      err.className = 'dashboard-md__error';
      const title = document.createElement('strong');
      title.textContent = 'Couldn\u2019t fetch the weather';
      const detail = document.createElement('p');
      detail.textContent = message;
      err.appendChild(title);
      err.appendChild(detail);
      surface.appendChild(err);
    }

    if (ctx.errorMessage && !ctx.cachedOutput) {
      paintError(ctx.errorMessage);
    } else {
      paint(ctx.cachedOutput);
    }

    const sub = ctx.onDidChangeConfig(() => {
      // Config changes only affect the next refresh — keep current render.
    });

    return {
      refreshFromCache(cached: string | null) { paint(cached); },
      renderError(message: string | null) {
        if (message) paintError(message);
        else paint(ctx.cachedOutput);
      },
      dispose() { sub.dispose(); },
    };
  },
};

function normalize(raw: unknown): WeatherConfig {
  const cfg = (raw ?? {}) as Partial<WeatherConfig>;
  const days = typeof cfg.forecastDays === 'number' && Number.isFinite(cfg.forecastDays)
    ? Math.max(0, Math.min(7, Math.floor(cfg.forecastDays)))
    : DEFAULT_CONFIG.forecastDays;
  return {
    location: typeof cfg.location === 'string' && cfg.location.trim() ? cfg.location : DEFAULT_CONFIG.location,
    units: cfg.units === 'metric' ? 'metric' : 'imperial',
    forecastDays: days,
  };
}

// Remove a leading "_Updating…_" / "_Fetching…_" banner left by a prior
// in-flight refresh, so banners never stack across repeated refreshes.
function stripRefreshBanner(text: string): string {
  return text.replace(/^_(?:Updating|Fetching)[^\n]*_\s*\n+/, '').trim();
}

function buildPrompt(cfg: WeatherConfig, instanceId: string): string {
  const unitLabel = cfg.units === 'metric' ? 'Celsius and km/h' : 'Fahrenheit and mph';
  const lines = [
    `Look up the current weather for ${cfg.location} and deliver a compact report to my dashboard widget.`,
    '',
    'Steps:',
    `1. Use webSearch / webFetch to find current conditions for ${cfg.location} from a reliable weather source.`,
    `2. Report temperatures and wind in ${unitLabel}. Use only what the source actually states — never estimate or invent values.`,
  ];
  if (cfg.forecastDays > 0) {
    lines.push(`3. Include a short ${cfg.forecastDays}-day forecast.`);
  }
  lines.push(
    `${cfg.forecastDays > 0 ? '4' : '3'}. Format as Markdown: a one-line heading with the location and the current temperature + condition, then a compact bullet list (feels-like, wind, humidity, high/low)${cfg.forecastDays > 0 ? ', then a short forecast list (one line per day)' : ''}. No preamble, no emojis.`,
    `${cfg.forecastDays > 0 ? '5' : '4'}. Call the dashboard_render_widget tool with instanceId "${instanceId}" and the finished Markdown as content. This is how the report reaches the widget — do not skip it.`,
  );
  return lines.join('\n');
}
