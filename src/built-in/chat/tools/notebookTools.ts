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
import type { IBuiltInToolFileSystem, IBuiltInToolFileWriter } from '../chatTypes.js';
import type { IEditorService } from '../../../services/serviceTypes.js';
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
} from '../../editor/notebook/notebookModel.js';
import { outputToText } from '../../editor/notebook/outputRenderer.js';

/** Beyond this, a cell's output is elided before going into the model's context. */
const MAX_OUTPUT_CHARS = 4000;
/** Guard against a notebook whose outputs would swamp a reply. */
const MAX_TOTAL_OUTPUT_CHARS = 20_000;

// ─── Shared plumbing ─────────────────────────────────────────────────────────

function isNotebookPath(p: string): boolean {
  return p.trim().toLowerCase().endsWith('.ipynb');
}

/**
 * Refuse to touch a notebook that is open in an editor.
 *
 * `NotebookEditorInput.resolve()` memoises its document, so a write to disk
 * behind an open pane is invisible to that pane — and the pane's next save
 * silently overwrites whatever was written. Reporting that plainly is better
 * than the two ways it fails otherwise: the assistant's work vanishing, or the
 * user's edits vanishing, both with no error anywhere.
 */
function openEditorConflict(
  editors: IEditorService | undefined,
  relativePath: string,
): string | null {
  if (!editors) return null;

  // Compare on PATH only, never on the tab's display name.
  //
  // `OpenEditorDescriptor.name` is the basename, so matching it refused a write
  // to `archive/analysis.ipynb` whenever an unrelated `2026-01/analysis.ipynb`
  // happened to be open — a wrong refusal with a confidently wrong explanation.
  // Same-named notebooks in dated or per-project folders are the normal case,
  // not an edge one.
  //
  // `description` is the workspace-relative path when the input has one and the
  // absolute fsPath otherwise, so a suffix match on a path BOUNDARY covers both
  // without matching `notes/archive.ipynb` against `archive.ipynb`.
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const target = norm(relativePath);
  const hit = editors.getOpenEditors().find((e) => {
    const desc = norm(e.description || '');
    if (!desc) return false;
    return desc === target || desc.endsWith('/' + target) || target.endsWith('/' + desc);
  });
  if (!hit) return null;
  return `"${relativePath}" is open in an editor, so writing to it from here would be `
    + `overwritten the next time that tab saves. Ask the user to close the tab, then retry.`;
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
  editors: IEditorService | undefined,
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
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!fs || !writer) return { content: 'The workspace filesystem is not available.', isError: true };
      const path = String(args['path'] || '').trim();
      if (!path) return { content: 'path is required', isError: true };
      if (!isNotebookPath(path)) {
        return { content: `Notebook paths must end in .ipynb — got "${path}".`, isError: true };
      }

      const conflict = openEditorConflict(editors, path);
      if (conflict) return { content: conflict, isError: true };

      if (args['overwrite'] !== true && await fs.exists(path)) {
        return {
          content: `"${path}" already exists. Pass overwrite:true to replace it, or edit it with notebook_edit_cell.`,
          isError: true,
        };
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

      const failure = await saveNotebook(writer, path, doc);
      if (failure) return { content: failure, isError: true };

      return { content: `Created "${path}" with ${doc.cells.length} cell(s). Run it with notebook_run.` };
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
    permissionLevel: 'safe' as ToolPermissionLevel,
    category: 'notebook',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!fs) return { content: 'The workspace filesystem is not available.', isError: true };
      const path = String(args['path'] || '').trim();
      if (!path) return { content: 'path is required', isError: true };

      const loaded = await loadNotebook(fs, path);
      if ('error' in loaded) return { content: loaded.error, isError: true };

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
  editors: IEditorService | undefined,
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
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      if (!fs || !writer) return { content: 'The workspace filesystem is not available.', isError: true };
      const path = String(args['path'] || '').trim();
      const operation = String(args['operation'] || '').trim();
      const index = Number(args['index']);
      if (!path) return { content: 'path is required', isError: true };
      if (!Number.isInteger(index) || index < 0) {
        return { content: 'index must be a non-negative integer.', isError: true };
      }

      const conflict = openEditorConflict(editors, path);
      if (conflict) return { content: conflict, isError: true };

      const loaded = await loadNotebook(fs, path);
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

      const failure = await saveNotebook(writer, path, loaded.doc);
      if (failure) return { content: failure, isError: true };
      return { content: `${operation} at cell ${index} — "${path}" now has ${cells.length} cell(s).` };
    },
  };
}

// ─── notebook_run ────────────────────────────────────────────────────────────

export function createNotebookRunTool(
  kernel: INotebookKernelService | undefined,
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  editors: IEditorService | undefined,
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
    async handler(args: Record<string, unknown>, token: ICancellationToken): Promise<IToolResult> {
      const missing = requireAll(kernel, fs);
      if (missing) return { content: missing, isError: true };
      if (!writer) return { content: 'The workspace filesystem is not available.', isError: true };

      const path = String(args['path'] || '').trim();
      if (!path) return { content: 'path is required', isError: true };

      const conflict = openEditorConflict(editors, path);
      if (conflict) return { content: conflict, isError: true };

      const loaded = await loadNotebook(fs!, path);
      if ('error' in loaded) return { content: loaded.error, isError: true };
      const doc = loaded.doc;

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

      for (const i of targets) {
        if (token?.isCancellationRequested) break;
        const cell = doc.cells[i];

        const execution = await kernel!.execute(cell.source);
        if (!execution) {
          return { content: 'Could not start the kernel for this workspace.', isError: true };
        }

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
          for (const s of subs) s.dispose();
          execution.dispose();
        }

        setCellExecutionTiming(cell, result?.startedAtIso ?? null, result?.endedAtIso ?? null);
        ran++;

        const rendered = renderOutputs(cell, MAX_OUTPUT_CHARS);
        report.push(`--- cell ${i} → ${result?.status ?? 'unknown'}${result?.durationMs != null ? ` (${result.durationMs} ms)` : ''} ---`);
        report.push(rendered || '(no output)');

        if (result?.status === 'error') { failedAt = i; break; }
        if (result?.status === 'abort') { failedAt = i; break; }
      }

      // Persist whatever ran, even on failure — the outputs of the cells that
      // did succeed are the context for fixing the one that did not.
      const failure = await saveNotebook(writer, path, doc);
      if (failure) return { content: `Ran ${ran} cell(s) but could not save: ${failure}\n\n${report.join('\n')}`, isError: true };

      const head = failedAt === null
        ? `Ran ${ran} cell(s) in "${path}".`
        : `Ran ${ran} cell(s) in "${path}"; stopped at cell ${failedAt}.`;
      return { content: `${head}\n\n${report.join('\n')}`, isError: failedAt !== null };
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createNotebookTools(
  kernel: INotebookKernelService | undefined,
  fs: IBuiltInToolFileSystem | undefined,
  writer: IBuiltInToolFileWriter | undefined,
  editors: IEditorService | undefined,
): IChatTool[] {
  return [
    createNotebookCreateTool(fs, writer, editors),
    createNotebookReadTool(fs),
    createNotebookEditCellTool(fs, writer, editors),
    createNotebookRunTool(kernel, fs, writer, editors),
  ];
}
