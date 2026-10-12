// @vitest-environment jsdom
// contextMenuScene.test.ts — an open context menu is a surface of the scene
// with its rows as controls, and leaves the scene when it closes.
// docs/SELF_DESCRIBING_UI_DESIGN.md section 11's open item from step 3.

import { describe, it, expect, beforeEach } from 'vitest';
import { scene } from '../../src/ui/scene.js';
import { ContextMenu } from '../../src/ui/contextMenu.js';

const settle = () => new Promise<void>((r) => setTimeout(r, 60));

beforeEach(() => {
  document.body.innerHTML = '';
  scene.reset();
});

describe('context menu in the scene', () => {
  it('registers the menu and its rows while open, and drops them on dismiss', async () => {
    const menu = ContextMenu.show({
      label: 'Page',
      anchor: { x: 10, y: 10 },
      items: [
        { id: 'rename', label: 'Rename…' },
        { id: 'pinned', label: 'Pinned', checked: true },
        { id: 'delete', label: 'Delete', disabled: true, tooltip: 'Not while open' },
      ],
    });
    await settle();
    const surface = scene.find('contextMenu');
    expect(surface).toHaveLength(1);
    expect(surface[0].label).toBe('Page');
    const node = scene.describe('contextMenu').surfaces[0];
    expect(node.children?.map((c) => c.id)).toEqual(['contextMenu.rename', 'contextMenu.pinned', 'contextMenu.delete']);
    expect(node.children?.[1]).toMatchObject({ kind: 'toggle', state: { kind: 'pressed', value: true } });
    expect(node.children?.[2]).toMatchObject({ kind: 'button', hint: 'Not while open', state: { kind: 'enabled', value: false } });
    menu.dismiss();
    await settle();
    expect(scene.find('contextMenu')).toHaveLength(0);
    expect(scene.find('contextMenu.rename')).toHaveLength(0);
  });
});
