// toolTabIcons.ts — the icon a tool's tabs carry when the editor brings none
//
// A tab shows its editor's own icon (a page's, a sheet's) or its file type's.
// An editor with neither (a tool's home, a session, a board) takes the icon
// of the tool that opened it: the one on the tool's row in the column. The
// workbench records that icon here as each tool's container arrives and
// forgets it when the container goes; nothing here names a tool.

import { Emitter, type Event } from '../platform/events.js';

const _byContainer = new Map<string, { toolId: string; iconHtml: string }>();
const _onDidChange = new Emitter<void>();

/** Fires when a tool's icon arrives or goes, so open tabs can redraw. */
export const onDidChangeToolTabIcons: Event<void> = _onDidChange.event;

/** Record the icon of one of a tool's containers. */
export function setToolTabIcon(containerId: string, toolId: string, iconHtml: string): void {
  const had = _byContainer.get(containerId);
  if (had?.toolId === toolId && had.iconHtml === iconHtml) return;
  _byContainer.set(containerId, { toolId, iconHtml });
  _onDidChange.fire();
}

/** The container is gone (its tool was turned off, or the workspace changed). */
export function removeToolTabIcon(containerId: string): void {
  if (_byContainer.delete(containerId)) _onDidChange.fire();
}

export function clearToolTabIcons(): void {
  if (_byContainer.size === 0) return;
  _byContainer.clear();
  _onDidChange.fire();
}

/** The icon for a tool's tabs: its first container's, or none. */
export function toolTabIcon(toolId: string | undefined): string | undefined {
  if (!toolId) return undefined;
  for (const entry of _byContainer.values()) if (entry.toolId === toolId) return entry.iconHtml;
  return undefined;
}
