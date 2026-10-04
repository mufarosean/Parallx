// hashPool.cjs — streaming media fingerprints (full-contents MD5 + optional
// 64KB head/tail oshash) computed in a small worker_thread pool
// (hashWorker.cjs), behind fs:hashFile. The media organizer previously
// spawned certutil / a node one-liner per file — one process launch per hash
// made bulk scans crawl, and hashing inline in the main process would chop
// the event loop that routes user input. Jobs beyond the pool size queue
// FIFO, so callers can fire freely.
//
// Nothing exists until the first hash is asked for: no worker is started at
// app start. Workers that sit idle for `idleMs` are stopped, so a tool that
// stopped hashing (or was turned off) leaves no threads behind.

const path = require('node:path');

/**
 * @param {{ size?: number, idleMs?: number, workerPath?: string, Worker?: any }} [opts]
 */
function createHashPool(opts = {}) {
  const size = opts.size || Math.max(2, Math.min(8, Math.floor(require('node:os').cpus().length / 2)));
  const idleMs = opts.idleMs ?? 30_000;
  const workerPath = opts.workerPath || path.join(__dirname, 'hashWorker.cjs');
  const pool = { workers: [], queue: [], nextId: 1, pending: new Map() };
  let idleTimer = null;

  function workerDown(worker, err) {
    const idx = pool.workers.indexOf(worker);
    if (idx >= 0) pool.workers.splice(idx, 1);
    if (worker._currentJobId != null) {
      const job = pool.pending.get(worker._currentJobId);
      if (job) {
        pool.pending.delete(worker._currentJobId);
        job.reject(err);
      }
      worker._currentJobId = null;
    }
    dispatch();
  }

  function spawnWorker() {
    const Worker = opts.Worker || require('node:worker_threads').Worker;
    const worker = new Worker(workerPath);
    worker._busy = false;
    worker._currentJobId = null;
    worker.on('message', (msg) => {
      const job = pool.pending.get(msg.id);
      if (job) {
        pool.pending.delete(msg.id);
        if (msg.ok) job.resolve(msg.result);
        else job.reject(new Error(msg.error));
      }
      worker._busy = false;
      worker._currentJobId = null;
      dispatch();
    });
    worker.on('error', (err) => workerDown(worker, err));
    worker.on('exit', (code) => {
      if (code !== 0) workerDown(worker, new Error(`hash worker exited with code ${code}`));
    });
    // Unref so idle hash workers never keep the app alive at quit.
    worker.unref();
    pool.workers.push(worker);
    return worker;
  }

  /** Stop every worker once nothing is queued or running for idleMs. */
  function armIdle() {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (pool.workers.length === 0 || pool.queue.length > 0 || pool.pending.size > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (pool.queue.length > 0 || pool.pending.size > 0) return;
      const idle = pool.workers.splice(0);
      for (const w of idle) { try { void w.terminate(); } catch { /* gone */ } }
    }, idleMs);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  function dispatch() {
    while (pool.queue.length > 0) {
      let worker = pool.workers.find((w) => !w._busy);
      if (!worker) {
        if (pool.workers.length >= size) break;
        worker = spawnWorker();
      }
      const job = pool.queue.shift();
      const id = pool.nextId++;
      pool.pending.set(id, job);
      worker._busy = true;
      worker._currentJobId = id;
      worker.postMessage({ id, filePath: job.filePath, oshash: job.wantOshash });
    }
    armIdle();
  }

  /** Hash one file: { md5, oshash?, size } as hashWorker.cjs reports it. */
  function run(filePath, wantOshash) {
    return new Promise((resolve, reject) => {
      pool.queue.push({ filePath, wantOshash, resolve, reject });
      dispatch();
    });
  }

  return {
    run,
    /** Live workers (tests). */
    workerCount: () => pool.workers.length,
    /** Stop every worker now (app quit). */
    dispose() {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      for (const w of pool.workers.splice(0)) { try { void w.terminate(); } catch { /* gone */ } }
    },
  };
}

module.exports = { createHashPool };
