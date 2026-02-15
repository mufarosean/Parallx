// notificationService.ts — transient toast notification system
//
// Provides the shell's notification overlay UI, backing
// `parallx.window.showInformationMessage()` and friends.
// Renders brief toast messages in the bottom-right corner of the workbench
// with support for severity levels, action buttons, and auto-dismiss.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';
import { $ } from '../ui/dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export enum NotificationSeverity {
  Information = 'information',
  Warning = 'warning',
  Error = 'error',
}

export interface NotificationAction {
  readonly title: string;
  readonly isCloseAffordance?: boolean;
}

export interface INotification {
  readonly id: string;
  readonly severity: NotificationSeverity;
  readonly message: string;
  readonly actions: readonly NotificationAction[];
  readonly source?: string; // tool ID that created this notification
}

export interface NotificationResult {
  readonly action: NotificationAction | undefined;
}

// ─── Notification Service ────────────────────────────────────────────────────

let _nextNotificationId = 1;

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Manages toast notifications displayed in the workbench.
 * 
 * Features:
 * - Three severity levels (information/warning/error)
 * - Auto-dismiss with configurable timeout
 * - Action buttons that resolve a promise
 * - Stacking with newest on top
 * - Manual close button
 */
export class NotificationService extends Disposable {

  private _container: HTMLElement | undefined;
  private readonly _activeNotifications = new Map<string, {
    element: HTMLElement;
    timer: ReturnType<typeof setTimeout> | undefined;
    resolve: (result: NotificationResult) => void;
  }>();

  /** Recent notification history for the notification center (newest first). */
  private readonly _history: INotification[] = [];
  private static readonly MAX_HISTORY = 50;

  private readonly _onDidShowNotification = this._register(new Emitter<INotification>());
  readonly onDidShowNotification: Event<INotification> = this._onDidShowNotification.event;

  private readonly _onDidCloseNotification = this._register(new Emitter<string>());
  readonly onDidCloseNotification: Event<string> = this._onDidCloseNotification.event;

  /** Fired when active notification count changes (for status bar badge). */
  private readonly _onDidChangeCount = this._register(new Emitter<number>());
  readonly onDidChangeCount: Event<number> = this._onDidChangeCount.event;

  /** Number of currently visible (active) notifications. */
  get activeCount(): number {
    return this._activeNotifications.size;
  }

  /** Recent notification history (newest first, read-only). */
  get history(): readonly INotification[] {
    return this._history;
  }

  /** Clear all notification history. */
  clearHistory(): void {
    this._history.length = 0;
  }

  /**
   * Attach the notification overlay to the DOM.
   * Must be called once after the workbench container is available.
   */
  attach(parent: HTMLElement): void {
    if (this._container) return;

    this._container = $('div');
    this._container.className = 'parallx-notifications-container';
    parent.appendChild(this._container);
  }

