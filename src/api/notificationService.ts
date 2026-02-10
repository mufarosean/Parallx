// notificationService.ts — transient toast notification system
//
// Provides the shell's notification overlay UI, backing
// `parallx.window.showInformationMessage()` and friends.
// Renders brief toast messages in the bottom-right corner of the workbench
// with support for severity levels, action buttons, and auto-dismiss.

import { Disposable, IDisposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter, Event } from '../platform/events.js';

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
const NOTIFICATION_GAP_PX = 8;

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

  private readonly _onDidShowNotification = this._register(new Emitter<INotification>());
  readonly onDidShowNotification: Event<INotification> = this._onDidShowNotification.event;

  private readonly _onDidCloseNotification = this._register(new Emitter<string>());
  readonly onDidCloseNotification: Event<string> = this._onDidCloseNotification.event;

  /**
   * Attach the notification overlay to the DOM.
   * Must be called once after the workbench container is available.
   */
  attach(parent: HTMLElement): void {
    if (this._container) return;

    this._container = document.createElement('div');
    this._container.className = 'parallx-notification-container';
    this._applyContainerStyles(this._container);
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
      const element = this._createNotificationElement(notification, resolve);

      this._activeNotifications.set(id, {
        element,
        timer: timeoutMs > 0 ? setTimeout(() => this._dismiss(id, undefined), timeoutMs) : undefined,
        resolve,
      });

      if (this._container) {
        // Insert at top (newest first)
        this._container.prepend(element);
      }

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
      entry.resolve({ action });
      this._onDidCloseNotification.fire(id);
    }, 200);
  }

  private _createNotificationElement(
    notification: INotification,
    resolve: (result: NotificationResult) => void,
  ): HTMLElement {
    const el = document.createElement('div');
    el.className = `parallx-notification parallx-notification-${notification.severity}`;
    el.dataset.notificationId = notification.id;
    this._applyNotificationStyles(el, notification.severity);

    // Content row
    const content = document.createElement('div');
    content.className = 'parallx-notification-content';
    content.style.display = 'flex';
    content.style.alignItems = 'flex-start';
    content.style.gap = '8px';
    content.style.flex = '1';

    // Severity icon
    const icon = document.createElement('span');
    icon.className = 'parallx-notification-icon';
    icon.textContent = this._getSeverityIcon(notification.severity);
    icon.style.flexShrink = '0';
    icon.style.fontSize = '14px';
    icon.style.lineHeight = '20px';
    content.appendChild(icon);

    // Message
    const msg = document.createElement('span');
    msg.className = 'parallx-notification-message';
    msg.textContent = notification.message;
    msg.style.flex = '1';
    msg.style.lineHeight = '20px';
    msg.style.wordBreak = 'break-word';
    content.appendChild(msg);

    el.appendChild(content);

    // Actions row
    if (notification.actions.length > 0) {
      const actionsRow = document.createElement('div');
      actionsRow.className = 'parallx-notification-actions';
      actionsRow.style.display = 'flex';
      actionsRow.style.gap = '6px';
      actionsRow.style.marginTop = '6px';
      actionsRow.style.marginLeft = '22px';

      for (const action of notification.actions) {
        const btn = document.createElement('button');
        btn.className = 'parallx-notification-action-btn';
        btn.textContent = action.title;
        this._applyButtonStyles(btn);
        btn.addEventListener('click', () => {
          this._dismiss(notification.id, action);
        });
        actionsRow.appendChild(btn);
      }

      el.appendChild(actionsRow);
    }

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'parallx-notification-close';
    closeBtn.textContent = '×';
    this._applyCloseButtonStyles(closeBtn);
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

  private _getSeverityColor(severity: NotificationSeverity): string {
    switch (severity) {
      case NotificationSeverity.Information: return '#3794ff';
      case NotificationSeverity.Warning: return '#cca700';
      case NotificationSeverity.Error: return '#f14c4c';
    }
  }

  // ── Styling ──

  private _applyContainerStyles(el: HTMLElement): void {
    el.style.position = 'fixed';
    el.style.bottom = '40px'; // above status bar
    el.style.right = '16px';
    el.style.zIndex = '10000';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.gap = `${NOTIFICATION_GAP_PX}px`;
    el.style.maxWidth = '420px';
    el.style.pointerEvents = 'none'; // container is transparent to clicks
  }

  private _applyNotificationStyles(el: HTMLElement, severity: NotificationSeverity): void {
    el.style.position = 'relative';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.padding = '10px 32px 10px 12px';
    el.style.backgroundColor = '#252526';
    el.style.color = '#cccccc';
    el.style.fontSize = '13px';
    el.style.fontFamily = 'system-ui, -apple-system, sans-serif';
    el.style.borderRadius = '4px';
    el.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    el.style.borderLeft = `3px solid ${this._getSeverityColor(severity)}`;
    el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    el.style.pointerEvents = 'auto'; // individual notifications are clickable
    el.style.minWidth = '280px';
  }

  private _applyButtonStyles(btn: HTMLElement): void {
    btn.style.padding = '3px 10px';
    btn.style.fontSize = '12px';
    btn.style.backgroundColor = '#0e639c';
    btn.style.color = '#ffffff';
    btn.style.border = 'none';
    btn.style.borderRadius = '3px';
    btn.style.cursor = 'pointer';
    btn.style.lineHeight = '18px';
  }

  private _applyCloseButtonStyles(btn: HTMLElement): void {
    btn.style.position = 'absolute';
    btn.style.top = '6px';
    btn.style.right = '6px';
    btn.style.width = '20px';
    btn.style.height = '20px';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.color = '#999999';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '16px';
    btn.style.lineHeight = '1';
    btn.style.padding = '0';
    btn.style.borderRadius = '3px';
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
 * Show a modal input box overlay.
 */
export function showInputBoxModal(
  parent: HTMLElement,
  options: { prompt?: string; value?: string; placeholder?: string; password?: boolean; validateInput?: (v: string) => string | undefined | Promise<string | undefined> },
): Promise<string | undefined> {
  return new Promise(resolve => {
    const overlay = _createModalOverlay(parent);

    const box = document.createElement('div');
    box.style.backgroundColor = '#252526';
    box.style.borderRadius = '6px';
    box.style.padding = '16px';
    box.style.minWidth = '400px';
    box.style.maxWidth = '500px';
    box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';

    if (options.prompt) {
      const label = document.createElement('div');
      label.textContent = options.prompt;
      label.style.color = '#cccccc';
      label.style.fontSize = '13px';
      label.style.marginBottom = '8px';
      box.appendChild(label);
    }

    const input = document.createElement('input');
    input.type = options.password ? 'password' : 'text';
    input.value = options.value ?? '';
    input.placeholder = options.placeholder ?? '';
    input.style.width = '100%';
    input.style.padding = '6px 8px';
    input.style.fontSize = '13px';
    input.style.backgroundColor = '#3c3c3c';
    input.style.color = '#cccccc';
    input.style.border = '1px solid #474747';
    input.style.borderRadius = '3px';
    input.style.outline = 'none';
    input.style.boxSizing = 'border-box';
    box.appendChild(input);

    const errorLabel = document.createElement('div');
    errorLabel.style.color = '#f14c4c';
    errorLabel.style.fontSize = '12px';
    errorLabel.style.marginTop = '4px';
    errorLabel.style.minHeight = '16px';
    box.appendChild(errorLabel);

    overlay.appendChild(box);

    const cleanup = () => { overlay.remove(); };

    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        cleanup();
        resolve(undefined);
      } else if (e.key === 'Enter') {
        if (options.validateInput) {
          const err = await options.validateInput(input.value);
          if (err) {
            errorLabel.textContent = err;
            return;
          }
        }
        cleanup();
        resolve(input.value);
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        cleanup();
        resolve(undefined);
      }
    });

    requestAnimationFrame(() => input.focus());
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

    const box = document.createElement('div');
    box.style.backgroundColor = '#252526';
    box.style.borderRadius = '6px';
    box.style.minWidth = '400px';
    box.style.maxWidth = '500px';
    box.style.maxHeight = '400px';
    box.style.display = 'flex';
    box.style.flexDirection = 'column';
    box.style.boxShadow = '0 8px 24px rgba(0,0,0,0.6)';
    box.style.overflow = 'hidden';

    // Search input
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = options.placeholder ?? 'Select an item...';
    input.style.width = '100%';
    input.style.padding = '8px 12px';
    input.style.fontSize = '13px';
    input.style.backgroundColor = '#3c3c3c';
    input.style.color = '#cccccc';
    input.style.border = 'none';
    input.style.borderBottom = '1px solid #474747';
    input.style.outline = 'none';
    input.style.boxSizing = 'border-box';
    box.appendChild(input);

    // Items list
    const list = document.createElement('div');
    list.style.overflowY = 'auto';
    list.style.flex = '1';
    list.style.padding = '4px 0';
    box.appendChild(list);

    const selected = new Set<number>();
    let highlightIndex = 0;

    const renderItems = (filter: string) => {
      list.innerHTML = '';
      const lowerFilter = filter.toLowerCase();
      let visibleIndex = 0;

      items.forEach((item, i) => {
        if (lowerFilter && !item.label.toLowerCase().includes(lowerFilter)) return;

        const row = document.createElement('div');
        row.style.padding = '4px 12px';
        row.style.cursor = 'pointer';
        row.style.fontSize = '13px';
        row.style.color = '#cccccc';
        row.dataset.index = String(i);

        if (visibleIndex === highlightIndex) {
          row.style.backgroundColor = '#04395e';
        }

        const labelEl = document.createElement('span');
        labelEl.textContent = item.label;
        row.appendChild(labelEl);

        if (item.description) {
          const desc = document.createElement('span');
          desc.textContent = `  ${item.description}`;
          desc.style.color = '#888888';
          desc.style.fontSize = '12px';
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
        highlightIndex++;
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
  const overlay = document.createElement('div');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.backgroundColor = 'rgba(0,0,0,0.4)';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'flex-start';
  overlay.style.justifyContent = 'center';
  overlay.style.paddingTop = '20vh';
  overlay.style.zIndex = '20000';
  parent.appendChild(overlay);
  return overlay;
}
