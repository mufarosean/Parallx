// mediaOrganizerFtsRebuild.test.ts
//
// Reproduces the May 9, 2026 regression where newly-saved images took
// 60+ seconds to appear in the Media-Organizer grid.
//
// Why the bug exists
// ──────────────────
// Migration 020 (M64 P1) drops and recreates `mo_photos_fts` /
// `mo_videos_fts` to add a `basename_text` column. After upgrading,
// the FTS tables are empty on next launch, so the activation hook
// in ext/media-organizer/main.js calls `moRebuildSearchIndex()`.
//
// The original implementation issued ONE `await db.run(INSERT ...)`
// per surviving photo and per surviving video. In the real app each
// `db.run` is an IPC round-trip from the renderer to the main process
// (single-channel, FIFO). On a 10K-item library that's ~10K serial
// IPC calls. While the rebuild ran, every save event the watcher
// produced (`processFile` → DB INSERT) queued behind those round-trips,
// so a freshly-saved image appeared in the grid only after the rebuild
// finished — measured at 60+ seconds by the user.
//
// The fix: batch all FTS writes into a single `db.transaction(ops)`
// call (one round-trip).
//
// What this test does
// ───────────────────
// 1. Builds the same schema the extension uses (mo_photos, mo_videos,
//    join tables, FTS5 tables with basename_text).
// 2. Wraps a real better-sqlite3 in a faithful IPC channel mock —
//    every operation (run/get/all/transaction) is awaited through a
//    single async FIFO queue, mirroring the renderer→main bridge.
// 3. Seeds N rows.
// 4. Runs OLD rebuild (per-row await) AND NEW rebuild (single
//    transaction) while concurrently firing "save image" inserts and
//    measuring the latency between the save call and its completion.
// 5. Reports the numbers and asserts the new path keeps save latency
//    under control.
//
// Run:
//   pnpm vitest run tests/unit/mediaOrganizerFtsRebuild.test.ts

import { describe, it, expect } from 'vitest';
// Use Node 22's built-in `node:sqlite` to avoid the better-sqlite3 native
// binary mismatch (the workspace copy is built for Electron's Node ABI).
// FTS5 is compiled into the bundled SQLite, so the schema below works.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
type DB = InstanceType<typeof DatabaseSync>;

// ── Faithful IPC channel mock ───────────────────────────────────────────────
//
// Every call resolves on a microtask AFTER yielding to the event loop, and
// only one call runs at a time. This is exactly how the renderer↔main IPC
// bridge behaves: `await db.run(...)` from the renderer round-trips through
// a single channel and main runs each op serially.
//
// Per-op overhead is set to a small sleep (0.5 ms) representing IPC
// marshaling + scheduling. The point is not the absolute number but the
// COUNT of IPC calls: N for per-row, 1 for transaction.

const IPC_LATENCY_MS = 0.5;

class IpcDbBridge {
  protected queue: Promise<unknown> = Promise.resolve();

  constructor(protected db: DB) {}

  protected enqueue<T>(work: () => T): Promise<T> {
    const next = this.queue.then(async () => {
      // model IPC marshaling cost
      await new Promise((r) => setTimeout(r, IPC_LATENCY_MS));
      return work();
    });
    this.queue = next.catch(() => undefined);
    return next as Promise<T>;
  }

  run(sql: string, params: unknown[] = []) {
    return this.enqueue(() => this.db.prepare(sql).run(...(params as any[])));
  }
  get(sql: string, params: unknown[] = []) {
    return this.enqueue(() => this.db.prepare(sql).get(...(params as any[])));
  }
  all(sql: string, params: unknown[] = []) {
    return this.enqueue(() => this.db.prepare(sql).all(...(params as any[])));
  }
  /** One IPC round-trip executes ALL ops inside an IMMEDIATE transaction. */
  transaction(ops: { type: 'run' | 'get' | 'all'; sql: string; params?: unknown[] }[]) {
    return this.enqueue(() => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        for (const op of ops) {
          const p = (op.params ?? []) as any[];
          if (op.type === 'run') this.db.prepare(op.sql).run(...p);
          else if (op.type === 'get') this.db.prepare(op.sql).get(...p);
          else this.db.prepare(op.sql).all(...p);
        }
        this.db.exec('COMMIT');
      } catch (e) {
        this.db.exec('ROLLBACK');
        throw e;
      }
    });
  }
}

