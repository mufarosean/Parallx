// panelPart.ts — bottom or side panel area

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';

const PANEL_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 0,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 100,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/**
 * Panel part — hosts terminal, output, problems, debug console.
 * Can be positioned at the bottom or moved to the side.
 */
export class PanelPart extends Part {

  private _tabBarSlot: HTMLElement | undefined;
  private _viewContainerSlot: HTMLElement | undefined;

  private readonly _onDidChangeActiveTab = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveTab: Event<string | undefined> = this._onDidChangeActiveTab.event;

  private _activeTabId: string | undefined;

  constructor() {
    super(
      PartId.Panel,
      'Panel',
      PartPosition.Bottom,
      PANEL_CONSTRAINTS,
      true,
    );
  }

  get tabBarSlot(): HTMLElement | undefined { return this._tabBarSlot; }
  get viewContainerSlot(): HTMLElement | undefined { return this._viewContainerSlot; }
  get activeTabId(): string | undefined { return this._activeTabId; }

  setActiveTab(tabId: string | undefined): void {
    if (this._activeTabId !== tabId) {
      this._activeTabId = tabId;
      this._onDidChangeActiveTab.fire(tabId);
    }
  }

  protected override get hasTitleArea(): boolean { return false; }

  protected override createTitleArea(_container: HTMLElement): void {
    // Not used — the ViewContainer mounted in the panel provides its own tab bar.
  }

  protected override createContent(container: HTMLElement): void {
    container.classList.add('panel-content');

    this._viewContainerSlot = document.createElement('div');
    this._viewContainerSlot.classList.add('panel-views');
    container.appendChild(this._viewContainerSlot);
  }

  protected override savePartData(): Record<string, unknown> | undefined {
    return this._activeTabId ? { activeTabId: this._activeTabId } : undefined;
  }

  protected override restorePartData(data: Record<string, unknown>): void {
    if (typeof data.activeTabId === 'string') {
      this.setActiveTab(data.activeTabId);
    }
  }
}

export const panelPartDescriptor: PartDescriptor = {
  id: PartId.Panel,
  name: 'Panel',
  position: PartPosition.Bottom,
  defaultVisible: true,
  constraints: PANEL_CONSTRAINTS,
  factory: () => new PanelPart(),
};
