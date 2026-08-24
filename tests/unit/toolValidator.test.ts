/**
 * Manifest validation for the surfaces contribution point.
 *
 * The gap these pin: a point the validator does not know is only WARNED as
 * unknown, so a malformed `contributes.surfaces` used to sail through
 * validation and become a TypeError inside readSurfaceContributions instead.
 * Validation is where a bad manifest is supposed to cost its author a
 * message; the reader downstream stays defensive but silent.
 */

import { describe, expect, it } from 'vitest';
import { validateManifest } from '../../src/tools/toolValidator';

const manifest = (contributes: unknown): unknown => ({
  manifestVersion: 1,
  id: 'test.tool',
  name: 'Test Tool',
  version: '1.0.0',
  publisher: 'test',
  main: 'main.js',
  activationEvents: [],
  engines: { parallx: '^0.1.0' },
  contributes,
});

describe('contributes.surfaces validation', () => {
  it('accepts a well-formed surface declaration without warnings', () => {
    const r = validateManifest(manifest({
      surfaces: [{
        typeId: 'flashcards.study', name: 'Study', icon: 'layers',
        placement: 'side', bindingKinds: ['deck'], instances: 'single',
      }],
    }));
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('does not call the surfaces point unknown', () => {
    const r = validateManifest(manifest({ surfaces: [] }));
    expect(r.warnings.filter((w) => w.message.includes('Unknown contribution point'))).toEqual([]);
  });

  it('rejects a non-array surfaces point', () => {
    const r = validateManifest(manifest({ surfaces: {} }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === 'contributes.surfaces')).toBe(true);
  });

  it('rejects entries missing typeId or name', () => {
    const r = validateManifest(manifest({
      surfaces: [null, { typeId: 'x' }, { name: 'No Id' }],
    }));
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('warns on an unknown placement instead of failing the manifest', () => {
    // A typo costs a preference, not the extension.
    const r = validateManifest(manifest({
      surfaces: [{ typeId: 'x', name: 'X', placement: 'starboard' }],
    }));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => w.path.endsWith('.placement'))).toBe(true);
  });

  it('treats editors and statusBar as known points too', () => {
    // Both predate surfaces and were already real; warning "unknown, will be
    // ignored" about a point the app reads is the validator lying.
    const r = validateManifest(manifest({
      editors: [{ typeId: 'canvas' }],
      statusBar: [],
    }));
    expect(r.warnings.filter((w) => w.message.includes('Unknown contribution point'))).toEqual([]);
  });

  it('validates editor entries for a typeId', () => {
    const r = validateManifest(manifest({ editors: [{}] }));
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path.includes('editors[0]'))).toBe(true);
  });
});
