// aiButton.ts — THE AI button.
//
// One affordance for "the assistant acts here", everywhere: the brand mark
// (px-ai-mark) in an accent-soft pill. Surfaces stop inventing their own
// AI buttons and icons; when the logo changes, every AI button follows,
// because the mark is one registry entry.
//
// Usage:
//   const btn = createAiButton(container, { label: 'Discuss with AI' });
//   btn.addEventListener('click', …);

import { getIcon } from './iconRegistry.js';

export interface AiButtonOptions {
  readonly label: string;
  /** Compact variant for dense rows (24px instead of 28px). */
  readonly compact?: boolean;
  readonly ariaLabel?: string;
  readonly title?: string;
}

export function createAiButton(container: HTMLElement, options: AiButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = options.compact ? 'px-ai-btn px-ai-btn--compact' : 'px-ai-btn';
  if (options.ariaLabel) btn.setAttribute('aria-label', options.ariaLabel);
  if (options.title) btn.title = options.title;

  const icon = document.createElement('span');
  icon.className = 'px-ai-btn__icon';
  icon.innerHTML = getIcon('px-ai-mark');
  btn.appendChild(icon);

  const label = document.createElement('span');
  label.className = 'px-ai-btn__label';
  label.textContent = options.label;
  btn.appendChild(label);

  container.appendChild(btn);
  return btn;
}
