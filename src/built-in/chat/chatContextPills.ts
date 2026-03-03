// chatContextPills.ts — Context pills UI component (M11 Task 1.10)
//
// Visual chips below the context ribbon showing what the LLM sees:
//   1. **RAG** sources (auto-retrieved files from vector search)
//   2. **System** context layers (SOUL.md, AGENTS.md, TOOLS.md, rules)
//   3. **Attachment** summary (already shown in ribbon — just token counts here)
//
// Each pill shows: source label + estimated token count.
// RAG and rule pills are removable (click × to exclude from next message).
//
// Task 4.8: Token budget transparency —
//   Shows a breakdown bar: system prompt (X tok) + RAG (Y tok) + history (Z tok) + user (W tok).
//   Updated in real-time as context changes.
//
// VS Code reference:
//   Copilot's "used X references" collapsible area beneath the response.
//   Our implementation shows them ABOVE the input for pre-send transparency.

import { Disposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { Event } from '../../platform/events.js';
import { $ } from '../../ui/dom.js';
import { chatIcons } from './chatIcons.js';
import type { IContextPill } from '../../services/chatTypes.js';

// ── Budget Breakdown Types (Task 4.8) ──

/** Per-slot token budget breakdown. */
export interface ITokenBudgetSlot {
  /** Slot name (displayed). */
  label: string;
  /** Tokens used in this slot. */
  used: number;
  /** Maximum tokens allocated. */
  allocated: number;
  /** CSS color for the bar segment. */
  color: string;
}

// ── Component ──

/**
 * Context pills strip — shows what context sources are visible to the LLM.
 *
 * Renders below the context ribbon (above the textarea) as a collapsible section.
 * Updated after each message send when context source data becomes available.
 */
export class ChatContextPills extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _toggleBtn: HTMLElement;
  private readonly _pillsContainer: HTMLElement;
  private readonly _budgetContainer: HTMLElement;

  /** Current pills data. */
  private _pills: IContextPill[] = [];

  /** Token budget slots (Task 4.8). */
  private _budgetSlots: ITokenBudgetSlot[] = [];

  /** IDs of pills the user has removed (excluded from next message). */
  private readonly _excluded = new Set<string>();

  /** Whether the pills strip is expanded. */
  private _expanded = false;

  // ── Events ──

  private readonly _onDidExclude = this._register(new Emitter<string>());
  /** Fires when the user clicks × on a pill to exclude it from context. */
  readonly onDidExclude: Event<string> = this._onDidExclude.event;

  private readonly _onDidRestore = this._register(new Emitter<string>());
  /** Fires when the user restores a previously excluded pill. */
  readonly onDidRestore: Event<string> = this._onDidRestore.event;

  constructor(container: HTMLElement) {
    super();

    this._root = $('div.parallx-chat-context-pills');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    // Toggle button: "Context: 3 sources (1.2k tokens)" — click to expand/collapse
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'parallx-chat-context-pills-toggle';
    toggleBtn.type = 'button';
    this._toggleBtn = toggleBtn;
    this._toggleBtn.addEventListener('click', () => {
      this._expanded = !this._expanded;
      this._render();
    });
    this._root.appendChild(this._toggleBtn);

    // Pills container (collapsible)
    this._pillsContainer = $('div.parallx-chat-context-pills-list');
    this._root.appendChild(this._pillsContainer);

    // Budget breakdown container (Task 4.8 — collapsible alongside pills)
    this._budgetContainer = $('div.parallx-chat-context-budget');
    this._root.appendChild(this._budgetContainer);

    // Start hidden
    this._root.style.display = 'none';
  }

  // ── Public API ──

  /**
   * Update the pills display with new context data.
   * Called after each message send when the participant reports context sources.
   */
  setPills(pills: readonly IContextPill[]): void {
    this._pills = [...pills];
    this._render();
  }

  /** Get IDs of pills the user has excluded. */
  getExcluded(): ReadonlySet<string> {
    return this._excluded;
  }

  /** Clear exclusions (e.g. on new session or /clear). */
  clearExclusions(): void {
    this._excluded.clear();
    this._render();
  }

  /** Clear all pills (hide the strip). */
  clear(): void {
    this._pills = [];
    this._excluded.clear();
    this._render();
  }

  /**
   * Update the token budget breakdown display (Task 4.8).
   * Shows a segmented bar + per-slot label when expanded.
   */
  setBudget(slots: readonly ITokenBudgetSlot[]): void {
    this._budgetSlots = [...slots];
    this._renderBudget();
  }

  // ── Rendering ──

  private _render(): void {
    // Hide if no pills
    if (this._pills.length === 0) {
      this._root.style.display = 'none';
      return;
    }

    this._root.style.display = '';

    // Calculate totals
    const activePills = this._pills.filter(p => !this._excluded.has(p.id));
    const totalTokens = activePills.reduce((sum, p) => sum + p.tokens, 0);
    const excludedCount = this._excluded.size;

    // Toggle button label
    const tokenLabel = this._formatTokenCount(totalTokens);
    const sourceLabel = activePills.length === 1 ? '1 source' : `${activePills.length} sources`;
    const excludeLabel = excludedCount > 0 ? ` (${excludedCount} excluded)` : '';
    const arrow = this._expanded ? '▾' : '▸';

    this._toggleBtn.textContent = '';
    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'parallx-chat-context-pills-arrow';
    arrowSpan.textContent = arrow;
    this._toggleBtn.appendChild(arrowSpan);

    const text = document.createElement('span');
    text.textContent = `Context: ${sourceLabel} · ${tokenLabel}${excludeLabel}`;
    this._toggleBtn.appendChild(text);

    // Pills list
    this._pillsContainer.innerHTML = '';
    this._pillsContainer.style.display = this._expanded ? '' : 'none';

    for (const pill of this._pills) {
      const isExcluded = this._excluded.has(pill.id);
      const el = this._createPill(pill, isExcluded);
      this._pillsContainer.appendChild(el);
    }

    // Also render budget if expanded
    this._renderBudget();
  }

  /** Render the token budget breakdown bar (Task 4.8). */
  private _renderBudget(): void {
    this._budgetContainer.innerHTML = '';
    this._budgetContainer.style.display = (this._expanded && this._budgetSlots.length > 0) ? '' : 'none';
    if (!this._expanded || this._budgetSlots.length === 0) { return; }

    const totalAlloc = this._budgetSlots.reduce((s, b) => s + b.allocated, 0);
    if (totalAlloc === 0) { return; }

    // Label
    const title = $('div.parallx-chat-context-budget-title', 'Token Budget');
    this._budgetContainer.appendChild(title);

    // Segmented bar
    const bar = $('div.parallx-chat-context-budget-bar');
    for (const slot of this._budgetSlots) {
      const pct = (slot.allocated / totalAlloc) * 100;
      const fillPct = slot.allocated > 0 ? Math.min(100, (slot.used / slot.allocated) * 100) : 0;
      const segment = document.createElement('div');
      segment.className = 'parallx-chat-context-budget-segment';
      segment.style.width = `${pct}%`;
      segment.title = `${slot.label}: ${this._formatTokenCount(slot.used)} / ${this._formatTokenCount(slot.allocated)}`;

      const fill = document.createElement('div');
      fill.className = 'parallx-chat-context-budget-fill';
      fill.style.width = `${fillPct}%`;
      fill.style.background = slot.color;
      segment.appendChild(fill);
      bar.appendChild(segment);
    }
    this._budgetContainer.appendChild(bar);

    // Legend row
    const legend = $('div.parallx-chat-context-budget-legend');
    for (const slot of this._budgetSlots) {
      const item = $('span.parallx-chat-context-budget-legend-item');

      const dot = document.createElement('span');
      dot.className = 'parallx-chat-context-budget-dot';
      dot.style.background = slot.color;
      item.appendChild(dot);

      const text = document.createElement('span');
      text.textContent = `${slot.label}: ${this._formatTokenCount(slot.used)}`;
      item.appendChild(text);

      legend.appendChild(item);
    }
    this._budgetContainer.appendChild(legend);
  }

  /** Create a single pill element. */
  private _createPill(pill: IContextPill, isExcluded: boolean): HTMLElement {
    const modifiers = [
      `parallx-chat-context-pill--${pill.type}`,
      isExcluded ? 'parallx-chat-context-pill--excluded' : '',
    ].filter(Boolean).join('.');

    const el = $(`div.parallx-chat-context-pill.${modifiers}`);

    // Type icon
    const icon = document.createElement('span');
    icon.className = 'parallx-chat-context-pill-icon';
    icon.innerHTML = this._iconForType(pill.type);
    el.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'parallx-chat-context-pill-label';
    label.textContent = pill.label;
    label.title = pill.id;
    el.appendChild(label);

    // Token count badge
    const tokens = document.createElement('span');
    tokens.className = 'parallx-chat-context-pill-tokens';
    tokens.textContent = this._formatTokenCount(pill.tokens);
    el.appendChild(tokens);

    // Action button: × to exclude, or ↩ to restore
    if (pill.removable) {
      if (isExcluded) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'parallx-chat-context-pill-action';
        restoreBtn.type = 'button';
        restoreBtn.title = 'Restore to context';
        restoreBtn.setAttribute('aria-label', `Restore ${pill.label}`);
        restoreBtn.textContent = '↩';
        restoreBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._excluded.delete(pill.id);
          this._onDidRestore.fire(pill.id);
          this._render();
        });
        el.appendChild(restoreBtn);
      } else {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'parallx-chat-context-pill-action';
        removeBtn.type = 'button';
        removeBtn.title = 'Exclude from context';
        removeBtn.setAttribute('aria-label', `Remove ${pill.label}`);
        removeBtn.innerHTML = chatIcons.close;
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._excluded.add(pill.id);
          this._onDidExclude.fire(pill.id);
          this._render();
        });
        el.appendChild(removeBtn);
      }
    }

    return el;
  }

  /** Format a token count for display (e.g. 1234 → "1.2k"). */
  private _formatTokenCount(tokens: number): string {
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return `${tokens}`;
  }

  /** Get the icon SVG for a pill type. */
  private _iconForType(type: IContextPill['type']): string {
    switch (type) {
      case 'rag':
        return chatIcons.search;
      case 'attachment':
        return chatIcons.file;
      case 'system':
        return chatIcons.wrench;
      case 'rule':
        return chatIcons.file;
      default:
        return chatIcons.file;
    }
  }
}
