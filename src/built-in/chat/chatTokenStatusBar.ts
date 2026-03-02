// chatTokenStatusBar.ts — Status bar token usage indicator with detail popup
//
// Shows a compact token usage summary in the status bar:
//   [▓▓▓▓▓▓░░░░] 59.6K / 128K tokens · 47%
//
// Clicking opens a detail panel anchored above the status bar item showing
// a breakdown of context window consumption by category.
//
// Token data sources (in priority order):
//   1. Real token counts from Ollama (prompt_eval_count + eval_count on
//      the final streaming chunk) — stored on IChatAssistantResponse as
//      promptTokens / completionTokens.
//   2. Fallback: chars / 4 estimation (M9 spec) when real counts aren't
//      available yet (e.g. before the first response).
//
// Context window size comes from OllamaProvider.getActiveModelContextLengthAsync()
// which calls Ollama's /api/show endpoint to read the model's native context_length.

import { Disposable, toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import { layoutPopup } from '../../ui/dom.js';
import { $ } from '../../ui/dom.js';
import { chatIcons } from './chatIcons.js';
import { buildSystemPrompt, type ISystemPromptContext } from './chatSystemPrompts.js';
import { ChatMode, type IChatSession, type IToolDefinition } from '../../services/chatTypes.js';
import './chatTokenStatusBar.css';

// ── Types ──

/** Services needed for token breakdown calculations. */
export interface ITokenStatusBarServices {
  /** Get the active session from the widget. */
  getActiveSession(): IChatSession | undefined;
  /** Get context window size in tokens (async — fetches from Ollama if not cached). */
  getContextLength(): Promise<number>;
  /** Get the current chat mode. */
  getMode(): ChatMode;
  /** Get workspace name. */
  getWorkspaceName(): string;
  /** Get page count. */
  getPageCount(): Promise<number>;
  /** Get current page title. */
  getCurrentPageTitle(): string | undefined;
  /** Get tool definitions (agent mode). */
  getToolDefinitions(): readonly IToolDefinition[];
  /** Get file count for system prompt. */
  getFileCount(): Promise<number>;
  /** Whether RAG is available. */
  isRAGAvailable(): boolean;
  /** Whether indexing is in progress. */
  isIndexing(): boolean;

  // ── Indexing progress (M10 Phase 6 — Task 6.1) ──

  /** Current indexing progress snapshot. */
  getIndexingProgress?(): import('../../services/indexingPipeline.js').IndexingProgress;
  /** Stats from the last completed initial index. */
  getIndexStats?(): { pages: number; files: number } | undefined;
}

/** Breakdown of token usage by category. */
interface ITokenBreakdown {
  /** Total tokens used (real from Ollama when available, else estimated). */
  total: number;
  /** Context window size in tokens. */
  contextLength: number;
  /** Percentage of context used (0–100). */
  percentage: number;
  /** Whether token counts are real (from Ollama) or estimated (chars/4). */
  isReal: boolean;
  /** Per-category breakdown. */
  categories: {
    systemInstructions: number;
    toolDefinitions: number;
    messages: number;
    toolResults: number;
    files: number;
  };
}

// ── Constants ──

const BAR_WIDTH = 52;
const BAR_HEIGHT = 10;

// ── ChatTokenStatusBar ──

/**
 * Status bar item showing token usage with a visual progress bar.
 * Click to open a detail popup with per-category breakdown.
 */
export class ChatTokenStatusBar extends Disposable {

  private readonly _services: ITokenStatusBarServices;
  private _statusBarItemContainer: HTMLElement | undefined;
  private _popupElement: HTMLElement | undefined;
  private _dismissListener: IDisposable | undefined;
  private _lastBreakdown: ITokenBreakdown | undefined;

  // ── Status bar DOM elements (rendered directly into the status bar) ──
  private readonly _root: HTMLElement;
  private readonly _barSvg: HTMLElement;
  private readonly _label: HTMLElement;
  private readonly _indexingIndicator: HTMLElement;

  constructor(
    services: ITokenStatusBarServices,
  ) {
    super();
    this._services = services;

    // Build a container for the status bar content
    this._root = $('div.parallx-token-statusbar');

    this._barSvg = $('span.parallx-token-statusbar-bar');
    this._barSvg.innerHTML = this._buildBarSvg(0);
    this._root.appendChild(this._barSvg);

    this._label = $('span.parallx-token-statusbar-label');
    this._label.textContent = '— tokens';
    this._root.appendChild(this._label);

    // Indexing status indicator (M10 Phase 6 — Task 6.1)
    this._indexingIndicator = $('span.parallx-token-statusbar-indexing');
    this._indexingIndicator.style.display = 'none'; // Hidden until indexing starts
    this._root.appendChild(this._indexingIndicator);

    // Click handler opens detail popup
    this._root.addEventListener('click', (e) => {
      e.stopPropagation();
      this._togglePopup();
    });
  }

  // ── Public API ──

  /** Get the DOM element to insert into a status bar item's label. */
  get element(): HTMLElement { return this._root; }

  /** Refresh the status bar display and cache the breakdown. */
  async update(): Promise<void> {
    const breakdown = await this._computeBreakdown();
    this._lastBreakdown = breakdown;

    // Update SVG bar
    this._barSvg.innerHTML = this._buildBarSvg(breakdown.percentage);

    // Update label text: "59.6K / 128K tokens · 47%"
    const usedStr = this._formatTokens(breakdown.total);
    const approx = breakdown.isReal ? '' : '~';
    if (breakdown.contextLength > 0) {
      const ctxStr = this._formatTokens(breakdown.contextLength);
      this._label.textContent = `${approx}${usedStr} / ${ctxStr} tokens · ${Math.round(breakdown.percentage)}%`;
    } else {
      this._label.textContent = `${approx}${usedStr} tokens`;
    }

    // Update indexing indicator (M10 Phase 6 — Task 6.1)
    this._updateIndexingIndicator();

    // Tooltip
    const source = breakdown.isReal ? 'Ollama-reported' : 'Estimated';
    this._root.title = breakdown.contextLength > 0
      ? `${source} token usage: ${approx}${breakdown.total.toLocaleString()} / ${breakdown.contextLength.toLocaleString()} (${breakdown.percentage.toFixed(1)}%) — click for details`
      : `${source} tokens: ${approx}${breakdown.total.toLocaleString()} — click for details`;

    // If popup is open, refresh it
    if (this._popupElement) {
      this._renderPopupContent(this._popupElement, breakdown);
    }
  }

  // ── Indexing Indicator (M10 Phase 6 — Task 6.1) ──

  private _updateIndexingIndicator(): void {
    const progress = this._services.getIndexingProgress?.();
    const stats = this._services.getIndexStats?.();

    if (!progress || progress.phase === 'idle') {
      // Idle — show completed stats if available, else hide
      if (stats) {
        this._indexingIndicator.innerHTML = `<span class="parallx-token-statusbar-indexing-icon">${chatIcons.check}</span> ${stats.pages} pages, ${stats.files} files indexed`;
        this._indexingIndicator.style.display = '';
        this._indexingIndicator.className = 'parallx-token-statusbar-indexing parallx-token-statusbar-indexing-complete';
      } else {
        this._indexingIndicator.style.display = 'none';
        this._indexingIndicator.innerHTML = '';
      }
      return;
    }

    // Active indexing — show progress
    this._indexingIndicator.style.display = '';
    this._indexingIndicator.className = 'parallx-token-statusbar-indexing parallx-token-statusbar-indexing-active';

    switch (progress.phase) {
      case 'pages':
        this._indexingIndicator.innerHTML = `<span class="parallx-token-statusbar-indexing-icon">${chatIcons.search}</span> Indexing: ${progress.processed}/${progress.total} pages`;
        break;
      case 'files':
        this._indexingIndicator.innerHTML = `<span class="parallx-token-statusbar-indexing-icon">${chatIcons.search}</span> Indexing: ${progress.processed}/${progress.total} files`;
        break;
      case 'incremental':
        this._indexingIndicator.innerHTML = progress.total > 0
          ? `<span class="parallx-token-statusbar-indexing-icon">${chatIcons.refresh}</span> Re-indexing ${progress.total} changed ${progress.total === 1 ? 'item' : 'items'}...`
          : `<span class="parallx-token-statusbar-indexing-icon">${chatIcons.refresh}</span> Re-indexing...`;
        break;
    }
  }

  /** Store reference to the status bar item container (for popup anchoring). */
  setStatusBarItemContainer(el: HTMLElement): void {
    this._statusBarItemContainer = el;
  }

  override dispose(): void {
    this._dismissPopup();
    this._root.remove();
    super.dispose();
  }

  // ── Token Breakdown Calculation ──

  private async _computeBreakdown(): Promise<ITokenBreakdown> {
    const session = this._services.getActiveSession();
    const contextLength = await this._services.getContextLength();
    const mode = this._services.getMode();

    // ── Check for real Ollama-reported token counts ──
    // The last response in the session has promptTokens (= total input tokens
    // for that request, including system prompt + all messages). This is the
    // most accurate number because it comes from the model's tokenizer.
    let realPromptTokens = 0;
    let realCompletionTokens = 0;
    let hasRealCounts = false;

    if (session && session.messages.length > 0) {
      // Walk all responses to accumulate completion tokens
      for (const pair of session.messages) {
        if (pair.response.completionTokens) {
          realCompletionTokens += pair.response.completionTokens;
        }
      }
      // Use the LAST response's promptTokens as the current input size
      // (it includes the full conversation history as sent via Ollama)
      const lastPair = session.messages[session.messages.length - 1];
      if (lastPair.response.promptTokens && lastPair.response.promptTokens > 0) {
        realPromptTokens = lastPair.response.promptTokens;
        hasRealCounts = true;
      }
    }

    // ── System prompt category breakdown (chars/4 estimation) ──
    // Even when we have real counts, we still compute the category ratios
    // from the system prompt structure so the popup can show the breakdown.
    let systemInstructionsEst = 0;
    let toolDefinitionsEst = 0;
    let filesEst = 0;
    let messagesEst = 0;
    let toolResultsEst = 0;

    try {
      const pageCount = await this._services.getPageCount();
      const fileCount = await this._services.getFileCount();
      const toolDefs = this._services.getToolDefinitions();
      const isRAGAvailable = this._services.isRAGAvailable();
      const isIndexing = this._services.isIndexing();

      // Full system prompt (with tools for Agent mode)
      const fullCtx: ISystemPromptContext = {
        workspaceName: this._services.getWorkspaceName(),
        pageCount,
        currentPageTitle: this._services.getCurrentPageTitle(),
        tools: mode === ChatMode.Agent ? toolDefs : undefined,
        fileCount,
        isRAGAvailable,
        isIndexing,
      };
      const fullSystemPrompt = buildSystemPrompt(mode, fullCtx);

      // Without tools (base instructions only)
      const baseCtx: ISystemPromptContext = {
        workspaceName: this._services.getWorkspaceName(),
        pageCount,
        currentPageTitle: this._services.getCurrentPageTitle(),
        fileCount,
        isRAGAvailable,
        isIndexing,
      };
      const basePrompt = buildSystemPrompt(mode, baseCtx);

      systemInstructionsEst = Math.ceil(basePrompt.length / 4);
      toolDefinitionsEst = Math.ceil((fullSystemPrompt.length - basePrompt.length) / 4);
      filesEst = 0; // No longer listing files in system prompt (RAG handles this)

      // Tool definitions JSON body (agent mode)
      if (mode === ChatMode.Agent && toolDefs.length > 0) {
        const toolJsonChars = JSON.stringify(
          toolDefs.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        ).length;
        toolDefinitionsEst += Math.ceil(toolJsonChars / 4);
      }
    } catch {
      // Best-effort
    }

    // ── Message / tool result estimation (chars/4 fallback) ──
    if (session) {
      for (const pair of session.messages) {
        messagesEst += Math.ceil(pair.request.text.length / 4);
        for (const part of pair.response.parts) {
          const p = part as unknown as Record<string, unknown>;
          if (p['kind'] === 'toolInvocation') {
            if (typeof p['result'] === 'object' && p['result'] && 'content' in (p['result'] as Record<string, unknown>)) {
              toolResultsEst += Math.ceil(String((p['result'] as Record<string, unknown>)['content']).length / 4);
            }
          } else {
            if (typeof p['content'] === 'string') messagesEst += Math.ceil(p['content'].length / 4);
            if (typeof p['code'] === 'string') messagesEst += Math.ceil((p['code'] as string).length / 4);
          }
        }
      }
    }

    // ── Choose real vs estimated totals ──
    let total: number;
    let isReal: boolean;

    if (hasRealCounts) {
      // Real total = last prompt tokens (all input for the last turn) + cumulative completions
      total = realPromptTokens + realCompletionTokens;
      isReal = true;
    } else {
      // Fall back to chars/4 estimation
      total = systemInstructionsEst + toolDefinitionsEst + filesEst + messagesEst + toolResultsEst;
      isReal = false;
    }

    const percentage = contextLength > 0
      ? Math.min((total / contextLength) * 100, 100)
      : 0;

    // When we have real counts, scale the category estimates proportionally
    // so the popup percentages are meaningful relative to the real total.
    let cats: ITokenBreakdown['categories'];
    if (hasRealCounts) {
      const estTotal = systemInstructionsEst + toolDefinitionsEst + filesEst + messagesEst + toolResultsEst;
      if (estTotal > 0) {
        const scale = total / estTotal;
        cats = {
          systemInstructions: Math.round(systemInstructionsEst * scale),
          toolDefinitions: Math.round(toolDefinitionsEst * scale),
          messages: Math.round(messagesEst * scale),
          toolResults: Math.round(toolResultsEst * scale),
          files: Math.round(filesEst * scale),
        };
      } else {
        // No estimation data — put everything under "messages"
        cats = {
          systemInstructions: 0,
          toolDefinitions: 0,
          messages: total,
          toolResults: 0,
          files: 0,
        };
      }
    } else {
      cats = {
        systemInstructions: systemInstructionsEst,
        toolDefinitions: toolDefinitionsEst,
        messages: messagesEst,
        toolResults: toolResultsEst,
        files: filesEst,
      };
    }

    return { total, contextLength, percentage, isReal, categories: cats };
  }

  // ── SVG Bar Builder ──

  private _buildBarSvg(pct: number): string {
    const w = BAR_WIDTH;
    const h = BAR_HEIGHT;
    const innerW = w - 2;
    const fillW = Math.max(0, Math.min(innerW, (innerW * pct) / 100));

    let fillColor = '#4ec9b0'; // teal/green
    if (pct >= 90) fillColor = '#f14c4c'; // red
    else if (pct >= 70) fillColor = '#cca700'; // amber

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;">`,
      `<rect x="0" y="0" width="${w}" height="${h}" rx="2" ry="2" fill="#3c3c3c" stroke="#555" stroke-width="0.5"/>`,
      fillW > 0 ? `<rect x="1" y="1" width="${fillW}" height="${h - 2}" rx="1" ry="1" fill="${fillColor}"/>` : '',
      `</svg>`,
    ].join('');
  }

  // ── Popup ──

  private _togglePopup(): void {
    if (this._popupElement) {
      this._dismissPopup();
    } else {
      this._showPopup();
    }
  }

  private _showPopup(): void {
    if (this._popupElement) return;

    const breakdown = this._lastBreakdown ?? {
      total: 0, contextLength: 0, percentage: 0, isReal: false,
      categories: { systemInstructions: 0, toolDefinitions: 0, messages: 0, toolResults: 0, files: 0 },
    };

    // Create popup element
    const popup = document.createElement('div');
    popup.className = 'parallx-token-popup';
    this._renderPopupContent(popup, breakdown);

    document.body.appendChild(popup);
    this._popupElement = popup;

    // Position above the status bar item
    const anchor = this._statusBarItemContainer?.getBoundingClientRect()
      ?? this._root.getBoundingClientRect();
    layoutPopup(popup, anchor, { position: 'above', gap: 4, margin: 8 });

    // Close on click outside (next tick to avoid the current click)
    requestAnimationFrame(() => {
      const handler = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node) && !this._root.contains(e.target as Node)) {
          this._dismissPopup();
        }
      };
      document.addEventListener('mousedown', handler, true);
      this._dismissListener = toDisposable(() => document.removeEventListener('mousedown', handler, true));
    });

    // Close on Escape
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { this._dismissPopup(); }
    };
    document.addEventListener('keydown', escHandler, true);
    const escDisposable = toDisposable(() => document.removeEventListener('keydown', escHandler, true));
    this._register(escDisposable);
  }

  private _dismissPopup(): void {
    if (this._popupElement) {
      this._popupElement.remove();
      this._popupElement = undefined;
    }
    if (this._dismissListener) {
      this._dismissListener.dispose();
      this._dismissListener = undefined;
    }
  }

  private _renderPopupContent(popup: HTMLElement, breakdown: ITokenBreakdown): void {
    popup.innerHTML = '';

    const ctx = breakdown.contextLength;
    const pct = breakdown.percentage;

    // ── Header: "Context Window" ──
    const header = $('div.parallx-token-popup-header');
    header.textContent = 'Context Window';
    popup.appendChild(header);

    // ── Summary line ──
    const summaryRow = $('div.parallx-token-popup-summary');
    const summaryText = $('span.parallx-token-popup-summary-text');
    const approx = breakdown.isReal ? '' : '~';
    const usedStr = this._formatTokens(breakdown.total);
    const ctxStr = ctx > 0 ? this._formatTokens(ctx) : '—';
    summaryText.textContent = `${approx}${usedStr} / ${ctxStr} tokens · ${Math.round(pct)}%`;
    summaryRow.appendChild(summaryText);
    popup.appendChild(summaryRow);

    // Full-width bar
    const barContainer = $('div.parallx-token-popup-bar');
    barContainer.innerHTML = this._buildPopupBarSvg(pct);
    popup.appendChild(barContainer);

    // Source indicator
    if (!breakdown.isReal && breakdown.total > 0) {
      const note = $('div.parallx-token-popup-note');
      note.textContent = 'Estimated (chars ÷ 4). Real counts appear after first response.';
      note.style.cssText = 'font-size:10px;color:#888;padding:2px 0 4px;';
      popup.appendChild(note);
    }

    // ── Category sections ──
    const cats = breakdown.categories;
    const total = breakdown.total || 1;

    this._renderSection(popup, 'System', [
      { label: 'System Instructions', tokens: cats.systemInstructions, total },
      { label: 'Tool Definitions', tokens: cats.toolDefinitions, total },
    ]);

    this._renderSection(popup, 'User Context', [
      { label: 'Messages', tokens: cats.messages, total },
      { label: 'Tool Results', tokens: cats.toolResults, total },
      { label: 'Files', tokens: cats.files, total },
    ]);

    // ── Knowledge Index section (M10 Phase 6 — Task 6.1) ──
    this._renderIndexSection(popup);
  }

  /** Render the Knowledge Index section in the popup. */
  private _renderIndexSection(container: HTMLElement): void {
    const progress = this._services.getIndexingProgress?.();
    const stats = this._services.getIndexStats?.();
    const isIndexing = this._services.isIndexing();
    const ragAvailable = this._services.isRAGAvailable();

    // Only show if RAG is available or has stats
    if (!ragAvailable && !stats) return;

    const section = $('div.parallx-token-popup-section');
    const sectionTitle = $('div.parallx-token-popup-section-title');
    sectionTitle.textContent = 'Knowledge Index';
    section.appendChild(sectionTitle);

    // Status row
    const statusRow = $('div.parallx-token-popup-row');
    const statusLabel = $('span.parallx-token-popup-row-label');
    statusLabel.textContent = 'Status';
    statusRow.appendChild(statusLabel);

    const statusValue = $('span.parallx-token-popup-row-value');
    if (isIndexing && progress && progress.phase !== 'idle') {
      switch (progress.phase) {
        case 'pages':
          statusValue.textContent = `Indexing pages (${progress.processed}/${progress.total})`;
          break;
        case 'files':
          statusValue.textContent = `Indexing files (${progress.processed}/${progress.total})`;
          break;
        case 'incremental':
          statusValue.textContent = 'Re-indexing changed items';
          break;
      }
      statusValue.style.color = '#cca700'; // amber for in-progress
    } else if (stats) {
      statusValue.textContent = 'Ready';
      statusValue.style.color = '#4ec9b0'; // teal for ready
    } else {
      statusValue.textContent = 'Not started';
      statusValue.style.color = '#888';
    }
    statusRow.appendChild(statusValue);
    section.appendChild(statusRow);

    // Stats rows (if we have them)
    if (stats) {
      const pagesRow = $('div.parallx-token-popup-row');
      const pagesLabel = $('span.parallx-token-popup-row-label');
      pagesLabel.textContent = 'Pages Indexed';
      pagesRow.appendChild(pagesLabel);
      const pagesValue = $('span.parallx-token-popup-row-value');
      pagesValue.textContent = `${stats.pages}`;
      pagesRow.appendChild(pagesValue);
      section.appendChild(pagesRow);

      const filesRow = $('div.parallx-token-popup-row');
      const filesLabel = $('span.parallx-token-popup-row-label');
      filesLabel.textContent = 'Files Indexed';
      filesRow.appendChild(filesLabel);
      const filesValue = $('span.parallx-token-popup-row-value');
      filesValue.textContent = `${stats.files}`;
      filesRow.appendChild(filesValue);
      section.appendChild(filesRow);
    }

    // Progress bar for active indexing
    if (isIndexing && progress && progress.phase !== 'idle' && progress.total > 0) {
      const barRow = $('div.parallx-token-popup-index-bar');
      const pct = Math.min((progress.processed / progress.total) * 100, 100);
      barRow.innerHTML = this._buildPopupBarSvg(pct);
      section.appendChild(barRow);
    }

    container.appendChild(section);
  }

  private _renderSection(
    container: HTMLElement,
    title: string,
    items: { label: string; tokens: number; total: number }[],
  ): void {
    const section = $('div.parallx-token-popup-section');

    const sectionTitle = $('div.parallx-token-popup-section-title');
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);

    for (const item of items) {
      const row = $('div.parallx-token-popup-row');

      const rowLabel = $('span.parallx-token-popup-row-label');
      rowLabel.textContent = item.label;
      row.appendChild(rowLabel);

      const rowValue = $('span.parallx-token-popup-row-value');
      const itemPct = item.total > 0 ? (item.tokens / item.total) * 100 : 0;
      rowValue.textContent = `${this._formatTokens(item.tokens)} (${itemPct.toFixed(1)}%)`;
      row.appendChild(rowValue);

      section.appendChild(row);
    }

    container.appendChild(section);
  }

  /** Build a wider SVG bar for the popup (full width). */
  private _buildPopupBarSvg(pct: number): string {
    const w = 200;
    const h = 6;
    const innerW = w - 2;
    const fillW = Math.max(0, Math.min(innerW, (innerW * pct) / 100));

    let fillColor = '#4ec9b0';
    if (pct >= 90) fillColor = '#f14c4c';
    else if (pct >= 70) fillColor = '#cca700';

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`,
      `<rect x="0" y="0" width="${w}" height="${h}" rx="3" ry="3" fill="#3c3c3c"/>`,
      fillW > 0 ? `<rect x="1" y="1" width="${fillW}" height="${h - 2}" rx="2" ry="2" fill="${fillColor}"/>` : '',
      `</svg>`,
    ].join('');
  }

  // ── Formatting ──

  private _formatTokens(n: number): string {
    if (n >= 1000) {
      return `${(n / 1000).toFixed(1)}K`;
    }
    return `${n}`;
  }
}
