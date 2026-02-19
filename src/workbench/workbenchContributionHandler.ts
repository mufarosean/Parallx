// workbenchContributionHandler.ts — View contribution event handling
//
// Extracted from workbench.ts (D.1) to reduce the god-object.
// VS Code parity: VS Code's ViewContainerModel + CompositePart handle
// dynamic container management. This module consolidates all tool-contributed
// container/view wiring, activity bar icon management, and container switching.
//
// Responsibilities:
//   - Wire events from ViewContributionProcessor to workbench DOM
//   - Handle tool container add/remove/switch
//   - Handle tool view add/remove
//   - Manage activity bar icons for contributed containers
//   - Replace built-in placeholders with real tool views

import { Disposable, DisposableStore } from '../platform/lifecycle.js';
import { ViewContainer } from '../views/viewContainer.js';
import { ViewManager } from '../views/viewManager.js';
import { AuxiliaryBarPart } from '../parts/auxiliaryBarPart.js';
import { $ } from '../ui/dom.js';
import type { ViewContributionProcessor, IContributedContainer, IContributedView } from '../contributions/viewContribution.js';
import type { ActivityBarPart } from '../parts/activityBarPart.js';
import type { WorkbenchContextManager } from '../context/workbenchContext.js';
import type { Part } from '../parts/part.js';
import type { Orientation } from '../layout/layoutTypes.js';

// ─── Host interface ──────────────────────────────────────────────────────────

/**
 * Minimal interface the contribution handler needs from the Workbench.
 * Keeps coupling narrow — the handler never imports the Workbench class.
 */
export interface ContributionHandlerHost {
  readonly sidebar: Part;
  readonly panel: Part;
  readonly auxiliaryBar: Part;
  readonly activityBarPart: ActivityBarPart;
  toggleSidebar(): void;
  layoutViewContainers(): void;
}

// ─── Contribution Handler ────────────────────────────────────────────────────

export class WorkbenchContributionHandler extends Disposable {
  // ── Container state (owned by this handler) ──
  private _builtinSidebarContainers = new Map<string, ViewContainer>();
  private _contributedSidebarContainers = new Map<string, ViewContainer>();
  private _contributedPanelContainers = new Map<string, ViewContainer>();
  private _contributedAuxBarContainers = new Map<string, ViewContainer>();
  private _containerRedirects = new Map<string, string>();
  private _activeSidebarContainerId: string | undefined;
  private _sidebarHeaderLabel: HTMLElement | undefined;

  // ── DOM slots (set once, reused) ──
  private _sidebarViewsSlot: HTMLElement | undefined;
  private _sidebarHeaderSlot: HTMLElement | undefined;
  private _panelViewsSlot: HTMLElement | undefined;

  // ── MutationObservers for tab drag wiring ──
  private _tabObservers: MutationObserver[] = [];

  // ── Generic containers (default sidebar, panel, aux bar) ──
  private _defaultSidebarContainer: ViewContainer | undefined;
  private _genericPanelContainer: ViewContainer | undefined;
  private _genericAuxBarContainer: ViewContainer | undefined;

  // ── Event listener store (cleared on workspace switch) ──
  private readonly _viewContribListeners = this._register(new DisposableStore());

  private _viewManager!: ViewManager;
  private _viewContribution!: ViewContributionProcessor;
  private _workbenchContext: WorkbenchContextManager | undefined;

  private readonly _host: ContributionHandlerHost;

  constructor(host: ContributionHandlerHost) {
    super();
    this._host = host;
  }

  // ── Accessors for workbench.ts ──

  get builtinSidebarContainers(): ReadonlyMap<string, ViewContainer> { return this._builtinSidebarContainers; }
  get contributedSidebarContainers(): ReadonlyMap<string, ViewContainer> { return this._contributedSidebarContainers; }
  get contributedPanelContainers(): ReadonlyMap<string, ViewContainer> { return this._contributedPanelContainers; }
  get contributedAuxBarContainers(): ReadonlyMap<string, ViewContainer> { return this._contributedAuxBarContainers; }
  get activeSidebarContainerId(): string | undefined { return this._activeSidebarContainerId; }
  get sidebarViewsSlot(): HTMLElement | undefined { return this._sidebarViewsSlot; }
  get sidebarHeaderSlot(): HTMLElement | undefined { return this._sidebarHeaderSlot; }
  get panelViewsSlot(): HTMLElement | undefined { return this._panelViewsSlot; }
  get tabObservers(): MutationObserver[] { return this._tabObservers; }

