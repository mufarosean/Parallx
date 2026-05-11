// linkResolverService.ts — workbench-shared registry of LinkContracts.
//
// One instance lives in the workbench services; every extension's
// `parallx.links.register(...)` call ultimately writes to this map. Four
// consumers read from it:
//
//   1. The `LinksBridge.open()` path — routes a URI to the right handler.
//   2. The chat prompt builder — auto-generates the URI-templates section
//      and the active-extensions list (Iteration C).
//   3. The canvas `link` block renderer — calls `resolveMetadata()` for
//      title/icon (Iteration A — click interception today, full chips later).
//   4. The future `parallx_link` chat tool — validates the AI's target URI
//      against the union of registered segments (Iteration C).
//
// This is the ONLY integration point. Reviewers should reject any PR that
// adds a per-extension branch in core code — everything goes through
// `register()`.

import { Emitter, type Event } from '../platform/events.js';
import { type IDisposable, toDisposable } from '../platform/lifecycle.js';
import { createServiceIdentifier } from '../platform/types.js';
import { parseParallxUri, type ParsedLink } from './parallxUri.js';

// ─── Contract types ──────────────────────────────────────────────────────────

export interface LinkResolveContext {
  /** Tool id that initiated the open call (`'parallx.chat'`, etc.). Best-effort. */
  readonly source?: string;
}

export interface LinkMetadata {
  readonly title: string;
  readonly icon?: string;
}

/** Per-kind handler. The AI sees `uriTemplate` + `description` in the system prompt. */
export interface LinkKindHandler {
  /** Template shown to the AI, e.g. `parallx://canvas/page/<pageId>`. */
  readonly uriTemplate: string;
  /** One-line human-readable description shown to the AI. */
  readonly description: string;
  /** Optional 1–2 examples shown to the AI. */
  readonly examples?: readonly string[];
  /** Open the resource. Returns false if the target is missing/invalid. Never throws. */
  open(parsed: ParsedLink, ctx: LinkResolveContext): Promise<boolean>;
  /** Lazy metadata for the canvas link chip. Returns null if unknown. */
  resolveMetadata?(parsed: ParsedLink): Promise<LinkMetadata | null>;
}

/**
 * The full contract published by an extension. One registration per
 * extension; multiple kinds per contract.
 */
export interface LinkContract {
  /** Segment owned by this extension. Must be unique workspace-wide. */
  readonly segment: string;
  /** Human label for the segment, e.g. `'Canvas'` (used in the active-extensions list). */
  readonly displayName: string;
  /** Owning tool/extension id, used for cleanup tracking. Filled by the bridge. */
  readonly extensionId: string;
  /** Per-resource-kind handlers. */
  readonly kinds: Readonly<Record<string, LinkKindHandler>>;
}

// ─── Service interface ───────────────────────────────────────────────────────

export interface ILinkResolverService {
  readonly _serviceBrand: undefined;

  readonly onDidChangeContracts: Event<void>;

  /** Register a contract. Returns a disposable that unregisters on dispose. */
  register(contract: LinkContract): IDisposable;

  /** Resolve and open a `parallx://` URI. Returns false on any failure. Never throws. */
  open(uri: string, ctx?: LinkResolveContext): Promise<boolean>;

  /** Snapshot of all registered contracts. */
  allContracts(): readonly LinkContract[];

  /** Lazy metadata for a single URI; returns null if unknown or unresolvable. */
  resolveMetadata(uri: string): Promise<LinkMetadata | null>;
}

export const ILinkResolverService = createServiceIdentifier<ILinkResolverService>('ILinkResolverService');

// ─── Implementation ──────────────────────────────────────────────────────────

export class LinkResolverService implements ILinkResolverService {
  declare readonly _serviceBrand: undefined;

  private readonly _contracts = new Map<string, LinkContract>(); // segment → contract
  private readonly _onDidChangeContracts = new Emitter<void>();
  readonly onDidChangeContracts = this._onDidChangeContracts.event;

  register(contract: LinkContract): IDisposable {
    if (!contract || typeof contract.segment !== 'string' || !contract.segment) {
      throw new Error('LinkResolverService.register: contract.segment is required');
    }
    if (this._contracts.has(contract.segment)) {
      throw new Error(`LinkResolverService: segment "${contract.segment}" is already registered`);
    }
    if (!contract.kinds || typeof contract.kinds !== 'object') {
      throw new Error(`LinkResolverService: contract for "${contract.segment}" has no kinds`);
    }
    this._contracts.set(contract.segment, contract);
    this._onDidChangeContracts.fire();
    return toDisposable(() => {
      if (this._contracts.get(contract.segment) === contract) {
        this._contracts.delete(contract.segment);
        this._onDidChangeContracts.fire();
      }
    });
  }

  async open(uri: string, ctx: LinkResolveContext = {}): Promise<boolean> {
    const parsed = parseParallxUri(uri);
    if (!parsed) {
      console.warn(`[LinkResolver] Not a parallx:// URI: ${uri}`);
      return false;
    }
    const contract = this._contracts.get(parsed.segment);
    if (!contract) {
      console.warn(`[LinkResolver] No contract registered for segment "${parsed.segment}" (uri=${uri})`);
      return false;
    }
    const kind = parsed.kind;
    if (!kind) {
      console.warn(`[LinkResolver] URI has no kind: ${uri}`);
      return false;
    }
    const handler = contract.kinds[kind];
    if (!handler) {
      console.warn(`[LinkResolver] No handler for kind "${kind}" in segment "${parsed.segment}"`);
      return false;
    }
    try {
      return await handler.open(parsed, ctx);
    } catch (err) {
      console.error(`[LinkResolver] open() failed for ${uri}:`, err);
      return false;
    }
  }

  async resolveMetadata(uri: string): Promise<LinkMetadata | null> {
    const parsed = parseParallxUri(uri);
    if (!parsed) return null;
    const contract = this._contracts.get(parsed.segment);
    if (!contract) return null;
    const kind = parsed.kind;
    if (!kind) return null;
    const handler = contract.kinds[kind];
    if (!handler || !handler.resolveMetadata) return null;
    try {
      return await handler.resolveMetadata(parsed);
    } catch (err) {
      console.warn(`[LinkResolver] resolveMetadata() failed for ${uri}:`, err);
      return null;
    }
  }

  allContracts(): readonly LinkContract[] {
    return Array.from(this._contracts.values());
  }

  dispose(): void {
    this._contracts.clear();
    this._onDidChangeContracts.dispose();
  }
}
