// studyMapKeeps.test.ts — what the concept map has read stays read, and an
// edited notes file keeps each concept with its passage
// (ext/study/src/35-making.js, 36-map-pages.js, 24-text-edits.js), through
// the generated main.js against SQLite with every migration and a scripted
// model.
//
// From an independent review (2026-11-16): a section the model answered
// readably with nothing, or whose concepts matched ones filed elsewhere, was
// asked about again on every start; a long chapter with one part never
// readable re-read every part on every start and filed the same quote twice,
// and he was never told; a notes file with one heading added lost every map
// and left old concepts on parts that now hold other headings; Stop did not
// keep the session from being read and fed afterwards.

import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const NAMES = [
  '__testables', 'stIngestPdf', 'stIngestTextFile', 'stListSections', 'stListConcepts', 'stListQuestions', 'stEnsureBank',
  'stCreateSession', 'stFillSession', 'stListSessionItems', 'stMarkSectionMapped', 'stMaterialText', 'stGetMaterial', 'stUnreadText',
];
const MIGRATIONS = join(__dirname, '../../ext/study/db/migrations');

type Study = Record<string, any>;

function loadStudy(): Study {
  const src = readFileSync(join(__dirname, '../../ext/study/main.js'), 'utf8').replace(/^export\s+(?=(?:async\s+)?function|const|let)/gm, '');
  return new Function(`'use strict';\n${src}\nreturn { ${NAMES.map((n) => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ')} };`)() as Study;
}

