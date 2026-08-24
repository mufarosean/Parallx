// dragTypes.ts — the drag payload vocabulary, in one place
//
// Every draggable citizen announces itself with a MIME type on the
// dataTransfer, and every drop target keys on those types. Parts (the
// structural shells), view containers (Explorer, Chat, an extension's
// sidebar UI) and editor tabs each have one. Chromium hides payload DATA
// during dragover — only the types are readable — so controllers stash the
// dragged identity at dragstart; the payload matters on drop and for
// cross-window drags.

/** A workbench part (sidebar shell, panel shell, …) dragged by its grip. */
export const PART_DRAG_TYPE = 'application/x-parallx-part';

/** A view container — the unit the USER means: Explorer, Chat, Flashcards. */
export const CONTAINER_DRAG_TYPE = 'application/x-parallx-container';

export interface ContainerDragData {
  readonly containerId: string;
}
