// paneMirror.ts — editors showing the same page stay the same document
//
// The same page can be open in two editor panes (a split) — or in a pane and
// an embedded editor.  Each used to be its own document: pane A's edits never
// reached pane B, and whichever saved last wrote its stale doc over the
// other's edits (C5).  Every local change is now forwarded to the other
// editors of the page, which apply it history-free without saving it again,
// so all of them hold one document.

export interface PaneMirrorTarget {
  readonly mirrorPageId: string | null;
  /** Apply a doc another editor of the same page just produced. */
  applyMirroredDoc(docJson: unknown): void;
}

const _targets = new Map<string, Set<PaneMirrorTarget>>();

/** Join the editors of `pageId`; returns the leave function. */
export function joinPaneMirror(pageId: string, target: PaneMirrorTarget): () => void {
  let set = _targets.get(pageId);
  if (!set) { set = new Set(); _targets.set(pageId, set); }
  set.add(target);
  return () => {
    const s = _targets.get(pageId);
    if (!s) return;
    s.delete(target);
    if (s.size === 0) _targets.delete(pageId);
  };
}

/** Forward `source`'s doc to every other editor of its page. */
export function broadcastPaneDoc(source: PaneMirrorTarget, docJson: unknown): void {
  const pageId = source.mirrorPageId;
  if (!pageId) return;
  const set = _targets.get(pageId);
  if (!set || set.size < 2) return;
  for (const target of [...set]) {
    if (target === source) continue;
    try {
      target.applyMirroredDoc(docJson);
    } catch (err) {
      console.warn('[paneMirror] could not mirror an edit into another editor of the page:', err);
    }
  }
}

/** For tests: how many editors are joined for a page. */
export function paneMirrorSize(pageId: string): number {
  return _targets.get(pageId)?.size ?? 0;
}