function freshDb() {
  const d = new DatabaseSync(':memory:');
  d.exec('PRAGMA foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()) d.exec(readFileSync(join(MIGRATIONS, f), 'utf8'));
  return d;
}

const isMap = (system: string) => system.startsWith('You read a passage');

/**
 * Study loaded in a fresh module scope (a fresh scope over the same `sql` is
 * a restart: nothing in memory survives), with a scripted model. `log`
 * collects every SQL statement run, for the Stop test.
 */
function harness(opts: { sql?: DatabaseSync; pdfs?: Record<string, { pages: string[] }>; files?: Record<string, string>; model: (s: string, u: string) => string; conf?: Record<string, unknown> }) {
  const S = loadStudy();
  const sql = opts.sql || freshDb();
  const calls: { system: string; user: string }[] = [];
  const log: string[] = [];
  const conf = { checkNumeric: false, ...(opts.conf || {}) };
  const wrap = (q: string, fn: () => object) => { log.push(q); try { return { error: null, ...fn() }; } catch (e: any) { return { error: { message: e.message } }; } };
  const api: any = {
    database: {
      get: async (q: string, p: unknown[] = []) => wrap(q, () => ({ row: sql.prepare(q).get(...(p as any[])) ?? null })),
      all: async (q: string, p: unknown[] = []) => wrap(q, () => ({ rows: sql.prepare(q).all(...(p as any[])) })),
      run: async (q: string, p: unknown[] = []) => wrap(q, () => { const r = sql.prepare(q).run(...(p as any[])); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; }),
    },
    workspace: {
      getConfiguration: () => ({ get: (k: string, f: unknown) => (k in conf ? (conf as any)[k] : f) }),
      workspaceFolders: [{ uri: 'file:///ws', name: 'ws' }],
      fs: { readFile: async (uri: string) => ({ content: (opts.files || {})[uri] ?? '' }), exists: async () => true },
    },
    lm: {
      getActiveModel: async () => 'fake-model', getModels: async () => [{ id: 'fake-model' }], getModelInfo: async () => ({ contextLength: 32768 }),
      sendChatRequest: (_m: string, messages: { content: string }[]) => {
        const system = messages[0].content, user = messages[1].content;
        calls.push({ system, user });
        const out = opts.model(system, user);
        return (async function* () { yield { content: out }; })();
      },
    },
  };
  S.__testables.__setApi(api);
  (globalThis as any).parallxElectron = {
    document: {
      extractText: async (path: string) => {
        const pdf = (opts.pdfs || {})[path];
        if (!pdf) return { error: { message: 'missing' } };
        return { text: pdf.pages.join('\n\n'), pageTexts: pdf.pages, metadata: { pageCount: pdf.pages.length, title: '' }, outline: [] };
      },
    },
  };
  const maps = () => calls.filter((c) => isMap(c.system));
  return { S, sql, calls, maps, log };
}

afterEach(() => { delete (globalThis as any).parallxElectron; });

/** The pages a map call asked about, as "from-to". */
const pagesOf = (user: string) => { const m = /pages (\d+) to (\d+)/.exec(user); return m ? `${m[1]}-${m[2]}` : '?'; };

describe('a section read once is not read again', () => {
  // Four numbered sections, one page each: a preface-like page that teaches
  // nothing, a summary whose concept is one already filed, and a page whose
  // quote is placed on another page.
  const titles = ['Loglogistic Growth Curve', 'References And Further Reading', 'Summary Of The Chapter', 'Cape Cod Expected Ratio'];
  const pages = titles.map((t, i) => `${i + 1}. ${t}\nThe ${t.toLowerCase()} is set out on this page in plain words for study ${i + 1}.\nFurther discussion follows with enough words to make a page of text worth reading.`);
  const quote = (p: number) => pages[p - 1].split('\n')[1];
  const model = (s: string, u: string) => {
    if (!isMap(s)) return JSON.stringify({ questions: [] });
    const page = Number((/\[Page (\d+)\]/.exec(u.slice(u.indexOf('--- MATERIAL ---'))) || [])[1]);
    if (page === 2) return JSON.stringify({ concepts: [] });
    if (page === 3) return JSON.stringify({ concepts: [{ title: 'Loglogistic growth curve', summary: 's', page: 3, quote: quote(3) }] });
    if (page === 4) return JSON.stringify({ concepts: [{ title: 'Expected ratio by premium', summary: 's', page: 4, quote: quote(1) }] });
    return JSON.stringify({ concepts: [{ title: 'Loglogistic growth curve', summary: 's', page: 1, quote: quote(1) }] });
  };

  it('a readable empty reply, a concept filed elsewhere and a quote on another page each leave the section mapped: later starts ask nothing', async () => {
    const h = harness({ pdfs: { '/ws/a.pdf': { pages } }, model });
    const m = await h.S.stIngestPdf('/ws/a.pdf');
    expect((await h.S.stListSections(m.id)).map((s: any) => [s.pageFrom, s.pageTo])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]]);
    const scope = { kind: 'document', materialIds: [m.id], label: 'A' };
    await h.S.stEnsureBank(scope, {});
    expect(h.maps().map((c) => pagesOf(c.user)).sort()).toEqual(['1-1', '2-2', '3-3', '4-4']);
    expect((await h.S.stListSections(m.id)).every((s: any) => s.mappedAt > 0)).toBe(true);
    for (let start = 2; start <= 3; start++) {
      const before = h.maps().length;
      await h.S.stEnsureBank(scope, {});
      expect(h.maps().slice(before).map((c) => pagesOf(c.user)), `start ${start}`).toEqual([]);
    }
    // A restart changes nothing: what was read is in the database.
    const r = harness({ sql: h.sql, pdfs: { '/ws/a.pdf': { pages } }, model });
    await r.S.stEnsureBank(scope, {});
    expect(r.maps()).toEqual([]);
  });

  it('a section the old code stamped mapped with no concepts (a reply nobody could read) is still asked again', async () => {
    const h = harness({ pdfs: { '/ws/a.pdf': { pages } }, model });
    const m = await h.S.stIngestPdf('/ws/a.pdf');
    const first = (await h.S.stListSections(m.id))[0];
    await h.S.stMarkSectionMapped(first.id, 1_700_000_000_000);
    await h.S.stEnsureBank({ kind: 'chapter', materialIds: [m.id], sectionIds: [first.id], pageFrom: 1, pageTo: 1, label: 'One' }, {});
    expect(h.maps().map((c) => pagesOf(c.user))).toEqual(['1-1']);
    expect((await h.S.stListConcepts({ materialIds: [m.id] })).map((c: any) => c.page)).toEqual([1]);
  });
});

