/**
 * Pin-the-invariant: database migration sequence integrity.
 *
 * Per docs/research/SYSTEMS_THINKING_FOR_PARALLX.md §191 and the systems-
 * redesign milestones list, schema migrations are tracked in a `_migrations`
 * table (see electron/database.cjs `migrate(migrationsDir)`). Each *.sql
 * file in a migrations directory is applied exactly once, in lexical order.
 *
 * Lexical order ≡ numeric order only if filenames stay strictly in the
 * `NNN_*.sql` (canvas) or `<extension>_NNN_*.sql` (extension) pattern with
 * zero-padded sequence numbers and no gaps. A single misnamed file silently
 * reorders the entire schema evolution and breaks fresh-install correctness.
 *
 * This test guards every known migration directory against:
 *   - duplicate sequence numbers
 *   - sequence gaps (e.g. 001, 002, 004 — missing 003)
 *   - non-conforming filenames
 *
 * No pre-existing test covers these invariants.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

interface MigrationDir {
  readonly label: string;
  readonly path: string;
  /** Regex with one capture group = zero-padded sequence number. */
  readonly pattern: RegExp;
}

const MIGRATION_DIRS: readonly MigrationDir[] = [
  {
    label: 'canvas',
    path: join(ROOT, 'src', 'built-in', 'canvas', 'migrations'),
    pattern: /^(\d{3})_[a-z0-9_]+\.sql$/i,
  },
  {
    label: 'budget',
    path: join(ROOT, 'ext', 'budget', 'db', 'migrations'),
    pattern: /^budget_(\d{3})_[a-z0-9_]+\.sql$/i,
  },
  {
    label: 'media-organizer',
    path: join(ROOT, 'ext', 'media-organizer', 'db', 'migrations'),
    pattern: /^media-organizer_(\d{3})_[a-z0-9_]+\.sql$/i,
  },
];

function listSqlFiles(dir: string): string[] {
  return readdirSync(dir).filter(f => f.toLowerCase().endsWith('.sql'));
}

describe('Database migration sequence invariants', () => {
  for (const d of MIGRATION_DIRS) {
    describe(d.label, () => {
      it('directory exists and contains at least one *.sql file', () => {
        const stat = statSync(d.path);
        expect(stat.isDirectory()).toBe(true);
        const files = listSqlFiles(d.path);
        expect(files.length).toBeGreaterThan(0);
      });

      it('every *.sql filename conforms to the domain pattern', () => {
        const files = listSqlFiles(d.path);
        const offenders = files.filter(f => !d.pattern.test(f));
        expect(offenders, `non-conforming filenames in ${d.label}`).toEqual([]);
      });

      it('sequence numbers are unique', () => {
        const files = listSqlFiles(d.path);
        const seqs = files
          .map(f => f.match(d.pattern))
          .filter((m): m is RegExpMatchArray => m !== null)
          .map(m => Number(m[1]));
        const dupes = seqs.filter((n, i, arr) => arr.indexOf(n) !== i);
        expect(dupes, `duplicate migration sequence numbers in ${d.label}`).toEqual([]);
      });

      it('lexical order matches numeric order (no zero-pad drift)', () => {
        const files = listSqlFiles(d.path);
        const lexical = [...files].sort();
        const matched = lexical
          .map(f => ({ f, m: f.match(d.pattern) }))
          .filter(x => x.m !== null)
          .map(x => ({ f: x.f, seq: Number(x.m![1]) }));
        const numeric = [...matched].sort((a, b) => a.seq - b.seq).map(x => x.f);
        const lexFiles = matched.map(x => x.f);
        expect(lexFiles).toEqual(numeric);
      });

      it('every *.sql file is non-empty UTF-8 readable text', () => {
        const files = listSqlFiles(d.path);
        for (const f of files) {
          const content = readFileSync(join(d.path, f), 'utf8');
          expect(content.length, `empty migration file: ${f}`).toBeGreaterThan(0);
        }
      });
    });
  }

  it('canvas migrations start at 001 and have no gaps from minimum to maximum', () => {
    const dir = MIGRATION_DIRS.find(d => d.label === 'canvas')!;
    const files = listSqlFiles(dir.path);
    const seqs = files
      .map(f => f.match(dir.pattern))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => Number(m[1]))
      .sort((a, b) => a - b);

    expect(seqs[0]).toBe(1);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i] - seqs[i - 1], `gap before canvas migration ${seqs[i]}`).toBe(1);
    }
  });

  it('budget migrations start at 001 and have no gaps', () => {
    const dir = MIGRATION_DIRS.find(d => d.label === 'budget')!;
    const files = listSqlFiles(dir.path);
    const seqs = files
      .map(f => f.match(dir.pattern))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => Number(m[1]))
      .sort((a, b) => a - b);

    expect(seqs[0]).toBe(1);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i] - seqs[i - 1], `gap before budget migration ${seqs[i]}`).toBe(1);
    }
  });

  it('media-organizer migrations start at 001 (gaps allowed — multiple iter resets recorded in history)', () => {
    // media-organizer migration history was reset multiple times during early
    // iterations (002 → 010 jump documented in repo history). The invariant
    // here is "starts at 001 + strictly monotonic + unique" — gaps are NOT
    // sequence corruption, they reflect intentional history erasure.
    const dir = MIGRATION_DIRS.find(d => d.label === 'media-organizer')!;
    const files = listSqlFiles(dir.path);
    const seqs = files
      .map(f => f.match(dir.pattern))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map(m => Number(m[1]))
      .sort((a, b) => a - b);

    expect(seqs[0]).toBe(1);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i] - seqs[i - 1], `non-monotonic at media-organizer ${seqs[i]}`).toBeGreaterThan(0);
    }
  });

  it('no two migration directories accidentally share a filename', () => {
    // Cross-directory sanity: if a migration was copy-pasted between domains
    // and not renamed, the migrate() applier would treat them as unrelated
    // but a developer would be confused. Defensive check.
    const allNames = MIGRATION_DIRS.flatMap(d =>
      listSqlFiles(d.path).map(f => ({ dir: d.label, name: f })),
    );
    const byName = new Map<string, string[]>();
    for (const { dir, name } of allNames) {
      const arr = byName.get(name) ?? [];
      arr.push(dir);
      byName.set(name, arr);
    }
    const collisions = [...byName.entries()].filter(([_, dirs]) => dirs.length > 1);
    expect(collisions, `duplicate migration filename across domains`).toEqual([]);
  });
});
