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
  description: 'Home: the page the app opens on. A greeting, a place to ask, what each tool has for today, and what you last worked on.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'home.open', title: 'Home: Open Home',
        aiInvocable: true, aiDescription: 'Open Home: the greeting, a field to ask the chat, what each tool has for today, and the pages, files and other things last worked on.' },
      { id: 'home.openItem', title: 'Home: Open Item' },
      { id: 'home.pinItem', title: 'Home: Pin or Unpin Item' },
      { id: 'home.ask', title: 'Home: Send to Chat' },
      { id: 'home.keepName', title: 'Home: Keep Name' },
      { id: 'home.skipName', title: 'Home: Do Not Ask for a Name' },
    ],
    editors: [{ typeId: 'home', displayName: 'Home' }],
  },
};
