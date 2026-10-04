// iconContribution.ts — processes contributes.icons
//
// A tool that can be turned off brings its own icons (its activity-bar mark,
// say) instead of the core shipping them: each `{ id, svg }` is registered in
// the icon registry while the tool's contributions are live and removed with
// them. A tool cannot replace an icon the app (or another tool) already has.

import type { IToolDescription } from '../tools/toolManifest.js';
import { hasIcon, registerIcon, unregisterIcon } from '../ui/iconRegistry.js';

export class IconContributionProcessor {
  /** Tool ID → icon ids it registered. */
  private readonly _toolIcons = new Map<string, string[]>();

  processContributions(description: IToolDescription): void {
    const toolId = description.manifest.id;
    this.removeContributions(toolId);
    const icons = description.manifest.contributes?.icons;
    if (!icons?.length) return;
    const ids: string[] = [];
    for (const { id, svg } of icons) {
      if (hasIcon(id)) {
        console.warn(`[IconContribution] Icon "${id}" from tool "${toolId}" already exists — skipping.`);
        continue;
      }
      registerIcon(id, svg);
      ids.push(id);
    }
    if (ids.length) this._toolIcons.set(toolId, ids);
  }

  removeContributions(toolId: string): void {
    const ids = this._toolIcons.get(toolId);
    if (!ids) return;
    for (const id of ids) unregisterIcon(id);
    this._toolIcons.delete(toolId);
  }
}
