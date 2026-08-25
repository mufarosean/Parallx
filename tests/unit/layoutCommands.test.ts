// layoutCommands.test.ts — gesture/command parity (SYSTEM_INTEGRITY.md
// Phase B).
//
// Pins the contract that every layout gesture has a command: the widget,
// container, part, saved-layout, and window operations are reachable by
// command id, delegate to the right workbench surface with the right
// arguments, and no-op (never throw) on missing or malformed targets so
// bare palette invocations stay safe.

import { describe, it, expect, vi } from 'vitest';
import { CommandService } from '../../src/commands/commandRegistry.js';
import { ALL_LAYOUT_COMMANDS } from '../../src/commands/layoutCommands.js';
import { ServiceCollection } from '../../src/services/serviceCollection.js';
import { IWindowService } from '../../src/services/serviceTypes.js';

function makeWorkbench() {
  return {
    _widgetBoxes: {
      refreshWidget: vi.fn(),
      openSettings: vi.fn(),
      openAppearance: vi.fn(),
      setContentAlign: vi.fn().mockResolvedValue(undefined),
      moveToEdge: vi.fn(),
      returnToDashboard: vi.fn().mockResolvedValue(true),
      removeWidget: vi.fn().mockResolvedValue(undefined),
    },
    _containerBoxes: {
      float: vi.fn().mockReturnValue(true),
      dock: vi.fn().mockReturnValue(true),
      moveToEdge: vi.fn(),
    },
    movePartBeside: vi.fn(),
    movePartToEdge: vi.fn(),
    resetPartPlacement: vi.fn(),
    applySavedLayout: vi.fn().mockReturnValue(true),
    savedLayouts: {
      list: vi.fn().mockReturnValue([{ id: 'L1', name: 'Focus' }]),
      get: vi.fn((id: string) => (id === 'L1' ? { id: 'L1', name: 'Focus' } : undefined)),
      rename: vi.fn().mockResolvedValue(true),
      remove: vi.fn().mockResolvedValue(true),
    },
  };
}

function makeBus() {
  const services = new ServiceCollection();
  const windowSvc = { minimize: vi.fn(), maximize: vi.fn(), close: vi.fn() };
  services.registerInstance(IWindowService, windowSvc as never);
  const bus = new CommandService(services);
  const workbench = makeWorkbench();
  bus.setWorkbench(workbench);
  bus.registerCommands(ALL_LAYOUT_COMMANDS);
  return { bus, workbench, windowSvc };
}

