// newsBriefWidget.ts — AI-backed daily news brief widget.
//
// On refresh, calls the chat tool's background AI provider with a
// user-configurable prompt template. The response markdown is written
// to cache; the renderer paints from cache. Manual refresh in M71;
// users can opt in to a cron policy via the settings drawer (default
// is 24h interval to avoid hammering the model).

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { renderMarkdownToDom } from './markdownRenderer.js';

interface NewsBriefConfig {
  readonly location: string;
  readonly topN: number;
  readonly extraInstructions: string;
}

const DEFAULT_CONFIG: NewsBriefConfig = {
  location: 'San Antonio, Texas',
  topN: 10,
  extraInstructions: '',
};

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8"/><path d="M15 18h-5"/><path d="M10 6h8v4h-8V6z"/></svg>';

// ─── Widget ──────────────────────────────────────────────────────────────────

export const NEWS_BRIEF_WIDGET: WidgetTypeRegistration<NewsBriefConfig> = {
  typeId: 'parallx.dashboard.news-brief',
  displayName: 'News brief',
  description: 'A short AI-written summary of today\'s top news for your area. Manual refresh by default.',
  icon: ICON_SVG,
  category: 'ai',
  defaultSize: { colSpan: 8, rowSpan: 4 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      location: {
        type: 'string',
        label: 'Location',
        description: 'City or region the brief should focus on.',
        placeholder: 'San Antonio, Texas',
      },
      topN: {
        type: 'number',
        label: 'Stories to summarize',
        description: 'Anywhere from 3 to 20.',
      },
      extraInstructions: {
        type: 'textarea',
        label: 'Extra instructions (optional)',
        description: 'Add focus areas, tone, or formatting preferences.',
        placeholder: 'e.g. "Keep it neutral, two sentences per story."',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  async refresh(ctx: WidgetRefreshContext<NewsBriefConfig>): Promise<string> {
    const api = ctx.api as { commands?: { executeCommand<T>(id: string, arg?: unknown): Promise<T> } };
    if (!api.commands?.executeCommand) {
      throw new Error('Chat tool not available. Ensure the Chat extension is enabled.');
    }
    const cfg = normalize(ctx.config);

    // Push model: we don't compute the brief here. We ask the active chat
    // session to do the research with its normal tools, then deliver the
    // result back to this widget via the shared `dashboard_render_widget` tool. The
    // brief arrives asynchronously and repaints the widget when it lands.
    const prompt = buildPrompt(cfg, ctx.instanceId);
    await api.commands.executeCommand('chat.submitPrompt', { text: prompt });

    // Keep the last good brief visible while the new one is researched. We
    // prepend a subtle "Refreshing…" banner above the existing brief and
    // return that — dashboard_render_widget overwrites the whole thing once the fresh
    // brief lands, so a slow or failed turn never wipes yesterday's content
    // (worst case: the banner lingers above the still-readable old brief).
    // Only the very first run (no prior content) shows a bare placeholder.
    const prior = stripRefreshBanner((ctx.cachedOutput ?? '').trim());
    if (prior) return `_Refreshing the news brief for ${cfg.location}…_\n\n${prior}`;
    return `_Researching the latest news for ${cfg.location}… the brief will appear here when ready._`;
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<NewsBriefConfig>): WidgetHandle {
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
          <strong>No brief yet</strong>
          <p>Click the refresh icon above to generate one. The default focus is your configured location.</p>
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
      title.textContent = 'Couldn\u2019t generate the brief';
      const detail = document.createElement('p');
      detail.textContent = message;
      err.appendChild(title);
      err.appendChild(detail);
      surface.appendChild(err);
    }

    // Surface a previously-persisted error on mount so a failed widget doesn't
    // just look empty after a relaunch.
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

function normalize(raw: unknown): NewsBriefConfig {
  const cfg = (raw ?? {}) as Partial<NewsBriefConfig>;
  const topN = typeof cfg.topN === 'number' && Number.isFinite(cfg.topN)
    ? Math.max(3, Math.min(20, Math.floor(cfg.topN)))
    : DEFAULT_CONFIG.topN;
  return {
    location: typeof cfg.location === 'string' && cfg.location.trim() ? cfg.location : DEFAULT_CONFIG.location,
    topN,
    extraInstructions: typeof cfg.extraInstructions === 'string' ? cfg.extraInstructions : '',
  };
}

// Remove a leading "_Refreshing…_" / "_Researching…_" banner left by a prior
// in-flight refresh, so banners never stack across repeated refreshes.
function stripRefreshBanner(text: string): string {
  return text.replace(/^_(?:Refreshing|Researching)[^\n]*_\s*\n+/, '').trim();
}

function buildPrompt(cfg: NewsBriefConfig, instanceId: string): string {
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const lines = [
    `Research today's (${today}) top ${cfg.topN} news stories relevant to ${cfg.location}, then deliver the brief to my dashboard widget.`,
    '',
    'Steps:',
    `1. Use webSearch to find current stories for ${cfg.location}.`,
    '2. webFetch 2-3 of the most relevant results to confirm the details. Use only what the sources actually say — never invent stories, numbers, or sources.',
    `3. Write a Markdown brief: a short top heading, then a numbered list of up to ${cfg.topN} items. Each item is one concise sentence followed by a Markdown link to its source. No emojis, no preamble.`,
    `4. Call the dashboard_render_widget tool with instanceId "${instanceId}" and the finished Markdown as content. This is how the brief reaches the widget — do not skip it.`,
  ];
  if (cfg.extraInstructions.trim()) {
    lines.push('', `Additional instructions: ${cfg.extraInstructions.trim()}`);
  }
  return lines.join('\n');
}
