// toolFacts.ts — what the gallery reads off a tool's manifest: its icon, and what it adds.

import { getIcon, hasIcon } from '../../ui/iconRegistry.js';
import type { ToolContributions } from './main.js';

/** Built-in tool icon — package/cube. */
const SVG_ICON_BUILTIN = getIcon('package')!;

/** External tool icon — plug connector. */
const SVG_ICON_EXTERNAL = getIcon('plug')!;


/** A tool's own icon: the one it shows in the activity bar, else the generic mark. */
export function toolIconSvg(tool: { isBuiltin: boolean; contributes?: ToolContributions }): string {
  const c = tool.contributes ?? {};
  const ids = [...(c.viewContainers ?? []).map((v) => v.icon), ...(c.views ?? []).map((v) => v.icon)];
  for (const id of ids) {
    if (!id) continue;
    if (hasIcon(id)) return getIcon(id);
    // A tool that is off has not registered its own icons; its manifest
    // still carries the drawing.
    const own = c.icons?.find((i) => i.id === id);
    if (own) return own.svg;
  }
  return tool.isBuiltin ? SVG_ICON_BUILTIN : SVG_ICON_EXTERNAL;
}

/** What a tool adds, counted from its manifest: "36 commands · 2 views · 4 settings". */
export function whatItAdds(tool: { contributes?: ToolContributions }): string {
  const c = tool.contributes ?? {};
  const settings = (c.configuration ?? []).reduce((n, g) => n + Object.keys(g.properties ?? {}).length, 0);
  const part = (n: number, one: string) => (n ? `${n} ${one}${n === 1 ? '' : 's'}` : '');
  return [part(c.commands?.length ?? 0, 'command'), part(c.views?.length ?? 0, 'view'), part(settings, 'setting')].filter(Boolean).join(' · ');
}
