// link.ts — a link control for the kit: a URL, an email or a phone number
// shown as what it is. The external-links guard (externalLinks.ts) routes a
// `_blank` link to the browser; a mailto: or tel: goes to the system.

import { declareControl, type IKitControlDeclaration } from './kit.js';

export interface IKitLinkOptions extends IKitControlDeclaration {
  readonly id: string | null;
  readonly href: string;
  readonly label: string;
  readonly title?: string;
  /** Extra class names on the anchor (a cell's link, a card's source). */
  readonly className?: string;
  /** Opens outside the app (the default): `target=_blank`, which the external-links guard routes to the browser. */
  readonly external?: boolean;
  readonly onClick?: (e: MouseEvent) => void;
}

/** A link. With an id it is in the scene as a button. */
export function createLink(container: HTMLElement | null | undefined, options: IKitLinkOptions): HTMLAnchorElement {
  const a = document.createElement('a');
  a.className = `px-link${options.className ? ` ${options.className}` : ''}`;
  a.href = options.href;
  a.textContent = options.label;
  if (options.title) a.title = options.title;
  if (options.external !== false) { a.target = '_blank'; a.rel = 'noopener'; }
  if (options.onClick) a.addEventListener('click', options.onClick);
  if (container) container.appendChild(a);
  if (options.id) declareControl(a, { id: options.id, label: options.label, kind: 'button' });
  return a;
}
