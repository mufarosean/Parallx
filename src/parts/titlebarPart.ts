// titlebarPart.ts — title bar (top window controls and menus)

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';

/** Height constraints for the titlebar. */
const TITLEBAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 0,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 30,
  maximumHeight: 30,
};

/**
 * Title bar part — occupies the top edge of the workbench.
 * Hosts window controls, menus, and the command/search center.
 */
export class TitlebarPart extends Part {

  private _dragRegion: HTMLElement | undefined;
  private _leftSlot: HTMLElement | undefined;
  private _centerSlot: HTMLElement | undefined;
  private _rightSlot: HTMLElement | undefined;

  constructor() {
    super(
      PartId.Titlebar,
      'Title Bar',
      PartPosition.Top,
      TITLEBAR_CONSTRAINTS,
      true,
    );
  }

  // — Slots for external content —

  get leftSlot(): HTMLElement | undefined { return this._leftSlot; }
  get centerSlot(): HTMLElement | undefined { return this._centerSlot; }
  get rightSlot(): HTMLElement | undefined { return this._rightSlot; }

  // — Part hooks —

  protected override createContent(container: HTMLElement): void {
    container.classList.add('titlebar-content');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.userSelect = 'none';

    // Drag region (for custom titlebars with -webkit-app-region)
    this._dragRegion = document.createElement('div');
    this._dragRegion.classList.add('titlebar-drag-region');
    this._dragRegion.style.position = 'absolute';
    this._dragRegion.style.inset = '0';
    this._dragRegion.style.zIndex = '-1';
    container.appendChild(this._dragRegion);

    // Left slot (menus)
    this._leftSlot = document.createElement('div');
    this._leftSlot.classList.add('titlebar-left');
    container.appendChild(this._leftSlot);

    // Center slot (command center / search)
    this._centerSlot = document.createElement('div');
    this._centerSlot.classList.add('titlebar-center');
    this._centerSlot.style.flex = '1';
    this._centerSlot.style.display = 'flex';
    this._centerSlot.style.justifyContent = 'center';
    container.appendChild(this._centerSlot);

    // Right slot (window controls)
    this._rightSlot = document.createElement('div');
    this._rightSlot.classList.add('titlebar-right');
    container.appendChild(this._rightSlot);
  }
}

/** Descriptor for registry registration. */
export const titlebarPartDescriptor: PartDescriptor = {
  id: PartId.Titlebar,
  name: 'Title Bar',
  position: PartPosition.Top,
  defaultVisible: true,
  constraints: TITLEBAR_CONSTRAINTS,
  factory: () => new TitlebarPart(),
};
