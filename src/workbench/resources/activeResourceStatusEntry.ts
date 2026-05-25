// activeResourceStatusEntry.ts — Slice B4
//
// First UI consumer of `IContextService` snapshots. Adds a right-aligned
// status-bar entry that shows the active resource type ("file", "canvas-page",
// "chat-session", "tool-artifact", "external"). Hidden when there is no
// active surface or no resource on the active surface.
//
// This is a pure reader: no API changes, no writes. It exercises the full
// B1→B3 chain end-to-end:
//   editor open  → ISurfaceRegistry.register
//                → ContextService snapshot updates
//                → status-bar entry text flips
//
// Independent module so the status-bar entry can be retired or repurposed
// without touching StatusBarController or workbench.ts beyond a single
// registration site.

import type { IDisposable } from '../../platform/lifecycle.js';
import { DisposableStore } from '../../platform/lifecycle.js';
import type { IContextService } from '../../services/serviceTypes.js';
import type { StatusBarPart } from '../../parts/statusBarPart.js';
import { StatusBarAlignment } from '../../parts/statusBarPart.js';

const ENTRY_ID = 'status.activeResourceType';

function formatLabel(type: string | undefined): string {
  if (!type) return '';
  switch (type) {
    case 'file': return 'File';
    case 'canvas-page': return 'Canvas';
    case 'chat-session': return 'Chat';
    case 'tool-artifact': return 'Artifact';
    case 'external': return 'External';
    default: return type;
  }
}

function formatTooltip(type: string | undefined, kind: string | undefined): string {
  if (!type && !kind) return 'No active resource';
  if (!type) return `Active surface: ${kind ?? 'unknown'}`;
  return `Active resource: ${type}${kind ? ` (on ${kind})` : ''}`;
}

export interface IActiveResourceStatusEntry extends IDisposable {
  /** Force a re-read of the context snapshot. */
  syncNow(): void;
}

export function bindActiveResourceStatusEntry(
  statusBar: StatusBarPart,
  contextService: IContextService,
): IActiveResourceStatusEntry {
  const store = new DisposableStore();

  const accessor = statusBar.addEntry({
    id: ENTRY_ID,
    text: '',
    alignment: StatusBarAlignment.Right,
    priority: 50,
    tooltip: 'No active resource',
    name: 'Active Resource',
  });

  const push = (): void => {
    const ctx = contextService.getContext();
    accessor.update({
      text: formatLabel(ctx.activeResourceType),
      tooltip: formatTooltip(ctx.activeResourceType, ctx.activeSurfaceKind),
    });
  };

  store.add(contextService.onDidChangeContext(() => push()));
  push();

  return {
    syncNow: push,
    dispose(): void {
      store.dispose();
      accessor.dispose();
    },
  };
}
