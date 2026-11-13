// moEditGenerate.test.ts — the Generate tab's arithmetic (ext/media-organizer/
// edit-generate.js): the area it cuts out for the engine, the box round a
// brushed mark, and where a try's patch lands in the photo; and what
// engine/generate.py must go on doing with what it is handed, since no test
// here can run the model (tests/probes/generate-engine-check.py runs the
// script's own arithmetic and the real pipeline code on a stand-in model).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
// @ts-expect-error — JS module with no types
import { MO_GENERATE_STARTS, moGenCutOut, moGenPatchBox, moGenStrokesBox } from '../../ext/media-organizer/edit-generate.js';

const engine = (name: string) => readFileSync(resolve(__dirname, '..', '..', 'ext', 'media-organizer', 'engine', name), 'utf8');

describe('the engine script', () => {
  const py = engine('generate.py');
  const patch = engine('generate_patch.py');

  it('has the model read the photo at the size it paints its answer at', () => {
    // The model places things on a grid counted from the middle; two sizes put the answer out of step with the photo.
    expect(py).toMatch(/resolution = \(width \* height\) \*\* 0\.5/);
    expect(py).toMatch(/pipe\(\*\*call\)/);
    expect(py).toMatch(/image=small, height=height, width=width, output_resolution=resolution/);
    expect(py).toMatch(/gp\.reads_at\(width, height, resolution\) != \(width, height\)/);
  });

  it('holds the picture outside the mark at every step', () => {
    expect(py).toMatch(/kwargs\['latents'\] = hold\.after\(step, kwargs\['latents'\]\)/);
    expect(py).toMatch(/known = \(1 - sigma\) \* self\.photo\.to\(latents\.dtype\) \+ sigma \* self\.noise/);
    expect(py).toMatch(/torch\.where\(self\.free\.to\(latents\.device\), latents, known\)/);
  });

  it('tells the model where: the instruction is written out by a reader that is shown the mark', () => {
    expect(py).toMatch(/gp\.outlined\(small, mark_small\)/);
    expect(py).toMatch(/reader\.generate\(/);
    // A failure to write it out is not a failure of the edit: the words go as they were written.
    expect(py).toMatch(/'prompt_by': 'engine' if written else 'instruction'/);
  });

  it('sets no limit on the model beyond a guard against a reply that never ends', () => {
    expect(py.match(/max_new_tokens/g)).toHaveLength(1);
    expect(py).toMatch(/max_new_tokens=WRITER_GUARD/);
    expect(py).not.toMatch(/max_length|max_tokens\b/);
  });

  it('keeps the limits the check script runs against', () => {
    expect(patch).toMatch(/^MAX_SIDE = 2048\b/m);
    expect(patch).toMatch(/^MAX_PIXELS = 2_000_000\b/m);
    expect(patch).toMatch(/^MIN_SIDE = 1024\b/m);
  });

  it('cuts the area out by the rule the tab uses', () => {
    expect(patch).toMatch(/px, py = max\(256, w \/\/ 2\), max\(256, h \/\/ 2\)/);
    expect(patch).toMatch(/px, py = 0, max\(256, int\(h \* 0\.35\)\)/);
    expect(patch).toMatch(/px, py = max\(256, int\(w \* 0\.35\)\), 0/);
  });
});

describe('the area the model is shown', () => {
  it('is the mark and half as much again on each side', () => {
    expect(moGenCutOut({ x: 1000, y: 1000, w: 600, h: 400 }, 8000, 6000)).toEqual({ x: 700, y: 744, w: 1200, h: 912 });
    expect(moGenCutOut({ x: 3000, y: 2000, w: 2000, h: 1500 }, 8687, 5800)).toEqual({ x: 2000, y: 1250, w: 4000, h: 3000 });
  });

  it('is never less than 256 pixels round a small mark', () => {
    expect(moGenCutOut({ x: 5560, y: 1930, w: 100, h: 80 }, 8687, 3647)).toEqual({ x: 5304, y: 1674, w: 612, h: 592 });
  });

  it('stops at the photo\'s edges', () => {
    expect(moGenCutOut({ x: 10, y: 20, w: 300, h: 300 }, 1000, 800)).toEqual({ x: 0, y: 0, w: 566, h: 576 });
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
  it('is the try\'s box moved to the cut-out\'s place, at the photo\'s own pixels', () => {
    expect(moGenPatchBox([0, 0, 1584, 1104], { x: 5030, y: 1560, w: 1584, h: 1104 })).toEqual({ x: 5030, y: 1560, w: 1584, h: 1104 });
    expect(moGenPatchBox([945, 545, 2056, 1456], { x: 1000, y: 2000, w: 3072, h: 2048 })).toEqual({ x: 1945, y: 2545, w: 1111, h: 911 });
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