describe('a long chapter with one part the model never answers readably', () => {
  const filler = (n: number) => Array.from({ length: 400 }, (_, i) => `Sentence ${i} of page ${n} carries enough words to be long.`).join(' ');
  const pages = [
    `The loglogistic growth curve is fit to the average of the paid losses at each age.\n${filler(1)}`,
    `Tables of development factors by accident year and age follow below in rows.\n${filler(2)}`,
  ];
  const phrasing = ['Loglogistic Growth Curve', 'Fitting the loglogistic curve to paid losses', 'Growth curve shape (loglogistic)'];
  const makeModel = () => {
    let k = 0;
    return (s: string, u: string) => {
      if (!isMap(s)) return JSON.stringify({ questions: [] });
      const mat = u.slice(u.indexOf('--- MATERIAL ---'));
      if (/\[Page 2\]/.test(mat) && !/\[Page 1\]/.test(mat)) return 'Sure! The table shows factors.';
      return JSON.stringify({ concepts: [{ title: phrasing[k++ % phrasing.length], summary: 's', page: 1, quote: 'The loglogistic growth curve is fit to the average of the paid losses at each age.' }] });
    };
  };

  it('the part read once is not read again, its concept is filed once, and the unreadable part is told and left out after two starts', async () => {
    const h = harness({ pdfs: { '/ws/b.pdf': { pages } }, model: makeModel(), conf: { sessionSize: 2 } });
    const m = await h.S.stIngestPdf('/ws/b.pdf');
    expect((await h.S.stListSections(m.id)).map((s: any) => [s.pageFrom, s.pageTo])).toEqual([[1, 2]]);
    const scope = { kind: 'document', materialIds: [m.id], label: 'B' };
    const perStart: string[][] = [];
    const told: any[] = [];
    for (let start = 1; start <= 3; start++) {
      const before = h.maps().length;
      const session = await h.S.stCreateSession({ name: 'B', scope, mode: 'practice', answerFormat: 'mixed', size: 2 });
      const res = await h.S.stFillSession(session, {});
      perStart.push(h.maps().slice(before).map((c) => pagesOf(c.user)));
      told.push(res.unread);
    }
    // Start 1: both parts, the bad one three times. Start 2: only the bad one, three times. Start 3: nothing.
    expect(perStart).toEqual([['1-1', '2-2', '2-2', '2-2'], ['2-2', '2-2', '2-2'], []]);
    expect((await h.S.stListConcepts({ materialIds: [m.id] })).map((c: any) => c.title)).toEqual(['Loglogistic Growth Curve']);
    // He is told on every start: asked again next time, then left out.
    expect(told.map((u) => (u || []).map((x: any) => [x.materialId, x.ranges, x.givenUp]))).toEqual([
      [[m.id, [[2, 2]], false]],
      [[m.id, [[2, 2]], true]],
      [[m.id, [[2, 2]], true]],
    ]);
    expect(h.S.stUnreadText(told[0])).toMatch(/could not read page 2 of .*asked again/i);
    expect(h.S.stUnreadText(told[1])).toMatch(/could not read page 2 of .*left out/i);
    expect(h.S.stUnreadText([])).toBe('');
    // The section is complete now: mapped, so it does not count as unmapped forever.
    expect((await h.S.stListSections(m.id))[0].mappedAt).toBeGreaterThan(0);
  });
});

