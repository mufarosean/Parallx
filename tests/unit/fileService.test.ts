/**
 * Unit tests for FileService — LRU cache, TOCTOU guard, error normalization,
 * and boundary checking.
 *
 * Mocks `window.parallxElectron.fs` and `.dialog` to isolate the service from
 * Electron IPC.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { FileService } from '../../src/services/fileService';
import { URI } from '../../src/platform/uri';

// ── Mock Electron bridge ─────────────────────────────────────────────────────

function createMockFsBridge() {
  return {
    readFile: vi.fn().mockResolvedValue({ content: 'hello', encoding: 'utf-8', size: 5, mtime: 1000 }),
    writeFile: vi.fn().mockResolvedValue({ error: null }),
    stat: vi.fn().mockResolvedValue({ type: 'file', size: 5, mtime: 1000, error: null }),
    readdir: vi.fn().mockResolvedValue({ entries: [], error: null }),
    exists: vi.fn().mockResolvedValue(true),
    rename: vi.fn().mockResolvedValue({ error: null }),
    delete: vi.fn().mockResolvedValue({ error: null }),
    mkdir: vi.fn().mockResolvedValue({ error: null }),
    copy: vi.fn().mockResolvedValue({ error: null }),
    watch: vi.fn().mockResolvedValue({ watchId: 'w1', error: null }),
    unwatch: vi.fn().mockResolvedValue({ error: null }),
    onDidChange: vi.fn().mockReturnValue(() => {}),
  };
}

function createMockDialogBridge() {
  return {
    openFile: vi.fn().mockResolvedValue(null),
    openFolder: vi.fn().mockResolvedValue(null),
    saveFile: vi.fn().mockResolvedValue(null),
    showMessageBox: vi.fn().mockResolvedValue({ response: 0, checkboxChecked: false }),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('FileService', () => {
  let mockFs: ReturnType<typeof createMockFsBridge>;
  let mockDialog: ReturnType<typeof createMockDialogBridge>;
  let fileService: FileService;

  beforeEach(() => {
    mockFs = createMockFsBridge();
    mockDialog = createMockDialogBridge();
    (globalThis as any).window = {
      parallxElectron: {
        fs: mockFs,
        dialog: mockDialog,
      },
    };
    fileService = new FileService();
  });

  afterEach(() => {
    fileService.dispose();
    delete (globalThis as any).window;
  });

  // ── LRU Cache ──

  describe('LRU cache', () => {
    it('returns cached content on second read', async () => {
      const uri = URI.file('/test/a.txt');
      await fileService.readFile(uri);
      await fileService.readFile(uri);
      // Only one IPC call — second read served from cache
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });

    it('cache miss for different URIs', async () => {
      await fileService.readFile(URI.file('/test/a.txt'));
      await fileService.readFile(URI.file('/test/b.txt'));
      expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    });

    it('does not cache base64 content', async () => {
      mockFs.readFile.mockResolvedValue({ content: 'abc', encoding: 'base64', size: 3, mtime: 1000 });
      const uri = URI.file('/test/image.png');
      await fileService.readFile(uri);
      await fileService.readFile(uri);
      // Both reads hit IPC because base64 is not cached
      expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    });

    it('invalidates cache on writeFile', async () => {
      const uri = URI.file('/test/a.txt');
      await fileService.readFile(uri);
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);

      await fileService.writeFile(uri, 'new content');
      await fileService.readFile(uri);
      // After write, cache is invalidated — new IPC read
      expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    });
  });

  // ── TOCTOU Guard ──

  describe('TOCTOU guard', () => {
    it('does not cache stale read when concurrent write occurs', async () => {
      const uri = URI.file('/test/race.txt');
      let resolveRead: (value: any) => void;
      const readPromise = new Promise(r => { resolveRead = r; });

      // Make readFile hang until we resolve it
      mockFs.readFile.mockImplementationOnce(() => readPromise);

      // Start the read (it will hang)
      const readP = fileService.readFile(uri);

      // While the read is pending, write to the same file
      await fileService.writeFile(uri, 'overwrite');

      // Now resolve the original read
      resolveRead!({ content: 'stale', encoding: 'utf-8', size: 5, mtime: 1000 });
      await readP;

      // Another read should hit IPC because the stale result was NOT cached
      mockFs.readFile.mockResolvedValue({ content: 'fresh', encoding: 'utf-8', size: 5, mtime: 2000 });
      const result = await fileService.readFile(uri);
      expect(result.content).toBe('fresh');
      // readFile called: 1 (original, hung) + 1 (fresh after write)
      expect(mockFs.readFile).toHaveBeenCalledTimes(2);
    });
  });

  // ── Error normalization ──

  describe('error handling', () => {
    it('throws FileOperationError on IPC error for readFile', async () => {
      mockFs.readFile.mockResolvedValue({
        error: { code: 'FILE_NOT_FOUND', message: 'Not found' },
      });

      await expect(fileService.readFile(URI.file('/test/missing.txt'))).rejects.toThrow('Not found');
    });

    it('throws FileOperationError on IPC error for writeFile', async () => {
      mockFs.writeFile.mockResolvedValue({
        error: { code: 'FILE_PERMISSION', message: 'Permission denied' },
      });

      await expect(fileService.writeFile(URI.file('/test/readonly.txt'), 'x')).rejects.toThrow('Permission denied');
    });
  });

  // ── Boundary checker ──

  describe('boundary checker', () => {
    it('throws when operating outside boundary', async () => {
      fileService.setBoundaryChecker((_uri, _op) => {
        throw new Error('Outside workspace boundary');
      });

      await expect(fileService.readFile(URI.file('/outside/file.txt'))).rejects.toThrow('Outside workspace boundary');
    });

    it('allows operations inside boundary', async () => {
      fileService.setBoundaryChecker(() => {}); // no-op = allowed
      const result = await fileService.readFile(URI.file('/inside/file.txt'));
      expect(result.content).toBe('hello');
    });
  });

  // ── Event ──

  describe('onDidFileChange', () => {
    it('fires when change is received from bridge', () => {
      // Capture the callback registered with the bridge
      const changeCallback = mockFs.onDidChange.mock.calls[0]?.[0];
      expect(changeCallback).toBeDefined();

      let events: any[] = [];
      fileService.onDidFileChange(e => { events = e; });

      // Simulate a file change event from Electron
      // _handleChangePayload expects { events: [{ path, type }] } with type 'changed'
      changeCallback({ events: [{ path: '/test/a.txt', type: 'changed' }] });
      expect(events.length).toBe(1);
    });
  });
});
