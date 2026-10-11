import { describe, it, expect } from 'vitest';
import { resolveVideoSource } from '../../src/built-in/dashboard/widgets/videoWidget';

/** The src of a resolved source; a `kind: 'none'` result has none. */
function srcOf(source: ReturnType<typeof resolveVideoSource>): string | undefined {
  return 'src' in source ? source.src : undefined;
}

describe('resolveVideoSource', () => {
  it('direct video files → native <video>', () => {
    expect(resolveVideoSource('https://cdn.example.com/clip.mp4')).toEqual({ kind: 'video', src: 'https://cdn.example.com/clip.mp4' });
    expect(resolveVideoSource('https://x.test/a/b.webm?token=1').kind).toBe('video');
    expect(resolveVideoSource('https://x.test/movie.mov').kind).toBe('video');
  });

  it('YouTube variants → embed', () => {
    expect(resolveVideoSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ'))
      .toEqual({ kind: 'embed', src: 'https://www.youtube.com/embed/dQw4w9WgXcQ' });
    expect(srcOf(resolveVideoSource('https://youtu.be/dQw4w9WgXcQ'))).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
    expect(srcOf(resolveVideoSource('https://youtube.com/shorts/abc123XYZ_'))).toContain('/embed/abc123XYZ_');
  });

  it('Vimeo / Dailymotion / Streamable / Loom → their embeds', () => {
    expect(resolveVideoSource('https://vimeo.com/123456789'))
      .toEqual({ kind: 'embed', src: 'https://player.vimeo.com/video/123456789' });
    expect(srcOf(resolveVideoSource('https://www.dailymotion.com/video/x8abcde'))).toBe('https://www.dailymotion.com/embed/video/x8abcde');
    expect(srcOf(resolveVideoSource('https://streamable.com/abcd1'))).toBe('https://streamable.com/e/abcd1');
    expect(srcOf(resolveVideoSource('https://www.loom.com/share/deadbeef1234'))).toBe('https://www.loom.com/embed/deadbeef1234');
  });

  it('arbitrary page → <webview> page fallback', () => {
    expect(resolveVideoSource('https://example.com/some/video-article'))
      .toEqual({ kind: 'page', src: 'https://example.com/some/video-article' });
  });

  it('empty / non-http → none', () => {
    expect(resolveVideoSource('').kind).toBe('none');
    expect(resolveVideoSource('not a url').kind).toBe('none');
    expect(resolveVideoSource('ftp://x.test/y.mp4').kind).toBe('none');
    expect(resolveVideoSource('javascript:alert(1)').kind).toBe('none');
  });
});