describe('an edited notes file keeps each concept with its passage', () => {
  const para = (t: string) => `The ${t} is explained here in a full sentence that a quote can be taken from without trouble.`;
  const v1 = ['# Reserving', para('chain ladder method'), '', '## Cape Cod', para('cape cod expected ratio'), '', '## Benktander', para('benktander credibility mix'), ''].join('\n');
  const v2 = ['# Reserving', para('chain ladder method'), '', '## Mack', para('mack standard error formula'), '', '## Cape Cod', para('cape cod expected ratio'), '', '## Benktander', para('benktander credibility mix'), ''].join('\n');
  const URI = 'file:///ws/notes.md';
  // Titles worded differently on each call, so a part read twice would file its concept twice.
  const makeModel = () => {
    let n = 0;
    return (s: string, u: string) => {
      if (!isMap(s)) return JSON.stringify({ questions: [] });
      const out = [];
      for (const m of u.slice(u.indexOf('--- MATERIAL ---')).matchAll(/\[Page (\d+)\]\n[^\n]*\n([^\n]+)/g)) {
        const t = /The (.*) is explained/.exec(m[2]);
        if (t) out.push({ title: (n++ % 2 ? 'The ' : '') + t[1] + (n % 3 ? '' : ' approach'), summary: 's', page: Number(m[1]), quote: m[2] });
      }
      return JSON.stringify({ concepts: out });
    };
  };
  const where = async (S: Study, materialId: number) => {
    const sections = await S.stListSections(materialId);
    const title = new Map(sections.map((s: any) => [s.id, s.title]));
    return (await S.stListConcepts({ materialIds: [materialId] }))
      .map((c: any) => `${/(chain ladder|cape cod|benktander|mack)/.exec(c.title.toLowerCase())?.[1]}@${c.page}:${title.get(c.sectionId) ?? `gone ${c.sectionId}`}`)
      .sort();
  };
  const AFTER = ['benktander@4:Benktander', 'cape cod@3:Cape Cod', 'chain ladder@1:Reserving', 'mack@2:Mack'];

  const mapV1 = async () => {
    const files = { [URI]: v1 };
    const h = harness({ files, model: makeModel() });
    const m = await h.S.stIngestTextFile('/ws/notes.md');
    await h.S.stEnsureBank({ kind: 'document', materialIds: [m.id], label: 'N' }, {});
    expect(await where(h.S, m.id)).toEqual(['benktander@3:Benktander', 'cape cod@2:Cape Cod', 'chain ladder@1:Reserving']);
    const sections = await h.S.stListSections(m.id);
    expect(sections.every((s: any) => s.mappedAt > 0)).toBe(true);
    return { h, files, m, sections };
  };

  it('added again after one heading was inserted: unchanged sections keep their map, concepts move with their quotes, only the new part is read', async () => {
    const { h, files, m, sections: was } = await mapV1();
    files[URI] = v2;
    await h.S.stIngestTextFile('/ws/notes.md');
    const now = await h.S.stListSections(m.id);
    expect(now.map((s: any) => `${s.title}[${s.pageFrom}-${s.pageTo}]`)).toEqual(['Reserving[1-4]', 'Mack[2-2]', 'Cape Cod[3-3]', 'Benktander[4-4]']);
    const byTitle = (list: any[], t: string) => list.find((s) => s.title === t);
    for (const t of ['Reserving', 'Cape Cod', 'Benktander']) {
      expect(byTitle(now, t).id, t).toBe(byTitle(was, t).id);
      expect(byTitle(now, t).mappedAt, t).toBe(byTitle(was, t).mappedAt);
    }
    expect(byTitle(now, 'Mack').mappedAt).toBe(0);
    expect(await where(h.S, m.id)).toEqual(['benktander@4:Benktander', 'cape cod@3:Cape Cod', 'chain ladder@1:Reserving']);
    const before = h.maps().length;
    await h.S.stEnsureBank({ kind: 'document', materialIds: [m.id], label: 'N' }, {});
    expect(h.maps().slice(before).map((c) => pagesOf(c.user))).toEqual(['2-2']);
    expect(await where(h.S, m.id)).toEqual(AFTER);
  });

  it('edited while the app was closed: the next start notices the file changed and does the same, without adding it again', async () => {
    const { h, files, m } = await mapV1();
    files[URI] = v2;
    const r = harness({ sql: h.sql, files, model: makeModel() });
    const scope = { kind: 'document', materialIds: [m.id], label: 'N' };
    const session = await r.S.stCreateSession({ name: 'N', scope, mode: 'practice', answerFormat: 'mixed', size: 2 });
    await r.S.stFillSession(session, {});
    expect(r.maps().map((c) => pagesOf(c.user))).toEqual(['2-2']);
    expect(await where(r.S, m.id)).toEqual(AFTER);
    expect((await r.S.stGetMaterial(m.id)).pageCount).toBe(4);
  });

  it('read after a restart, its text and its sections agree: the stored hash is compared with the file', async () => {
    const { h, files, m } = await mapV1();
    files[URI] = v2;
    const r = harness({ sql: h.sql, files, model: makeModel() });
    const text = await r.S.stMaterialText(await r.S.stGetMaterial(m.id));
    expect(text.pageCount).toBe(4);
    expect((await r.S.stListSections(m.id)).map((s: any) => s.title)).toEqual(['Reserving', 'Mack', 'Cape Cod', 'Benktander']);
    expect(await where(r.S, m.id)).toEqual(['benktander@4:Benktander', 'cape cod@3:Cape Cod', 'chain ladder@1:Reserving']);
  });
});

