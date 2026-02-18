// contentSchema.ts — versioned storage envelope for canvas page content

export const CURRENT_CANVAS_CONTENT_SCHEMA_VERSION = 2;

export interface CanvasContentEnvelope {
  schemaVersion: number;
  doc: any;
}

export interface DecodeCanvasContentResult {
  doc: any;
  schemaVersion: number;
  needsRepair: boolean;
  repairedStoredContent: string;
  reason?: 'legacy-doc' | 'invalid-json' | 'invalid-envelope' | 'invalid-doc';
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

    const fallbackDoc = emptyDoc();
    return {
      doc: fallbackDoc,
      schemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
      needsRepair: true,
      repairedStoredContent: encodeEnvelope(fallbackDoc),
      reason: 'invalid-envelope',
    };
  } catch {
    const fallbackDoc = emptyDoc();
    return {
      doc: fallbackDoc,
      schemaVersion: CURRENT_CANVAS_CONTENT_SCHEMA_VERSION,
      needsRepair: true,
      repairedStoredContent: encodeEnvelope(fallbackDoc),
      reason: 'invalid-json',
    };
  }
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
  return {
    storedContent: decoded.repairedStoredContent,
    schemaVersion: decoded.schemaVersion,
  };
}
