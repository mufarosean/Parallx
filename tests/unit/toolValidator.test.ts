/**
 * Pin-the-invariant: tool manifest validator (M82 §11 additive-only contract).
 *
 * `validateManifest()` in src/tools/toolValidator.ts is the gatekeeper for every
 * extension manifest that the shell loads. Per M82 §11 the contract is:
 *   - Required fields enforced strictly (errors when missing/wrong type)
 *   - Unknown top-level / contribution-point fields → WARNINGS, not errors
 *     (forward compatibility — newer manifests may carry fields the current
 *     shell ignores; they must still load)
 *   - Engine compatibility (`engines.parallx`) enforces caret / tilde / >= /
 *     exact-or-higher semver semantics
 *
 * No pre-existing test covers this validator. The contract is load-bearing:
 * a future refactor that silently turned "unknown field" into an error would
 * break every newer-than-shell extension on update.
 */

import { describe, expect, it } from 'vitest';
import { validateManifest, PARALLX_VERSION } from '../../src/tools/toolValidator';
import { CURRENT_MANIFEST_VERSION } from '../../src/tools/toolManifest';

function baseManifest(): Record<string, unknown> {
  return {
    manifestVersion: CURRENT_MANIFEST_VERSION,
    id: 'pin.test',
    name: 'Pin Test',
    version: '1.0.0',
    publisher: 'parallx',
    main: 'dist/main.js',
    activationEvents: ['onStartupFinished'],
    engines: { parallx: '*' },
  };
}

describe('validateManifest — core required fields', () => {
  it('accepts a minimal valid manifest', () => {
    const r = validateManifest(baseManifest());
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('rejects null / undefined / non-object input', () => {
    expect(validateManifest(null).valid).toBe(false);
    expect(validateManifest(undefined).valid).toBe(false);
    expect(validateManifest('not a manifest').valid).toBe(false);
    expect(validateManifest(42).valid).toBe(false);
  });

  it('errors when required fields are missing', () => {
    const m: any = baseManifest();
    delete m.id;
    delete m.name;
    delete m.version;
    delete m.publisher;
    delete m.main;
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    const paths = new Set(r.errors.map(e => e.path));
    for (const p of ['id', 'name', 'version', 'publisher', 'main']) {
      expect(paths.has(p), `missing error for ${p}`).toBe(true);
    }
  });

  it('rejects manifestVersion mismatch', () => {
    const m = { ...baseManifest(), manifestVersion: CURRENT_MANIFEST_VERSION + 1 };
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'manifestVersion')).toBe(true);
  });

  it('rejects id with disallowed characters', () => {
    const m = { ...baseManifest(), id: 'has spaces' };
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'id')).toBe(true);
  });

  it('rejects non-semver version', () => {
    const m = { ...baseManifest(), version: 'not-a-version' };
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'version')).toBe(true);
  });
});

describe('validateManifest — activationEvents whitelist', () => {
  it('accepts every documented activation prefix', () => {
    const events = ['*', 'onStartupFinished', 'onCommand:my.cmd', 'onView:my.view'];
    const r = validateManifest({ ...baseManifest(), activationEvents: events });
    expect(r.valid).toBe(true);
  });

  it('rejects unknown activation event', () => {
    const r = validateManifest({ ...baseManifest(), activationEvents: ['onWebRequest:*'] });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path.startsWith('activationEvents['))).toBe(true);
  });

  it('rejects non-array activationEvents', () => {
    const r = validateManifest({ ...baseManifest(), activationEvents: 'onStartupFinished' as any });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'activationEvents')).toBe(true);
  });
});

describe('validateManifest — engines.parallx semver compatibility', () => {
  // PARALLX_VERSION is exported from toolValidator; the validator parses it via
  // _parseSemver(). We test relative to whatever the shell version is today.

  it('accepts "*" wildcard', () => {
    const r = validateManifest({ ...baseManifest(), engines: { parallx: '*' } });
    expect(r.valid).toBe(true);
  });

  it('accepts an exact match against PARALLX_VERSION', () => {
    const r = validateManifest({ ...baseManifest(), engines: { parallx: PARALLX_VERSION } });
    expect(r.valid).toBe(true);
  });

  it('rejects a major-version mismatch under caret range', () => {
    // PARALLX_VERSION is e.g. "0.2.0"; "^99.0.0" forces major mismatch.
    const r = validateManifest({ ...baseManifest(), engines: { parallx: '^99.0.0' } });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'engines.parallx')).toBe(true);
  });

  it('rejects when shell is below required >= version', () => {
    const r = validateManifest({ ...baseManifest(), engines: { parallx: '>=99.0.0' } });
    expect(r.valid).toBe(false);
  });

  it('errors when engines field is missing entirely', () => {
    const m: any = baseManifest();
    delete m.engines;
    const r = validateManifest(m);
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'engines')).toBe(true);
  });

  it('errors when engines.parallx is missing or empty', () => {
    const r1 = validateManifest({ ...baseManifest(), engines: {} });
    const r2 = validateManifest({ ...baseManifest(), engines: { parallx: '' } });
    expect(r1.valid).toBe(false);
    expect(r2.valid).toBe(false);
  });
});

