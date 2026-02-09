// sidebarPart.ts — primary collapsible sidebar (typically left)

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';

const SIDEBAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 170,
  maximumWidth: 800,
  minimumHeight: 0,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/**
 * Primary sidebar — hosts the activity bar icons and view containers
 * (explorer, search, source control, etc.).
 */
export class SidebarPart extends Part {

  private _activityBarSlot: HTMLElement | undefined;
  private _viewContainerSlot: HTMLElement | undefined;
  private _headerSlot: HTMLElement | undefined;

  private readonly _onDidChangeActiveView = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  private _activeViewId: string | undefined;

  constructor() {
    super(
      PartId.Sidebar,
      'Side Bar',
      PartPosition.Left,
      SIDEBAR_CONSTRAINTS,
      true,
    );
  }

  get activityBarSlot(): HTMLElement | undefined { return this._activityBarSlot; }
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
    container.classList.add('sidebar-header');
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.padding = '0 8px';
  }

  protected override createContent(container: HTMLElement): void {
    container.classList.add('sidebar-content');
    container.style.display = 'flex';

    // Activity bar (icon strip)
    this._activityBarSlot = document.createElement('div');
    this._activityBarSlot.classList.add('sidebar-activity-bar');
    this._activityBarSlot.style.flexShrink = '0';
    container.appendChild(this._activityBarSlot);

    // View container area
    this._viewContainerSlot = document.createElement('div');
    this._viewContainerSlot.classList.add('sidebar-views');
    this._viewContainerSlot.style.flex = '1';
    this._viewContainerSlot.style.overflow = 'hidden';
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

export const sidebarPartDescriptor: PartDescriptor = {
  id: PartId.Sidebar,
  name: 'Side Bar',
  position: PartPosition.Left,
  defaultVisible: true,
  constraints: SIDEBAR_CONSTRAINTS,
  factory: () => new SidebarPart(),
};
