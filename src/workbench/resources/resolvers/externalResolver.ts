// externalResolver.ts — Built-in external Resource resolver (Slice A9)
//
// "Resolves" an `ExternalResource` by returning its URI unchanged. Network
// fetching for `http(s):` URIs is intentionally NOT done here — it belongs
// in the web-research extension's bounded egress chokepoint
// (electron/webFetchBridge.cjs), which has its own security model.
//
// This resolver exists so consumers calling `resolveUri('http://...')` or
// `resolveUri('parallx://external:...')` get a consistent shape without
// having to special-case external URIs in their own code.

import type { ExternalResource } from '../resource.js';
import type { ResourceResolver } from '../resourceRegistry.js';

export interface ExternalResolveResult {
  readonly resource: ExternalResource;
  readonly uri: string;
}

export class ExternalResourceResolver implements ResourceResolver<ExternalResource, ExternalResolveResult> {
  readonly type = 'external' as const;

  async resolve(resource: ExternalResource): Promise<ExternalResolveResult> {
    if (!resource.uri) {
      throw new Error('[ExternalResourceResolver] ExternalResource.uri is empty');
    }
    return { resource, uri: resource.uri };
  }
}

export function externalResourceResolver(): ExternalResourceResolver {
  return new ExternalResourceResolver();
}
