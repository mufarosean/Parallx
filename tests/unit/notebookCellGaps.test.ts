// @vitest-environment jsdom
//
// notebookCellGaps.test.ts — the between-cell insert strip and the Generate bar,
// driven through the REAL pane with the REAL CodeMirror editors.
//
// Not a DOM-shape snapshot: every assertion is about behaviour that has a wrong
// answer. The insert strip's whole point is putting a cell at a specific index,
// and "insert below cell 2" is the kind of off-by-one that looks fine in a
// screenshot of a two-cell notebook and is wrong everywhere else. Generate is
// tested against a scripted stream because the failure modes are all about
// partial input: a fence marker split across chunks, a cancel mid-stream, no
// model configured.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NotebookEditorPane } from '../../src/editor/panes/notebook/notebookEditorPane.js';
import { NotebookEditorInput } from '../../src/editor/panes/notebook/notebookEditorInput.js';
import { URI } from '../../src/platform/uri.js';
import type { IFileService } from '../../src/services/serviceTypes.js';
import type { IChatResponseChunk } from '../../src/services/chatTypes.js';
import { createEmptyCell, type NotebookCell } from '../../src/editor/panes/notebook/notebookModel.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function notebookJson(sources: readonly string[]): string {
  return JSON.stringify({
    nbformat: 4,
    nbformat_minor: 5,
    metadata: { kernelspec: { name: 'python3', language: 'python' } },
    cells: sources.map((source) => ({
      cell_type: 'code',
      source: source.split('\n').map((l, i, a) => (i === a.length - 1 ? l : l + '\n')),
      metadata: {},
      outputs: [],
      execution_count: null,
    })),
  });
}

function fileServiceFor(content: string): IFileService {
  return {
    readFile: async () => ({ content, encoding: 'utf-8' }),
    writeFile: async () => undefined,
    showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
  } as unknown as IFileService;
}

/** Emit `text` in small chunks, so fence markers land across boundaries. */
function scriptedStream(text: string, chunkSize = 3) {
  return async function* (): AsyncIterable<IChatResponseChunk> {
    for (let i = 0; i < text.length; i += chunkSize) {
      yield { content: text.slice(i, i + chunkSize), done: false };
    }
    yield { content: '', done: true };
  };
}

interface Harness {
  readonly pane: NotebookEditorPane;
  readonly root: HTMLElement;
  readonly gaps: () => HTMLElement[];
  readonly cellSources: () => string[];
  readonly gapButton: (gapIndex: number, label: string) => HTMLButtonElement;
}

let created: NotebookEditorPane[] = [];
let containers: HTMLElement[] = [];

async function mount(
  sources: readonly string[],
  provider?: () => Promise<{ sendChatRequest: (...a: never[]) => AsyncIterable<IChatResponseChunk> } | undefined>,
): Promise<Harness> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  containers.push(container);

  const input = NotebookEditorInput.create(
    URI.parse('file:///work/ws/analysis.ipynb'),
    fileServiceFor(notebookJson(sources)),
    'analysis.ipynb',
  );

  // No kernel: cell execution is not what this file tests, and the pane's
  // no-kernel path is a banner rather than an error.
  const pane = new NotebookEditorPane(undefined, provider as never);
  created.push(pane);
  pane.create(container);
  await pane.setInput(input);

  const root = container.querySelector<HTMLElement>('.nb-cells')!;
  return {
    pane,
    root,
    input,
    gaps: () => [...root.querySelectorAll<HTMLElement>('.nb-gap')],
    cellSources: () => input.document!.cells.map((c) => c.source),
    /** What the DOM actually shows, as opposed to what the document holds. */
    renderedSources: () => [...root.querySelectorAll<HTMLElement>('.nb-cell')]
      .map((el) => el.querySelector('.cm-content')?.textContent ?? ''),
    gapButton: (gapIndex, label) => {
      const gap = [...root.querySelectorAll<HTMLElement>('.nb-gap')][gapIndex];
      const btn = [...gap.querySelectorAll<HTMLButtonElement>('.nb-gap__btn')]
        .find((b) => b.textContent?.includes(label));
      if (!btn) throw new Error(`no "${label}" button in gap ${gapIndex}`);
      return btn;
    },
  };
}

beforeEach(() => { created = []; containers = []; });
afterEach(() => {
  for (const pane of created) pane.dispose();
  for (const c of containers) c.remove();
  vi.restoreAllMocks();
});

// ── Insert strip ─────────────────────────────────────────────────────────────

