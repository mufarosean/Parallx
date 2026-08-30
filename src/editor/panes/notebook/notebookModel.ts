// notebookModel.ts — nbformat v4 parse / serialise (M96)
//
// The whole reason notebooks are a separate surface rather than executable
// canvas blocks is interoperability: a notebook written here must open in
// VS Code or JupyterLab, and — more importantly — a notebook written THERE
// must survive a round trip through here.
//
// That second direction is the demanding one. nbformat is an open schema:
// notebook metadata, cell metadata, and output metadata all legitimately carry
// keys this app knows nothing about (widget state, slide directives, nbgrader
// fields, papermill parameters, per-cell tags). A model that parses into typed
// fields and serialises only those fields will silently delete a colleague's
// work the first time the user hits save. So every level keeps the keys it did
// not model and writes them back verbatim.
//
// Reference: https://nbformat.readthedocs.io/en/latest/format_description.html

// ─── Types ───────────────────────────────────────────────────────────────────

export type CellType = 'code' | 'markdown' | 'raw';

/**
 * A MIME bundle. Values are `string` for text types, and may legitimately be a
 * non-string (objects for `application/json`), so this stays `unknown` and
 * readers go through `mimeText`.
 */
export type MimeBundle = Record<string, unknown>;

export interface StreamOutput {
  readonly outputType: 'stream';
  readonly name: 'stdout' | 'stderr';
  text: string;
}

export interface ExecuteResultOutput {
  readonly outputType: 'execute_result';
  executionCount: number | null;
  data: MimeBundle;
  metadata: Record<string, unknown>;
}

export interface DisplayDataOutput {
  readonly outputType: 'display_data';
  data: MimeBundle;
  metadata: Record<string, unknown>;
}

export interface ErrorOutput {
  readonly outputType: 'error';
  ename: string;
  evalue: string;
  traceback: string[];
}

export type NotebookOutput = StreamOutput | ExecuteResultOutput | DisplayDataOutput | ErrorOutput;

export interface NotebookCell {
  /** nbformat 4.5+ cell id. Stable across saves so external diffs stay small. */
  id: string;
  cellType: CellType;
  /** Normalised to one string in memory; written back as a line array. */
  source: string;
  executionCount: number | null;
  outputs: NotebookOutput[];
  metadata: Record<string, unknown>;
  /** Cell-level keys this model does not understand, preserved verbatim. */
  unknownFields: Record<string, unknown>;
}

export interface NotebookDocument {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformatMinor: number;
  /** Top-level keys outside the known four, preserved verbatim. */
  unknownFields: Record<string, unknown>;
}

// ─── Multiline helpers ───────────────────────────────────────────────────────

/**
 * nbformat stores multiline text as an array of lines, each retaining its
 * trailing newline. Both forms are legal for the same field, so readers must
 * accept either.
 */
export function joinMultiline(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((part) => (typeof part === 'string' ? part : String(part))).join('');
  if (value === null || value === undefined) return '';
  return String(value);
}

/**
 * Inverse of joinMultiline, matching what `nbformat` itself writes: every line
 * keeps its `\n`, and a trailing newline does NOT produce a final empty
 * element. Getting this wrong is invisible in the app and produces spurious
 * whole-file diffs in git the moment the notebook is opened elsewhere.
 */
export function splitMultiline(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i < parts.length - 1) lines.push(parts[i] + '\n');
    else if (parts[i] !== '') lines.push(parts[i]);
  }
  return lines;
}

/** Read a MIME bundle entry as text, or undefined when it is not textual. */
export function mimeText(data: MimeBundle, key: string): string | undefined {
  if (!(key in data)) return undefined;
  const value = data[key];
  if (typeof value === 'string' || Array.isArray(value)) return joinMultiline(value);
  return undefined;
}

// ─── Cell ids ────────────────────────────────────────────────────────────────

/**
 * nbformat 4.5 requires cell ids to be 1–64 chars of [a-zA-Z0-9-_].
 * `crypto.randomUUID` is available in Electron's renderer; the fallback keeps
 * the model usable under a bare test runner.
 */
export function generateCellId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid.replace(/-/g, '').slice(0, 16);
  let out = '';
  for (let i = 0; i < 16; i++) out += Math.floor(Math.random() * 36).toString(36);
  return out;
}

const CELL_ID_RE = /^[a-zA-Z0-9\-_]{1,64}$/;

// ─── Known keys ──────────────────────────────────────────────────────────────

