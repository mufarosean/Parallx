// manifest.ts — the Terminal tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

// the terminal tool existed (src/built-in/terminal + electron bridge)
// but was never registered here, so its panel view never activated and the
// old core "Console" placeholder rendered as a permanent empty tab.

export const TERMINAL_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.terminal',
  name: 'Terminal',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Integrated terminal panel: runs shell commands in the workspace.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'terminal.clear', title: 'Terminal: Clear',
        aiInvocable: true, aiDescription: 'Clear the active terminal.' },
      { id: 'terminal.restart', title: 'Terminal: Restart Shell',
        aiInvocable: true, aiDescription: 'Restart the active terminal session.' },
    ],
    views: [{ id: 'view.terminal', name: 'Terminal', defaultContainerId: 'panel' }],
  },
};
