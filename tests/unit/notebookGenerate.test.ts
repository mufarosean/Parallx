// notebookGenerate.test.ts — the two pure halves of notebook "Generate".
//
// Deliberately covers only the parts where being wrong produces a broken cell:
// fence stripping (a leftover ``` is a SyntaxError on line 1) and context
// assembly (dropping the wrong end of the notebook makes the model redefine
// variables that already exist). The streaming plumbing around them is DOM work
// and is not what breaks.

import { describe, it, expect } from 'vitest';
import { stripCodeFences } from '../../src/built-in/editor/notebook/codeFences.js';
import {
  buildNotebookContext,
  buildGenerateMessages,
  MAX_CONTEXT_CHARS,
} from '../../src/built-in/editor/notebook/generatePrompt.js';
import { createEmptyCell, type CellType, type NotebookCell } from '../../src/built-in/editor/notebook/notebookModel.js';

function cell(cellType: CellType, source: string): NotebookCell {
  const c = createEmptyCell(cellType);
  c.source = source;
  return c;
}

describe('stripCodeFences', () => {
  it('passes bare code through untouched', () => {
    expect(stripCodeFences('df = pd.read_csv("a.csv")')).toBe('df = pd.read_csv("a.csv")');
  });

  it('strips a language-tagged fence', () => {
    expect(stripCodeFences('```python\nx = 1\n```')).toBe('x = 1');
  });

  it('strips an untagged fence', () => {
    expect(stripCodeFences('```\nx = 1\n```')).toBe('x = 1');
  });

  it('strips tildes, which some models emit instead of backticks', () => {
    expect(stripCodeFences('~~~python\nx = 1\n~~~')).toBe('x = 1');
  });

  it('drops the prose a model wraps around the code', () => {
    const reply = 'Sure! Here is how to do that:\n\n```python\nx = 1\n```\n\nLet me know if you need more.';
    expect(stripCodeFences(reply)).toBe('x = 1');
  });

  it('keeps an unterminated block — that is the normal mid-stream state', () => {
    // THE streaming case. Discarding this would leave the cell empty until the
    // very last chunk arrived, so nothing would appear to be happening.
    expect(stripCodeFences('```python\nfor i in range(3):\n    print(i)')).toBe('for i in range(3):\n    print(i)');
  });

  it('joins multiple blocks rather than keeping only the first', () => {
    // A model asked for one cell sometimes answers in two blocks; silently
    // dropping the second yields code that references undefined names.
    expect(stripCodeFences('```python\nimport pandas as pd\n```\nthen\n```python\ndf = pd.DataFrame()\n```'))
      .toBe('import pandas as pd\n\ndf = pd.DataFrame()');
  });

  it('preserves interior blank lines and indentation', () => {
    const code = 'def f():\n    a = 1\n\n    return a';
    expect(stripCodeFences('```python\n' + code + '\n```')).toBe(code);
  });

  it('does not eat leading indentation of the first kept line', () => {
    // `String.trim()` would, and in Python that changes what the code means.
    expect(stripCodeFences('```python\n    indented = True\n```')).toBe('    indented = True');
  });

  it('trims blank lines at both edges', () => {
    expect(stripCodeFences('```python\n\n\nx = 1\n\n\n```')).toBe('x = 1');
  });

  it('tolerates an indented fence', () => {
    expect(stripCodeFences('  ```python\n  x = 1\n  ```')).toBe('  x = 1');
  });

  it('returns empty for an empty or fence-only reply', () => {
    expect(stripCodeFences('')).toBe('');
    expect(stripCodeFences('```python\n```')).toBe('');
    expect(stripCodeFences('```')).toBe('');
  });

  it('is stable when re-derived from a growing buffer', () => {
    // The pane re-runs this over the whole buffer every frame, so partial
    // results must never contain a fence marker.
    const full = 'Here:\n```python\nx = 1\ny = 2\n```';
    for (let i = 1; i <= full.length; i++) {
      const out = stripCodeFences(full.slice(0, i));
      expect(out, `prefix of length ${i} leaked a fence: ${JSON.stringify(out)}`).not.toContain('```');
    }
  });
});

