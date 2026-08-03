// notebookTools.test.ts — the assistant's notebook tools.
//
// Written because they did not exist. M96 shipped the notebook as an editor
// surface and stopped there, so the assistant could write a .ipynb with
// fs_write_file and had no way to execute a cell of it.
//
// The two things worth pinning hardest are the ones with a wrong answer that
// looks right: notebook_run must write outputs BACK into the file (a run whose
// results vanish is not a run), and every write path must refuse a notebook that
// is open in an editor, because NotebookEditorInput memoises its document and
// that tab's next save would silently overwrite the assistant's work.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createNotebookTools,
} from '../../src/built-in/chat/tools/notebookTools.js';
import { parseNotebook, serialiseNotebook, createEmptyNotebook, createEmptyCell } from '../../src/built-in/editor/notebook/notebookModel.js';
import type { NotebookOutput } from '../../src/built-in/editor/notebook/notebookModel.js';
import { _resetResourceRegistryForTest } from '../../src/services/toolResourceRegistry.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

function makeFs(files: Record<string, string>) {
  return {
    files,
    readdir: async () => [],
    readFileContent: async (p: string) => {
      if (!(p in files)) throw new Error('ENOENT');
      return { content: files[p], encoding: 'utf-8' };
    },
    exists: async (p: string) => p in files,
    workspaceRootName: 'ws',
  } as never;
}

function makeWriter(files: Record<string, string>, allowed = true) {
  return {
    writeFile: async (p: string, content: string) => { files[p] = content; },
    isPathAllowed: () => allowed,
  } as never;
}

/**
 * A stand-in for an open NotebookEditorInput holding a live document.
 *
 * The whole point of the single-writer rule is that a tool mutates THIS document
 * — the one the pane renders — rather than parsing a second copy off disk. So
 * the fake records whether it was mutated, marked dirty and saved.
 */
function makeLive(json: string) {
  const doc = parseNotebook(json);
  const state = { dirtied: 0, saved: 0, doc };
  const live = {
    resolve: async () => doc,
    markDirty: () => { state.dirtied++; },
    save: async () => { state.saved++; },
  };
  return { live, state };
}

/** path -> open document. Anything absent is "not open" and goes to disk. */
function makeResolver(open: Record<string, { resolve: () => Promise<unknown> }>) {
  return ((p: string) => open[p]) as never;
}

/** A kernel whose every cell produces `outputs` and finishes with `status`. */
function makeKernel(opts: {
  ready?: { ready: boolean; reason?: string };
  outputs?: NotebookOutput[];
  status?: 'ok' | 'error' | 'abort';
  perCall?: Array<{ outputs: NotebookOutput[]; status: 'ok' | 'error' | 'abort' }>;
  unavailable?: boolean;
  /** Emit clear(wait=true) then a frame, three times — what tqdm does. */
  clearThenOutputs?: boolean;
  /** Emit the outputs, then clear(wait=false). */
  clearNowAfter?: boolean;
} = {}) {
  const executed: string[] = [];
  let call = 0;
  const kernel = {
    isAvailable: true,
    executed,
    checkReadiness: async () => opts.ready ?? { ready: true },
    execute: async (code: string) => {
      if (opts.unavailable) return null;
      executed.push(code);
      const plan = opts.perCall?.[call] ?? { outputs: opts.outputs ?? [], status: opts.status ?? 'ok' };
      call++;
      const outListeners: Array<(o: NotebookOutput) => void> = [];
      const countListeners: Array<(n: number) => void> = [];
      const clearListeners: Array<(e: { wait: boolean }) => void> = [];
      const sub = (list: unknown[]) => (fn: unknown) => { list.push(fn); return { dispose: () => {} }; };
      const completed = (async () => {
        // A macrotask, not a microtask. The caller subscribes synchronously
        // after `await execute(...)` returns, and a microtask hop would resume
        // this first and deliver into an empty listener list. The real service
        // arrives over IPC from the main process, so the gap is inherent there.
        await new Promise((r) => setTimeout(r, 0));
        for (const fn of countListeners) fn(call);

        if (opts.clearThenOutputs) {
          // tqdm's shape: clear(wait) then the next frame, repeatedly. The clear
          // must not empty the cell until the replacement actually arrives.
          for (let f = 1; f <= 3; f++) {
            for (const fn of clearListeners) fn({ wait: true });
            for (const fn of outListeners) fn(stream(`frame ${f}\n`));
          }
        } else {
          for (const o of plan.outputs) for (const fn of outListeners) fn(o);
          if (opts.clearNowAfter) for (const fn of clearListeners) fn({ wait: false });
        }

        return {
          status: plan.status,
          durationMs: 12,
          startedAtIso: '2026-01-01T00:00:00.000Z',
          endedAtIso: '2026-01-01T00:00:00.012Z',
        };
      })();
      return {
        requestId: `r${call}`,
        elapsedMs: () => 12,
        onDidStart: sub([]),
        onDidOutput: sub(outListeners),
        onDidSetExecutionCount: sub(countListeners),
        onDidClear: sub(clearListeners),
        completed,
        dispose: () => {},
      };
    },
  } as never;
  return kernel as never & { executed: string[] };
}

