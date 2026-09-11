/**
 * Tool images whose source has erased them. A browser capture is erased when
 * the tab it came from closes (electron/browserAutomationBroker.cjs), but a
 * turn still running holds its own copy of the bytes: it drops the image
 * before its next model call (openclawAttempt.ts). Ids only, and bounded; the
 * bytes are never kept here.
 */

const MAX_REMEMBERED = 2000;
const gone = new Set<string>();

/** Remember that these images are gone (the browser service, on 'artifacts-cleared'). */
export function markToolImagesGone(ids: Iterable<string>): void {
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue;
    gone.delete(id);
    gone.add(id);
  }
  while (gone.size > MAX_REMEMBERED) {
    const oldest = gone.values().next().value;
    if (oldest === undefined) break;
    gone.delete(oldest);
  }
}

/** Has the image's source erased it? */
export function isToolImageGone(id: string | undefined): boolean {
  return !!id && gone.has(id);
}
