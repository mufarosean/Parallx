// panelSurface.ts — shared builders for the bottom-panel tool surfaces.
//
// One toolbar-button + empty-state language across Terminal (Console), Output,
// Indexing, AI Diagnostics, and Autonomy Log. See panelSurface.css for the
// visual language; this module keeps the DOM those tools build consistent.
//
// Dependency rules: src/ui/ depends only on src/platform/ and sibling ui/.

import './panelSurface.css';
import { getIcon } from './iconRegistry.js';

export interface PanelToolbarButtonOptions {
  /** Icon registry id (Lucide). Omitted/unknown → text-only button. */
  readonly icon?: string;
  /** Tooltip / accessible label. */
  readonly title: string;
  /** Optional visible text after the icon. */
  readonly label?: string;
  readonly onClick: () => void;
}

/** A quiet, square icon button for a panel toolbar (`.px-panel-toolbar-btn`). */
export function createPanelToolbarButton(opts: PanelToolbarButtonOptions): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'px-panel-toolbar-btn';
  btn.title = opts.title;
  btn.setAttribute('aria-label', opts.title);

  const svg = opts.icon ? getIcon(opts.icon) : '';
  if (svg) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'px-panel-toolbar-btn-icon';
    iconSpan.innerHTML = svg;
    btn.appendChild(iconSpan);
  }
  if (opts.label) {
    const text = document.createElement('span');
    text.textContent = opts.label;
    btn.appendChild(text);
  }

  btn.addEventListener('click', opts.onClick);
  return btn;
}

export interface PanelEmptyStateOptions {
  /** Icon registry id (Lucide). Omitted/unknown → no icon. */
  readonly icon?: string;
  readonly title: string;
  /** Secondary line — what to do to fill the panel. */
  readonly hint?: string;
}

/**
 * A centered empty state (`.px-panel-empty`) meant to overlay a
 * `.px-panel-body`. Toggle it with `hidden` (or add/remove it) as the panel's
 * content appears.
 */
export function createPanelEmptyState(opts: PanelEmptyStateOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'px-panel-empty';

  const svg = opts.icon ? getIcon(opts.icon) : '';
  if (svg) {
    const icon = document.createElement('div');
    icon.className = 'px-panel-empty-icon';
    icon.innerHTML = svg;
    wrap.appendChild(icon);
  }

  const title = document.createElement('div');
  title.className = 'px-panel-empty-title';
  title.textContent = opts.title;
  wrap.appendChild(title);

  if (opts.hint) {
    const hint = document.createElement('div');
    hint.className = 'px-panel-empty-hint';
    hint.textContent = opts.hint;
    wrap.appendChild(hint);
  }

  return wrap;
}
