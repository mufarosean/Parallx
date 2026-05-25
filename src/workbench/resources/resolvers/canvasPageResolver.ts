// canvasPageResolver.ts — Built-in canvas-page Resource resolver (Slice A8)
//
// Resolves a `CanvasPageResource` to its page record via a minimal
// page-source interface. The resolver does NOT couple to the concrete
// canvas data service — callers supply any object that satisfies
// `CanvasPageSource`, keeping the resolver tier-0 testable and the
// preservation boundary intact.
//
// Pure-additive: not wired into IResourceRegistry yet (wiring happens
// once a canvas-page service is reachable at workbench facade-factory
// time without crossing the preservation line).

import type { CanvasPageResource } from '../resource.js';
import type { ResourceResolver } from '../resourceRegistry.js';

/** Minimum surface required to resolve a canvas page. */
export interface CanvasPageSource {
  /** Returns the canonical page record for `pageId`, or undefined if not found. */
  getPage(pageId: string): Promise<unknown> | unknown;
}

export interface CanvasPageResolveResult {
  readonly resource: CanvasPageResource;
  readonly page: unknown;
}

export class CanvasPageResourceResolver implements ResourceResolver<CanvasPageResource, CanvasPageResolveResult> {
  readonly type = 'canvas-page' as const;

  constructor(private readonly _source: CanvasPageSource) {}

  async resolve(resource: CanvasPageResource): Promise<CanvasPageResolveResult> {
    if (!resource.pageId) {
      throw new Error('[CanvasPageResourceResolver] CanvasPageResource.pageId is empty');
    }
    const page = await Promise.resolve(this._source.getPage(resource.pageId));
    if (page === undefined || page === null) {
      throw new Error(`[CanvasPageResourceResolver] page not found: ${resource.pageId}`);
    }
    return { resource, page };
  }
}

export function canvasPageResourceResolver(source: CanvasPageSource): CanvasPageResourceResolver {
  return new CanvasPageResourceResolver(source);
}