const KNOWN_TOP_LEVEL = new Set(['cells', 'metadata', 'nbformat', 'nbformat_minor']);
// `attachments` is deliberately ABSENT. It is a real nbformat field — it holds
// images pasted into markdown cells — but this model does not manage it, and
// listing a field as "known" while not modelling it is precisely how a save
// silently deletes someone's embedded images. Anything not modelled belongs in
// unknownFields and rides through untouched.
const KNOWN_CELL_FIELDS = new Set(['id', 'cell_type', 'source', 'metadata', 'outputs', 'execution_count']);

function collectUnknown(source: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (!known.has(key)) rest[key] = source[key];
  }
  return rest;
}

// ─── Output parsing ──────────────────────────────────────────────────────────

function parseOutput(raw: unknown): NotebookOutput | null {
  if (!raw || typeof raw !== 'object') return null;
  const output = raw as Record<string, unknown>;

  switch (output['output_type']) {
    case 'stream':
      return {
        outputType: 'stream',
        name: output['name'] === 'stderr' ? 'stderr' : 'stdout',
        text: joinMultiline(output['text']),
      };
    case 'execute_result':
      return {
        outputType: 'execute_result',
        executionCount: typeof output['execution_count'] === 'number' ? output['execution_count'] : null,
        data: (output['data'] as MimeBundle) ?? {},
        metadata: (output['metadata'] as Record<string, unknown>) ?? {},
      };
    case 'display_data':
      return {
        outputType: 'display_data',
        data: (output['data'] as MimeBundle) ?? {},
        metadata: (output['metadata'] as Record<string, unknown>) ?? {},
      };
    case 'error':
      return {
        outputType: 'error',
        ename: typeof output['ename'] === 'string' ? output['ename'] : '',
        evalue: typeof output['evalue'] === 'string' ? output['evalue'] : '',
        traceback: Array.isArray(output['traceback']) ? output['traceback'].map(String) : [],
      };
    default:
      // An unrecognised output type is dropped rather than guessed at. The
      // alternative — inventing a shape — would write back something the
      // schema does not describe.
      return null;
  }
}

function serialiseOutput(output: NotebookOutput): Record<string, unknown> {
  switch (output.outputType) {
    case 'stream':
      return { output_type: 'stream', name: output.name, text: splitMultiline(output.text) };
    case 'execute_result':
      return {
        output_type: 'execute_result',
        execution_count: output.executionCount,
        data: serialiseMimeBundle(output.data),
        metadata: output.metadata,
      };
    case 'display_data':
      return {
        output_type: 'display_data',
        data: serialiseMimeBundle(output.data),
        metadata: output.metadata,
      };
    case 'error':
      return {
        output_type: 'error',
        ename: output.ename,
        evalue: output.evalue,
        traceback: output.traceback,
      };
  }
}

/**
 * Text MIME types are written as line arrays; everything else is written back
 * as-is. Base64 payloads (`image/png`) are deliberately left as single strings
 * rather than chunked — nbformat permits both, and chunking a 2 MB image into
 * a 40,000-element array is hostile to every other tool that opens the file.
 */
function serialiseMimeBundle(data: MimeBundle): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && key.startsWith('text/')) out[key] = splitMultiline(value);
    else if (Array.isArray(value) || typeof value === 'string') out[key] = value;
    else out[key] = value;
  }
  return out;
}

// ─── Parse ───────────────────────────────────────────────────────────────────

export class NotebookParseError extends Error {}

