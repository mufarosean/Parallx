// @vitest-environment jsdom
//
// citationReveal.test.ts — a citation link opens its file AT the cited spot.
//
// The old path dispatched a window event 100 ms after the editor opened: a
// PDF still loading ignored the page, and a later view-state restore could
// scroll away from it. Now the request waits in fileReveal.ts and the pane
// takes it when the group says it is shown, laid out and restored. The
// spreadsheet viewer labels rows and columns the way the workbook does, so
// a cited "C6" is the C6 on screen.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EditorGroupView } from '../../src/editor/editorGroupView';
import { PlaceholderEditorInput } from '../../src/editor/editorInput';
import { EditorPane, type EditorPaneViewState } from '../../src/editor/editorPane';
import { requestFileReveal, _clearFileRevealsForTest } from '../../src/editor/fileReveal';
import { ExcelEditorPane } from '../../src/editor/panes/excelEditorPane';
import { ExcelEditorInput } from '../../src/editor/panes/excelEditorInput';
import { TextEditorPane } from '../../src/editor/panes/textEditorPane';
import { UntitledEditorInput } from '../../src/editor/panes/untitledEditorInput';
import { URI } from '../../src/platform/uri';
import { markParallxLinks, setChatLinkChecker } from '../../src/built-in/chat/rendering/chatContentParts';
import { CodeEditor } from '../../src/ui/codeEditor';

Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => { /* noop */ });
const settle = () => new Promise((r) => setTimeout(r, 0));

// ── The group tells a pane when it is shown ─────────────────────────────────

class OrderPane extends EditorPane {
  static log: string[] = [];
  static retain = true;
  override get retainOnHide(): boolean { return OrderPane.retain; }
  protected override createPaneContent(): void { /* empty */ }
  protected override async renderInput(input: { name: string }): Promise<void> { OrderPane.log.push(`render ${input.name}`); }
  protected override savePaneViewState(): EditorPaneViewState { return { scrollTop: 5 }; }
  protected override restorePaneViewState(): void { OrderPane.log.push(`restore ${this.input?.name}`); }
  protected override onDidShow(): void { OrderPane.log.push(`shown ${this.input?.name}`); }
}

describe('editor group: didShow', () => {
  beforeEach(() => { OrderPane.log = []; OrderPane.retain = true; });

  it('comes after the view-state restore, so a citation reveal is not scrolled away', async () => {
    OrderPane.retain = false; // rebuilt on return, with its saved view state
    const group = new EditorGroupView(undefined, () => new OrderPane());
    document.body.appendChild(group.element);
    const a = new PlaceholderEditorInput('A');
    const b = new PlaceholderEditorInput('B');
    await group.openEditor(a, { pinned: true }); await settle();
    await group.openEditor(b, { pinned: true }); await settle();
    OrderPane.log = [];
    await group.openEditor(a, { pinned: true }); await settle();
    expect(OrderPane.log).toEqual(['render A', 'restore A', 'shown A']);
  });

  it('runs each time a retained pane is shown again', async () => {
    const group = new EditorGroupView(undefined, () => new OrderPane());
    document.body.appendChild(group.element);
    const a = new PlaceholderEditorInput('A');
    const b = new PlaceholderEditorInput('B');
    await group.openEditor(a, { pinned: true }); await settle();
    await group.openEditor(b, { pinned: true }); await settle();
    OrderPane.log = [];
    await group.openEditor(a, { pinned: true }); await settle();
    expect(OrderPane.log).toEqual(['shown A']);
  });
});

// ── Spreadsheet viewer ──────────────────────────────────────────────────────

