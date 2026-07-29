// notebookModel.test.ts — .ipynb fidelity and ANSI rendering (M96)
//
// The load-bearing property here is ROUND-TRIP FIDELITY. Notebooks are a
// shared format: the same file gets opened in VS Code, JupyterLab, and here.
// A model that parses into typed fields and writes back only those fields
// deletes everything it did not model — widget state, slide directives,
// nbgrader fields, cell tags — and it does so silently, on save, to work
// someone did in another tool. Most of these tests exist to prove that
// does not happen.

import { describe, it, expect } from 'vitest';
import {
  parseNotebook,
  serialiseNotebook,
  splitMultiline,
  joinMultiline,
  mimeText,
  createEmptyNotebook,
  createEmptyCell,
  clearAllOutputs,
  notebookLanguage,
  cellDurationMs,
  setCellExecutionTiming,
  formatDuration,
  NotebookParseError,
} from '../../src/built-in/editor/notebook/notebookModel.js';
import { ansiToHtml, stripAnsi } from '../../src/ui/ansiToHtml.js';

const ESC = String.fromCharCode(27);

// ── Multiline ────────────────────────────────────────────────────────────────

describe('splitMultiline / joinMultiline', () => {
  it('keeps the newline on every line but the last', () => {
    // This is exactly what nbformat writes. Getting it wrong is invisible in
    // the app and produces a whole-file diff the moment the notebook is
    // opened by another tool.
    expect(splitMultiline('a\nb')).toEqual(['a\n', 'b']);
    expect(splitMultiline('a\nb\n')).toEqual(['a\n', 'b\n']);
    expect(splitMultiline('')).toEqual([]);
    expect(splitMultiline('\n')).toEqual(['\n']);
    expect(splitMultiline('single')).toEqual(['single']);
  });

  it('round-trips any text', () => {
    for (const text of ['', 'x', 'a\nb', 'a\nb\n', '\n\n', 'trailing \n', 'a\n\nb']) {
      expect(joinMultiline(splitMultiline(text)), JSON.stringify(text)).toBe(text);
    }
  });

  it('accepts either wire form for the same field', () => {
    expect(joinMultiline(['a\n', 'b'])).toBe('a\nb');
    expect(joinMultiline('a\nb')).toBe('a\nb');
    expect(joinMultiline(null)).toBe('');
    expect(joinMultiline(undefined)).toBe('');
  });
});

// ── Round-trip fidelity ──────────────────────────────────────────────────────

/** A notebook carrying the kind of foreign metadata real files accumulate. */
function realisticNotebook(): Record<string, unknown> {
  return {
    cells: [
      {
        id: 'abc123',
        cell_type: 'code',
        execution_count: 3,
        metadata: {
          tags: ['parameters'],
          'jupyter': { source_hidden: true },
          nbgrader: { grade: true, points: 5 },
        },
        source: ['import pandas as pd\n', 'df = pd.DataFrame()\n'],
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['loading\n', 'done\n'] },
          {
            output_type: 'execute_result',
            execution_count: 3,
            data: { 'text/plain': ['   a  b\n', '0  1  2'], 'text/html': '<table></table>' },
            metadata: { 'application/vnd.custom': { width: 4 } },
          },
        ],
        attachments: { 'img.png': { 'image/png': 'AAAA' } },
      },
      {
        id: 'def456',
        cell_type: 'markdown',
        metadata: { slideshow: { slide_type: 'slide' } },
        source: ['# Heading\n', 'text'],
      },
      { id: 'raw789', cell_type: 'raw', metadata: { format: 'text/latex' }, source: ['\\newpage'] },
    ],
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.13.7', file_extension: '.py' },
      widgets: { 'application/vnd.jupyter.widget-state+json': { state: {}, version_major: 2 } },
      papermill: { parameters: { alpha: 0.5 } },
      authors: [{ name: 'Someone' }],
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