/** Parse `.ipynb` JSON text into the in-memory document. */
export function parseNotebook(text: string): NotebookDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new NotebookParseError(`Not valid JSON: ${(err as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new NotebookParseError('Notebook root must be a JSON object.');
  }

  const root = raw as Record<string, unknown>;
  const nbformat = typeof root['nbformat'] === 'number' ? root['nbformat'] : 4;
  if (nbformat < 4) {
    // v3 and earlier use `worksheets`, a different cell schema, and different
    // output types. Converting is nbformat's job, not this app's, and a
    // half-conversion that saves is worse than a clean refusal.
    throw new NotebookParseError(
      `This notebook uses nbformat v${nbformat}. Parallx reads v4 (Jupyter 4.0+, 2015 onwards). ` +
      'Open it once in Jupyter or VS Code to upgrade it.',
    );
  }

  const nbformatMinor = typeof root['nbformat_minor'] === 'number' ? root['nbformat_minor'] : 5;
  const rawCells = Array.isArray(root['cells']) ? root['cells'] : [];

  const seenIds = new Set<string>();
  const cells: NotebookCell[] = [];

  for (const rawCell of rawCells) {
    if (!rawCell || typeof rawCell !== 'object') continue;
    const cell = rawCell as Record<string, unknown>;

    const declaredType = cell['cell_type'];
    const cellType: CellType =
      declaredType === 'markdown' ? 'markdown' : declaredType === 'raw' ? 'raw' : 'code';

    // Ids must exist and be unique — a duplicate would make two cells
    // indistinguishable to anything keying off id, including this app's own
    // DOM reconciliation.
    let id = typeof cell['id'] === 'string' && CELL_ID_RE.test(cell['id']) ? cell['id'] : generateCellId();
    while (seenIds.has(id)) id = generateCellId();
    seenIds.add(id);

    cells.push({
      id,
      cellType,
      source: joinMultiline(cell['source']),
      executionCount:
        cellType === 'code' && typeof cell['execution_count'] === 'number' ? cell['execution_count'] : null,
      outputs:
        cellType === 'code' && Array.isArray(cell['outputs'])
          ? cell['outputs'].map(parseOutput).filter((o): o is NotebookOutput => o !== null)
          : [],
      metadata: (cell['metadata'] as Record<string, unknown>) ?? {},
      unknownFields: collectUnknown(cell, KNOWN_CELL_FIELDS),
    });
  }

  return {
    cells,
    metadata: (root['metadata'] as Record<string, unknown>) ?? {},
    nbformat,
    nbformatMinor,
    unknownFields: collectUnknown(root, KNOWN_TOP_LEVEL),
  };
}

// ─── Serialise ───────────────────────────────────────────────────────────────

/**
 * Serialise to `.ipynb` text.
 *
 * Two-space indent and a trailing newline match what `nbformat` writes, so a
 * file saved here and a file saved by Jupyter differ only where the content
 * differs — which is what makes these files reviewable in git.
 */
export function serialiseNotebook(doc: NotebookDocument): string {
  const cells = doc.cells.map((cell) => {
    const base: Record<string, unknown> = {
      // Field order matches nbformat's own output for clean diffs.
      ...(doc.nbformatMinor >= 5 ? { id: cell.id } : {}),
      cell_type: cell.cellType,
      metadata: cell.metadata,
      source: splitMultiline(cell.source),
      ...cell.unknownFields,
    };
    if (cell.cellType === 'code') {
      base['execution_count'] = cell.executionCount;
      base['outputs'] = cell.outputs.map(serialiseOutput);
    }
    return base;
  });

  const root: Record<string, unknown> = {
    cells,
    metadata: doc.metadata,
    nbformat: doc.nbformat,
    nbformat_minor: doc.nbformatMinor,
    ...doc.unknownFields,
  };

  return JSON.stringify(root, null, 2) + '\n';
}

// ─── Construction / mutation ─────────────────────────────────────────────────

export function createEmptyCell(cellType: CellType = 'code'): NotebookCell {
  return {
    id: generateCellId(),
    cellType,
    source: '',
    executionCount: null,
    outputs: [],
    metadata: {},
    unknownFields: {},
  };
}

/** A new notebook, declaring the Python 3 kernel other tools expect to find. */
export function createEmptyNotebook(): NotebookDocument {
  return {
    cells: [createEmptyCell('code')],
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', file_extension: '.py', mimetype: 'text/x-python' },
    },
    nbformat: 4,
    nbformatMinor: 5,
    unknownFields: {},
  };
}

/**
 * The notebook's language, used to pick syntax highlighting for code cells.
 * Falls back to python, which is the only kernel this app can start.
 */
export function notebookLanguage(doc: NotebookDocument): string {
  const info = doc.metadata['language_info'];
  if (info && typeof info === 'object') {
    const name = (info as Record<string, unknown>)['name'];
    if (typeof name === 'string' && name) return name;
  }
  const spec = doc.metadata['kernelspec'];
  if (spec && typeof spec === 'object') {
    const language = (spec as Record<string, unknown>)['language'];
    if (typeof language === 'string' && language) return language;
  }
  return 'python';
}

// ─── Execution timing ────────────────────────────────────────────────────────

/**
 * Read how long a cell last took, from the `metadata.execution` block.
 *
 * This is JupyterLab's convention, not an invention: it records ISO timestamps
 * under keys named after the protocol messages they came from. Reading and
 * writing the same shape means timing survives a save/reload here AND is
 * visible to anyone who opens the file in JupyterLab — which is the entire
 * reason notebooks are a separate surface.
 *
 * Returns null when the block is absent or malformed; a notebook written by a
 * tool that does not record timing is completely normal.
 */
export function cellDurationMs(cell: NotebookCell): number | null {
  const execution = cell.metadata['execution'];
  if (!execution || typeof execution !== 'object') return null;
  const block = execution as Record<string, unknown>;
  const start = block['iopub.execute_input'];
  const end = block['shell.execute_reply'];
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  const delta = endMs - startMs;
  // A clock adjustment mid-run can produce nonsense; showing "-3s" is worse
  // than showing nothing.
  return delta >= 0 ? delta : null;
}

/** Record a run's timing in the shape JupyterLab reads. */
export function setCellExecutionTiming(
  cell: NotebookCell,
  startedAtIso: string | null,
  endedAtIso: string | null,
): void {
  if (!startedAtIso || !endedAtIso) {
    delete cell.metadata['execution'];
    return;
  }
  const existing = (cell.metadata['execution'] as Record<string, unknown> | undefined) ?? {};
  cell.metadata['execution'] = {
    // Preserve any sibling keys another tool wrote (e.g. `shell.execute_reply
    // .started`), consistent with the unknown-field policy everywhere else.
    ...existing,
    'iopub.execute_input': startedAtIso,
    'shell.execute_reply': endedAtIso,
  };
}

