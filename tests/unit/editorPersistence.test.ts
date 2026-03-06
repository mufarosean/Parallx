// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  registerEditorInputDeserializer,
  deserializeEditorInput,
  hasEditorInputDeserializer,
  registerBuiltinEditorDeserializers,
} from '../../src/editor/editorInputDeserializer';
import {
  createDefaultEditorSnapshot,
  type SerializedEditorSnapshot,
  type SerializedEditorInputSnapshot,
} from '../../src/workspace/workspaceTypes';

// ─── Deserializer Registry Tests ─────────────────────────────────────────────

describe('EditorInputDeserializer', () => {
  describe('registerEditorInputDeserializer', () => {
    it('registers a deserializer and can be found via has()', () => {
      registerEditorInputDeserializer('test.type.1', () => null);
      expect(hasEditorInputDeserializer('test.type.1')).toBe(true);
    });

    it('returns false for unregistered type', () => {
      expect(hasEditorInputDeserializer('nonexistent.type')).toBe(false);
    });
  });

  describe('deserializeEditorInput', () => {
    it('returns null for unregistered type', () => {
      const result = deserializeEditorInput('totally.unknown.type');
      expect(result).toBeNull();
    });

    it('calls the registered factory with data', () => {
      const factory = vi.fn().mockReturnValue({ id: 'mock-id', typeId: 'test.type.2' });
      registerEditorInputDeserializer('test.type.2', factory);

      const data = { uri: 'file:///test.txt' };
      const result = deserializeEditorInput('test.type.2', data);

      expect(factory).toHaveBeenCalledWith(data);
      expect(result).toEqual({ id: 'mock-id', typeId: 'test.type.2' });
    });

    it('returns null when factory throws', () => {
      registerEditorInputDeserializer('test.type.3', () => {
        throw new Error('boom');
      });

      const result = deserializeEditorInput('test.type.3', {});
      expect(result).toBeNull();
    });

    it('returns null when factory returns null', () => {
      registerEditorInputDeserializer('test.type.4', () => null);
      const result = deserializeEditorInput('test.type.4', { uri: 'file:///x' });
      expect(result).toBeNull();
    });
  });
});

// ─── Snapshot Schema Tests ───────────────────────────────────────────────────

describe('SerializedEditorSnapshot', () => {
  it('createDefaultEditorSnapshot returns valid empty state', () => {
    const snap = createDefaultEditorSnapshot();
    expect(snap.groups).toHaveLength(1);
    expect(snap.groups[0].editors).toEqual([]);
    expect(snap.groups[0].activeEditorIndex).toBe(-1);
    expect(snap.activeGroupIndex).toBe(0);
  });

  it('snapshot round-trip: serialize → deserialize structure', () => {
    const snapshot: SerializedEditorSnapshot = {
      groups: [
        {
          editors: [
            { typeId: 'parallx.editor.file', inputId: 'id-1', pinned: true, data: { uri: 'file:///doc.md' } },
            { typeId: 'parallx.editor.pdf', inputId: 'id-2', pinned: false, data: { uri: 'file:///doc.pdf' } },
          ],
          activeEditorIndex: 0,
        },
        {
          editors: [
            { typeId: 'parallx.editor.settings', inputId: 'settings-editor', pinned: false },
          ],
          activeEditorIndex: 0,
        },
      ],
      activeGroupIndex: 0,
    };

    // Verify structure is valid JSON round-trip
    const json = JSON.stringify(snapshot);
    const parsed = JSON.parse(json) as SerializedEditorSnapshot;

    expect(parsed.groups).toHaveLength(2);
    expect(parsed.groups[0].editors).toHaveLength(2);
    expect(parsed.groups[0].editors[0].typeId).toBe('parallx.editor.file');
    expect(parsed.groups[0].editors[0].data?.uri).toBe('file:///doc.md');
    expect(parsed.groups[1].editors[0].typeId).toBe('parallx.editor.settings');
    expect(parsed.groups[1].editors[0].data).toBeUndefined();
    expect(parsed.activeGroupIndex).toBe(0);
  });

  it('snapshot with view state round-trips', () => {
    const editorSnap: SerializedEditorInputSnapshot = {
      typeId: 'parallx.editor.file',
      inputId: 'id-3',
      pinned: true,
      data: { uri: 'file:///code.ts' },
      state: { scrollTop: 120, cursorLine: 15, cursorColumn: 8 },
    };

    const json = JSON.stringify(editorSnap);
    const parsed = JSON.parse(json) as SerializedEditorInputSnapshot;

    expect(parsed.state).toEqual({ scrollTop: 120, cursorLine: 15, cursorColumn: 8 });
  });

  it('handles missing file gracefully (no data.uri)', () => {
    // Register a mock deserializer that requires uri
    registerEditorInputDeserializer('test.requires.uri', (data) => {
      const uri = data?.uri;
      if (typeof uri !== 'string') return null;
      return { id: uri, typeId: 'test.requires.uri' } as any;
    });

    // No data at all
    expect(deserializeEditorInput('test.requires.uri')).toBeNull();
    // Empty data
    expect(deserializeEditorInput('test.requires.uri', {})).toBeNull();
    // Wrong type
    expect(deserializeEditorInput('test.requires.uri', { uri: 42 })).toBeNull();
    // Valid
    expect(deserializeEditorInput('test.requires.uri', { uri: 'file:///ok.txt' })).not.toBeNull();
  });
});

// ─── Built-in Deserializer Registration Tests ────────────────────────────────

describe('registerBuiltinEditorDeserializers', () => {
  it('registers all built-in types', () => {
    // Create minimal mock services
    const mockTextFileModelManager = {} as any;
    const mockFileService = {} as any;

    registerBuiltinEditorDeserializers({
      textFileModelManager: mockTextFileModelManager,
      fileService: mockFileService,
    });

    // Verify all expected types are registered
    expect(hasEditorInputDeserializer('parallx.editor.file')).toBe(true);
    expect(hasEditorInputDeserializer('parallx.editor.pdf')).toBe(true);
    expect(hasEditorInputDeserializer('parallx.editor.image')).toBe(true);
    expect(hasEditorInputDeserializer('parallx.editor.markdownPreview')).toBe(true);
    expect(hasEditorInputDeserializer('parallx.editor.settings')).toBe(true);
    expect(hasEditorInputDeserializer('parallx.editor.keybindings')).toBe(true);
  });
});
