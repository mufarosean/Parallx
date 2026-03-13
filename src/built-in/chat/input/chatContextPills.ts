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

import { Disposable, toDisposable } from '../../../platform/lifecycle.js';
import { Emitter } from '../../../platform/events.js';
import type { Event } from '../../../platform/events.js';
import { $, addDisposableListener, layoutPopup } from '../../../ui/dom.js';
import { chatIcons } from '../chatIcons.js';
import type { IContextPill } from '../../../services/chatTypes.js';
import type { ITokenBudgetSlot } from '../chatTypes.js';

// ITokenBudgetSlot — now defined in chatTypes.ts (M13 Phase 1)
export type { ITokenBudgetSlot } from '../chatTypes.js';

type ContextPillGroupKey = IContextPill['type'];

const CONTEXT_PILL_GROUP_ORDER: ContextPillGroupKey[] = [
  'attachment',
  'rag',
  'memory',
  'concept',
  'rule',
  'system',
];

function getContextPillGroupLabel(type: ContextPillGroupKey): string {
  switch (type) {
    case 'attachment':
      return 'Attachments';
    case 'rag':
      return 'Retrieved Sources';
    case 'memory':
      return 'Session Memory';
    case 'concept':
      return 'Concept Recall';
    case 'rule':
      return 'Rules';
    case 'system':
      return 'System';
    default:
      return 'Other';
  }
}

// ── Component ──

/**
 * Context pills menu — shows what context sources are visible to the LLM.
 *
 * Renders as a toolbar button that opens a compact anchored menu above the
 * composer controls, keeping the transcript and input stack visually lighter.
 */
export class ChatContextPills extends Disposable {

  private readonly _root: HTMLElement;
  private readonly _toggleBtn: HTMLElement;
  private readonly _menu: HTMLElement;
  private readonly _menuHeader: HTMLElement;
  private readonly _pillsContainer: HTMLElement;
  private readonly _budgetContainer: HTMLElement;

  /** Current pills data. */
  private _pills: IContextPill[] = [];

  /** Token budget slots (Task 4.8). */
  private _budgetSlots: ITokenBudgetSlot[] = [];

  /** IDs of pills the user has removed (excluded from next message). */
  private readonly _excluded = new Set<string>();

  /** Whether the menu is open. */
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

    this._root = $('div.parallx-chat-context-menu');
    container.appendChild(this._root);
    this._register(toDisposable(() => this._root.remove()));

    // Toggle button: compact toolbar control that opens the context menu.
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'parallx-chat-context-menu-trigger';
    toggleBtn.type = 'button';
    toggleBtn.setAttribute('aria-haspopup', 'menu');
    toggleBtn.setAttribute('aria-expanded', 'false');
    this._toggleBtn = toggleBtn;
    this._toggleBtn.addEventListener('click', () => {
      this._expanded = !this._expanded;
      this._render();
    });
    this._root.appendChild(this._toggleBtn);

    this._menu = $('div.parallx-chat-context-menu-panel');
    this._menu.setAttribute('role', 'menu');
    this._menu.style.display = 'none';
    this._menu.style.position = 'fixed';
    document.body.appendChild(this._menu);
    this._register(toDisposable(() => this._menu.remove()));

    this._menuHeader = $('div.parallx-chat-context-menu-header');
    this._menu.appendChild(this._menuHeader);

    // Pills container (inside menu)
    this._pillsContainer = $('div.parallx-chat-context-pills-list');
    this._menu.appendChild(this._pillsContainer);

    // Budget breakdown container (Task 4.8 — inside the menu)
    this._budgetContainer = $('div.parallx-chat-context-budget');
    this._menu.appendChild(this._budgetContainer);

    this._register(addDisposableListener(document, 'mousedown', (event: MouseEvent) => {
      if (!this._expanded) {
        return;
      }

      const target = event.target;
      if (target instanceof Node && !this._root.contains(target) && !this._menu.contains(target)) {
        this._expanded = false;
        this._render();
      }
    }));

    this._register(addDisposableListener(document, 'keydown', (event: KeyboardEvent) => {
      if (!this._expanded || event.key !== 'Escape') {
        return;
      }

      this._expanded = false;
      this._render();
      this._toggleBtn.focus();
    }));

    this._register(addDisposableListener(window, 'resize', () => {
      if (!this._expanded) {
        return;
      }

      this._expanded = false;
      this._render();
    }));

    this._register(addDisposableListener(window, 'scroll', (event: Event) => {
      if (!this._expanded) {
        return;
      }

      const target = event.target;
      if (target instanceof Node && this._menu.contains(target)) {
        return;
      }

      this._expanded = false;
      this._render();
    }, true));

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
    this._expanded = false;
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
    const excludedCount = this._excluded.size;

    // Toggle button label
    const sourceLabel = activePills.length === 1 ? '1 source' : `${activePills.length} sources`;
    const excludeLabel = excludedCount > 0 ? ` (${excludedCount} excluded)` : '';
    const arrow = this._expanded ? '▴' : '▾';

    this._toggleBtn.textContent = '';
    this._toggleBtn.setAttribute('aria-expanded', this._expanded ? 'true' : 'false');

