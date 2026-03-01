// chatTokenStatusBar.ts — Status bar token usage indicator with detail popup
//
// Shows a compact token usage summary in the status bar:
//   [▓▓▓▓▓▓░░░░] 59.6K / 128K tokens · 47%
//
// Clicking opens a detail panel anchored above the status bar item showing
// a breakdown of context window consumption by category:
//   - System Instructions (system prompt base text)
//   - Tool Definitions (agent-mode tool schemas)
//   - Messages (user + assistant conversation text)
//   - Tool Results (tool invocation results in responses)
//   - Files (page/file listings in system prompt)

import { Disposable, toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import { layoutPopup } from '../../ui/dom.js';
import { $ } from '../../ui/dom.js';
import { buildSystemPrompt, type ISystemPromptContext } from './chatSystemPrompts.js';
import { ChatMode, type IChatSession, type IToolDefinition } from '../../services/chatTypes.js';
import './chatTokenStatusBar.css';

// ── Types ──

/** Services needed for token breakdown calculations. */
export interface ITokenStatusBarServices {
  /** Get the active session from the widget. */
  getActiveSession(): IChatSession | undefined;
  /** Get context window size in tokens. */
  getContextLength(): number;
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
  /** Get page names for system prompt. */
  listPageNames(): Promise<readonly string[]>;
  /** Get file names for system prompt. */
  listFileNames(): Promise<readonly string[]>;
}

/** Breakdown of token usage by category. */
interface ITokenBreakdown {
  /** Total estimated tokens. */
  total: number;
  /** Context window size in tokens. */
  contextLength: number;
  /** Percentage of context used (0–100). */
  percentage: number;
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

  constructor(
    services: ITokenStatusBarServices,
  ) {
    super();
    this._services = services;

    // Build a container for the status bar content
    this._root = $('div.parallx-token-statusbar');
    this._root.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;padding:0 4px;height:100%;';

    this._barSvg = $('span.parallx-token-statusbar-bar');
    this._barSvg.innerHTML = this._buildBarSvg(0);
    this._root.appendChild(this._barSvg);

    this._label = $('span.parallx-token-statusbar-label');
    this._label.style.cssText = 'font-size:12px;white-space:nowrap;';
    this._label.textContent = '0 tokens';
    this._root.appendChild(this._label);

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
    if (breakdown.contextLength > 0) {
      const ctxStr = this._formatTokens(breakdown.contextLength);
      this._label.textContent = `${usedStr} / ${ctxStr} tokens · ${Math.round(breakdown.percentage)}%`;
    } else {
      this._label.textContent = `${usedStr} tokens`;
    }

    // Tooltip
    this._root.title = breakdown.contextLength > 0
      ? `Token usage: ~${breakdown.total.toLocaleString()} / ${breakdown.contextLength.toLocaleString()} (${breakdown.percentage.toFixed(1)}%) — click for details`
      : `Estimated tokens: ~${breakdown.total.toLocaleString()} — click for details`;

    // If popup is open, refresh it
    if (this._popupElement) {
      this._renderPopupContent(this._popupElement, breakdown);
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
    const contextLength = this._services.getContextLength();
    const mode = this._services.getMode();

    // ── 1. System prompt (base instructions, not including file listings) ──
    let systemInstructionsChars = 0;
    let filesChars = 0;
    let toolDefinitionsChars = 0;

    try {
      const pageCount = await this._services.getPageCount();
      const pageNames = await this._services.listPageNames();
      const fileNames = await this._services.listFileNames();

      // Build the full system prompt to get exact char count
      const toolDefs = this._services.getToolDefinitions();
      const promptCtx: ISystemPromptContext = {
        workspaceName: this._services.getWorkspaceName(),
        pageCount,
        currentPageTitle: this._services.getCurrentPageTitle(),
        tools: mode === ChatMode.Agent ? toolDefs : undefined,
        pageNames: pageNames.length ? pageNames : undefined,
        fileNames: fileNames.length ? fileNames : undefined,
      };
      const fullSystemPrompt = buildSystemPrompt(mode, promptCtx);

      // Build a version WITHOUT file listings to separate the categories
      const noFilesCtx: ISystemPromptContext = {
        workspaceName: this._services.getWorkspaceName(),
        pageCount,
        currentPageTitle: this._services.getCurrentPageTitle(),
        tools: mode === ChatMode.Agent ? toolDefs : undefined,
        // Omit pageNames and fileNames
      };
      const noFilesPrompt = buildSystemPrompt(mode, noFilesCtx);

      // Build a version WITHOUT tools AND without files (just base instructions)
      const baseCtx: ISystemPromptContext = {
        workspaceName: this._services.getWorkspaceName(),
        pageCount,
        currentPageTitle: this._services.getCurrentPageTitle(),
        // Omit tools, pageNames, fileNames
      };
      const basePrompt = buildSystemPrompt(mode, baseCtx);

      systemInstructionsChars = basePrompt.length;
      toolDefinitionsChars = noFilesPrompt.length - basePrompt.length;
      filesChars = fullSystemPrompt.length - noFilesPrompt.length;

      // Also count tool definitions sent as JSON in the request body (agent mode)
      if (mode === ChatMode.Agent && toolDefs.length > 0) {
        const toolJsonChars = JSON.stringify(
          toolDefs.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
        ).length;
        toolDefinitionsChars += toolJsonChars;
      }
    } catch {
      // Best-effort — don't block on async failures
    }

    // ── 2. Messages (user + assistant) ──
    let messagesChars = 0;
    let toolResultsChars = 0;

    if (session) {
      for (const pair of session.messages) {
        // User message text
        messagesChars += pair.request.text.length;

        // Response parts
        for (const part of pair.response.parts) {
          if ('kind' in part) {
            const kind = (part as any).kind;
            if (kind === 'toolInvocation') {
              // Tool invocation: count the result content
              const inv = part as any;
              if (inv.result?.content) {
                toolResultsChars += String(inv.result.content).length;
              }
              // Also count args serialized
              if (inv.args) {
                toolResultsChars += JSON.stringify(inv.args).length;
              }
            } else if (kind === 'thinking') {
              // Thinking content is part of the response but sent back
              messagesChars += ((part as any).content?.length ?? 0);
            } else {
              // Markdown, CodeBlock, etc. — assistant message text
              if ('content' in part && typeof (part as any).content === 'string') {
                messagesChars += (part as any).content.length;
              }
              if ('code' in part && typeof (part as any).code === 'string') {
                messagesChars += (part as any).code.length;
              }
            }
          } else {
            // Legacy parts without kind
            if ('value' in part && typeof (part as any).value === 'string') {
              messagesChars += (part as any).value.length;
            }
            if ('code' in part && typeof (part as any).code === 'string') {
              messagesChars += (part as any).code.length;
            }
          }
        }
      }
    }

    // Convert chars → estimated tokens (chars / 4)
    const systemInstructions = Math.ceil(systemInstructionsChars / 4);
    const toolDefinitions = Math.ceil(toolDefinitionsChars / 4);
    const messages = Math.ceil(messagesChars / 4);
    const toolResults = Math.ceil(toolResultsChars / 4);
    const files = Math.ceil(filesChars / 4);

    const total = systemInstructions + toolDefinitions + messages + toolResults + files;
    const percentage = contextLength > 0
      ? Math.min((total / contextLength) * 100, 100)
      : 0;

    return {
      total,
      contextLength,
      percentage,
      categories: { systemInstructions, toolDefinitions, messages, toolResults, files },
    };
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
      total: 0, contextLength: 0, percentage: 0,
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

    // ── Summary line with bar ──
    const summaryRow = $('div.parallx-token-popup-summary');

    const summaryText = $('span.parallx-token-popup-summary-text');
    const usedStr = this._formatTokens(breakdown.total);
    const ctxStr = ctx > 0 ? this._formatTokens(ctx) : '?';
    summaryText.textContent = `${usedStr} / ${ctxStr} tokens · ${Math.round(pct)}%`;
    summaryRow.appendChild(summaryText);
    popup.appendChild(summaryRow);

    // Full-width bar
    const barContainer = $('div.parallx-token-popup-bar');
    barContainer.innerHTML = this._buildPopupBarSvg(pct);
    popup.appendChild(barContainer);

    // ── Category sections ──
    const cats = breakdown.categories;
    const total = breakdown.total || 1; // avoid /0

    // System section
    this._renderSection(popup, 'System', [
      { label: 'System Instructions', tokens: cats.systemInstructions, total },
      { label: 'Tool Definitions', tokens: cats.toolDefinitions, total },
    ]);

    // User Context section
    this._renderSection(popup, 'User Context', [
      { label: 'Messages', tokens: cats.messages, total },
      { label: 'Tool Results', tokens: cats.toolResults, total },
      { label: 'Files', tokens: cats.files, total },
    ]);
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
      rowValue.textContent = `${itemPct.toFixed(1)}%`;
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
