import { describe, expect, it } from 'vitest';
import {
  CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
  decodeCanvasContent,
  normalizeCanvasContentForStorage,
} from '../../src/built-in/canvas/contentSchema';

describe('contentSchema', () => {
  it('upgrades legacy raw doc JSON into envelope format', () => {
    const legacy = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
    const decoded = decodeCanvasContent(legacy);

    expect(decoded.needsRepair).toBe(true);
    expect(decoded.schemaVersion).toBe(CURRENT_CANVAS_CONTENT_SCHEMA_VERSION);
    expect(decoded.reason).toBe('legacy-doc');

    const normalized = JSON.parse(decoded.repairedStoredContent);
    expect(normalized.schemaVersion).toBe(CURRENT_CANVAS_CONTENT_SCHEMA_VERSION);
    expect(normalized.doc.type).toBe('doc');
  });

  it('preserves valid envelope content without repair', () => {
    const content = JSON.stringify({
      schemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
      doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    });

    const decoded = decodeCanvasContent(content);
    expect(decoded.needsRepair).toBe(false);
    expect(decoded.reason).toBeUndefined();
    expect(decoded.schemaVersion).toBe(CURRENT_CANVAS_CONTENT_SCHEMA_VERSION);
  });

  it('leaves invalid JSON unreadable and unrepaired (C6: never written over)', () => {
    const decoded = decodeCanvasContent('{ invalid json');
    expect(decoded.needsRepair).toBe(false);
    expect(decoded.unreadable).toBe(true);
    expect(decoded.reason).toBe('invalid-json');
    expect(decoded.repairedStoredContent).toBe('{ invalid json');
    // The editor still gets a doc to show.
    expect(decoded.doc.type).toBe('doc');
    expect(() => normalizeCanvasContentForStorage('{ invalid json')).toThrow(/cannot be read/);
  });

  it('treats no content at all as an empty page', () => {
    const decoded = decodeCanvasContent('');
    expect(decoded.unreadable).toBeFalsy();
    expect(JSON.parse(decoded.repairedStoredContent).doc.type).toBe('doc');
  });

  it('normalizes storage payloads to envelope + schema version', () => {
    const legacy = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
    const normalized = normalizeCanvasContentForStorage(legacy);

    expect(normalized.schemaVersion).toBe(CURRENT_CANVAS_CONTENT_SCHEMA_VERSION);
    const parsed = JSON.parse(normalized.storedContent);
    expect(parsed.schemaVersion).toBe(CURRENT_CANVAS_CONTENT_SCHEMA_VERSION);
    expect(parsed.doc.type).toBe('doc');
  });
});
