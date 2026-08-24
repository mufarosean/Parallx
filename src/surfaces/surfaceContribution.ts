// surfaceContribution.ts — four declaration shapes, one meaning
//
// Foundation Decision 6 (docs/FOUNDATION.md). `contributes.views`,
// `viewContainers`, `editors` and the dashboard widget API all declared "a
// thing that renders", each with a hardcoded home. This reads every one of
// them as a surface.
//
// The legacy points are deprecated rather than removed. An extension should
// not have to be rewritten in the same release the foundation changes under
// it, and every one of them maps cleanly — the old region simply becomes the
// new default placement, which was all it ever really was.
//
// Pure: manifest in, descriptor stubs out. Nothing is registered here and no
// factory is invented; the owning tool still supplies `create` at activation,
// because only the tool knows how to build its own content.

import { SurfacePlacement } from './surfaceTypes.js';
import type { IManifestContributions } from '../tools/toolManifest.js';

/**
 * A surface declaration read from a manifest, before the tool supplies its
 * factory. Mirrors ISurfaceDescriptor minus `create`.
 */
export interface ISurfaceContribution {
  readonly typeId: string;
  readonly name: string;
  readonly icon?: string;
  readonly placement: SurfacePlacement;
  readonly bindingKinds: readonly string[];
  readonly instances: 'single' | 'many';
  readonly when?: string;
  /**
   * Which declaration this came from. Kept so a deprecation warning can name
   * the point to migrate, and so the workbench can tell an intentional surface
   * from one inferred out of a legacy shape.
   */
  readonly source: 'surfaces' | 'views' | 'editors';
}

function parsePlacement(raw: string | undefined, fallback: SurfacePlacement): SurfacePlacement {
  switch (raw) {
    case 'center': return SurfacePlacement.Center;
    case 'side': return SurfacePlacement.Side;
    case 'bottom': return SurfacePlacement.Bottom;
    default: return fallback;
  }
}

/**
 * Read every renderable contribution in a manifest as a surface.
 *
 * Order matters: explicit `surfaces` win. A tool mid-migration may declare a
 * surface AND still carry the legacy view it replaces, and the new declaration
 * is the one it means.
 */
export function readSurfaceContributions(
  contributes: IManifestContributions | undefined,
  toolId: string,
): readonly ISurfaceContribution[] {
  if (!contributes) return [];

  const out: ISurfaceContribution[] = [];
  const seen = new Set<string>();

  const add = (c: ISurfaceContribution): void => {
    if (seen.has(c.typeId)) return;
    seen.add(c.typeId);
    out.push(c);
  };

  // Manifests are author-written JSON; a wrong-typed point must cost the
  // author a warning (the validator's job), never a TypeError here.
  const arr = <T>(v: readonly T[] | undefined): readonly T[] =>
    Array.isArray(v) ? v : [];
  const isRecord = (v: unknown): boolean => !!v && typeof v === 'object';

  for (const s of arr(contributes.surfaces)) {
    if (!isRecord(s)) continue;
    if (typeof s.typeId !== 'string' || !s.typeId) continue;
    if (typeof s.name !== 'string' || !s.name) continue;
    add({
      typeId: s.typeId,
      name: s.name,
      ...(typeof s.icon === 'string' && s.icon ? { icon: s.icon } : {}),
      placement: parsePlacement(s.placement, SurfacePlacement.Center),
      bindingKinds: Array.isArray(s.bindingKinds)
        ? s.bindingKinds.filter((k): k is string => typeof k === 'string')
        : [],
      instances: s.instances === 'single' ? 'single' : 'many',
      ...(typeof s.when === 'string' && s.when ? { when: s.when } : {}),
      source: 'surfaces',
    });
  }

  // A view's real home was its CONTAINER's declared location — a terminal
  // view in a panel container was a bottom strip, not a side one — and its
  // icon usually lived on the container too. Read the containers first so
  // both survive the translation.
  const containers = new Map<string, { location?: string; icon?: string }>();
  for (const vc of arr(contributes.viewContainers)) {
    if (!isRecord(vc) || typeof vc.id !== 'string') continue;
    containers.set(vc.id, {
      ...(typeof vc.location === 'string' ? { location: vc.location } : {}),
      ...(typeof vc.icon === 'string' ? { icon: vc.icon } : {}),
    });
  }

  // A view was always a bindingless, single-instance surface. Single because
  // the old model had exactly one instance of a view per container —
  // promoting them to 'many' would change behaviour under extensions that
  // never asked for it.
  for (const v of arr(contributes.views)) {
    if (!isRecord(v)) continue;
    if (typeof v.id !== 'string' || !v.id) continue;
    const container = v.defaultContainerId ? containers.get(v.defaultContainerId) : undefined;
    const icon = (typeof v.icon === 'string' && v.icon) ? v.icon : container?.icon;
    add({
      typeId: v.id,
      name: typeof v.name === 'string' && v.name ? v.name : v.id,
      ...(icon ? { icon } : {}),
      placement: container?.location === 'panel'
        ? SurfacePlacement.Bottom
        : SurfacePlacement.Side,
      bindingKinds: [],
      instances: 'single',
      ...(typeof v.when === 'string' && v.when ? { when: v.when } : {}),
      source: 'views',
    });
  }

  // An editor was always a Center-placed surface over an input, but the
  // manifest never said WHICH kind of input — most of the app's real editors
  // open pages, decks and dashboards, not files — so no binding kind is
  // claimed here. The tool declares its true kinds when it migrates to
  // `surfaces`; until then "open with" simply does not offer it, which is
  // honest rather than wrong.
  for (const e of arr(contributes.editors)) {
    if (!isRecord(e)) continue;
    if (typeof e.typeId !== 'string' || !e.typeId) continue;
    add({
      typeId: e.typeId,
      name: typeof e.displayName === 'string' && e.displayName ? e.displayName : e.typeId,
      placement: SurfacePlacement.Center,
      bindingKinds: [],
      instances: 'many',
      source: 'editors',
    });
  }

  void toolId;
  return out;
}

/**
 * Legacy points a manifest still uses, for a one-line deprecation notice.
 *
 * Reported rather than warned on directly: the workbench decides whether a
 * console line is warranted, and a tool that has already migrated should hear
 * nothing at all.
 */
export function deprecatedSurfacePoints(
  contributes: IManifestContributions | undefined,
): readonly string[] {
  if (!contributes) return [];
  const points: string[] = [];
  if (contributes.views?.length) points.push('views');
  if (contributes.viewContainers?.length) points.push('viewContainers');
  if (contributes.editors?.length) points.push('editors');
  return points;
}