describe('buildNotebookContext', () => {
  it('renders code cells in notebook order', () => {
    const context = buildNotebookContext([
      cell('code', 'import pandas as pd'),
      cell('code', 'df = pd.read_csv("sales.csv")'),
    ]);
    expect(context.indexOf('import pandas')).toBeLessThan(context.indexOf('read_csv'));
  });

  it('comments out markdown so the whole context is valid source', () => {
    const context = buildNotebookContext([cell('markdown', '# Loading\nWe read the file.')]);
    for (const line of context.split('\n')) {
      expect(line.startsWith('#')).toBe(true);
    }
  });

  it('skips empty and raw cells', () => {
    expect(buildNotebookContext([cell('code', '   '), cell('raw', 'latex here')])).toBe('');
  });

  it('drops the OLDEST cells when over budget, keeping the nearest', () => {
    // Direction matters: the cell being generated is most likely to touch
    // variables from the cells just above it.
    const cells = [
      cell('code', 'FIRST = ' + 'x'.repeat(400)),
      cell('code', 'SECOND = ' + 'y'.repeat(400)),
      cell('code', 'NEAREST = 1'),
    ];
    const context = buildNotebookContext(cells, 500);
    expect(context).toContain('NEAREST');
    expect(context).not.toContain('FIRST');
  });

  it('says how many cells it omitted rather than hiding the truncation', () => {
    const cells = [
      cell('code', 'a = ' + 'x'.repeat(400)),
      cell('code', 'b = 2'),
    ];
    expect(buildNotebookContext(cells, 100)).toContain('1 earlier cell omitted');
  });

  it('elides the middle of an over-long cell, keeping both ends', () => {
    const long = 'import os\n' + 'pad = 1\n'.repeat(400) + 'RESULT = os.getcwd()';
    const context = buildNotebookContext([cell('code', long)]);
    expect(context).toContain('import os');
    expect(context).toContain('RESULT');
    expect(context).toContain('characters omitted');
    expect(context.length).toBeLessThan(long.length);
  });

  it('stays within the stated budget', () => {
    const cells = Array.from({ length: 40 }, (_, i) => cell('code', `v${i} = ` + 'z'.repeat(500)));
    const context = buildNotebookContext(cells);
    // Plus the one-line omission note, which is not part of the cell budget.
    expect(context.length).toBeLessThan(MAX_CONTEXT_CHARS + 200);
  });
});

describe('buildGenerateMessages', () => {
  it('names the kernel language in the system prompt', () => {
    const [system] = buildGenerateMessages({ instruction: 'plot it', preceding: [], language: 'python' });
    expect(system.role).toBe('system');
    expect(system.content).toContain('python');
    expect(system.content.toLowerCase()).toContain('no markdown fences');
  });

  it('sends just system + instruction when there is nothing above', () => {
    const messages = buildGenerateMessages({ instruction: 'read the csv', preceding: [], language: 'python' });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(messages[1].content).toBe('read the csv');
  });

  it('keeps strict user/assistant alternation when context is present', () => {
    // Some local chat templates mangle two consecutive user turns, so the
    // context turn gets an acknowledgement before the real instruction.
    const messages = buildGenerateMessages({
      instruction: 'plot df',
      preceding: [cell('code', 'df = 1')],
      language: 'python',
    });
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[1].content).toContain('df = 1');
    expect(messages[3].content).toBe('plot df');
  });

  it('frames an existing cell as a rewrite, including its current source', () => {
    const messages = buildGenerateMessages({
      instruction: 'use a bar chart',
      preceding: [],
      language: 'python',
      existing: 'df.plot(kind="line")',
    });
    const last = messages[messages.length - 1].content;
    expect(last).toContain('Rewrite this cell');
    expect(last).toContain('df.plot(kind="line")');
    expect(last).toContain('use a bar chart');
  });

  it('treats a whitespace-only cell as empty, not as something to rewrite', () => {
    const messages = buildGenerateMessages({
      instruction: 'load the data',
      preceding: [],
      language: 'python',
      existing: '   \n\n',
    });
    expect(messages[messages.length - 1].content).toBe('load the data');
  });

  it('never includes the target cell itself in the context', () => {
    // The pane slices `cells.slice(0, index)`; this asserts the contract that
    // relies on, since a cell that appears both as context and as the rewrite
    // target makes the model repeat it verbatim.
    const target = cell('code', 'TARGET_MARKER = 1');
    const messages = buildGenerateMessages({
      instruction: 'change it',
      preceding: [cell('code', 'above = 1')],
      language: 'python',
      existing: target.source,
    });
    expect(messages[1].content).not.toContain('TARGET_MARKER');
  });
});