const stream = (text: string): NotebookOutput =>
  ({ outputType: 'stream', name: 'stdout', text } as NotebookOutput);
const errorOut = (): NotebookOutput =>
  ({ outputType: 'error', ename: 'ZeroDivisionError', evalue: 'division by zero', traceback: ['ZeroDivisionError: division by zero'] } as NotebookOutput);

function tools(opts: {
  files?: Record<string, string>;
  open?: Record<string, { resolve: () => Promise<unknown> }>;
  kernel?: ReturnType<typeof makeKernel>;
  allowWrite?: boolean;
} = {}) {
  const files = opts.files ?? {};
  const list = createNotebookTools(
    (opts.kernel ?? makeKernel()) as never,
    makeFs(files),
    makeWriter(files, opts.allowWrite !== false),
    makeResolver(opts.open ?? {}),
  );
  const by = (n: string) => list.find(t => t.name === n)!;
  return { files, list, create: by('notebook_create'), read: by('notebook_read'), edit: by('notebook_edit_cell'), run: by('notebook_run') };
}

const NOOP_TOKEN = { isCancellationRequested: false } as never;

/** Satisfy read-before-edit by reading the notebook in this session first. */
async function withSeen(t: { read: { handler: (a: Record<string, unknown>, tk: never, inv: never) => Promise<unknown> } }, path: string) {
  await t.read.handler({ path }, NOOP_TOKEN, { sessionId: 's1' } as never);
}
const call = (t: { handler: (a: Record<string, unknown>, tk: never) => Promise<{ content: string; isError?: boolean }> }, args: Record<string, unknown>) =>
  t.handler(args, NOOP_TOKEN);

function nb(cells: Array<[string, string]>): string {
  const doc = createEmptyNotebook();
  doc.cells = cells.map(([type, source]) => {
    const c = createEmptyCell(type as 'code' | 'markdown');
    c.source = source;
    return c;
  });
  return serialiseNotebook(doc);
}

beforeEach(() => {
  vi.restoreAllMocks();
  // The read-before-edit registry is module-global and keyed by session id, so
  // without this a notebook marked seen by one test stays seen for every later
  // one — and a test asserting "refuses without a prior read" passes vacuously.
  _resetResourceRegistryForTest();
});

// ── The tools exist and are shaped right ─────────────────────────────────────

describe('tool family', () => {
  it('exposes create, read, edit and run', () => {
    expect(tools().list.map(t => t.name).sort())
      .toEqual(['notebook_create', 'notebook_edit_cell', 'notebook_read', 'notebook_run']);
  });

  it('marks only read as safe; the rest need approval', () => {
    const t = tools();
    expect(t.read.requiresConfirmation).toBe(false);
    for (const w of [t.create, t.edit, t.run]) expect(w.requiresConfirmation).toBe(true);
  });
});

// ── notebook_create ──────────────────────────────────────────────────────────