    const text = document.createElement('span');
    text.className = 'parallx-chat-context-menu-trigger-label';
    text.textContent = `Context ${activePills.length}`;
    this._toggleBtn.appendChild(text);

    if (excludedCount > 0) {
      const badge = document.createElement('span');
      badge.className = 'parallx-chat-context-menu-trigger-badge';
      badge.textContent = `${excludedCount} excluded`;
      this._toggleBtn.appendChild(badge);
    }

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'parallx-chat-context-pills-arrow';
    arrowSpan.textContent = arrow;
    this._toggleBtn.appendChild(arrowSpan);

    this._menuHeader.innerHTML = '';

    const headerTop = $('div.parallx-chat-context-menu-header-top');
    const titleWrap = $('div.parallx-chat-context-menu-header-copy');
    const title = $('div.parallx-chat-context-menu-title', 'Sources For Next Turn');
    const summary = $('div.parallx-chat-context-menu-summary', `${sourceLabel}${excludeLabel}`);
    titleWrap.appendChild(title);
    titleWrap.appendChild(summary);
    headerTop.appendChild(titleWrap);

    this._menuHeader.appendChild(headerTop);

    // Pills list
    this._pillsContainer.innerHTML = '';
    this._menu.style.display = this._expanded ? '' : 'none';

    const groupedPills = new Map<ContextPillGroupKey, IContextPill[]>();
    for (const pill of this._pills) {
      const group = groupedPills.get(pill.type) ?? [];
      group.push(pill);
      groupedPills.set(pill.type, group);
    }

    for (const groupKey of CONTEXT_PILL_GROUP_ORDER) {
      const groupPills = groupedPills.get(groupKey);
      if (!groupPills || groupPills.length === 0) {
        continue;
      }

      const activeCount = groupPills.filter((pill) => !this._excluded.has(pill.id)).length;
      const section = $('div.parallx-chat-context-group');
      const sectionHeader = $('div.parallx-chat-context-group-title');
      const sectionTitle = $('span.parallx-chat-context-group-title-text', getContextPillGroupLabel(groupKey));
      const sectionCount = $('span.parallx-chat-context-group-title-count', `${activeCount}/${groupPills.length}`);
      sectionHeader.appendChild(sectionTitle);
      sectionHeader.appendChild(sectionCount);
      section.appendChild(sectionHeader);

      const sectionList = $('div.parallx-chat-context-group-list');
      for (const pill of groupPills) {
        const isExcluded = this._excluded.has(pill.id);
        sectionList.appendChild(this._createPill(pill, isExcluded));
      }

      section.appendChild(sectionList);
      this._pillsContainer.appendChild(section);
    }

    this._renderBudget();

    if (this._expanded) {
      layoutPopup(this._menu, this._toggleBtn.getBoundingClientRect(), {
        position: 'above',
        gap: 8,
      });
    }
  }

  /** Render lightweight guidance that points quantitative context usage back to the status bar. */
  private _renderBudget(): void {
    this._budgetContainer.innerHTML = '';
    this._budgetContainer.style.display = (this._expanded && this._budgetSlots.length > 0) ? '' : 'none';
    if (!this._expanded || this._budgetSlots.length === 0) { return; }

    const title = $('div.parallx-chat-context-budget-title', 'Context Window');
    this._budgetContainer.appendChild(title);

    const totalUsed = this._budgetSlots.reduce((sum, slot) => sum + slot.used, 0);
    const note = $('div.parallx-chat-context-budget-note');

    const summary = document.createElement('span');
    summary.className = 'parallx-chat-context-budget-summary';
    summary.textContent = `This turn is carrying about ${this._formatTokenCount(totalUsed)} tokens of local source context.`;
    note.appendChild(summary);

    const detail = document.createElement('span');
    detail.className = 'parallx-chat-context-budget-detail';
    detail.textContent = 'Overall context-window usage and token pressure live in the status bar.';
    note.appendChild(detail);

    this._budgetContainer.appendChild(note);
  }

  /** Create a single pill element. */
  private _createPill(pill: IContextPill, isExcluded: boolean): HTMLElement {
    const modifiers = [
      `parallx-chat-context-item--${pill.type}`,
      isExcluded ? 'parallx-chat-context-pill--excluded' : '',
    ].filter(Boolean).join('.');

    const el = $(`div.parallx-chat-context-item.${modifiers}`);

    const body = $('div.parallx-chat-context-item-body');

    // Label
    const label = document.createElement('span');
    label.className = 'parallx-chat-context-item-label';
    label.textContent = pill.label;
    label.title = pill.id;
    body.appendChild(label);

    // Token count badge
    const tokens = document.createElement('span');
    tokens.className = 'parallx-chat-context-item-meta';
    tokens.textContent = `${this._formatTokenCount(pill.tokens)} tokens`;
    body.appendChild(tokens);

    el.appendChild(body);

    // Action button: × to exclude, or ↩ to restore
    if (pill.removable) {
      if (isExcluded) {
        const restoreBtn = document.createElement('button');
        restoreBtn.className = 'parallx-chat-context-item-action';
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
        removeBtn.className = 'parallx-chat-context-item-action';
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

}
