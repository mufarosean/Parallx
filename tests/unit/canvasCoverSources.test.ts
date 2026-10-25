// canvasCoverSources.test.ts — pictures other tools offer as page covers.
//
// A tool adds a tab to the cover picker while it runs
// (api.canvas.registerCoverSource) and the tab leaves when the tool stops;
// the canvas names no tool. Then Atelier's source against a fake library.
import { describe, it, expect } from 'vitest';
import { CanvasBlocksBridge, getCoverSources, type CanvasCoverSource } from '../../src/api/bridges/canvasBlocksBridge';
// @ts-expect-error — an extension module, plain JavaScript
import { moCoverSource, moCoverMediaUrl } from '../../ext/media-organizer/cover-source.js';

const source = (id: string): CanvasCoverSource => ({ id, label: 'Pictures', search: async () => [], coverUrl: async () => undefined });

describe('registerCoverSource', () => {
  it('adds a source while the tool runs and drops it when the tool stops', () => {
    const subs: { dispose(): void }[] = [];
    const bridge = new CanvasBlocksBridge('acme.photos', 'Acme Photos', subs);
    bridge.registerCoverSource(source('acme.photos.library'));
    expect(getCoverSources().map((c) => [c.ownerToolId, c.source.label])).toContainEqual(['acme.photos', 'Pictures']);
    bridge.dispose();
    expect(getCoverSources().some((c) => c.ownerToolId === 'acme.photos')).toBe(false);
  });

  it('refuses an id outside the tool and a source missing its functions', () => {
    const bridge = new CanvasBlocksBridge('acme.photos', 'Acme Photos', []);
    expect(() => bridge.registerCoverSource(source('other.tool.x'))).toThrow(/must start with "acme.photos."/);
    expect(() => bridge.registerCoverSource({ id: 'acme.photos.x', label: 'X' } as unknown as CanvasCoverSource)).toThrow(/search and coverUrl/);
    bridge.dispose();
  });
});

describe("Atelier's cover source", () => {
  const library: Record<number, string> = { 7: '/photos/sunset.JPG', 8: '/photos/raw/portrait.CR3' };
  const src = moCoverSource({
    db: { all: async (_sql: string, params: unknown[]) => [{ id: 8, title: 'Portrait' }, { id: 7, title: '' }].filter(() => params.length === 3) },
    thumbnailPath: async (id: number) => (id === 7 ? '/thumbs/7_320.jpg' : null),
    resolvePath: async (id: number) => library[id] ?? null,
    displayCopy: async (p: string) => (p.endsWith('.CR3') ? '/cache/portrait.jpg' : null),
  });

  it('lists photos by id and title', async () => {
    expect(await src.search('')).toEqual([{ id: '8', title: 'Portrait' }, { id: '7', title: 'Photo' }]);
  });
  it('links the photo where it lives, or the display copy of a format Chromium cannot draw', async () => {
    expect(await src.coverUrl('7')).toBe(moCoverMediaUrl('/photos/sunset.JPG'));
    expect(await src.coverUrl('8')).toBe(moCoverMediaUrl('/cache/portrait.jpg'));
    expect(await src.coverUrl('9')).toBeUndefined();
    expect(await src.thumbnail('7')).toBe('parallx-media://file/%2Fthumbs%2F7_320.jpg');
  });
});
