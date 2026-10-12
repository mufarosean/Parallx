// manifest.ts — the AI Settings tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const AI_SETTINGS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.ai-settings',
  name: 'AI Settings',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Configure AI personality, behavior, and model settings.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'ai-settings.open', title: 'Parallx: Open AI Settings' },
      { id: 'memory.openDurable', title: 'Parallx: Open Durable Memory' },
      { id: 'memory.openTodayLog', title: 'Parallx: Open Today\'s Memory Log' },
    ],
    keybindings: [
      { command: 'ai-settings.open', key: 'Ctrl+Shift+A' },
    ],
    // The `view.aiSettings` sidebar view + its hidden container are RETIRED
    // (STANDARDIZATION.md P1): AI Settings lives only in the Settings hub,
    // and ai-settings.open routes there. The command + keybinding stay.
  },
};
