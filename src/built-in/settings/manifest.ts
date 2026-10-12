// manifest.ts — the Settings tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const SETTINGS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.settings',
  required: true,
  name: 'Settings',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Unified, schema-driven settings editor (M60 §7).',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'settings.open', title: 'Parallx: Open Settings',
        aiInvocable: true, aiDescription: 'Open the workspace settings editor.' },
      // workspace.importConfig and workspace.resetConfig are EXCLUDED by the
      // Denylist (config mutation / destructive). Only the read-only
      // export path is opt-in.
      { id: 'workspace.exportConfig', title: 'Workspace: Export Configuration',
        aiInvocable: true, aiDescription: 'Export the workspace configuration to a file for backup (user picks the destination via a save-file dialog).' },
      { id: 'workspace.importConfig', title: 'Workspace: Import Configuration' },
      { id: 'workspace.resetConfig', title: 'Workspace: Reset Configuration' },
    ],
    keybindings: [
      { command: 'settings.open', key: 'Ctrl+Alt+S' },
    ],
  },
};
