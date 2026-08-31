// boardMath.ts — LaTeX → SVG → board image, the formula pipeline.
//
// ENGINE-BUNDLE-SIDE ONLY: this module pulls in MathJax (~1MB) and must
// never be imported from the main tree — boardHost.ts is its only app
// consumer (tests import it directly; it is DOM-free and runs headless,
// which is exactly why MathJax's liteAdaptor is used instead of the
// browser adaptor).
//
// Why MathJax-SVG and not KaTeX: KaTeX emits HTML that depends on
// webfonts, which a data-URL SVG inside an <img> cannot fetch. MathJax's
// SVG output is self-contained paths — it renders identically everywhere,
// including in Excalidraw's export pipeline. Formulas are drawn in a
// fixed dark ink; Excalidraw's dark theme inverts the canvas (the
// engine's own mechanism), so one rendering serves both themes.

import { mathjax } from 'mathjax-full/js/mathjax.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import type { BoardSkeleton } from './boardTypes.js';

// MathJax reports dimensions in ex; this scale makes a plain "$x$" land
// around 30px tall on the board — readable at default zoom.
const EX_TO_PX = 9;
const BOARD_MATH_SCALE = 2;
const MAX_FORMULA_WIDTH_PX = 1100;
const MATH_INK = '#1e1e1e';

let _adaptor: ReturnType<typeof liteAdaptor> | null = null;
let _document: ReturnType<typeof mathjax.document> | null = null;

function mjDocument(): { adaptor: ReturnType<typeof liteAdaptor>; doc: ReturnType<typeof mathjax.document> } {
  if (!_adaptor || !_document) {
    _adaptor = liteAdaptor();
    RegisterHTMLHandler(_adaptor);
    _document = mathjax.document('', {
      InputJax: new TeX({ packages: AllPackages }),
      OutputJax: new SVG({ fontCache: 'local' }),
    });
  }
  return { adaptor: _adaptor, doc: _document };
}

export interface RenderedMath {
  /** Self-contained SVG markup (fixed ink, no currentColor). */
  readonly svg: string;
  /** Display size on the board, px. */
  readonly width: number;
  readonly height: number;
  /** MathJax's TeX error, when the input did not parse (SVG still renders). */
  readonly error: string | null;
}

export function renderMathSvg(latex: string): RenderedMath {
  const { adaptor, doc } = mjDocument();
  const node = doc.convert(latex, { display: true });
  let svg = adaptor.innerHTML(node as never);
  // A data-URL <img> has no cascade — currentColor would paint nothing.
  svg = svg.replace(/currentColor/g, MATH_INK);
  const error = /data-mjx-error="([^"]*)"/.exec(svg)?.[1] ?? null;

  const exOf = (attr: string): number => {
    const m = new RegExp(`${attr}="([\\d.]+)ex"`).exec(svg);
    return m ? parseFloat(m[1]) : 2;
  };
  let width = Math.max(12, exOf('width') * EX_TO_PX * BOARD_MATH_SCALE);
  let height = Math.max(12, exOf('height') * EX_TO_PX * BOARD_MATH_SCALE);
  if (width > MAX_FORMULA_WIDTH_PX) {
    height = (height * MAX_FORMULA_WIDTH_PX) / width;
    width = MAX_FORMULA_WIDTH_PX;
  }
  return { svg, width, height, error };
}

export function mathDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${toBase64(svg)}`;
}

/** Deterministic file id — the same formula shares one stored file. */
export function mathFileId(latex: string): string {
  let h = 5381;
  for (let i = 0; i < latex.length; i++) h = ((h << 5) + h + latex.charCodeAt(i)) >>> 0;
  return `mm-math-${h.toString(16)}-${latex.length}`;
}

export interface MathImagePieces {
  readonly file: { id: string; dataURL: string; mimeType: string; created: number };
  readonly image: BoardSkeleton;
}

/**
 * A `{type:'math'}` skeleton (authored by boardConvert / addMath) becomes a
 * real image skeleton plus its file entry. The LaTeX source and the
 * original label ride in customData so reads and dedupe still see the
 * formula as text, not an opaque picture.
 */
export function mathSkeletonToImage(skeleton: BoardSkeleton): MathImagePieces | null {
  const latex = typeof skeleton.latex === 'string' ? skeleton.latex.trim() : '';
  if (!latex) return null;
  const rendered = renderMathSvg(latex);
  const id = mathFileId(latex);
  return {
    file: { id, dataURL: mathDataUrl(rendered.svg), mimeType: 'image/svg+xml', created: Date.now() },
    image: {
      type: 'image',
      id: skeleton.id,
      fileId: id,
      x: skeleton.x ?? 0,
      y: skeleton.y ?? 0,
      width: rendered.width,
      height: rendered.height,
      status: 'saved',
      customData: { mmLatex: latex, mmLabel: skeleton.label?.text ?? `$${latex}$` },
    },
  };
}

function toBase64(s: string): string {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(s)));
  }
  return Buffer.from(s, 'utf8').toString('base64');
}
