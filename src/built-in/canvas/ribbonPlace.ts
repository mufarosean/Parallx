// ribbonPlace.ts — which of a page's ribbons goes with which of its panes.
//
// A canvas page open in two editor groups has a pane and a ribbon (in the bar
// under the tabs) in each. The two of one group share the deepest ancestor,
// so the page names no class of the workbench to pair them.

/** Of `candidates`, the one sharing the deepest ancestor with `el`: the ribbon and the pane of one editor group. */
export function nearest(el: HTMLElement, candidates: readonly HTMLElement[]): HTMLElement | undefined {
  const depth = (c: HTMLElement): number => { let a: Node | null = c; while (a && !a.contains(el)) a = a.parentNode; let d = 0; for (let n = a; n; n = n.parentNode) d++; return d; };
  return candidates.reduce<HTMLElement | undefined>((best, c) => (!best || depth(c) > depth(best) ? c : best), undefined);
}

/** The pane a ribbon goes with: the nearest pane, when that pane's nearest bar (of every group's) is this one (else none: its group's pane is still being made). */
export function paneOf(ribbon: HTMLElement, panes: readonly HTMLElement[], ribbons: readonly HTMLElement[]): HTMLElement | undefined {
  const pane = nearest(ribbon, panes);
  return pane && nearest(pane, ribbons) === ribbon ? pane : undefined;
}