describe('between-cell insert strip', () => {
  it('offers one strip above the first cell and one below every cell', async () => {
    const h = await mount(['a = 1', 'b = 2', 'c = 3']);
    // 3 cells → 4 places a cell can go.
    expect(h.gaps()).toHaveLength(4);
  });

  it('marks the head strip so its hairline can be aligned to the others', async () => {
    const h = await mount(['a = 1']);
    expect(h.gaps()[0].classList.contains('nb-gap--head')).toBe(true);
    expect(h.gaps()[1].classList.contains('nb-gap--head')).toBe(false);
  });

  it('carries the strip inside the cell it sits below, so it moves with it', async () => {
    // The ownership decision. A strip interleaved as a sibling would be left
    // behind by every insertBefore/remove in the pane.
    const h = await mount(['a = 1', 'b = 2']);
    const cells = [...h.root.querySelectorAll<HTMLElement>('.nb-cell')];
    for (const cell of cells) {
      expect(cell.querySelector(':scope > .nb-gap')).not.toBeNull();
    }
  });

  it('shows exactly Code, Markdown and Generate', async () => {
    const h = await mount(['a = 1']);
    const labels = [...h.gaps()[0].querySelectorAll('.nb-gap__btn')].map((b) => b.textContent?.trim());
    expect(labels).toEqual(['Code', 'Markdown', 'Generate']);
  });

  it('keeps the buttons out of the tab order until hovered', async () => {
    // `visibility: hidden` rather than `opacity: 0`: three invisible tab stops
    // between every pair of cells would make Tab useless in a long notebook.
    // jsdom has no layout, so assert the class contract the CSS keys off.
    const h = await mount(['a = 1']);
    const actions = h.gaps()[0].querySelector('.nb-gap__actions');
    expect(actions).not.toBeNull();
    expect(actions!.className).toBe('nb-gap__actions');
  });

  it('the head strip inserts at index 0, not at the end', async () => {
    const h = await mount(['a = 1', 'b = 2']);
    h.gapButton(0, 'Code').click();
    expect(h.cellSources()).toEqual(['', 'a = 1', 'b = 2']);
  });

  it('a middle strip inserts directly below its own cell', async () => {
    // THE off-by-one. Gap 1 belongs to cell "a"; its insert must land between
    // "a" and "b", not after "b" and not before "a".
    const h = await mount(['a = 1', 'b = 2', 'c = 3']);
    h.gapButton(1, 'Code').click();
    expect(h.cellSources()).toEqual(['a = 1', '', 'b = 2', 'c = 3']);
  });

  it('the last strip appends', async () => {
    const h = await mount(['a = 1', 'b = 2']);
    h.gapButton(2, 'Code').click();
    expect(h.cellSources()).toEqual(['a = 1', 'b = 2', '']);
  });

  it('inserts a markdown cell when asked for one', async () => {
    const h = await mount(['a = 1']);
    h.gapButton(1, 'Markdown').click();
    const cells = [...h.root.querySelectorAll('.nb-cell')];
    expect(cells).toHaveLength(2);
    expect(cells[1].classList.contains('nb-cell--markdown')).toBe(true);
  });

  it('keeps inserting correctly after a reorder', async () => {
    // Strips resolve their index from the document at click time, so moving a
    // cell must not leave a strip pointing at the old position.
    const h = await mount(['a = 1', 'b = 2']);
    // Indexed off the query result, NOT `:nth-of-type(2)`: the head strip is
    // also a <div>, so nth-of-type counts it and selects the first cell.
    const cellB = [...h.root.querySelectorAll<HTMLElement>('.nb-cell')][1];
    const upBtn = [...cellB.querySelectorAll<HTMLButtonElement>('.nb-cell__action')]
      .find((b) => b.textContent === '↑')!;
    upBtn.click();
    expect(h.cellSources()).toEqual(['b = 2', 'a = 1']);

    // The strip inside the cell whose source is 'b = 2' must still insert after it.
    const bRoot = [...h.root.querySelectorAll<HTMLElement>('.nb-cell')]
      .find((el) => el.textContent?.includes('b = 2'))!;
    bRoot.querySelector<HTMLButtonElement>(':scope > .nb-gap .nb-gap__btn')!.click();
    expect(h.cellSources()).toEqual(['b = 2', '', 'a = 1']);
  });

  it('a new cell brings its own strip, so the count stays cells + 1', async () => {
    const h = await mount(['a = 1']);
    h.gapButton(1, 'Code').click();
    expect(h.gaps()).toHaveLength(3);
  });

  it('deleting a cell takes its strip with it', async () => {
    const h = await mount(['a = 1', 'b = 2']);
    const del = [...h.root.querySelectorAll<HTMLButtonElement>('.nb-cell__action')]
      .find((b) => b.textContent === '✕')!;
    del.click();
    expect(h.gaps()).toHaveLength(2);
  });
});