describe('notebook_create', () => {
  it('writes a file that parses as a notebook', async () => {
    const t = tools();
    const r = await call(t.create, { path: 'a.ipynb', cells: [{ type: 'code', source: 'x = 1' }] });
    expect(r.isError).toBeFalsy();
    const doc = parseNotebook(t.files['a.ipynb']);
    expect(doc.cells).toHaveLength(1);
    expect(doc.cells[0].source).toBe('x = 1');
  });

  it('supports markdown cells', async () => {
    const t = tools();
    await call(t.create, { path: 'a.ipynb', cells: [{ type: 'markdown', source: '# Title' }, { source: 'y = 2' }] });
    const doc = parseNotebook(t.files['a.ipynb']);
    expect(doc.cells.map(c => c.cellType)).toEqual(['markdown', 'code']);
  });

  it('defaults to a single empty code cell', async () => {
    const t = tools();
    await call(t.create, { path: 'a.ipynb' });
    const doc = parseNotebook(t.files['a.ipynb']);
    expect(doc.cells).toHaveLength(1);
    expect(doc.cells[0].cellType).toBe('code');
  });

  it('rejects a path that is not .ipynb', async () => {
    const r = await call(tools().create, { path: 'a.py' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('.ipynb');
  });

  it('refuses to clobber an existing notebook without overwrite', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'keep me']]) } });
    const r = await call(t.create, { path: 'a.ipynb', cells: [{ source: 'new' }] });
    expect(r.isError).toBe(true);
    expect(t.files['a.ipynb']).toContain('keep me');
  });

  it('replaces when overwrite is set', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'old']]) } });
    await call(t.create, { path: 'a.ipynb', cells: [{ source: 'new' }], overwrite: true });
    expect(parseNotebook(t.files['a.ipynb']).cells[0].source).toBe('new');
  });
});

// ── notebook_read ────────────────────────────────────────────────────────────

describe('notebook_read', () => {
  it('lists cells with their index and type', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['markdown', '# H'], ['code', 'x = 1']]) } });
    const r = await call(t.read, { path: 'a.ipynb' });
    expect(r.content).toContain('cell 0 (markdown)');
    expect(r.content).toContain('cell 1 (code)');
    expect(r.content).toContain('x = 1');
  });

  it('reports a missing notebook rather than throwing', async () => {
    const r = await call(tools().read, { path: 'nope.ipynb' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('not found');
  });

  it('reports invalid JSON as an invalid notebook', async () => {
    const t = tools({ files: { 'a.ipynb': '{ not json' } });
    const r = await call(t.read, { path: 'a.ipynb' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('not a valid notebook');
  });

  it('treats an empty file as a new notebook, matching the editor', async () => {
    const t = tools({ files: { 'a.ipynb': '' } });
    const r = await call(t.read, { path: 'a.ipynb' });
    expect(r.isError).toBeFalsy();
  });

  it('does not require approval — it only reads', async () => {
    expect(tools().read.requiresConfirmation).toBe(false);
  });
});

// ── notebook_edit_cell ───────────────────────────────────────────────────────

describe('notebook_edit_cell', () => {
  const two = () => tools({ files: { 'a.ipynb': nb([['code', 'first'], ['code', 'second']]) } });

  it('inserts at an index, shifting the rest down', async () => {
    const t = two();
    await call(t.edit, { path: 'a.ipynb', operation: 'insert', index: 1, source: 'middle' });
    expect(parseNotebook(t.files['a.ipynb']).cells.map(c => c.source)).toEqual(['first', 'middle', 'second']);
  });

  it('appends when index equals the cell count', async () => {
    const t = two();
    await call(t.edit, { path: 'a.ipynb', operation: 'insert', index: 2, source: 'last' });
    expect(parseNotebook(t.files['a.ipynb']).cells.map(c => c.source)).toEqual(['first', 'second', 'last']);
  });

  it('replaces a cell and drops its now-wrong output', async () => {
    // Output describing code that no longer exists is worse than no output.
    const doc = createEmptyNotebook();
    const c = createEmptyCell('code');
    c.source = 'old'; c.executionCount = 3;
    c.outputs = [stream('stale result')];
    doc.cells = [c];
    const t = tools({ files: { 'a.ipynb': serialiseNotebook(doc) } });

    await call(t.edit, { path: 'a.ipynb', operation: 'replace', index: 0, source: 'new' });
    const after = parseNotebook(t.files['a.ipynb']).cells[0];
    expect(after.source).toBe('new');
    expect(after.outputs).toHaveLength(0);
    expect(after.executionCount).toBeNull();
  });

  it('deletes a cell', async () => {
    const t = two();
    await call(t.edit, { path: 'a.ipynb', operation: 'delete', index: 0 });
    expect(parseNotebook(t.files['a.ipynb']).cells.map(c => c.source)).toEqual(['second']);
  });

  it('never leaves a notebook with zero cells', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'only']]) } });
    await call(t.edit, { path: 'a.ipynb', operation: 'delete', index: 0 });
    expect(parseNotebook(t.files['a.ipynb']).cells).toHaveLength(1);
  });

  it('rejects an out-of-range index instead of silently doing nothing', async () => {
    const r = await call(two().edit, { path: 'a.ipynb', operation: 'replace', index: 9, source: 'x' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('out of range');
  });

  it('rejects an unknown operation', async () => {
    const r = await call(two().edit, { path: 'a.ipynb', operation: 'shuffle', index: 0 });
    expect(r.isError).toBe(true);
  });
});

