// manifest.ts — the Dashboard tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const DASHBOARD_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.dashboard',
  required: true,
  name: 'Dashboard',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Dashboard: a configurable launchpad for the workspace. Widgets contributed by tools; refresh on cron, interval, or manual.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'dashboard.open', title: 'Dashboard: Open',
        aiInvocable: true, aiDescription: 'Open the workspace dashboard.' },
      { id: 'dashboard.newPage', title: 'Dashboard: New Page',
        aiInvocable: true, aiDescription: 'Create a new dashboard page.' },
      { id: 'dashboard.addWidget', title: 'Dashboard: Add Widget…',
        aiInvocable: true, aiDescription: 'Open the widget picker on the active dashboard page.' },
      { id: 'dashboard.refreshAll', title: 'Dashboard: Refresh All Widgets',
        aiInvocable: true, aiDescription: 'Manually refresh every widget on the active dashboard page.' },
    ],
    keybindings: [
      { command: 'dashboard.open', key: 'Ctrl+Shift+H' },
    ],
    viewContainers: [
      { id: 'dashboard-container', title: 'Dashboard', icon: 'px-dashboard', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.dashboard', name: 'Dashboards', defaultContainerId: 'dashboard-container' },
    ],
    editors: [{ typeId: 'dashboard', displayName: 'Dashboard' }],
    configuration: [
      {
        title: 'Dashboard',
        properties: {
          'dashboard.aiRefreshConcurrency': {
            type: 'number',
            default: 2,
            description: 'How many AI widget refreshes may run as background agents at the same time (1-8). Applies to scheduled refreshes and "Refresh all"; extra refreshes queue.',
          },
        },
      },
    ],
  },
};
