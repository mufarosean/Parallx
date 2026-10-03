// @vitest-environment jsdom
//
// canvasDataLoss.test.ts — the "content can be lost" list (C1–C16) from
// docs/CANVAS_ASSESSMENT_2026-10-03.md.  Each test was written to fail on the
// code as it was, then the fix made it pass.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mk, p, t, col, cols, find } from './canvasMatrixHarness';
import { CanvasDataService } from '../../src/built-in/canvas/canvasDataService';
import { decodeCanvasContent } from '../../src/built-in/canvas/contentSchema';
import { wrapUnknownContent, unwrapUnknownContent } from '../../src/built-in/canvas/unknownContent';
import { DatabaseDataService } from '../../src/built-in/canvas/database/databaseDataService';
import { Emitter } from '../../src/platform/events';

// ── Service harness (a pages table in memory) ────────────────────────────────

function pageRow(id: string, content: string): Record<string, unknown> {
  return {
    id, parent_id: null, title: 'Page', icon: null, content,
    content_schema_version: 2, revision: 1, sort_order: 1, is_archived: 0,
    cover_url: null, cover_y_offset: 0.5, font_family: 'default',
    full_width: 0, small_text: 0, is_locked: 0, is_favorited: 0,
    created_at: '2025-01-01T00:00:00.000Z', updated_at: '2025-01-01T00:00:00.000Z',
  };
}

function memoryDb() {
  const pages = new Map<string, Record<string, unknown>>();
  const get = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/SELECT \* FROM pages WHERE id = \?/i.test(sql)) return { error: null, row: pages.get(params[0] as string) ?? null };
    return { error: null, row: null };
  });
  const all = vi.fn(async () => ({ error: null, rows: [] }));
  const run = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^UPDATE pages SET/i.test(sql)) {
      const guarded = /revision = \?/i.test(sql);
      const id = params[guarded ? params.length - 2 : params.length - 1] as string;
      const row = pages.get(id);
      if (!row) return { error: null, changes: 0 };
      if (guarded && row.revision !== params[params.length - 1]) return { error: null, changes: 0 };
      if (/content = \?/i.test(sql)) row.content = params[0];
      row.revision = (row.revision as number) + 1;
      return { error: null, changes: 1 };
    }
    return { error: null, changes: 0 };
  });
  return { pages, run, mock: { get, all, run, runTransaction: vi.fn(async () => ({ error: null, results: [] })) } };
}

const docOf = (text: string) => JSON.stringify({ schemaVersion: 2, doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] } });

// ── C1: a block type the editor doesn't know ─────────────────────────────────

describe('C1: unknown block types load, show, and save back unchanged', () => {
  const stored = {
    type: 'doc',
    content: [
      p('keep me'),
      { type: 'syncedBlock', attrs: { id: 's1', source: 'page-9' }, content: [p('inside synced')] },
      cols(col(p('left'), { type: 'databaseInline', attrs: { databaseId: 'db-1' } }), col(p('right'))),
      p('a ', { type: 'mention', attrs: { pageId: 'p-2' } }, ' and ', t('marked', [{ type: 'commentMark', attrs: { thread: 'c1' } }])),
    ],
  };

  it('the editor shows every known block and a placeholder for each unknown one', () => {
    const ed = mk(wrapUnknownContent(stored, mk({ type: 'doc', content: [p()] }).schema));
    const texts: string[] = [];
    ed.state.doc.descendants((n: any) => { if (n.isText) texts.push(n.text); return true; });
    expect(texts).toEqual(['keep me', 'left', 'right', 'a ', ' and ']);
    let placeholders = 0;
    ed.state.doc.descendants((n: any) => { if (n.type.name.startsWith('unsupported')) placeholders++; return true; });
    expect(placeholders).toBe(4);
    expect(() => ed.state.doc.check()).not.toThrow();
  });

  it('saving after an edit writes the unknown blocks back exactly as they were', () => {
    const ed = mk(wrapUnknownContent(stored, mk({ type: 'doc', content: [p()] }).schema));
    const r = find(ed, (n) => n.isTextblock && n.textContent === 'keep me')!;
    ed.commands.insertContentAt(r.pos + 1, 'NEW ');
    const saved = unwrapUnknownContent(ed.getJSON());
    const strip = (j: any): any => JSON.parse(JSON.stringify(j, (k, v) => (k === 'id' && typeof v === 'string' && v.length > 8 ? undefined : v === null ? undefined : v)));
    const expected = JSON.parse(JSON.stringify(stored));
    expected.content[0].content[0].text = 'NEW keep me';
    expect(strip(saved).content[1]).toEqual(expected.content[1]);
    expect(strip(saved).content[2].content[0].content[1]).toEqual(expected.content[2].content[0].content[1]);
    expect(strip(saved).content[3].content[1]).toEqual(expected.content[3].content[1]);
    expect(strip(saved).content[3].content[3]).toEqual(expected.content[3].content[3]);
    expect(strip(saved).content[0].content[0].text).toBe('NEW keep me');
  });
});

