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
  description: 'Find in Files: workspace-wide text search with results tree.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  // EAGER by architecture, not by choice (Phase D step 9 post-mortem):
  // every workbench view pre-materializes when its manifest processes —
  // so onView can never fire lazily. (Retirement 4a deleted the demo
  // placeholder that a 'lazy' search once showed forever; the constraint
  // itself remains.) Until views materialize on demand, view-owning
  // built-ins stay onStartupFinished; onCommand is the one real lazy path.
  activationEvents: ['onStartupFinished'],
  contributes: {
    // Its sidebar's More Actions menu.
    menus: {
      'viewContainer/title': [
        { command: 'search.collapseAll', title: 'Collapse All', group: '1_actions', when: "activeViewContainer == 'search-container'" },
        { command: 'search.expandAll', title: 'Expand All', group: '1_actions', when: "activeViewContainer == 'search-container'" },
        { command: 'search.clearResults', title: 'Clear Results', group: '2_clear', when: "activeViewContainer == 'search-container'" },
      ],
    },
    commands: [
      { id: 'search.findInFiles', title: 'Search: Find in Files',
        aiInvocable: true, aiDescription: 'Open the search view to find text across workspace files.' },
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
    viewContainers: [
      { id: 'search-container', title: 'Search', icon: 'search', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.search', name: 'Search', defaultContainerId: 'search-container' },
    ],
  },
};
