// manifest.ts — the Planner tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';
import { PLANNER_ICON } from './plannerIcon.js';

export const PLANNER_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.planner',
  name: 'Planner',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Calendar + tasks. Capture-fast / plan-later workflow with AI-aware scheduling.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    // In the Tools menu while the Planner runs.
    menus: {
      'menubar/tools': [{ command: 'planner.open', title: 'Planner' }],
      // Its sidebar's More Actions menu.
      'viewContainer/title': [
        { command: 'planner.newTask', title: 'New Task…', group: '1_new', when: "activeViewContainer == 'planner-container'" },
        { command: 'planner.newEvent', title: 'New Event…', group: '1_new', when: "activeViewContainer == 'planner-container'" },
        { command: 'planner.showOverdue', title: 'Show Overdue Tasks', group: '2_show', when: "activeViewContainer == 'planner-container'" },
        { command: 'planner.open', title: 'Open Planner', group: '2_show', when: "activeViewContainer == 'planner-container'" },
      ],
    },
    commands: [
      { id: 'planner.open', title: 'Planner: Open',
        aiInvocable: true, aiDescription: 'Open the Planner editor.' },
      { id: 'planner.newTask', title: 'Planner: New Task…',
        aiInvocable: true, aiDescription: 'Open the Planner\'s new task form.' },
      { id: 'planner.newEvent', title: 'Planner: New Event…',
        aiInvocable: true, aiDescription: 'Open the Planner\'s new event form.' },
      { id: 'planner.showOverdue', title: 'Planner: Show Overdue Tasks',
        aiInvocable: true, aiDescription: 'Open the Planner on the list of every overdue task.' },
    ],
    keybindings: [
      // NOTE: Ctrl+Shift+P is reserved for the Command Palette
      // (workbench.action.showCommands) and must never be reassigned.
      { command: 'planner.open', key: 'Ctrl+Shift+K' },
    ],
    icons: [PLANNER_ICON],
    viewContainers: [
      { id: 'planner-container', title: 'Planner', icon: 'px-planner', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.planner', name: 'Tasks', defaultContainerId: 'planner-container' },
    ],
    editors: [{ typeId: 'planner', displayName: 'Planner' }],
  },
};