describe('parse → serialise round trip', () => {
  it('preserves notebook metadata this model does not understand', () => {
    const original = realisticNotebook();
    const reparsed = JSON.parse(serialiseNotebook(parseNotebook(JSON.stringify(original))));

    // Widget state and papermill parameters are other tools' data. Dropping
    // them is silent data loss on somebody's work.
    expect(reparsed.metadata.widgets).toEqual(original.metadata['widgets' as never]);
    expect(reparsed.metadata.papermill).toEqual((original.metadata as never)['papermill']);
    expect(reparsed.metadata.authors).toEqual((original.metadata as never)['authors']);
  });

  it('preserves cell metadata and unmodelled cell fields', () => {
    const original = realisticNotebook();
    const reparsed = JSON.parse(serialiseNotebook(parseNotebook(JSON.stringify(original))));

    expect(reparsed.cells[0].metadata.tags).toEqual(['parameters']);
    expect(reparsed.cells[0].metadata.nbgrader).toEqual({ grade: true, points: 5 });
    expect(reparsed.cells[1].metadata.slideshow).toEqual({ slide_type: 'slide' });
    // `attachments` is a real nbformat field this model does not manage.
    expect(reparsed.cells[0].attachments).toEqual({ 'img.png': { 'image/png': 'AAAA' } });
  });

  it('preserves output metadata and non-text MIME payloads', () => {
    const reparsed = JSON.parse(serialiseNotebook(parseNotebook(JSON.stringify(realisticNotebook()))));
    const result = reparsed.cells[0].outputs[1];
    expect(result.metadata).toEqual({ 'application/vnd.custom': { width: 4 } });
    expect(joinMultiline(result.data['text/plain'])).toBe('   a  b\n0  1  2');
  });

  it('preserves cell ids exactly', () => {
    const reparsed = JSON.parse(serialiseNotebook(parseNotebook(JSON.stringify(realisticNotebook()))));
    expect(reparsed.cells.map((c: { id: string }) => c.id)).toEqual(['abc123', 'def456', 'raw789']);
  });

  it('is stable across a second round trip', () => {
    // Idempotence is the practical test: if pass 2 differs from pass 1, every
    // save produces spurious git noise.
    const once = serialiseNotebook(parseNotebook(JSON.stringify(realisticNotebook())));
    const twice = serialiseNotebook(parseNotebook(once));
    expect(twice).toBe(once);
  });

  it('writes text MIME types as line arrays, like nbformat does', () => {
    const reparsed = JSON.parse(serialiseNotebook(parseNotebook(JSON.stringify(realisticNotebook()))));
    expect(Array.isArray(reparsed.cells[0].source)).toBe(true);
    expect(Array.isArray(reparsed.cells[0].outputs[0].text)).toBe(true);
  });

  it('does not chunk base64 image payloads', () => {
    // nbformat permits it, but splitting a 2 MB PNG into 40,000 array elements
    // is hostile to every other tool that opens the file.
    const nb = {
      cells: [{
        id: 'i', cell_type: 'code', execution_count: 1, metadata: {}, source: ['plot()'],
        outputs: [{ output_type: 'display_data', data: { 'image/png': 'QUJD'.repeat(500) }, metadata: {} }],
      }],
      metadata: {}, nbformat: 4, nbformat_minor: 5,
    };
    const reparsed = JSON.parse(serialiseNotebook(parseNotebook(JSON.stringify(nb))));
    expect(typeof reparsed.cells[0].outputs[0].data['image/png']).toBe('string');
  });

  it('ends with a trailing newline, like nbformat', () => {
    expect(serialiseNotebook(createEmptyNotebook()).endsWith('\n')).toBe(true);
  });
});

// ── Parsing edge cases ───────────────────────────────────────────────────────

