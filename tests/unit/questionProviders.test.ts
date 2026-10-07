// questionProviders.test.ts — the core's question-provider seam.
//
// The registry (register, list, replace, dispose, onDidChange), the core
// command that hands the live registry to extensions, and the two pure
// row-to-item mappers the first providers use: Worksheets' (a module of its
// own) and Flashcards' (through __testables).

import { describe, it, expect, vi } from 'vitest';
import {
  registerQuestionProvider, listQuestionProviders, onDidChangeQuestionProviders,
  questionProviderRegistry, type IQuestionProvider,
} from '../../src/services/questionProviders.js';
import { questionsGetRegistry } from '../../src/commands/questionCommands.js';
import { ALL_BUILTIN_COMMANDS } from '../../src/commands/structuralCommands.js';
import { sheetSolutionText, worksheetQuestionItem, worksheetQuestionProvider } from '../../src/built-in/worksheet/questionProvider.js';
// @ts-expect-error — JS module with no types
import { __testables } from '../../ext/flashcards/main.js';

const { fcQuestionItemFromCard } = __testables;

function provider(id: string, extra: Partial<IQuestionProvider> = {}): IQuestionProvider {
  return { id, displayName: id, toolId: 'test.tool', list: async () => [], ...extra };
}

describe('question provider registry', () => {
  it('registers, lists and disposes', () => {
    const d = registerQuestionProvider(provider('a.one'));
    expect(listQuestionProviders().map((p) => p.id)).toContain('a.one');
    d.dispose();
    expect(listQuestionProviders().map((p) => p.id)).not.toContain('a.one');
  });

  it('fires onDidChange on register and on dispose', () => {
    const fn = vi.fn();
    const sub = onDidChangeQuestionProviders(fn);
    const d = registerQuestionProvider(provider('a.two'));
    expect(fn).toHaveBeenCalledTimes(1);
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(2);
    d.dispose();
    expect(fn).toHaveBeenCalledTimes(2);
    sub.dispose();
  });

  it('replaces a provider registered under the same id, with a warning, and keeps the replacement when the old one is disposed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const first = provider('a.three', { displayName: 'first' });
    const second = provider('a.three', { displayName: 'second' });
    const d1 = registerQuestionProvider(first);
    const d2 = registerQuestionProvider(second);
    expect(warn).toHaveBeenCalledOnce();
    expect(listQuestionProviders().filter((p) => p.id === 'a.three')).toEqual([second]);
    d1.dispose();
    expect(listQuestionProviders().filter((p) => p.id === 'a.three')).toEqual([second]);
    d2.dispose();
    expect(listQuestionProviders().some((p) => p.id === 'a.three')).toBe(false);
    warn.mockRestore();
  });

  it('refuses a provider without an id or a list()', () => {
    expect(() => registerQuestionProvider({ displayName: 'x', toolId: 't', list: async () => [] } as never)).toThrow();
    expect(() => registerQuestionProvider({ id: 'a.four', displayName: 'x', toolId: 't' } as never)).toThrow();
  });
});

describe('questions.getRegistry', () => {
  it('is a core command', () => {
    const cmd = ALL_BUILTIN_COMMANDS.find((c) => c.id === 'questions.getRegistry');
    expect(cmd).toBe(questionsGetRegistry);
  });

  it('returns the live registry', async () => {
    const ctx = { getService: () => undefined, workbench: {}, origin: 'ext:test' as const };
    const registry = await questionsGetRegistry.handler(ctx) as typeof questionProviderRegistry;
    expect(registry).toBe(questionProviderRegistry);
    const fn = vi.fn();
    const sub = registry.onDidChange(fn);
    const d = registry.register(provider('b.one'));
    expect(fn).toHaveBeenCalledOnce();
    expect(listQuestionProviders().map((p) => p.id)).toContain('b.one');
    expect(registry.list().map((p) => p.id)).toContain('b.one');
    d.dispose();
    sub.dispose();
  });
});

