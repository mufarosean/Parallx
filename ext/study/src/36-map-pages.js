// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 36: PAGES READ — what the concept map has read, kept per page
// ═══════════════════════════════════════════════════════════════════════════════
//
// A section is mapped when the model has read every page it owns, whatever
// it found there: a preface answered readably with no concepts, a summary
// whose concepts were all filed already, a page whose quotes sit on another
// page. That is recorded, per page, in st_materials.map_pages_json
// (study_003): { "<page>": { s: 'read' | 'unread', n, h } }. So a page read
// once is never read again (a long chapter cut into parts does not re-read
// the parts it has; the same quote is not filed twice), and a part the model
// never answers readably is asked again on the next start and then, after
// ST_MAP_GIVE_UP starts, left out and said so (stUnreadText). `h` is the
// page text's hash when it was read, so an edited notes file keeps what did
// not change (24-text-edits.js).
//
// A section the old code stamped mapped with no record of its pages is
// judged as it was (concepts on its pages), so the dead state that left
// (mapped, with no concepts) is still asked again.

/** Starts on which a page's map may come back unreadable before the page is left out. */
const ST_MAP_GIVE_UP = 2;

/** One read-modify-write of a material's pages at a time (two makings can share a material). */
const _stPagesChain = new Map();

/** The material's page record: { [page]: { s, n, h } }. */
async function stPagesRecord(materialId) {
  const row = await db.get('SELECT map_pages_json AS j FROM st_materials WHERE id = ?', [materialId]);
  const rec = stParseJson(row && row.j, {});
  return rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : {};
}

/** Write the page record: `change(record)` edits it in place. Serialized per material. */
async function stUpdatePages(materialId, change) {
  const id = Number(materialId);
  const prior = _stPagesChain.get(id) || Promise.resolve();
  const next = prior.catch(() => {}).then(async () => {
    const rec = await stPagesRecord(id);
    change(rec);
    await db.run('UPDATE st_materials SET map_pages_json = ? WHERE id = ?', [JSON.stringify(rec), id]);
  });
  _stPagesChain.set(id, next);
  try { await next; } finally { if (_stPagesChain.get(id) === next) _stPagesChain.delete(id); }
}

/** Is this record entry a page that needs no more asking: read, or left out as unreadable? */
function stPageSettled(entry) {
  return !!entry && (entry.s === 'read' || (entry.s === 'unread' && (Number(entry.n) || 0) >= ST_MAP_GIVE_UP));
}

/** The pages of a record that need no more asking. Pure. */
function stPagesDone(record) {
  const out = new Set();
  for (const [p, e] of Object.entries(record || {})) if (stPageSettled(e)) out.add(Number(p));
  return out;
}

/** Each page of [[from, to], ...], in order. Pure. */
function stPagesIn(ranges) {
  const out = [];
  for (const [a, b] of Array.isArray(ranges) ? ranges : []) for (let p = Number(a) || 0; p <= (Number(b) || 0); p++) if (p >= 1) out.push(p);
  return out;
}

/** Pages as [[from, to], ...] runs, sorted. Pure. */
function stPageRuns(pages) {
  const sorted = [...new Set((pages || []).map(Number).filter((p) => p >= 1))].sort((a, b) => a - b);
  const runs = [];
  for (const p of sorted) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p; else runs.push([p, p]);
  }
  return runs;
}

/** The material's concepts as stUnitMapped reads them, carrying the pages that need no more asking. */
async function stMapKnown(material) {
  const known = await stListConcepts({ materialIds: [material.id] });
  const record = await stPagesRecord(material.id);
  known.pagesDone = stPagesDone(record);
  known.pagesSeen = new Set(Object.keys(record).map(Number));
  return known;
}

/**
 * After one map of a section's pages: `read` pages (answered readably, or
 * blank) are recorded with their text's hash; `unread` pages count one more
 * start on which no reply could be read.
 */
async function stNotePages(materialId, { read = [], unread = [] } = {}, pageTexts = []) {
  if (!read.length && !unread.length) return;
  await stUpdatePages(materialId, (rec) => {
    for (const p of read) rec[p] = { s: 'read', h: stHashText(String(pageTexts[p - 1] || '')) };
    for (const p of unread) {
      const e = rec[p];
      if (e && e.s === 'read') continue;
      rec[p] = { s: 'unread', n: (e && e.s === 'unread' ? Number(e.n) || 0 : 0) + 1, h: stHashText(String(pageTexts[p - 1] || '')) };
    }
  });
}

/**
 * The pages in a scope the model could not read: [{ materialId, label,
 * ranges, givenUp }], one per material and state (asked again next start,
 * or left out). Selections have no pages to record.
 */
async function stScopeUnread(scope) {
  const out = [];
  if (!scope || stFixedScope(scope) || scope.kind === 'weak' || scope.kind === 'selection') return out;
  for (const { material, units } of await stScopeUnits(scope)) {
    const rec = await stPagesRecord(material.id);
    const pages = stPagesIn(units.flatMap((u) => u.ranges || [])).filter((p) => rec[p] && rec[p].s === 'unread');
    for (const givenUp of [false, true]) {
      const these = pages.filter((p) => stPageSettled(rec[p]) === givenUp);
      if (these.length) out.push({ materialId: material.id, label: material.label, ranges: stPageRuns(these), givenUp });
    }
  }
  return out;
}

/** What he is told about pages the model could not read, or ''. Pure. */
function stUnreadText(unread) {
  const list = Array.isArray(unread) ? unread : [];
  const words = (ranges) => {
    const n = stPagesIn(ranges).length;
    const parts = ranges.map(([a, b]) => (a === b ? `${a}` : `${a} to ${b}`));
    return `${n === 1 ? 'page' : 'pages'} ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}`;
  };
  return list.map((u) => `The model could not read ${words(u.ranges)} of ${u.label}; ${u.givenUp ? 'no questions come from there (it was left out after two starts).' : 'it is asked again on the next start.'}`).join(' ');
}
