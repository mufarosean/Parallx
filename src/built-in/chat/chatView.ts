// chatView.ts — Chat view for the Auxiliary Bar (M9 Task 3.2)
//
// Hosts the ChatWidget in a flex column layout.
// Registered via parallx.views.registerViewProvider('view.chat', ...).
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/browser/chatViewPane.ts

import './chatView.css';
import { DisposableStore } from '../../platform/lifecycle.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import type { OllamaProvider } from './providers/ollamaProvider.js';
import { ChatWidget } from './chatWidget.js';
import type { IChatWidgetServices } from './chatTypes.js';
import { $ } from '../../ui/dom.js';
import { setActiveWidget } from './chatTool.js';

/**
 * Creates the chat view inside the given container.
 * Returns a disposable that tears down the widget.
 */
export function createChatView(
  container: HTMLElement,
  provider: OllamaProvider,
  services: IChatWidgetServices,
): IDisposable {
  const disposables = new DisposableStore();

  // Root element
  const root = $('div.parallx-chat-view');
  container.appendChild(root);

  // Locate the title bar's actions slot so the widget can inject action
  // buttons (new chat, history, clear) directly into the header.
  //
  // Strategy:
  //   1. Stacked-mode view containers wrap each view in a `.view-section`
  //      with a `.view-section-actions` slot — try that first.
  //   2. The auxiliary bar uses tabbed mode (no view-sections). Fall back
  //      to the `.auxiliary-bar-header` and create an actions div there.
  let titleActionsSlot: HTMLElement | null = null;

  const section = container.closest('.view-section');
  if (section) {
    titleActionsSlot = section.querySelector('.view-section-actions') as HTMLElement | null;
    if (titleActionsSlot) {
      titleActionsSlot.style.opacity = '1';
    }
  }

  if (!titleActionsSlot) {
    const auxHeader = container.closest('.part')?.querySelector('.auxiliary-bar-header') as HTMLElement | null;
    if (auxHeader) {
      let slot = auxHeader.querySelector('.parallx-chat-title-actions') as HTMLElement | null;
      if (!slot) {
        slot = document.createElement('div');
        slot.className = 'parallx-chat-title-actions';
        auxHeader.appendChild(slot);
      }
      titleActionsSlot = slot;
    }
  }

  // Create the chat widget
  const widget = new ChatWidget(root, provider, services, titleActionsSlot ?? undefined);
  disposables.add(widget);

  // Register this widget as the active widget for command dispatch
  setActiveWidget(widget);

  // Layout on resize — throttled via rAF to avoid excessive reflows during
  // continuous sash drags that rapidly change the container width.
  let resizeRafId = 0;
  const resizeObserver = new ResizeObserver((entries) => {
    cancelAnimationFrame(resizeRafId);
    resizeRafId = requestAnimationFrame(() => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        widget.layout(width, height);
      }
    });
  });
  resizeObserver.observe(root);

  disposables.add({
    dispose() {
      setActiveWidget(undefined);
      resizeObserver.disconnect();
      root.remove();
    },
  });

  return disposables;
}
