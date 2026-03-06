// chatWidgetService.ts — IChatWidgetService implementation (M9 Task 2.4)
//
// Tracks active chat widget instances. M9.0 has only one widget
// (Auxiliary Bar chat), but the service supports multiple for future expansion.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chat.ts

import { Disposable, toDisposable } from '../platform/lifecycle.js';
import { Emitter } from '../platform/events.js';
import type { IDisposable } from '../platform/lifecycle.js';
import type { Event } from '../platform/events.js';
import type {
  IChatWidgetService,
  IChatWidgetDescriptor,
} from './chatTypes.js';

/**
 * Chat widget service — simple registry of active chat widget instances.
 */
export class ChatWidgetService extends Disposable implements IChatWidgetService {

  private readonly _widgets = new Map<string, IChatWidgetDescriptor>();

  // ── Events ──

  private readonly _onDidAddWidget = this._register(new Emitter<IChatWidgetDescriptor>());
  readonly onDidAddWidget: Event<IChatWidgetDescriptor> = this._onDidAddWidget.event;

  private readonly _onDidRemoveWidget = this._register(new Emitter<string>());
  readonly onDidRemoveWidget: Event<string> = this._onDidRemoveWidget.event;

  // ── Registration ──

  registerWidget(widget: IChatWidgetDescriptor): IDisposable {
    this._widgets.set(widget.id, widget);
    this._onDidAddWidget.fire(widget);

    return toDisposable(() => {
      this._widgets.delete(widget.id);
      this._onDidRemoveWidget.fire(widget.id);
    });
  }

  // ── Lookup ──

  getWidget(sessionId: string): IChatWidgetDescriptor | undefined {
    for (const widget of this._widgets.values()) {
      if (widget.sessionId === sessionId) {
        return widget;
      }
    }
    return undefined;
  }

  getWidgets(): readonly IChatWidgetDescriptor[] {
    return [...this._widgets.values()];
  }
}