/** Human-readable duration: `340ms`, `1.4s`, `2m 05s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Drop every output and execution count — "Clear all outputs". */
export function clearAllOutputs(doc: NotebookDocument): void {
  for (const cell of doc.cells) {
    if (cell.cellType !== 'code') continue;
    cell.outputs = [];
    cell.executionCount = null;
  }
}

// ─── Output accumulation ─────────────────────────────────────────────────────

/**
 * Cap on the merged stream text held for one cell — roughly 2 MB.
 *
 * Bounds both the repaint cost and what gets written into the `.ipynb`; a
 * runaway loop should not be able to produce a 200 MB notebook file.
 */
export const MAX_STREAM_CHARS = 2_000_000;

/**
 * Accumulates one cell's outputs the way Jupyter does.
 *
 * Lives here, next to the model, because there is more than one thing driving a
 * kernel: the notebook editor pane, and the assistant's `notebook_run` tool. The
 * first version of that tool re-implemented this — it pushed every message
 * straight onto `cell.outputs` — and got three things wrong that are invisible
 * until you look at the saved file:
 *
 *   - `clear_output(wait=True)` was ignored, so a cell using tqdm or a
 *     matplotlib animation wrote every redraw frame into the notebook instead of
 *     replacing the previous one.
 *   - Consecutive stream chunks were not merged. The kernel emits one `stream`
 *     message per flush, which for a loop printing a line at a time is one per
 *     line; Jupyter stores those as a single output. Without merging, the same
 *     code produced a different file depending on who ran it.
 *   - Nothing bounded the bytes, so a runaway loop had no ceiling at all.
 *
 * One implementation, so a fix reaches every caller.
 */
export class CellOutputSink {
  /** Set by clear_output(wait=true): drop existing outputs at the NEXT write. */
  private _pendingClear = false;

  constructor(
    private readonly _cell: NotebookCell,
    private readonly _maxStreamChars: number = MAX_STREAM_CHARS,
  ) {}

  /** Append one kernel output, merging consecutive same-stream chunks. */
  append(output: NotebookOutput): void {
    if (this._pendingClear) {
      this._cell.outputs = [];
      this._pendingClear = false;
    }
    const last = this._cell.outputs[this._cell.outputs.length - 1];
    if (output.outputType === 'stream' && last?.outputType === 'stream' && last.name === output.name) {
      last.text += output.text;
      // Merging keeps the saved .ipynb sane, but it also means a cap on output
      // COUNT pins at 1 and stops protecting anything. Bound the bytes too,
      // keeping the tail: when a loop has printed a million lines, the end is
      // the part you need.
      if (last.text.length > this._maxStreamChars) {
        const dropped = last.text.length - this._maxStreamChars;
        last.text = `[… ${dropped.toLocaleString()} earlier characters dropped …]\n`
          + last.text.slice(-this._maxStreamChars);
      }
    } else {
      this._cell.outputs.push(output);
    }
  }

  /**
   * Handle `clear_output`. `wait` defers the clear until the next output
   * arrives, which is what stops a progress bar flickering to empty between
   * frames — and what stops every frame being kept.
   */
  clear(wait: boolean): void {
    if (wait) { this._pendingClear = true; return; }
    this._cell.outputs = [];
    this._pendingClear = false;
  }
}
