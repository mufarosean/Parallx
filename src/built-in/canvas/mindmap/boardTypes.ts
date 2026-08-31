// boardTypes.ts — the contract between the main bundle and the board engine
// bundle (mindmap-board.js). Lives alone so BOTH bundles can import it
// without either inlining the other — the worksheetConstants pattern.
//
// The board engine is Excalidraw (MIT), embedded exactly the way Univer is
// for worksheets: its own esbuild output, dynamic-imported on first open,
// type-only imports from the main tree. Main-bundle code speaks SKELETONS
// (Excalidraw's declarative element JSON) and never imports the engine.

/** Loose skeleton element — the shape `convertToExcalidrawElements` accepts.
 *  Kept intentionally open: the engine validates, we don't re-model it. */
export interface BoardSkeleton {
  readonly type: string;
  readonly id?: string;
  readonly x?: number;
  readonly y?: number;
  readonly width?: number;
  readonly height?: number;
  readonly label?: { readonly text: string; readonly fontSize?: number };
  readonly text?: string;
  readonly fontSize?: number;
  readonly backgroundColor?: string;
  readonly strokeColor?: string;
  readonly start?: { readonly id: string };
  readonly end?: { readonly id: string };
  readonly [key: string]: unknown;
}

/** What the mindmaps.data column stores for engine documents. */
export interface BoardEnvelope {
  readonly engine: 'excalidraw';
  readonly version: 1;
  /** Full Excalidraw elements (the engine's own serialized form). */
  readonly elements: readonly Record<string, unknown>[];
  /** Binary attachments (pasted images) keyed by file id. */
  readonly files: Record<string, unknown>;
  /**
   * Skeletons written by a HEADLESS author (the chat AI tools) that no open
   * editor has materialised yet. The host converts and merges them on the
   * next mount, then they clear on the next save. This is how the AI can
   * draw on a board nobody has open.
   */
  readonly pending: readonly BoardSkeleton[];
}

export function emptyBoardEnvelope(): BoardEnvelope {
  return { engine: 'excalidraw', version: 1, elements: [], files: {}, pending: [] };
}

/** The live board handle the engine bundle hands back. */
export interface IBoardHost {
  /** Convert + add skeletons to the open scene (the editor AI door). */
  addSkeletons(skeletons: readonly BoardSkeleton[]): void;
  /** Current scene for persistence (deleted elements already dropped). */
  getScene(): { elements: readonly Record<string, unknown>[]; files: Record<string, unknown> };
  destroy(): void;
}

export interface BoardHostOptions {
  readonly container: HTMLElement;
  readonly initialElements: readonly Record<string, unknown>[];
  readonly initialFiles: Record<string, unknown>;
  /** Headless-authored skeletons to materialise on mount. */
  readonly pending: readonly BoardSkeleton[];
  readonly theme: 'light' | 'dark';
  /** Fired on every scene mutation (the pane debounces persistence). */
  readonly onChange: () => void;
}

export type BoardHostModule = {
  createBoardHost(opts: BoardHostOptions): IBoardHost;
};
