// manifest.ts — the Tool Gallery tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const TOOL_GALLERY_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.tool-gallery',
  required: true,
  name: 'Tools',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Tool Gallery: shows all registered tools, their status, and contributions.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  // EAGER by architecture (see the Search note): its contributed view
  // materializes at boot via _addViewToContainer, so lazy-on-view is a
  // fiction today. onCommand-only tools are the real lazy candidates.
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [{ id: 'tools.showInstalled', title: 'Tools: Show Installed Tools',
      aiInvocable: true, aiDescription: 'Show the list of installed tools and extensions.' }],
    viewContainers: [
      { id: 'tools-container', title: 'Tools', icon: 'px-tools', location: 'sidebar' as const },
    ],
    views: [{ id: 'view.tools', name: 'Installed Tools', defaultContainerId: 'tools-container' }],
    editors: [{ typeId: 'tool-detail', displayName: 'Tool Details' }],
  },
};
