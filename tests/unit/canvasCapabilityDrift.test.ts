/**
 * canvasCapabilityDrift.test.ts — Pin BG_CAPABLE_TYPES ↔ BLOCK_BG_TYPES
 *
 * The canvas gate architecture forbids `blockLifecycle.ts` (BSR) from
 * importing `extensions/blockBackground.ts`, so each side keeps its own
 * copy of the list of block types that accept a `backgroundColor`
 * attribute.  This test fails if the two lists ever drift.
 *
 * If you change one list, change the other.  The two lists are the
 * single source of truth for "which blocks can have a background color"
 * and they MUST stay identical.
 */

import { describe, it, expect } from 'vitest';
import { BLOCK_BG_TYPES } from '../../src/built-in/canvas/extensions/blockBackground.js';
import { BG_CAPABLE_TYPES } from '../../src/built-in/canvas/config/blockStateRegistry/blockLifecycle.js';

describe('canvas capability drift', () => {
  it('BG_CAPABLE_TYPES (BSR) === BLOCK_BG_TYPES (extension)', () => {
    expect([...BG_CAPABLE_TYPES].sort()).toEqual([...BLOCK_BG_TYPES].sort());
  });
});
