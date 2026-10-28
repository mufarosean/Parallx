// autonomyFiles.ts — the autonomy stores' files: routines (workflows.json),
// scheduled jobs (cron.json) and approved patterns.
//
// The window's file bridge answers in its own shapes: `exists` is a plain
// boolean, `readFile` gives `{ content }` or `{ error }`, writes give
// `{ error: null }`. The stores (and the event log) were written against
// `{ ok, data, exists }`, so not one of them ever read its file back: every
// start began empty and the next save overwrote what had been saved; the
// event log rewrote each day's file with its latest event alone. `adaptFsBridge` answers in
// the stores' shape (whichever shape the bridge uses), and `jsonFileStore`
// is the one way they read and write a JSON file.

export interface AutonomyFs {
  readdir?: (path: string) => Promise<{ ok: boolean; entries?: Array<{ name: string }>; error?: string }>;
  rename?: (oldPath: string, newPath: string) => Promise<{ ok: boolean; error?: string }>;
  exists?: (path: string) => Promise<{ ok: boolean; exists?: boolean; error?: string }>;
  mkdir?: (path: string) => Promise<{ ok: boolean; error?: string }>;
  readFile?: (path: string, encoding: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  writeFile?: (path: string, data: string, encoding: string) => Promise<{ ok: boolean; error?: string }>;
  delete?: (path: string, options?: unknown) => Promise<{ ok: boolean; error?: string }>;
}

type RawResult = { ok?: boolean; error?: unknown; content?: unknown; data?: unknown; exists?: boolean; entries?: Array<{ name: string }> } | boolean | null | undefined;
type RawFs = Record<string, ((...args: never[]) => Promise<RawResult>) | undefined>;

function errorText(r: RawResult): string | undefined {
  if (!r || typeof r !== 'object') return undefined;
  const e = r.error;
  if (e === null || e === undefined) return r.ok === false ? 'failed' : undefined;
  if (typeof e === 'string') return e;
  return (e as { message?: string }).message ?? String(e);
}

const done = (r: RawResult): { ok: boolean; error?: string } => {
  const error = errorText(r);
  return error ? { ok: false, error } : { ok: true };
};

/** The bridge, answering in the stores' `{ ok, data, exists }` shape. Writes are atomic when it can rename. */
export function adaptFsBridge(raw: unknown): AutonomyFs | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const fs = raw as RawFs;
  const call = (name: string, ...args: unknown[]): Promise<RawResult> => (fs[name] as (...a: unknown[]) => Promise<RawResult>)(...args);
  const has = (name: string) => typeof fs[name] === 'function';
  const rename = has('rename') ? async (from: string, to: string) => done(await call('rename', from, to)) : undefined;
  const writePlain = async (path: string, data: string, encoding: string) => done(await call('writeFile', path, data, encoding));
  return {
    exists: has('exists') ? async (path) => {
      const r = await call('exists', path);
      if (typeof r === 'boolean') return { ok: true, exists: r };
      const error = errorText(r);
      return error ? { ok: false, error } : { ok: true, exists: !!(r && (r.exists ?? true)) };
    } : undefined,
    readFile: has('readFile') ? async (path, encoding) => {
      const r = await call('readFile', path, encoding);
      const error = errorText(r);
      if (error || !r || typeof r !== 'object') return { ok: false, error: error ?? 'no answer' };
      return { ok: true, data: r.content ?? r.data };
    } : undefined,
    // Write beside, then rename over: a crash mid-write never leaves half a file.
    writeFile: has('writeFile') ? async (path, data, encoding) => {
      if (!rename) return writePlain(path, data, encoding);
      const tmp = `${path}.tmp`;
      const wrote = await writePlain(tmp, data, encoding);
      if (!wrote.ok) return wrote;
      const moved = await rename(tmp, path);
      return moved.ok ? moved : writePlain(path, data, encoding);
    } : undefined,
    mkdir: has('mkdir') ? async (path) => done(await call('mkdir', path)) : undefined,
    delete: has('delete') ? async (path, options) => done(await call('delete', path, options)) : undefined,
    rename,
    readdir: has('readdir') ? async (path) => {
      const r = await call('readdir', path);
      const error = errorText(r);
      return error || !r || typeof r !== 'object' ? { ok: false, error: error ?? 'no answer' } : { ok: true, entries: r.entries ?? [] };
    } : undefined,
  };
}

export interface JsonFileStore {
  /**
   * The file's JSON; null when there is no file. A file that is not JSON is
   * copied aside (`<name>.corrupt-<time>.json`) and read as none. A file that
   * exists but cannot be read throws: its owner must then not save over it.
   */
  load(): Promise<unknown>;
  /** Write the snapshot (atomically). Throws when the write fails. */
  save(snapshot: unknown): Promise<void>;
}

export function jsonFileStore(fs: Required<Pick<AutonomyFs, 'exists' | 'readFile' | 'writeFile' | 'mkdir'>>, dir: string, name: string): JsonFileStore {
  const path = `${dir}/${name}`;
  return {
    async load() {
      const exists = await fs.exists(path);
      if (!exists.ok) throw new Error(`cannot check ${path}: ${exists.error}`);
      if (!exists.exists) return null;
      const read = await fs.readFile(path, 'utf-8');
      if (!read.ok || typeof read.data !== 'string') throw new Error(`cannot read ${path}: ${read.error ?? 'no text'}`);
      try {
        return JSON.parse(read.data);
      } catch {
        const aside = `${dir}/${name.replace(/\.json$/, '')}.corrupt-${Date.now()}.json`;
        const kept = await fs.writeFile(aside, read.data, 'utf-8');
        if (!kept.ok) throw new Error(`${path} is not JSON and could not be kept aside: ${kept.error}`);
        console.error(`[autonomy] ${path} was not JSON; kept as ${aside}, starting empty`);
        return null;
      }
    },
    async save(snapshot) {
      await fs.mkdir(dir);
      const wrote = await fs.writeFile(path, JSON.stringify(snapshot, null, 2), 'utf-8');
      if (!wrote.ok) throw new Error(`cannot write ${path}: ${wrote.error}`);
    },
  };
}