describe('layout commands — gesture parity', () => {
  it('registers every layout command with a title (palette-visible)', () => {
    const { bus } = makeBus();
    for (const cmd of ALL_LAYOUT_COMMANDS) {
      expect(bus.hasCommand(cmd.id)).toBe(true);
      expect(cmd.title.length).toBeGreaterThan(0);
    }
    bus.dispose();
  });

  it('widget commands delegate to the widget-box surface by instance id', async () => {
    const { bus, workbench } = makeBus();
    const w = workbench._widgetBoxes;

    await bus.executeCommandFrom('menu', 'workbench.action.widget.refresh', 'w1');
    expect(w.refreshWidget).toHaveBeenCalledWith('w1');

    await bus.executeCommandFrom('menu', 'workbench.action.widget.openSettings', 'w1');
    expect(w.openSettings).toHaveBeenCalledWith('w1');

    await bus.executeCommandFrom('menu', 'workbench.action.widget.editAppearance', 'w1');
    expect(w.openAppearance).toHaveBeenCalledWith('w1');

    await bus.executeCommandFrom('menu', 'workbench.action.widget.setContentAlign', 'w1', 'center');
    expect(w.setContentAlign).toHaveBeenCalledWith('w1', 'center');

    await bus.executeCommandFrom('menu', 'workbench.action.widget.moveToEdge', 'w1', 'bottom');
    expect(w.moveToEdge).toHaveBeenCalledWith('w1', 'bottom');

    await bus.executeCommandFrom('menu', 'workbench.action.widget.returnToDashboard', 'w1');
    expect(w.returnToDashboard).toHaveBeenCalledWith('w1');

    await bus.executeCommandFrom('menu', 'workbench.action.widget.remove', 'w1');
    expect(w.removeWidget).toHaveBeenCalledWith('w1');
    bus.dispose();
  });

  it('container commands delegate to the container-box surface', async () => {
    const { bus, workbench } = makeBus();
    const c = workbench._containerBoxes;

    await bus.executeCommandFrom('menu', 'workbench.action.container.float', 'view.planner');
    expect(c.float).toHaveBeenCalledWith('view.planner');

    await bus.executeCommandFrom('menu', 'workbench.action.container.dock', 'view.planner', 'right');
    expect(c.dock).toHaveBeenCalledWith('view.planner', 'right');

    await bus.executeCommandFrom('menu', 'workbench.action.container.moveToEdge', 'view.planner', 'left');
    expect(c.moveToEdge).toHaveBeenCalledWith('view.planner', 'left');
    bus.dispose();
  });

  it('movePartBeside forwards the full placement', async () => {
    const { bus, workbench } = makeBus();
    await bus.executeCommandFrom('ai', 'workbench.action.movePartBeside', 'a', 'b', 'vertical', true);
    expect(workbench.movePartBeside).toHaveBeenCalledWith('a', 'b', 'vertical', true);
    bus.dispose();
  });

  it('the generic part commands translate edges and reset by part id', async () => {
    const { bus, workbench } = makeBus();

    await bus.executeCommandFrom('menu', 'workbench.action.movePartToEdge', 'workbench.parts.sidebar', 'left');
    expect(workbench.movePartToEdge).toHaveBeenCalledWith('workbench.parts.sidebar', 'horizontal', true);

    await bus.executeCommandFrom('menu', 'workbench.action.movePartToEdge', 'workbench.parts.panel', 'bottom');
    expect(workbench.movePartToEdge).toHaveBeenCalledWith('workbench.parts.panel', 'vertical', false);

    await bus.executeCommandFrom('menu', 'workbench.action.resetPartPlacement', 'workbench.parts.panel');
    expect(workbench.resetPartPlacement).toHaveBeenCalledWith('workbench.parts.panel');
    bus.dispose();
  });

  it('saved-layout commands apply by id, apply by exact name, rename, delete', async () => {
    const { bus, workbench } = makeBus();

    await bus.executeCommandFrom('ui', 'workbench.action.applyLayout', 'L1');
    expect(workbench.applySavedLayout).toHaveBeenCalledWith('L1');

    await bus.executeCommandFrom('ui', 'workbench.action.applyLayout', 'Focus');
    expect(workbench.applySavedLayout).toHaveBeenCalledTimes(2);

    await bus.executeCommandFrom('ui', 'workbench.action.renameLayout', 'L1', 'Deep Work');
    expect(workbench.savedLayouts.rename).toHaveBeenCalledWith('L1', 'Deep Work');

    await bus.executeCommandFrom('ui', 'workbench.action.deleteLayout', 'L1');
    expect(workbench.savedLayouts.remove).toHaveBeenCalledWith('L1');
    bus.dispose();
  });

  it('window commands reach the window service', async () => {
    const { bus, windowSvc } = makeBus();
    await bus.executeCommandFrom('ui', 'workbench.action.minimizeWindow');
    await bus.executeCommandFrom('ui', 'workbench.action.toggleMaximizeWindow');
    await bus.executeCommandFrom('ui', 'workbench.action.closeWindow');
    expect(windowSvc.minimize).toHaveBeenCalledOnce();
    expect(windowSvc.maximize).toHaveBeenCalledOnce();
    expect(windowSvc.close).toHaveBeenCalledOnce();
    bus.dispose();
  });

  it('missing or malformed targets no-op instead of throwing', async () => {
    const { bus, workbench } = makeBus();

    await bus.executeCommand('workbench.action.widget.remove');            // no target
    await bus.executeCommand('workbench.action.widget.moveToEdge', 'w1', 'up'); // bad edge
    await bus.executeCommand('workbench.action.widget.setContentAlign', 'w1', 'middle'); // bad align
    await bus.executeCommand('workbench.action.container.dock', 'c1', 'top');   // bad rail
    await bus.executeCommand('workbench.action.movePartBeside', 'a');      // missing args
    await bus.executeCommand('workbench.action.renameLayout', 'L1');       // missing name
    await bus.executeCommand('workbench.action.applyLayout', 'No Such');   // unknown layout

    expect(workbench._widgetBoxes.removeWidget).not.toHaveBeenCalled();
    expect(workbench._widgetBoxes.moveToEdge).not.toHaveBeenCalled();
    expect(workbench._widgetBoxes.setContentAlign).not.toHaveBeenCalled();
    expect(workbench._containerBoxes.dock).not.toHaveBeenCalled();
    expect(workbench.movePartBeside).not.toHaveBeenCalled();
    expect(workbench.savedLayouts.rename).not.toHaveBeenCalled();
    expect(workbench.applySavedLayout).not.toHaveBeenCalled();
    bus.dispose();
  });
});
