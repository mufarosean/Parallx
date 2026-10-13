// @vitest-environment jsdom
// layoutPrompts.test.ts — run bare from the palette, the layout move commands
// ask (which area, the focused one first; then where), so dragging a part,
// a floating container or a widget has a keyboard way.
// docs/ACCESSIBILITY.md, section 6.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { CommandService } from '../../src/commands/commandRegistry.js';
import { ALL_LAYOUT_COMMANDS } from '../../src/commands/layoutCommands.js';
import { ServiceCollection } from '../../src/services/serviceCollection.js';

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function setup() {
  const grid = document.createElement('div');
  grid.className = 'grid-branch';
  for (const [id, label] of [['workbench.parts.sidebar', 'Sidebar'], ['workbench.parts.editor', 'Editor'], ['workbench.parts.panel', 'Panel']]) {
    const el = document.createElement('div');
    el.setAttribute('data-part-id', id);
    el.setAttribute('aria-label', label);
    el.tabIndex = -1;
    el.getClientRects = () => [{}] as unknown as DOMRectList;
    grid.appendChild(el);
  }
  document.body.appendChild(grid);
  const workbench = { movePartToEdge: vi.fn(), movePartBeside: vi.fn() };
  const bus = new CommandService(new ServiceCollection());
  bus.setWorkbench(workbench);
  bus.registerCommands(ALL_LAYOUT_COMMANDS);
  return { bus, workbench };
}

/** Answer the open quick pick with the row whose label is `label`. */
async function choose(label: string): Promise<string[]> {
  await tick();
  const rows = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
  const texts = rows.map((r) => r.textContent ?? '');
  rows.find((r) => r.textContent?.startsWith(label))!.click();
  await tick();
  return texts;
}

afterEach(() => { document.body.innerHTML = ''; });

describe('layout moves asked for from the palette', () => {
  it('Move Part to Edge asks which area, focused first, then which edge', async () => {
    const { bus, workbench } = setup();
    document.querySelector<HTMLElement>('[data-part-id="workbench.parts.panel"]')!.focus();
    const run = bus.executeCommand('workbench.action.movePartToEdge');
    const offered = await choose('Panel');
    expect(offered[0]).toMatch(/^Panel/);
    await choose('Right Edge');
    await run;
    expect(workbench.movePartToEdge).toHaveBeenCalledWith('workbench.parts.panel', 'horizontal', false);
    bus.dispose();
  });

  it('Move Part Beside Another asks which, beside which, and which side', async () => {
    const { bus, workbench } = setup();
    const run = bus.executeCommand('workbench.action.movePartBeside');
    await choose('Panel');
    const targets = await choose('Sidebar');
    expect(targets.some((t) => t.startsWith('Panel'))).toBe(false);
    await choose('Below It');
    await run;
    expect(workbench.movePartBeside).toHaveBeenCalledWith('workbench.parts.panel', 'workbench.parts.sidebar', 'vertical', false);
    bus.dispose();
  });
});
