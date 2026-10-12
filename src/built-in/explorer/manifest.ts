// manifest.ts — the Explorer tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const EXPLORER_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.explorer',
  required: true,
  name: 'Explorer',
  version: '1.0.0',
  publisher: 'parallx',
  description: 'File Explorer: browse, create, rename, and delete files and folders.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    commands: [
      // newFile / newFolder / rename are DUPLICATE (existing file tools).
      // delete is EXCLUDED (destructive, irreversible from headless agent context).
      // revealInExplorer is DUPLICATE (not actionable in headless agent context).
      { id: 'explorer.newFile', title: 'Explorer: New File…' },
      { id: 'explorer.newFolder', title: 'Explorer: New Folder…' },
      { id: 'explorer.rename', title: 'Explorer: Rename…' },
      { id: 'explorer.delete', title: 'Explorer: Delete' },
      { id: 'explorer.refresh', title: 'Explorer: Refresh',
        aiInvocable: true, aiDescription: 'Refresh the file explorer view.' },
      { id: 'explorer.collapse', title: 'Explorer: Collapse All',
        aiInvocable: true, aiDescription: 'Collapse all folders in the file explorer.' },
      { id: 'explorer.revealInExplorer', title: 'Explorer: Reveal in Explorer' },
      { id: 'explorer.toggleHiddenFiles', title: 'Explorer: Toggle Hidden Files',
        aiInvocable: true, aiDescription: 'Show or hide dotfiles and hidden files in the explorer.' },
      // Phase B (SYSTEM_INTEGRITY.md): the context menu's remaining actions
      // become commands so the menu is a door onto the command bus, not a
      // parallel implementation. Target-taking; menu supplies its cursor node.
      { id: 'explorer.open', title: 'Explorer: Open' },
      { id: 'explorer.openToSide', title: 'Explorer: Open to the Side' },
      { id: 'explorer.addToChat', title: 'Explorer: Add to Chat' },
      { id: 'explorer.cut', title: 'Explorer: Cut' },
      { id: 'explorer.copy', title: 'Explorer: Copy' },
      { id: 'explorer.paste', title: 'Explorer: Paste' },
      { id: 'explorer.copyPath', title: 'Explorer: Copy Path' },
      { id: 'explorer.copyRelativePath', title: 'Explorer: Copy Relative Path' },
      { id: 'explorer.revealInFileExplorer', title: 'Explorer: Reveal in File Explorer' },
    ],
    keybindings: [
      { command: 'explorer.rename', key: 'F2', when: "focusedView == 'view.explorer'" },
      { command: 'explorer.delete', key: 'Delete', when: "focusedView == 'view.explorer'" },
    ],
    viewContainers: [
      { id: 'explorer-container', title: 'Explorer', icon: 'folder', location: 'sidebar' as const },
    ],
    // The sidebar header's More Actions menu while the Explorer is showing.
    menus: {
      'viewContainer/title': [
        { command: 'explorer.collapse', title: 'Collapse All', group: '1_actions', when: "activeViewContainer == 'explorer-container'" },
        { command: 'explorer.refresh', title: 'Refresh', group: '1_actions', when: "activeViewContainer == 'explorer-container'" },
      ],
    },
    // Manifest order IS stacked-section order (Retirement 4a: views seat in
    // contribution order). Files first, Open Editors below — the layout the
    // old builtin boot loop produced by accident and users rely on.
    views: [
      { id: 'view.explorer', name: 'Explorer', defaultContainerId: 'explorer-container' },
      { id: 'view.openEditors', name: 'Open Editors', defaultContainerId: 'explorer-container' },
    ],
  },
};
