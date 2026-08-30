// lazyActivationCompliance.test.ts — the lazy-activation trap canary.
//
// Field lesson (Phase D step 9, 2026-08-29): every workbench view
// pre-materializes at boot — the core sidebar loop createViewSync's its
// views, and contributed views materialize in _addViewToContainer the
// moment their manifest processes. `onView:` therefore CANNOT fire
// lazily; a built-in declaring it as its only wake path sleeps forever
// and its view shows a placeholder for eternity (the broken Search).
//
// Until deferred view materialization exists, this canary holds the line:
// a built-in may be lazy ONLY through onCommand (the command proxy is the
// proven wake path), and any built-in that owns views must be eager.

import { describe, it, expect } from 'vitest';
import * as manifests from '../../src/tools/builtinManifests.js';
import type { IToolManifest } from '../../src/tools/toolManifest.js';

function allBuiltinManifests(): IToolManifest[] {
  return Object.entries(manifests)
    .filter(([name]) => name.endsWith('_MANIFEST'))
    .map(([, m]) => m as IToolManifest);
}

describe('lazy activation compliance — onView is inert until views defer', () => {
  it('no built-in manifest declares onView (views pre-materialize at boot)', () => {
    const offenders = allBuiltinManifests()
      .filter((m) => m.activationEvents.some((e) => e.startsWith('onView:')))
      .map((m) => m.id);
    expect(offenders, 'onView cannot wake a tool today — see this file’s header').toEqual([]);
  });

  it('a lazy built-in (no *, no onStartupFinished) owns no views and wakes on commands', () => {
    for (const m of allBuiltinManifests()) {
      const eager = m.activationEvents.some((e) => e === '*' || e === 'onStartupFinished');
      if (eager) continue;
      expect(
        m.activationEvents.length,
        `${m.id} declares no activation events at all — it can never wake`,
      ).toBeGreaterThan(0);
      expect(
        m.activationEvents.every((e) => e.startsWith('onCommand:')),
        `${m.id} is lazy but not purely command-woken`,
      ).toBe(true);
      expect(
        (m.contributes?.views ?? []).length,
        `${m.id} is lazy but contributes views, which would placeholder forever`,
      ).toBe(0);
    }
  });

  it('the one intended lazy pilot stays lazy: the Appearance editor wakes on its command', () => {
    const theme = allBuiltinManifests().find((m) => m.id === 'parallx.theme-editor');
    expect(theme?.activationEvents).toEqual(['onCommand:theme-editor.open']);
  });

  it('search and the gallery are eager again (the field-broken pair)', () => {
    const byId = new Map(allBuiltinManifests().map((m) => [m.id, m]));
    expect(byId.get('parallx.search')?.activationEvents).toEqual(['onStartupFinished']);
    expect(byId.get('parallx.tool-gallery')?.activationEvents).toEqual(['onStartupFinished']);
  });
});
