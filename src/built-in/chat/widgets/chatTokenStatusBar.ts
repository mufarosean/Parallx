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

import { Disposable, toDisposable, type IDisposable } from '../../../platform/lifecycle.js';
import { layoutPopup } from '../../../ui/dom.js';
import { $ } from '../../../ui/dom.js';

import './chatTokenStatusBar.css';
import type { ITokenStatusBarServices } from '../chatTypes.js';

// ITokenStatusBarServices — now defined in chatTypes.ts (M13 Phase 1)
export type { ITokenStatusBarServices } from '../chatTypes.js';

/** Sub-component within a top-level category. */
interface ITokenSubItem {
  label: string;
  tokens: number;
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
  /** Detailed sub-breakdowns for expandable rows. */
  subBreakdowns?: {
    systemInstructions?: ITokenSubItem[];
    toolDefinitions?: ITokenSubItem[];
    files?: ITokenSubItem[];
  };
}

// ── Constants ──

const RING_SIZE = 16;
const RING_STROKE = 2;

// ── ChatTokenStatusBar ──

/**
 * Status bar item showing token usage with a visual progress bar.
 * Click to open a detail popup with per-category breakdown.
 */
export class ChatTokenStatusBar extends Disposable {

  private readonly _services: ITokenStatusBarServices;
  private _popupElement: HTMLElement | undefined;
  private _dismissListener: IDisposable | undefined;
  private _lastBreakdown: ITokenBreakdown | undefined;

  // ── DOM elements ──
  private readonly _root: HTMLElement;
  private readonly _ring: HTMLElement;
  private readonly _label: HTMLElement;
  private _popupAnchorRect: DOMRect | undefined;

