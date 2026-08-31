// boardHost.ts — the board ENGINE bundle (dist/renderer/mindmap-board.js).
//
// This file is the entry of its own esbuild output and the only place React
// and Excalidraw exist in the app — the Univer discipline: statically
// importing this from the main tree would inline the engine into main.js.
// NEVER do that; the pane dynamic-imports the built URL at first open.
//
// Excalidraw is the whole point of the pivot (2026-08-31, Mufaro: "think
// Zoom Whiteboard, optimized for AI + LaTeX"): shapes, sticky-style notes,
// arrows, freehand, text, images, selection, undo, export — a real
// whiteboard UI nobody has to hand-build. What this host adds on top is the
// AI seam: `convertToExcalidrawElements` turns the skeleton JSON our tools
// and Draft door emit into real elements, on mount (headless-authored
// `pending`) and live (`addSkeletons`).

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  Excalidraw,
  convertToExcalidrawElements,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import {
  MATH_SKELETON_TYPE,
  type BoardHostOptions,
  type BoardSkeleton,
  type IBoardHost,
} from './boardTypes.js';
import { mathSkeletonToImage, renderMathSvg } from './boardMath.js';

// The engine's imperative surface (typed loosely across the bundle seam).
interface ExcalidrawImperativeApi {
  updateScene(scene: { elements?: readonly unknown[] }): void;
  getSceneElements(): readonly Record<string, unknown>[];
  getFiles(): Record<string, unknown>;
  addFiles(files: readonly unknown[]): void;
  scrollToContent(target?: unknown, opts?: { fitToContent?: boolean }): void;
  getAppState(): { scrollX?: number; scrollY?: number; width?: number; height?: number; zoom?: { value?: number } };
}

/**
 * Skeletons may carry our `math` pseudo-type, which the engine's converter
 * does not know. Render each (MathJax → SVG file + image skeleton) BEFORE
 * the one conversion call, so arrows bound to a formula's id still resolve.
 */
function materialiseMath(skeletons: readonly BoardSkeleton[]): {
  skeletons: BoardSkeleton[];
  files: { id: string; dataURL: string; mimeType: string; created: number }[];
} {
  const out: BoardSkeleton[] = [];
  const files: { id: string; dataURL: string; mimeType: string; created: number }[] = [];
  for (const sk of skeletons) {
    if (sk.type !== MATH_SKELETON_TYPE) { out.push(sk); continue; }
    try {
      const pieces = mathSkeletonToImage(sk);
      if (pieces) { out.push(pieces.image); files.push(pieces.file); continue; }
    } catch (err) {
      console.warn('[Board] formula render failed:', err);
    }
    // Fallback: the formula survives as its text label, never lost.
    out.push({ type: 'text', id: sk.id, x: sk.x, y: sk.y, text: sk.label?.text ?? `$${sk.latex ?? ''}$` });
  }
  return { skeletons: out, files };
}

export function createBoardHost(opts: BoardHostOptions): IBoardHost {
  const mount = document.createElement('div');
  mount.className = 'mm-board-host';
  mount.style.width = '100%';
  mount.style.height = '100%';
  opts.container.appendChild(mount);

  let api: ExcalidrawImperativeApi | null = null;
  let destroyed = false;
  const queued: BoardSkeleton[] = [...opts.pending];

  const flushQueued = (): void => {
    if (!api || queued.length === 0) return;
    const { skeletons, files } = materialiseMath(queued.splice(0, queued.length));
    try {
      if (files.length > 0) api.addFiles(files);
      const converted = convertToExcalidrawElements(skeletons as never[], { regenerateIds: false });
      api.updateScene({ elements: [...api.getSceneElements(), ...converted] });
      api.scrollToContent(undefined, { fitToContent: true });
      opts.onChange();
    } catch (err) {
      console.warn('[Board] skeleton conversion failed:', err);
    }
  };

  const root: Root = createRoot(mount);
  root.render(
    React.createElement(Excalidraw as never, {
      theme: opts.theme,
      initialData: {
        elements: opts.initialElements as never[],
        files: opts.initialFiles as never,
        appState: { viewBackgroundColor: 'transparent' },
        scrollToContent: true,
      },
      excalidrawAPI: (a: ExcalidrawImperativeApi) => {
        if (destroyed) return;
        api = a;
        // Headless-authored skeletons (chat tools) materialise on mount.
        flushQueued();
      },
      onChange: () => { if (!destroyed) opts.onChange(); },
    } as never),
  );

  return {
    addSkeletons(skeletons: readonly BoardSkeleton[]): void {
      queued.push(...skeletons);
      flushQueued();
    },
    addMath(latex: string): boolean {
      const tex = latex.trim();
      if (!tex) return false;
      // Place at the viewport centre (engine scene coords).
      let x = 0;
      let y = 0;
      if (api) {
        const st = api.getAppState();
        const zoom = st.zoom?.value || 1;
        const rendered = renderMathSvg(tex);
        x = (st.width ?? 0) / 2 / zoom - (st.scrollX ?? 0) - rendered.width / 2;
        y = (st.height ?? 0) / 2 / zoom - (st.scrollY ?? 0) - rendered.height / 2;
      }
      queued.push({ type: MATH_SKELETON_TYPE, latex: tex, x, y, label: { text: `$${tex}$` } });
      flushQueued();
      return true;
    },
    renderMathPreview(latex: string): { svg: string; error: string | null } {
      const { svg, error } = renderMathSvg(latex);
      return { svg, error };
    },
    getScene() {
      if (!api) return { elements: opts.initialElements, files: opts.initialFiles };
      return {
        elements: api.getSceneElements().filter((e) => !(e as { isDeleted?: boolean }).isDeleted),
        files: api.getFiles(),
      };
    },
    destroy(): void {
      destroyed = true;
      api = null;
      root.unmount();
      mount.remove();
    },
  };
}
