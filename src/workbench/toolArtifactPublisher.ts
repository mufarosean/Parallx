// toolArtifactPublisher.ts — Helper for storing tool artifacts and getting URIs back (Slice A12)
//
// Tools (extensions, web research, agents) frequently want to:
//   1. Produce some result.
//   2. Make it referenceable by other surfaces (chat, canvas, links).
//   3. Get back a `parallx://tool-artifact:<tool>/<id>` URI.
//
// This helper bundles those three steps against `IToolArtifactStore` and
// `serialize()` from `parallxUri.ts`, so callers don't reinvent the
// pairing. Pure-additive: nothing reads from this yet; it's the
// canonical path for future tool integrations.

import { toolArtifactResource } from './resources/resource.js';
import { serialize } from './resources/parallxUri.js';
import type { IToolArtifactStore, ToolArtifactRecord } from './toolArtifactStore.js';

export interface PublishArtifactInput {
  readonly toolId: string;
  readonly artifactId: string;
  readonly data: unknown;
  readonly mimeType?: string;
  readonly workspaceId?: string;
  /** Override the record timestamp; defaults to `Date.now()`. */
  readonly createdAt?: number;
}

export interface PublishedArtifact {
  readonly uri: string;
  readonly record: ToolArtifactRecord;
}

/**
 * Store a tool artifact and return its canonical `parallx://tool-artifact:...`
 * URI alongside the stored record. Overwrites any existing entry for the same
 * `(toolId, artifactId)` pair (delegates to `IToolArtifactStore.put`).
 */
export function publishToolArtifact(
  store: IToolArtifactStore,
  input: PublishArtifactInput,
): PublishedArtifact {
  if (!input.toolId || !input.artifactId) {
    throw new Error('[publishToolArtifact] toolId and artifactId are required');
  }
  const record: ToolArtifactRecord = {
    toolId: input.toolId,
    artifactId: input.artifactId,
    data: input.data,
    createdAt: input.createdAt ?? Date.now(),
    ...(input.mimeType !== undefined ? { mimeType: input.mimeType } : {}),
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
  };
  store.put(record);
  const resource = toolArtifactResource(
    input.toolId,
    input.artifactId,
    input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : undefined,
  );
  return { uri: serialize(resource), record };
}
