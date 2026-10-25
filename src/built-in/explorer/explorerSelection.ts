// explorerSelection.ts — which rows of the file tree are selected, the way
// every file manager does it: a click selects one, Ctrl (Cmd) adds or takes
// away one, Shift selects the run from the anchor to here, Ctrl+A selects
// every visible row. Pure: the tree passes its visible rows in order.

export class ExplorerSelection<N> {
  private readonly _set = new Set<N>();
  /** Where a Shift range starts: the last row chosen without Shift. */
  private _anchor: N | null = null;

  get size(): number { return this._set.size; }
  has(node: N): boolean { return this._set.has(node); }

  /** Just this row. */
  single(node: N): void {
    this._set.clear();
    this._set.add(node);
    this._anchor = node;
  }

  /** Add the row, or take it away; it becomes the anchor either way. */
  toggle(node: N): void {
    if (this._set.has(node) && this._set.size > 1) this._set.delete(node);
    else this._set.add(node);
    this._anchor = node;
  }

  /** Every row from the anchor to `node`, in the order shown. */
  range(node: N, visible: readonly N[]): void {
    const from = this._anchor !== null ? visible.indexOf(this._anchor) : -1;
    const to = visible.indexOf(node);
    if (from < 0 || to < 0) { this.single(node); return; }
    this._set.clear();
    const [a, b] = from <= to ? [from, to] : [to, from];
    for (let i = a; i <= b; i++) this._set.add(visible[i]);
  }

  all(visible: readonly N[]): void {
    this._set.clear();
    for (const n of visible) this._set.add(n);
  }

  /** The selected rows in the order shown; ones no longer shown are dropped. */
  items(visible: readonly N[]): N[] {
    const shown = visible.filter((n) => this._set.has(n));
    if (shown.length !== this._set.size) {
      this._set.clear();
      for (const n of shown) this._set.add(n);
    }
    return shown;
  }

  clear(): void {
    this._set.clear();
    this._anchor = null;
  }
}
