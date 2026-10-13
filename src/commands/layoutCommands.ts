// layoutCommands.ts — commands for the layout gestures (SYSTEM_INTEGRITY.md
// Phase B).
//
// Every gesture in the widget/container/window layer gets a command
// equivalent here, closing the parity gap the integrity audit found: the
// box menus, the saved-layout buttons, and the window controls all route
// through these instead of switching inline, so the palette can reach
// them, keybindings can bind them, and the journal narrates them through
// the command tap with a truthful origin.
//
// Target-taking commands follow the adoptWidget convention: the first
// argument names the target (widget instance id, container id, part id,
// layout id); invalid arguments no-op rather than throw. Run bare from the
// palette, the move commands ASK (which area, the focused one first; then
// where), so every drag of the layout layer has a keyboard way
// (docs/ACCESSIBILITY.md, section 6).

import type { CommandDescriptor } from './commandTypes.js';
import { wb } from './structuralCommandTypes.js';
import type { IWindowService } from '../services/serviceTypes.js';
import { showQuickPickModal } from '../api/notificationService.js';

type Edge = 'left' | 'right' | 'bottom';
type ContentAlign = 'start' | 'start-padded' | 'center';

const EDGES: readonly Edge[] = ['left', 'right', 'bottom'];
const ALIGNS: readonly ContentAlign[] = ['start', 'start-padded', 'center'];

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// ─── Asking, for a bare palette run ──────────────────────────────────────────

interface IChoice { readonly id: string; readonly label: string; readonly focused?: boolean }

/** One question as a quick pick; the chosen id, or undefined when dismissed. */
async function ask(placeholder: string, choices: readonly IChoice[]): Promise<string | undefined> {
  if (!choices.length) return undefined;
  const picked = await showQuickPickModal(document.body, choices.map((c) => ({ label: c.label, description: c.focused ? 'Focused' : undefined })), { placeholder });
  const one = Array.isArray(picked) ? picked[0] : picked;
  return one ? choices.find((c) => c.label === one.label)?.id : undefined;
}


/**
 * The areas of the layout on screen, the focused one first: every grid area
 * by its id, or (given `key`) only the floating boxes carrying that data key.
 */
function areas(key?: 'containerId' | 'instanceId', except?: string): IChoice[] {
  const out: IChoice[] = [];
  // The grid area holding focus: a part, a floating container or a seated widget.
  const focused = document.activeElement?.closest<HTMLElement>('.grid-branch > [data-part-id]');
  for (const el of document.querySelectorAll<HTMLElement>('.grid-branch > [data-part-id]')) {
    const id = key ? el.dataset[key] : el.getAttribute('data-part-id')!;
    if (!id || id === except || !el.getClientRects().length || out.some((c) => c.id === id)) continue;
    const label = el.getAttribute('aria-label') || el.querySelector('[class*="-title"]')?.textContent?.trim() || id;
    out.push({ id, label, focused: el === focused });
  }
  return out.sort((a, b) => Number(!!b.focused) - Number(!!a.focused));
}

const EDGE_CHOICES: readonly IChoice[] = [
  { id: 'left', label: 'Left Edge' }, { id: 'right', label: 'Right Edge' }, { id: 'bottom', label: 'Bottom Edge' },
];

// ─── Widget seats ────────────────────────────────────────────────────────────

export const widgetRefresh: CommandDescriptor = {
  id: 'workbench.action.widget.refresh',
  title: 'Refresh Widget',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Refresh a workbench-seated widget (by instance id) so it re-fetches its content.',
  handler(ctx, ...args) {
    const id = str(args[0]);
    if (id) wb(ctx)._widgetBoxes.refreshWidget(id);
  },
};

export const widgetOpenSettings: CommandDescriptor = {
  id: 'workbench.action.widget.openSettings',
  title: 'Widget Settings',
  category: 'View',
  aiDescription: 'Open the settings drawer for a workbench-seated widget (by instance id).',
  handler(ctx, ...args) {
    const id = str(args[0]);
    if (id) wb(ctx)._widgetBoxes.openSettings(id);
  },
};

export const widgetEditAppearance: CommandDescriptor = {
  id: 'workbench.action.widget.editAppearance',
  title: 'Edit Widget Appearance',
  category: 'View',
  aiDescription: 'Open the appearance drawer for a workbench-seated widget (by instance id).',
  handler(ctx, ...args) {
    const id = str(args[0]);
    if (id) wb(ctx)._widgetBoxes.openAppearance(id);
  },
};

export const widgetSetContentAlign: CommandDescriptor = {
  id: 'workbench.action.widget.setContentAlign',
  title: 'Align Widget Content',
  category: 'View',
  aiDescription: 'Set a seated widget\'s content placement (instance id, then "start", "start-padded", or "center").',
  async handler(ctx, ...args) {
    const id = str(args[0]);
    const align = args[1];
    if (id && ALIGNS.includes(align as ContentAlign)) {
      await wb(ctx)._widgetBoxes.setContentAlign(id, align as ContentAlign);
    }
  },
};

