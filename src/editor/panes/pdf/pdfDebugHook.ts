// pdfDebugHook.ts — the PDF viewer's state for the end-to-end tests.
//
// In test mode only, the open PDF pane publishes `__parallxPdfDebug` on the
// window: its scale, its first page's geometry and drawing, the text
// layer, the selection overlay and the loaded fonts, and two ways to set
// the scale (tests/e2e/19-pdf-diagnostics.spec.ts reads them).

import type { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';

/** What the hook reads from and does to the pane. */
export interface PdfDebugHost {
  viewer(): PDFViewer | null;
  container(): HTMLElement | null;
  /** Apply and remember a scale, as the toolbar does. */
  setScaleValue(value: string): void;
}

/** Publish the hook when the app runs in test mode. */
export function installPdfDebugHook(host: PdfDebugHost): void {
  if (!(globalThis as any).parallxElectron?.testMode) return;
  (globalThis as any).__parallxPdfDebug = {
    getState: () => collectState(host),
    setScaleValue: (value: string) => {
      host.setScaleValue(value);
      return collectState(host);
    },
    setNumericScale: (value: number) => {
      const viewer = host.viewer();
      if (viewer) viewer.currentScale = value;
      return collectState(host);
    },
  };
}

export function removePdfDebugHook(): void {
  if ((globalThis as any).__parallxPdfDebug?.getState === undefined) return;
  delete (globalThis as any).__parallxPdfDebug;
}

function collectState(host: PdfDebugHost): Record<string, unknown> {
  const viewer = host.viewer();
  const container = host.container();
  const pageView = viewer?.getPageView(0) as any;
  const pageDiv = pageView?.div ?? container?.querySelector('.page');
  const canvas = pageView?.canvas ?? pageDiv?.querySelector('canvas');
  const textLayerDiv = pageView?.textLayer?.div ?? pageDiv?.querySelector('.textLayer');
  const rectOf = (node: Element | null | undefined) => {
    if (!node) return null;
    const rect = node.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };
  const fonts = typeof document !== 'undefined' && 'fonts' in document
    ? Array.from(document.fonts as FontFaceSet).slice(0, 40).map((font) => {
      const face = font as FontFace;
      return { family: face.family, status: face.status, weight: face.weight, style: face.style };
    })
    : [];
  const endOfContent = container?.querySelector<HTMLElement>('.textLayer .endOfContent');

  return {
    currentScale: viewer?.currentScale ?? null,
    currentScaleValue: viewer?.currentScaleValue ?? null,
    pagesCount: viewer?.pagesCount ?? 0,
    devicePixelRatio: globalThis.devicePixelRatio ?? 1,
    pageView: pageView ? {
      renderingState: pageView.renderingState ?? null,
      scale: pageView.scale ?? null,
      hasRestrictedScaling: pageView.hasRestrictedScaling ?? null,
    } : null,
    pageRect: rectOf(pageDiv),
    canvas: canvas ? {
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
      styleWidth: (canvas as HTMLElement).style.width || null,
      styleHeight: (canvas as HTMLElement).style.height || null,
      rect: rectOf(canvas),
    } : null,
    textLayer: textLayerDiv ? {
      rect: rectOf(textLayerDiv),
      spanCount: textLayerDiv.querySelectorAll('span').length,
    } : null,
    selectionOverlay: {
      rootCount: container?.querySelectorAll('.pdf-selection-overlay-root').length ?? 0,
      boxCount: container?.querySelectorAll('.pdf-selection-overlay-box').length ?? 0,
      boxes: Array.from(container?.querySelectorAll<HTMLElement>('.pdf-selection-overlay-box') ?? []).slice(0, 20).map((box) => rectOf(box)),
      endOfContent: endOfContent ? {
        parentClassName: endOfContent.parentElement?.className ?? null,
        widthStyle: endOfContent.style.width || null,
        heightStyle: endOfContent.style.height || null,
        rect: rectOf(endOfContent),
      } : null,
    },
    fonts,
  };
}