// ── notebook_run — the point of the whole thing ──────────────────────────────

describe('notebook_run', () => {
  it('executes each code cell against the kernel', async () => {
    const kernel = makeKernel({ outputs: [stream('hi\n')] });
    const t = tools({ files: { 'a.ipynb': nb([['code', 'a = 1'], ['code', 'b = 2']]) }, kernel });
    await call(t.run, { path: 'a.ipynb' });
    expect(kernel.executed).toEqual(['a = 1', 'b = 2']);
  });

  it('writes outputs BACK into the file', async () => {
    // THE point. A run whose results are not persisted is not a run — reopening
    // the notebook would show empty cells.
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'print("hello")']]) },
      kernel: makeKernel({ outputs: [stream('hello\n')] }),
    });
    await call(t.run, { path: 'a.ipynb' });
    const cell = parseNotebook(t.files['a.ipynb']).cells[0];
    expect(cell.outputs).toHaveLength(1);
    expect(JSON.stringify(cell.outputs[0])).toContain('hello');
  });

  it('records execution timing so the editor shows a duration', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'x = 1']]) }, kernel: makeKernel() });
    await call(t.run, { path: 'a.ipynb' });
    const cell = parseNotebook(t.files['a.ipynb']).cells[0];
    expect(JSON.stringify(cell.metadata)).toContain('2026-01-01T00:00:00.000Z');  });

  it('returns the output to the caller, not just to the file', async () => {
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'print(1)']]) },
      kernel: makeKernel({ outputs: [stream('1\n')] }),
    });
    const r = await call(t.run, { path: 'a.ipynb' });
    expect(r.content).toContain('1');
    expect(r.content).toContain('cell 0');
  });

  it('skips markdown and empty cells', async () => {
    const kernel = makeKernel();
    const t = tools({ files: { 'a.ipynb': nb([['markdown', '# H'], ['code', '   '], ['code', 'real']]) }, kernel });
    await call(t.run, { path: 'a.ipynb' });
    expect(kernel.executed).toEqual(['real']);
  });

  it('runs a single cell when cellIndex is given', async () => {
    const kernel = makeKernel();
    const t = tools({ files: { 'a.ipynb': nb([['code', 'one'], ['code', 'two']]) }, kernel });
    await call(t.run, { path: 'a.ipynb', cellIndex: 1 });
    expect(kernel.executed).toEqual(['two']);
  });

  it('refuses to run a markdown cell by index', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['markdown', '# H']]) } });
    const r = await call(t.run, { path: 'a.ipynb', cellIndex: 0 });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('only code cells run');
  });

  it('stops at the first cell that raises, like Run All', async () => {
    const kernel = makeKernel({
      perCall: [
        { outputs: [stream('ok\n')], status: 'ok' },
        { outputs: [errorOut()], status: 'error' },
        { outputs: [stream('never\n')], status: 'ok' },
      ],
    });
    const t = tools({ files: { 'a.ipynb': nb([['code', 'one'], ['code', 'boom'], ['code', 'three']]) }, kernel });
    const r = await call(t.run, { path: 'a.ipynb' });
    expect(kernel.executed).toEqual(['one', 'boom']);
    expect(r.isError).toBe(true);
    expect(r.content).toContain('stopped at cell 1');
  });

  it('persists the cells that DID run even when a later one fails', async () => {
    // The successful outputs are the context for fixing the failure.
    const kernel = makeKernel({
      perCall: [
        { outputs: [stream('good\n')], status: 'ok' },
        { outputs: [errorOut()], status: 'error' },
      ],
    });
    const t = tools({ files: { 'a.ipynb': nb([['code', 'one'], ['code', 'boom']]) }, kernel });
    await call(t.run, { path: 'a.ipynb' });
    const cells = parseNotebook(t.files['a.ipynb']).cells;
    expect(JSON.stringify(cells[0].outputs)).toContain('good');
    expect(JSON.stringify(cells[1].outputs)).toContain('ZeroDivisionError');
  });

  it('surfaces the traceback to the caller', async () => {
    const t = tools({
      files: { 'a.ipynb': nb([['code', '1/0']]) },
      kernel: makeKernel({ outputs: [errorOut()], status: 'error' }),
    });
    const r = await call(t.run, { path: 'a.ipynb' });
    expect(r.content).toContain('ZeroDivisionError');
  });

  it('names the specific fix when there is no environment', async () => {
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'x']]) },
      kernel: makeKernel({ ready: { ready: false, reason: 'NO_ENV' } }),
    });
    const r = await call(t.run, { path: 'a.ipynb' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('Settings › Python');
  });

  it('names the specific fix when ipykernel is missing', async () => {
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'x']]) },
      kernel: makeKernel({ ready: { ready: false, reason: 'MISSING_IPYKERNEL' } }),
    });
    const r = await call(t.run, { path: 'a.ipynb' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('ipykernel');
  });

  it('reports a notebook with nothing to run instead of pretending it ran', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['markdown', '# just notes']]) } });
    const r = await call(t.run, { path: 'a.ipynb' });
    expect(r.content).toContain('no code cells');
  });
});

