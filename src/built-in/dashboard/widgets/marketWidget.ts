// marketWidget.ts — AI-backed market snapshot widget.
//
// Same push model as the news brief / weather widget: on refresh it asks the
// active chat session to look up the latest quotes for the configured symbols
// with its web-research tools, then deliver a compact Markdown table back via
// the shared `dashboard_render_widget` tool. No invented prices — the AI fetches real
// numbers and reports only what the sources show, with their as-of time.

import type {
  WidgetContext,
  WidgetHandle,
  WidgetRefreshContext,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';
import { renderMarkdownToDom } from './markdownRenderer.js';

interface MarketConfig {
  readonly symbols: readonly string[];
  readonly extraInstructions: string;
}

const DEFAULT_CONFIG: MarketConfig = {
  symbols: ['AAPL', 'MSFT', 'BTC-USD'],
  extraInstructions: '',
};

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/><path d="M19 7v3h-3"/></svg>';

export const MARKET_WIDGET: WidgetTypeRegistration<MarketConfig> = {
  typeId: 'parallx.dashboard.market',
  displayName: 'Market snapshot',
  description: 'AI-fetched latest prices for the stocks / crypto you track. Add a refresh schedule to keep it current.',
  icon: ICON_SVG,
  category: 'ai',
  defaultSize: { colSpan: 4, rowSpan: 3 },
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      symbols: {
        type: 'string-list',
        label: 'Symbols',
        description: 'One ticker per line — e.g. AAPL, MSFT, BTC-USD, ^GSPC.',
      },
      extraInstructions: {
        type: 'textarea',
        label: 'Extra instructions (optional)',
        description: 'Add focus, currency, or formatting preferences.',
        placeholder: 'e.g. "Show values in EUR."',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  async refresh(ctx: WidgetRefreshContext<MarketConfig>): Promise<string | null> {
    const api = ctx.api as { commands?: { executeCommand<T>(id: string, arg?: unknown): Promise<T> } };
    if (!api.commands?.executeCommand) {
      throw new Error('Chat tool not available. Ensure the Chat extension is enabled.');
    }
    const cfg = normalize(ctx.config);
    if (cfg.symbols.length === 0) {
      return '_No symbols set. Open this widget\u2019s settings and add at least one ticker._';
    }

    const prompt = buildPrompt(cfg, ctx.instanceId);

    // Default (M86 C4): isolated background agent turn; quotes land via
    // dashboard_render_widget mid-turn — return null to avoid clobbering.
    if (ctx.mode !== 'chat') {
      const res = await api.commands.executeCommand<{ ok: boolean; error?: string }>(
        'chat.runBackgroundPrompt',
        { text: prompt, origin: 'dashboard', originLabel: `[dashboard · Market · ${cfg.symbols.join(', ')}]` },
      );
      if (!res?.ok) throw new Error(res?.error || 'Background refresh failed.');
      return null;
    }

    // Escape hatch ("Run in chat"): visible run through the active session.
    await api.commands.executeCommand('chat.submitPrompt', { text: prompt });

    const prior = stripRefreshBanner((ctx.cachedOutput ?? '').trim());
    if (prior) return `_Updating quotes…_\n\n${prior}`;
    return '_Fetching the latest quotes… the table will appear here when ready._';
  },

  createWidget(container: HTMLElement, ctx: WidgetContext<MarketConfig>): WidgetHandle {
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
          <strong>No quotes yet</strong>
          <p>Click the refresh icon above. The AI looks up the latest prices for your symbols.</p>
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
      title.textContent = 'Couldn\u2019t fetch quotes';
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

function normalize(raw: unknown): MarketConfig {
  const cfg = (raw ?? {}) as Partial<MarketConfig>;
  let symbols: string[] = [];
  if (Array.isArray(cfg.symbols)) {
    symbols = cfg.symbols
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .slice(0, 20);
  }
  return {
    symbols,
    extraInstructions: typeof cfg.extraInstructions === 'string' ? cfg.extraInstructions : '',
  };
}

// Remove a leading "_Updating…_" / "_Fetching…_" banner left by a prior
// in-flight refresh, so banners never stack across repeated refreshes.
function stripRefreshBanner(text: string): string {
  return text.replace(/^_(?:Updating|Fetching)[^\n]*_\s*\n+/, '').trim();
}

function buildPrompt(cfg: MarketConfig, instanceId: string): string {
  const lines = [
    `Look up the latest available prices for these symbols and deliver a compact snapshot to my dashboard widget: ${cfg.symbols.join(', ')}.`,
    '',
    'Steps:',
    '1. Use webSearch / webFetch to find the latest quote for each symbol from a reliable financial source.',
    '2. Report only what the source actually shows — never invent or estimate a price. If a symbol can\u2019t be found, mark it as "n/a".',
    '3. Format as a Markdown bullet list, one line per symbol: `**SYMBOL** — price (change with % and a + / − sign)`. Do not use a Markdown table. Add one short italic line beneath the list noting the as-of time and source. No preamble, no emojis.',
    `4. Call the dashboard_render_widget tool with instanceId "${instanceId}" and the finished Markdown as content. This is how the snapshot reaches the widget — do not skip it.`,
  ];
  if (cfg.extraInstructions.trim()) {
    lines.push('', `Additional instructions: ${cfg.extraInstructions.trim()}`);
  }
  return lines.join('\n');
}