describe('Worksheets provider mapping', () => {
  const sheet = JSON.stringify({
    sheetOrder: ['s1'],
    sheets: {
      s1: {
        cellData: {
          0: { 0: { v: 'Question' }, 3: { v: 'Solution' } },
          1: { 0: { v: 'Given' }, 3: { v: 'Step one' }, 4: { v: 12 } },
          2: { 0: { v: '' }, 3: { v: 'Step two' } },
        },
      },
    },
  });

  it('reads the solution cells from the marker column across', () => {
    expect(sheetSolutionText(sheet, 3, -1)).toBe('Solution\nStep one 12\nStep two');
  });

  it('reads the solution cells from the marker row down', () => {
    expect(sheetSolutionText(sheet, -1, 2)).toBe('Step two');
    expect(sheetSolutionText(sheet, -1, -1)).toBe('');
    expect(sheetSolutionText('not json', 0, 0)).toBe('');
  });

  it('maps an essay row with notes', () => {
    const item = worksheetQuestionItem({
      id: 7, title: 'Brosius 3', question_md: 'Explain credibility.', solution_notes_md: 'Because…',
      source_uri: 'file:///rf.pdf', source_page: 12, tags: 'brosius, essay', paper: 'brosius', source: 'rf', kind: 'essay',
      solution_col: -1, solution_row: -1, solution_json: '', sheet_json: '',
    });
    expect(item).toEqual({
      ref: '7', question: 'Explain credibility.', answer: 'Because…', kind: 'essay',
      paper: 'brosius', source: 'rf', label: 'Brosius 3', sourceUri: 'file:///rf.pdf', sourcePage: 12,
      tags: ['brosius', 'essay'],
    });
  });

  it('maps a qual row to a short question and takes the answer from the sheet when the notes are empty', () => {
    const item = worksheetQuestionItem({
      id: 8, title: 'Clark 1', question_md: 'Why?', solution_notes_md: '',
      source_uri: '', source_page: 0, tags: '', paper: 'clark', source: 'cas', kind: 'qual',
      solution_col: 3, solution_row: -1, solution_json: '', sheet_json: sheet,
    });
    expect(item.kind).toBe('short');
    expect(item.answer).toBe('Solution\nStep one 12\nStep two');
    expect(item.sourcePage).toBeUndefined();
    expect(item.tags).toEqual([]);
  });

  it('falls back to the legacy solution workbook', () => {
    const solution = JSON.stringify({ sheetOrder: ['s'], sheets: { s: { cellData: { 0: { 0: { v: 'Answer' } } } } } });
    const item = worksheetQuestionItem({
      id: 9, title: 'Legacy', question_md: 'Q', solution_notes_md: '', kind: 'qual',
      solution_col: -1, solution_row: -1, solution_json: solution, sheet_json: '',
    });
    expect(item.answer).toBe('A1: Answer');
  });

  it('lists through the rows and opens an essay item, never a quantitative one', async () => {
    const openItem = vi.fn(async () => {});
    const p = worksheetQuestionProvider({
      listRows: async (limit) => [{ id: 1, title: 'T', question_md: 'Q', kind: 'essay', solution_notes_md: `limit ${limit}` }],
      getItem: async (id) => (id === 1 ? { title: 'T', kind: 'essay' } : id === 2 ? { title: 'Q', kind: 'quant' } : null),
      openItem,
    });
    expect(p.id).toBe('worksheets.problems');
    const items = await p.list({ limit: 3 });
    expect(items).toHaveLength(1);
    expect(items[0].answer).toBe('limit 3');
    expect(await p.open!('1')).toBe(true);
    expect(openItem).toHaveBeenCalledWith(1, 'T');
    expect(await p.open!('2')).toBe(false);
    expect(await p.open!('x')).toBe(false);
    expect(openItem).toHaveBeenCalledOnce();
  });
});

describe('Flashcards provider mapping', () => {
  it('maps a card to an essay item with its rubric, tags and source', () => {
    const item = fcQuestionItemFromCard({
      id: 42, front: 'Describe the chain ladder.', back: 'Development factors…',
      rubric: [{ text: 'Age-to-age factors', required: true }, { text: 'Tail', required: false }],
      tags: 'study, study:c:9', sourceLabel: 'notes.pdf', sourceUri: 'file:///notes.pdf', sourcePage: 4,
      sourceExcerpt: 'The chain ladder…',
    }, 'Exam 7');
    expect(item).toEqual({
      ref: '42', question: 'Describe the chain ladder.', answer: 'Development factors…', kind: 'essay',
      rubric: [{ text: 'Age-to-age factors', required: true }, { text: 'Tail', required: false }],
      tags: ['study', 'study:c:9'], label: 'Exam 7', source: 'notes.pdf', sourceUri: 'file:///notes.pdf', sourcePage: 4,
      sourceExcerpt: 'The chain ladder…',
    });
  });

  it('leaves the page out when the card has none and takes a JSON rubric', () => {
    const item = fcQuestionItemFromCard({ id: 1, front: 'F', back: 'B', rubric: '[{"text":"a"}]', tags: '', sourcePage: 0 });
    expect(item.sourcePage).toBeUndefined();
    expect(item.rubric).toEqual([{ text: 'a', required: true }]);
    expect(item.tags).toEqual([]);
    expect(item.label).toBe('');
  });
});