// ── C6: content that can't be decoded ────────────────────────────────────────

describe('C6: a page whose stored content cannot be read is never written over', () => {
  let env: ReturnType<typeof memoryDb>;
  let service: CanvasDataService;
  const GARBAGE = '{"schemaVersion":2,"doc":{"type":"doc","content":[{"type":"paragraph"';

  beforeEach(async () => {
    env = memoryDb();
    env.pages.set('bad', pageRow('bad', GARBAGE));
    env.pages.set('good', pageRow('good', docOf('fine')));
    (window as any).parallxElectron = { database: env.mock };
    service = new CanvasDataService();
  });
  afterEach(() => {
    service.dispose();
    delete (window as any).parallxElectron;
  });

  it('decoding says unreadable and asks for no repair', () => {
    const d = decodeCanvasContent(GARBAGE) as any;
    expect(d.unreadable).toBe(true);
    expect(d.needsRepair).toBe(false);
  });

  it('opening the page writes nothing', async () => {
    const page = await service.getPage('bad');
    const decoded = await service.decodePageContentForEditor(page!) as any;
    expect(decoded.unreadable).toBe(true);
    expect(env.pages.get('bad')!.content).toBe(GARBAGE);
  });

  it('a content write over it is refused, and the stored text stays', async () => {
    await service.getPage('bad');
    await expect(service.updatePage('bad', { content: docOf('typed') })).rejects.toThrow(/cannot be read/);
    expect(env.pages.get('bad')!.content).toBe(GARBAGE);
  });

  it('an auto-save over it never lands', async () => {
    await service.getPage('bad');
    service.scheduleContentSave('bad', JSON.stringify({ type: 'doc', content: [p('typed')] }));
    await service.flushPendingSaves();
    expect(env.pages.get('bad')!.content).toBe(GARBAGE);
  });

  it('a readable page still saves', async () => {
    await service.getPage('good');
    await service.updatePage('good', { content: docOf('typed') });
    expect(env.pages.get('good')!.content).toContain('typed');
  });
});

// ── C2: Trash is not delete for a database ───────────────────────────────────

