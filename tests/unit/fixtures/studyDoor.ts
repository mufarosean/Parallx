// studyDoor.ts — Study's bundle (ext/study/main.js) over SQLite with every
// migration, and a stand-in for the core's door (api.canvas.databases) that
// keeps its databases in memory and counts every write Study makes. Shared
// by the tests of a subject's record and of a plan.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS = join(__dirname, '../../../ext/study/db/migrations');

import { fakeDoor } from './studyFakeDoor';
export { fakeDoor, type Row } from './studyFakeDoor';

export type Study = Record<string, any>;
export function loadStudy(names: readonly string[]): Study {
  const src = readFileSync(join(__dirname, '../../../ext/study/main.js'), 'utf8').replace(/^export\s+(?=(?:async\s+)?function|const|let)/gm, '');
  return new Function(`'use strict';\n${src}\nreturn { ${names.map((x) => `${x}: typeof ${x} === 'undefined' ? undefined : ${x}`).join(', ')} };`)() as Study;
}

/** Study's bundle over SQLite with every migration and the fake door: the parts a test drives. */
export function studyHarness(names: readonly string[]) {
  const S = loadStudy(names);
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith('.sql')).sort()) sql.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  const wrap = (fn: () => object) => { try { return { error: null, ...fn() }; } catch (e: any) { return { error: { message: e.message } }; } };
  const fake = fakeDoor();
  const api: any = {
    database: {
      get: async (q: string, p: unknown[] = []) => wrap(() => ({ row: sql.prepare(q).get(...(p as any[])) ?? null })),
      all: async (q: string, p: unknown[] = []) => wrap(() => ({ rows: sql.prepare(q).all(...(p as any[])) })),
      run: async (q: string, p: unknown[] = []) => wrap(() => { const r = sql.prepare(q).run(...(p as any[])); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }),
    },
    workspace: { getConfiguration: () => ({ get: (_k: string, f: unknown) => f }), workspaceFolders: [{ uri: 'file:///ws', name: 'ws' }], fs: { readdir: async () => [] } },
    canvas: { databases: fake.door },
  };
  S.__testables.__setApi(api);
  const one = (q: string, ...p: unknown[]) => sql.prepare(q).get(...(p as any[])) as any;
  const all = (q: string, ...p: unknown[]) => sql.prepare(q).all(...(p as any[])) as any[];
  return { S, sql, api, one, all, ...fake };
}