  // Mutable setters for setup + teardown
  set sidebarViewsSlot(el: HTMLElement | undefined) { this._sidebarViewsSlot = el; }
  set sidebarHeaderSlot(el: HTMLElement | undefined) { this._sidebarHeaderSlot = el; }
  set panelViewsSlot(el: HTMLElement | undefined) { this._panelViewsSlot = el; }
  set sidebarHeaderLabel(el: HTMLElement | undefined) { this._sidebarHeaderLabel = el; }

  /** Called each time view components are (re)created (init or workspace switch). */
  setViewManager(vm: ViewManager): void { this._viewManager = vm; }
  setViewContribution(vc: ViewContributionProcessor): void { this._viewContribution = vc; }
  setWorkbenchContext(ctx: WorkbenchContextManager | undefined): void { this._workbenchContext = ctx; }

  /** Set the generic (default) containers for sidebar/panel/aux bar fallback. */
  setGenericContainers(sidebar: ViewContainer, panel: ViewContainer, auxBar: ViewContainer): void {
    this._defaultSidebarContainer = sidebar;
    this._genericPanelContainer = panel;
    this._genericAuxBarContainer = auxBar;
  }

  // ── Built-in sidebar container registration ──

  registerBuiltinSidebarContainer(id: string, vc: ViewContainer): void {
    this._builtinSidebarContainers.set(id, vc);
  }

  setActiveSidebarContainerId(id: string | undefined): void {
    this._activeSidebarContainerId = id;
  }

  // ── Wire contribution events ──

  wireViewContributionEvents(): void {
    this._viewContribListeners.clear();

    this._viewContribListeners.add(this._viewContribution.onDidAddContainer((container) => {
      this._onToolContainerAdded(container);
    }));

    this._viewContribListeners.add(this._viewContribution.onDidRemoveContainer((containerId) => {
      this._onToolContainerRemoved(containerId);
    }));

    this._viewContribListeners.add(this._viewContribution.onDidAddView((view) => {
      this._onToolViewAdded(view);
    }));

    this._viewContribListeners.add(this._viewContribution.onDidRemoveView((viewId) => {
      this._onToolViewRemoved(viewId);
    }));

    this._viewContribListeners.add(this._viewContribution.onDidRegisterProvider(({ viewId }) => {
      console.log(`[Workbench] View provider registered for "${viewId}"`);
      this._replaceBuiltinPlaceholderIfNeeded(viewId);
    }));
  }

  // ── Container add/remove ──

  private _onToolContainerAdded(info: IContributedContainer): void {
    // Skip duplicate sidebar containers that overlap with built-ins
    if (info.location === 'sidebar') {
      for (const [builtinViewId, builtinVc] of this._builtinSidebarContainers) {
        const views = builtinVc.getViews();
        const matchesTitle = views.some(
          (v) => v.name.toLowerCase() === info.title.toLowerCase(),
        );
        if (matchesTitle) {
          this._containerRedirects.set(info.id, builtinViewId);
          console.log(
            `[Workbench] Skipped duplicate sidebar container "${info.id}" — ` +
            `redirecting views to built-in "${builtinViewId}"`,
          );
          return;
        }
      }
    }

    const vc = new ViewContainer(info.id);

    if (info.location === 'sidebar') {
      vc.hideTabBar();
      vc.setVisible(false);
      if (this._sidebarViewsSlot) {
        this._sidebarViewsSlot.appendChild(vc.element);
      }
      this._contributedSidebarContainers.set(info.id, vc);
      this._addContributedActivityBarIcon(info);
      console.log(`[Workbench] Added sidebar container "${info.id}" (${info.title})`);

    } else if (info.location === 'panel') {
      vc.setVisible(false);
      if (this._panelViewsSlot) {
        this._panelViewsSlot.appendChild(vc.element);
      }
      this._contributedPanelContainers.set(info.id, vc);
      console.log(`[Workbench] Added panel container "${info.id}" (${info.title})`);

    } else if (info.location === 'auxiliaryBar') {
      vc.hideTabBar();
      vc.setVisible(false);
      const auxBarPart = this._host.auxiliaryBar as unknown as AuxiliaryBarPart;
      const viewSlot = auxBarPart.viewContainerSlot;
      if (viewSlot) {
        viewSlot.appendChild(vc.element);
      }
      this._contributedAuxBarContainers.set(info.id, vc);
      console.log(`[Workbench] Added auxiliary bar container "${info.id}" (${info.title})`);
    }
  }

