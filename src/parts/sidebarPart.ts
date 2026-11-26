// sidebarPart.ts — the column

import { Part } from './part.js';
import { PartId, PartPosition, PartDescriptor } from './partTypes.js';
import { SizeConstraints } from '../layout/layoutTypes.js';
import { Emitter, Event } from '../platform/events.js';

const SIDEBAR_CONSTRAINTS: SizeConstraints = {
  minimumWidth: 170,
  maximumWidth: Number.POSITIVE_INFINITY,
  minimumHeight: 0,
  maximumHeight: Number.POSITIVE_INFINITY,
};

/**
 * The column, top to bottom: a grip to move it by; the tools that are on,
 * by name, under a Home row; what is open; the open tool's name and its own list, which takes the
 * height that is left; and at the foot, pinned, where tools are managed and
 * Settings. The part makes the slots and knows no tool: the workbench seats
 * what goes in each.
 */
export class SidebarPart extends Part {

  private _gripSlot: HTMLElement | undefined;
  private _toolsSlot: HTMLElement | undefined;
  private _openSlot: HTMLElement | undefined;
  private _openListSlot: HTMLElement | undefined;
  private _viewContainerSlot: HTMLElement | undefined;
  private _footSlot: HTMLElement | undefined;
  private _headerSlot: HTMLElement | undefined;

  private readonly _onDidChangeActiveView = this._register(new Emitter<string | undefined>());
  readonly onDidChangeActiveView: Event<string | undefined> = this._onDidChangeActiveView.event;

  /** A slot changed height (a tool came or went, a tab opened): the open tool's list has other room. */
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

  /** Home and the tools, at the top. */
  get toolsSlot(): HTMLElement | undefined { return this._toolsSlot; }
  /** What is open, under the tools. */
  get openSlot(): HTMLElement | undefined { return this._openSlot; }
  /** Inside it, under its label: the rows. */
  get openListSlot(): HTMLElement | undefined { return this._openListSlot; }
  get viewContainerSlot(): HTMLElement | undefined { return this._viewContainerSlot; }
  /** Pinned at the bottom: where tools are managed, and Settings. */
  get footSlot(): HTMLElement | undefined { return this._footSlot; }
  get headerSlot(): HTMLElement | undefined { return this._headerSlot; }
  get activeViewId(): string | undefined { return this._activeViewId; }

  /**
   * How much of the column's height everything but the open tool's list
   * takes, beyond a plain part header of `plainHeader` px: what that list loses.
   */
  chromeBeyond(plainHeader: number): number {
    const taken = [this._gripSlot, this._toolsSlot, this._openSlot, this._headerSlot, this._footSlot].reduce((sum, el) => sum + (el?.offsetHeight ?? 0), 0);
    return Math.max(0, taken - plainHeader);
  }

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
    const slot = (className: string, parent: HTMLElement = container): HTMLElement => {
      const el = document.createElement('div');
      el.classList.add(className);
      parent.appendChild(el);
      return el;
    };

    // The grip: the column is grabbed here, at its top, to move it.
    this._gripSlot = slot('sidebar-grip');
    this._toolsSlot = slot('sidebar-tools');
    this._openSlot = slot('sidebar-open');
    this._openListSlot = slot('sidebar-open-list', this._openSlot);
    // The open tool's name sits over its list, under what is open: the
    // part's title area, moved into the run of the column.
    if (this._headerSlot) container.appendChild(this._headerSlot);
    this._viewContainerSlot = slot('sidebar-views');
    this._footSlot = slot('sidebar-foot');

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this._onDidChangeChrome.fire());
      for (const el of [this._toolsSlot, this._openSlot, this._footSlot]) observer.observe(el);
      this._register({ dispose: () => observer.disconnect() });
    }
  }

  protected override savePartData(): Record<string, unknown> | undefined {
    const openFolded = this._openSlot?.classList.contains('sidebar-open--folded') ?? false;
    return this._activeViewId || openFolded ? { activeViewId: this._activeViewId, openFolded } : undefined;
  }

  protected override restorePartData(data: Record<string, unknown>): void {
    if (typeof data.activeViewId === 'string') {
      this.setActiveView(data.activeViewId);
    }
    this._openSlot?.classList.toggle('sidebar-open--folded', data.openFolded === true);
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
