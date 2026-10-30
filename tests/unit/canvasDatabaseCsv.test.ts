import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  UTF8_BOM, cellToCsvText, csvFileText, csvRecordToRow, databaseViewToCsv, databaseViewToRecords,
  parseCsv, planCsvImport, serializeCsv,
} from '../../src/built-in/canvas/database/databaseCsv';
import { exportDatabaseCsv, importCsvIntoDatabase, registerDatabaseCsvCommands } from '../../src/built-in/canvas/database/databaseCsvActions';
import { coerceCellValue } from '../../src/built-in/canvas/database/cellValues';
import type { IDatabaseProperty, IDatabaseRow, IDatabaseView } from '../../src/built-in/canvas/database/databaseTypes';
import { EMPTY_FILTER, TITLE_KEY } from '../../src/built-in/canvas/database/databaseTypes';
import type { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import type { PropertyType } from '../../src/built-in/canvas/properties/propertyTypes';

function prop(id: string, name: string, type: PropertyType, sortOrder: number): IDatabaseProperty {
  return { id, databaseId: 'db', name, type, config: {}, sortOrder };
}

function row(pageId: string, title: string, values: Record<string, unknown>, sortOrder: number): IDatabaseRow {
  return { pageId, title, icon: null, sortOrder, values, createdAt: '', updatedAt: '' };
}

const PROPS = [
  prop('status', 'Status', 'select', 1),
  prop('tags', 'Tags', 'tags', 2),
  prop('due', 'Due', 'date', 3),
  prop('at', 'Starts', 'datetime', 4),
  prop('done', 'Done', 'checkbox', 5),
  prop('est', 'Estimate', 'number', 6),
  prop('notes', 'Notes', 'text', 7),
  prop('link', 'Link', 'url', 8),
];

const ROWS = [
  row('a', 'Alpha', { status: 'Done', tags: ['x', 'y'], due: '2026-06-01', at: '2026-06-01T09:30', done: true, est: 5, notes: 'one, two', link: 'https://a.example' }, 1),
  row('b', 'Beta "quoted"', { status: 'To do', tags: [], done: false, est: 2.5, notes: 'line one\r\nline two' }, 2),
  row('c', 'Gamma', { status: 'To do', est: null, notes: '' }, 3),
];

const VIEW: Pick<IDatabaseView, 'config' | 'filter' | 'sort'> = { config: {}, filter: EMPTY_FILTER, sort: [] };

describe('CSV text (RFC 4180)', () => {
  it('quotes fields with commas, quotes and line breaks, and only those', () => {
    expect(serializeCsv([['a', 'b,c', 'say "hi"', 'x\ny', 'p\r\nq', ' lead']])).toBe('a,"b,c","say ""hi""","x\ny","p\r\nq", lead');
    expect(serializeCsv([['1'], ['2']])).toBe('1\r\n2');
  });

  it('parses quoted fields holding commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b,c","say ""hi""","x\r\ny"\r\n1,2,3,4\r\n')).toEqual([['a', 'b,c', 'say "hi"', 'x\r\ny'], ['1', '2', '3', '4']]);
  });

  it('strips a byte-order mark and reads LF, CRLF and CR line ends', () => {
    expect(parseCsv(`${UTF8_BOM}Name,Age\r\nAnn,3\nBo,4\rCy,5`)).toEqual([['Name', 'Age'], ['Ann', '3'], ['Bo', '4'], ['Cy', '5']]);
  });

  it('keeps empty fields, skips blank lines, keeps a quoted empty line', () => {
    expect(parseCsv('a,,c\n\n,\n""\n')).toEqual([['a', '', 'c'], ['', ''], ['']]);
    expect(parseCsv('')).toEqual([]);
  });

  it('round-trips any table', () => {
    const table = [['x', 'y,"z"'], ['', 'multi\nline'], ['é ü 漢', ',']];
    expect(parseCsv(csvFileText(table))).toEqual(table);
  });
});