describe('parseNotebook', () => {
  it('rejects nbformat v3 rather than half-converting it', () => {
    // v3 uses `worksheets` and different output types. A partial conversion
    // that then SAVES is worse than a clean refusal.
    expect(() => parseNotebook(JSON.stringify({ nbformat: 3, worksheets: [] })))
      .toThrow(NotebookParseError);
  });

  it('rejects non-JSON and non-object roots', () => {
    expect(() => parseNotebook('not json')).toThrow(NotebookParseError);
    expect(() => parseNotebook('[]')).toThrow(NotebookParseError);
    expect(() => parseNotebook('42')).toThrow(NotebookParseError);
  });

  it('replaces duplicate cell ids so cells stay distinguishable', () => {
    const doc = parseNotebook(JSON.stringify({
      cells: [
        { id: 'same', cell_type: 'code', source: ['a'], metadata: {}, outputs: [] },
        { id: 'same', cell_type: 'code', source: ['b'], metadata: {}, outputs: [] },
      ],
      metadata: {}, nbformat: 4, nbformat_minor: 5,
    }));
    expect(doc.cells[0].id).not.toBe(doc.cells[1].id);
  });

  it('generates ids for cells that lack or malform them', () => {
    const doc = parseNotebook(JSON.stringify({
      cells: [
        { cell_type: 'code', source: [], metadata: {}, outputs: [] },
        { id: 'has spaces and !!', cell_type: 'code', source: [], metadata: {}, outputs: [] },
      ],
      metadata: {}, nbformat: 4, nbformat_minor: 5,
    }));
    for (const cell of doc.cells) {
      expect(cell.id).toMatch(/^[a-zA-Z0-9\-_]{1,64}$/);
    }
  });

  it('treats an unknown cell_type as code rather than dropping the cell', () => {
    const doc = parseNotebook(JSON.stringify({
      cells: [{ cell_type: 'weird', source: ['x'], metadata: {} }],
      metadata: {}, nbformat: 4, nbformat_minor: 5,
    }));
    expect(doc.cells).toHaveLength(1);
    expect(doc.cells[0].source).toBe('x');
  });

  it('never carries outputs or execution counts on non-code cells', () => {
    const doc = parseNotebook(JSON.stringify({
      cells: [{
        id: 'm', cell_type: 'markdown', source: ['# hi'], metadata: {},
        execution_count: 4,
        outputs: [{ output_type: 'stream', name: 'stdout', text: 'nope' }],
      }],
      metadata: {}, nbformat: 4, nbformat_minor: 5,
    }));
    expect(doc.cells[0].outputs).toEqual([]);
    expect(doc.cells[0].executionCount).toBeNull();
    // …and they must not reappear on save.
    const written = JSON.parse(serialiseNotebook(doc));
    expect(written.cells[0].outputs).toBeUndefined();
    expect(written.cells[0].execution_count).toBeUndefined();
  });

  it('drops output types outside the schema instead of guessing', () => {
    const doc = parseNotebook(JSON.stringify({
      cells: [{
        id: 'c', cell_type: 'code', source: [], metadata: {},
        outputs: [{ output_type: 'from_the_future', payload: 1 }, { output_type: 'stream', name: 'stdout', text: 'ok' }],
      }],
      metadata: {}, nbformat: 4, nbformat_minor: 5,
    }));
    expect(doc.cells[0].outputs).toHaveLength(1);
  });

  it('survives a notebook with no cells', () => {
    const doc = parseNotebook(JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }));
    expect(doc.cells).toEqual([]);
    expect(() => serialiseNotebook(doc)).not.toThrow();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

describe('document helpers', () => {
  it('creates a notebook other tools will recognise', () => {
    const doc = createEmptyNotebook();
    expect(doc.nbformat).toBe(4);
    expect(doc.nbformatMinor).toBeGreaterThanOrEqual(5);
    expect((doc.metadata['kernelspec'] as Record<string, unknown>)['name']).toBe('python3');
    expect(doc.cells).toHaveLength(1);
  });

  it('gives every new cell a distinct id', () => {
    const ids = new Set(Array.from({ length: 200 }, () => createEmptyCell().id));
    expect(ids.size).toBe(200);
  });

  it('clears outputs and execution counts, leaving source alone', () => {
    const doc = parseNotebook(JSON.stringify(realisticNotebook()));
    clearAllOutputs(doc);
    expect(doc.cells[0].outputs).toEqual([]);
    expect(doc.cells[0].executionCount).toBeNull();
    expect(doc.cells[0].source).toContain('import pandas');
  });

  it('reads the language from language_info, then kernelspec, then falls back', () => {
    expect(notebookLanguage(parseNotebook(JSON.stringify(realisticNotebook())))).toBe('python');
    expect(notebookLanguage({
      cells: [], nbformat: 4, nbformatMinor: 5, unknownFields: {},
      metadata: { kernelspec: { language: 'julia' } },
    })).toBe('julia');
    expect(notebookLanguage({
      cells: [], nbformat: 4, nbformatMinor: 5, unknownFields: {}, metadata: {},
    })).toBe('python');
  });

  it('reads text MIME entries in either wire form, and refuses non-text', () => {
    expect(mimeText({ 'text/plain': ['a\n', 'b'] }, 'text/plain')).toBe('a\nb');
    expect(mimeText({ 'text/plain': 'ab' }, 'text/plain')).toBe('ab');
    expect(mimeText({ 'application/json': { a: 1 } }, 'application/json')).toBeUndefined();
    expect(mimeText({}, 'text/plain')).toBeUndefined();
  });
});

// ── ANSI ─────────────────────────────────────────────────────────────────────

describe('ansiToHtml', () => {
  it('colours a real IPython traceback fragment', () => {
    // Captured verbatim from ipykernel 7.3.0 raising ZeroDivisionError.
    const traceback = `${ESC}[31m---------${ESC}[39m\n${ESC}[31mZeroDivisionError${ESC}[39m: division by zero`;
    const html = ansiToHtml(traceback);
    expect(html).toContain('var(--px-danger)');
    expect(html).toContain('ZeroDivisionError');
    expect(html).not.toContain(ESC);
  });

  it('leaves text that merely looks like an escape alone', () => {
    // `arr[31m]` is real Python. An unanchored matcher eats it.
    const plain = 'arr[31m] and x[0] and [39m';
    expect(ansiToHtml(plain)).toBe('arr[31m] and x[0] and [39m');
    expect(stripAnsi(plain)).toBe(plain);
  });

  it('escapes HTML in the payload', () => {
    // evalue carries arbitrary user data — a KeyError on '<img onerror=…>' is
    // an ordinary thing to hit.
    const html = ansiToHtml(`KeyError: <img onerror="alert(1)">`);
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&quot;');
  });

  it('escapes HTML inside a coloured span too', () => {
    const html = ansiToHtml(`${ESC}[31m<script>x</script>${ESC}[39m`);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('consumes 256-colour and truecolour arguments', () => {
    // The classic bug: 38;5;1 leaves "1" in the stream and it re-reads as bold.
    const html = ansiToHtml(`${ESC}[38;5;1mred${ESC}[0m`);
    expect(html).toContain('var(--px-danger)');
    expect(html).not.toContain('font-weight');

    const tc = ansiToHtml(`${ESC}[38;2;10;20;30mx${ESC}[0m`);
    expect(tc).toContain('rgb(10, 20, 30)');
    expect(tc).not.toContain('font-weight');
  });

  it('treats a bare reset as a reset', () => {
    const html = ansiToHtml(`${ESC}[31ma${ESC}[mb`);
    expect(html).toContain('>a<');
    expect(html.endsWith('b')).toBe(true);
  });

  it('honours attribute-off codes', () => {
    expect(ansiToHtml(`${ESC}[1mbold${ESC}[22mplain`)).toMatch(/font-weight:600">bold<\/span>plain$/);
  });

  it('swallows non-SGR sequences without emitting them', () => {
    const withCsi = `${ESC}[2Ka${ESC}[1;1Hb`;
    expect(ansiToHtml(withCsi)).toBe('ab');
    const withOsc = `${ESC}]0;window titletext`;
    expect(ansiToHtml(withOsc)).toBe('text');
  });

  it('is safe on empty and escape-only input', () => {
    expect(ansiToHtml('')).toBe('');
    expect(ansiToHtml(`${ESC}[31m`)).toBe('');
    expect(stripAnsi('')).toBe('');
  });

  it('stripAnsi and ansiToHtml agree on visible text', () => {
    const sample = `${ESC}[1;31mError${ESC}[0m: ${ESC}[33mfile.py${ESC}[39m line 3`;
    const stripped = stripAnsi(sample);
    const textFromHtml = ansiToHtml(sample).replace(/<[^>]+>/g, '');
    expect(textFromHtml).toBe(stripped);
  });
});

// ── Execution timing (M96 follow-up) ─────────────────────────────────────────
//
// Timing is stored in `metadata.execution`, which is JupyterLab's convention
// rather than an invention: ISO timestamps keyed by the protocol message they
// came from. Using the same shape means a duration recorded here shows up in
// JupyterLab, and one recorded there shows up here.

describe('cell execution timing', () => {
  function codeCell(metadata: Record<string, unknown> = {}) {
    const cell = createEmptyCell('code');
    cell.metadata = metadata;
    return cell;
  }

  it('reads a duration written in JupyterLab’s shape', () => {
    const cell = codeCell({
      execution: {
        'iopub.execute_input': '2026-07-29T10:00:00.000Z',
        'shell.execute_reply': '2026-07-29T10:00:01.500Z',
      },
    });
    expect(cellDurationMs(cell)).toBe(1500);
  });

  it('returns null when a notebook records no timing', () => {
    // Entirely normal — plenty of tools never write the block.
    expect(cellDurationMs(codeCell())).toBeNull();
    expect(cellDurationMs(codeCell({ execution: {} }))).toBeNull();
    expect(cellDurationMs(codeCell({ execution: 'nonsense' }))).toBeNull();
    expect(cellDurationMs(codeCell({ execution: { 'iopub.execute_input': 'not-a-date', 'shell.execute_reply': 'x' } }))).toBeNull();
  });

  it('returns null rather than a negative duration', () => {
    // A clock adjustment mid-run; showing "-3s" is worse than showing nothing.
    const cell = codeCell({
      execution: {
        'iopub.execute_input': '2026-07-29T10:00:05.000Z',
        'shell.execute_reply': '2026-07-29T10:00:01.000Z',
      },
    });
    expect(cellDurationMs(cell)).toBeNull();
  });

  it('round-trips timing through save and reload', () => {
    const doc = createEmptyNotebook();
    setCellExecutionTiming(doc.cells[0], '2026-07-29T10:00:00.000Z', '2026-07-29T10:00:02.250Z');
    const reloaded = parseNotebook(serialiseNotebook(doc));
    expect(cellDurationMs(reloaded.cells[0])).toBe(2250);
  });

  it('preserves sibling keys another tool wrote in the same block', () => {
    // Consistent with the unknown-field policy everywhere else in this model.
    const cell = codeCell({
      execution: {
        'shell.execute_reply.started': '2026-07-29T09:59:59.000Z',
        'iopub.status.busy': '2026-07-29T09:59:59.500Z',
      },
    });
    setCellExecutionTiming(cell, '2026-07-29T10:00:00.000Z', '2026-07-29T10:00:01.000Z');
    const block = cell.metadata['execution'] as Record<string, unknown>;
    expect(block['shell.execute_reply.started']).toBe('2026-07-29T09:59:59.000Z');
    expect(block['iopub.status.busy']).toBe('2026-07-29T09:59:59.500Z');
    expect(cellDurationMs(cell)).toBe(1000);
  });

  it('clearing timing removes the block entirely', () => {
    const cell = codeCell();
    setCellExecutionTiming(cell, '2026-07-29T10:00:00.000Z', '2026-07-29T10:00:01.000Z');
    expect(cell.metadata['execution']).toBeDefined();
    setCellExecutionTiming(cell, null, null);
    expect(cell.metadata['execution']).toBeUndefined();
    expect(cellDurationMs(cell)).toBeNull();
  });

  it('does not write a block for a run the kernel never started', () => {
    // Aborted while queued — there is no duration to report.
    const cell = codeCell();
    setCellExecutionTiming(cell, null, '2026-07-29T10:00:01.000Z');
    expect(cell.metadata['execution']).toBeUndefined();
  });
});

describe('formatDuration', () => {
  it('uses units a human reads at a glance', () => {
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(340)).toBe('340ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(9900)).toBe('9.9s');
    // Past ten seconds the decimal is noise.
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(65_000)).toBe('1m 05s');
    expect(formatDuration(3_600_000)).toBe('1h 00m');
  });

  it('zero-pads the seconds so the width does not jitter while ticking', () => {
    expect(formatDuration(61_000)).toBe('1m 01s');
    expect(formatDuration(70_000)).toBe('1m 10s');
  });
});
