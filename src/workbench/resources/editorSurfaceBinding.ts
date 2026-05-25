// editorSurfaceBinding.ts — Slice B1: Editor adopts ISurfaceRegistry
//
// First real-product writer for ISurfaceRegistry. Before this binding
// existed the registry had zero writers in product code (only tier-0
// tests exercised it), so `activeKind()`, `activeResource()`, and
// `WorkbenchContext.activeResourceType` (Iter 65 / Slice A64) were
// permanently `undefined`.
//
// Contract (§16):
//
//   * For every open editor (`IEditorService.getOpenEditors()`) the
//     registry holds exactly one Surface with `kind: 'editor'` and
//     id `editor:<input.id>`.
//   * When the active editor changes, the active surface follows it.
//   * Closing an editor unregisters its surface.
//   * When the workspace changes, the surfaces re-target the new
//     workspaceId (the binding does not survive a workspace switch —
//     callers should dispose it and re-bind, but until then no stale
//     workspaceId leaks: we read `workspaceService.activeWorkspace`
//     on every active-change tick).
//
// The binding makes no assumptions about editor input internals beyond
// `IEditorInput.id`, `.name`, and the optional `.uri`. File-backed
// inputs get a `FileResource`; everything else gets `resource:
// undefined`, which is still a fully-valid Surface (kind/displayName
// suffice for `activeKind()` consumers).

import type { IDisposable } from '../../platform/lifecycle.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import type { IEditorService } from '../../services/serviceTypes.js';
import type { IWorkspaceService } from '../../services/serviceTypes.js';
import type { ISurfaceRegistry } from '../../services/serviceTypes.js';
import { fileResource } from './resource.js';
import type { Resource } from './resource.js';
import { parse as parseParallxUri } from './parallxUri.js';
import { surface, type Surface } from './surface.js';

export interface IEditorSurfaceBinding extends IDisposable {
  /** For tests: set of currently-registered surface ids. */
  readonly registeredIds: ReadonlyArray<string>;
}

const SURFACE_ID_PREFIX = 'editor:';

function surfaceIdFor(inputId: string): string {
  return `${SURFACE_ID_PREFIX}${inputId}`;
}

function buildEditorSurface(
  inputId: string,
  displayName: string,
  uri: { scheme: string; fsPath: string; toString(): string } | undefined,
  workspaceId: string | undefined,
): Surface {
  const resource = resolveResourceFromUri(uri, workspaceId);
  return surface(surfaceIdFor(inputId), 'editor', displayName, resource);
}

function resolveResourceFromUri(
  uri: { scheme: string; fsPath: string; toString(): string } | undefined,
  workspaceId: string | undefined,
): Resource | undefined {
  if (!uri) return undefined;
  // File URIs: produce a FileResource directly. Cheaper than round-tripping
  // through parallxUri and avoids any percent-encoding surprises in fsPath.
  if (uri.scheme === 'file') {
    return fileResource(uri.fsPath, workspaceId ? { workspaceId } : undefined);
  }
  // parallx:// (or the legacy `canvas:` alias) URIs: parse to a typed
  // Resource (canvas-page / chat-session / tool-artifact / file). This
  // lets canvas-page editor inputs surface a CanvasPageResource even though
  // the binding has no canvas-specific knowledge of its own.
  const uriString = safeUriToString(uri);
  if (!uriString) return undefined;
  const parsed = parseParallxUri(uriString);
  if (!parsed) return undefined;
  // External resources (http(s), mailto, etc.) are technically Resources but
  // they don't carry a workspaceId and don't model editor content. Drop them
  // so consumers don't see misleading active-resource state.
  if (parsed.type === 'external') return undefined;
  // Stamp the active workspace id on the resource if it doesn't already
  // carry one. The parser only sets workspaceId when it's encoded in the
  // URI's `workspace` query — most editor inputs won't include that.
  if (workspaceId && !('workspaceId' in parsed && parsed.workspaceId)) {
    return { ...parsed, workspaceId } as Resource;
  }
  return parsed;
}

function safeUriToString(uri: { toString(): string }): string | undefined {
  try {
    return uri.toString();
  } catch {
    return undefined;
  }
}

/**
 * Bind an `IEditorService` to an `ISurfaceRegistry`. Returns a disposable
 * that unregisters every editor surface it created. Idempotent against
 * its own teardown.
 */
export function bindEditorToSurfaceRegistry(
  editorService: IEditorService,
  workspaceService: IWorkspaceService,
  surfaceRegistry: ISurfaceRegistry,
): IEditorSurfaceBinding {
  const store = new DisposableStore();
  const registered = new Set<string>();

  const workspaceId = (): string | undefined =>
    workspaceService.activeWorkspace?.identity.id;

  const syncOpenEditors = (): void => {
    const open = editorService.getOpenEditors();
    const liveIds = new Set(open.map(d => surfaceIdFor(d.id)));
    // Drop surfaces whose editor has closed.
    for (const id of Array.from(registered)) {
      if (!liveIds.has(id)) {
        surfaceRegistry.unregister(id);
        registered.delete(id);
      }
    }
  };

  const syncActiveEditor = (): void => {
    const active = editorService.activeEditor;
    if (!active) {
      surfaceRegistry.setActive(undefined);
      return;
    }
    const id = surfaceIdFor(active.id);
    const next = buildEditorSurface(active.id, active.name, active.uri, workspaceId());
    if (registered.has(id)) {
      surfaceRegistry.update(next);
    } else {
      surfaceRegistry.register(next);
      registered.add(id);
    }
    surfaceRegistry.setActive(id);
  };

  store.add(editorService.onDidChangeOpenEditors(() => {
    syncOpenEditors();
    // Active editor's display name may have changed (label/dirty).
    if (editorService.activeEditor) syncActiveEditor();
  }));

  store.add(editorService.onDidActiveEditorChange(() => {
    syncActiveEditor();
  }));

  // Seed initial state.
  syncOpenEditors();
  syncActiveEditor();

  return {
    get registeredIds() { return Array.from(registered); },
    dispose(): void {
      store.dispose();
      // Unregister anything we still own. Surface unregister fires an
      // 'active' undefined event first if we were active, which is the
      // contract callers expect on teardown.
      for (const id of Array.from(registered)) {
        surfaceRegistry.unregister(id);
      }
      registered.clear();
    },
  };
}
