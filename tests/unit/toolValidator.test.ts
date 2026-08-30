/**
 * Manifest validation for contribution points the validator must know.
 *
 * The gap these pin: a point the validator does not know is only WARNED as
 * unknown, so a malformed declaration used to sail through validation and
 * become a TypeError in the reader downstream instead. Validation is where
 * a bad manifest is supposed to cost its author a message.
 *
 * (The `contributes.surfaces` suite that used to live here was deleted with
 * the point itself — Retirement Part 4b retired the unmounted surfaces
 * layer, and an unknown `surfaces` key now correctly warns.)
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

describe('contribution point validation', () => {
  it('warns that the retired surfaces point is unknown', () => {
    const r = validateManifest(manifest({ surfaces: [] }));
    expect(r.warnings.some((w) => w.message.includes('Unknown contribution point'))).toBe(true);
  });

  it('treats editors and statusBar as known points', () => {
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