// ── Generate ─────────────────────────────────────────────────────────────────

describe('Generate', () => {
  const withProvider = (text: string) => {
    const send = vi.fn(scriptedStream(text));
    return { send, resolve: async () => ({ sendChatRequest: send }) };
  };

  async function openPrompt(h: Harness, gapIndex: number): Promise<HTMLElement> {
    h.gapButton(gapIndex, 'Generate').click();
    const bar = h.root.querySelector<HTMLElement>('.nb-generate');
    expect(bar, 'clicking Generate should mount the prompt bar').not.toBeNull();
    return bar!;
  }

  /** Type into the bar and press Enter, then let the scripted stream drain. */
  async function submit(bar: HTMLElement, text: string): Promise<void> {
    const input = bar.querySelector<HTMLInputElement>('.nb-generate__input')!;
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    // Streaming + one rAF flush.
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    await new Promise((r) => setTimeout(r, 0));
  }

  it('creates the cell where the strip was, before asking anything', async () => {
    // The prompt has to appear in the place the code will land — that is why the
    // user clicked that particular strip.
    const p = withProvider('x = 1');
    const h = await mount(['a = 1', 'b = 2'], p.resolve);
    await openPrompt(h, 1);
    expect(h.cellSources()).toEqual(['a = 1', '', 'b = 2']);
    const cells = [...h.root.querySelectorAll<HTMLElement>('.nb-cell')];
    expect(cells[1].querySelector('.nb-generate')).not.toBeNull();
  });

  it('streams the reply into the cell', async () => {
    const p = withProvider('df = pd.read_csv("sales.csv")');
    const h = await mount(['import pandas as pd'], p.resolve);
    const bar = await openPrompt(h, 1);
    await submit(bar, 'read the sales csv');
    expect(h.cellSources()[1]).toBe('df = pd.read_csv("sales.csv")');
  });

  it('strips fences that arrive split across chunks', async () => {
    // chunkSize 3 puts a boundary inside ``` — the reason stripCodeFences runs
    // over the whole buffer rather than per chunk.
    const p = withProvider('Here you go:\n```python\nx = 1\ny = 2\n```\nDone.');
    const h = await mount(['a = 1'], p.resolve);
    const bar = await openPrompt(h, 1);
    await submit(bar, 'two variables');
    expect(h.cellSources()[1]).toBe('x = 1\ny = 2');
  });

  it('takes the bar down on success and leaves the code', async () => {
    const p = withProvider('x = 1');
    const h = await mount(['a = 1'], p.resolve);
    const bar = await openPrompt(h, 1);
    await submit(bar, 'one variable');
    expect(h.root.querySelector('.nb-generate')).toBeNull();
    expect(h.cellSources()[1]).toBe('x = 1');
  });

  it('sends the preceding cells as context, and not the target cell', async () => {
    const p = withProvider('x = 1');
    const h = await mount(['ABOVE_MARKER = 1', 'BELOW_MARKER = 2'], p.resolve);
    const bar = await openPrompt(h, 1);
    await submit(bar, 'do the thing');

    expect(p.send).toHaveBeenCalledOnce();
    const messages = p.send.mock.calls[0][0] as ReadonlyArray<{ role: string; content: string }>;
    const joined = messages.map((m) => m.content).join('\n');
    expect(joined).toContain('ABOVE_MARKER');
    // The cell below has not run in the kernel, so it is not state the model can rely on.
    expect(joined).not.toContain('BELOW_MARKER');
  });

  it('says so when no model is available, and keeps the prompt for a retry', async () => {
    const h = await mount(['a = 1'], async () => undefined);
    const bar = await openPrompt(h, 1);
    await submit(bar, 'anything');
    expect(h.root.querySelector('.nb-generate')).not.toBeNull();
    const status = bar.querySelector('.nb-generate__status')!;
    expect(status.textContent).toMatch(/no language model/i);
    expect(status.classList.contains('nb-generate__status--error')).toBe(true);
    expect(bar.querySelector<HTMLInputElement>('.nb-generate__input')!.disabled).toBe(false);
  });

  it('reports a provider error instead of leaving the cell blank and silent', async () => {
    const send = vi.fn(async function* (): AsyncIterable<IChatResponseChunk> {
      throw new Error('model not loaded');
    });
    const h = await mount(['a = 1'], async () => ({ sendChatRequest: send }));
    const bar = await openPrompt(h, 1);
    await submit(bar, 'anything');
    expect(bar.querySelector('.nb-generate__status')!.textContent).toBe('model not loaded');
  });

  it('Escape removes the bar and the empty cell it created', async () => {
    const p = withProvider('x = 1');
    const h = await mount(['a = 1'], p.resolve);
    const bar = await openPrompt(h, 1);
    expect(h.cellSources()).toHaveLength(2);

    bar.querySelector<HTMLInputElement>('.nb-generate__input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(h.root.querySelector('.nb-generate')).toBeNull();
    expect(h.cellSources()).toEqual(['a = 1']);
  });

  it('Escape keeps a cell that already has code in it', async () => {
    const p = withProvider('x = 1');
    const h = await mount(['a = 1'], p.resolve);
    const bar = await openPrompt(h, 1);
    await submit(bar, 'one variable');
    // Re-open on the now-populated cell and cancel.
    const cell = [...h.root.querySelectorAll<HTMLElement>('.nb-cell')][1];
    cell.querySelector<HTMLButtonElement>('.nb-cell__action')!.click();  // ✦ is first for code cells
    const bar2 = h.root.querySelector<HTMLElement>('.nb-generate')!;
    bar2.querySelector<HTMLInputElement>('.nb-generate__input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.cellSources()).toEqual(['a = 1', 'x = 1']);
  });

  it('does not send an empty instruction', async () => {
    const p = withProvider('x = 1');
    const h = await mount(['a = 1'], p.resolve);
    const bar = await openPrompt(h, 1);
    await submit(bar, '   ');
    expect(p.send).not.toHaveBeenCalled();
    expect(h.root.querySelector('.nb-generate')).not.toBeNull();
  });

  it('frames an existing cell as a rewrite', async () => {
    const p = withProvider('df.plot(kind="bar")');
    const h = await mount(['df.plot(kind="line")'], p.resolve);
    // ✦ on the first (code) cell.
    const cell = h.root.querySelector<HTMLElement>('.nb-cell')!;
    cell.querySelector<HTMLButtonElement>('.nb-cell__action')!.click();
    const bar = h.root.querySelector<HTMLElement>('.nb-generate')!;
    await submit(bar, 'use a bar chart');

    const messages = p.send.mock.calls[0][0] as ReadonlyArray<{ content: string }>;
    expect(messages[messages.length - 1].content).toContain('Rewrite this cell');
    expect(h.cellSources()).toEqual(['df.plot(kind="bar")']);
  });

  it('re-opening the prompt on the same cell focuses it instead of stacking bars', async () => {
    const p = withProvider('x = 1');
    const h = await mount(['a = 1'], p.resolve);
    const cell = h.root.querySelector<HTMLElement>('.nb-cell')!;
    cell.querySelector<HTMLButtonElement>('.nb-cell__action')!.click();   // ✦
    cell.querySelector<HTMLButtonElement>('.nb-cell__action')!.click();   // ✦ again
    expect(h.root.querySelectorAll('.nb-generate')).toHaveLength(1);
  });

  it('opening a prompt elsewhere retires the previous one', async () => {
    // There is one generation slot, so a second stream aborts the first. Two
    // bars on screen left the abandoned one stuck on "Writing…" beside a
    // half-written cell with nothing saying it had been dropped.
    const p = withProvider('x = 1');
    const h = await mount(['a = 1', 'b = 2'], p.resolve);
    await openPrompt(h, 1);                      // new cell between a and b
    expect(h.cellSources()).toEqual(['a = 1', '', 'b = 2']);

    h.gapButton(0, 'Generate').click();          // now one above 'a'
    expect(h.root.querySelectorAll('.nb-generate')).toHaveLength(1);
    // The abandoned empty cell went with its bar.
    expect(h.cellSources()).toEqual(['', 'a = 1', 'b = 2']);
  });

  it('marks the notebook dirty so generated code cannot be lost on close', async () => {
    const p = withProvider('x = 1');
    const h = await mount(['a = 1'], p.resolve);
    const bar = await openPrompt(h, 1);
    await submit(bar, 'one variable');
    // setValueAsEdit (not setValue) is what routes generated text through the
    // normal change path; setValue suppresses it and the tab would stay clean.
    expect(h.cellSources()[1]).toBe('x = 1');
  });

  it('offers Generate on the toolbar as well as in the strips', async () => {
    const h = await mount(['a = 1']);
    const labels = [...document.querySelectorAll('.nb-toolbar .nb-btn')].map((b) => b.textContent?.trim());
    expect(labels).toContain('Generate');
  });

  it('stops writing into the cell once the pane is disposed mid-stream', async () => {
    // Closing the tab while a model is still streaming. The pane is destroyed on
    // an ordinary tab switch, so this is not an edge case — and a write after
    // dispose goes into a detached editor, so the user sees a truncated cell in
    // the reopened tab with no idea why.
    // Gated rather than timed: a sleep in the generator races the test's own
    // waits, and the first version of this test drained the whole stream before
    // it got to dispose().
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const send = vi.fn(async function* (): AsyncIterable<IChatResponseChunk> {
      yield { content: 'x = ', done: false };
      await gate;
      yield { content: '1\ny = 2', done: true };
    });

    const h = await mount(['a = 1'], async () => ({ sendChatRequest: send }));
    const bar = await openPrompt(h, 1);
    const input = bar.querySelector<HTMLInputElement>('.nb-generate__input')!;
    input.value = 'go';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    // Let the first chunk land and its throttled flush paint.
    for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    // Partial, with its trailing space intact: only blank LINES are trimmed, so
    // the text does not jitter as the next token arrives.
    expect(h.cellSources()[1]).toBe('x = ');

    h.pane.dispose();
    release();
    await new Promise((r) => setTimeout(r, 30));
    // Nothing arrived after dispose, and nothing threw.
    expect(h.cellSources()[1]).toBe('x = ');
  });
});

// ── Repainting on someone else's edit ────────────────────────────────────────
//
// The pane and the assistant's notebook_* tools now mutate the SAME document —
// one writer per notebook. That makes the data correct here for free, and makes
// the VIEW the thing that has to catch up. It did not: the input fired
// onDidChangeDocument and the pane had no subscriber, so an assistant edit was
// invisible until you switched tabs and back.

describe('external document changes repaint the pane', () => {
  /** What the assistant's tools do: mutate the live doc, then mark it dirty. */
  const externallyEdit = (h: { input: NotebookEditorInput }, mutate: (cells: NotebookCell[]) => void) => {
    mutate(h.input.document!.cells);
    h.input.markDirty(true);
  };

  it('shows a cell the assistant appended', async () => {
    const h = await mount(['a = 1']);
    expect(h.renderedSources()).toHaveLength(1);

    externallyEdit(h, (cells) => {
      const c = createEmptyCell('code');
      c.source = 'b = 2';
      cells.push(c);
    });

    expect(h.renderedSources()).toHaveLength(2);
    expect(h.renderedSources()[1]).toContain('b = 2');
  });

  it('shows a source change the assistant made', async () => {
    const h = await mount(['original']);
    externallyEdit(h, (cells) => { cells[0].source = 'rewritten by the assistant'; });
    expect(h.renderedSources()[0]).toContain('rewritten by the assistant');
  });

  it('shows outputs the assistant produced by running a cell', async () => {
    const h = await mount(['print("hi")']);
    externallyEdit(h, (cells) => {
      cells[0].outputs = [{ outputType: 'stream', name: 'stdout', text: 'hi\n' } as never];
      cells[0].executionCount = 1;
    });
    expect(h.root.textContent).toContain('hi');
  });

  it('drops a cell the assistant deleted', async () => {
    const h = await mount(['a = 1', 'b = 2']);
    externallyEdit(h, (cells) => { cells.splice(0, 1); });
    expect(h.renderedSources()).toHaveLength(1);
    expect(h.renderedSources()[0]).toContain('b = 2');
  });

  it('keeps the selection when that cell survives', async () => {
    // An edit elsewhere in the notebook must not move the user.
    const h = await mount(['a = 1', 'b = 2', 'c = 3']);
    const second = [...h.root.querySelectorAll<HTMLElement>('.nb-cell')][1];
    second.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    externallyEdit(h, (cells) => { cells[0].source = 'changed'; });

    const selected = h.root.querySelector('.nb-cell--selected');
    expect(selected?.textContent).toContain('b = 2');
  });

  it('does NOT rebuild on the pane\'s own edits', async () => {
    // The pane marks its own structural edits dirty too. Rebuilding on those
    // would tear down every cell view out from under the caret the moment you
    // inserted a cell — so the pane guards against its own signal.
    const h = await mount(['a = 1']);
    const before = h.root.querySelector('.nb-cell');
    h.gapButton(1, 'Code').click();

    // The original cell's DOM node survived — it was not rebuilt from scratch.
    expect(h.root.querySelector('.nb-cell')).toBe(before);
    expect(h.cellSources()).toEqual(['a = 1', '']);
  });
});
