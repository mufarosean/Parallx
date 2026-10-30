// viewContainerTitleMenu.test.ts — the sidebar header's More Actions menu
// names no tool.
//
// Each container's owner puts its items there (contributes.menus
// "viewContainer/title", when: activeViewContainer == '<id>'). The menu
// lists the showing container's items; a tool turned off takes its items.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MenuContributionProcessor } from '../../src/contributions/menuContribution';
import { ContextKeyService } from '../../src/context/contextKey';
import * as BUILTIN from '../../src/workbench/builtinManifests';
import { EXPLORER_MANIFEST } from '../../src/workbench/builtinManifests';
import { globSync } from 'glob';
import type { IToolDescription, IToolManifest } from '../../src/tools/toolManifest';

const root = resolve(__dirname, '../..');
const atelierManifest = JSON.parse(readFileSync(resolve(root, 'ext/media-organizer/parallx-manifest.json'), 'utf8')) as IToolManifest;

const desc = (manifest: IToolManifest): IToolDescription => ({ manifest, toolPath: '/t', isBuiltin: true } as IToolDescription);

function setup() {
  const menus = new MenuContributionProcessor({} as never);
  const keys = new ContextKeyService();
  const active = keys.createKey<string | undefined>('activeViewContainer', undefined);
  menus.setContextKeyService(keys);
  return { menus, active };
}

const ids = (menus: MenuContributionProcessor) => menus.getViewContainerTitleItems().map((m) => `${m.commandId}=${m.title}`);

describe('sidebar More Actions (viewContainer/title)', () => {
  it('lists the showing container\'s items, in order', () => {
    const { menus, active } = setup();
    menus.processContributions(desc(EXPLORER_MANIFEST));
    menus.processContributions(desc(atelierManifest));
    active.set('explorer-container');
    expect(ids(menus)).toEqual(['explorer.collapse=Collapse All', 'explorer.refresh=Refresh']);
    active.set('media-organizer-container');
    expect(menus.getViewContainerTitleItems().map((m) => m.commandId)).toEqual([
      'media-organizer.rescan', 'media-organizer.importFiles', 'media-organizer.createAlbum',
      'media-organizer.showShortcuts', // Find Duplicates left the menu: the sidebar's Duplicates row opens the finder
    ]);
    active.set('some-other-container');
    expect(ids(menus)).toEqual([]);
  });

  it('a tool turned off takes its items', () => {
    const { menus, active } = setup();
    menus.processContributions(desc(atelierManifest));
    active.set('media-organizer-container');
    expect(ids(menus).length).toBeGreaterThan(0);
    menus.removeContributions(atelierManifest.id);
    expect(ids(menus)).toEqual([]);
  });

  it('every sidebar container offers something of its own', () => {
    const extManifests = globSync('ext/*/parallx-manifest.json', { cwd: root })
      .map((f) => JSON.parse(readFileSync(resolve(root, f), 'utf8')) as IToolManifest);
    const builtins = Object.values(BUILTIN) as IToolManifest[];
    const bare: string[] = [];
    for (const manifest of [...builtins, ...extManifests]) {
      const { menus, active } = setup();
      menus.processContributions(desc(manifest));
      for (const c of manifest.contributes?.viewContainers ?? []) {
        if (c.location !== 'sidebar') continue;
        active.set(c.id);
        if (menus.getViewContainerTitleItems().length === 0) bare.push(c.id);
      }
    }
    expect(bare).toEqual([]);
  });

  it('the workbench header names no tool', () => {
    const src = readFileSync(resolve(root, 'src/workbench/workbench.ts'), 'utf8');
    expect(src).not.toMatch(/media-organizer\.rescan|'media-organizer-container'/);
  });
});
