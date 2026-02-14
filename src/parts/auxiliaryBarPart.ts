// auxiliaryBarPart.ts — secondary sidebar (opposite the primary sidebar)

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';
import { $ } from '../ui/dom.js';

const AUXILIARY_BAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 170,
  maximumWidth: 800,
  minimumHeight: 0,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/**
 * Auxiliary bar — a secondary collapsible sidebar on the opposite side
 * of the primary sidebar. Hosts supplementary view containers.
 */
export class AuxiliaryBarPart extends Part {

  private _viewContainerSlot: HTMLElement | undefined;
  private _headerSlot: HTMLElement | undefined;

  private readonly _onDidChangeActiveView = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  private _activeViewId: string | undefined;

  constructor() {
    super(
      PartId.AuxiliaryBar,
      'Secondary Side Bar',
      PartPosition.Right,
      AUXILIARY_BAR_CONSTRAINTS,
      false, // hidden by default, like VS Code
    );
  }

  get viewContainerSlot(): HTMLElement | undefined { return this._viewContainerSlot; }
  get headerSlot(): HTMLElement | undefined { return this._headerSlot; }
  get activeViewId(): string | undefined { return this._activeViewId; }

  setActiveView(viewId: string | undefined): void {
    if (this._activeViewId !== viewId) {
      this._activeViewId = viewId;
      this._onDidChangeActiveView.fire(viewId);
    }
  }

  protected override get hasTitleArea(): boolean { return true; }

  protected override createTitleArea(container: HTMLElement): void {
    this._headerSlot = container;
    container.classList.add('auxiliary-bar-header');
  }

  protected override createContent(container: HTMLElement): void {
    container.classList.add('auxiliary-bar-content');

    this._viewContainerSlot = $('div');
    this._viewContainerSlot.classList.add('auxiliary-bar-views');
    container.appendChild(this._viewContainerSlot);
  }

  protected override savePartData(): Record<string, unknown> | undefined {
    return this._activeViewId ? { activeViewId: this._activeViewId } : undefined;
  }

  protected override restorePartData(data: Record<string, unknown>): void {
    if (typeof data.activeViewId === 'string') {
      this.setActiveView(data.activeViewId);
    }
  }
}

export const auxiliaryBarPartDescriptor: PartDescriptor = {
  id: PartId.AuxiliaryBar,
  name: 'Secondary Side Bar',
  position: PartPosition.Right,
  defaultVisible: false,
  constraints: AUXILIARY_BAR_CONSTRAINTS,
  factory: () => new AuxiliaryBarPart(),
};
