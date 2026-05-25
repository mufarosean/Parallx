// resolvers/fileResolver.ts — Built-in file Resource resolver (Slice A6)
//
// Reads a FileResource via IFileService.readFile, returning the file's
// content as a string. Registered into IResourceRegistry at workbench
// startup so any consumer can call
//   resourceRegistry.resolveUri('parallx://file/...')
// and get back the file content without re-implementing URI parsing or
// file-service plumbing.
//
// Pure-additive: no consumer reads from this yet. The resolver is
// exercised by tier-0 tests via a mock IFileService.

import { URI } from '../../../platform/uri.js';
import type { FileResource } from '../resource.js';
import type { ResourceResolver } from '../resourceRegistry.js';

/** Subset of IFileService used by this resolver — keeps the resolver tier-0 friendly. */
export interface FileResolverFileService {
  readFile(uri: URI): Promise<{ readonly content: string }>;
}

export interface FileResolveResult {
  readonly resource: FileResource;
  readonly content: string;
}

export class FileResourceResolver implements ResourceResolver<FileResource, FileResolveResult> {
  readonly type = 'file' as const;

  constructor(private readonly _files: FileResolverFileService) {}

  async resolve(resource: FileResource): Promise<FileResolveResult> {
    if (!resource.path) {
      throw new Error('[FileResourceResolver] FileResource.path is empty');
    }
    const uri = URI.file(resource.path);
    const result = await this._files.readFile(uri);
    return { resource, content: result.content };
  }
}

/** Convenience factory mirroring the other primitive constructors. */
export function fileResourceResolver(files: FileResolverFileService): FileResourceResolver {
  return new FileResourceResolver(files);
}
