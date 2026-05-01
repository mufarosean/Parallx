// ─────────────────────────────────────────────────────────────────────────────
// embeddingWorker.ts — M60 T2.B3
//
// Off-thread embedding transport. The renderer pays JSON.parse + array-of-
// arrays marshalling costs every time Ollama returns 32×768 float embeddings
// to `_callEmbedApi`. On a 10k-page workspace this adds up to ~2-3s of
// renderer-thread blocking during the bulk indexing phase.
//
// This module exposes `EmbeddingWorkerClient` — a thin facade around a Web
// Worker (created lazily via Blob URL so esbuild's iife bundle stays happy)
// that performs the `/api/embed` fetch + `JSON.parse` + dimension validation
// off the renderer thread. `setTransport(...)` lets `EmbeddingService` swap
// its in-process `_callEmbedApi` for the worker variant when
// `indexing.worker.enabled` is on; on any worker error the call site falls
// back to the default in-process transport.
//
// Caching, retry, and prefixing all stay on the renderer thread inside
// `EmbeddingService.embedDocumentBatch` — the worker is intentionally
// stateless so it can be killed and re-spawned freely (and so the cache
// doesn't fragment across two memory spaces).
//
// Boundary (M60 §3.4): no IPC additions. Worker runs in the renderer
// process, just on a different thread. Default-OFF feature flag means
// existing users see no behavior change until the flag is flipped.
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED_DIMENSIONS = 768;

/** Wire format: client → worker. */
interface EmbedRequest {
  type: 'embedBatch';
  id: number;
  baseUrl: string;
  model: string;
  inputs: string[];
  timeoutMs: number;
}

/** Wire format: worker → client. */
interface EmbedResponseOk {
  id: number;
  ok: true;
  embeddings: number[][];
}
interface EmbedResponseErr {
  id: number;
  ok: false;
  error: string;
}
type EmbedResponse = EmbedResponseOk | EmbedResponseErr;

// ─────────────────────────────────────────────────────────────────────────────
// Worker source — IIFE string serialized into a Blob URL. Kept self-contained
// (no imports, no closures over module scope) so it survives Worker isolation.
// ─────────────────────────────────────────────────────────────────────────────

const WORKER_SOURCE = `
'use strict';
self.onmessage = async (ev) => {
  const msg = ev.data;
  if (!msg || msg.type !== 'embedBatch') { return; }
  const { id, baseUrl, model, inputs, timeoutMs } = msg;
  try {
    const cleanInputs = inputs.map((s) => (typeof s === 'string' && s.trim()) || 'empty');
    const body = {
      model,
      input: cleanInputs.length === 1 ? cleanInputs[0] : cleanInputs,
      truncate: true,
    };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(baseUrl + '/api/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      self.postMessage({ id, ok: false, error: '/api/embed ' + response.status + ': ' + errorText.slice(0, 200) });
      return;
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.embeddings)) {
      self.postMessage({ id, ok: false, error: 'malformed response: missing embeddings array' });
      return;
    }
    if (data.embeddings.length > 0) {
      const dims = data.embeddings[0].length;
      if (dims !== ${EXPECTED_DIMENSIONS}) {
        self.postMessage({ id, ok: false, error: 'expected ${EXPECTED_DIMENSIONS} dims, got ' + dims });
        return;
      }
    }
    self.postMessage({ id, ok: true, embeddings: data.embeddings });
  } catch (err) {
    self.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
`;

const DEFAULT_EMBED_TIMEOUT_MS = 60_000;

/**
 * Renderer-side facade. Lazily spawns the Blob-URL worker on first use; one
 * worker is shared across all batches (Ollama itself is the bottleneck —
 * adding a worker pool wouldn't speed it up). Each in-flight batch carries a
 * unique numeric `id` so responses can be routed.
 */
export class EmbeddingWorkerClient {
  private _worker: Worker | null = null;
  private _blobUrl: string | null = null;
  private _nextId = 1;
  private _pending = new Map<number, { resolve: (v: number[][]) => void; reject: (e: Error) => void }>();

  /**
   * Returns true iff Web Workers are available in this runtime AND we
   * successfully spawned a worker. Used by `IndexingPipelineService` to
   * decide whether to swap transports.
   */
  isAvailable(): boolean {
    if (typeof Worker === 'undefined') { return false; }
    try {
      this._ensureWorker();
      return this._worker !== null;
    } catch {
      return false;
    }
  }

  /**
   * Off-thread `/api/embed` call. Returns `embeddings[]` parallel to
   * `inputs[]`. Throws on worker error — caller falls back to in-process
   * transport.
   */
  embedBatch(baseUrl: string, model: string, inputs: string[], signal?: AbortSignal): Promise<number[][]> {
    if (inputs.length === 0) { return Promise.resolve([]); }
    return new Promise((resolve, reject) => {
      let worker: Worker;
      try {
        worker = this._ensureWorker();
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });

      const onAbort = () => {
        const p = this._pending.get(id);
        if (p) {
          this._pending.delete(id);
          p.reject(new DOMException('Aborted', 'AbortError'));
        }
      };
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }

      const req: EmbedRequest = {
        type: 'embedBatch', id, baseUrl, model, inputs,
        timeoutMs: DEFAULT_EMBED_TIMEOUT_MS,
      };
      worker.postMessage(req);
    });
  }

  /**
   * Tear down the worker + revoke the blob URL. Idempotent.
   */
  dispose(): void {
    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
    if (this._blobUrl) {
      try { URL.revokeObjectURL(this._blobUrl); } catch { /* ignore */ }
      this._blobUrl = null;
    }
    // Reject any still-pending requests so awaiters unwind.
    for (const [, p] of this._pending) {
      p.reject(new Error('EmbeddingWorkerClient disposed'));
    }
    this._pending.clear();
  }

  // ── Internal ──

  private _ensureWorker(): Worker {
    if (this._worker) { return this._worker; }
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers not available in this runtime');
    }
    const blob = new Blob([WORKER_SOURCE], { type: 'application/javascript' });
    this._blobUrl = URL.createObjectURL(blob);
    const worker = new Worker(this._blobUrl);
    worker.onmessage = (ev: MessageEvent<EmbedResponse>) => {
      const msg = ev.data;
      if (!msg || typeof msg.id !== 'number') { return; }
      const pending = this._pending.get(msg.id);
      if (!pending) { return; }
      this._pending.delete(msg.id);
      if (msg.ok) {
        pending.resolve(msg.embeddings);
      } else {
        pending.reject(new Error(msg.error));
      }
    };
    worker.onerror = (ev) => {
      // Reject everything in-flight; caller falls back to in-process path.
      const err = new Error(`Embedding worker errored: ${ev.message ?? '(no message)'}`);
      for (const [, p] of this._pending) { p.reject(err); }
      this._pending.clear();
    };
    this._worker = worker;
    return worker;
  }
}