// ── Output fidelity: the tool must produce the same file the editor would ────
//
// The first version of notebook_run collected outputs by hand — it pushed every
// kernel message straight onto cell.outputs. That got three things wrong, all of
// them invisible until you opened the saved file. Both writers now share
// CellOutputSink, and these pin the behaviours that copy lost.

describe('output fidelity vs the notebook editor', () => {
  it('merges consecutive stream chunks into one output', async () => {
    // The kernel emits one `stream` message per flush — for a loop printing a
    // line at a time, one per line. Jupyter stores those as a single output, so
    // a file written here has to look like a file written there.
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'for i in range(3): print(i)']]) },
      kernel: makeKernel({ outputs: [stream('0\n'), stream('1\n'), stream('2\n')] }),
    });
    await call(t.run, { path: 'a.ipynb' });

    const cell = parseNotebook(t.files['a.ipynb']).cells[0];
    expect(cell.outputs, 'three flushes should be one merged stream output').toHaveLength(1);
    expect((cell.outputs[0] as { text: string }).text).toBe('0\n1\n2\n');
  });

  it('does not merge across different streams', async () => {
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'x']]) },
      kernel: makeKernel({
        outputs: [
          stream('out\n'),
          { outputType: 'stream', name: 'stderr', text: 'err\n' } as never,
          stream('out2\n'),
        ],
      }),
    });
    await call(t.run, { path: 'a.ipynb' });
    expect(parseNotebook(t.files['a.ipynb']).cells[0].outputs).toHaveLength(3);
  });

  it('honours clear_output(wait=True) — a progress bar keeps one frame, not every frame', async () => {
    // tqdm and matplotlib animations emit clear_output(wait=True) before each
    // redraw. Ignoring the deferred clear wrote every frame into the notebook.
    const kernel = makeKernel({ clearThenOutputs: true });
    const t = tools({ files: { 'a.ipynb': nb([['code', 'for i in tqdm(range(3)): pass']]) }, kernel });
    await call(t.run, { path: 'a.ipynb' });

    const cell = parseNotebook(t.files['a.ipynb']).cells[0];
    expect(cell.outputs, 'each deferred clear should replace the previous frame').toHaveLength(1);
    expect((cell.outputs[0] as { text: string }).text).toBe('frame 3\n');
  });

  it('clear_output(wait=False) empties immediately', async () => {
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'x']]) },
      kernel: makeKernel({ outputs: [stream('gone\n')], clearNowAfter: true }),
    });
    await call(t.run, { path: 'a.ipynb' });
    expect(parseNotebook(t.files['a.ipynb']).cells[0].outputs).toHaveLength(0);
  });

  it('bounds the bytes a runaway loop can write into the file', async () => {
    const huge = 'x'.repeat(500_000);
    const t = tools({
      files: { 'a.ipynb': nb([['code', 'while True: print("x" * 1000)']]) },
      kernel: makeKernel({ outputs: Array.from({ length: 8 }, () => stream(huge)) }),
    });
    await call(t.run, { path: 'a.ipynb' });

    const cell = parseNotebook(t.files['a.ipynb']).cells[0];
    const text = (cell.outputs[0] as { text: string }).text;
    expect(text.length, '4 MB of output must be capped').toBeLessThan(2_200_000);
    // The tail is what matters — the end of a run is the part you need.
    expect(text).toContain('earlier characters dropped');
  });
});