describe('validateManifest — additive-only contract (M82 §11 forward compatibility)', () => {
  it('unknown top-level field produces a WARNING, not an error', () => {
    const r = validateManifest({ ...baseManifest(), futureSurfaceXYZ: { anything: true } });
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some(w => w.path === 'futureSurfaceXYZ')).toBe(true);
  });

  it('unknown contribution point produces a WARNING, not an error', () => {
    const r = validateManifest({
      ...baseManifest(),
      contributes: { someFutureSurface: { foo: 'bar' } },
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.some(w => w.path === 'contributes.someFutureSurface')).toBe(true);
  });

  it('multiple unknown fields each get their own warning', () => {
    const r = validateManifest({
      ...baseManifest(),
      futureA: 1,
      futureB: 2,
    });
    expect(r.valid).toBe(true);
    const paths = r.warnings.map(w => w.path);
    expect(paths).toContain('futureA');
    expect(paths).toContain('futureB');
  });
});

describe('validateManifest — contributions shapes', () => {
  it('validates contributes.views items', () => {
    const r = validateManifest({
      ...baseManifest(),
      contributes: { views: [{ id: 'v1', name: 'V1' }] },
    });
    expect(r.valid).toBe(true);

    const bad = validateManifest({
      ...baseManifest(),
      contributes: { views: [{ id: '' }] }, // missing name, empty id
    });
    expect(bad.valid).toBe(false);
  });

  it('validates contributes.viewContainers.location enum', () => {
    const ok = validateManifest({
      ...baseManifest(),
      contributes: { viewContainers: [{ id: 'c1', title: 'C1', location: 'sidebar' }] },
    });
    expect(ok.valid).toBe(true);

    const bad = validateManifest({
      ...baseManifest(),
      contributes: { viewContainers: [{ id: 'c1', title: 'C1', location: 'floor' }] },
    });
    expect(bad.valid).toBe(false);
  });

  it('validates contributes.commands requires id and title', () => {
    const ok = validateManifest({
      ...baseManifest(),
      contributes: { commands: [{ id: 'cmd', title: 'Cmd' }] },
    });
    expect(ok.valid).toBe(true);

    const bad = validateManifest({
      ...baseManifest(),
      contributes: { commands: [{ title: 'orphan' }] },
    });
    expect(bad.valid).toBe(false);
  });

  it('validates contributes.keybindings requires command + key', () => {
    const ok = validateManifest({
      ...baseManifest(),
      contributes: { keybindings: [{ command: 'cmd', key: 'ctrl+k' }] },
    });
    expect(ok.valid).toBe(true);

    const bad = validateManifest({
      ...baseManifest(),
      contributes: { keybindings: [{ command: 'cmd' }] },
    });
    expect(bad.valid).toBe(false);
  });

  it('validates contributes.menus is object-of-arrays-of-items-with-command', () => {
    const ok = validateManifest({
      ...baseManifest(),
      contributes: { menus: { 'view/title': [{ command: 'cmd' }] } },
    });
    expect(ok.valid).toBe(true);

    const bad = validateManifest({
      ...baseManifest(),
      contributes: { menus: { 'view/title': [{ when: 'always' }] } },
    });
    expect(bad.valid).toBe(false);
  });

  it('validates contributes.configuration.properties.type enum', () => {
    const ok = validateManifest({
      ...baseManifest(),
      contributes: {
        configuration: [{ title: 'Settings', properties: { foo: { type: 'string' } } }],
      },
    });
    expect(ok.valid).toBe(true);

    const bad = validateManifest({
      ...baseManifest(),
      contributes: {
        configuration: [{ title: 'Settings', properties: { foo: { type: 'date' } } }],
      },
    });
    expect(bad.valid).toBe(false);
  });
});
