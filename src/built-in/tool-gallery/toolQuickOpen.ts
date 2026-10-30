// toolQuickOpen.ts — Ctrl+P finds tools.
//
// The Tools page registers a Quick Open source listing every installed tool,
// on or off: choosing one opens its page. A tool that can be turned off also
// gets a row that does it ("Disable Browser", "Enable Planner"), worded as
// the Tools page's own button. The list comes from the tool registry when
// Quick Open asks, so it names no tool.

import { registerQuickOpenSource, type QuickOpenSourceItem } from '../../services/quickOpenSources.js';
import type { IDisposable } from '../../platform/lifecycle.js';

export interface QuickOpenTool {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export interface ToolQuickOpenHost {
  getAll(): readonly QuickOpenTool[];
  isEnabled(toolId: string): boolean;
  canChangeEnablement(toolId: string): boolean;
  setEnabled(toolId: string, enabled: boolean): Promise<void>;
  /** Open the tool's page on the Tools editor. */
  openPage(tool: QuickOpenTool): void;
}

/** A row per tool (opens its page), then a row per tool that can be switched. */
export function toolQuickOpenItems(host: ToolQuickOpenHost): QuickOpenSourceItem[] {
  const tools = [...host.getAll()].sort((a, b) => a.name.localeCompare(b.name));
  const pages: QuickOpenSourceItem[] = tools.map((tool) => {
    const on = host.isEnabled(tool.id);
    return {
      id: `page:${tool.id}`,
      label: tool.name,
      detail: !host.canChangeEnablement(tool.id) ? 'Always on' : on ? 'On' : 'Off',
      keywords: `${tool.id} ${tool.description}`,
      open: () => host.openPage(tool),
    };
  });
  const switches: QuickOpenSourceItem[] = tools
    .filter((tool) => host.canChangeEnablement(tool.id))
    .map((tool) => {
      const on = host.isEnabled(tool.id);
      return {
        id: `toggle:${tool.id}`,
        label: `${on ? 'Disable' : 'Enable'} ${tool.name}`,
        detail: on ? 'Turns it off; its data is kept' : 'Turns it on',
        keywords: `turn ${on ? 'off' : 'on'} ${tool.name} ${tool.id}`,
        open: () => {
          host.setEnabled(tool.id, !on).catch((err: unknown) => {
            console.error(`[ToolGallery] Toggle failed for "${tool.id}":`, err);
          });
        },
      };
    });
  return [...pages, ...switches];
}

/** What the Tools page's API offers that the source uses. */
export interface ToolQuickOpenApi {
  readonly tools: Omit<ToolQuickOpenHost, 'openPage' | 'getAll'> & {
    getAll(): readonly QuickOpenTool[];
    getById(toolId: string): { readonly isBuiltin: boolean } | undefined;
  };
  readonly editors: {
    openEditor(options: { typeId: string; title: string; icon?: string; instanceId?: string }): Promise<void>;
  };
}

/** Register the tools source; it lists nothing until the user types. */
export function registerToolQuickOpen(api: ToolQuickOpenApi): IDisposable {
  const host: ToolQuickOpenHost = {
    getAll: () => api.tools.getAll(),
    isEnabled: (id) => api.tools.isEnabled(id),
    canChangeEnablement: (id) => api.tools.canChangeEnablement(id),
    setEnabled: (id, enabled) => api.tools.setEnabled(id, enabled),
    openPage: (tool) => {
      const icon = api.tools.getById(tool.id)?.isBuiltin ? 'package' : 'plug';
      api.editors.openEditor({ typeId: 'tool-detail', title: tool.name, icon, instanceId: tool.id }).catch((err: unknown) => {
        console.error(`[ToolGallery] Failed to open tool editor for "${tool.id}":`, err);
      });
    },
  };
  return registerQuickOpenSource({
    id: 'tools.installed',
    group: 'tools',
    kind: 'Tool',
    onlyWhenQueried: true,
    listItems: async () => toolQuickOpenItems(host),
  });
}
