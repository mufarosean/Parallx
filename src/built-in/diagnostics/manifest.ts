// manifest.ts — the Diagnostics tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const DIAGNOSTICS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.diagnostics',
  name: 'Diagnostics',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'AI runtime diagnostics: health checks for Ollama, RAG, embeddings, and configuration.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'diagnostics.runChecks', title: 'Diagnostics: Run Health Checks',
        aiInvocable: true, aiDescription: 'Run the diagnostics health checks and show results.' },
    ],
    views: [{ id: 'view.diagnostics', name: 'AI Diagnostics', defaultContainerId: 'panel' }],
  },
};