  /**
   * Show a notification message.
   * Returns a promise that resolves when the notification is dismissed,
   * with the selected action (or undefined if auto-dismissed/closed).
   */
  notify(
    severity: NotificationSeverity,
    message: string,
    actions: readonly NotificationAction[] = [],
    source?: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<NotificationAction | undefined> {
    const id = `notification-${_nextNotificationId++}`;

    const notification: INotification = { id, severity, message, actions, source };

    return new Promise<NotificationAction | undefined>(resolve => {
      const resolveWrapper = (result: NotificationResult) => resolve(result.action);
      const element = this._createNotificationElement(notification, resolveWrapper);

      this._activeNotifications.set(id, {
        element,
        timer: timeoutMs > 0 ? setTimeout(() => this._dismiss(id, undefined), timeoutMs) : undefined,
        resolve: resolveWrapper,
      });

      // Track in history
      this._history.unshift(notification);
      if (this._history.length > NotificationService.MAX_HISTORY) {
        this._history.length = NotificationService.MAX_HISTORY;
      }

      if (this._container) {
        // Insert at top (newest first)
        this._container.prepend(element);
      } else if (timeoutMs === 0) {
        // No container and no auto-dismiss timeout: the notification would be
        // invisible and uninteractable, so resolve immediately to prevent a
        // permanently unsettled promise.
        console.warn(`[NotificationService] No container attached — dismissing persistent notification "${id}" immediately`);
        this._dismiss(id, undefined);
      }

      this._onDidChangeCount.fire(this._activeNotifications.size);
      this._onDidShowNotification.fire(notification);
    });
  }

  /**
   * Convenience: show an information-level notification.
   */
  info(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined> {
    return this.notify(NotificationSeverity.Information, message, actions);
  }

  /**
   * Convenience: show a warning-level notification.
   */
  warn(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined> {
    return this.notify(NotificationSeverity.Warning, message, actions);
  }

  /**
   * Convenience: show an error-level notification.
   */
  error(message: string, ...actions: NotificationAction[]): Promise<NotificationAction | undefined> {
    return this.notify(NotificationSeverity.Error, message, actions);
  }

  /**
   * Dismiss a notification by ID.
   */
  dismiss(id: string): void {
    this._dismiss(id, undefined);
  }

  /**
   * Dismiss all active notifications.
   */
  dismissAll(): void {
    for (const id of [...this._activeNotifications.keys()]) {
      this._dismiss(id, undefined);
    }
  }

  // ── Internals ──

  private _dismiss(id: string, action: NotificationAction | undefined): void {
    const entry = this._activeNotifications.get(id);
    if (!entry) return;

    if (entry.timer !== undefined) {
      clearTimeout(entry.timer);
    }

    // Animate out
    entry.element.style.opacity = '0';
    entry.element.style.transform = 'translateX(20px)';

    setTimeout(() => {
      entry.element.remove();
      this._activeNotifications.delete(id);
      this._onDidChangeCount.fire(this._activeNotifications.size);
      entry.resolve({ action });
      this._onDidCloseNotification.fire(id);
    }, 200);
  }

  private _createNotificationElement(
    notification: INotification,
    _resolve: (result: NotificationResult) => void,
  ): HTMLElement {
    const el = $('div');
    el.className = `parallx-notification parallx-notification-${notification.severity}`;
    el.dataset.notificationId = notification.id;

    // Content row
    const content = $('div');
    content.className = 'parallx-notification-content';

    // Severity icon
    const icon = $('span');
    icon.className = 'parallx-notification-icon';
    icon.textContent = this._getSeverityIcon(notification.severity);
    content.appendChild(icon);

    // Message
    const msg = $('span');
    msg.className = 'parallx-notification-message';
    msg.textContent = notification.message;
    content.appendChild(msg);

    el.appendChild(content);

    // Actions row
    if (notification.actions.length > 0) {
      const actionsRow = $('div');
      actionsRow.className = 'parallx-notification-actions';

      for (const action of notification.actions) {
        const btn = $('button');
        btn.className = 'parallx-notification-action-btn';
        btn.textContent = action.title;
        btn.addEventListener('click', () => {
          this._dismiss(notification.id, action);
        });
        actionsRow.appendChild(btn);
      }

      el.appendChild(actionsRow);
    }

    // Close button
    const closeBtn = $('button');
    closeBtn.className = 'parallx-notification-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      this._dismiss(notification.id, undefined);
    });
    el.appendChild(closeBtn);

    // Entrance animation
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    requestAnimationFrame(() => {
      el.style.opacity = '1';
      el.style.transform = 'translateX(0)';
    });

    return el;
  }

  private _getSeverityIcon(severity: NotificationSeverity): string {
    switch (severity) {
      case NotificationSeverity.Information: return 'ℹ';
      case NotificationSeverity.Warning: return '⚠';
      case NotificationSeverity.Error: return '✕';
    }
  }

  // ── Disposal ──

  override dispose(): void {
    this.dismissAll();
    this._container?.remove();
    this._container = undefined;
    super.dispose();
  }
}

// ─── Input Box / Quick Pick Modals ───────────────────────────────────────────

/**
 * Show a modal input box overlay with OK / Cancel buttons.
 *
 * The input text is pre-selected so the user can immediately type a
 * replacement. Mouse interactions inside the dialog (click-to-position,
 * drag-to-select, double-click-to-select-word) all work normally because
 * the box stops event propagation before it reaches the overlay's dismiss
 * handler.
 */
export function showInputBoxModal(
  parent: HTMLElement,
  options: { prompt?: string; value?: string; placeholder?: string; password?: boolean; validateInput?: (v: string) => string | undefined | Promise<string | undefined> },
): Promise<string | undefined> {
  return new Promise(resolve => {
    let resolved = false;
    const overlay = _createModalOverlay(parent);

    const box = $('div');
    box.className = 'parallx-modal-box';

    // Prevent any mouse interaction inside the box from bubbling to the
    // overlay's click-to-dismiss handler.
    box.addEventListener('mousedown', (e) => e.stopPropagation());
    box.addEventListener('click', (e) => e.stopPropagation());

    if (options.prompt) {
      const label = $('div');
      label.textContent = options.prompt;
      label.className = 'parallx-modal-label';
      box.appendChild(label);
    }

    const input = $('input');
    input.type = options.password ? 'password' : 'text';
    input.value = options.value ?? '';
    input.placeholder = options.placeholder ?? '';
    input.className = 'parallx-modal-input';
    // Disable any drag-region interference from parent containers
    input.style.webkitAppRegion = 'no-drag';
    box.appendChild(input);

    const errorLabel = $('div');
    errorLabel.className = 'parallx-modal-error';
    box.appendChild(errorLabel);

    // ── Button row ──
    const btnRow = $('div');
    btnRow.className = 'parallx-modal-buttons';

    const cancelBtn = $('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'parallx-modal-btn parallx-modal-btn--secondary';

    const okBtn = $('button');
    okBtn.type = 'button';
    okBtn.textContent = 'OK';
    okBtn.className = 'parallx-modal-btn parallx-modal-btn--primary';

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(okBtn);
    box.appendChild(btnRow);

    overlay.appendChild(box);

    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      overlay.remove();
    };

    const accept = async () => {
      if (options.validateInput) {
        const err = await options.validateInput(input.value);
        if (err) {
          errorLabel.textContent = err;
          input.focus();
          return;
        }
      }
      cleanup();
      resolve(input.value);
    };

    const cancel = () => {
      cleanup();
      resolve(undefined);
    };

    // Keyboard
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { cancel(); }
      else if (e.key === 'Enter') { accept(); }
    });

    // Buttons
    okBtn.addEventListener('click', () => accept());
    cancelBtn.addEventListener('click', () => cancel());

    // Click on translucent overlay background → cancel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancel();
    });

    // Focus input and pre-select all text so the user can type immediately
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

