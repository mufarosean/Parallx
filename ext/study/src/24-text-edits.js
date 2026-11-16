// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 24: AN EDITED NOTES FILE — what did not change keeps its map
// ═══════════════════════════════════════════════════════════════════════════════
//
// Notes are the files he edits. A notes file whose text no longer has the
// hash Study stored (he added it again, or it changed while the app was
// closed, or since the last start) is brought up to date in one step,
// stTextEdited, before anything reads its parts:
//
//   - Its parts are cut again. A part whose text is unchanged (the hash
//     36-map-pages.js recorded when it was read) keeps its record under its
//     new number, so it is not read again.
//   - Its sections are its headings again. A section keeps its row (and so
//     its id, which a chapter scope names) when its title is still there,
//     and keeps its mapped_at only when every page it owns is unchanged.
//   - Each concept and question moves with its passage: placed again by its
//     quote, else by its unchanged part; one whose passage is gone has no
//     page (page 0), so it stays in the document's questions but in no
//     chapter. A concept is filed under the section that owns its new page.

/** A notes file's sections, as ingest stores them: its headings, else the whole file. */
function stTextSections(r) {
  const outlined = stSectionsFromOutline(r.outline, r.pageCount);
  return stNormalizeSections(outlined.length ? outlined : [{ title: 'Whole file', pageFrom: 1, pageTo: r.pageCount }], r.pageCount);
}

/** One update of a notes material at a time: two readers after a restart must not both rebuild it. */
const _stTextEditChain = new Map();

/** The pages each section owns (stPagePartition), by index into `sections`. Pure. */
function stOwnedPages(sections, pageCount) {
  const owned = sections.map(() => []);
  for (const r of stPagePartition(sections, pageCount)) for (let p = r.pageFrom; p <= r.pageTo; p++) owned[r.index].push(p);
  return owned;
}

/**
 * Bring a notes material up to date with its file's text `r` (from
 * stReadTextMaterial). Nothing happens when the stored hash already matches.
 * Returns the material as stored now, or null when it is gone.
 */
async function stTextEdited(materialId, r) {
  const id = Number(materialId);
  const prior = _stTextEditChain.get(id) || Promise.resolve();
  const next = prior.catch(() => {}).then(() => stApplyTextEdit(id, r));
  _stTextEditChain.set(id, next);
  try { return await next; } finally { if (_stTextEditChain.get(id) === next) _stTextEditChain.delete(id); }
}

