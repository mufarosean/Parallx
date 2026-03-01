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
import type { IChatWidgetServices } from './chatWidget.js';
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

  // Locate the view section header's actions slot so the widget can inject
  // action buttons directly into the title bar (VS Code parity).
  const section = container.closest('.view-section');
  const titleActionsSlot = section?.querySelector('.view-section-actions') as HTMLElement | null;

  // Make the actions always visible for the chat view (override opacity:0 default)
  if (titleActionsSlot) {
    titleActionsSlot.style.opacity = '1';
  }

  // Create the chat widget
  const widget = new ChatWidget(root, provider, services, titleActionsSlot ?? undefined);
  disposables.add(widget);

  // Register this widget as the active widget for command dispatch
  setActiveWidget(widget);

  // Layout on resize
  const resizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      widget.layout(width, height);
    }
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
