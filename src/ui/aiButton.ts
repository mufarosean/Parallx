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
  /**
   * Mark only, no text — for hover overlays and other places a label would
   * crowd the content. `label` still becomes the accessible name, so this
   * stays the ONE AI affordance rather than each surface hand-rolling a
   * bare icon and drifting from the brand mark.
   */
  readonly iconOnly?: boolean;
  readonly ariaLabel?: string;
  readonly title?: string;
}

export function createAiButton(container: HTMLElement, options: AiButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = ['px-ai-btn',
    options.compact ? 'px-ai-btn--compact' : '',
    options.iconOnly ? 'px-ai-btn--icon' : ''].filter(Boolean).join(' ');
  // An icon-only button has no text node, so it has no accessible name unless
  // one is supplied — fall back to the label rather than shipping a nameless
  // control to a screen reader.
  const accessibleName = options.ariaLabel ?? (options.iconOnly ? options.label : undefined);
  if (accessibleName) btn.setAttribute('aria-label', accessibleName);
  btn.title = options.title ?? (options.iconOnly ? options.label : '');

  const icon = document.createElement('span');
  icon.className = 'px-ai-btn__icon';
  icon.innerHTML = getIcon('px-ai-mark');
  btn.appendChild(icon);

  if (!options.iconOnly) {
    const label = document.createElement('span');
    label.className = 'px-ai-btn__label';
    label.textContent = options.label;
    btn.appendChild(label);
  }

  container.appendChild(btn);
  return btn;
}