// ── Cancellation ─────────────────────────────────────────────────────────────
//
// The severe one. `execution.completed` settles only on a kernel reply, an abort
// or dispose(). A non-terminating cell produces none, and nothing upstream
// applies a timeout — the tool service and the turn loop both bare-await the
// handler. So an unsubscribed handler parks forever, the turn never completes,
// and every later message the user sends is queued behind a request that will
// never finish. Polling the token between cells does not help: the poll is never
// reached.

describe('cancellation of a non-terminating cell', () => {
  /** A kernel whose cell never replies — `while True: pass`. */
  function hangingKernel() {
    let settle: ((r: unknown) => void) | undefined;
    const state = { interrupted: 0, disposed: 0 };
    const kernel = {
      isAvailable: true,
      checkReadiness: async () => ({ ready: true }),
      interrupt: async () => { state.interrupted++; },
      execute: async () => {
        const sub = () => ({ dispose: () => {} });
        const completed = new Promise((r) => { settle = r; });
        return {
          requestId: 'r1',
          elapsedMs: () => 1,
          onDidStart: sub, onDidOutput: sub, onDidSetExecutionCount: sub, onDidClear: sub,
          completed,
          dispose: () => {
            state.disposed++;
            // The real service settles `completed` as 'abort' on dispose.
            settle?.({ status: 'abort', durationMs: null, startedAtIso: null, endedAtIso: null });
          },
        };
      },
    };
    return { kernel: kernel as never, state };
  }

  function cancellableToken() {
    const listeners: Array<() => void> = [];
    const token = {
      isCancellationRequested: false,
      onCancellationRequested: (fn: () => void) => { listeners.push(fn); return { dispose: () => {} }; },
    };
    return {
      token: token as never,
      cancel() { token.isCancellationRequested = true; for (const fn of [...listeners]) fn(); },
    };
  }

  it('returns instead of hanging forever when the turn is cancelled', async () => {
    const { kernel, state } = hangingKernel();
    const files = { 'a.ipynb': nb([['code', 'while True: pass']]) };
    const [, , , run] = createNotebookTools(kernel, makeFs(files), makeWriter(files), makeResolver({}));
    const { token, cancel } = cancellableToken();

    const pending = (run as { handler: (a: unknown, t: unknown) => Promise<{ content: string }> })
      .handler({ path: 'a.ipynb' }, token);

    // Let the run reach `await execution.completed`, then cancel.
    await new Promise((r) => setTimeout(r, 5));
    cancel();

    // Without the subscription this never settles and the test times out.
    const result = await Promise.race([
      pending,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('notebook_run hung after cancellation')), 1000)),
    ]) as { content: string };

    expect(result.content).toBeTruthy();
    expect(state.interrupted, 'should ask the kernel to interrupt').toBeGreaterThan(0);
    expect(state.disposed, 'should dispose the execution so `completed` settles').toBeGreaterThan(0);
  });

  it('does not start further cells after cancellation', async () => {
    const { kernel } = hangingKernel();
    const files = { 'a.ipynb': nb([['code', 'one'], ['code', 'two'], ['code', 'three']]) };
    const [, , , run] = createNotebookTools(kernel, makeFs(files), makeWriter(files), makeResolver({}));
    const { token, cancel } = cancellableToken();

    const pending = (run as { handler: (a: unknown, t: unknown) => Promise<{ content: string }> })
      .handler({ path: 'a.ipynb' }, token);
    await new Promise((r) => setTimeout(r, 5));
    cancel();

    const result = await Promise.race([
      pending,
      new Promise((_r, rej) => setTimeout(() => rej(new Error('hung')), 1000)),
    ]) as { content: string };
    // Only the first cell was ever entered.
    expect(result.content).toContain('Ran 1 cell');
  });
});

// ── Path safety ──────────────────────────────────────────────────────────────

