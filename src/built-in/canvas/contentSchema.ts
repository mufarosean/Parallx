// contentSchema.ts — versioned storage envelope for canvas page content

export const CURRENT_CANVAS_CONTENT_SCHEMA_VERSION = 2;

interface CanvasContentEnvelope {
  schemaVersion: number;
  doc: any;
}

export interface DecodeCanvasContentResult {
  doc: any;
  schemaVersion: number;
  needsRepair: boolean;
  repairedStoredContent: string;
  reason?: 'legacy-doc' | 'invalid-json' | 'invalid-envelope' | 'invalid-doc';
  /**
   * The stored text is not a page doc this build can read (truncated or
   * corrupt JSON, an unknown envelope).  `doc` is then an empty stand-in that
   * must NEVER be written back: nothing is repaired, and the service refuses
   * content writes over it, so the original text survives for recovery.
   */
  unreadable?: boolean;
}

function emptyDoc(): any {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

function isDocShape(value: any): boolean {
  return !!value && typeof value === 'object' && value.type === 'doc' && Array.isArray(value.content);
}

function encodeEnvelope(doc: any, schemaVersion = CURRENT_CANVAS_CONTENT_SCHEMA_VERSION): string {
  return JSON.stringify({ schemaVersion, doc } satisfies CanvasContentEnvelope);
}

export function decodeCanvasContent(stored: string): DecodeCanvasContentResult {
  // No content at all is an empty page, not an unreadable one.
  if (stored == null || String(stored).trim() === '') {
    const doc = emptyDoc();
    return {
      doc,
      schemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
      needsRepair: true,
      repairedStoredContent: encodeEnvelope(doc),
      reason: 'invalid-json',
    };
  }
  try {
    const parsed = JSON.parse(stored);

    if (isDocShape(parsed)) {
      return {
        doc: parsed,
        schemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
        needsRepair: true,
        repairedStoredContent: encodeEnvelope(parsed),
        reason: 'legacy-doc',
      };
    }

    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.schemaVersion === 'number' &&
      isDocShape(parsed.doc)
    ) {
      const normalizedVersion = Number.isFinite(parsed.schemaVersion)
        ? Math.max(1, Math.trunc(parsed.schemaVersion))
        : CURRENT_CANVAS_CONTENT_SCHEMA_VERSION;

      const normalized = encodeEnvelope(parsed.doc, normalizedVersion);
      return {
        doc: parsed.doc,
        schemaVersion: normalizedVersion,
        needsRepair: normalized !== stored,
        repairedStoredContent: normalized,
      };
    }

    return unreadableResult(stored, 'invalid-envelope');
  } catch {
    return unreadableResult(stored, 'invalid-json');
  }
}

/**
 * Content that can't be read is left exactly as stored.  "Repairing" it to
 * an empty doc (the old behaviour) erased the page on open with no copy kept.
 */
function unreadableResult(stored: string, reason: 'invalid-json' | 'invalid-envelope'): DecodeCanvasContentResult {
  return {
    doc: emptyDoc(),
    schemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
    needsRepair: false,
    repairedStoredContent: stored,
    reason,
    unreadable: true,
  };
}

/** Whether stored page content is unreadable (see `unreadable` above). */
export function isUnreadableCanvasContent(stored: string | null | undefined): boolean {
  if (typeof stored !== 'string' || stored === '') return false;
  return decodeCanvasContent(stored).unreadable === true;
}

export function encodeCanvasContentFromDoc(doc: any): { storedContent: string; schemaVersion: number } {
  const safeDoc = isDocShape(doc) ? doc : emptyDoc();
  return {
    storedContent: encodeEnvelope(safeDoc),
    schemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
  };
}

export function normalizeCanvasContentForStorage(content: string): { storedContent: string; schemaVersion: number } {
  const decoded = decodeCanvasContent(content);
  // Never turn unreadable INPUT into an empty page on the way in.
  if (decoded.unreadable) {
    throw new Error('[contentSchema] Refusing to store canvas content that cannot be read');
  }
  return {
    storedContent: decoded.repairedStoredContent,
    schemaVersion: decoded.schemaVersion,
  };
}
