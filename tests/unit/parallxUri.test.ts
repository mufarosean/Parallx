// parallxUri.test.ts — M66 Iteration A.
//
// Locks the pure parse/mint contract for `parallx://` URIs. Every other
// piece of the linking system (LinkResolverService, LinksBridge, canvas
// link block, future parallx_link tool) depends on this round-trip shape
// being stable.

import { describe, it, expect } from 'vitest';
import { parseParallxUri, mintParallxUri, isParallxUri } from '../../src/links/parallxUri.js';

describe('parallxUri', () => {
  describe('parseParallxUri', () => {
    it('parses a simple URI with path id', () => {
      const p = parseParallxUri('parallx://canvas/page/abc');
      expect(p).not.toBeNull();
      expect(p!.segment).toBe('canvas');
      expect(p!.pathSegments).toEqual(['page', 'abc']);
      expect(p!.kind).toBe('page');
      expect(p!.params).toEqual({});
      expect(p!.raw).toBe('parallx://canvas/page/abc');
    });

    it('parses a URI with query params', () => {
      const p = parseParallxUri('parallx://explorer/file?path=%2Fa%2Fb.md&line=42');
      expect(p).not.toBeNull();
      expect(p!.segment).toBe('explorer');
      expect(p!.kind).toBe('file');
      expect(p!.pathSegments).toEqual(['file']);
      expect(p!.params).toEqual({ path: '/a/b.md', line: '42' });
    });

    it('returns null for non-parallx schemes', () => {
      expect(parseParallxUri('https://example.com')).toBeNull();
      expect(parseParallxUri('file:///x/y')).toBeNull();
    });

    it('returns null for invalid input', () => {
      expect(parseParallxUri('')).toBeNull();
      expect(parseParallxUri('parallx://')).toBeNull();
      expect(parseParallxUri('not a uri')).toBeNull();
      // @ts-expect-error — runtime guard
      expect(parseParallxUri(null)).toBeNull();
      // @ts-expect-error — runtime guard
      expect(parseParallxUri(undefined)).toBeNull();
    });

    it('decodes encoded path segments', () => {
      const p = parseParallxUri('parallx://canvas/page/hello%20world');
      expect(p!.pathSegments).toEqual(['page', 'hello world']);
    });
  });

  describe('mintParallxUri', () => {
    it('mints a URI from a path array', () => {
      const uri = mintParallxUri('canvas', ['page', 'abc']);
      expect(uri).toBe('parallx://canvas/page/abc');
    });

    it('mints a URI from a slash-separated path string', () => {
      const uri = mintParallxUri('canvas', 'page/abc');
      expect(uri).toBe('parallx://canvas/page/abc');
    });

    it('encodes special characters in params', () => {
      const uri = mintParallxUri('explorer', 'file', { path: '/a b/c.md', line: 42 });
      expect(uri).toContain('parallx://explorer/file?');
      expect(uri).toContain('path=%2Fa+b%2Fc.md');
      expect(uri).toContain('line=42');
    });

    it('skips null/undefined params', () => {
      const uri = mintParallxUri('s', 'k', { a: 'x', b: null, c: undefined });
      expect(uri).toBe('parallx://s/k?a=x');
    });

    it('throws when segment is missing', () => {
      expect(() => mintParallxUri('', 'page/abc')).toThrow();
    });
  });

  describe('round-trip', () => {
    it('mint -> parse preserves segment, path, params', () => {
      const uri = mintParallxUri('media-organizer', ['photo', '123'], { caption: 'hello world' });
      const p = parseParallxUri(uri);
      expect(p).not.toBeNull();
      expect(p!.segment).toBe('media-organizer');
      expect(p!.pathSegments).toEqual(['photo', '123']);
      expect(p!.kind).toBe('photo');
      expect(p!.params).toEqual({ caption: 'hello world' });
    });
  });

  describe('isParallxUri', () => {
    it('accepts parallx:// strings', () => {
      expect(isParallxUri('parallx://canvas/page/1')).toBe(true);
      expect(isParallxUri('  PARALLX://canvas/page/1  ')).toBe(true);
    });
    it('rejects everything else', () => {
      expect(isParallxUri('https://x.com')).toBe(false);
      expect(isParallxUri('')).toBe(false);
      expect(isParallxUri(null)).toBe(false);
      expect(isParallxUri(undefined)).toBe(false);
      expect(isParallxUri(42)).toBe(false);
    });
  });
});