describe('path sanitisation', () => {
  it('rejects traversal rather than reporting it as "already exists"', async () => {
    const r = await call(tools().create, { path: '../../outside/evil.ipynb' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('traversal');
  });

  it('rejects an absolute path', async () => {
    const r = await call(tools().create, { path: 'C:/Windows/evil.ipynb' });
    expect(r.isError).toBe(true);
    expect(r.content.toLowerCase()).toContain('absolute');
  });

  it('rejects traversal on edit and run too, not only create', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'x']]) } });
    const e = await call(t.edit, { path: '../a.ipynb', operation: 'delete', index: 0 });
    const r = await call(t.run, { path: '../a.ipynb' });
    expect(e.isError).toBe(true);
    expect(r.isError).toBe(true);
  });

  it('honours .parallxignore via the shared sanitiser', async () => {
    const t = tools({ files: {}, allowWrite: false });
    const r = await call(t.create, { path: 'blocked.ipynb' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('.parallxignore');
  });
});

// ── Read-before-edit ─────────────────────────────────────────────────────────

describe('read-before-edit', () => {
  // The system prompt states this guarantee without qualification. A notebook
  // tool that skipped it made the prompt wrong: the assistant could rewrite a
  // cell from a remembered state and discard the user's changes since.
  const SESSION = { sessionId: 's1' } as never;
  const withSession = (
    t: { handler: (a: Record<string, unknown>, tk: never, inv: never) => Promise<{ content: string; isError?: boolean }> },
    args: Record<string, unknown>,
  ) => t.handler(args, NOOP_TOKEN, SESSION);

  it('refuses an edit with no prior read in this session', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'x = 1']]) } });
    const r = await withSession(t.edit, { path: 'a.ipynb', operation: 'replace', index: 0, source: 'y = 2' });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('notebook_read');
  });

  it('allows the edit once the notebook has been read', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'x = 1']]) } });
    await withSession(t.read, { path: 'a.ipynb' });
    const r = await withSession(t.edit, { path: 'a.ipynb', operation: 'replace', index: 0, source: 'y = 2' });
    expect(r.isError).toBeFalsy();
    expect(parseNotebook(t.files['a.ipynb']).cells[0].source).toBe('y = 2');
  });

  it('refuses overwrite of an existing notebook with no prior read', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'precious']]) } });
    const r = await withSession(t.create, { path: 'a.ipynb', cells: [{ source: 'new' }], overwrite: true });
    expect(r.isError).toBe(true);
    expect(t.files['a.ipynb']).toContain('precious');
  });

  it('does not require a read to create a NEW notebook', async () => {
    const t = tools();
    const r = await withSession(t.create, { path: 'fresh.ipynb', cells: [{ source: 'x' }] });
    expect(r.isError).toBeFalsy();
  });

  it('a run counts as having read it — it reports every cell back', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'x = 1']]) } });
    await withSession(t.run, { path: 'a.ipynb' });
    const r = await withSession(t.edit, { path: 'a.ipynb', operation: 'replace', index: 0, source: 'y = 2' });
    expect(r.isError).toBeFalsy();
  });
});

// ── Registration shape ───────────────────────────────────────────────────────

describe('permission levels and the consent split', () => {
  it('notebook_read is always-allowed, a real member of ToolPermissionLevel', async () => {
    // It was 'safe', which is not in the union and only compiled because of the
    // `as` cast. A tool carrying a value outside the union drops out of Ask mode
    // and read-only autonomy — exactly where a read tool should still work.
    expect(tools().read.permissionLevel).toBe('always-allowed');
    for (const w of [tools().create, tools().edit, tools().run]) {
      expect(w.permissionLevel).toBe('requires-approval');
    }
  });

  it('splits file tools from the executing tool', async () => {
    // python.enabled is consent to RUN Python. Reading or editing a .ipynb is a
    // file operation that fs_* can already do, so gating it bought nothing.
    const mod = await import('../../src/built-in/chat/tools/notebookTools.js');
    const files = mod.createNotebookFileTools(makeFs({}), makeWriter({}), makeResolver({}));
    const runners = mod.createNotebookRunTools(makeKernel(), makeFs({}), makeWriter({}), makeResolver({}));
    expect(files.map(t => t.name).sort()).toEqual(['notebook_create', 'notebook_edit_cell', 'notebook_read']);
    expect(runners.map(t => t.name)).toEqual(['notebook_run']);
  });
});

