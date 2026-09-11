/**
 * Moving parts in a capture (electron/browserAutomationBroker.cjs): a GIF, a
 * video or an animation changes pixels on its own, so click_at's check of the
 * pictured region leaves those blocks out and still refuses any change in the
 * static rest. Seen live: an animated confetti GIF made every capture stale.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../../electron/browserAutomationBroker.cjs') as {
  markChangedBlocks(a: Buffer, b: Buffer, width: number, height: number, block: number, cols: number, mask: Uint8Array): Uint8Array;
  staticPixelsMatch(a: Buffer, b: Buffer, width: number, region: { x: number; y: number; width: number; height: number }, motion: { block: number; cols: number; mask: Uint8Array }): boolean;
  targetMovesOnlyNow(moving: Uint8Array, had: Uint8Array | null, cols: number, region: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }, block: number, maxShare: number): boolean;
};

const W = 32; const H = 16; const BLOCK = 8; const COLS = W / BLOCK; const ROWS = H / BLOCK;
const bitmap = () => Buffer.alloc(W * H * 4, 200);
const paint = (bm: Buffer, x: number, y: number) => { const i = (y * W + x) * 4; bm[i] = 1; bm[i + 1] = 2; bm[i + 2] = 3; };

describe('moving parts in a capture', () => {
  it('marks only the blocks whose pixels changed', () => {
    const a = bitmap(); const b = bitmap();
    paint(b, 9, 3);   // block (1, 0)
    paint(b, 30, 15); // block (3, 1)
    const mask = B.markChangedBlocks(a, b, W, H, BLOCK, COLS, new Uint8Array(COLS * ROWS));
    expect([...mask]).toEqual([0, 1, 0, 0, 0, 0, 0, 1]);
  });

  it('ignores changes in moving blocks and refuses any change in a static one', () => {
    const motion = { block: BLOCK, cols: COLS, mask: Uint8Array.from([0, 1, 0, 0, 0, 0, 0, 0]) };
    const whole = { x: 0, y: 0, width: W, height: H };
    const a = bitmap(); const b = bitmap();
    paint(b, 12, 5); // inside the moving block
    expect(B.staticPixelsMatch(a, b, W, whole, motion)).toBe(true);
    paint(b, 20, 5); // a static block
    expect(B.staticPixelsMatch(a, b, W, whole, motion)).toBe(false);
    // A change outside the checked region does not count.
    expect(B.staticPixelsMatch(a, b, W, { x: 0, y: 0, width: 16, height: H }, motion)).toBe(true);
  });

  it('with nothing moving, any change at all is a change', () => {
    const still = { block: BLOCK, cols: COLS, mask: new Uint8Array(COLS * ROWS) };
    const a = bitmap(); const b = bitmap();
    expect(B.staticPixelsMatch(a, b, W, { x: 0, y: 0, width: W, height: H }, still)).toBe(true);
    paint(b, 0, 0);
    expect(B.staticPixelsMatch(a, b, W, { x: 0, y: 0, width: W, height: H }, still)).toBe(false);
  });

  it('a target that starts moving only at click time refuses; a small part the capture missed does not', () => {
    const whole = { x: 0, y: 0, width: W, height: H };
    const none = new Uint8Array(COLS * ROWS);
    const point = { x: 2, y: 2 }; // block (0, 0)
    // One block beside the point moved only now: 1 of 8.
    expect(B.targetMovesOnlyNow(Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 0]), none, COLS, whole, point, BLOCK, 0.3)).toBe(false);
    // The point's own block moved only now: something is coming in over the target.
    expect(B.targetMovesOnlyNow(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]), none, COLS, whole, point, BLOCK, 0.3)).toBe(true);
    // Unless the capture already saw it moving: an animation under the point.
    expect(B.targetMovesOnlyNow(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]), Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0]), COLS, whole, point, BLOCK, 0.3)).toBe(false);
    // Most of the region moving only now: a slide or a dialog coming in.
    expect(B.targetMovesOnlyNow(Uint8Array.from([0, 1, 1, 1, 0, 0, 0, 0]), none, COLS, whole, point, BLOCK, 0.3)).toBe(true);
  });
});
