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
  // Eager: Ctrl+P lists every tool from the start (toolQuickOpen.ts).
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [{ id: 'tools.showInstalled', title: 'Tools: Show Tools and Extensions',
      aiInvocable: true, aiDescription: 'Show the list of installed tools and extensions.' }],
    // No sidebar seat: the gallery opens as an editor tab from the View menu.
    editors: [{ typeId: 'tool-gallery', displayName: 'Tools and Extensions' }, { typeId: 'tool-detail', displayName: 'Tool Details' }],
  },
};
