// manifest.ts — the Output tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const OUTPUT_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.output',
  name: 'Output',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Output panel: shows log messages from tools and the shell.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'output.clear', title: 'Output: Clear Log',
        aiInvocable: true, aiDescription: 'Clear the current output channel.' },
      { id: 'output.toggleTimestamps', title: 'Output: Toggle Timestamps',
        aiInvocable: true, aiDescription: 'Toggle timestamp display in the output panel.' },
    ],
    views: [{ id: 'view.output', name: 'Output', defaultContainerId: 'panel' }],
  },
};
