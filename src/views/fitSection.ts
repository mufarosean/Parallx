// fitSection.ts — a stacked section that takes its content's height
//
// A stacked container splits its height equally between its open sections.
// A view whose content is a short list (the open tabs above the file tree)
// marks its element `data-section-fit`; its section then takes the height of
// what it holds, up to a share of the container, and the others share the
// rest. A section the user sized with the sash is not touched here: the
// container uses these heights only while none has been set by hand.

/** The most of the container's body height one fitted section may take. */
const FIT_SHARE = 0.4;

function fitElement(root: HTMLElement | undefined): HTMLElement | null {
  if (!root) return null;
  return root.matches('[data-section-fit]') ? root : root.querySelector<HTMLElement>('[data-section-fit]');
}

/** The height of what a fitted element holds, whatever height it was last given. */
function contentHeight(el: HTMLElement): number {
  let h = 0;
  for (const child of Array.from(el.children) as HTMLElement[]) h += child.offsetHeight;
  const style = getComputedStyle(el);
  return h + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
}

/**
 * Body heights for the open sections `ids` of a stacked container with
 * `available` px for bodies: fitted sections first, the rest in equal parts.
 */
export function splitBodies(ids: readonly string[], available: number, minimum: number, elementOf: (id: string) => HTMLElement | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const fitted = ids.filter((id) => fitElement(elementOf(id)));
  // With nothing to give the rest to, a fitted section is an ordinary one.
  const fit = fitted.length < ids.length ? fitted : [];
  let left = available;
  for (const id of fit) {
    const h = Math.min(Math.ceil(contentHeight(fitElement(elementOf(id))!)), Math.floor(available * FIT_SHARE));
    out.set(id, Math.max(0, h));
    left -= Math.max(0, h);
  }
  const rest = ids.filter((id) => !fit.includes(id));
  const each = rest.length > 0 ? Math.floor(Math.max(0, left) / rest.length) : 0;
  for (const id of rest) out.set(id, Math.max(minimum, each));
  return out;
}

const _watched = new WeakSet<HTMLElement>();

/** Lay the container out again when a fitted view's content changes (a tab opened or closed). */
export function watchFit(root: HTMLElement | undefined, relayout: () => void): void {
  const el = fitElement(root);
  if (!el || _watched.has(el) || typeof MutationObserver === 'undefined') return;
  _watched.add(el);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (el.isConnected) relayout(); });
  }).observe(el, { childList: true, subtree: true });
}
