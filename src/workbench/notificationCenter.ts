// notificationCenter.ts — the notifications panel the activity bar's bell
// opens: what the app and its tools have said this session, newest first,
// split into New (since the panel was last opened) and Earlier, each with
// who said it and when, and dismissable one by one or all at once.
//
// The notification service keeps the history; this keeps when each arrived
// (it listens from boot) and when the panel was last opened, which is what
// "unread" means: the bell's count.

import { Disposable } from '../platform/lifecycle.js';
import { Emitter, type Event } from '../platform/events.js';
import { $, attachPopupDismiss, layoutPopup } from '../ui/dom.js';
import { createButton, createEmptyState, createIconButton, createSectionLabel, createSurface } from '../ui/kit.js';
import { createIconElement } from '../ui/iconRegistry.js';
import { formatRelativeTime } from '../ui/relativeTime.js';
import type { INotification, NotificationService } from '../api/notificationService.js';

const SEVERITY_ICON: Record<string, string> = { information: 'info', warning: 'triangle-alert', error: 'octagon-alert' };

export class NotificationCenter extends Disposable {
  private readonly _arrived = new Map<string, number>();
  private readonly _dismissed = new Set<string>();
  private _lastOpenedAt = 0;
  private _panel: HTMLElement | null = null;
  private _anchor: HTMLElement | null = null;
  private _detach: (() => void) | null = null;

  private readonly _onDidChangeUnread = this._register(new Emitter<number>());
  /** The number of notifications that arrived since the panel was last opened. */
  readonly onDidChangeUnread: Event<number> = this._onDidChangeUnread.event;

  constructor(
    private readonly _service: NotificationService,
    /** A tool's name as the user knows it, from the id a notification carries. */
    private readonly _toolName: (toolId: string) => string | undefined,
  ) {
    super();
    this._register(_service.onDidShowNotification((n) => {
      this._arrived.set(n.id, Date.now());
      this._onDidChangeUnread.fire(this.unread);
      if (this._panel) this._render();
    }));
  }

  get isOpen(): boolean { return !!this._panel; }

  get unread(): number {
    return this._visible().filter((n) => (this._arrived.get(n.id) ?? 0) > this._lastOpenedAt).length;
  }

  private _visible(): readonly INotification[] {
    return this._service.history.filter((n) => !this._dismissed.has(n.id));
  }

  /** Open beside `anchor` (the bell), or close if open. */
  toggle(anchor: HTMLElement | null): void {
    if (this._panel) { this.hide(); return; }
    this._anchor = anchor;
    const panel = $('div.parallx-notification-center');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Notifications');
    panel.tabIndex = -1;
    createSurface(panel, { id: 'notificationCenter', owner: 'core', label: 'Notifications' });
    this._panel = panel;
    document.body.appendChild(panel);
    this._render();
    const at = anchor?.getBoundingClientRect();
    if (at && (at.width || at.height)) layoutPopup(panel, at, { position: 'right-end', gap: 6 });
    else layoutPopup(panel, { x: 56, y: window.innerHeight - panel.offsetHeight - 32 });
    this._detach = attachPopupDismiss(anchor ? [panel, anchor] : [panel], () => this.hide());
    panel.focus();
    anchor?.classList.add('active');
    // Opened is seen: the badge clears now; New stays marked until it closes.
    this._onDidChangeUnread.fire(0);
  }

  hide(): void {
    if (!this._panel) return;
    const hadFocus = this._panel.contains(document.activeElement);
    this._panel.remove();
    this._panel = null;
    this._detach?.();
    this._detach = null;
    // What was new has been seen.
    this._lastOpenedAt = Date.now();
    this._onDidChangeUnread.fire(0);
    this._anchor?.classList.remove('active');
    if (hadFocus) this._anchor?.focus();
  }

  private _render(): void {
    const panel = this._panel;
    if (!panel) return;
    panel.replaceChildren();
    const items = this._visible();

    const header = $('div.parallx-notification-center-header');
    const title = $('span.parallx-notification-center-title');
    title.textContent = 'Notifications';
    header.appendChild(title);
    if (items.length > 0) {
      createButton(header, {
        id: 'notificationCenter.clearAll', label: 'Clear All', kind: 'ghost', size: 'sm', title: 'Clear every notification.',
        onClick: () => { for (const n of items) this._dismissed.add(n.id); this._service.dismissAll(); this._render(); this._onDidChangeUnread.fire(0); },
      });
    }
    panel.appendChild(header);

    const list = $('div.parallx-notification-center-list');
    panel.appendChild(list);
    if (items.length === 0) {
      createEmptyState(list, { icon: 'check-circle', headline: "You're all caught up", hint: 'What the app and your tools tell you shows here.' });
      return;
    }
    let group = '';
    for (const n of items) {
      const arrived = this._arrived.get(n.id);
      const g = (arrived ?? 0) > this._lastOpenedAt ? 'New' : 'Earlier';
      if (g !== group) { group = g; createSectionLabel(list, g).classList.add('parallx-notification-center-group'); }
      list.appendChild(this._renderRow(n, arrived));
    }
  }

  private _renderRow(n: INotification, arrived: number | undefined): HTMLElement {
    const row = $('div.parallx-notification-center-item');
    row.dataset.severity = n.severity;
    const icon = createIconElement(SEVERITY_ICON[n.severity] ?? 'info', 16);
    icon.classList.add('parallx-notification-center-icon');
    row.appendChild(icon);
    const body = $('div.parallx-notification-center-body');
    const msg = $('div.parallx-notification-center-message');
    msg.textContent = n.message;
    const meta = $('div.parallx-notification-center-meta');
    meta.textContent = [n.source ? (this._toolName(n.source) ?? n.source) : 'Parallx', arrived ? formatRelativeTime(arrived, 'long') : null]
      .filter(Boolean).join(' · ');
    body.append(msg, meta);
    row.appendChild(body);
    createIconButton(row, {
      id: `notificationCenter.dismiss.${n.id}`, icon: 'close', size: 'sm', title: 'Dismiss',
      onClick: () => { this._dismissed.add(n.id); this._render(); this._onDidChangeUnread.fire(this.unread); },
    }).classList.add('parallx-notification-center-dismiss');
    return row;
  }

  override dispose(): void {
    this.hide();
    super.dispose();
  }
}
