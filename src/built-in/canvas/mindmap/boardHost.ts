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
  MainMenu,
  convertToExcalidrawElements,
} from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

// NOTE: window.EXCALIDRAW_ASSET_PATH (the local font directory) is set by an
// esbuild BANNER on this bundle (scripts/build.mjs) — it must exist before
// the hoisted engine imports register font faces, which module code here
// runs too late for. The CDN fallback (esm.sh) is blocked by the app CSP.
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

  // Headless-authored skeletons (chat tools) materialise INTO initialData —
  // never via updateScene after mount: the engine applies initialData
  // asynchronously and a racing update is silently wiped when it lands
  // (found via the hidden-window probe, 2026-08-31).
  const mountFiles: Record<string, unknown> = { ...opts.initialFiles };
  let mountElements: readonly Record<string, unknown>[] = opts.initialElements;
  let mountMaterialised = false;
  if (opts.pending.length > 0) {
    const { skeletons, files } = materialiseMath(opts.pending);
    try {
      const converted = convertToExcalidrawElements(skeletons as never[], { regenerateIds: false });
      mountElements = [...opts.initialElements, ...converted as never[]];
      for (const f of files) mountFiles[f.id] = f;
      mountMaterialised = converted.length > 0;
      console.info(`[Board] materialised ${converted.length} pending elements at mount (${files.length} files)`);
    } catch (err) {
      console.warn('[Board] pending skeleton conversion failed:', err);
    }
  }

  const queued: BoardSkeleton[] = [];

  const flushQueued = (): void => {
    if (!api || queued.length === 0) return;
    const { skeletons, files } = materialiseMath(queued.splice(0, queued.length));
    try {
      if (files.length > 0) api.addFiles(files);
      const converted = convertToExcalidrawElements(skeletons as never[], { regenerateIds: false });
      api.updateScene({ elements: [...api.getSceneElements(), ...converted] });
      api.scrollToContent(undefined, { fitToContent: true });
      console.info(`[Board] materialised ${converted.length} elements (${files.length} files)`);
      opts.onChange();
    } catch (err) {
      console.warn('[Board] skeleton conversion failed:', err);
    }
  };

  // A CURATED menu replaces the engine's stock one: the defaults ship
  // upstream branding (GitHub/Discord/X links), file open/save actions that
  // bypass the app's SQLite storage, and a Help dialog with external links.
  // Parallx is the product here — only local, in-app actions remain.
  const items = (MainMenu as unknown as { DefaultItems: Record<string, unknown> }).DefaultItems;
  const menu = React.createElement(
    MainMenu as never,
    null,
    React.createElement(items.SaveAsImage as never),
    React.createElement(items.SearchMenu as never),
    React.createElement(items.ClearCanvas as never),
    React.createElement(items.ChangeCanvasBackground as never),
  );

  const root: Root = createRoot(mount);
  root.render(
    React.createElement(Excalidraw as never, {
      theme: opts.theme,
      initialData: {
        elements: mountElements as never[],
        files: mountFiles as never,
        appState: { viewBackgroundColor: 'transparent' },
        scrollToContent: true,
      },
      excalidrawAPI: (a: ExcalidrawImperativeApi) => {
        if (destroyed) return;
        api = a;
        console.info('[Board] engine api ready');
        flushQueued();
        // Materialised pending must reach storage (pending clears on save)
        // even if the user never touches the board.
        if (mountMaterialised) opts.onChange();
      },
      onChange: () => { if (!destroyed) opts.onChange(); },
    } as never, menu),
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
      if (!api) return { elements: mountElements, files: mountFiles };
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