describe('spreadsheet viewer', () => {
  const PATH = '/ws/Cookbook/5_Clark.xlsx';
  beforeEach(() => {
    _clearFileRevealsForTest();
    (globalThis as any).parallxElectron = {
      document: {
        readSpreadsheet: async () => ({
          format: 'spreadsheet',
          title: '5_Clark',
          sheets: [
            { name: 'LDF', rows: [['Age']], cols: 1, truncated: false, rowStart: 0, colStart: 0 },
            {
              name: 'Cape Cod',
              // Used range starts at B3; row 4 is blank.
              rows: [['Step', 'Recipe'], ['', ''], ['1', 'Fit the curve'], ['4', 'Use the true ultimate']],
              cols: 2, truncated: false, rowStart: 2, colStart: 1,
            },
          ],
        }),
      },
    };
  });
  afterEach(() => { delete (globalThis as any).parallxElectron; });

  async function open(): Promise<{ pane: ExcelEditorPane; root: HTMLElement }> {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const pane = new ExcelEditorPane();
    pane.create(root);
    await pane.setInput(ExcelEditorInput.create(URI.file(PATH), 1));
    return { pane, root };
  }

  it('labels rows and columns as the workbook does, blank rows included', async () => {
    const { root } = await open();
    const rowNums = [...root.querySelectorAll('th.excel-rownum')].map((th) => th.textContent);
    expect(rowNums).toEqual(['3', '4', '5', '6']);
    const cols = [...root.querySelectorAll('th.excel-colhead')].map((th) => th.textContent);
    expect(cols).toEqual(['B', 'C']);
  });

  it('opens at the cited sheet and cell', async () => {
    const { pane, root } = await open();
    requestFileReveal(PATH, { sheet: 'Cape Cod', cell: 'C6' });
    pane.didShow();
    const cell = root.querySelector('td.excel-cell-revealed');
    expect(cell?.textContent).toBe('Use the true ultimate');
    expect(root.querySelector('.excel-tab.is-active')?.textContent).toBe('Cape Cod');
  });

  it('leaves the view alone for a cell outside the sheet\'s data', async () => {
    const { pane, root } = await open();
    requestFileReveal(PATH, { sheet: 'Cape Cod', cell: 'A1' });
    pane.didShow();
    expect(root.querySelector('td.excel-cell-revealed')).toBeNull();
  });
});

// ── Text editor ─────────────────────────────────────────────────────────────

describe('text editor', () => {
  it('selects the cited lines', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const pane = new TextEditorPane();
    pane.create(root);
    await pane.setInput(UntitledEditorInput.createWithContent('one\ntwo\nthree\nfour'));
    pane.revealLines(2, 3);
    const ta = root.querySelector('textarea')!;
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('two\nthree');
    pane.revealLines(9);
    expect(ta.value.slice(ta.selectionStart, ta.selectionEnd)).toBe('two\nthree'); // out of range: unchanged
  });
});

describe('code editor', () => {
  it('selects the cited lines', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const editor = new CodeEditor(root, { value: 'one\ntwo\nthree\nfour', fileName: 'notes.md' });
    editor.revealLines(2, 3);
    expect(editor.selectedText).toBe('two\nthree');
    editor.revealLines(0);
    expect(editor.selectedText).toBe('two\nthree'); // out of range: unchanged
    editor.dispose();
  });
});

// ── Chat marks dead links ───────────────────────────────────────────────────

describe('chat citation links', () => {
  afterEach(() => setChatLinkChecker(undefined));

  it('marks a link whose target is gone, with the reason, and leaves good ones alone', async () => {
    const asked: string[] = [];
    setChatLinkChecker(async (uri) => {
      asked.push(uri);
      return uri.includes('Shapland') ? { ok: false, error: 'No file at "D:/AI/Parallx/Shapland.pdf" in this workspace.' } : { ok: true };
    });
    const root = document.createElement('div');
    root.innerHTML = [
      '<a href="parallx://explorer/file?path=D%3A%2FAI%2FParallx%2FShapland.pdf">Shapland</a>',
      '<a href="parallx://explorer/file?path=Clark.pdf&page=13">Clark</a>',
      '<a href="parallx://explorer/file?path=Clark.pdf&page=13">Clark again</a>',
      '<a href="https://example.com">web</a>',
    ].join('');
    await markParallxLinks(root);
    const [dead, good, again, web] = [...root.querySelectorAll('a')];
    expect(dead.classList.contains('parallx-chat-link--broken')).toBe(true);
    expect(dead.title).toBe('This link does not work: No file at "D:/AI/Parallx/Shapland.pdf" in this workspace.');
    expect(good.classList.contains('parallx-chat-link--broken')).toBe(false);
    expect(again.classList.contains('parallx-chat-link--broken')).toBe(false);
    expect(web.classList.contains('parallx-chat-link--broken')).toBe(false);
    // The same link is checked once, not once per render.
    expect(asked).toHaveLength(2);
  });

  it('leaves a link unmarked when the check itself fails', async () => {
    setChatLinkChecker(async () => { throw new Error('offline'); });
    const root = document.createElement('div');
    root.innerHTML = '<a href="parallx://explorer/file?path=x.pdf">x</a>';
    await markParallxLinks(root);
    expect(root.querySelector('a')!.classList.contains('parallx-chat-link--broken')).toBe(false);
  });
});
