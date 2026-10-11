// databaseStatementCache.test.ts — the main process reuses prepared statements.
//
// Every db call used to prepare its SQL afresh, and parsing and planning a
// statement costs more than running most of them. Each open database keeps
// its statements by SQL text, bounded; database.cjs clears the cache when
// the database closes. (database.cjs itself needs Electron's better-sqlite3
// build, so the cache is its own module and is tested with a stand-in db.)

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { STATEMENT_CACHE_SIZE, preparedStatement } = require('../../electron/statementCache.cjs');

function fakeDb() {
  const prepared: string[] = [];
  return { prepared, prepare: (sql: string) => { prepared.push(sql); return { sql }; } };
}

describe('preparedStatement', () => {
  it('prepares each SQL text once and hands back the same statement', () => {
    const db = fakeDb();
    const cache = new Map();
    const a = preparedStatement(cache, db, 'SELECT 1');
    const b = preparedStatement(cache, db, 'SELECT 1');
    const c = preparedStatement(cache, db, 'SELECT 2');
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(db.prepared).toEqual(['SELECT 1', 'SELECT 2']);
  });

  it('drops the oldest statement past the cap', () => {
    const db = fakeDb();
    const cache = new Map();
    for (let i = 0; i < STATEMENT_CACHE_SIZE + 44; i++) preparedStatement(cache, db, `SELECT ${i}`);
    expect(cache.size).toBe(STATEMENT_CACHE_SIZE);
    expect(cache.has('SELECT 0')).toBe(false);
    expect(cache.has('SELECT 43')).toBe(false);
    expect(cache.has('SELECT 44')).toBe(true);
    expect(cache.has(`SELECT ${STATEMENT_CACHE_SIZE + 43}`)).toBe(true);
    // A re-prepare after eviction is a fresh statement, prepared again.
    preparedStatement(cache, db, 'SELECT 0');
    expect(db.prepared.filter((s) => s === 'SELECT 0')).toHaveLength(2);
  });

  it('keeps one cache per database', () => {
    const one = fakeDb();
    const two = fakeDb();
    const cacheOne = new Map();
    const cacheTwo = new Map();
    preparedStatement(cacheOne, one, 'SELECT 1');
    preparedStatement(cacheTwo, two, 'SELECT 1');
    expect(one.prepared).toEqual(['SELECT 1']);
    expect(two.prepared).toEqual(['SELECT 1']);
    expect(cacheOne.get('SELECT 1')).not.toBe(cacheTwo.get('SELECT 1'));
  });
});