/**
 * Show a modal quick pick overlay.
 */
export function showQuickPickModal(
  parent: HTMLElement,
  items: readonly { label: string; description?: string; detail?: string; picked?: boolean }[],
  options: { placeholder?: string; canPickMany?: boolean } = {},
): Promise<typeof items[number] | (typeof items[number])[] | undefined> {
  return new Promise(resolve => {
    const overlay = _createModalOverlay(parent);

    const box = $('div');
    box.className = 'parallx-quickpick-box';

    // Search input
    const input = $('input');
    input.type = 'text';
    input.placeholder = options.placeholder ?? 'Select an item...';
    input.className = 'parallx-quickpick-input';
    box.appendChild(input);

    // Items list
    const list = $('div');
    list.className = 'parallx-quickpick-list';
    box.appendChild(list);

    const selected = new Set<number>();
    let highlightIndex = 0;

    const renderItems = (filter: string) => {
      list.innerHTML = '';
      const lowerFilter = filter.toLowerCase();
      let visibleIndex = 0;

      items.forEach((item, i) => {
        if (lowerFilter && !item.label.toLowerCase().includes(lowerFilter)) return;

        const row = $('div');
        row.className = 'parallx-quickpick-row';
        row.dataset.index = String(i);

        if (visibleIndex === highlightIndex) {
          row.classList.add('parallx-quickpick-row--active');
        }

        const labelEl = $('span');
        labelEl.textContent = item.label;
        row.appendChild(labelEl);

        if (item.description) {
          const desc = $('span');
          desc.textContent = `  ${item.description}`;
          desc.className = 'parallx-quickpick-desc';
          row.appendChild(desc);
        }

        row.addEventListener('click', () => {
          if (options.canPickMany) {
            if (selected.has(i)) selected.delete(i);
            else selected.add(i);
            renderItems(input.value);
          } else {
            cleanup();
            resolve(item);
          }
        });

        list.appendChild(row);
        visibleIndex++;
      });
    };

    input.addEventListener('input', () => {
      highlightIndex = 0;
      renderItems(input.value);
    });

    const cleanup = () => { overlay.remove(); };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(undefined);
      } else if (e.key === 'Enter') {
        if (options.canPickMany) {
          cleanup();
          resolve([...selected].map(i => items[i]));
        } else {
          const rows = list.querySelectorAll('[data-index]');
          if (rows[highlightIndex]) {
            const idx = Number((rows[highlightIndex] as HTMLElement).dataset.index);
            cleanup();
            resolve(items[idx]);
          }
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const visibleCount = list.querySelectorAll('[data-index]').length;
        highlightIndex = Math.min(highlightIndex + 1, visibleCount - 1);
        renderItems(input.value);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        highlightIndex = Math.max(0, highlightIndex - 1);
        renderItems(input.value);
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(undefined);
      }
    });

    overlay.appendChild(box);
    renderItems('');
    requestAnimationFrame(() => input.focus());
  });
}

// ── Modal overlay helper ──

function _createModalOverlay(parent: HTMLElement): HTMLElement {
  const overlay = $('div');
  overlay.className = 'parallx-modal-overlay';
  parent.appendChild(overlay);
  return overlay;
}
