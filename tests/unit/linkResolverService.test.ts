// linkResolverService.test.ts — M66 Iteration A.
//
// Locks the registry contract: register → open dispatches to the right
// handler → dispose removes it → onDidChangeContracts fires.

import { describe, it, expect, vi } from 'vitest';
import { LinkResolverService, type LinkContract } from '../../src/links/linkResolverService.js';
import type { ParsedLink } from '../../src/links/parallxUri.js';

function makeContract(segment: string, kindName = 'thing'): LinkContract {
  return {
    segment,
    displayName: segment,
    extensionId: `${segment}-ext`,
    kinds: {
      [kindName]: {
        uriTemplate: `parallx://${segment}/${kindName}/<id>`,
        description: `open a ${kindName}`,
        open: async (_parsed: ParsedLink) => true,
      },
    },
  };
}

describe('LinkResolverService', () => {
  it('register() returns a disposable and stores the contract', () => {
    const svc = new LinkResolverService();
    const c = makeContract('foo');
    const d = svc.register(c);
    expect(svc.allContracts()).toContain(c);
    d.dispose();
    expect(svc.allContracts()).not.toContain(c);
  });

  it('register() throws on duplicate segment', () => {
    const svc = new LinkResolverService();
    svc.register(makeContract('foo'));
    expect(() => svc.register(makeContract('foo'))).toThrow();
  });

  it('open() dispatches to the matching handler', async () => {
    const svc = new LinkResolverService();
    const openSpy = vi.fn(async () => true);
    svc.register({
      segment: 'foo',
      displayName: 'Foo',
      extensionId: 'foo-ext',
      kinds: {
        thing: {
          uriTemplate: 'parallx://foo/thing/<id>',
          description: 'x',
          open: openSpy,
        },
      },
    });
    const ok = await svc.open('parallx://foo/thing/123');
    expect(ok).toBe(true);
    expect(openSpy).toHaveBeenCalledOnce();
    const parsed = openSpy.mock.calls[0][0] as ParsedLink;
    expect(parsed.segment).toBe('foo');
    expect(parsed.pathSegments).toEqual(['thing', '123']);
  });

  it('open() returns false for unknown segment', async () => {
    const svc = new LinkResolverService();
    const ok = await svc.open('parallx://nope/thing/1');
    expect(ok).toBe(false);
  });

  it('open() returns false for unknown kind', async () => {
    const svc = new LinkResolverService();
    svc.register(makeContract('foo', 'thing'));
    const ok = await svc.open('parallx://foo/other/1');
    expect(ok).toBe(false);
  });

  it('open() returns false (never throws) when handler throws', async () => {
    const svc = new LinkResolverService();
    svc.register({
      segment: 'foo',
      displayName: 'Foo',
      extensionId: 'foo-ext',
      kinds: {
        thing: {
          uriTemplate: 'parallx://foo/thing/<id>',
          description: 'x',
          open: async () => { throw new Error('boom'); },
        },
      },
    });
    const ok = await svc.open('parallx://foo/thing/1');
    expect(ok).toBe(false);
  });

  it('open() returns false for non-parallx URI', async () => {
    const svc = new LinkResolverService();
    const ok = await svc.open('https://example.com');
    expect(ok).toBe(false);
  });

  it('resolveMetadata() dispatches and returns null for unknown segments', async () => {
    const svc = new LinkResolverService();
    svc.register({
      segment: 'foo',
      displayName: 'Foo',
      extensionId: 'foo-ext',
      kinds: {
        thing: {
          uriTemplate: 'parallx://foo/thing/<id>',
          description: 'x',
          open: async () => true,
          resolveMetadata: async () => ({ title: 'Hello', icon: '📄' }),
        },
      },
    });
    const md = await svc.resolveMetadata('parallx://foo/thing/1');
    expect(md).toEqual({ title: 'Hello', icon: '📄' });
    const none = await svc.resolveMetadata('parallx://nope/thing/1');
    expect(none).toBeNull();
  });

  it('onDidChangeContracts fires on register and on dispose', () => {
    const svc = new LinkResolverService();
    const onChange = vi.fn();
    svc.onDidChangeContracts(onChange);
    const d = svc.register(makeContract('foo'));
    expect(onChange).toHaveBeenCalledTimes(1);
    d.dispose();
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('LinkResolverService.verify', () => {
  it('asks the link\'s own kind, passing the thorough flag', async () => {
    const svc = new LinkResolverService();
    const seen: unknown[] = [];
    svc.register({
      ...makeContract('files', 'file'),
      kinds: {
        file: {
          uriTemplate: 'parallx://files/file?path=<p>',
          description: 'a file',
          open: async () => true,
          verify: async (parsed, options) => {
            seen.push([parsed.params.path, options.thorough]);
            return { ok: true, uri: parsed.raw, checked: 'exists', location: 'page 2 of 9' };
          },
        },
      },
    });
    const r = await svc.verify('parallx://files/file?path=a.pdf', { thorough: true });
    expect(r).toEqual({ ok: true, uri: 'parallx://files/file?path=a.pdf', checked: 'exists', location: 'page 2 of 9' });
    expect(seen).toEqual([['a.pdf', true]]);
  });

  it('fails for a bad URI, an unknown segment or kind, and a check that throws', async () => {
    const svc = new LinkResolverService();
    svc.register({
      ...makeContract('files', 'file'),
      kinds: {
        file: {
          uriTemplate: 'parallx://files/file', description: 'a file', open: async () => true,
          verify: async () => { throw new Error('disk gone'); },
        },
      },
    });
    expect(await svc.verify('not a link')).toEqual({ ok: false, error: 'Not a valid parallx:// link.' });
    const seg = await svc.verify('parallx://nope/file');
    expect(seg.ok).toBe(false);
    const kind = await svc.verify('parallx://files/folder');
    expect(kind).toEqual({ ok: false, error: '"files" has no link kind "folder". Its kinds: file.' });
    const thrown = await svc.verify('parallx://files/file?path=x');
    expect(thrown).toEqual({ ok: false, error: 'The link could not be checked: disk gone' });
  });

  it('says plainly when a kind cannot check its targets', async () => {
    const svc = new LinkResolverService();
    svc.register(makeContract('foo'));
    const r = await svc.verify('parallx://foo/thing/1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.checked).toBe('The link is well formed; foo cannot check that its target exists.');
  });
});
