/**
 * Foundation step 6 — one contribution point.
 *
 * Four declaration shapes, one meaning. These tests pin the translation and,
 * more importantly, the compatibility promise: an extension written before the
 * foundation changed keeps working, and its old region becomes its new default
 * placement rather than a constraint.
 */

import { describe, expect, it } from 'vitest';
import {
  readSurfaceContributions,
  deprecatedSurfacePoints,
} from '../../src/surfaces/surfaceContribution';
import { SurfacePlacement } from '../../src/surfaces/surfaceTypes';
import type { IManifestContributions } from '../../src/tools/toolManifest';

const read = (c: IManifestContributions) => readSurfaceContributions(c, 'test.tool');

describe('reading explicit surfaces', () => {
  it('takes typeId, name, placement, bindings and instances', () => {
    const [s] = read({
      surfaces: [{
        typeId: 'flashcards.study', name: 'Study', icon: 'layers',
        placement: 'side', bindingKinds: ['deck'], instances: 'single',
      }],
    });
    expect(s).toMatchObject({
      typeId: 'flashcards.study',
      name: 'Study',
      icon: 'layers',
      placement: SurfacePlacement.Side,
      bindingKinds: ['deck'],
      instances: 'single',
      source: 'surfaces',
    });
  });

  it('defaults to a centre-placed, bindingless, multi-instance surface', () => {
    const [s] = read({ surfaces: [{ typeId: 'x', name: 'X' }] });
    expect(s.placement).toBe(SurfacePlacement.Center);
    expect(s.bindingKinds).toEqual([]);
    expect(s.instances).toBe('many');
  });

  it('falls back to centre on an unknown placement rather than dropping the surface', () => {
    // A typo in a manifest should cost a preference, not the whole surface.
    const [s] = read({
      surfaces: [{ typeId: 'x', name: 'X', placement: 'starboard' as never }],
    });
    expect(s.placement).toBe(SurfacePlacement.Center);
  });

  it('skips declarations missing a typeId or name', () => {
    expect(read({
      surfaces: [
        { typeId: '', name: 'X' },
        { typeId: 'y', name: '' },
        { typeId: 'z', name: 'Z' },
      ] as never,
    })).toHaveLength(1);
  });
});

describe('legacy points still work', () => {
  it('reads a view as a side-placed, bindingless, single-instance surface', () => {
    // What a view always was. Single instance because the old model had
    // exactly one per container — promoting them to 'many' would change
    // behaviour under extensions that never asked for it.
    const [s] = read({
      views: [{ id: 'explorer.tree', name: 'Explorer', icon: 'folder' }] as never,
    });
    expect(s).toMatchObject({
      typeId: 'explorer.tree',
      name: 'Explorer',
      placement: SurfacePlacement.Side,
      bindingKinds: [],
      instances: 'single',
      source: 'views',
    });
  });

  it('reads an editor as a centre-placed surface with no claimed binding kind', () => {
    // The old point never said what KIND of input an editor takes — most of
    // the real ones open pages and decks, not files — so no kind is claimed.
    // "Open with" simply does not offer it until the tool migrates to
    // `surfaces` and declares its true kinds, which is honest rather than
    // wrong.
    const [s] = read({
      editors: [{ typeId: 'canvas', displayName: 'Canvas' }] as never,
    });
    expect(s).toMatchObject({
      typeId: 'canvas',
      name: 'Canvas',
      placement: SurfacePlacement.Center,
      bindingKinds: [],
      instances: 'many',
      source: 'editors',
    });
  });

  it('reads a panel-homed view as a Bottom-placed surface', () => {
    // A view's real home was its CONTAINER's location. A terminal in a panel
    // container was a bottom strip; first-opening it at the side would move
    // every panel extension's furniture in the same release the foundation
    // promised not to.
    const all = read({
      viewContainers: [{ id: 'tool.panel', title: 'Output', location: 'panel' }] as never,
      views: [{ id: 'tool.output', name: 'Output', defaultContainerId: 'tool.panel' }] as never,
    });
    expect(all).toHaveLength(1);
    expect(all[0].placement).toBe(SurfacePlacement.Bottom);
  });

  it('falls back to the container icon when the view has none', () => {
    // Icons mostly lived on viewContainers in real manifests; dropping them
    // would strip every migrated extension's identity from the tab.
    const [s] = read({
      viewContainers: [{ id: 'c', title: 'C', location: 'sidebar', icon: 'beaker' }] as never,
      views: [{ id: 'v', name: 'V', defaultContainerId: 'c' }] as never,
    });
    expect(s.icon).toBe('beaker');
  });

  it('survives malformed contribution shapes without throwing', () => {
    // The validator warns the author; the reader must never turn a bad
    // manifest into a TypeError inside the workbench.
    expect(read({ surfaces: {} as never })).toEqual([]);
    expect(read({ surfaces: [null, 42, { typeId: 'ok', name: 'Ok' }] as never })).toHaveLength(1);
    expect(read({ views: 'nope' as never, editors: [null] as never })).toEqual([]);
  });

  it('names an editor by its typeId when no displayName is given', () => {
    const [s] = read({ editors: [{ typeId: 'budget.editor' }] as never });
    expect(s.name).toBe('budget.editor');
  });

  it('reads views and editors from the same manifest', () => {
    const all = read({
      views: [{ id: 'v1', name: 'V' }] as never,
      editors: [{ typeId: 'e1', displayName: 'E' }] as never,
    });
    expect(all.map((s) => s.typeId).sort()).toEqual(['e1', 'v1']);
  });

  it('returns nothing for a manifest that contributes no surfaces', () => {
    expect(read({ commands: [] as never })).toEqual([]);
    expect(readSurfaceContributions(undefined, 't')).toEqual([]);
  });
});

describe('an explicit surface wins over the legacy shape it replaces', () => {
  it('keeps the new declaration when both name the same typeId', () => {
    // A tool mid-migration may declare a surface AND still carry the view it
    // replaces. The new declaration is the one it means.
    const all = read({
      surfaces: [{ typeId: 'explorer.tree', name: 'Explorer', placement: 'center' }],
      views: [{ id: 'explorer.tree', name: 'Old Explorer' }] as never,
    });
    expect(all).toHaveLength(1);
    expect(all[0].placement).toBe(SurfacePlacement.Center);
    expect(all[0].source).toBe('surfaces');
  });

  it('does not duplicate a typeId declared twice in one point', () => {
    const all = read({
      surfaces: [
        { typeId: 'x', name: 'First' },
        { typeId: 'x', name: 'Second' },
      ],
    });
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('First');
  });
});

describe('deprecation reporting', () => {
  it('names the legacy points a manifest still uses', () => {
    expect(deprecatedSurfacePoints({
      views: [{ id: 'v' }] as never,
      editors: [{ typeId: 'e' }] as never,
    })).toEqual(['views', 'editors']);
  });

  it('says nothing about a migrated manifest', () => {
    // A tool that has already moved should hear no warning at all.
    expect(deprecatedSurfacePoints({
      surfaces: [{ typeId: 'x', name: 'X' }],
    })).toEqual([]);
    expect(deprecatedSurfacePoints(undefined)).toEqual([]);
  });

  it('ignores empty legacy arrays', () => {
    expect(deprecatedSurfacePoints({ views: [], editors: [] })).toEqual([]);
  });
});
