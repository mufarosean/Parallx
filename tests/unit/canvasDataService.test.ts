/**
 * Unit tests for canvasDataService.ts — rowToPage mapping
 *
 * Tests the pure function that converts raw SQLite rows to typed IPage objects,
 * including boolean coercion, default values, and null handling.
 */
import { describe, it, expect } from 'vitest';
import { rowToPage } from '../../src/built-in/canvas/canvasDataService';

// ─── Helper: full row with all columns populated ─────────────────────────────

function fullRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'page-001',
    parent_id: null,
    title: 'Test Page',
    icon: '📄',
    content: '{"type":"doc","content":[]}',
    sort_order: 0,
    is_archived: 0,
    cover_url: null,
    cover_y_offset: 0.5,
    font_family: 'default',
    full_width: 0,
    small_text: 0,
    is_locked: 0,
    is_favorited: 0,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════

describe('rowToPage', () => {

  // ── Basic mapping ────────────────────────────────────────────────────────

  it('maps all fields from a full row', () => {
    const page = rowToPage(fullRow());

    expect(page.id).toBe('page-001');
    expect(page.parentId).toBeNull();
    expect(page.title).toBe('Test Page');
    expect(page.icon).toBe('📄');
    expect(page.content).toBe('{"type":"doc","content":[]}');
    expect(page.sortOrder).toBe(0);
    expect(page.isArchived).toBe(false);
    expect(page.coverUrl).toBeNull();
    expect(page.coverYOffset).toBe(0.5);
    expect(page.fontFamily).toBe('default');
    expect(page.fullWidth).toBe(false);
    expect(page.smallText).toBe(false);
    expect(page.isLocked).toBe(false);
    expect(page.isFavorited).toBe(false);
    expect(page.createdAt).toBe('2025-01-01T00:00:00.000Z');
    expect(page.updatedAt).toBe('2025-01-01T00:00:00.000Z');
  });

  // ── Boolean coercion (SQLite stores as 0/1) ──────────────────────────────

  describe('boolean coercion', () => {
    it('coerces is_archived = 1 to true', () => {
      expect(rowToPage(fullRow({ is_archived: 1 })).isArchived).toBe(true);
    });

    it('coerces is_archived = 0 to false', () => {
      expect(rowToPage(fullRow({ is_archived: 0 })).isArchived).toBe(false);
    });

    it('coerces full_width = 1 to true', () => {
      expect(rowToPage(fullRow({ full_width: 1 })).fullWidth).toBe(true);
    });

    it('coerces small_text = 1 to true', () => {
      expect(rowToPage(fullRow({ small_text: 1 })).smallText).toBe(true);
    });

    it('coerces is_locked = 1 to true', () => {
      expect(rowToPage(fullRow({ is_locked: 1 })).isLocked).toBe(true);
    });

    it('coerces is_favorited = 1 to true', () => {
      expect(rowToPage(fullRow({ is_favorited: 1 })).isFavorited).toBe(true);
    });
  });

  // ── Null/undefined handling ──────────────────────────────────────────────

  describe('null and default handling', () => {
    it('defaults parentId to null when parent_id is undefined', () => {
      const row = fullRow();
      delete row.parent_id;
      expect(rowToPage(row).parentId).toBeNull();
    });

    it('preserves parentId when set', () => {
      expect(rowToPage(fullRow({ parent_id: 'parent-123' })).parentId).toBe('parent-123');
    });

    it('defaults icon to null when undefined', () => {
      const row = fullRow();
      delete row.icon;
      expect(rowToPage(row).icon).toBeNull();
    });

    it('defaults coverUrl to null when undefined', () => {
      const row = fullRow();
      delete row.cover_url;
      expect(rowToPage(row).coverUrl).toBeNull();
    });

    it('defaults coverYOffset to 0.5 when undefined', () => {
      const row = fullRow();
      delete row.cover_y_offset;
      expect(rowToPage(row).coverYOffset).toBe(0.5);
    });

    it('preserves coverYOffset when set', () => {
      expect(rowToPage(fullRow({ cover_y_offset: 0.3 })).coverYOffset).toBe(0.3);
    });

    it('defaults fontFamily to "default" when undefined', () => {
      const row = fullRow();
      delete row.font_family;
      expect(rowToPage(row).fontFamily).toBe('default');
    });

    it('accepts fontFamily "serif"', () => {
      expect(rowToPage(fullRow({ font_family: 'serif' })).fontFamily).toBe('serif');
    });

    it('accepts fontFamily "mono"', () => {
      expect(rowToPage(fullRow({ font_family: 'mono' })).fontFamily).toBe('mono');
    });
  });

  // ── Cover URL ──────────────────────────────────────────────────────────

  describe('cover fields', () => {
    it('maps cover_url string', () => {
      expect(rowToPage(fullRow({ cover_url: 'https://example.com/cover.jpg' })).coverUrl).toBe('https://example.com/cover.jpg');
    });

    it('maps cover_y_offset', () => {
      expect(rowToPage(fullRow({ cover_y_offset: 0.75 })).coverYOffset).toBe(0.75);
    });
  });
});
