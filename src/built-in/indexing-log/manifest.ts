// manifest.ts — the Indexing Log tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const INDEXING_LOG_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.indexing-log',
  name: 'Indexing',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Indexing Log: real-time view of files and pages being indexed into the knowledge base.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'indexingLog.clear', title: 'Indexing: Clear Log',
        aiInvocable: true, aiDescription: 'Clear the indexing log entries.' },
      { id: 'indexingLog.toggleErrorFilter', title: 'Indexing: Toggle Error Filter',
        aiInvocable: true, aiDescription: 'Toggle the error-only filter in the indexing log.' },
    ],
    views: [{ id: 'view.indexingLog', name: 'Indexing', defaultContainerId: 'panel' }],
  },
};