describe('C2: moving a database to Trash keeps its rows, columns and views', () => {
  function setup() {
    const changes = new Emitter<any>();
    const sql: string[] = [];
    const bridge = {
      all: vi.fn(async (q: string) => (/SELECT id FROM databases/.test(q) ? { error: null, rows: [{ id: 'db-1' }] } : { error: null, rows: [] })),
      get: vi.fn(async () => ({ error: null, row: null })),
      run: vi.fn(async (q: string) => { sql.push(q); return { error: null, changes: 1 }; }),
      runTransaction: vi.fn(async (ops: any[]) => { for (const o of ops) sql.push(o.sql); return { error: null, results: [] }; }),
    };
    const pages = { onDidChangePage: changes.event } as any;
    const service = new DatabaseDataService(pages);
    service.attachDatabase(bridge as any);
    return { changes, sql, service };
  }

  it('an archive (Trash) event deletes nothing', async () => {
    const { changes, sql, service } = setup();
    await service.ensureIdsLoaded();
    changes.fire({ kind: 'Deleted', pageId: 'db-1', archived: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(sql.filter((q) => /DELETE/i.test(q))).toEqual([]);
    service.dispose();
  });

  it('a permanent delete still removes the database tables', async () => {
    const { changes, sql, service } = setup();
    await service.ensureIdsLoaded();
    changes.fire({ kind: 'Deleted', pageId: 'db-1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(sql.some((q) => /DELETE FROM databases/i.test(q))).toBe(true);
    service.dispose();
  });

  it('the page service marks a Trash move as archived, a permanent delete not', async () => {
    const env = memoryDb();
    env.pages.set('db-1', pageRow('db-1', docOf('x')));
    (window as any).parallxElectron = { database: { ...env.mock, all: vi.fn(async (q: string) => (/WITH RECURSIVE/.test(q) ? { error: null, rows: [{ id: 'db-1' }] } : { error: null, rows: [] })) } };
    const service = new CanvasDataService();
    const events: any[] = [];
    service.onDidChangePage((e) => events.push(e));
    await service.archivePage('db-1');
    expect(events.filter((e) => e.kind === 'Deleted').map((e) => e.archived)).toEqual([true]);
    service.dispose();
    delete (window as any).parallxElectron;
  });
});


// ── C4: the keystroke after inserting a divider / TOC / concept map ──────────

describe('C4: typing after inserting a block from the slash menu keeps the block', () => {
  for (const blockId of ['horizontalRule', 'tableOfContents', 'conceptMap']) {
    it(`${blockId}: the next keystroke goes into a paragraph after it`, async () => {
      const { CanvasMenuRegistry } = await import('../../src/built-in/canvas/menus/canvasMenuRegistry');
      const ed = mk({ type: 'doc', content: [p('/'), p('next')] });
      const registry = new CanvasMenuRegistry(() => ed);
      await registry.executeBlockInsert(blockId, ed, { from: 0, to: ed.state.doc.child(0).nodeSize }, {});
      const typed = ed.view.someProp('handleTextInput', (f: any) => f(ed.view, ed.state.selection.from, ed.state.selection.to, 'x'));
      if (!typed) ed.view.dispatch(ed.state.tr.insertText('x'));
      const types: string[] = [];
      ed.state.doc.forEach((n: any) => types.push(n.type.name + (n.isTextblock ? `(${n.textContent})` : '')));
      expect(types).toContain(blockId);
      expect(types.slice(0, 3)).toEqual([blockId, 'paragraph(x)', 'paragraph(next)']);
      registry.dispose();
    });
  }
});

// ── C5: two editors on one page ──────────────────────────────────────────────
// The pane itself is checked in the app (split, edit in both, close either:
// both edits stay — before the fix the later save erased the other pane's).
// This pins the mirror's own contract.

describe('C5: editors of one page share every edit', () => {
  it('an edit reaches the other editors of the page only', async () => {
    const { joinPaneMirror, broadcastPaneDoc, paneMirrorSize } = await import('../../src/built-in/canvas/paneMirror');
    const got: Record<string, unknown[]> = { a: [], b: [], c: [] };
    const mkTarget = (name: string, pageId: string) => ({ mirrorPageId: pageId, applyMirroredDoc: (d: unknown) => got[name].push(d) });
    const a = mkTarget('a', 'p1'), b = mkTarget('b', 'p1'), c = mkTarget('c', 'p2');
    const leaveA = joinPaneMirror('p1', a), leaveB = joinPaneMirror('p1', b), leaveC = joinPaneMirror('p2', c);
    broadcastPaneDoc(a, { doc: 1 });
    expect(got).toEqual({ a: [], b: [{ doc: 1 }], c: [] });
    leaveB();
    broadcastPaneDoc(a, { doc: 2 });
    expect(got.b).toEqual([{ doc: 1 }]);
    leaveA(); leaveC();
    expect(paneMirrorSize('p1')).toBe(0);
  });
});

// ── C7: structural repair of a malformed toggle ──────────────────────────────

describe('C7: repairing a malformed toggle keeps its title and every block', () => {
  async function repaired(docJson: any) {
    const { applyStructuralRepairs } = await import('../../src/built-in/canvas/plugins/structuralRepair');
    const { EditorState } = await import('@tiptap/pm/state');
    const schema = mk({ type: 'doc', content: [p()] }).schema;
    const state = EditorState.create({ schema, doc: schema.nodeFromJSON(docJson) });
    const tr = state.tr;
    applyStructuralRepairs(tr);
    const texts: string[] = [];
    tr.doc.descendants((n: any) => { if (n.isText) texts.push(n.text); return true; });
    return { doc: tr.doc, texts };
  }

  it('a toggle with a stray block beside its title keeps title, stray block and body, and stays a toggle', async () => {
    const { doc, texts } = await repaired({ type: 'doc', content: [{ type: 'details', content: [
      { type: 'detailsSummary', content: [t('Title')] }, p('stray'), { type: 'detailsContent', content: [p('body')] },
    ] }] });
    expect(texts).toEqual(['Title', 'stray', 'body']);
    expect(doc.child(0).type.name).toBe('details');
    expect(() => doc.check()).not.toThrow();
  });

  it('a toggle heading missing its body keeps its title', async () => {
    const { doc, texts } = await repaired({ type: 'doc', content: [{ type: 'toggleHeading', attrs: { level: 2 }, content: [
      { type: 'toggleHeadingText', content: [t('Heading')] }, p('loose'),
    ] }] });
    expect(texts).toEqual(['Heading', 'loose']);
    expect(doc.child(0).type.name).toBe('toggleHeading');
    expect(() => doc.check()).not.toThrow();
  });
});

// ── C10: copy / cut / paste in another input with a block selection left over ─

describe('C10: a block selection never takes copy, cut or paste from another input', () => {
  async function setup() {
    const { BlockClipboardController } = await import('../../src/built-in/canvas/handles/blockClipboard');
    const ed = mk({ type: 'doc', content: [p('canvas block'), p('other')] });
    const container = document.createElement('div');
    container.appendChild(ed.view.dom.parentElement ?? ed.view.dom);
    document.body.appendChild(container);
    const deleteSelected = vi.fn();
    const host = { editor: ed, editorContainer: container, blockSelection: { hasSelection: true, positions: [0], count: 1, deleteSelected, selectMultiple: vi.fn() } };
    const ctl = new BlockClipboardController(host as any);
    ctl.setup();
    const chat = document.createElement('textarea');
    document.body.appendChild(chat);
    return { ed, ctl, chat, deleteSelected, container };
  }
  function clipboardEvent(type: string) {
    const data = new Map<string, string>();
    const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
    ev.clipboardData = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '' };
    return { ev, data };
  }

  it('Ctrl+X in the chat box cuts the chat text, not the canvas block', async () => {
    const { ctl, chat, deleteSelected, container } = await setup();
    chat.focus();
    const { ev, data } = clipboardEvent('cut');
    chat.dispatchEvent(ev);
    expect(deleteSelected).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
    expect(data.size).toBe(0);
    ctl.dispose(); chat.remove(); container.remove();
  });

  it('copy with the block selected and nothing else focused still copies the block', async () => {
    const { ctl, chat, container } = await setup();
    (document.activeElement as HTMLElement | null)?.blur?.();
    const { ev, data } = clipboardEvent('copy');
    document.body.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(data.get('text/plain')).toBe('canvas block');
    ctl.dispose(); chat.remove(); container.remove();
  });
});

// ── C11: an upload that finishes after the file dialog blurred the window ────

describe('C11: inserting an uploaded image never eats the next block', () => {
  it('the file dialog blurring the window neither cancels the popup nor lets the upload land on a stale range', async () => {
    const { showImageInsertPopup } = await import('../../src/built-in/canvas/menus/imageInsertPopup');
    const ed = mk({ type: 'doc', content: [p('/image'), p('next block')] });
    (ed.view as any).coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 }); // no layout in jsdom
    let resolvePick: (v: string[]) => void = () => {};
    (window as any).parallxElectron = {
      dialog: { openFile: () => new Promise<string[]>((r) => { resolvePick = r; }) },
      fs: { readFile: async () => ({ content: 'iVBORw0KGgo=', encoding: 'base64' }) },
    };
    showImageInsertPopup(ed, { from: 0, to: ed.state.doc.child(0).nodeSize });
    (document.querySelector('.canvas-image-insert-upload-btn') as HTMLButtonElement).click();
    window.dispatchEvent(new Event('blur')); // the OS file dialog takes focus
    await new Promise((r) => setTimeout(r, 0));
    resolvePick(['/tmp/picture.png']);
    await new Promise((r) => setTimeout(r, 10));
    const outline: string[] = [];
    ed.state.doc.forEach((n: any) => outline.push(n.type.name + (n.isTextblock ? `(${n.textContent})` : '')));
    expect(outline.slice(0, 2)).toEqual(['image', 'paragraph(next block)']);
    delete (window as any).parallxElectron;
    document.querySelectorAll('.canvas-image-insert-popup').forEach((e) => e.remove());
  });
});

describe('C11: the insert follows the placeholder through other edits', () => {
  it('text typed above while the popup is open shifts the target with it', async () => {
    const { trackInsertTarget } = await import('../../src/built-in/canvas/menus/insertTarget');
    const ed = mk({ type: 'doc', content: [p('above'), p('/bookmark'), p('next block')] });
    const start = ed.state.doc.child(0).nodeSize;
    const target = trackInsertTarget(ed, { from: start, to: start + ed.state.doc.child(1).nodeSize });
    ed.view.dispatch(ed.state.tr.insertText('more text ', 1));
    target.insert({ type: 'bookmark', attrs: { url: 'https://example.com' } });
    target.dispose();
    const outline: string[] = [];
    ed.state.doc.forEach((n: any) => outline.push(n.type.name + (n.isTextblock ? `(${n.textContent})` : '')));
    expect(outline.slice(0, 3)).toEqual(['paragraph(more text above)', 'bookmark', 'paragraph(next block)']);
  });
});

// ── C14: dragging a card on a board grouped by a multi-select ────────────────

describe('C14: moving a card between board columns keeps its other tags', () => {
  it('multi-select: drop moves one tag, keeps the rest as an array', async () => {
    const { boardDropValue } = await import('../../src/built-in/canvas/database/databaseViewModel');
    expect(boardDropValue(['red', 'blue'], 'red', 'green', true)).toEqual(['blue', 'green']);
    expect(boardDropValue(['red', 'blue'], 'red', 'blue', true)).toEqual(['blue']);
    expect(boardDropValue(['red', 'blue'], 'red', '', true)).toEqual(['blue']); // onto "No tags": only this tag goes
    expect(boardDropValue([], '', 'green', true)).toEqual(['green']);
    expect(boardDropValue(['red'], 'red', 'red', true)).toEqual(['red']);
  });

  it('single select: the value is the target column (or empty)', async () => {
    const { boardDropValue } = await import('../../src/built-in/canvas/database/databaseViewModel');
    expect(boardDropValue('todo', 'todo', 'done', false)).toBe('done');
    expect(boardDropValue('todo', 'todo', '', false)).toBe(null);
  });
});

// ── C15: the legacy property migration running a second time ────────────────

describe('C15: re-running the legacy property migration never overwrites current values', () => {
  it('a value the user changed after the first run stays; an empty cell is filled', async () => {
    const { runLegacyPropertyMigration } = await import('../../src/built-in/canvas/database/legacyPropertyMigration');
    const cells: Record<string, unknown> = { status: 'done' }; // edited since the first run
    const bridge = {
      all: async (sql: string) => (/property_definitions/.test(sql)
        ? { error: null, rows: [{ name: 'Status', type: 'select', config: '{}', sort_order: 1 }, { name: 'Due', type: 'text', config: '{}', sort_order: 2 }] }
        : { error: null, rows: [
          { page_id: 'p1', key: 'Status', value_type: 'string', value: '"todo"', is_archived: 0 },
          { page_id: 'p1', key: 'Due', value_type: 'string', value: '"Friday"', is_archived: 0 },
        ] }),
      get: async () => ({ error: null, row: null }),
      run: async () => ({ error: null, changes: 0 }),
    };
    const set = vi.fn(async (_db: string, _page: string, prop: string, value: unknown) => { cells[prop] = value; });
    const db = {
      getHomeDatabaseForPage: async () => 'home-1',
      addExistingPageAsRow: async () => {},
      listProperties: async () => [{ id: 'status', name: 'Status' }, { id: 'due', name: 'Due' }],
      addProperty: async () => ({ id: 'new' }),
      getRowValues: async () => ({ ...cells }),
      setCellValue: set,
      createDatabase: async () => ({ id: 'created' }),
      reconcileSingleHome: async () => 0,
    };
    await runLegacyPropertyMigration({ bridge: bridge as any, db: db as any, writeBackup: async () => {} });
    expect(cells.status).toBe('done');
    expect(cells.due).toBe('Friday');
  });
});
