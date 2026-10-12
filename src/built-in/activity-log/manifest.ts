// manifest.ts — the Activity Log tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const ACTIVITY_LOG_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.activity-log',
  name: 'Activity',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Activity: live timeline of what happened in the app: editors, commands, pages, assistant turns.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'activityLog.copyRecent', title: 'Activity: Copy Timeline to Clipboard',
        aiInvocable: true, aiDescription: 'Copy the visible activity timeline to the clipboard.' },
    ],
    views: [{ id: 'view.activityLog', name: 'Activity', defaultContainerId: 'panel' }],
  },
};