// ── Schema setup (subset matching ext/media-organizer/main.js) ──────────────

function buildSchema(db: DB) {
  db.exec(`
    CREATE TABLE mo_folders (id INTEGER PRIMARY KEY, path TEXT);
    CREATE TABLE mo_files (id INTEGER PRIMARY KEY, basename TEXT, folder_id INTEGER);
    CREATE TABLE mo_tags (id INTEGER PRIMARY KEY, name TEXT);

    CREATE TABLE mo_photos (id INTEGER PRIMARY KEY, title TEXT, details TEXT);
    CREATE TABLE mo_photos_files (photo_id INTEGER, file_id INTEGER);
    CREATE TABLE mo_photos_tags (photo_id INTEGER, tag_id INTEGER);

    CREATE TABLE mo_videos (id INTEGER PRIMARY KEY, title TEXT, details TEXT);
    CREATE TABLE mo_videos_files (video_id INTEGER, file_id INTEGER);
    CREATE TABLE mo_videos_tags (video_id INTEGER, tag_id INTEGER);

    CREATE VIRTUAL TABLE mo_photos_fts USING fts5(
      title, details, tags_text, folder_text, basename_text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE mo_videos_fts USING fts5(
      title, details, tags_text, folder_text, basename_text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);
}

function seed(db: DB, photoCount: number, videoCount: number) {
  const insP = db.prepare('INSERT INTO mo_photos (id, title, details) VALUES (?, ?, ?)');
  const insV = db.prepare('INSERT INTO mo_videos (id, title, details) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  for (let i = 1; i <= photoCount; i++) insP.run(i, `Photo ${i}`, `Details ${i}`);
  for (let i = 1; i <= videoCount; i++) insV.run(i, `Video ${i}`, `Details ${i}`);
  db.exec('COMMIT');
}

// ── The two rebuild implementations (extracted faithfully) ──────────────────

// OLD: state of moRebuildSearchIndex BEFORE today's fix.
//      One `await bridge.run(INSERT)` per row.
async function oldRebuild(bridge: IpcDbBridge): Promise<void> {
  const photos = (await bridge.all(
    `SELECT p.id AS pid, p.title AS title, p.details AS details,
            GROUP_CONCAT(DISTINCT t.name)   AS tags_text,
            GROUP_CONCAT(DISTINCT fl.path)  AS folder_text,
            GROUP_CONCAT(DISTINCT f.basename) AS basename_text
       FROM mo_photos p
  LEFT JOIN mo_photos_tags pt ON pt.photo_id = p.id
  LEFT JOIN mo_tags t ON t.id = pt.tag_id
  LEFT JOIN mo_photos_files pf ON pf.photo_id = p.id
  LEFT JOIN mo_files f ON f.id = pf.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      GROUP BY p.id`,
  )) as any[];
  await bridge.run('DELETE FROM mo_photos_fts');
  for (const r of photos) {
    await bridge.run(
      'INSERT INTO mo_photos_fts (rowid, title, details, tags_text, folder_text, basename_text) VALUES (?, ?, ?, ?, ?, ?)',
      [r.pid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '', r.basename_text || ''],
    );
  }

  const videos = (await bridge.all(
    `SELECT v.id AS vid, v.title AS title, v.details AS details,
            GROUP_CONCAT(DISTINCT t.name)   AS tags_text,
            GROUP_CONCAT(DISTINCT fl.path)  AS folder_text,
            GROUP_CONCAT(DISTINCT f.basename) AS basename_text
       FROM mo_videos v
  LEFT JOIN mo_videos_tags vt ON vt.video_id = v.id
  LEFT JOIN mo_tags t ON t.id = vt.tag_id
  LEFT JOIN mo_videos_files vf ON vf.video_id = v.id
  LEFT JOIN mo_files f ON f.id = vf.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      GROUP BY v.id`,
  )) as any[];
  await bridge.run('DELETE FROM mo_videos_fts');
  for (const r of videos) {
    await bridge.run(
      'INSERT INTO mo_videos_fts (rowid, title, details, tags_text, folder_text, basename_text) VALUES (?, ?, ?, ?, ?, ?)',
      [r.vid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '', r.basename_text || ''],
    );
  }
}

// NEW: state AFTER today's fix. One transaction per table.
async function newRebuild(bridge: IpcDbBridge): Promise<void> {
  const photos = (await bridge.all(
    `SELECT p.id AS pid, p.title AS title, p.details AS details,
            GROUP_CONCAT(DISTINCT t.name)   AS tags_text,
            GROUP_CONCAT(DISTINCT fl.path)  AS folder_text,
            GROUP_CONCAT(DISTINCT f.basename) AS basename_text
       FROM mo_photos p
  LEFT JOIN mo_photos_tags pt ON pt.photo_id = p.id
  LEFT JOIN mo_tags t ON t.id = pt.tag_id
  LEFT JOIN mo_photos_files pf ON pf.photo_id = p.id
  LEFT JOIN mo_files f ON f.id = pf.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      GROUP BY p.id`,
  )) as any[];
  {
    const ops: { type: 'run'; sql: string; params: unknown[] }[] = [
      { type: 'run', sql: 'DELETE FROM mo_photos_fts', params: [] },
    ];
    for (const r of photos) {
      ops.push({
        type: 'run',
        sql: 'INSERT INTO mo_photos_fts (rowid, title, details, tags_text, folder_text, basename_text) VALUES (?, ?, ?, ?, ?, ?)',
        params: [r.pid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '', r.basename_text || ''],
      });
    }
    await bridge.transaction(ops);
  }

  const videos = (await bridge.all(
    `SELECT v.id AS vid, v.title AS title, v.details AS details,
            GROUP_CONCAT(DISTINCT t.name)   AS tags_text,
            GROUP_CONCAT(DISTINCT fl.path)  AS folder_text,
            GROUP_CONCAT(DISTINCT f.basename) AS basename_text
       FROM mo_videos v
  LEFT JOIN mo_videos_tags vt ON vt.video_id = v.id
  LEFT JOIN mo_tags t ON t.id = vt.tag_id
  LEFT JOIN mo_videos_files vf ON vf.video_id = v.id
  LEFT JOIN mo_files f ON f.id = vf.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      GROUP BY v.id`,
  )) as any[];
  {
    const ops: { type: 'run'; sql: string; params: unknown[] }[] = [
      { type: 'run', sql: 'DELETE FROM mo_videos_fts', params: [] },
    ];
    for (const r of videos) {
      ops.push({
        type: 'run',
        sql: 'INSERT INTO mo_videos_fts (rowid, title, details, tags_text, folder_text, basename_text) VALUES (?, ?, ?, ?, ?, ?)',
        params: [r.vid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '', r.basename_text || ''],
      });
    }
    await bridge.transaction(ops);
  }
}

// CHUNKED: state AFTER the follow-up fix. Multiple smaller transactions
// with an event-loop yield between each, so concurrent writes (the
// watcher's incremental INSERT) can interleave instead of queuing
// behind one giant transaction. This is what's actually shipped.
async function chunkedRebuild(bridge: IpcDbBridge): Promise<void> {
  const FTS_CHUNK = 500;
  const photos = (await bridge.all(
    `SELECT p.id AS pid, p.title AS title, p.details AS details,
            GROUP_CONCAT(DISTINCT t.name)   AS tags_text,
            GROUP_CONCAT(DISTINCT fl.path)  AS folder_text,
            GROUP_CONCAT(DISTINCT f.basename) AS basename_text
       FROM mo_photos p
  LEFT JOIN mo_photos_tags pt ON pt.photo_id = p.id
  LEFT JOIN mo_tags t ON t.id = pt.tag_id
  LEFT JOIN mo_photos_files pf ON pf.photo_id = p.id
  LEFT JOIN mo_files f ON f.id = pf.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      GROUP BY p.id`,
  )) as any[];
  await bridge.run('DELETE FROM mo_photos_fts');
  for (let i = 0; i < photos.length; i += FTS_CHUNK) {
    const slice = photos.slice(i, i + FTS_CHUNK);
    const ops = slice.map((r) => ({
      type: 'run' as const,
      sql: 'INSERT INTO mo_photos_fts (rowid, title, details, tags_text, folder_text, basename_text) VALUES (?, ?, ?, ?, ?, ?)',
      params: [r.pid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '', r.basename_text || ''],
    }));
    if (ops.length) await bridge.transaction(ops);
    await new Promise((r) => setTimeout(r, 0));
  }

  const videos = (await bridge.all(
    `SELECT v.id AS vid, v.title AS title, v.details AS details,
            GROUP_CONCAT(DISTINCT t.name)   AS tags_text,
            GROUP_CONCAT(DISTINCT fl.path)  AS folder_text,
            GROUP_CONCAT(DISTINCT f.basename) AS basename_text
       FROM mo_videos v
  LEFT JOIN mo_videos_tags vt ON vt.video_id = v.id
  LEFT JOIN mo_tags t ON t.id = vt.tag_id
  LEFT JOIN mo_videos_files vf ON vf.video_id = v.id
  LEFT JOIN mo_files f ON f.id = vf.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      GROUP BY v.id`,
  )) as any[];
  await bridge.run('DELETE FROM mo_videos_fts');
  for (let i = 0; i < videos.length; i += FTS_CHUNK) {
    const slice = videos.slice(i, i + FTS_CHUNK);
    const ops = slice.map((r) => ({
      type: 'run' as const,
      sql: 'INSERT INTO mo_videos_fts (rowid, title, details, tags_text, folder_text, basename_text) VALUES (?, ?, ?, ?, ?, ?)',
      params: [r.vid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '', r.basename_text || ''],
    }));
    if (ops.length) await bridge.transaction(ops);
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ── Save-event simulator ────────────────────────────────────────────────────
//
// Models what happens when the watcher fires for a newly-saved image:
// `processIncrementalCreate` → `processFile` → `await db.run(INSERT INTO mo_photos)`.
// We measure the wall-clock time from "save initiated" to "DB INSERT
// returned" — that's the time before the new image becomes visible in
// the grid (the grid loads from mo_photos).

async function simulateSave(bridge: IpcDbBridge, id: number): Promise<number> {
  const t0 = performance.now();
  await bridge.run(
    'INSERT INTO mo_photos (id, title, details) VALUES (?, ?, ?)',
    [id, `Saved ${id}`, ''],
  );
  return performance.now() - t0;
}

// ── The actual test ─────────────────────────────────────────────────────────

interface RunResult {
  rebuildMs: number;
  saveLatenciesMs: number[];
  maxSaveMs: number;
  meanSaveMs: number;
}

async function runScenario(
  rebuild: (b: IpcDbBridge) => Promise<void>,
  photoCount: number,
  videoCount: number,
): Promise<RunResult> {
  const db = new DatabaseSync(':memory:');
  buildSchema(db);
  seed(db, photoCount, videoCount);
  const bridge = new IpcDbBridge(db);

  const saveLatencies: number[] = [];

  // Kick off the rebuild without awaiting.
  const rebuildStart = performance.now();
  const rebuildPromise = rebuild(bridge);

  // Fire 5 save events spaced 100 ms apart, just like the watcher would.
  const saveJobs: Promise<void>[] = [];
  let nextId = photoCount + 1;
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 100));
    const id = nextId++;
    saveJobs.push(
      simulateSave(bridge, id).then((ms) => {
        saveLatencies.push(ms);
      }),
    );
  }

  await rebuildPromise;
  const rebuildMs = performance.now() - rebuildStart;
  await Promise.all(saveJobs);
  db.close();

  const meanSaveMs = saveLatencies.reduce((a, b) => a + b, 0) / saveLatencies.length;
  const maxSaveMs = Math.max(...saveLatencies);
  return { rebuildMs, saveLatenciesMs: saveLatencies, maxSaveMs, meanSaveMs };
}

describe('media-organizer FTS rebuild — watcher contention', () => {
  // 2000 photos + 500 videos. With IPC_LATENCY_MS=0.5 that's ~1.25 s of
  // serial IPC for the OLD path and ~1 ms for the NEW path. The save
  // events fire DURING the rebuild and queue behind it.
  const PHOTOS = 2000;
  const VIDEOS = 500;

  it('OLD per-row rebuild is catastrophically slow on a non-trivial library', async () => {
    const r = await runScenario(oldRebuild, PHOTOS, VIDEOS);
    // eslint-disable-next-line no-console
    console.log(
      `[OLD]  rebuild=${r.rebuildMs.toFixed(0)}ms  saves=${r.saveLatenciesMs
        .map((x) => x.toFixed(0))
        .join('/')}ms  mean=${r.meanSaveMs.toFixed(0)}  max=${r.maxSaveMs.toFixed(0)}`,
    );
    // 2500 serial IPC round-trips at 0.5 ms each = 1.25 s minimum just
    // for IPC overhead. With JS+SQLite work added, expect ≥ 5 s on any
    // host. On the user's machine (~10K-item library) this scales to
    // tens of seconds — observed during M64 cold-start activation.
    expect(r.rebuildMs).toBeGreaterThan(5_000);
  }, 120_000);

  it('NEW transactional rebuild completes in under one second', async () => {
    const r = await runScenario(newRebuild, PHOTOS, VIDEOS);
    // eslint-disable-next-line no-console
    console.log(
      `[NEW]  rebuild=${r.rebuildMs.toFixed(0)}ms  saves=${r.saveLatenciesMs
        .map((x) => x.toFixed(0))
        .join('/')}ms  mean=${r.meanSaveMs.toFixed(0)}  max=${r.maxSaveMs.toFixed(0)}`,
    );
    expect(r.rebuildMs).toBeLessThan(2_000);
  }, 60_000);

  it('NEW path is at least 10× faster than OLD for the rebuild itself', async () => {
    const oldR = await runScenario(oldRebuild, PHOTOS, VIDEOS);
    const newR = await runScenario(newRebuild, PHOTOS, VIDEOS);
    // eslint-disable-next-line no-console
    console.log(
      `[CMP]  OLD rebuild=${oldR.rebuildMs.toFixed(0)}ms  NEW rebuild=${newR.rebuildMs.toFixed(
        0,
      )}ms  speedup=${(oldR.rebuildMs / Math.max(newR.rebuildMs, 1)).toFixed(1)}x`,
    );
    expect(oldR.rebuildMs).toBeGreaterThan(newR.rebuildMs * 10);
  }, 180_000);

  // The bug the user reported: a freshly-saved image takes 60+ seconds
  // to appear in the grid because activation kicks off
  // `moRebuildSearchIndex()`, which (in the previous shape) ran one
  // monolithic transaction that held SQLite's write lock — and the IPC
  // main thread — for the full duration of the rebuild. Concurrent
  // INSERTs from the watcher pipeline queued behind it.
  //
  // The chunked rebuild breaks the work into N small transactions with
  // an event-loop yield (`await setTimeout(0)`) between each, so saves
  // can interleave. This test asserts that property: during a chunked
  // rebuild on a 10K-photo library, max save latency stays well below
  // the rebuild's total wall-clock duration.
  //
  // We can't model the renderer↔main blocking faithfully in-process
  // (this file's IPC mock runs in the same JS event loop, so a
  // synchronous busy-wait inside `transaction` also stalls the
  // renderer's `setTimeout`-driven save fires). We measure the
  // upstream property instead: the chunked rebuild relinquishes the
  // bridge between chunks, so saves never wait for the entire run.
  it('CHUNKED rebuild surrenders the IPC channel between chunks', async () => {
    const db = new DatabaseSync(':memory:');
    buildSchema(db);
    seed(db, 10_000, 0);
    const bridge = new IpcDbBridge(db);

    const t0 = performance.now();
    const rebuildPromise = chunkedRebuild(bridge);
    const saves: Promise<number>[] = [];
    let nextId = 10_001;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => setTimeout(r, 30));
      saves.push(simulateSave(bridge, nextId++));
    }
    await rebuildPromise;
    const rebuildMs = performance.now() - t0;
    const lats = await Promise.all(saves);
    const maxSaveMs = Math.max(...lats);
    db.close();

    // eslint-disable-next-line no-console
    console.log(
      `[CHUNK] rebuild=${rebuildMs.toFixed(0)}ms  saves=${lats
        .map((x) => x.toFixed(0))
        .join('/')}ms  max=${maxSaveMs.toFixed(0)}ms`,
    );

    // Each chunk is 500 ops + a setTimeout(0) yield. A save fired
    // during a chunk waits at most for that one chunk's transaction
    // to flush — never for the entire rebuild.
    expect(maxSaveMs).toBeLessThan(rebuildMs * 0.5);
  }, 60_000);
});
