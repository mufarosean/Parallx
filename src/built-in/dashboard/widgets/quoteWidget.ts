// quoteWidget.ts — one line of encouragement a day, from a list you own.
//
// The day picks the quote (day-of-year modulo the list) so it changes each
// morning without any randomness to disagree across hosts; clicking the
// card steps to the next one when today's doesn't land.
//
// Format: one quote per line; an optional attribution follows a `|`, e.g.
//   The obstacle is the way. | Marcus Aurelius

import type {
  WidgetContext,
  WidgetHandle,
  WidgetTypeRegistration,
} from '../dashboardTypes.js';

interface QuoteConfig {
  readonly quotes: string;
}

const DEFAULT_QUOTES = [
  'Little by little, a little becomes a lot.',
  'The best time to plant a tree was twenty years ago. The second best time is now.',
  'You do not rise to the level of your goals. You fall to the level of your systems. | James Clear',
  'It always seems impossible until it is done. | Nelson Mandela',
  'Six hours of studying feels long. Regret feels longer.',
  'Slow is smooth, smooth is fast.',
].join('\n');

const DEFAULT_CONFIG: QuoteConfig = { quotes: DEFAULT_QUOTES };

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M10 8c-3 0-5 2-5 5v3h5v-5H7.5C7.5 9.5 8.5 9 10 9zm9 0c-3 0-5 2-5 5v3h5v-5h-2.5c0-1.5 1-2 2.5-2z"/></svg>';

interface ParsedQuote { readonly text: string; readonly author: string }

/** Exported for tests: one line → quote + optional author after a pipe. */
export function parseQuotes(raw: string): ParsedQuote[] {
  return raw.split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const sep = line.lastIndexOf('|');
      if (sep > 0) {
        return { text: line.slice(0, sep).trim(), author: line.slice(sep + 1).trim() };
      }
      return { text: line, author: '' };
    });
}

/** Exported for tests: today's deterministic pick. */
export function quoteIndexForDay(count: number, date: Date): number {
  if (count <= 0) return 0;
  const start = new Date(date.getFullYear(), 0, 1).getTime();
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000);
  return dayOfYear % count;
}

export const QUOTE_WIDGET: WidgetTypeRegistration<QuoteConfig> = {
  typeId: 'parallx.dashboard.quote',
  displayName: 'Daily Quote',
  description: 'One line of encouragement a day, from a list you own. Click the card to step through.',
  icon: ICON_SVG,
  category: 'static',
  defaultSize: { colSpan: 4, rowSpan: 2 },
  chromeStyle: 'minimal',
  defaultConfig: DEFAULT_CONFIG,
  configSchema: {
    fields: {
      quotes: {
        type: 'textarea',
        label: 'Your quotes',
        description: 'One per line. Add an author after a | if you like.',
        placeholder: 'The obstacle is the way. | Marcus Aurelius',
      },
    },
  },
  defaultRefreshPolicy: { kind: 'manual' },

  createWidget(container: HTMLElement, ctx: WidgetContext<QuoteConfig>): WidgetHandle {
    container.classList.add('qtw');
    let quotes = parseQuotes(typeof ctx.config?.quotes === 'string' ? ctx.config.quotes : DEFAULT_QUOTES);
    let offset = 0;

    const mark = document.createElement('div');
    mark.className = 'qtw__mark';
    mark.innerHTML = ICON_SVG;
    const text = document.createElement('div');
    text.className = 'qtw__text';
    const author = document.createElement('div');
    author.className = 'qtw__author';
    container.appendChild(mark);
    container.appendChild(text);
    container.appendChild(author);

    function render(): void {
      if (quotes.length === 0) {
        text.textContent = 'Add a few quotes in settings';
        author.textContent = '';
        return;
      }
      const q = quotes[(quoteIndexForDay(quotes.length, new Date()) + offset) % quotes.length];
      text.textContent = q.text;
      author.textContent = q.author;
    }

    container.addEventListener('click', () => { offset += 1; render(); });

    render();
    // Re-render around midnight without tracking it precisely.
    const interval = setInterval(render, 10 * 60_000);
    const sub = ctx.onDidChangeConfig((next) => {
      quotes = parseQuotes(typeof next?.quotes === 'string' ? next.quotes : '');
      offset = 0;
      render();
    });

    return {
      dispose() {
        clearInterval(interval);
        sub.dispose();
      },
    };
  },
};
