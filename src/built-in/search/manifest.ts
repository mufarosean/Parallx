// manifest.ts — the Search tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const SEARCH_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.search',
  name: 'Search',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Find in Files: the Workspace scope of Find (Ctrl+F), with results grouped by file.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  // Eager: it registers Find's Workspace scope, which Ctrl+F shows from the start.
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      { id: 'search.findInFiles', title: 'Search: Find in Files',
        aiInvocable: true, aiDescription: 'Open Find on the whole workspace, to find text across its files.' },
      { id: 'search.clearResults', title: 'Search: Clear Results',
        aiInvocable: true, aiDescription: 'Clear the current search results.' },
      { id: 'search.collapseAll', title: 'Search: Collapse All Results',
        aiInvocable: true, aiDescription: 'Collapse every group in the search results.' },
      { id: 'search.expandAll', title: 'Search: Expand All Results',
        aiInvocable: true, aiDescription: 'Expand every group in the search results.' },
    ],
    keybindings: [
      { command: 'search.findInFiles', key: 'Ctrl+Shift+F' },
    ],
  },
};