async function stApplyTextEdit(id, r) {
  const row = await db.get('SELECT * FROM st_materials WHERE id = ?', [id]);
  if (!row) return null;
  const material = stRowToMaterial(row);
  const hash = stHashText(r.text);
  if (material.contentHash === hash) return material;
  const parts = r.pageTexts;

  // Old pages whose text is unchanged, and the new page that holds it.
  const record = await stPagesRecord(id);
  const freeByHash = new Map();
  parts.forEach((t, i) => {
    const h = stHashText(String(t || ''));
    if (!freeByHash.has(h)) freeByHash.set(h, []);
    freeByHash.get(h).push(i + 1);
  });
  const moved = new Map();
  for (const p of Object.keys(record).map(Number).sort((a, b) => a - b)) {
    const free = (record[p] && freeByHash.get(record[p].h)) || [];
    if (!free.length) continue;
    // The nearest copy, when a part's text stands twice.
    free.sort((a, b) => Math.abs(a - p) - Math.abs(b - p) || a - b);
    moved.set(p, free.shift());
  }

  // Sections: matched by title in order; mapped_at kept only when every page it owns moved unchanged.
  const oldSections = await stSectionsWithLevels(material);
  const oldOwned = stOwnedPages(oldSections, material.pageCount);
  const next = stTextSections(r);
  const newOwned = stOwnedPages(next, r.pageCount);
  const pool = oldSections.map((s, i) => ({ s, owned: oldOwned[i] }));
  const ops = [];
  next.forEach((s, i) => {
    const k = pool.findIndex((o) => o.s.title === s.title);
    const old = k >= 0 ? pool.splice(k, 1)[0] : null;
    const now = newOwned[i];
    const same = !!old && old.owned.length === now.length && old.owned.every((p, j) => record[p] && record[p].s === 'read' && moved.get(p) === now[j]);
    const mappedAt = same ? old.s.mappedAt || 0 : 0;
    ops.push(old
      ? { sql: 'UPDATE st_sections SET title = ?, page_from = ?, page_to = ?, ord = ?, mapped_at = ? WHERE id = ?', params: [s.title, s.pageFrom, s.pageTo, i, mappedAt, old.s.id] }
      : { sql: 'INSERT INTO st_sections (material_id, title, page_from, page_to, ord, mapped_at) VALUES (?, ?, ?, ?, ?, ?)', params: [id, s.title, s.pageFrom, s.pageTo, i, 0] });
  });
  for (const gone of pool) ops.push({ sql: 'DELETE FROM st_sections WHERE id = ?', params: [gone.s.id] });
  ops.push({ sql: 'UPDATE st_materials SET page_count = ?, content_hash = ?, outline_json = ? WHERE id = ?', params: [r.pageCount, hash, JSON.stringify(next), id] });
  await db.runAll(ops);
  await stUpdatePages(id, (rec) => {
    const kept = {};
    for (const [p, q] of moved) kept[q] = record[p];
    for (const k of Object.keys(rec)) delete rec[k];
    Object.assign(rec, kept);
  });

  // Concepts and questions move with their passages.
  const sections = await stListSections(id);
  const owner = new Map();
  stOwnedPages(sections.map((s, i) => ({ ...s, level: Number(next[i] && next[i].level) || 0 })), r.pageCount)
    .forEach((pages, i) => { for (const p of pages) owner.set(p, sections[i].id); });
  const questions = await stListQuestions({ materialIds: [id], includeHidden: true });
  const quoteOf = new Map();
  for (const q of questions) if (q.sourceQuote && !quoteOf.has(q.conceptId)) quoteOf.set(q.conceptId, q.sourceQuote);
  const place = (quote, page) => (quote ? stFindAnchorPage(quote, parts, moved.get(page) || page) : 0) || moved.get(page) || 0;
  const updates = [];
  for (const c of await stListConcepts({ materialIds: [id] })) {
    const page = place(c.anchorQuote || quoteOf.get(c.id) || '', c.page);
    const sectionId = owner.get(page) || 0;
    if (page !== c.page || sectionId !== c.sectionId) updates.push({ sql: 'UPDATE st_concepts SET page = ?, section_id = ? WHERE id = ?', params: [page, sectionId, c.id] });
  }
  for (const q of questions) {
    const page = place(q.sourceQuote || '', q.sourcePage);
    if (page !== q.sourcePage) updates.push({ sql: 'UPDATE st_questions SET source_page = ? WHERE id = ?', params: [page, q.id] });
  }
  if (updates.length) await db.runAll(updates);
  const updated = await stGetMaterial(id);
  stTextCachePut(stTextCacheKey(updated), { pageTexts: parts, text: r.text, pageCount: r.pageCount });
  _emitDataChanged();
  return updated;
}

/**
 * Before a making: every notes file in the scope is read and, when its text
 * changed since Study stored it, brought up to date (stTextEdited). A file
 * that cannot be read now is left as it was; the making says so if it must.
 */
async function stNoticeEditedNotes(scope) {
  const ids = new Set(Array.isArray(scope && scope.materialIds) ? scope.materialIds.map(Number) : []);
  for (const id of ids) {
    const material = await stGetMaterial(id);
    if (!material || material.kind !== 'text') continue;
    let r;
    try { r = await stReadTextMaterial(stFsPathOf(material.uri)); } catch { continue; }
    if (stHashText(r.text) !== material.contentHash) await stTextEdited(id, r);
  }
}
