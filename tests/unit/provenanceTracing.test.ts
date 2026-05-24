/**
 * M81 Slice C — Provenance Tracing characterization.
 *
 * Closes the §22 debt for `provenanceTracing.test.ts` promised in
 * `docs/Parallx_Milestone_81.md`. Per the 2026-05-23 audit ruling
 * (`docs/research/M81_SLICE_C_AUDIT.md`): "Artifact provenance (Canvas
 * pages) — SHIPPED. Migration 013_page_provenance.sql adds two nullable
 * columns `created_by` and `source_tool`; `canvasTypes.ts` extends
 * `IPage` with `readonly createdBy: string | null` and
 * `readonly sourceTool: string | null`; `canvasDataService.rowToPage()`
 * maps them; `CanvasDataService.createPage()` accepts a new optional
 * `PageProvenance` parameter; the AI chat tool `canvas_create_page`
 * records `created_by='ai-chat', source_tool='canvas_create_page'`."
 *
 * The 3 rowToPage cases (null / populated / explicit-null) live in
 * `tests/unit/canvasDataService.test.ts`. This file pins the OTHER half
 * of the contract: the migration is real SQL that materializes the two
 * columns, AND the `canvas_create_page` AI tool wires the constants the
 * audit promised.
 */

import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const REPO = process.cwd();
const MIGRATION = path.resolve(REPO, 'src/built-in/canvas/migrations/013_page_provenance.sql');

describe('M81 Slice C — provenance tracing (shipped; cross-surface guard)', () => {
  it('migration 013_page_provenance.sql exists and adds created_by + source_tool to pages', async () => {
    const sql = await fs.readFile(MIGRATION, 'utf8');
    expect(sql).toMatch(/ALTER\s+TABLE\s+pages\s+ADD\s+COLUMN\s+created_by\b/i);
    expect(sql).toMatch(/ALTER\s+TABLE\s+pages\s+ADD\s+COLUMN\s+source_tool\b/i);
    // Both columns must be additive only — no NOT NULL constraint, no
    // default, no DROP. Existing pages must keep NULL provenance.
    expect(sql).not.toMatch(/NOT\s+NULL/i);
    expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
  });

  it('migration is applied successfully against a freshly-seeded pages table (node:sqlite in-memory)', async () => {
    // Use Node 22's built-in node:sqlite to avoid the better-sqlite3 native
    // binding under vitest (matches the pattern in mediaOrganizerFtsRebuild).
    const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
    const db = new DatabaseSync(':memory:');
    try {
      db.exec(`
        CREATE TABLE pages (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
      `);
      const sql = await fs.readFile(MIGRATION, 'utf8');
      db.exec(sql);

      // Insert a row WITHOUT provenance — must succeed (columns nullable).
      db.prepare(`INSERT INTO pages (id, title) VALUES (?, ?)`).run('p-1', 'Untouched');
      const row1 = db.prepare(`SELECT created_by, source_tool FROM pages WHERE id = ?`).get('p-1') as
        | { created_by: string | null; source_tool: string | null }
        | undefined;
      expect(row1).toBeDefined();
      expect(row1!.created_by).toBeNull();
      expect(row1!.source_tool).toBeNull();

      // Insert a row WITH provenance — must round-trip exactly.
      db.prepare(
        `INSERT INTO pages (id, title, created_by, source_tool) VALUES (?, ?, ?, ?)`,
      ).run('p-2', 'AI page', 'ai-chat', 'canvas_create_page');
      const row2 = db.prepare(`SELECT created_by, source_tool FROM pages WHERE id = ?`).get('p-2') as
        | { created_by: string | null; source_tool: string | null }
        | undefined;
      expect(row2!.created_by).toBe('ai-chat');
      expect(row2!.source_tool).toBe('canvas_create_page');
    } finally {
      db.close();
    }
  });

  it('canvas_create_page tool stamps provenance as ai-chat / canvas_create_page', async () => {
    // Grep the tool file for the audit-named constants. The exact insert
    // path is exercised by integration tests elsewhere; this guard just
    // pins that the constants didn't get edited away to '' or 'user'.
    const candidates = [
      path.resolve(REPO, 'src/built-in/chat/tools/pageTools.ts'),
    ];
    let found: string | null = null;
    for (const c of candidates) {
      if (await fs.stat(c).catch(() => null)) { found = c; break; }
    }
    expect(found, `pageTools.ts not found in expected locations: ${candidates.join(', ')}`).not.toBeNull();

    const src = await fs.readFile(found!, 'utf8');
    expect(src).toMatch(/['"]ai-chat['"]/);
    expect(src).toMatch(/['"]canvas_create_page['"]/);
  });

  it('IPage type carries createdBy and sourceTool as readonly nullable string fields', async () => {
    const typesPath = path.resolve(REPO, 'src/built-in/canvas/canvasTypes.ts');
    const src = await fs.readFile(typesPath, 'utf8');
    // Allow either single-line or wrapped declarations.
    expect(src).toMatch(/readonly\s+createdBy\s*:\s*string\s*\|\s*null/);
    expect(src).toMatch(/readonly\s+sourceTool\s*:\s*string\s*\|\s*null/);
  });
});