  constructor(
    services: ITokenStatusBarServices,
  ) {
    super();
    this._services = services;

    // Build a container for the token usage indicator
    this._root = $('div.parallx-token-statusbar');

    this._ring = $('span.parallx-token-statusbar-ring');
    this._ring.innerHTML = this._buildRingSvg(0);
    this._root.appendChild(this._ring);

    this._label = $('span.parallx-token-statusbar-label');
    this._label.textContent = '0%';
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

    // Update ring
    this._ring.innerHTML = this._buildRingSvg(breakdown.percentage);

    // Update label text: "47%"
    this._label.textContent = `${Math.round(breakdown.percentage)}%`;

    // Tooltip
    const approx = breakdown.isReal ? '' : '~';
    const source = breakdown.isReal ? 'Ollama-reported' : 'Estimated';
    this._root.title = breakdown.contextLength > 0
      ? `${source} token usage: ${approx}${this._formatTokens(breakdown.total)} / ${this._formatTokens(breakdown.contextLength)} (${breakdown.percentage.toFixed(1)}%) — click for details`
      : `${source} tokens: ${approx}${this._formatTokens(breakdown.total)} — click for details`;

    // If popup is open, refresh it
    if (this._popupElement) {
      this._renderPopupContent(this._popupElement, breakdown);
    }
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
      // Prefer OpenClaw runtime's cached prompt report (accurate post-turn data)
      // Use OpenClaw runtime's cached prompt report (accurate post-turn data).
      // Before the first turn, estimates stay at 0 — no legacy fallback.
      const promptReport = this._services.getLastSystemPromptReport?.();
      if (promptReport) {
        systemInstructionsEst = Math.ceil(promptReport.systemPrompt.nonProjectContextChars / 4);
        toolDefinitionsEst = Math.ceil(promptReport.tools.schemaChars / 4);
        filesEst = Math.ceil(promptReport.systemPrompt.projectContextChars / 4);
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

    // Pass scale factor so sub-items are consistent with the (possibly scaled) parent categories.
    const scale = hasRealCounts
      ? ((systemInstructionsEst + toolDefinitionsEst + filesEst + messagesEst + toolResultsEst) > 0
        ? total / (systemInstructionsEst + toolDefinitionsEst + filesEst + messagesEst + toolResultsEst)
        : 1)
      : 1;

    return { total, contextLength, percentage, isReal, categories: cats, subBreakdowns: this._computeSubBreakdowns(scale) };
  }

  // ── Sub-breakdown computation ──

  private _computeSubBreakdowns(scale: number): ITokenBreakdown['subBreakdowns'] {
    const report = this._services.getLastSystemPromptReport?.();
    if (!report) return undefined;

    // System Instructions sub-items
    const systemSubs: ITokenSubItem[] = [];
    const skillsTokens = Math.round(Math.ceil(report.skills.promptChars / 4) * scale);
    const toolListTokens = Math.round(Math.ceil(report.tools.listChars / 4) * scale);
    // Fixed = nonProject minus skills, tool summaries
    const fixedTokens = Math.max(0, Math.round(Math.ceil(report.systemPrompt.nonProjectContextChars / 4) * scale) - skillsTokens - toolListTokens);
    systemSubs.push({ label: 'Fixed (identity, safety, rules)', tokens: fixedTokens });
    if (skillsTokens > 0) {
      systemSubs.push({ label: `Skills XML (${report.skills.visibleCount} entries)`, tokens: skillsTokens });
    }
    if (toolListTokens > 0) {
      systemSubs.push({ label: `Tool summaries (${report.tools.availableCount} tools)`, tokens: toolListTokens });
    }

    // Tool Definitions sub-items (JSON schemas sent via tools[] API param)
    const toolSubs: ITokenSubItem[] = [];
    if (report.tools.entries && report.tools.entries.length > 0) {
      for (const entry of report.tools.entries) {
        if (!entry.available) continue;
        toolSubs.push({ label: entry.name, tokens: Math.round(Math.ceil(entry.schemaChars / 4) * scale) });
      }
    }

    // Files sub-items (bootstrap files + workspace digest in workspace section)
    const fileSubs: ITokenSubItem[] = [];
    let bootstrapCharsTotal = 0;
    if (report.injectedWorkspaceFiles && report.injectedWorkspaceFiles.length > 0) {
      for (const file of report.injectedWorkspaceFiles) {
        if (file.missing) continue;
        const tokens = Math.round(Math.ceil(file.injectedChars / 4) * scale);
        fileSubs.push({ label: file.name, tokens });
        bootstrapCharsTotal += file.injectedChars;
      }
    }
    // Workspace digest = projectContext minus bootstrap file content
    const digestChars = Math.max(0, report.systemPrompt.projectContextChars - bootstrapCharsTotal);
    if (digestChars > 0) {
      fileSubs.push({ label: 'Workspace digest', tokens: Math.round(Math.ceil(digestChars / 4) * scale) });
    }

    return {
      systemInstructions: systemSubs.length > 0 ? systemSubs : undefined,
      toolDefinitions: toolSubs.length > 0 ? toolSubs : undefined,
      files: fileSubs.length > 0 ? fileSubs : undefined,
    };
  }

  // ── SVG Ring Builder ──

  private _buildRingSvg(pct: number): string {
    const size = RING_SIZE;
    const stroke = RING_STROKE;
    const radius = (size - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (circumference * Math.min(pct, 100)) / 100;

    let fillColor = '#4ec9b0'; // teal/green
    if (pct >= 90) fillColor = '#f14c4c'; // red
    else if (pct >= 70) fillColor = '#cca700'; // amber

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
      `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="#3c3c3c" stroke-width="${stroke}"/>`,
      `<circle cx="${size / 2}" cy="${size / 2}" r="${radius}" fill="none" stroke="${fillColor}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`,
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

    // Position above the indicator
    this._popupAnchorRect = this._root.getBoundingClientRect();
    layoutPopup(popup, this._popupAnchorRect, { position: 'above', gap: 4, margin: 8 });

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

  /** Re-position and re-constrain the popup after content size changes (expand/collapse). */
  private _relayoutPopup(): void {
    if (!this._popupElement || !this._popupAnchorRect) return;
    // Reset constraints so layoutPopup can measure natural size
    this._popupElement.style.maxHeight = '';
    this._popupElement.style.overflowY = '';
    layoutPopup(this._popupElement, this._popupAnchorRect, { position: 'above', gap: 4, margin: 8 });
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
    const subs = breakdown.subBreakdowns;

    this._renderSection(popup, 'System', [
      { label: 'System Instructions', tokens: cats.systemInstructions, total, subItems: subs?.systemInstructions },
      { label: 'Tool Definitions', tokens: cats.toolDefinitions, total, subItems: subs?.toolDefinitions },
    ]);

    this._renderSection(popup, 'User Context', [
      { label: 'Messages', tokens: cats.messages, total },
      { label: 'Tool Results', tokens: cats.toolResults, total },
      { label: 'Files', tokens: cats.files, total, subItems: subs?.files },
    ]);

  }

  private _renderSection(
    container: HTMLElement,
    title: string,
    items: { label: string; tokens: number; total: number; subItems?: ITokenSubItem[] }[],
  ): void {
    const section = $('div.parallx-token-popup-section');

    const sectionTitle = $('div.parallx-token-popup-section-title');
    sectionTitle.textContent = title;
    section.appendChild(sectionTitle);

    for (const item of items) {
      const row = $('div.parallx-token-popup-row');

      const rowLabel = $('span.parallx-token-popup-row-label');
      const itemPct = item.total > 0 ? (item.tokens / item.total) * 100 : 0;

      if (item.subItems && item.subItems.length > 0) {
        // Expandable row
        row.classList.add('parallx-token-popup-row-expandable');
        const chevron = $('span.parallx-token-popup-chevron');
        chevron.textContent = '▸';
        rowLabel.appendChild(chevron);
        const labelText = document.createTextNode(` ${item.label}`);
        rowLabel.appendChild(labelText);

        const subContainer = $('div.parallx-token-popup-sub');
        subContainer.style.display = 'none';

        for (const sub of item.subItems) {
          const subRow = $('div.parallx-token-popup-sub-row');
          const subLabel = $('span.parallx-token-popup-sub-label');
          subLabel.textContent = sub.label;
          subRow.appendChild(subLabel);
          if (sub.tokens > 0) {
            const subValue = $('span.parallx-token-popup-sub-value');
            subValue.textContent = this._formatTokens(sub.tokens);
            subRow.appendChild(subValue);
          }
          subContainer.appendChild(subRow);
        }

        row.addEventListener('click', (e) => {
          e.stopPropagation();
          const expanded = subContainer.style.display !== 'none';
          subContainer.style.display = expanded ? 'none' : 'block';
          chevron.textContent = expanded ? '▸' : '▾';
          this._relayoutPopup();
        });

        row.appendChild(rowLabel);
        const rowValue = $('span.parallx-token-popup-row-value');
        rowValue.textContent = `${this._formatTokens(item.tokens)} (${itemPct.toFixed(1)}%)`;
        row.appendChild(rowValue);
        section.appendChild(row);
        section.appendChild(subContainer);
      } else {
        rowLabel.textContent = item.label;
        row.appendChild(rowLabel);
        const rowValue = $('span.parallx-token-popup-row-value');
        rowValue.textContent = `${this._formatTokens(item.tokens)} (${itemPct.toFixed(1)}%)`;
        row.appendChild(rowValue);
        section.appendChild(row);
      }
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
