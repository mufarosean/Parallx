// notebookTools.ts — let the assistant build and run notebooks (M96 follow-on)
//
// M96 shipped the notebook surface as an editor and stopped there, so the
// assistant could write a `.ipynb` with fs_write_file and then had no way to
// execute a single cell of it. `terminal_run_command "jupyter nbconvert
// --execute"` is not a substitute: it spins up a SECOND kernel in a separate
// process, so the notebook's own kernel state and the outputs the user sees in
// the editor are untouched by it.
//
// These tools drive the SAME `INotebookKernelService` the notebook pane drives —
// one kernel per workspace — so a cell the assistant runs and a cell the user
// runs share variables, imports and dataframes, exactly as two cells in one
// notebook should.
//
// Gated on `python.enabled` alongside the python_* tools, since a notebook is
// Python execution wearing a different hat.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type { IChatToolInvocationCallContext } from '../../../services/chatTypes.js';
import type { IBuiltInToolFileSystem, IBuiltInToolFileWriter } from '../chatTypes.js';
import { markResourceSeen, wasResourceSeen, fileResourceKey } from '../../../services/toolResourceRegistry.js';
import { sanitizeRelativePath } from './writeTools.js';
import type { INotebookKernelService } from '../../../services/notebookKernelService.js';
import {
  parseNotebook,
  serialiseNotebook,
  createEmptyNotebook,
  createEmptyCell,
  setCellExecutionTiming,
  CellOutputSink,
  NotebookParseError,
  type CellType,
  type NotebookCell,
  type NotebookDocument,
} from '../../../editor/panes/notebook/notebookModel.js';
import { outputToText } from '../../../editor/panes/notebook/outputRenderer.js';

/**
 * The slice of an open `NotebookEditorInput` a writer needs.
 *
 * Structural rather than the class itself, so this module does not depend on the
 * editor layer and the tests can stand one up without a workbench.
 */
export interface LiveNotebook {
  resolve(): Promise<NotebookDocument | undefined>;
  markDirty(structural?: boolean): void;
  save(): Promise<void>;
}

/** Finds the open input for a workspace-relative notebook path, if any. */
export type OpenNotebookResolver = (relativePath: string) => LiveNotebook | undefined;

/** Beyond this, a cell's output is elided before going into the model's context. */
const MAX_OUTPUT_CHARS = 4000;
/** Guard against a notebook whose outputs would swamp a reply. */
const MAX_TOTAL_OUTPUT_CHARS = 20_000;

// ─── Shared plumbing ─────────────────────────────────────────────────────────

function isNotebookPath(p: string): boolean {
  return p.trim().toLowerCase().endsWith('.ipynb');
}

/**
 * Normalise and validate a write target.
 *
 * Reuses writeTools' sanitiser rather than growing a second one: it rejects
 * absolute paths, rejects `..` traversal, and applies `.parallxignore`. Without
 * it, `../../etc/notes.ipynb` fell through to an `exists` check and came back as
 * a confusing "already exists" or a write attempt outside the workspace.
 */
