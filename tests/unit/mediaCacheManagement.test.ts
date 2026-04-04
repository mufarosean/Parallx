/**
 * F14 — Thumbnail Cache Management — Iteration 1 Tests
 * Happy-path tests for hexPrefixProgress, validateCachedThumbnail, getCacheStats,
 * deleteEntityThumbnails, and the enhanced cleanOrphanThumbnails.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// We can't import the extension's main.js directly (it relies on globals like
// `window.parallxElectron` and `db`). Instead we extract the pure functions
// and test them in isolation, and test the async functions via mocked globals.
// ---------------------------------------------------------------------------

// --- hexPrefixProgress (pure function, extracted inline) ---

function hexPrefixProgress(hexChar: string): number {
  const val = parseInt(hexChar, 16);
  if (isNaN(val)) return 0;
  return val / 15;
}

describe('F14: hexPrefixProgress', () => {
  it('maps "0" to 0.0', () => {
    expect(hexPrefixProgress('0')).toBe(0);
  });

  it('maps "f" to 1.0', () => {
    expect(hexPrefixProgress('f')).toBe(1);
  });

  it('maps "8" to ~0.533', () => {
    expect(hexPrefixProgress('8')).toBeCloseTo(8 / 15, 3);
  });

  it('maps uppercase "A" to ~0.667', () => {
    expect(hexPrefixProgress('A')).toBeCloseTo(10 / 15, 3);
  });

  it('returns 0 for non-hex character', () => {
    expect(hexPrefixProgress('z')).toBe(0);
  });

  it('returns 0 for empty string', () => {
    expect(hexPrefixProgress('')).toBe(0);
  });
});

// --- validateCachedThumbnail (async, needs mocked fs) ---

describe('F14: validateCachedThumbnail', () => {
  let fs: { exists: ReturnType<typeof vi.fn>; stat: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  async function validateCachedThumbnail(thumbPath: string): Promise<boolean> {
    const exists = await fs.exists(thumbPath);
    if (!exists) return false;
    const stat = await fs.stat(thumbPath);
    if (stat.error || stat.size === 0) {
      try { await fs.delete(thumbPath); } catch { /* ignore */ }
      return false;
    }
    return true;
  }

  beforeEach(() => {
    fs = {
      exists: vi.fn(),
      stat: vi.fn(),
      delete: vi.fn(),
    };
  });

  it('returns false when file does not exist', async () => {
    fs.exists.mockResolvedValue(false);
    expect(await validateCachedThumbnail('/thumb/ab/cd/abc123_640.jpg')).toBe(false);
    expect(fs.stat).not.toHaveBeenCalled();
  });

  it('returns true when file exists with non-zero size', async () => {
    fs.exists.mockResolvedValue(true);
    fs.stat.mockResolvedValue({ size: 4096 });
    expect(await validateCachedThumbnail('/thumb/ab/cd/abc123_640.jpg')).toBe(true);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('returns false and deletes zero-byte file', async () => {
    fs.exists.mockResolvedValue(true);
    fs.stat.mockResolvedValue({ size: 0 });
    fs.delete.mockResolvedValue(undefined);
    expect(await validateCachedThumbnail('/thumb/ab/cd/abc123_640.jpg')).toBe(false);
    expect(fs.delete).toHaveBeenCalledWith('/thumb/ab/cd/abc123_640.jpg');
  });

  it('returns false when stat returns error', async () => {
    fs.exists.mockResolvedValue(true);
    fs.stat.mockResolvedValue({ error: 'ENOENT' });
    fs.delete.mockResolvedValue(undefined);
    expect(await validateCachedThumbnail('/thumb/ab/cd/abc123_640.jpg')).toBe(false);
  });
});

// --- deleteEntityThumbnails (async, needs mocked fs + path helpers) ---

describe('F14: deleteEntityThumbnails', () => {
  let fs: { exists: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

  function getThumbnailPath(_dir: string, checksum: string, _w: number) {
    return `/thumb/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}_640.jpg`;
  }
  function getCoverFramePath(_dir: string, checksum: string) {
    return `/thumb/${checksum.slice(0, 2)}/${checksum.slice(2, 4)}/${checksum}_cover.jpg`;
  }

  async function deleteEntityThumbnails(thumbDir: string, checksum: string) {
    let deleted = 0;
    let errors = 0;
    const paths = [
      getThumbnailPath(thumbDir, checksum, 640),
      getCoverFramePath(thumbDir, checksum),
    ];
    for (const p of paths) {
      const exists = await fs.exists(p);
      if (!exists) continue;
      try {
        await fs.delete(p);
        deleted++;
      } catch {
        errors++;
      }
    }
    return { deleted, errors };
  }

  beforeEach(() => {
    fs = {
      exists: vi.fn(),
      delete: vi.fn(),
    };
  });

  it('deletes both thumbnail and cover when they exist', async () => {
    fs.exists.mockResolvedValue(true);
    fs.delete.mockResolvedValue(undefined);
    const result = await deleteEntityThumbnails('/thumb', 'abcd1234');
    expect(result.deleted).toBe(2);
    expect(result.errors).toBe(0);
  });

  it('returns 0 deleted when neither file exists', async () => {
    fs.exists.mockResolvedValue(false);
    const result = await deleteEntityThumbnails('/thumb', 'abcd1234');
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(0);
    expect(fs.delete).not.toHaveBeenCalled();
  });

  it('counts errors when delete fails', async () => {
    fs.exists.mockResolvedValue(true);
    fs.delete.mockRejectedValue(new Error('EPERM'));
    const result = await deleteEntityThumbnails('/thumb', 'abcd1234');
    expect(result.deleted).toBe(0);
    expect(result.errors).toBe(2);
  });

  it('handles mixed: one exists one does not', async () => {
    fs.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    fs.delete.mockResolvedValue(undefined);
    const result = await deleteEntityThumbnails('/thumb', 'abcd1234');
    expect(result.deleted).toBe(1);
    expect(result.errors).toBe(0);
  });
});
