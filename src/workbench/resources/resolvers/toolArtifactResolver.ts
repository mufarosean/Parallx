// toolArtifactResolver.ts — Built-in tool-artifact Resource resolver (Slice A9)
//
// Resolves a `ToolArtifactResource` to its artifact record via a minimal
// artifact-source interface. Tool artifacts are produced by extensions
// and the AI runtime — the resolver takes any object satisfying
// `ToolArtifactSource`, keeping the resolver tier-0 testable and the
// off-limits boundary intact.
//
// Pure-additive: not wired into IResourceRegistry yet.

import type { ToolArtifactResource } from '../resource.js';
import type { ResourceResolver } from '../resourceRegistry.js';

/** Minimum surface required to resolve a tool artifact. */
export interface ToolArtifactSource {
  /** Returns the canonical artifact record for `(toolId, artifactId)`, or undefined if not found. */
  getArtifact(toolId: string, artifactId: string): Promise<unknown> | unknown;
}

export interface ToolArtifactResolveResult {
  readonly resource: ToolArtifactResource;
  readonly artifact: unknown;
}

export class ToolArtifactResourceResolver implements ResourceResolver<ToolArtifactResource, ToolArtifactResolveResult> {
  readonly type = 'tool-artifact' as const;

  constructor(private readonly _source: ToolArtifactSource) {}

  async resolve(resource: ToolArtifactResource): Promise<ToolArtifactResolveResult> {
    if (!resource.toolId || !resource.artifactId) {
      throw new Error('[ToolArtifactResourceResolver] toolId or artifactId is empty');
    }
    const artifact = await Promise.resolve(this._source.getArtifact(resource.toolId, resource.artifactId));
    if (artifact === undefined || artifact === null) {
      throw new Error(`[ToolArtifactResourceResolver] artifact not found: ${resource.toolId}/${resource.artifactId}`);
    }
    return { resource, artifact };
  }
}

export function toolArtifactResourceResolver(source: ToolArtifactSource): ToolArtifactResourceResolver {
  return new ToolArtifactResourceResolver(source);
}
