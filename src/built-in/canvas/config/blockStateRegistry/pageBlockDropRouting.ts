// pageBlockDropRouting.ts — Shared routing for pageBlock drop gestures
//
// The pageBlock node and the general column drop engine both need the same
// answer: is the pointer in the page card interior (cross-page drop) or on an
// edge strip (standard block drop behavior)?  Keep that decision in one place
// so the thresholds cannot drift.

export interface PageBlockDropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface PageBlockDropThresholds {
  readonly horizontalEdge: number;
  readonly verticalEdge: number;
}

export function getPageBlockDropThresholds(rect: PageBlockDropRect): PageBlockDropThresholds {
  return {
    horizontalEdge: rect.width >= 150 ? 50 : Math.max(16, rect.width * 0.2),
    verticalEdge: Math.max(8, rect.height * 0.25),
  };
}

export function classifyPageBlockDropZone(
  rect: PageBlockDropRect,
  clientX: number,
  clientY: number,
): 'edge' | 'interior' {
  const { horizontalEdge, verticalEdge } = getPageBlockDropThresholds(rect);
  const rx = clientX - rect.left;
  const ry = clientY - rect.top;
  const isOnEdge = rx < horizontalEdge
    || rx > rect.width - horizontalEdge
    || ry < verticalEdge
    || ry > rect.height - verticalEdge;
  return isOnEdge ? 'edge' : 'interior';
}
