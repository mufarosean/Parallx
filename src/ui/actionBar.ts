// actionBar.ts — ActionBar UI component
//
// A horizontal strip of icon/text buttons representing actions.
// Used for editor group toolbars, view title bars, notification
// action rows, and anywhere a row of small action buttons appears.
//
// VS Code reference: `src/vs/base/browser/ui/actionbar/actionbar.ts`

import { Disposable, DisposableStore } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $, clearNode, addDisposableListener, toggleClass } from './dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IAction {
  /** Unique action identifier. */
  readonly id: string;
  /** Display label. For icon-only buttons, this becomes the tooltip. */
  readonly label: string;
  /** Icon text (emoji or codicon placeholder). */
  readonly icon?: string;
  /** Tooltip override (defaults to `label`). */
  readonly title?: string;
  /** Whether the action is enabled. Default: true. */
  readonly enabled?: boolean;
}

// ─── ActionBar ───────────────────────────────────────────────────────────────

/**
 * A horizontal row of small action buttons.
 *
 * CSS classes:
 * - `.ui-action-bar` — container
 * - `.ui-action-bar-item` — individual button
 * - `.ui-action-bar-item--disabled` — disabled action
 * - `.ui-action-bar-icon` — icon span
 * - `.ui-action-bar-label` — label span
 */
export class ActionBar extends Disposable {

  readonly element: HTMLElement;

  private readonly _itemListeners = this._register(new DisposableStore());
  private _actions: IAction[] = [];

  private readonly _onDidRun = this._register(new Emitter<string>());
  readonly onDidRun: Event<string> = this._onDidRun.event;

  constructor(container: HTMLElement) {
    super();

    this.element = $('div.ui-action-bar');
    this.element.setAttribute('role', 'toolbar');

    container.appendChild(this.element);
  }

  // ─── Public API ────────────────────────────────────────────────────────

  /**
   * Set the actions to display. Replaces all current items.
   */
  setActions(actions: IAction[]): void {
    this._actions = actions;
    this._rebuild();
  }

  /**
   * Get a specific action by ID.
   */
  getAction(id: string): IAction | undefined {
    return this._actions.find(a => a.id === id);
  }

  // ─── Internal ──────────────────────────────────────────────────────────

  private _rebuild(): void {
    clearNode(this.element);
    this._itemListeners.clear();

    for (const action of this._actions) {
      const btn = document.createElement('button');
      btn.className = 'ui-action-bar-item';
      btn.type = 'button';
      btn.title = action.title ?? action.label;

      const isEnabled = action.enabled ?? true;
      btn.disabled = !isEnabled;
      toggleClass(btn, 'ui-action-bar-item--disabled', !isEnabled);

      // Icon
      if (action.icon) {
        const iconEl = $('span.ui-action-bar-icon', action.icon);
        btn.appendChild(iconEl);
      }

      // Label (used as tooltip when icon is present, otherwise shown as text)
      if (!action.icon) {
        const labelEl = $('span.ui-action-bar-label', action.label);
        btn.appendChild(labelEl);
      }

      // Click
      this._itemListeners.add(addDisposableListener(btn, 'click', (e) => {
        e.stopPropagation();
        if (isEnabled) {
          this._onDidRun.fire(action.id);
        }
      }));

      this.element.appendChild(btn);
    }
  }
}
