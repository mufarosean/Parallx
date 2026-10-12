// manifest.ts — the Welcome tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const WELCOME_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.welcome',
  name: 'Welcome',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Welcome page: shows getting-started content and recent workspaces.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [{ id: 'welcome.openWelcome', title: 'Welcome: Show Welcome Page',
      aiInvocable: true, aiDescription: 'Open the welcome page.' }],
    editors: [{ typeId: 'parallx.welcome.editor', displayName: 'Welcome' }],
  },
};