describe('a view as CSV', () => {
  it('writes cells as the table shows them', () => {
    expect(cellToCsvText('select', 'Done')).toBe('Done');
    expect(cellToCsvText('tags', ['x', 'y'])).toBe('x, y');
    expect(cellToCsvText('date', '2026-06-01')).toBe('2026-06-01');
    expect(cellToCsvText('datetime', '2026-06-01T09:30')).toBe('2026-06-01T09:30');
    expect(cellToCsvText('checkbox', true)).toBe('true');
    expect(cellToCsvText('checkbox', undefined)).toBe('false');
    expect(cellToCsvText('checkbox', 'false')).toBe('false');
    expect(cellToCsvText('number', 2.5)).toBe('2.5');
    expect(cellToCsvText('text', null)).toBe('');
    expect(cellToCsvText('text', [{ title: 'Page A' }, { title: 'Page B' }])).toBe('Page A, Page B');
  });

  it('has a header of Name and the visible properties, in order', () => {
    const view = { ...VIEW, config: { hidden: ['at', 'link'] } };
    const records = databaseViewToRecords(PROPS, view, ROWS);
    expect(records[0]).toEqual(['Name', 'Status', 'Tags', 'Due', 'Done', 'Estimate', 'Notes']);
    expect(records[1]).toEqual(['Alpha', 'Done', 'x, y', '2026-06-01', 'true', '5', 'one, two']);
  });

  it('keeps only the rows the filter keeps, in the sort order', () => {
    const view = {
      config: {},
      filter: { conjunction: 'and' as const, rules: [{ propertyId: 'status', op: 'equals' as const, value: 'To do' }] },
      sort: [{ propertyId: TITLE_KEY, dir: 'desc' as const }],
    };
    expect(databaseViewToRecords(PROPS, view, ROWS).slice(1).map((r) => r[0])).toEqual(['Gamma', 'Beta "quoted"']);
  });

  it('starts with a byte-order mark and ends with CRLF', () => {
    const text = databaseViewToCsv(PROPS, VIEW, ROWS);
    expect(text.startsWith(UTF8_BOM)).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
  });
});

describe('CSV into rows', () => {
  it('maps columns by name in any case and makes the rest', () => {
    const plan = planCsvImport([['name', 'STATUS', 'Owner', '', 'status'], ['A', 'Done', 'Ann', 'z', 'dup']], PROPS);
    expect(plan.titleColumn).toBe(0);
    expect(plan.columns).toEqual([
      { index: 1, name: 'STATUS', propertyId: 'status' },
      { index: 2, name: 'Owner', propertyId: null },
      { index: 3, name: 'Column 4', propertyId: null },
    ]);
    expect(plan.records).toEqual([['A', 'Done', 'Ann', 'z', 'dup']]);
  });

  it('takes the first column as the title when none is called Name or Title', () => {
    expect(planCsvImport([['Task', 'Status']], PROPS).titleColumn).toBe(0);
    expect(planCsvImport([['Status', 'Title']], PROPS).titleColumn).toBe(1);
  });

  it('a property called Name is filled by the second Name column', () => {
    const props = [prop('n', 'Name', 'text', 1)];
    const plan = planCsvImport([['Name', 'Name'], ['Row', 'value']], props);
    expect(plan.titleColumn).toBe(0);
    expect(plan.columns).toEqual([{ index: 1, name: 'Name', propertyId: 'n' }]);
  });

  it('leaves empty cells unset and counts cells a property cannot take', () => {
    const cols = [
      { index: 1, propertyId: 'est', type: 'number' as const },
      { index: 2, propertyId: 'tags', type: 'tags' as const },
      { index: 3, propertyId: 'done', type: 'checkbox' as const },
      { index: 4, propertyId: 'notes', type: 'text' as const },
    ];
    expect(csvRecordToRow(['  T ', 'lots', 'a, b,,c', 'yes', ''], 0, cols))
      .toEqual({ title: 'T', values: { tags: ['a', 'b', 'c'], done: true }, skipped: 1 });
  });

  it('round trip: an exported view imports as the same cells', () => {
    const exported = databaseViewToCsv(PROPS, VIEW, ROWS);
    const plan = planCsvImport(parseCsv(exported), PROPS);
    expect(plan.columns.every((c) => c.propertyId)).toBe(true);
    const cols = plan.columns.map((c) => ({ index: c.index, propertyId: c.propertyId!, type: PROPS.find((p) => p.id === c.propertyId)!.type }));
    const imported = plan.records.map((record, i) => {
      const r = csvRecordToRow(record, plan.titleColumn, cols);
      expect(r.skipped).toBe(0);
      return row(`n${i}`, r.title, r.values, i + 1);
    });
    expect(databaseViewToCsv(PROPS, VIEW, imported)).toBe(exported);
    expect(imported[0]!.values).toEqual(ROWS[0]!.values);
    expect(imported[1]!.values['notes']).toBe('line one\r\nline two');
  });
});

