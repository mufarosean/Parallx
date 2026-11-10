// block.ts — the kit's layout and text element (re-exported by kit.ts): the
// one way a tool makes the elements around its controls.

/** Elements that are never controls: layout, text, pictures. A button, link or field comes from its own kit function. */
const BLOCK_TAGS = new Set(['div', 'span', 'p', 'section', 'header', 'footer', 'figure', 'figcaption', 'ul', 'ol', 'li', 'img', 'canvas', 'strong', 'em', 'small',
  // A table's structure is layout too: its cells hold the controls, they are not controls.
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption']);

export interface IKitBlockOptions {
  readonly className?: string;
  readonly text?: string;
  /** Plain attributes (role, aria-*, alt, src, data-*); never an event handler. */
  readonly attrs?: Readonly<Record<string, string>>;
}

/**
 * A layout or text element: the one way a tool makes the elements around its
 * controls (docs/SELF_DESCRIBING_UI_DESIGN.md: not a control, never declared).
 * Refuses a tag that would be a control, and on* attributes.
 */
export function createBlock(container: HTMLElement | null | undefined, tag: string, options: IKitBlockOptions = {}): HTMLElement {
  const t = String(tag).toLowerCase();
  if (!BLOCK_TAGS.has(t)) throw new Error(`createBlock makes layout and text only, not <${t}>: use the kit's control for it.`);
  const e = document.createElement(t);
  if (options.className) e.className = options.className;
  if (options.text != null) e.textContent = options.text;
  for (const [k, v] of Object.entries(options.attrs ?? {})) {
    if (/^on/i.test(k)) throw new Error(`createBlock does not set event handlers (${k}).`);
    e.setAttribute(k, v);
  }
  if (container) container.appendChild(e);
  return e;
}
