// legacyContainerIds.ts — container ids saved before Explorer and Search were
// contributed containers, and what they are now.

/**
 * Pre-4a persisted state (rail assignments, floating-box leaves) addressed
 * the builtin Explorer/Search containers by their VIEW ids. Those containers
 * are now contributed under their manifest ids; saved placements written
 * before the cut resolve through this map so a floated or moved Explorer
 * lands where the user left it instead of waiting on an id nothing creates.
 */
const LEGACY_CONTAINER_IDS: Readonly<Record<string, string>> = {
  'view.explorer': 'explorer-container',
  'view.search': 'search-container',
};

export function resolveLegacyContainerId(id: string): string {
  return LEGACY_CONTAINER_IDS[id] ?? id;
}
