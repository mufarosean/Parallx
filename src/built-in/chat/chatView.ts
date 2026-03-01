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

  // Create the chat widget
  const widget = new ChatWidget(root, provider, services);
  disposables.add(widget);

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
      resizeObserver.disconnect();
      root.remove();
    },
  });

  return disposables;
}
