// reloadMerge.ts — keep unsaved edits when another writer reloads the page
//
// An external write (an AI tool, a child page renamed in the sidebar, which
// rewrites the parent's card) reloads every open editor of the page.  The
// user's last keystrokes were still waiting in the save debounce: the
// pending save was then dropped as stale (it was based on the older stored
// doc), and the reload replaced the block with its stored version — the
// keystrokes were gone while the page said Saved (C16).
//
// The editor remembers `base`, the stored doc it last matched.  On reload it
// merges at top-level block granularity, by block id:
//   • a block the user changed or added since base keeps the user's version
//     (after its previous neighbour; first if it was first; at the end when
//     the other writer replaced the neighbour too);
//   • a block the user deleted since base, and the other writer left alone,
//     stays deleted;
//   • everything else comes from the external doc.
// The editor then saves the merge, so the stored page has both.

type BlockJson = { type?: string; attrs?: { id?: unknown } | null; [k: string]: unknown };
type DocJson = { type: string; content?: BlockJson[] };

const idOf = (b: BlockJson | undefined): string | null => {
  const id = b?.attrs?.id;
  return typeof id === 'string' && id ? id : null;
};

export function mergeLocalEdits(base: DocJson, local: DocJson, external: DocJson): { doc: DocJson; changed: boolean } {
  const baseBlocks = base.content ?? [];
  const localBlocks = local.content ?? [];
  const externalBlocks = external.content ?? [];

  const baseById = new Map<string, string>();
  for (const b of baseBlocks) { const id = idOf(b); if (id) baseById.set(id, JSON.stringify(b)); }
  const localIds = new Set(localBlocks.map(idOf).filter((id): id is string => !!id));

  const result: BlockJson[] = [...externalBlocks];
  const indexOfId = (id: string) => result.findIndex((b) => idOf(b) === id);

  // Deletions the user made that the other writer didn't touch.
  for (const [id, json] of baseById) {
    if (localIds.has(id)) continue;
    const at = indexOfId(id);
    if (at >= 0 && JSON.stringify(result[at]) === json) result.splice(at, 1);
  }

  // Blocks the user changed or added: theirs wins, in their position.
  let prevLocalId: string | null = null;
  for (const block of localBlocks) {
    const id = idOf(block);
    if (!id) { prevLocalId = null; continue; }
    const json = JSON.stringify(block);
    const locallyChanged = baseById.get(id) !== json;
    if (locallyChanged) {
      const at = indexOfId(id);
      if (at >= 0) {
        result[at] = block;
      } else if (!prevLocalId) {
        result.unshift(block); // it was first on the page
      } else {
        // After its neighbour; when the other writer replaced that too
        // (an AI rewrite gives every block a new id), at the end.
        const anchor = indexOfId(prevLocalId);
        if (anchor >= 0) result.splice(anchor + 1, 0, block);
        else result.push(block);
      }
    }
    prevLocalId = id;
  }

  const changed = JSON.stringify(result) !== JSON.stringify(externalBlocks);
  return { doc: { ...external, content: result }, changed };
}
