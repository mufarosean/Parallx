// imageStore.test.ts — a picture put on a page is written once to the
// workspace's .parallx/media (named by its hash) and the page keeps a short
// link; anything the store does not keep, or cannot write, stays as it was.
import { describe, it, expect } from 'vitest';
import { parseImageDataUrl, storeImageSrc, workspaceMediaSrc, type IImageStoreHost } from '../../src/built-in/canvas/imageStore';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function host(root: string | undefined, opts: { fail?: boolean } = {}) {
  const files = new Map<string, string>();
  const h: IImageStoreHost = {
    workspaceRoot: () => root,
    exists: async (p) => files.has(p),
    writeBase64: async (p, b64) => { if (opts.fail) return false; files.set(p, b64); return true; },
  };
  return { h, files };
}

describe('image store', () => {
  it('reads the picture types it keeps from a data URL', () => {
    expect(parseImageDataUrl(PNG)).toMatchObject({ mime: 'image/png', ext: 'png' });
    expect(parseImageDataUrl('data:image/jpeg;base64,AAAA')?.ext).toBe('jpg');
    expect(parseImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull(); // SVG can carry script
    expect(parseImageDataUrl('https://example.com/a.png')).toBeNull();
  });

  it('writes the picture once, named by its hash, and links it', async () => {
    const { h, files } = host('/w/Exam 7/');
    const src = await storeImageSrc(PNG, h);
    expect(src).toMatch(/^parallx-media:\/\/workspace\/\.parallx\/media\/[0-9a-f]{64}\.png$/);
    expect([...files.keys()]).toEqual([`/w/Exam 7/${src.slice('parallx-media://workspace/'.length)}`]);
    expect(files.values().next().value).toBe(PNG.split(',')[1]);
    expect(await storeImageSrc(PNG, h)).toBe(src); // the same picture again: the same file
    expect(files.size).toBe(1);
  });

  it('keeps the data URL with no workspace, when the write fails, and for what it does not store', async () => {
    expect(await storeImageSrc(PNG, host(undefined).h)).toBe(PNG);
    expect(await storeImageSrc(PNG, host('/w', { fail: true }).h)).toBe(PNG);
    expect(await storeImageSrc(PNG, null)).toBe(PNG);
    expect(await storeImageSrc('https://example.com/a.png', host('/w').h)).toBe('https://example.com/a.png');
  });

  it('encodes each part of the path in the link', () => {
    expect(workspaceMediaSrc('.parallx/media/a b#.png')).toBe('parallx-media://workspace/.parallx/media/a%20b%23.png');
  });
});