// ── One writer per notebook ──────────────────────────────────────────────────
//
// The rule: if the notebook is open, the tool mutates the pane's OWN document
// and saves through it. If it is not, the tool writes the file.
//
// This replaces an earlier design that refused to touch an open notebook. The
// refusal prevented the data loss but made the assistant useless on the notebook
// you were actually looking at — and the loss it prevented only existed because
// there were two writers. Removing the second writer removes the problem instead
// of managing it.

describe('single writer: an open notebook is edited through its live document', () => {
  it('notebook_edit_cell mutates the open document, not the file', async () => {
    const onDisk = nb([['code', 'original']]);
    const { live, state } = makeLive(onDisk);
    const t = tools({ files: { 'a.ipynb': onDisk }, open: { 'a.ipynb': live } });

    await call(t.edit, { path: 'a.ipynb', operation: 'replace', index: 0, source: 'edited' });

    expect(state.doc.cells[0].source, 'the pane\'s document should hold the edit').toBe('edited');
    expect(state.dirtied, 'the input must be marked dirty').toBeGreaterThan(0);
    expect(state.saved, 'and saved through its own path').toBeGreaterThan(0);
    // The file was NOT written behind the pane — that is the second writer.
    expect(t.files['a.ipynb'], 'the file must not be written directly').toBe(onDisk);
  });

  it('notebook_run puts outputs into the open document', async () => {
    // The case that matters most: you are watching the notebook, the assistant
    // runs it, and the outputs appear in front of you.
    const onDisk = nb([['code', 'print("hi")']]);
    const { live, state } = makeLive(onDisk);
    const t = tools({
      files: { 'a.ipynb': onDisk },
      open: { 'a.ipynb': live },
      kernel: makeKernel({ outputs: [stream('hi\n')] }),
    });

    await call(t.run, { path: 'a.ipynb' });

    expect(JSON.stringify(state.doc.cells[0].outputs)).toContain('hi');
    expect(state.saved).toBeGreaterThan(0);
    expect(t.files['a.ipynb']).toBe(onDisk);
  });

  it('notebook_create with overwrite replaces the open document in place', async () => {
    const onDisk = nb([['code', 'old']]);
    const { live, state } = makeLive(onDisk);
    const t = tools({ files: { 'a.ipynb': onDisk }, open: { 'a.ipynb': live } });

    await withSeen(t, 'a.ipynb');
    const r = await call(t.create, { path: 'a.ipynb', cells: [{ source: 'brand new' }], overwrite: true });

    expect(r.isError).toBeFalsy();
    expect(state.doc.cells.map(c => c.source)).toEqual(['brand new']);
    expect(state.saved).toBeGreaterThan(0);
  });

  it('treats an open notebook as existing, so create still needs overwrite', async () => {
    const { live } = makeLive(nb([['code', 'x']]));
    // Not on disk yet — only open, unsaved. Creating over it must still refuse.
    const t = tools({ files: {}, open: { 'a.ipynb': live } });
    const r = await call(t.create, { path: 'a.ipynb', cells: [{ source: 'y' }] });
    expect(r.isError).toBe(true);
    expect(r.content).toContain('already exists');
  });

  it('writes the file normally when the notebook is NOT open', async () => {
    const t = tools({ files: { 'a.ipynb': nb([['code', 'original']]) } });
    await call(t.edit, { path: 'a.ipynb', operation: 'replace', index: 0, source: 'edited' });
    expect(parseNotebook(t.files['a.ipynb']).cells[0].source).toBe('edited');
  });

  it('reads the open document, not the stale file', async () => {
    // The pane has unsaved edits; reading must show those, not what is on disk.
    const { live, state } = makeLive(nb([['code', 'on disk']]));
    state.doc.cells[0].source = 'unsaved in the pane';
    const t = tools({ files: { 'a.ipynb': nb([['code', 'on disk']]) }, open: { 'a.ipynb': live } });

    const r = await call(t.run, { path: 'a.ipynb' });
    expect(r.content).toBeTruthy();
    // The run executed the pane's version.
    expect(state.doc.cells[0].source).toBe('unsaved in the pane');
  });

  it('does not report an open notebook as an obstacle any more', async () => {
    const { live } = makeLive(nb([['code', 'x = 1']]));
    const t = tools({ files: { 'a.ipynb': nb([['code', 'x = 1']]) }, open: { 'a.ipynb': live } });
    const r = await call(t.run, { path: 'a.ipynb' });
    expect(r.content).not.toContain('open in an editor');
    expect(r.content).not.toContain('close the tab');
  });
});