  private _onToolContainerRemoved(containerId: string): void {
    if (this._containerRedirects.has(containerId)) {
      this._containerRedirects.delete(containerId);
      return;
    }

    const sidebarVc = this._contributedSidebarContainers.get(containerId);
    if (sidebarVc) {
      if (this._activeSidebarContainerId === containerId) {
        this.switchSidebarContainer(undefined);
      }
      sidebarVc.dispose();
      this._contributedSidebarContainers.delete(containerId);
      this._removeContributedActivityBarIcon(containerId);
      return;
    }

    const panelVc = this._contributedPanelContainers.get(containerId);
    if (panelVc) {
      panelVc.dispose();
      this._contributedPanelContainers.delete(containerId);
      return;
    }

    const auxVc = this._contributedAuxBarContainers.get(containerId);
    if (auxVc) {
      auxVc.dispose();
      this._contributedAuxBarContainers.delete(containerId);
      return;
    }
  }

  // ── View add/remove ──

  private _onToolViewAdded(info: IContributedView): void {
    const containerId = info.containerId;

    for (const [_id, vc] of this._builtinSidebarContainers) {
      if (vc.getView(info.id)) {
        console.log(`[Workbench] View "${info.id}" already in built-in container — skipping contributed add`);
        return;
      }
    }

    const redirectTarget = this._containerRedirects.get(containerId);
    if (redirectTarget) {
      const builtinVc = this._builtinSidebarContainers.get(redirectTarget);
      if (builtinVc) {
        console.log(`[Workbench] Redirecting view "${info.id}" to built-in container "${redirectTarget}"`);
        this._addViewToContainer(info, builtinVc);
        return;
      }
    }

    const sidebarVc = this._contributedSidebarContainers.get(containerId);
    if (sidebarVc) { this._addViewToContainer(info, sidebarVc); return; }

    const panelVc = this._contributedPanelContainers.get(containerId);
    if (panelVc) { this._addViewToContainer(info, panelVc); return; }

    const auxVc = this._contributedAuxBarContainers.get(containerId);
    if (auxVc) { this._addViewToContainer(info, auxVc); return; }

    if (containerId === 'sidebar' || containerId === 'workbench.parts.sidebar') {
      if (this._defaultSidebarContainer) this._addViewToContainer(info, this._defaultSidebarContainer);
      return;
    }
    if (containerId === 'panel' || containerId === 'workbench.parts.panel') {
      if (this._genericPanelContainer) this._addViewToContainer(info, this._genericPanelContainer);
      return;
    }
    if (containerId === 'auxiliaryBar' || containerId === 'workbench.parts.auxiliarybar') {
      if (this._genericAuxBarContainer) this._addViewToContainer(info, this._genericAuxBarContainer);
      return;
    }

    console.warn(`[Workbench] View "${info.id}" targets unknown container "${containerId}"`);
  }

  private async _addViewToContainer(info: IContributedView, container: ViewContainer): Promise<void> {
    try {
      const view = await this._viewManager.createView(info.id);
      container.addView(view);
    } catch (err) {
      console.error(`[Workbench] Failed to add view "${info.id}" to container:`, err);
    }
  }

  private _onToolViewRemoved(viewId: string): void {
    // Check builtin + generic containers first
    for (const vc of [...this._builtinSidebarContainers.values()]) {
      if (vc?.getView(viewId)) { vc.removeView(viewId); return; }
    }
    if (this._genericPanelContainer?.getView(viewId)) {
      this._genericPanelContainer.removeView(viewId); return;
    }
    if (this._genericAuxBarContainer?.getView(viewId)) {
      this._genericAuxBarContainer.removeView(viewId); return;
    }
    for (const vc of this._contributedSidebarContainers.values()) {
      if (vc.getView(viewId)) { vc.removeView(viewId); return; }
    }
    for (const vc of this._contributedPanelContainers.values()) {
      if (vc.getView(viewId)) { vc.removeView(viewId); return; }
    }
    for (const vc of this._contributedAuxBarContainers.values()) {
      if (vc.getView(viewId)) { vc.removeView(viewId); return; }
    }
  }

  // ── Placeholder replacement ──

  private _replaceBuiltinPlaceholderIfNeeded(viewId: string): void {
    for (const [_id, vc] of this._builtinSidebarContainers) {
      const existingView = vc.getView(viewId);
      if (!existingView) continue;

      const provider = this._viewContribution.getProvider(viewId);
      if (!provider) return;

      const sectionEl = vc.element.querySelector(`[data-view-id="${viewId}"] .view-section-body`) as HTMLElement;
      if (!sectionEl) return;

      sectionEl.innerHTML = '';
      const contentEl = $('div');
      contentEl.className = 'tool-view-content fill-container-scroll';
      sectionEl.appendChild(contentEl);

      try {
        provider.resolveView(viewId, contentEl);
        console.log(`[Workbench] Replaced placeholder for "${viewId}" with real tool view`);
      } catch (err) {
        console.error(`[Workbench] Failed to resolve tool view for "${viewId}":`, err);
      }
      return;
    }
  }

