// toolExecutionArtifactBinding.ts — §86 / Slice B8
//
// First production writer for `IToolArtifactStore`. Before this binding
// existed the store had zero writers (only tier-0 tests exercised it),
// so `parallx://tool-artifact:...` URIs could never resolve in product
// code.
//
// Subscribes to `ILanguageModelToolsService.onDidExecuteTool` and
// publishes a `ToolArtifactRecord` for every successful invocation of a
// tool that declared `producesArtifact: true`. The artifact id is
// generated locally (monotonic per binding instance + millisecond
// timestamp) so callers don't need to thread an id through.
//
// Pure-additive on the consumer side: nothing else reads artifacts
// today, but `resourceRegistry.resolveUri('parallx://tool-artifact:...')`
// now works for every published record.

import type { IDisposable } from '../platform/lifecycle.js';
import { DisposableStore } from '../platform/lifecycle.js';
import type { ILanguageModelToolsService, IToolExecutedEvent } from '../services/chatTypes.js';
import type { IToolArtifactStore } from './toolArtifactStore.js';
import { publishToolArtifact } from './toolArtifactPublisher.js';

export interface IToolExecutionArtifactBinding extends IDisposable {
  /** For tests: total number of artifacts this binding has published. */
  readonly publishedCount: number;
}

export interface BindToolExecutionOptions {
  /** Override the artifact-id generator (tests). */
  readonly generateArtifactId?: (event: IToolExecutedEvent, seq: number) => string;
  /** Override the active workspace id supplier. */
  readonly workspaceId?: () => string | undefined;
}

function defaultArtifactId(_event: IToolExecutedEvent, seq: number): string {
  // Tool name is already namespaced inside the parallx:// URI, so the id
  // only needs to disambiguate per-tool. Use a millisecond-aligned
  // monotonic suffix.
  return `${Date.now().toString(36)}-${seq.toString(36)}`;
}

/**
 * Bind an `ILanguageModelToolsService` to an `IToolArtifactStore` so that
 * every successful invocation of an artifact-producing tool is published
 * to the store and becomes referenceable via a canonical
 * `parallx://tool-artifact:<tool>/<id>` URI.
 */
export function bindToolExecutionToArtifactStore(
  toolsService: ILanguageModelToolsService,
  store: IToolArtifactStore,
  opts?: BindToolExecutionOptions,
): IToolExecutionArtifactBinding {
  const store_ = new DisposableStore();
  let published = 0;
  let seq = 0;
  const genId = opts?.generateArtifactId ?? defaultArtifactId;

  store_.add(toolsService.onDidExecuteTool((event) => {
    if (event.result.isError) return;
    seq += 1;
    let artifactId: string;
    try {
      artifactId = genId(event, seq);
    } catch {
      return;
    }
    try {
      publishToolArtifact(store, {
        toolId: event.toolName,
        artifactId,
        data: event.result.content,
        mimeType: 'text/plain',
        workspaceId: opts?.workspaceId?.(),
      });
      published += 1;
    } catch {
      // Store writes are best-effort. Never throw from a subscriber.
    }
  }));

  return {
    get publishedCount() { return published; },
    dispose(): void {
      store_.dispose();
    },
  };
}
