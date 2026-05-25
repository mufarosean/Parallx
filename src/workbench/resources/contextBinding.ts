// contextBinding.ts — Slice B3: IContextService → WorkbenchContextManager
//
// The legacy `WorkbenchContextManager` carries the workbench's structural
// `when`-clause context keys (sidebar visibility, active view, editor
// dirty state, etc). The §86 `IContextService` carries the new unified
// snapshot (`activeSurfaceKind`, `activeResourceType`, …). Before this
// binding existed, the two were ships in the night — IContextService had
// no consumer in product code at all.
//
// This binding subscribes to `IContextService.onDidChangeContext` and
// pushes `activeSurfaceKind` + `activeResourceType` into two new context
// keys on `WorkbenchContextManager`. After this slice, `when` clauses
// like `activeResourceType == 'canvas-page'` light up automatically
// whenever an editor / surface change updates the registry — which now
// happens for real because of Slice B1.

import type { IDisposable } from '../../platform/lifecycle.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import type { IContextService } from '../../services/serviceTypes.js';
import type { WorkbenchContextManager } from '../../context/workbenchContext.js';

export interface IContextBinding extends IDisposable {
  /** Force-push the current snapshot. Useful for tests / late wiring. */
  syncNow(): void;
}

export function bindContextToWorkbenchContextManager(
  contextService: IContextService,
  workbenchContext: WorkbenchContextManager,
): IContextBinding {
  const store = new DisposableStore();

  const push = (): void => {
    const ctx = contextService.getContext();
    workbenchContext.setActiveSurfaceKind(ctx.activeSurfaceKind);
    workbenchContext.setActiveResourceType(ctx.activeResourceType);
    workbenchContext.setActiveWorkspaceId(ctx.workspaceId);
  };

  store.add(contextService.onDidChangeContext(() => push()));
  push();

  return {
    syncNow: push,
    dispose(): void {
      store.dispose();
      // On teardown, clear the keys so stale state doesn't outlive the
      // binding. Matches the symmetry of B1's editor-surface unregister.
      workbenchContext.setActiveSurfaceKind(undefined);
      workbenchContext.setActiveResourceType(undefined);
      workbenchContext.setActiveWorkspaceId(undefined);
    },
  };
}
