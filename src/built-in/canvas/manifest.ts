// manifest.ts — the Canvas tool's manifest: its identity, activation events
// and the contributions it declares. The workbench pairs it with ./main.ts
// at registration.

import type { IToolManifest } from '../../tools/toolManifest.js';

export const CANVAS_MANIFEST: IToolManifest = {
  manifestVersion: 1,
  id: 'parallx.canvas',
  required: true,
  name: 'Canvas',
  version: '0.1.0',
  publisher: 'parallx',
  description: 'Canvas: create and organise pages with rich-text content.',
  main: './main.js',
  engines: { parallx: '^0.1.0' },
  activationEvents: ['onStartupFinished'],
  contributes: {
    // Its sidebar's More Actions menu.
    menus: {
      'viewContainer/title': [
        { command: 'canvas.newPage', title: 'New Page', group: '1_new', when: "activeViewContainer == 'canvas-container'" },
        { command: 'canvas.newDatabase', title: 'New Database', group: '1_new', when: "activeViewContainer == 'canvas-container'" },
        { command: 'canvas.showTemplatePicker', title: 'New From Template…', group: '1_new', when: "activeViewContainer == 'canvas-container'" },
        { command: 'canvas.manageTemplates', title: 'Manage Templates…', group: '2_templates', when: "activeViewContainer == 'canvas-container'" },
        { command: 'canvas.emptyTrash', title: 'Empty Trash…', group: '3_trash', when: "activeViewContainer == 'canvas-container'" },
        { command: 'canvas.showKeyboardShortcuts', title: 'Keyboard Shortcuts', group: '4_help', when: "activeViewContainer == 'canvas-container'" },
      ],
    },
    commands: [
      // Audit decisions:
      // - canvas.newPage: DUPLICATE (covered by `canvas_create_page` AI tool).
      // - canvas.deletePage: EXCLUDED (destructive, irreversible).
      // - canvas.rename/duplicate: OUT_OF_MVP (need pageId arg).
      // showKeyboardShortcuts / showTemplatePicker registered at runtime in
      // main.ts; declared here so manifest pipeline picks up aiInvocable.
      { id: 'canvas.newPage', title: 'Canvas: New Page' },
      { id: 'canvas.newDatabase', title: 'Canvas: New Database' },
      { id: 'canvas.deletePage', title: 'Canvas: Delete Page' },
      { id: 'canvas.renamePage', title: 'Canvas: Rename Page' },
      { id: 'canvas.duplicatePage', title: 'Canvas: Duplicate Page' },
      { id: 'canvas.exportAllPages', title: 'Canvas: Export All Pages as Markdown…' },
      { id: 'canvas.storePicturesAsFiles', title: 'Canvas: Store Pictures as Files' },
      { id: 'canvas.restorePage', title: 'Canvas: Restore Page from Trash',
        aiInvocable: true, aiDescription: 'Restore a page (and its sub-pages) from the Trash. Argument: pageId (string, required).' },
      { id: 'canvas.deletePageForever', title: 'Canvas: Delete Page Forever…' },
      { id: 'canvas.emptyTrash', title: 'Canvas: Empty Trash…' },
      { id: 'canvas.showKeyboardShortcuts', title: 'Canvas: Show Keyboard Shortcuts',
        aiInvocable: true, aiDescription: 'Show the canvas keyboard shortcuts overlay.' },
      { id: 'canvas.showTemplatePicker', title: 'Canvas: Show Template Picker',
        aiInvocable: true, aiDescription: 'Open the canvas template picker.' },
      { id: 'canvas.manageTemplates', title: 'Canvas: Manage Templates',
        aiInvocable: true, aiDescription: 'Open the user-template manager (list, delete custom canvas templates).' },
      { id: 'canvas.saveAsTemplate', title: 'Canvas: Save Page As Template',
        aiInvocable: true, aiDescription: 'Save the given canvas page as a reusable custom template. Argument: pageId (string, required).' },
    ],
    keybindings: [
      { command: 'canvas.newPage', key: 'Ctrl+N', when: "focusedView == 'view.canvas'" },
    ],
    viewContainers: [
      { id: 'canvas-container', title: 'Canvas', icon: 'px-canvas', location: 'sidebar' as const },
    ],
    views: [
      { id: 'view.canvas', name: 'Pages', defaultContainerId: 'canvas-container' },
    ],
    editors: [{ typeId: 'canvas', displayName: 'Canvas Page' }],
  },
};