// ── The actions, over a database in memory and stub file dialogs ─────────────

function memoryDb(props: IDatabaseProperty[], rows: IDatabaseRow[] = []) {
  const db = {
    props, rows,
    getDatabase: async (id: string) => (id === 'db' ? { id, title: 'Tasks/2', icon: null, description: null, isLocked: false, createdAt: '', updatedAt: '' } : null),
    isDatabase: (id: string) => id === 'db',
    listProperties: async () => [...props],
    listViews: async () => [{ id: 'v1', databaseId: 'db', name: 'Table', type: 'table', groupBy: null, hideEmptyGroups: false, filter: EMPTY_FILTER, sort: [], config: {}, sortOrder: 0 }],
    listRows: async () => [...rows],
    listDatabases: async () => [{ id: 'db', title: 'Tasks', icon: null }],
    addProperty: async (_db: string, name: string, type: PropertyType) => { const p = prop(`p${props.length}`, name, type, props.length + 1); props.push(p); return p; },
    addRow: async (_db: string, title: string | undefined, values: Record<string, unknown>) => {
      const stored: Record<string, unknown> = {};
      for (const [id, v] of Object.entries(values)) {
        const c = coerceCellValue(props.find((p) => p.id === id)!.type, v);
        if (!c.ok) throw new Error(c.reason);
        stored[id] = c.value;
      }
      const r = row(`r${rows.length}`, title || 'Untitled', stored, rows.length + 1);
      rows.push(r);
      return r;
    },
  };
  return db;
}

function stubFiles(files: Record<string, string>) {
  const written: Record<string, string> = {};
  (globalThis as { parallxElectron?: unknown }).parallxElectron = {
    dialog: {
      openFile: vi.fn(async () => ['/in.csv']),
      saveFile: vi.fn(async (o: { defaultName?: string }) => `/out/${o.defaultName}`),
    },
    fs: {
      readFile: async (p: string) => (p in files ? { content: files[p], encoding: 'utf-8' } : { error: { message: 'missing' } }),
      writeFile: async (p: string, c: string) => { written[p] = c; return { error: null }; },
    },
  };
  return written;
}

describe('Export as CSV… and Import CSV…', () => {
  afterEach(() => { delete (globalThis as { parallxElectron?: unknown }).parallxElectron; });

  it('exports to the picked file and imports into rows, saying how many', async () => {
    const info = vi.fn(async () => undefined);
    const commands = registerDatabaseCsvCommands({ commands: { registerCommand: () => ({ dispose() {} }) }, window: { showInformationMessage: info, showErrorMessage: vi.fn(async () => undefined) } }, () => null);
    try {
      const source = memoryDb(PROPS.map((p) => ({ ...p })), [...ROWS]);
      const written = stubFiles({});
      expect(await exportDatabaseCsv(source as unknown as DatabaseDataService, 'db', 'v1')).toBe(true);
      expect(Object.keys(written)).toEqual(['/out/Tasks_2.csv']);
      expect(info).toHaveBeenLastCalledWith('Exported 3 rows as CSV.');

      const target = memoryDb([prop('status', 'status', 'select', 1)]);
      stubFiles({ '/in.csv': written['/out/Tasks_2.csv']! });
      expect(await importCsvIntoDatabase(target as unknown as DatabaseDataService, 'db')).toBe(3);
      expect(target.props.map((p) => [p.name, p.type])).toEqual([
        ['status', 'select'], ['Tags', 'text'], ['Due', 'text'], ['Starts', 'text'], ['Done', 'text'], ['Estimate', 'text'], ['Notes', 'text'], ['Link', 'text'],
      ]);
      expect(target.rows.map((r) => r.title)).toEqual(['Alpha', 'Beta "quoted"', 'Gamma']);
      expect(target.rows[0]!.values['status']).toBe('Done');
      expect(info).toHaveBeenLastCalledWith('Added 3 rows. Made 7 new text properties.');
    } finally {
      for (const c of commands) c.dispose();
    }
  });
});
