/**
 * Unit tests for activateCanvasLinks (M81 Slice D).
 *
 * Verifies the Canvas-side wiring that self-registers the `canvas` segment
 * with LinkResolverService via the public extension API. Does not test
 * LinkResolverService itself — that has its own tests.
 */

import { describe, expect, it, vi } from 'vitest';
import { activateCanvasLinks } from '../../src/built-in/canvas/canvasLinks';
import type { LinksApiContractInput, LinksApiParsedLink } from '../../src/links/linksApi';
import type { IDisposable } from '../../src/platform/lifecycle';

interface FakeApi {
  links: { register: ReturnType<typeof vi.fn> };
  editors: { openEditor: ReturnType<typeof vi.fn> };
}

function makeFakes(disposeRecord?: { disposed: boolean }) {
  const disposable: IDisposable = {
    dispose() {
      if (disposeRecord) disposeRecord.disposed = true;
    },
  };
  const api: FakeApi = {
    links: { register: vi.fn().mockReturnValue(disposable) },
    editors: { openEditor: vi.fn().mockResolvedValue(undefined) },
  };
  const context = { subscriptions: [] as Array<IDisposable | (() => void)> };
  return { api, context, disposable };
}

function makeParsed(pageId: string | undefined): LinksApiParsedLink {
  const path = pageId === undefined ? ['page'] : ['page', pageId];
  return {
    raw: `parallx://canvas/${path.join('/')}`,
    segment: 'canvas',
    pathSegments: path,
    params: {},
    kind: 'page',
  };
}

describe('activateCanvasLinks', () => {
  it('registers the canvas segment with the page kind via api.links.register', () => {
    const { api, context } = makeFakes();
    activateCanvasLinks(context, api as unknown as Parameters<typeof activateCanvasLinks>[1]);

    expect(api.links.register).toHaveBeenCalledTimes(1);
    const contract = api.links.register.mock.calls[0][0] as LinksApiContractInput;
    expect(contract.segment).toBe('canvas');
    expect(contract.displayName).toBe('Canvas');
    expect(contract.kinds.page).toBeDefined();
    expect(contract.kinds.page.uriTemplate).toBe('parallx://canvas/page/<pageId>');
    // Only `page` ships in this slice.
    expect(Object.keys(contract.kinds)).toEqual(['page']);
  });

  it('page.open handler opens the canvas editor with the parsed page id', async () => {
    const { api, context } = makeFakes();
    activateCanvasLinks(context, api as unknown as Parameters<typeof activateCanvasLinks>[1]);

    const contract = api.links.register.mock.calls[0][0] as LinksApiContractInput;
    const ok = await contract.kinds.page.open(makeParsed('page-xyz'), {});

    expect(ok).toBe(true);
    expect(api.editors.openEditor).toHaveBeenCalledTimes(1);
    const opts = api.editors.openEditor.mock.calls[0][0];
    expect(opts.typeId).toBe('canvas');
    expect(opts.instanceId).toBe('page-xyz');
  });

  it('page.open returns false when the URI omits the page id', async () => {
    const { api, context } = makeFakes();
    activateCanvasLinks(context, api as unknown as Parameters<typeof activateCanvasLinks>[1]);

    const contract = api.links.register.mock.calls[0][0] as LinksApiContractInput;
    const ok = await contract.kinds.page.open(makeParsed(undefined), {});

    expect(ok).toBe(false);
    expect(api.editors.openEditor).not.toHaveBeenCalled();
  });

  it('pushes the registration disposable into context.subscriptions', () => {
    const { api, context, disposable } = makeFakes();
    activateCanvasLinks(context, api as unknown as Parameters<typeof activateCanvasLinks>[1]);

    expect(context.subscriptions).toHaveLength(1);
    expect(context.subscriptions[0]).toBe(disposable);
  });

  it('disposing the tracked subscription unregisters via the returned disposable', () => {
    const disposeRecord = { disposed: false };
    const { api, context } = makeFakes(disposeRecord);
    activateCanvasLinks(context, api as unknown as Parameters<typeof activateCanvasLinks>[1]);

    expect(disposeRecord.disposed).toBe(false);
    const entry = context.subscriptions[0] as IDisposable;
    entry.dispose();
    expect(disposeRecord.disposed).toBe(true);
  });
});
