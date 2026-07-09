/**
 * canvasCapabilityDrift.test.ts — Canary for registry-derived capability sets
 *
 * The scattered per-file capability lists are gone: config/blockRegistry.ts
 * owns BLOCK_BG_TYPES (single source, fed to the Tiptap extension via
 * `BlockBackgroundColor.configure({ types })` and read lazily by the
 * blockLifecycle predicates), and the nesting container sets are DERIVED
 * from registry kinds/shapes.  These canaries fail if a registry edit
 * accidentally drops a core capability.
 */

import { describe, it, expect } from 'vitest';
import {
  BLOCK_BG_TYPES,
  INDENT_CONTAINER_TYPES,
  CONTENT_WRAPPER_TYPES,
  ATOM_BLOCK_TYPES,
} from '../../src/built-in/canvas/config/blockRegistry.js';
import {
  canTakeBackgroundColor,
  canTakeTextColor,
  canTurnInto,
} from '../../src/built-in/canvas/config/blockStateRegistry/blockLifecycle.js';

describe('canvas capability canaries (registry-derived)', () => {
  it('BLOCK_BG_TYPES keeps the core colourable set (incl. list rows)', () => {
    for (const t of [
      'paragraph', 'heading', 'blockquote', 'codeBlock', 'callout', 'details',
      'bulletList', 'orderedList', 'taskList', 'listItem', 'taskItem',
    ]) {
      expect(BLOCK_BG_TYPES, `missing ${t}`).toContain(t);
    }
  });

  it('lifecycle predicates read the same single source', () => {
    for (const t of BLOCK_BG_TYPES) {
      expect(canTakeBackgroundColor(t), `bg ${t}`).toBe(true);
      expect(canTakeTextColor(t), `text ${t}`).toBe(true);
      expect(canTurnInto(t), `turn ${t}`).toBe(true);
    }
    expect(canTakeBackgroundColor('image')).toBe(false);
    expect(canTurnInto('image')).toBe(false);
    expect(canTakeTextColor('toggleHeading')).toBe(true);
  });

  it('indent containers derive from kind:container definitions', () => {
    expect([...INDENT_CONTAINER_TYPES].sort()).toEqual(
      ['blockquote', 'callout', 'details', 'toggleHeading'],
    );
    expect([...CONTENT_WRAPPER_TYPES].sort()).toEqual(['details', 'toggleHeading']);
  });

  it('atom set derives from kind:atom definitions (unit resolution)', () => {
    for (const t of ['mathBlock', 'image', 'bookmark']) {
      expect(ATOM_BLOCK_TYPES.has(t), `atom ${t}`).toBe(true);
    }
    expect(ATOM_BLOCK_TYPES.has('paragraph')).toBe(false);
  });
});