describe('Stop is the end of the session\'s making', () => {
  const titles = ['Loglogistic Growth Curve', 'Weibull Tail Behaviour', 'Cape Cod Expected Ratio', 'Development Factor Method'];
  const pages = titles.map((t, i) => `${i + 1}. ${t}\nThe ${t.toLowerCase()} is set out on this page in plain words for study ${i + 1}.\nFurther discussion follows with enough words to make a page of text worth reading.`);
  const model = (s: string, u: string) => {
    if (isMap(s)) {
      const out = [];
      for (const m of u.slice(u.indexOf('--- MATERIAL ---')).matchAll(/\[Page (\d+)\]\n[^\n]*\n([^\n]+)/g)) out.push({ title: titles[Number(m[1]) - 1], summary: 's', page: Number(m[1]), quote: m[2] });
      return JSON.stringify({ concepts: out });
    }
    if (s.startsWith('You write questions')) {
      const qs = [];
      for (const line of u.split('\n')) {
        const m = /^- id (\d+): (.*?)\. .*Taught on page (\d+)\. Write: (.*)\.$/.exec(line);
        if (!m) continue;
        const quote = pages[Number(m[3]) - 1].split('\n')[1];
        for (const k of [0, 1]) qs.push({ concept: Number(m[1]), format: 'short', stem: `State ${m[2]} (${k}).`, answer: quote, rubric: [{ text: quote, required: true }], quote, page: Number(m[3]), explanation: 'e' });
      }
      return JSON.stringify({ questions: qs });
    }
    if (s.startsWith('You check whether a quotation')) return JSON.stringify({ settles: true, reason: 'r' });
    return '{}';
  };

  it('after Stop the session is neither read nor fed again', async () => {
    const h = harness({ pdfs: { '/ws/c.pdf': { pages } }, model, conf: { sessionSize: 6, questionsPerConcept: 2, checkSupport: false, checkDistractors: false } });
    const m = await h.S.stIngestPdf('/ws/c.pdf');
    const session = await h.S.stCreateSession({ name: 'C', scope: { kind: 'document', materialIds: [m.id], label: 'C' }, mode: 'practice', answerFormat: 'type', size: 6 });
    const token = { cancelled: false };
    let at = -1;
    const res = await h.S.stFillSession(session, { token, onFed: (held: number) => { if (held === 1 && at < 0) { token.cancelled = true; at = h.log.length; } } });
    expect(at).toBeGreaterThan(0);
    const after = h.log.slice(at).filter((q) => /st_session_items/.test(q));
    expect(after).toEqual([]);
    expect(res.held).toBe(1);
    expect(await h.S.stListSessionItems(session.id)).toHaveLength(1);
  });
});