function cleanWritePath(
  relativePath: string,
  writer: IBuiltInToolFileWriter,
): { path: string } | { error: string } {
  try {
    return { path: sanitizeRelativePath(relativePath, writer) };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

/**
 * The read-before-edit contract, the same one fs_edit_file enforces.
 *
 * The system prompt states this guarantee without qualification, so a notebook
 * tool that skipped it made the prompt wrong: the assistant could rewrite a cell
 * from a remembered earlier state and silently discard whatever the user had
 * changed since.
 */
function requireSeen(
  invocation: IChatToolInvocationCallContext | undefined,
  path: string,
  action: string,
): string | null {
  if (!invocation?.sessionId) return null;   // no session context — nothing to check against
  if (wasResourceSeen(invocation.sessionId, fileResourceKey(path))) return null;
  return `Read "${path}" with notebook_read before ${action} — edit against its current `
    + `contents, not a remembered earlier state.`;
}

function markSeen(invocation: IChatToolInvocationCallContext | undefined, path: string): void {
  if (invocation?.sessionId) markResourceSeen(invocation.sessionId, fileResourceKey(path));
}

interface Loaded { doc: NotebookDocument; }

async function loadNotebook(
  fs: IBuiltInToolFileSystem,
  relativePath: string,
): Promise<Loaded | { error: string }> {
  if (!isNotebookPath(relativePath)) {
    return { error: `Not a notebook: "${relativePath}". Notebook paths end in .ipynb.` };
  }
  if (!(await fs.exists(relativePath))) {
    return { error: `Notebook not found: "${relativePath}".` };
  }
  let raw: string;
  try {
    const read = await fs.readFileContent(relativePath);
    raw = read.content;
  } catch (err) {
    return { error: `Could not read "${relativePath}": ${(err as Error).message}` };
  }
  try {
    // An empty file is a new notebook, not a parse error — same rule the editor
    // applies, so `New File` + rename is a valid way to start one.
    return { doc: raw.trim() === '' ? createEmptyNotebook() : parseNotebook(raw) };
  } catch (err) {
    const why = err instanceof NotebookParseError ? err.message : (err as Error).message;
    return { error: `"${relativePath}" is not a valid notebook: ${why}` };
  }
}

async function saveNotebook(
  writer: IBuiltInToolFileWriter,
  relativePath: string,
  doc: NotebookDocument,
): Promise<string | null> {
  if (!writer.isPathAllowed(relativePath)) {
    return `Writing to "${relativePath}" is not allowed.`;
  }
  try {
    await writer.writeFile(relativePath, serialiseNotebook(doc));
    return null;
  } catch (err) {
    return `Could not write "${relativePath}": ${(err as Error).message}`;
  }
}

/**
 * Load the notebook the way a writer should: through the OPEN document when
 * there is one.
 *
 * This is what makes the assistant and the editor one writer instead of two.
 * Parsing the file from disk while a pane holds its own memoised copy produces
 * two documents for one notebook, and the pane's next save overwrites whatever
 * was written — silently, with no error anywhere. Mutating the pane's own
 * document instead means the change is on screen the moment it happens and the
 * existing save path persists it.
 *
 * Returns the live document plus the input to mark dirty, or falls through to
 * the on-disk copy when the notebook is not open.
 */
async function openNotebookFor(
  fs: IBuiltInToolFileSystem,
  relativePath: string,
  resolveOpen: OpenNotebookResolver | undefined,
): Promise<{ doc: NotebookDocument; live?: LiveNotebook } | { error: string }> {
  const live = resolveOpen?.(relativePath);
  if (live) {
    const doc = await live.resolve();
    if (doc) return { doc, live };
    // An open input that cannot resolve is broken; fall through and report
    // whatever the on-disk read says, which will be the more useful message.
  }
  return loadNotebook(fs, relativePath);
}

/** Persist through the open document when there is one, else write the file. */
async function persistNotebook(
  writer: IBuiltInToolFileWriter,
  relativePath: string,
  doc: NotebookDocument,
  live: LiveNotebook | undefined,
): Promise<string | null> {
  if (live) {
    // The pane is already rendering this document — it mutated in place. Mark it
    // dirty (structural, so the pane rebuilds its cell views) and save through
    // the same path a manual save uses.
    try {
      live.markDirty(true);
      await live.save();
      return null;
    } catch (err) {
      return `Could not save "${relativePath}": ${(err as Error).message}`;
    }
  }
  return saveNotebook(writer, relativePath, doc);
}

function cellSource(cell: NotebookCell): string {
  return cell.source;
}

function renderOutputs(cell: NotebookCell, budget: number): string {
  if (!cell.outputs.length) return '';
  const text = cell.outputs.map(outputToText).filter(Boolean).join('\n');
  if (text.length <= budget) return text;
  // Keep the tail: a traceback's last line is the one that names the error.
  return `[… ${text.length - budget} earlier characters elided …]\n` + text.slice(-budget);
}

/** A compact, stable rendering of a notebook for the model to read. */
function describeNotebook(doc: NotebookDocument, includeOutputs: boolean): string {
  const parts: string[] = [];
  let spent = 0;
  doc.cells.forEach((cell, i) => {
    const count = cell.cellType === 'code'
      ? (cell.executionCount === null ? '[ ]' : `[${cell.executionCount}]`)
      : '';
    parts.push(`--- cell ${i} (${cell.cellType})${count ? ' ' + count : ''} ---`);
    parts.push(cellSource(cell) || '(empty)');
    if (includeOutputs && cell.cellType === 'code' && spent < MAX_TOTAL_OUTPUT_CHARS) {
      const out = renderOutputs(cell, Math.min(MAX_OUTPUT_CHARS, MAX_TOTAL_OUTPUT_CHARS - spent));
      if (out) { spent += out.length; parts.push('--- output ---', out); }
    }
  });
  return parts.join('\n');
}

function requireAll(
  kernel: INotebookKernelService | undefined,
  fs: IBuiltInToolFileSystem | undefined,
): string | null {
  if (!fs) return 'The workspace filesystem is not available.';
  if (!kernel) return 'Notebooks need the desktop app.';
  return null;
}

// ─── notebook_create ─────────────────────────────────────────────────────────

export function createNotebookCreateTool(
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  resolveOpen: OpenNotebookResolver | undefined,
): IChatTool {
  return {
    name: 'notebook_create',
    displaySummary: 'Create a Jupyter notebook (approval).',
    description:
      'Create a .ipynb notebook in the workspace with an initial set of cells. Use this '
      + 'instead of fs_write_file for notebooks — it produces a valid nbformat v4 file that '
      + 'Parallx, VS Code and JupyterLab all open. Run it afterwards with notebook_run.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Workspace-relative path ending in .ipynb, e.g. "analysis/sales.ipynb".' },
        cells: {
          type: 'array',
          description: 'Cells in order. Defaults to a single empty code cell.',
          items: {
            type: 'object',
            required: ['source'],
            properties: {
              type: { type: 'string', enum: ['code', 'markdown', 'raw'], description: 'Defaults to "code".' },
              source: { type: 'string', description: 'Cell contents.' },
            },
          },
        },
        overwrite: { type: 'boolean', description: 'Replace the file if it already exists. Default false.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'notebook',
    async handler(
      args: Record<string, unknown>,
      _token: ICancellationToken,
      invocation?: IChatToolInvocationCallContext,
    ): Promise<IToolResult> {
      if (!fs || !writer) return { content: 'The workspace filesystem is not available.', isError: true };
      const raw = String(args['path'] || '').trim();
      if (!raw) return { content: 'path is required', isError: true };
      if (!isNotebookPath(raw)) {
        return { content: `Notebook paths must end in .ipynb — got "${raw}".`, isError: true };
      }
      const cleaned = cleanWritePath(raw, writer);
      if ('error' in cleaned) return { content: cleaned.error, isError: true };
      const path = cleaned.path;

      // If the notebook is open, its live document is the one that matters —
      // writing the file behind it would be overwritten by the pane's next save.
      const live = resolveOpen?.(path);

      const exists = (live !== undefined) || await fs.exists(path);
      if (args['overwrite'] !== true && exists) {
        return {
          content: `"${path}" already exists. Pass overwrite:true to replace it, or edit it with notebook_edit_cell.`,
          isError: true,
        };
      }
      if (exists) {
        // Overwriting is destroying content, so the same read-before-edit rule
        // fs_write_file applies to an existing file applies here.
        const unseen = requireSeen(invocation, path, 'overwriting it');
        if (unseen) return { content: unseen, isError: true };
      }

      const doc = createEmptyNotebook();
      doc.cells = [];
      const specs = Array.isArray(args['cells']) ? (args['cells'] as Record<string, unknown>[]) : [];
      for (const spec of specs) {
        const type = String(spec?.['type'] ?? 'code') as CellType;
        const cell = createEmptyCell(type === 'markdown' || type === 'raw' ? type : 'code');
        cell.source = String(spec?.['source'] ?? '');
        doc.cells.push(cell);
      }
      if (doc.cells.length === 0) doc.cells.push(createEmptyCell('code'));

      let failure: string | null;
      if (live) {
        // Replace the OPEN document's cells in place rather than the file, so the
        // pane shows the new notebook immediately instead of holding a stale one.
        const target = await live.resolve();
        if (!target) return { content: `Could not open "${path}".`, isError: true };
        target.cells = doc.cells;
        failure = await persistNotebook(writer, path, target, live);
      } else {
        failure = await saveNotebook(writer, path, doc);
      }
      if (failure) return { content: failure, isError: true };

      // The assistant now knows exactly what is in it — it just wrote it.
      markSeen(invocation, path);
      const where = live ? ' (updated the open tab)' : '';
      return { content: `Created "${path}" with ${doc.cells.length} cell(s)${where}. Run it with notebook_run.` };
    },
  };
}

// ─── notebook_read ───────────────────────────────────────────────────────────

export function createNotebookReadTool(fs: IBuiltInToolFileSystem | undefined): IChatTool {
  return {
    name: 'notebook_read',
    displaySummary: 'Read a notebook\'s cells and outputs.',
    description:
      'Read a .ipynb notebook: every cell in order with its type, execution count and '
      + 'stored output. Use this rather than fs_read_file, which returns the raw JSON. '
      + 'Cell indices from here are what notebook_run and notebook_edit_cell take.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to a .ipynb file.' },
        includeOutputs: { type: 'boolean', description: 'Include stored cell outputs. Default true.' },
      },
    },
    requiresConfirmation: false,
    // 'always-allowed', not 'safe' — the latter is not a member of
    // ToolPermissionLevel and was only accepted because of the `as` cast. A tool
    // carrying a value outside the union falls out of Ask mode and read-only
    // autonomy, which is exactly where a read tool should still be available.
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'notebook',
    async handler(
      args: Record<string, unknown>,
      _token: ICancellationToken,
      invocation?: IChatToolInvocationCallContext,
    ): Promise<IToolResult> {
      if (!fs) return { content: 'The workspace filesystem is not available.', isError: true };
      const path = String(args['path'] || '').trim();
      if (!path) return { content: 'path is required', isError: true };

      const loaded = await loadNotebook(fs, path);
      if ('error' in loaded) return { content: loaded.error, isError: true };

      // Satisfies the read-before-edit contract for a later notebook_edit_cell.
      markSeen(invocation, path);

      const includeOutputs = args['includeOutputs'] !== false;
      const body = describeNotebook(loaded.doc, includeOutputs);
      return { content: `${path} — ${loaded.doc.cells.length} cell(s)\n\n${body}` };
    },
  };
}

