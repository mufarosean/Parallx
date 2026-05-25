// tests/unit/platform/migrationRunner.test.ts — M86-W4
//
// Tier-0: pure-Node. Uses a fake better-sqlite3-shaped db that records exec
// calls. We can't load better-sqlite3 here because it's compiled for
// Electron's Node ABI; the runtime test against the real engine happens
// implicitly via the existing tier-1 e2e suite.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const requireCjs = createRequire(import.meta.url);
const {
  parseHeader,
  splitChunks,
  applyMigration,
} = requireCjs('../../../electron/migrationRunner.cjs') as {
  parseHeader: (sql: string) => {
    id: string | null;
    chunked: boolean;
    batchSize: number;
    blocksWriters: boolean;
  };
  splitChunks: (sql: string) => string[];
  applyMigration: (args: {
    db: FakeDb;
    name: string;
    sql: string;
    recordApplied?: (name: string) => void;
    logger?: { log: (...a: unknown[]) => void };
  }) => Promise<{ header: ReturnType<typeof parseHeader>; chunkCount: number }>;
};

// Minimal fake db with the better-sqlite3 surface the runner uses.
class FakeDb {
  execs: string[] = [];
  committed: number[] = [];
  failOn?: (sql: string) => boolean;

  exec(sql: string) {
    if (this.failOn && this.failOn(sql)) {
      throw new Error('forced-exec-fail');
    }
    this.execs.push(sql);
  }

  transaction(fn: () => void) {
    return () => {
      fn();
      this.committed.push(this.execs.length);
    };
  }
}

const NOOP_LOGGER = { log: () => {} };

describe('migrationRunner.parseHeader', () => {
  it('returns defaults when no header is present', () => {
    expect(parseHeader('CREATE TABLE x (id INTEGER);')).toEqual({
      id: null,
      chunked: false,
      batchSize: 500,
      blocksWriters: true,
    });
  });

  it('parses a chunked header', () => {
    const h = parseHeader('-- @parallx:migration { "id": "021", "chunked": true, "batchSize": 100 }\nCREATE TABLE x (id INTEGER);');
    expect(h.id).toBe('021');
    expect(h.chunked).toBe(true);
    expect(h.batchSize).toBe(100);
  });

  it('falls back to defaults on malformed JSON', () => {
    expect(parseHeader('-- @parallx:migration { not json }\nCREATE TABLE x (id INTEGER);').chunked).toBe(false);
  });

  it('tolerates a UTF-8 BOM', () => {
    expect(parseHeader('\ufeff-- @parallx:migration { "chunked": true }\n').chunked).toBe(true);
  });

  it('respects blocksWriters: false', () => {
    expect(parseHeader('-- @parallx:migration { "chunked": true, "blocksWriters": false }\n').blocksWriters).toBe(false);
  });
});

describe('migrationRunner.splitChunks', () => {
  it('splits on @parallx:chunk markers and drops empty chunks', () => {
    const sql = [
      'INSERT INTO x VALUES (1);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (2);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (3);',
    ].join('\n');
    const chunks = splitChunks(sql);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toContain('VALUES (1)');
    expect(chunks[2]).toContain('VALUES (3)');
  });

  it('returns a single chunk when no markers are present', () => {
    expect(splitChunks('SELECT 1;')).toHaveLength(1);
  });

  it('handles a marker at the very top', () => {
    expect(splitChunks('-- @parallx:chunk\nSELECT 1;')).toEqual(['SELECT 1;']);
  });
});

describe('migrationRunner.applyMigration — header-less (historic path)', () => {
  it('runs the migration in a single transaction', async () => {
    const db = new FakeDb();
    const applied: string[] = [];
    const sql = 'CREATE TABLE x (id INTEGER);';

    const res = await applyMigration({
      db,
      name: '001_seed.sql',
      sql,
      recordApplied: (n) => applied.push(n),
    });

    expect(res.chunkCount).toBe(1);
    expect(res.header.chunked).toBe(false);
    expect(db.execs).toEqual([sql]);
    expect(db.committed).toEqual([1]);
    expect(applied).toEqual(['001_seed.sql']);
  });
});

describe('migrationRunner.applyMigration — chunked path', () => {
  it('runs one transaction per chunk and records applied only at the end', async () => {
    const db = new FakeDb();
    const applied: string[] = [];
    const sql = [
      '-- @parallx:migration { "id": "021", "chunked": true }',
      'INSERT INTO x VALUES (1);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (2);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (3);',
    ].join('\n');

    const res = await applyMigration({
      db,
      name: '021_chunked.sql',
      sql,
      recordApplied: (n) => applied.push(n),
      logger: NOOP_LOGGER,
    });

    expect(res.chunkCount).toBe(3);
    expect(db.execs).toHaveLength(3);
    expect(db.committed).toEqual([1, 2, 3]);
    expect(applied).toEqual(['021_chunked.sql']);
  });

  it('does not mark applied if a non-final chunk throws', async () => {
    const db = new FakeDb();
    db.failOn = (sql) => sql.includes('VALUES (2)');
    const applied: string[] = [];
    const sql = [
      '-- @parallx:migration { "chunked": true }',
      'INSERT INTO x VALUES (1);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (2);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (3);',
    ].join('\n');

    await expect(
      applyMigration({
        db,
        name: '022_partial.sql',
        sql,
        recordApplied: (n) => applied.push(n),
        logger: NOOP_LOGGER,
      }),
    ).rejects.toThrow('forced-exec-fail');

    expect(db.committed).toEqual([1]);
    expect(applied).toEqual([]);
  });

  it('yields between chunks via setImmediate so concurrent work can interleave', async () => {
    const db = new FakeDb();
    const sql = [
      '-- @parallx:migration { "chunked": true }',
      'INSERT INTO x VALUES (1);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (2);',
      '-- @parallx:chunk',
      'INSERT INTO x VALUES (3);',
    ].join('\n');

    let interleaved = 0;
    let stop = false;
    const tick = () => {
      if (stop) return;
      interleaved++;
      setImmediate(tick);
    };
    setImmediate(tick);

    await applyMigration({ db, name: 't.sql', sql, logger: NOOP_LOGGER });
    stop = true;

    expect(interleaved).toBeGreaterThanOrEqual(1);
    expect(db.committed).toEqual([1, 2, 3]);
  });

  it('still marks applied even when chunks contain only comments (no-op SQL)', async () => {
    const db = new FakeDb();
    const applied: string[] = [];

    const res = await applyMigration({
      db,
      name: '023_comments.sql',
      sql: '-- @parallx:migration { "chunked": true }\n-- just a comment\n',
      recordApplied: (n) => applied.push(n),
      logger: NOOP_LOGGER,
    });

    // The header-comment line survives splitChunks; the runner exec()s it
    // (SQLite ignores `--` comments) and records the migration as applied.
    expect(res.chunkCount).toBeGreaterThanOrEqual(1);
    expect(applied).toEqual(['023_comments.sql']);
  });
});
