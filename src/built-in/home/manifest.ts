// manifest.ts — the Home tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const HOME_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.home',
  required: true,
  name: 'Home',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Home: everything recent from every tool that is on, in one place, with search.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'home.open', title: 'Home: Open Home',
        aiInvocable: true, aiDescription: 'Open Home: recent pages, files and what each tool keeps, with search across them.' },
      { id: 'home.openItem', title: 'Home: Open Item' },
    ],
    editors: [{ typeId: 'home', displayName: 'Home' }],
  },
};