export const widgetMoveToEdge: CommandDescriptor = {
  id: 'workbench.action.widget.moveToEdge',
  title: 'Move Widget to Edge',
  category: 'View',
  aiDescription: 'Move a seated widget to a window edge (instance id, then "left", "right", or "bottom").',
  async handler(ctx, ...args) {
    const id = str(args[0]) ?? await ask('Move which widget?', areas('instanceId'));
    const edge = args[1] ?? (id ? await ask('To which edge?', EDGE_CHOICES) : undefined);
    if (id && EDGES.includes(edge as Edge)) {
      wb(ctx)._widgetBoxes.moveToEdge(id, edge as Edge);
    }
  },
};

export const widgetReturnToDashboard: CommandDescriptor = {
  id: 'workbench.action.widget.returnToDashboard',
  title: 'Return Widget to Dashboard',
  category: 'View',
  aiDescription: 'Return a seated widget to the dashboard it came from (the non-destructive inverse of adoption).',
  async handler(ctx, ...args) {
    const id = str(args[0]);
    if (id) await wb(ctx)._widgetBoxes.returnToDashboard(id);
  },
};

export const widgetRemove: CommandDescriptor = {
  id: 'workbench.action.widget.remove',
  title: 'Remove Widget',
  category: 'View',
  aiDescription: 'Delete a seated widget: the seat AND the instance. Destructive; Return Widget to Dashboard is the non-destructive exit.',
  async handler(ctx, ...args) {
    const id = str(args[0]);
    if (id) await wb(ctx)._widgetBoxes.removeWidget(id);
  },
};

// ─── Floating containers ─────────────────────────────────────────────────────

export const containerFloat: CommandDescriptor = {
  id: 'workbench.action.container.float',
  title: 'Float Container',
  category: 'View',
  aiDescription: 'Detach a docked view container (by container id) into a floating box in the workbench grid.',
  async handler(ctx, ...args) {
    // Bare: the rails' containers, then the panel's views (a view floats alone).
    const id = str(args[0]) ?? await ask('Float which?', [
      ...Array.from(document.querySelectorAll<HTMLElement>('.activity-bar-item[data-icon-id]')).map((b) => ({ id: b.dataset.iconId!, label: b.getAttribute('aria-label') || b.dataset.iconId! })),
      ...Array.from(document.querySelectorAll<HTMLElement>('[data-part-id="workbench.parts.panel"] .view-tab[data-view-id]')).map((t) => ({ id: `panelview:${t.dataset.viewId}`, label: `${t.textContent?.trim() || t.dataset.viewId} (Panel)` })),
    ]);
    if (id) wb(ctx)._containerBoxes.float(id);
  },
};

export const containerDock: CommandDescriptor = {
  id: 'workbench.action.container.dock',
  title: 'Dock Container to Rail',
  category: 'View',
  aiDescription: 'Dock a floating container back to a rail (container id, then "left" or "right"). A detached panel view returns to the panel.',
  async handler(ctx, ...args) {
    const id = str(args[0]) ?? await ask('Dock which container?', areas('containerId'));
    const rail = args[1] ?? (id ? await ask('To which rail?', [{ id: 'left', label: 'Left Rail' }, { id: 'right', label: 'Right Rail' }]) : undefined);
    if (id && (rail === 'left' || rail === 'right')) {
      wb(ctx)._containerBoxes.dock(id, rail);
    }
  },
};

export const containerMoveToEdge: CommandDescriptor = {
  id: 'workbench.action.container.moveToEdge',
  title: 'Move Container to Edge',
  category: 'View',
  aiDescription: 'Move a floating container to a window edge (container id, then "left", "right", or "bottom").',
  async handler(ctx, ...args) {
    const id = str(args[0]) ?? await ask('Move which container?', areas('containerId'));
    const edge = args[1] ?? (id ? await ask('To which edge?', EDGE_CHOICES) : undefined);
    if (id && EDGES.includes(edge as Edge)) {
      wb(ctx)._containerBoxes.moveToEdge(id, edge as Edge);
    }
  },
};

// ─── Parts ───────────────────────────────────────────────────────────────────

export const movePartToEdge: CommandDescriptor = {
  id: 'workbench.action.movePartToEdge',
  title: 'Move Part to Edge',
  category: 'View',
  aiDescription: 'Move any workbench part to a window edge (partId, then "left", "right", or "bottom"). The fixed-part forms (layout.moveSidebarLeft and friends) remain for the common cases.',
  async handler(ctx, ...args) {
    const partId = str(args[0]) ?? await ask('Move which area?', areas());
    const edge = args[1] ?? (partId ? await ask('To which edge?', EDGE_CHOICES) : undefined);
    if (partId && EDGES.includes(edge as Edge)) {
      wb(ctx).movePartToEdge(
        partId,
        edge === 'bottom' ? 'vertical' : 'horizontal',
        edge === 'left',
      );
    }
  },
};

