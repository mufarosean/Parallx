// sidebarPart.ts — primary collapsible sidebar (typically left)

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';
import { $ } from '../ui/dom.js';

const SIDEBAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 170,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 0,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/**
 * The column: the open tool named at its head, that tool's own list under
 * it, and at the foot the tools that are on, by name. The foot is a slot;
 * the workbench seats the tools list there and the part knows no tool.
 */
export class SidebarPart extends Part {

  private _footSlot: HTMLElement | undefined;
  private _viewContainerSlot: HTMLElement | undefined;
  private _headerSlot: HTMLElement | undefined;

  private readonly _onDidChangeActiveView = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  /** The head or the foot changed height (a tool came or went): the open tool's list has other room. */
  private readonly _onDidChangeChrome = this._register(new Emitter<void>());
  readonly onDidChangeChrome: Event<void> = this._onDidChangeChrome.event;

  private _activeViewId: string | undefined;

  constructor() {
    super(
      PartId.Sidebar,
      'Side Bar',
      PartPosition.Left,
      SIDEBAR_CONSTRAINTS,
      true,
      true, // snap: auto-hide when dragged past minimum
    );
  }

  /** Where the tools list sits, under the open tool's own list. */
  get footSlot(): HTMLElement | undefined { return this._footSlot; }

  /**
   * How much of the column's height the head and the foot take beyond a
   * plain part header of `plainHeader` px: what the open tool's list loses.
   */
  chromeBeyond(plainHeader: number): number {
    const head = this._headerSlot?.offsetHeight ?? 0;
    const foot = this._footSlot?.offsetHeight ?? 0;
    return Math.max(0, (head || plainHeader) - plainHeader) + foot;
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
    container.classList.add('sidebar-header');
  }

  protected override createContent(container: HTMLElement): void {
    container.classList.add('sidebar-content');

    // The open tool's own list
    this._viewContainerSlot = $('div');
    this._viewContainerSlot.classList.add('sidebar-views');
    container.appendChild(this._viewContainerSlot);

    // The foot: the tools by name, then what manages them
    this._footSlot = $('div');
    this._footSlot.classList.add('sidebar-foot');
    container.appendChild(this._footSlot);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this._onDidChangeChrome.fire());
      observer.observe(this._footSlot);
      this._register({ dispose: () => observer.disconnect() });
    }
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
