// moEditGenerate.test.ts — the Generate tab's arithmetic (ext/media-organizer/
// edit-generate.js): the size the model works at, the area it is shown, the
// box round a brushed mark, and where the script's patch lands in the photo.
// engine/generate.py holds the same limits; the two must agree.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — JS module with no types
import { MO_GENERATE_STARTS, moGenCutOut, moGenModelSize, moGenPatchBox, moGenStrokesBox } from '../../ext/media-organizer/edit-generate.js';

describe('the size the model works at', () => {
  it('keeps a cut-out that fits at its own size, in 16s', () => {
    expect(moGenModelSize(1590, 1110)).toEqual({ w: 1584, h: 1104 });
  });

  it('scales a large one down to the model\'s limits', () => {
    for (const [w, h] of [[8687, 2416], [4000, 4000], [12590, 4732]]) {
      const s = moGenModelSize(w, h);
      expect(s.w % 16).toBe(0);
      expect(s.h % 16).toBe(0);
      expect(Math.max(s.w, s.h)).toBeLessThanOrEqual(2048);
      expect(s.w * s.h).toBeLessThanOrEqual(4_100_000);
    }
    expect(moGenModelSize(8687, 2416)).toEqual({ w: 2048, h: 576 });
  });

  it('enlarges a small one so the model has something to work on', () => {
    expect(moGenModelSize(300, 200)).toEqual({ w: 1024, h: 688 });
  });

  it('uses the limits the script uses', () => {
    const py = readFileSync(resolve(__dirname, '..', '..', 'ext', 'media-organizer', 'engine', 'generate.py'), 'utf8');
    expect(py).toMatch(/^MAX_SIDE = 2048\b/m);
    expect(py).toMatch(/^MAX_PIXELS = 4_000_000\b/m);
    expect(py).toMatch(/^MIN_SIDE = 1024\b/m);
  });
});

describe('the area the model is shown', () => {
  it('is the mark and as much again around it', () => {
    expect(moGenCutOut({ x: 5560, y: 1930, w: 530, h: 370 }, 8687, 3647)).toEqual({ x: 5030, y: 1560, w: 1590, h: 1110 });
  });

  it('stops at the photo\'s edges', () => {
    expect(moGenCutOut({ x: 10, y: 20, w: 300, h: 300 }, 1000, 800)).toEqual({ x: 0, y: 0, w: 610, h: 620 });
  });

  it('gives a band across the photo (a sky) only what borders it', () => {
    expect(moGenCutOut({ x: 0, y: 0, w: 8687, h: 1790 }, 8687, 3647)).toEqual({ x: 0, y: 0, w: 8687, h: 2416 });
  });

  it('is the whole photo for the whole photo', () => {
    expect(moGenCutOut({ x: 0, y: 0, w: 4000, h: 3000 }, 4000, 3000)).toEqual({ x: 0, y: 0, w: 4000, h: 3000 });
  });
});

describe('a brushed mark', () => {
  it('has a box round its strokes, brush included, inside the photo', () => {
    expect(moGenStrokesBox([{ pts: [[100, 100], [200, 150]], r: 20 }], 1000, 800)).toEqual({ x: 80, y: 80, w: 140, h: 90 });
    expect(moGenStrokesBox([{ pts: [[5, 5]], r: 30 }], 1000, 800)).toEqual({ x: 0, y: 0, w: 35, h: 35 });
  });

  it('is nothing when nothing was brushed', () => {
    expect(moGenStrokesBox([], 1000, 800)).toBeNull();
  });
});

describe('where the patch lands', () => {
  it('is the script\'s box moved to the cut-out\'s place when the piece was sent at its own size', () => {
    expect(moGenPatchBox([0, 0, 1584, 1104], { x: 5030, y: 1560, w: 1584, h: 1104 }, { w: 1584, h: 1104 })).toEqual({ x: 5030, y: 1560, w: 1584, h: 1104 });
  });

  it('is scaled back up when the piece was sent smaller', () => {
    const box = moGenPatchBox([0, 0, 2048, 576], { x: 0, y: 0, w: 8687, h: 2416 }, { w: 2048, h: 576 });
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.w).toBe(8687);
    expect(box.h).toBe(2416);
  });

  it('follows a box the script cut inside the piece', () => {
    expect(moGenPatchBox([100, 50, 900, 650], { x: 1000, y: 2000, w: 2048, h: 1408 }, { w: 1024, h: 704 })).toEqual({ x: 1200, y: 2100, w: 1600, h: 1200 });
  });
});

describe('the ready-made starts', () => {
  it('are in Title Case and end where the user carries on', () => {
    for (const [label, text, icon] of MO_GENERATE_STARTS) {
      expect(icon).toMatch(/^[a-z-]+$/);
      expect(label).toMatch(/^([A-Z][a-z]*)( [A-Z][a-z]*)*$/);
      expect(text.length).toBeGreaterThan(10);
    }
  });
});
