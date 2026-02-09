// editorPart.ts — main content area (hosts editor groups)

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';

const EDITOR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 200,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 150,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/**
 * Editor part — the central content area that hosts editor groups.
 *
 * The editor part is always visible and occupies the largest portion
 * of the workbench. It contains a nested grid for editor group splitting
 * (managed by the EditorGroupService in Capability 9).
 */
export class EditorPart extends Part {

  private _editorGroupContainer: HTMLElement | undefined;
  private _watermark: HTMLElement | undefined;

  constructor() {
    super(
      PartId.Editor,
      'Editor',
      PartPosition.Center,
      EDITOR_CONSTRAINTS,
      true, // always visible
    );
  }

  /** Container for the editor group grid. */
  get editorGroupContainer(): HTMLElement | undefined { return this._editorGroupContainer; }

  /** Watermark element shown when no editors are open. */
  get watermark(): HTMLElement | undefined { return this._watermark; }

  protected override createContent(container: HTMLElement): void {
    container.classList.add('editor-content');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';

    // Editor group container (nested grid lives here)
    this._editorGroupContainer = document.createElement('div');
    this._editorGroupContainer.classList.add('editor-group-container');
    this._editorGroupContainer.style.flex = '1';
    this._editorGroupContainer.style.position = 'relative';
    this._editorGroupContainer.style.overflow = 'hidden';
    container.appendChild(this._editorGroupContainer);

    // Watermark (shown when no editors are open)
    this._watermark = document.createElement('div');
    this._watermark.classList.add('editor-watermark');
    this._watermark.style.position = 'absolute';
    this._watermark.style.inset = '0';
    this._watermark.style.display = 'flex';
    this._watermark.style.alignItems = 'center';
    this._watermark.style.justifyContent = 'center';
    this._watermark.style.pointerEvents = 'none';
    this._editorGroupContainer.appendChild(this._watermark);
  }

  /**
   * Show or hide the watermark. Typically hidden once editors are opened.
   */
  setWatermarkVisible(visible: boolean): void {
    if (this._watermark) {
      this._watermark.style.display = visible ? 'flex' : 'none';
    }
  }

  protected override layoutContent(width: number, height: number): void {
    // Propagate to editor group container so nested grids can relayout
    if (this._editorGroupContainer) {
      this._editorGroupContainer.style.width = `${width}px`;
      this._editorGroupContainer.style.height = `${height}px`;
    }
  }
}

export const editorPartDescriptor: PartDescriptor = {
  id: PartId.Editor,
  name: 'Editor',
  position: PartPosition.Center,
  defaultVisible: true,
  constraints: EDITOR_CONSTRAINTS,
  factory: () => new EditorPart(),
};