// ─── notebook_edit_cell ──────────────────────────────────────────────────────

export function createNotebookEditCellTool(
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  resolveOpen: OpenNotebookResolver | undefined,
): IChatTool {
  return {
    name: 'notebook_edit_cell',
    displaySummary: 'Insert, replace or delete a notebook cell (approval).',
    description:
      'Change one cell of an existing notebook. Indices come from notebook_read and are '
      + '0-based. "insert" places a new cell AT the index, shifting the rest down; append '
      + 'by passing an index equal to the cell count.',
    parameters: {
      type: 'object',
      required: ['path', 'operation', 'index'],
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to a .ipynb file.' },
        operation: { type: 'string', enum: ['insert', 'replace', 'delete'] },
        index: { type: 'number', description: '0-based cell index.' },
        type: { type: 'string', enum: ['code', 'markdown', 'raw'], description: 'For insert/replace. Defaults to "code" on insert, unchanged on replace.' },
        source: { type: 'string', description: 'Cell contents. Required for insert and replace.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'notebook',
    async handler(
      args: Record<string, unknown>,
      _token: ICancellationToken,
      invocation?: IChatToolInvocationCallContext,
    ): Promise<IToolResult> {
      if (!fs || !writer) return { content: 'The workspace filesystem is not available.', isError: true };
      const raw = String(args['path'] || '').trim();
      const operation = String(args['operation'] || '').trim();
      const index = Number(args['index']);
      if (!raw) return { content: 'path is required', isError: true };
      if (!Number.isInteger(index) || index < 0) {
        return { content: 'index must be a non-negative integer.', isError: true };
      }
      const cleaned = cleanWritePath(raw, writer);
      if ('error' in cleaned) return { content: cleaned.error, isError: true };
      const path = cleaned.path;

      const unseen = requireSeen(invocation, path, 'editing a cell');
      if (unseen) return { content: unseen, isError: true };

      // Through the open document when there is one, so the edit lands in the
      // pane the user is looking at rather than in a file it will overwrite.
      const loaded = await openNotebookFor(fs, path, resolveOpen);
      if ('error' in loaded) return { content: loaded.error, isError: true };
      const cells = loaded.doc.cells;

      if (operation === 'insert') {
        if (index > cells.length) {
          return { content: `index ${index} is past the end (${cells.length} cells). Append with index ${cells.length}.`, isError: true };
        }
        const type = String(args['type'] ?? 'code') as CellType;
        const cell = createEmptyCell(type === 'markdown' || type === 'raw' ? type : 'code');
        cell.source = String(args['source'] ?? '');
        cells.splice(index, 0, cell);
      } else if (operation === 'replace') {
        if (index >= cells.length) {
          return { content: `index ${index} is out of range (${cells.length} cells).`, isError: true };
        }
        const requested = args['type'] === undefined ? undefined : String(args['type']) as CellType;
        const target = cells[index];
        if (requested && requested !== target.cellType) {
          // Outputs belong to code cells; carrying them onto a markdown cell
          // would write a notebook the schema does not allow.
          const replacement = createEmptyCell(requested);
          replacement.id = target.id;
          replacement.metadata = target.metadata;
          replacement.unknownFields = target.unknownFields;
          replacement.source = String(args['source'] ?? target.source);
          cells[index] = replacement;
        } else {
          target.source = String(args['source'] ?? target.source);
          // The stored output describes code that no longer exists.
          target.outputs = [];
          target.executionCount = null;
          setCellExecutionTiming(target, null, null);
        }
      } else if (operation === 'delete') {
        if (index >= cells.length) {
          return { content: `index ${index} is out of range (${cells.length} cells).`, isError: true };
        }
        cells.splice(index, 1);
        if (cells.length === 0) cells.push(createEmptyCell('code'));
      } else {
        return { content: `Unknown operation "${operation}". Use insert, replace or delete.`, isError: true };
      }

      const failure = await persistNotebook(writer, path, loaded.doc, loaded.live);
      if (failure) return { content: failure, isError: true };
      const where = loaded.live ? ' (in the open tab)' : '';
      return { content: `${operation} at cell ${index} — "${path}" now has ${cells.length} cell(s)${where}.` };
    },
  };
}

// ─── notebook_run ────────────────────────────────────────────────────────────

export function createNotebookRunTool(
  kernel: INotebookKernelService | undefined,
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  resolveOpen: OpenNotebookResolver | undefined,
): IChatTool {
  return {
    name: 'notebook_run',
    displaySummary: 'Run notebook cells and capture their output (approval).',
    description:
      'Execute a notebook\'s code cells against the workspace kernel and write the outputs '
      + 'back into the file. Runs every code cell in order, or one cell when cellIndex is '
      + 'given. Stops at the first cell that raises, like Jupyter\'s Run All, because later '
      + 'errors are usually consequences of the first. Returns each cell\'s output.',
    parameters: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', description: 'Workspace-relative path to a .ipynb file.' },
        cellIndex: { type: 'number', description: 'Run only this cell (0-based). Omit to run all code cells.' },
      },
    },
    requiresConfirmation: true,
    permissionLevel: 'requires-approval' as ToolPermissionLevel,
    category: 'notebook',
    async handler(
      args: Record<string, unknown>,
      token: ICancellationToken,
      invocation?: IChatToolInvocationCallContext,
    ): Promise<IToolResult> {
      const missing = requireAll(kernel, fs);
      if (missing) return { content: missing, isError: true };
      if (!writer) return { content: 'The workspace filesystem is not available.', isError: true };

      const raw = String(args['path'] || '').trim();
      if (!raw) return { content: 'path is required', isError: true };
      const cleaned = cleanWritePath(raw, writer);
      if ('error' in cleaned) return { content: cleaned.error, isError: true };
      const path = cleaned.path;

      // Run the OPEN document when there is one. This is the case that matters
      // most for notebooks: executing the pane's own cells means the outputs
      // appear in the notebook the user is watching, rather than in a file that
      // pane will overwrite the moment it saves.
      const loaded = await openNotebookFor(fs!, path, resolveOpen);
      if ('error' in loaded) return { content: loaded.error, isError: true };
      const doc = loaded.doc;

      // Running reads the whole notebook and reports every cell's output back,
      // so the assistant has seen its current contents — enough to satisfy
      // read-before-edit for a follow-up notebook_edit_cell.
      markSeen(invocation, path);

      // A missing kernel is the common first-run state and has a specific fix,
      // so say which one it is rather than "could not start".
      const readiness = await kernel!.checkReadiness();
      if (!readiness.ready) {
        if (readiness.reason === 'NO_ENV') {
          return { content: 'This workspace has no Python environment yet. Create one in Settings › Python first.', isError: true };
        }
        if (readiness.reason === 'MISSING_IPYKERNEL') {
          return { content: 'Running notebooks needs the ipykernel package in this workspace. Install it with python_install_packages, or from the banner in an open notebook.', isError: true };
        }
        return { content: 'Could not check whether this workspace can run notebooks.', isError: true };
      }

      const only = args['cellIndex'];
      let targets: number[];
      if (only !== undefined) {
        const i = Number(only);
        if (!Number.isInteger(i) || i < 0 || i >= doc.cells.length) {
          return { content: `cellIndex ${only} is out of range (${doc.cells.length} cells).`, isError: true };
        }
        if (doc.cells[i].cellType !== 'code') {
          return { content: `Cell ${i} is a ${doc.cells[i].cellType} cell — only code cells run.`, isError: true };
        }
        targets = [i];
      } else {
        targets = doc.cells
          .map((c, i) => (c.cellType === 'code' && c.source.trim() ? i : -1))
          .filter((i) => i >= 0);
      }

      if (targets.length === 0) {
        return { content: `"${path}" has no code cells with anything in them.` };
      }

      const report: string[] = [];
      let ran = 0;
      let failedAt: number | null = null;

      let cancelled = false;

      for (const i of targets) {
        if (token?.isCancellationRequested || cancelled) break;
        const cell = doc.cells[i];

        const execution = await kernel!.execute(cell.source);
        if (!execution) {
          return { content: 'Could not start the kernel for this workspace.', isError: true };
        }

        // Polling the token between cells is not cancellation.
        //
        // `execution.completed` settles only on a kernel reply, an abort, or
        // dispose(). A cell that does not terminate — `while True:`, a blocked
        // socket read — produces none of those, so an unsubscribed handler parks
        // on that await forever. Nothing upstream rescues it: the tool service
        // and the turn loop both `await` the handler with no timeout, so the
        // turn never completes, the spinner never stops, and every later message
        // the user types is queued behind a request that will never finish. The
        // session is dead until restart.
        //
        // So: ask the kernel to interrupt, and dispose the execution, which
        // settles `completed` as 'abort' and releases this frame either way.
        // pythonTools does the same for its sibling tool; the pane has Interrupt
        // and _abandonExecutions for the same reason.
        const cancelSub = token?.onCancellationRequested?.(() => {
          cancelled = true;
          void kernel!.interrupt();
          execution.dispose();
        });

        // Outputs accumulate through the SAME sink the notebook editor uses:
        // stream chunks merge, clear_output(wait) defers, and the bytes are
        // bounded. Collecting them by hand here produced a different file for
        // the same code depending on whether the assistant or the user ran it.
        cell.outputs = [];
        const sink = new CellOutputSink(cell);
        const subs = [
          execution.onDidOutput((o) => sink.append(o)),
          execution.onDidSetExecutionCount((n) => { cell.executionCount = n; }),
          execution.onDidClear(({ wait }) => sink.clear(wait)),
        ];

        let result;
        try {
          result = await execution.completed;
        } finally {
          cancelSub?.dispose();
          for (const s of subs) s.dispose();
          execution.dispose();
        }

        setCellExecutionTiming(cell, result?.startedAtIso ?? null, result?.endedAtIso ?? null);
        ran++;

        // Repaint after EACH cell when the notebook is open, so a Run All is
        // watchable the way it is when the user presses Run All themselves —
        // cells completing one at a time rather than the whole notebook
        // appearing at the end. Costs one rebuild per cell, against a cell that
        // just took at least a kernel round-trip.
        loaded.live?.markDirty(true);

        const rendered = renderOutputs(cell, MAX_OUTPUT_CHARS);
        report.push(`--- cell ${i} → ${result?.status ?? 'unknown'}${result?.durationMs != null ? ` (${result.durationMs} ms)` : ''} ---`);
        report.push(rendered || '(no output)');

        if (result?.status === 'error') { failedAt = i; break; }
        if (result?.status === 'abort') { failedAt = i; break; }
      }

      // Re-resolve before writing. A run lasts as long as the code does, and the
      // user can open the notebook at any point during it — so a run that began
      // against the file may need to finish against a live document. Writing the
      // file in that case would be overwritten by the new tab's first save.
      //
      // The cells being mutated are the same objects either way when the pane
      // was already open; this only matters for a pane that appeared mid-run.
      const liveNow = loaded.live ?? resolveOpen?.(path);
      if (liveNow && !loaded.live) {
        // A tab opened mid-run. Its document was parsed from the file as it was
        // BEFORE this run, so copy the executed cells across rather than saving
        // a document the pane is not rendering.
        const target = await liveNow.resolve();
        if (target) target.cells = doc.cells;
      }

      // Persist whatever ran, even on failure — the outputs of the cells that
      // did succeed are the context for fixing the one that did not.
      const failure = await persistNotebook(writer, path, doc, liveNow);
      if (failure) return { content: `Ran ${ran} cell(s) but could not save: ${failure}\n\n${report.join('\n')}`, isError: true };

      const head = failedAt === null
        ? `Ran ${ran} cell(s) in "${path}".`
        : `Ran ${ran} cell(s) in "${path}"; stopped at cell ${failedAt}.`;
      return { content: `${head}\n\n${report.join('\n')}`, isError: failedAt !== null };
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * The tools that only touch the FILE — no kernel, no execution.
 *
 * Registered unconditionally, because `python.enabled` is consent to RUN Python,
 * and reading or editing a `.ipynb` is neither. Gating these too meant the
 * assistant lost the ability to read a notebook that the editor pane opens and
 * edits happily in the same workspace — while `fs_read_file` and
 * `fs_write_file` could still reach the very same file, just clumsily, as raw
 * nbformat JSON. The gate was buying nothing and costing capability.
 */
export function createNotebookFileTools(
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  resolveOpen: OpenNotebookResolver | undefined,
): IChatTool[] {
  return [
    createNotebookCreateTool(fs, writer, resolveOpen),
    createNotebookReadTool(fs),
    createNotebookEditCellTool(fs, writer, resolveOpen),
  ];
}

/** The tool that executes code. This is what `python.enabled` gates. */
export function createNotebookRunTools(
  kernel: INotebookKernelService | undefined,
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  resolveOpen: OpenNotebookResolver | undefined,
): IChatTool[] {
  return [createNotebookRunTool(kernel, fs, writer, resolveOpen)];
}

/** Everything, for callers that do not need the split (and for tests). */
export function createNotebookTools(
  kernel: INotebookKernelService | undefined,
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  resolveOpen: OpenNotebookResolver | undefined,
): IChatTool[] {
  return [
    ...createNotebookFileTools(fs, writer, resolveOpen),
    ...createNotebookRunTools(kernel, fs, writer, resolveOpen),
  ];
}
