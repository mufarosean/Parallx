// boardMath.test.ts — the formula pipeline, headless.
//
// This is the reason MathJax's liteAdaptor was chosen: LaTeX → SVG runs in
// plain Node, so the exact rendering path the board host uses is pinnable
// without the engine. What these pins hold: the SVG is self-contained
// (fixed ink, no currentColor — a data-URL <img> has no cascade), sizes are
// finite and bounded, file ids are deterministic, and a math skeleton
// becomes a real image skeleton that still speaks text via customData.

import { describe, expect, it } from 'vitest';
import {
  mathDataUrl,
  mathFileId,
  mathSkeletonToImage,
  renderMathSvg,
} from '../../src/built-in/canvas/mindmap/boardMath';
import { extractPureMath } from '../../src/built-in/canvas/mindmap/boardConvert';

describe('renderMathSvg', () => {
  it('renders a fraction to self-contained SVG with finite bounded size', () => {
    const r = renderMathSvg('\\frac{dC}{dt} = \\mu C');
    expect(r.svg).toContain('<svg');
    expect(r.svg).not.toContain('currentColor');
    expect(r.error).toBeNull();
    expect(Number.isFinite(r.width) && r.width > 12).toBe(true);
    expect(Number.isFinite(r.height) && r.height > 12).toBe(true);
    expect(r.width).toBeLessThanOrEqual(1100);
  });

  it('a TeX error surfaces as `error` while still rendering something', () => {
    const r = renderMathSvg('\\frac{a}{'); // unbalanced
    expect(r.error).toBeTruthy();
    expect(r.svg).toContain('<svg');
  });
});

describe('math files', () => {
  it('the file id is deterministic per formula', () => {
    expect(mathFileId('E=mc^2')).toBe(mathFileId('E=mc^2'));
    expect(mathFileId('E=mc^2')).not.toBe(mathFileId('E=mc^3'));
  });

  it('the data URL is base64 SVG', () => {
    expect(mathDataUrl('<svg xmlns="http://www.w3.org/2000/svg"/>')).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});

describe('mathSkeletonToImage', () => {
  it('a math skeleton becomes an image element that still speaks text', () => {
    const pieces = mathSkeletonToImage({
      type: 'math',
      id: 'mm-f1',
      x: 40,
      y: -20,
      latex: 'E[X]=\\mu',
      label: { text: '$E[X]=\\mu$' },
    })!;
    expect(pieces.image).toMatchObject({ type: 'image', id: 'mm-f1', x: 40, y: -20 });
    expect(pieces.image.fileId).toBe(pieces.file.id);
    expect(pieces.file.mimeType).toBe('image/svg+xml');
    expect(pieces.file.dataURL.startsWith('data:image/svg+xml;base64,')).toBe(true);
    // Reads and dedupe see the formula as text, not an opaque picture.
    expect(pieces.image.customData).toMatchObject({ mmLatex: 'E[X]=\\mu', mmLabel: '$E[X]=\\mu$' });
  });

  it('an empty latex skeleton is refused, not rendered', () => {
    expect(mathSkeletonToImage({ type: 'math', latex: '   ' })).toBeNull();
  });
});

describe('extractPureMath — the label gate', () => {
  it('accepts $…$ and $$…$$, nothing else', () => {
    expect(extractPureMath('$E=mc^2$')).toBe('E=mc^2');
    expect(extractPureMath('  $$\\int_0^1 f$$  ')).toBe('\\int_0^1 f');
    expect(extractPureMath('CCL: $f(d)$')).toBeNull(); // mixed prose stays a card
    expect(extractPureMath('plain words')).toBeNull();
    expect(extractPureMath('$')).toBeNull();
    expect(extractPureMath('$a$ and $b$')).toBeNull();
  });
});
