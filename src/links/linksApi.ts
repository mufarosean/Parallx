// linksApi.ts — shared structural type for the `parallx.links` namespace.
//
// Each built-in tool defines its own local `ParallxApi` interface (see e.g.
// `src/built-in/canvas/main.ts`). To avoid duplicating the full `links`
// shape in every one of those interfaces, this file exports the minimum
// structural type. Built-ins import it and embed it under the `links` key
// of their local `ParallxApi`:
//
//   import type { LinksApi } from '../../links/linksApi.js';
//   interface ParallxApi {
//     ...
//     links: LinksApi;
//   }
//
// External (`.js`) extensions don't need types at all — they consume
// `parallx.links` dynamically.

import type { IDisposable } from '../platform/lifecycle.js';

export interface LinksApiParsedLink {
  readonly raw: string;
  readonly segment: string;
  readonly pathSegments: readonly string[];
  readonly params: Readonly<Record<string, string>>;
  readonly kind: string | undefined;
}

export interface LinksApiKindHandler {
  readonly uriTemplate: string;
  readonly description: string;
  readonly examples?: readonly string[];
  open(parsed: LinksApiParsedLink, ctx: { source?: string }): Promise<boolean>;
  resolveMetadata?(parsed: LinksApiParsedLink): Promise<{ title: string; icon?: string } | null>;
}

export interface LinksApiContractInput {
  readonly segment: string;
  readonly displayName: string;
  readonly extensionId?: string;
  readonly kinds: Readonly<Record<string, LinksApiKindHandler>>;
}

export interface LinksApiContract extends LinksApiContractInput {
  readonly extensionId: string;
}

export interface LinksApi {
  register(contract: LinksApiContractInput): IDisposable;
  open(uri: string): Promise<boolean>;
  mint(
    segment: string,
    path: string | readonly string[],
    params?: Record<string, string | number | undefined | null>,
  ): string;
  parse(uri: string): LinksApiParsedLink | null;
  allContracts(): readonly LinksApiContract[];
  resolveMetadata(uri: string): Promise<{ title: string; icon?: string } | null>;
  onDidChangeContracts(listener: () => void): IDisposable;
}