  // ── Activity bar icon management ──

  private _addContributedActivityBarIcon(info: IContributedContainer): void {
    const svgIcon = this._resolveCodiconSvg(info.icon);
    this._host.activityBarPart.addIcon({
      id: info.id,
      icon: svgIcon ?? info.icon ?? info.title.charAt(0).toUpperCase(),
      isSvg: svgIcon !== undefined,
      label: info.title,
      source: 'contributed',
    });
  }

  private _resolveCodiconSvg(icon?: string): string | undefined {
    const codiconMap: Record<string, string> = {
      '🧩': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7H16V4.5C16 3.12 14.88 2 13.5 2C12.12 2 11 3.12 11 4.5V7H6.5C5.67 7 5 7.67 5 8.5V13H7.5C8.88 13 10 14.12 10 15.5C10 16.88 8.88 18 7.5 18H5V22.5C5 23.33 5.67 24 6.5 24H11V21.5C11 20.12 12.12 19 13.5 19C14.88 19 16 20.12 16 21.5V24H20.5C21.33 24 22 23.33 22 22.5V18H19.5C18.12 18 17 16.88 17 15.5C17 14.12 18.12 13 19.5 13H22V8.5C22 7.67 21.33 7 20.5 7Z" fill="currentColor"/></svg>',
      'codicon-extensions': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M20.5 7H16V4.5C16 3.12 14.88 2 13.5 2C12.12 2 11 3.12 11 4.5V7H6.5C5.67 7 5 7.67 5 8.5V13H7.5C8.88 13 10 14.12 10 15.5C10 16.88 8.88 18 7.5 18H5V22.5C5 23.33 5.67 24 6.5 24H11V21.5C11 20.12 12.12 19 13.5 19C14.88 19 16 20.12 16 21.5V24H20.5C21.33 24 22 23.33 22 22.5V18H19.5C18.12 18 17 16.88 17 15.5C17 14.12 18.12 13 19.5 13H22V8.5C22 7.67 21.33 7 20.5 7Z" fill="currentColor"/></svg>',
      '⚙️': '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19.85 8.75L18.01 8.07L19 6.54L17.46 5L15.93 5.99L15.25 4.15H13.25L12.57 5.99L11.04 5L9.5 6.54L10.49 8.07L8.65 8.75V10.75L10.49 11.43L9.5 12.96L11.04 14.5L12.57 13.51L13.25 15.35H15.25L15.93 13.51L17.46 14.5L19 12.96L18.01 11.43L19.85 10.75V8.75ZM14.25 12.5C13.01 12.5 12 11.49 12 10.25C12 9.01 13.01 8 14.25 8C15.49 8 16.5 9.01 16.5 10.25C16.5 11.49 15.49 12.5 14.25 12.5Z" fill="currentColor"/></svg>',
      '📓': '<svg width="24" height="24" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.23 1h-1.46L3.52 9.25l-.16.22L2 13.59 2.41 14l4.12-1.36.22-.16L15 4.23V2.77L13.23 1zM2.41 13.59l1.51-3 1.5 1.5-3.01 1.5zm3.52-2.02l-1.5-1.5L12 2.5l1.5 1.5-7.57 7.57z" fill="currentColor"/></svg>',
    };
    return icon ? codiconMap[icon] : undefined;
  }

  private _removeContributedActivityBarIcon(containerId: string): void {
    this._host.activityBarPart.removeIcon(containerId);
  }

  // ── Sidebar container switching ──

