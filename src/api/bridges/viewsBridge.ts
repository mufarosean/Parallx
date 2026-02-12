// viewsBridge.ts — bridges parallx.views to internal ViewManager
//
// Allows tools to register view providers that render into shell containers.
// View providers are wrapped into IViewDescriptor objects and registered
// with the ViewManager.

import { IDisposable, toDisposable } from '../../platform/lifecycle.js';
import { Emitter } from '../../platform/events.js';
import type { ViewManager } from '../../views/viewManager.js';
import type { IView, ViewState } from '../../views/view.js';
import { DEFAULT_SIZE_CONSTRAINTS } from '../../layout/layoutTypes.js';
import type { ViewContributionProcessor } from '../../contributions/viewContribution.js';

/**
 * Shape of a tool-provided view provider.
 */
export interface ToolViewProvider {
  createView(container: HTMLElement): IDisposable;
}

export interface ViewProviderOptions {
  readonly name?: string;
  readonly icon?: string;
  readonly defaultContainerId?: string;
  readonly when?: string;
}

/**
 * Minimal shape of ActivityBarPart for badge delegation.
 * Avoids circular import of the full Part class.
 */
export interface BadgeHost {
  setBadge(iconId: string, badge: { count?: number; dot?: boolean } | undefined): void;
}

/**
 * Bridge for the `parallx.views` API namespace.
 */
export class ViewsBridge {
  private readonly _registrations: IDisposable[] = [];
  private _disposed = false;

  constructor(
    private readonly _toolId: string,
    private readonly _viewManager: ViewManager,
    private readonly _subscriptions: IDisposable[],
    private readonly _viewContributionProcessor?: ViewContributionProcessor,
    private readonly _badgeHost?: BadgeHost,
  ) {}

  /**
   * Register a view provider for the given view ID.
   */
  registerViewProvider(
    viewId: string,
    provider: ToolViewProvider,
    options?: ViewProviderOptions,
  ): IDisposable {
    this._throwIfDisposed();

    // If this view was declared in a tool manifest (Cap 6), delegate to the
    // ViewContributionProcessor which manages the placeholder → content transition.
    if (this._viewContributionProcessor?.hasContributedView(viewId)) {
      const disposable = this._viewContributionProcessor.registerProvider(viewId, {
        resolveView: (_id: string, container: HTMLElement) => provider.createView(container),
      });
      this._registrations.push(disposable);
      this._subscriptions.push(disposable);
      return disposable;
    }

    // Fallback: inline registration (pre-Cap 6 path or views not declared in manifest)
    const name = options?.name ?? viewId;
    const containerId = options?.defaultContainerId ?? 'workbench.parts.sidebar';
    const icon = options?.icon;
    const when = options?.when;

    // Create a descriptor that wraps the tool's provider into an IView
    const descriptor = {
      id: viewId,
      name,
      icon,
      containerId,
      when,
      constraints: DEFAULT_SIZE_CONSTRAINTS,
      focusOnActivate: false,
      order: 100,
      factory: () => _createToolView(viewId, name, provider),
    };

    this._viewManager.register(descriptor);

    const disposable = toDisposable(() => {
      this._viewManager.unregister(viewId);
    });

    this._registrations.push(disposable);
    this._subscriptions.push(disposable);

    return disposable;
  }

  /**
   * Set a badge on an activity bar icon.
   * VS Code reference: IActivity badge on CompositeBarActionViewItem.
   */
  setBadge(containerId: string, badge: { count?: number; dot?: boolean } | undefined): void {
    this._throwIfDisposed();
    if (!this._badgeHost) {
      console.warn(`[ViewsBridge] Badge host not available — cannot setBadge for "${containerId}"`);
      return;
    }
    this._badgeHost.setBadge(containerId, badge);
  }

  dispose(): void {
    this._disposed = true;
    for (const d of this._registrations) {
      d.dispose();
    }
    this._registrations.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[ViewsBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}

// ── Tool View Adapter ──

/**
 * Adapts a tool's ViewProvider into the internal IView interface.
 */
function _createToolView(viewId: string, name: string, provider: ToolViewProvider): IView {
  let _element: HTMLElement | undefined;
  let _providerDisposable: IDisposable | undefined;
  let _visible = false;
  let _disposed = false;

  const _onDidChangeConstraints = new Emitter<void>();
  const _onDidChangeVisibility = new Emitter<boolean>();

  return {
    get id() { return viewId; },
    get name() { return name; },
    get element() { return _element; },

    // Size constraints — use defaults
    get minimumWidth() { return DEFAULT_SIZE_CONSTRAINTS.minimumWidth; },
    get maximumWidth() { return DEFAULT_SIZE_CONSTRAINTS.maximumWidth; },
    get minimumHeight() { return DEFAULT_SIZE_CONSTRAINTS.minimumHeight; },
    get maximumHeight() { return DEFAULT_SIZE_CONSTRAINTS.maximumHeight; },

    // Events
    onDidChangeConstraints: _onDidChangeConstraints.event,
    onDidChangeVisibility: _onDidChangeVisibility.event,

    createElement(container: HTMLElement): void {
      if (_disposed) return;
      _element = document.createElement('div');
      _element.className = 'tool-view-content';
      _element.style.width = '100%';
      _element.style.height = '100%';
      _element.style.overflow = 'auto';
      container.appendChild(_element);

      try {
        _providerDisposable = provider.createView(_element);
      } catch (err) {
        console.error(`[ViewsBridge] Error rendering view "${viewId}":`, err);
        _element.textContent = `Error loading view: ${err}`;
      }
    },

    setVisible(visible: boolean): void {
      _visible = visible;
      if (_element) {
        _element.style.display = visible ? '' : 'none';
      }
      _onDidChangeVisibility.fire(visible);
    },

    focus(): void {
      _element?.focus();
    },

    layout(width: number, height: number): void {
      if (_element) {
        _element.style.width = `${width}px`;
        _element.style.height = `${height}px`;
      }
    },

    saveState(): ViewState {
      return {};
    },

    restoreState(_state: ViewState): void {
      // Tool views manage their own state through the Memento API
    },

    dispose(): void {
      if (_disposed) return;
      _disposed = true;
      _providerDisposable?.dispose();
      _onDidChangeConstraints.dispose();
      _onDidChangeVisibility.dispose();
      _element?.remove();
      _element = undefined;
    },
  };
}