export const resetPartPlacement: CommandDescriptor = {
  id: 'workbench.action.resetPartPlacement',
  title: 'Reset Part Placement',
  category: 'View',
  aiDescription: 'Put one workbench part (by part id) back at its default position, leaving the rest of the layout alone.',
  handler(ctx, ...args) {
    const partId = str(args[0]);
    if (partId) wb(ctx).resetPartPlacement(partId);
  },
};

export const movePartBeside: CommandDescriptor = {
  id: 'workbench.action.movePartBeside',
  title: 'Move Part Beside Another',
  category: 'View',
  aiDescription: 'Place one workbench part next to another (partId, targetId, "horizontal" or "vertical", before as boolean); the drag gesture\'s command equivalent.',
  async handler(ctx, ...args) {
    let [partId, targetId, orientation, before] = [str(args[0]), str(args[1]), args[2], args[3] === true];
    if (!partId) {
      // Bare: which area, beside which, and on which side of it.
      partId = await ask('Move which area?', areas());
      targetId = partId ? await ask('Beside which?', areas(undefined, partId)) : undefined;
      const side = targetId ? await ask('On which side?', [
        { id: 'left', label: 'Left Of It' }, { id: 'right', label: 'Right Of It' }, { id: 'above', label: 'Above It' }, { id: 'below', label: 'Below It' },
      ]) : undefined;
      if (!side) return;
      orientation = side === 'left' || side === 'right' ? 'horizontal' : 'vertical';
      before = side === 'left' || side === 'above';
    }
    if (partId && targetId && (orientation === 'horizontal' || orientation === 'vertical')) {
      wb(ctx).movePartBeside(partId, targetId, orientation, before);
    }
  },
};

// ─── Saved layouts ───────────────────────────────────────────────────────────

export const applyLayout: CommandDescriptor = {
  id: 'workbench.action.applyLayout',
  title: 'Apply Saved Layout',
  category: 'View',
  aiInvocable: true,
  aiDescription: 'Apply a saved workbench layout by id or exact name; with no argument, opens Settings where the saved layouts live.',
  async handler(ctx, ...args) {
    const target = str(args[0]);
    if (!target) {
      // Bare palette invocation: the management home is Settings > Layouts.
      const commandService = ctx.getService<import('../services/serviceTypes.js').ICommandService>('ICommandService');
      await commandService?.executeCommandFrom(ctx.origin, 'settings.open');
      return;
    }
    const w = wb(ctx);
    const byId = w.savedLayouts.get(target);
    const layout = byId ?? w.savedLayouts.list().find((l) => l.name === target);
    if (layout) w.applySavedLayout(layout.id);
  },
};

export const renameLayout: CommandDescriptor = {
  id: 'workbench.action.renameLayout',
  title: 'Rename Saved Layout',
  category: 'View',
  aiDescription: 'Rename a saved layout (layout id, then the new name).',
  async handler(ctx, ...args) {
    const id = str(args[0]);
    const name = str(args[1]);
    if (id && name) await wb(ctx).savedLayouts.rename(id, name);
  },
};

export const deleteLayout: CommandDescriptor = {
  id: 'workbench.action.deleteLayout',
  title: 'Delete Saved Layout',
  category: 'View',
  aiDescription: 'Delete a saved layout by id. Destructive.',
  async handler(ctx, ...args) {
    const id = str(args[0]);
    if (id) await wb(ctx).savedLayouts.remove(id);
  },
};

// ─── Window ──────────────────────────────────────────────────────────────────

function windowService(ctx: Parameters<CommandDescriptor['handler']>[0]): IWindowService | undefined {
  return ctx.getService<IWindowService>('IWindowService');
}

export const minimizeWindow: CommandDescriptor = {
  id: 'workbench.action.minimizeWindow',
  title: 'Minimize Window',
  category: 'Window',
  handler(ctx) {
    windowService(ctx)?.minimize();
  },
};

export const toggleMaximizeWindow: CommandDescriptor = {
  id: 'workbench.action.toggleMaximizeWindow',
  title: 'Maximize or Restore Window',
  category: 'Window',
  handler(ctx) {
    windowService(ctx)?.maximize();
  },
};

export const closeWindow: CommandDescriptor = {
  id: 'workbench.action.closeWindow',
  title: 'Close Window',
  category: 'Window',
  handler(ctx) {
    windowService(ctx)?.close();
  },
};

// ─── Aggregate ───────────────────────────────────────────────────────────────

export const ALL_LAYOUT_COMMANDS: CommandDescriptor[] = [
  widgetRefresh,
  widgetOpenSettings,
  widgetEditAppearance,
  widgetSetContentAlign,
  widgetMoveToEdge,
  widgetReturnToDashboard,
  widgetRemove,
  containerFloat,
  containerDock,
  containerMoveToEdge,
  movePartToEdge,
  resetPartPlacement,
  movePartBeside,
  applyLayout,
  renameLayout,
  deleteLayout,
  minimizeWindow,
  toggleMaximizeWindow,
  closeWindow,
];