  /**
   * Switch the active sidebar container.
   * @param containerId — ID of a container, or `undefined` for the built-in default.
   */
  switchSidebarContainer(containerId: string | undefined): void {
    if (this._activeSidebarContainerId === containerId) return;

    // Hide current active container
    if (this._activeSidebarContainerId) {
      const current =
        this._builtinSidebarContainers.get(this._activeSidebarContainerId) ??
        this._contributedSidebarContainers.get(this._activeSidebarContainerId);
      current?.setVisible(false);
    } else {
      // No active container — hide the default sidebar container
      this._defaultSidebarContainer?.setVisible(false);
    }

    // Show new container
    this._activeSidebarContainerId = containerId;
    this._workbenchContext?.setActiveViewContainer(containerId ?? 'view.explorer');

    if (containerId) {
      const next =
        this._builtinSidebarContainers.get(containerId) ??
        this._contributedSidebarContainers.get(containerId);
      if (next) {
        next.setVisible(true);
        this._host.layoutViewContainers();
      }
    } else {
      // Show default sidebar container
      if (this._defaultSidebarContainer) {
        this._defaultSidebarContainer.setVisible(true);
        this._host.layoutViewContainers();
      }
    }

    // Update activity bar highlight
    this._host.activityBarPart.setActiveIcon(containerId ?? 'view.explorer');

    // Update sidebar header label
    if (this._sidebarHeaderLabel) {
      if (containerId) {
        const builtinVc = this._builtinSidebarContainers.get(containerId);
        if (builtinVc) {
          const views = builtinVc.getViews();
          this._sidebarHeaderLabel.textContent = (views[0]?.name ?? 'SIDEBAR').toUpperCase();
        } else {
          const info = this._viewContribution?.getContainer(containerId);
          this._sidebarHeaderLabel.textContent = (info?.title ?? 'SIDEBAR').toUpperCase();
        }
      } else {
        // Restore to the active view name in the built-in container
        const activeId = this._defaultSidebarContainer?.activeViewId;
        const activeView = activeId ? this._defaultSidebarContainer?.getView(activeId) : undefined;
        this._sidebarHeaderLabel.textContent = (activeView?.name ?? 'EXPLORER').toUpperCase();
      }
    }
  }

  /**
   * Programmatically switch to a specific sidebar view and ensure sidebar is visible.
   */
  showSidebarView(viewId: string): void {
    if (!this._host.sidebar.visible) {
      this._host.toggleSidebar();
    }
    if (this._builtinSidebarContainers.has(viewId) || this._contributedSidebarContainers.has(viewId)) {
      this.switchSidebarContainer(viewId);
    }
  }

  /**
   * Get the active sidebar container's label (for the default, return active view's name).
   */
  get sidebarHeaderLabelElement(): HTMLElement | undefined {
    return this._sidebarHeaderLabel;
  }

  // ── Layout helper ──

  /**
   * Layout all view containers according to their part dimensions.
   * Called from `_layoutViewContainers()` override in workbench.ts.
   */
  layoutContainers(
    sidebar: { visible: boolean; width: number; height: number },
    panel: { visible: boolean; width: number; height: number },
    auxBar: { visible: boolean; width: number; height: number },
    headerHeight: number,
    orientation: { horizontal: Orientation; vertical: Orientation },
    sidebarContainer: ViewContainer,
  ): void {
    if (sidebar.visible && sidebar.width > 0) {
      const sidebarH = sidebar.height - headerHeight;
      if (this._activeSidebarContainerId) {
        const active =
          this._builtinSidebarContainers.get(this._activeSidebarContainerId) ??
          this._contributedSidebarContainers.get(this._activeSidebarContainerId);
        active?.layout(sidebar.width, sidebarH, orientation.vertical);
      } else {
        sidebarContainer.layout(sidebar.width, sidebarH, orientation.vertical);
      }
    }
    if (panel.visible && panel.height > 0) {
      for (const vc of this._contributedPanelContainers.values()) {
        vc.layout(panel.width, panel.height, orientation.horizontal);
      }
    }
    if (auxBar.visible && auxBar.width > 0) {
      for (const vc of this._contributedAuxBarContainers.values()) {
        vc.layout(auxBar.width, auxBar.height - headerHeight, orientation.vertical);
      }
    }
  }

  // ── Teardown (workspace switch) ──

  /**
   * Clear all contribution state for a workspace switch.
   * Disposes contributed containers, clears maps, disconnects tab observers.
   */
  teardown(): void {
    // Disconnect tab observers
    for (const obs of this._tabObservers) obs.disconnect();
    this._tabObservers = [];

    // Clear contribution event listeners
    this._viewContribListeners.clear();

    // Clear VCP internal maps
    if (this._viewContribution) {
      for (const toolId of this._viewContribution.getContributedToolIds()) {
        this._viewContribution.removeContributions(toolId);
      }
    }

    // Dispose built-in sidebar containers
    for (const vc of this._builtinSidebarContainers.values()) vc.dispose();
    this._builtinSidebarContainers.clear();

    // Dispose contributed containers
    for (const vc of this._contributedSidebarContainers.values()) vc.dispose();
    this._contributedSidebarContainers.clear();
    for (const vc of this._contributedPanelContainers.values()) vc.dispose();
    this._contributedPanelContainers.clear();
    for (const vc of this._contributedAuxBarContainers.values()) vc.dispose();
    this._contributedAuxBarContainers.clear();

    this._activeSidebarContainerId = undefined;
    this._sidebarHeaderLabel = undefined;
    this._containerRedirects.clear();
  }
}
