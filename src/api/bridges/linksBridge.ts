// linksBridge.ts — bridges `parallx.links` to the workbench's
// LinkResolverService.
//
// Adds a tiny per-tool wrapper around the shared service so each extension's
// registrations are tracked for cleanup on deactivation. The bridge itself
// holds no state beyond a list of subscriptions; the service is the source
// of truth.

import { type IDisposable, toDisposable } from '../../platform/lifecycle.js';
import type {
  ILinkResolverService,
  LinkContract,
  LinkMetadata,
} from '../../links/linkResolverService.js';
import { mintParallxUri, parseParallxUri, type ParsedLink } from '../../links/parallxUri.js';

/**
 * Shape an extension passes to `parallx.links.register()`. The bridge
 * fills in `extensionId` automatically.
 */
export type LinkContractInput = Omit<LinkContract, 'extensionId'> & {
  /** Optional override; defaults to the calling tool id. */
  readonly extensionId?: string;
};

export class LinksBridge {
  private _disposed = false;
  private readonly _registrations: IDisposable[] = [];

  constructor(
    private readonly _toolId: string,
    private readonly _service: ILinkResolverService | undefined,
    private readonly _subscriptions: IDisposable[],
  ) {}

  register(contract: LinkContractInput): IDisposable {
    this._throwIfDisposed();
    if (!this._service) {
      console.warn(`[LinksBridge] No LinkResolverService — register() is a no-op for ${this._toolId}`);
      return toDisposable(() => {});
    }
    const full: LinkContract = {
      segment: contract.segment,
      displayName: contract.displayName,
      kinds: contract.kinds,
      extensionId: contract.extensionId ?? this._toolId,
    };
    const d = this._service.register(full);
    this._registrations.push(d);
    this._subscriptions.push(d);
    return d;
  }

  async open(uri: string): Promise<boolean> {
    this._throwIfDisposed();
    if (!this._service) return false;
    return this._service.open(uri, { source: this._toolId });
  }

  mint(
    segment: string,
    path: string | readonly string[],
    params?: Record<string, string | number | undefined | null>,
  ): string {
    return mintParallxUri(segment, path, params);
  }

  parse(uri: string): ParsedLink | null {
    return parseParallxUri(uri);
  }

  allContracts(): readonly LinkContract[] {
    return this._service ? this._service.allContracts() : [];
  }

  resolveMetadata(uri: string): Promise<LinkMetadata | null> {
    if (!this._service) return Promise.resolve(null);
    return this._service.resolveMetadata(uri);
  }

  get onDidChangeContracts(): (listener: () => void) => IDisposable {
    return (listener: () => void) => {
      if (!this._service) return toDisposable(() => {});
      const d = this._service.onDidChangeContracts(listener);
      this._subscriptions.push(d);
      return d;
    };
  }

  dispose(): void {
    this._disposed = true;
    for (const d of this._registrations) d.dispose();
    this._registrations.length = 0;
  }

  private _throwIfDisposed(): void {
    if (this._disposed) {
      throw new Error(`[LinksBridge] Tool "${this._toolId}" has been deactivated — API access is no longer allowed.`);
    }
  }
}
