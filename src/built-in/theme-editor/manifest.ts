// manifest.ts — the Theme Editor tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const THEME_EDITOR_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.theme-editor',
  name: 'Appearance',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'Choose a base palette and accent. Live preview, applied everywhere.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  // Phase D step 9: LAZY — one command is its whole surface. The Settings
  // hub is the other door: it fires this tool's activation event when it
  // opens (settings/main.ts), so the Appearance panel is listed there
  // without anyone having run the command first.
  activationEvents: ['onCommand:theme-editor.open'],
  contributes: {
    commands: [
      { id: 'theme-editor.open', title: 'Parallx: Appearance',
        aiInvocable: true, aiDescription: 'Open the Appearance settings to change the base palette and accent.' },
    ],
    keybindings: [
      { command: 'theme-editor.open', key: 'Ctrl+Shift+T' },
    ],
    // The editor-tab surface is retired (STANDARDIZATION.md P1) — the
    // command routes to Settings > Appearance; the keybinding stays.
  },
};
