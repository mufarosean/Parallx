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
import type {
  BoardHostOptions,
  BoardSkeleton,
  IBoardHost,
} from './boardTypes.js';

// The engine's imperative surface (typed loosely across the bundle seam).
interface ExcalidrawImperativeApi {
  updateScene(scene: { elements?: readonly unknown[] }): void;
  getSceneElements(): readonly Record<string, unknown>[];
  getFiles(): Record<string, unknown>;
  addFiles(files: readonly unknown[]): void;
  scrollToContent(target?: unknown, opts?: { fitToContent?: boolean }): void;
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
    const skeletons = queued.splice(0, queued.length);
    try {
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
