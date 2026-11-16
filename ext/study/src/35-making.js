// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 35: MAKING — a reply asked again, the concept map, a session filled as questions arrive
// ═══════════════════════════════════════════════════════════════════════════════
//
// What stands between "Start" and the first question, and what keeps a
// chapter alive when the model answers badly:
//
//   - stAskList asks again when a reply holds no list at all (prose where
//     JSON was asked, or JSON cut off before anything could be read).
//   - stBuildConceptMap reads only the pages not read before and marks a
//     section mapped once every page of it is read (36-map-pages.js);
//     stUnitMapped asks a section the old code stamped "mapped" with no
//     concepts again.
//   - stFillSession puts each question into the session the moment it is
//     stored (stEnsureBank's onKept), ordered so no two in a row share a
//     concept (stInterleaveConcepts), while the rest are still being made.
//   - stRequireModel says there is no model before a session is created.

// ── A reply that must hold a list ───────────────────────────────────────────

/** Times one prompt is asked, at most, before its reply is given up as unreadable. */
const ST_LIST_ASKS = 3;

/**
 * The list in a model reply: the first array inside its JSON object, else a
 * bare array (the readable part of one that was cut off counts). null when
 * the reply holds no list: prose, an object with no array, nothing.
 */
function stListFrom(text) {
  const obj = stExtractJsonObject(text);
  if (obj && typeof obj === 'object') {
    for (const key of Object.keys(obj)) if (Array.isArray(obj[key])) return obj[key];
  }
  let res = null;
  try { res = stExtractJsonArray(text); } catch { res = null; }
  return res && Array.isArray(res.items) && res.items.length ? res.items : null;
}

/**
 * One chat call whose reply must hold a list (the concept map, the
 * questions). A reply with none is asked again, ST_LIST_ASKS times in all:
 * the calls that write are not deterministic, so a second answer differs.
 * Returns { list, asks }; `list` is null when no reply could be read. Stop
 * and backend errors pass through.
 */
async function stAskList(modelId, system, user, options) {
  for (let asks = 1; ; asks++) {
    const list = stListFrom(await stChat(modelId, system, user, options));
    if (list || asks >= ST_LIST_ASKS) return { list, asks };
  }
}

// ── Concept map ─────────────────────────────────────────────────────────────

/**
 * Build the concept map for a section (or for a selection, given as the only
 * chunk). Per chunk the model lists concepts with a page and a verbatim
 * quote; the quote is located with stFindAnchorPage; titles are deduplicated
 * against the material's existing concepts and each other; new ones are
 * inserted. Returns the unit's concepts (the existing matches plus the new
 * rows) with `unreadable`, the number of chunks no reply could be read for.
 * Only pages not read before are asked about, and each page is recorded as
 * read or unreadable (36-map-pages.js); the section is marked mapped once
 * every page of it is read or left out, so one bad reply never closes a
 * chapter and a page read once is not read again.
 *
 * `ranges` ([[from, to], ...]) maps only those pages (the pages the section
 * owns under stPagePartition, so a chapter and its subsections never map a
 * page twice); `ownerOf(page)` files each concept under the section that
 * owns its page; `markMapped` false leaves the section unmarked (a range
 * clipped to a Pages scope is not the whole section). `quiet` reports only
 * through onProgress, for a caller that rewrites the progress (stEnsureBank).
 */
async function stBuildConceptMap(material, section, {
  modelId, numCtx = 0, token, onProgress, selectionText = '', selectionPage = 0,
  ranges = null, ownerOf = null, markMapped = true, quiet = false,
} = {}) {
  const cancelled = () => !!(token && token.cancelled);
  const model = modelId || await stPickModel(material);
  if (!model) throw stNoModelError();
  const text = await stMaterialText(material);
  const existing = await stListConcepts({ materialIds: [material.id] });
  // Headings a concept's title or quote may start with (page text opens
  // with its heading, and a model copies it): every section and outline title.
  const sectionTitles = new Map((await stListSections(material.id)).map((x) => [x.id, String(x.title || '')]));
  const headings = [...new Set([
    section && section.title ? String(section.title) : '',
    ...sectionTitles.values(),
    ...(Array.isArray(material.outline) ? material.outline.map((o) => String((o && o.title) || '')) : []),
  ].filter(Boolean))];
  const report = (done, total, writing = null) => {
    const p = { phase: 'map', done, total, part: Math.min(total, done + 1), parts: total, writing, written: 0, kept: 0, dropped: {}, materialId: material.id, sectionId: section ? section.id : 0 };
    if (onProgress) { try { onProgress(p); } catch { /* listener error is not ours */ } }
    if (!quiet) { try { bus.emit('run', p); } catch { /* bus is optional here */ } }
  };
  const sized = await stPlanFor(model, material, numCtx);

  // The chunks: page ranges of the section, or the selection as one chunk.
  // Pages already read (or left out as unreadable) are not read again; a
  // page in no chunk is blank, and counts as read.
  let chunks = [];
  let wanted = [];
  const pagesRead = [];
  const pagesUnread = [];
  if (selectionText) {
    const page = Number(selectionPage) || 0;
    chunks = [{ pageFrom: page, pageTo: page, text: `[Page ${page || 1}]\n${String(selectionText).trim()}` }];
  } else {
    const pageCount = text.pageTexts.length;
    const list = Array.isArray(ranges) && ranges.length ? ranges : [[section.pageFrom, section.pageTo]];
    const maxChars = Math.min(ST_MAP_CHUNK_CHARS, sized.maxChars);
    const clamped = list.map(([rf, rt]) => {
      const from = Math.max(1, Number(rf) || 1);
      return [from, Math.max(from, Math.min(pageCount || from, Number(rt) || from))];
    });
    wanted = stPagesIn(clamped);
    const already = stPagesDone(await stPagesRecord(material.id));
    const todo = stPageRuns(wanted.filter((p) => !already.has(p)));
    for (const [from, to] of todo) {
      const pieces = (stChunkPages(text.pageTexts, { from, to, maxChars }) || []).map((r) => {
        const block = stPageBlock(text.pageTexts, r.pageFrom, r.pageTo, maxChars);
        return { pageFrom: r.pageFrom, pageTo: r.pageTo, text: block.material };
      }).filter((c) => c.text.trim());
      if (!pieces.length) {
        const block = stPageBlock(text.pageTexts, from, to, maxChars);
        if (block.material.trim()) pieces.push({ pageFrom: from, pageTo: to, text: block.material });
      }
      chunks.push(...pieces);
    }
    const inChunks = new Set(stPagesIn(chunks.map((c) => [c.pageFrom, c.pageTo])));
    pagesRead.push(...stPagesIn(todo).filter((p) => !inChunks.has(p)));
  }
  if (!chunks.length) {
    // Nothing left to read (every page read before, or a blank or image-only stretch): mapped.
    if (!selectionText) await stNotePages(material.id, { read: pagesRead }, text.pageTexts);
    if (section && section.id && markMapped && !cancelled()) await stMarkSectionMapped(section.id, stNow());
    return Object.assign([], { unreadable: 0 });
  }

  const found = [];   // new concepts to insert: { title, summary, page, anchorQuote, flags }
  const matched = []; // existing concepts the chunk named again
  const pool = [...existing];
  let unreadable = 0;
  let failure = null;
  report(0, chunks.length);
  for (let i = 0; i < chunks.length; i++) {
    if (cancelled()) break;
    const chunk = chunks[i];
    const user = [
      selectionText
        ? 'The material below is a passage the student selected. List the concepts it teaches.'
        : `The material below is pages ${chunk.pageFrom} to ${chunk.pageTo}${section && section.title ? ` of "${section.title}"` : ''}. List the concepts it teaches.`,
      'Every "page" must be a [Page N] marker that appears in the material.',
      ...stExamContext(material),
      '',
      '--- MATERIAL ---',
      chunk.text,
    ].join('\n');
    let asked;
    try {
      asked = await stAskList(model, ST_CONCEPT_SYSTEM, user, {
        temperature: ST_TEMP_GENERATE, numCtx: sized.numCtx, json: true, token,
        onStream: (s) => report(i, chunks.length, s),
      });
    } catch (err) {
      // A backend error ends the map, after what was read so far is kept.
      if (!stIsStopped(err)) failure = err;
      break;
    }
    const chunkPages = stPagesIn([[chunk.pageFrom, chunk.pageTo]]);
    if (!asked.list) { unreadable += 1; pagesUnread.push(...chunkPages); } else pagesRead.push(...chunkPages);
    for (const raw of asked.list || []) {
      if (!raw || typeof raw !== 'object') continue;
      const rawTitle = String(raw.title || '').trim();
      if (!rawTitle) continue;
      // A leading copy of a heading comes off the title and the quote before
      // the anchor check; a title that is only its section's title is no concept.
      const ownTitle = section && section.title ? stSkeleton(section.title) : '';
      if (ownTitle && stSkeleton(rawTitle) === ownTitle) continue;
      const title = stStripLeadingHeading(rawTitle, headings) || rawTitle;
      const summary = String(raw.summary || '').trim();
      const quote = stStripLeadingHeading(String(raw.quote || '').trim(), headings);
      let page = Number(raw.page) || 0;
      if (selectionText) {
        page = Number(selectionPage) || 0;
      } else {
        const hint = page >= chunk.pageFrom && page <= chunk.pageTo ? page : chunk.pageFrom;
        const located = quote ? stFindAnchorPage(quote, text.pageTexts, hint) : 0;
        page = located || hint;
      }
      const anchorQuote = quote && (selectionText || stAnchorPageFor(quote, text.pageTexts, page)) ? quote : '';
      const owner = typeof ownerOf === 'function' && !selectionText ? sectionTitles.get(Number(ownerOf(page)) || 0) : '';
      if (owner && stSkeleton(rawTitle) === stSkeleton(owner)) continue;
      const prior = stFindSimilarConcept(title, pool);
      if (prior) {
        if (prior.id && !matched.includes(prior)) matched.push(prior);
        if (prior.id && !_stConceptFlags.has(prior.id)) stRememberFlags(prior.id, raw);
        continue;
      }
      found.push({ title, summary, page, anchorQuote, flags: raw });
      pool.push({ id: 0, title });
    }
    report(i + 1, chunks.length);
  }

  // Each new concept goes under the section that owns its page.
  const baseSection = section ? section.id : 0;
  const bySection = new Map();
  for (const f of found) {
    const sid = typeof ownerOf === 'function' && !selectionText ? (Number(ownerOf(f.page)) || baseSection) : baseSection;
    if (!bySection.has(sid)) bySection.set(sid, []);
    bySection.get(sid).push(f);
  }
  const inserted = [];
  for (const [sid, list] of bySection) {
    const rows = await stInsertConcepts(material.id, sid, list.map(({ title, summary, page, anchorQuote }) => ({ title, summary, page, anchorQuote })));
    for (let i = 0; i < rows.length; i++) stRememberFlags(rows[i].id, list[i] && list[i].flags);
    inserted.push(...rows);
  }
  let complete = !unreadable;
  if (!selectionText) {
    await stNotePages(material.id, { read: pagesRead, unread: pagesUnread }, text.pageTexts);
    const settled = stPagesDone(await stPagesRecord(material.id));
    complete = wanted.every((p) => settled.has(p));
  }
  if (failure) throw failure;
  if (section && section.id && markMapped && complete && !cancelled()) await stMarkSectionMapped(section.id, stNow());
  return Object.assign([...matched, ...inserted], { unreadable });
}

/**
 * Is a unit mapped? When every page it covers is read, or left out as
 * unreadable (`known.pagesDone`, stMapKnown), whatever was found there. A
 * unit none of whose pages has a record was mapped by the old code, which
 * counted it only when its pages hold concepts (`known`: the material's
 * concepts): a section stamped mapped with none is what a reply nobody could
 * read left behind, and it is asked again. A selection is mapped once its
 * concept ids are known.
 */
function stUnitMapped(unit, scope, known) {
  if (unit.selection) return stSelectionConceptIds(scope).length > 0;
  const done = known && known.pagesDone;
  const pages = stPagesIn(unit.ranges);
  if (done && pages.length && pages.every((p) => done.has(p))) return true;
  if (known && known.pagesSeen && pages.some((p) => known.pagesSeen.has(p))) return false;
  if (!unit.partial && !(unit.section.mappedAt > 0)) return false;
  return (known || []).some((c) => stInRanges(c.page, unit.ranges));
}

/**
 * Map one unit of a scope (stEnsureBank's first step for it). A selection's
 * concept ids go into the scope, and into the session's stored scope when
 * `sessionId` is given. Returns false when the model gave no readable
 * answer and nothing was found: the unit stays unmapped.
 */
async function stMapUnit(unit, scope, { modelId, numCtx, token, onProgress, sessionId = null } = {}) {
  let concepts;
  if (unit.selection) {
    concepts = await stBuildConceptMap(unit.material, null, {
      modelId, numCtx, token, onProgress, quiet: true, selectionText: unit.selectionText, selectionPage: unit.selectionPage,
    });
    const ids = concepts.map((c) => c.id).filter((id) => id > 0);
    _stSelectionConcepts.set(stSelectionKey(scope), ids);
    scope.conceptIds = ids;
    if (sessionId != null && ids.length) {
      const s = await stGetSession(sessionId);
      if (s) await stUpdateSession(sessionId, { scope: { ...(s.scope || {}), conceptIds: ids } });
    }
  } else {
    concepts = await stBuildConceptMap(unit.material, unit.section, {
      modelId, numCtx, token, onProgress, quiet: true, ranges: unit.ranges, ownerOf: unit.ownerOf, markMapped: !unit.partial,
    });
  }
  if (!(concepts.unreadable > 0 && !concepts.length)) return true;
  // Nothing readable this time: still a unit to write for when earlier reads filed concepts on its pages.
  return !unit.selection && (await stListConcepts({ materialIds: [unit.material.id] })).some((c) => stInRanges(c.page, unit.ranges));
}

// ── The order of a session that fills as it goes ────────────────────────────

/**
 * The order for questions joining a draw that is already under way. Pure.
 * It is stDrawSession's order, kept up as questions arrive: concepts in
 * order of need (stOrderConcepts: unasked, weak from the weakest, stale,
 * clean), each giving one question a round, counting what `placed` (the
 * draw's questions already answered or on screen, in order) has given;
 * within a round a material is not repeated while another has a turn; a
 * concept gives the class of question it should be asked in first
 * (stPreferredClass). And no two in a row share a concept while that can be
 * avoided: a concept holding more than half of what is left goes next, or
 * two of its questions would meet at the end.
 */
function stInterleaveConcepts(questions, { placed = [], concepts = [], answerFormat = 'mixed', now = 0, staleDays = 14 } = {}) {
  const list = (Array.isArray(questions) ? questions : []).filter(Boolean);
  const byId = new Map((concepts || []).map((c) => [c.id, c]));
  const seen = [...new Set(list.map((q) => q.conceptId))];
  // A concept the caller did not list comes after the listed ones, as it arrived.
  const ranked = stOrderConcepts(seen.filter((id) => byId.has(id)).map((id) => byId.get(id)), now, { staleDays })
    .map((c) => c.id).concat(seen.filter((id) => !byId.has(id)));
  const rank = new Map(ranked.map((id, i) => [id, i]));
  const queues = new Map();
  for (const id of ranked) {
    const own = list.filter((q) => q.conceptId === id);
    const want = byId.has(id) ? stPreferredClass(byId.get(id), answerFormat) : '';
    queues.set(id, own.filter((q) => stFormatClass(q.format) === want).concat(own.filter((q) => stFormatClass(q.format) !== want)));
  }
  const before = (Array.isArray(placed) ? placed : []).filter(Boolean);
  const given = new Map();
  for (const q of before) given.set(q.conceptId, (given.get(q.conceptId) || 0) + 1);
  const last = before.length ? before[before.length - 1] : null;
  let lastConcept = last ? last.conceptId : null;
  let lastMaterial = last ? (last.materialId ?? 0) : null;
  const key = (id) => [given.get(id) || 0, (queues.get(id)[0].materialId ?? 0) === lastMaterial ? 1 : 0, rank.get(id)];
  const out = [];
  for (let left = list.length; left > 0; left--) {
    const live = ranked.filter((id) => queues.get(id).length);
    const others = live.filter((id) => id !== lastConcept);
    let pick = others.find((id) => 2 * queues.get(id).length > left);
    if (pick === undefined) {
      for (const id of (others.length ? others : live)) {
        if (pick === undefined) { pick = id; continue; }
        const a = key(id), b = key(pick);
        if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) pick = id;
      }
    }
    const q = queues.get(pick).shift();
    out.push(q);
    given.set(pick, (given.get(pick) || 0) + 1);
    lastConcept = pick;
    lastMaterial = q.materialId ?? 0;
  }
  return out;
}

/** The item each session screen shows now, by session id: the pane says so (stSetOnScreen). */
const _stOnScreen = new Map();

/** The session screen shows this item now (0: none), so what joins the draw is ordered from it. */
function stSetOnScreen(sessionId, itemId) {
  if (itemId) _stOnScreen.set(Number(sessionId), Number(itemId)); else _stOnScreen.delete(Number(sessionId));
}

/**
 * Put the questions that are ready into the session's current draw, and
 * order what is still waiting. New questions (usable, in scope, not yet in
 * the session) are added until the draw holds `size`. What is answered and
 * the item on screen stay where they are; the rest follow in
 * stInterleaveConcepts order, counted from the item on screen. That is the
 * one the pane names (he may have skipped an earlier one, or answered one a
 * moment before this read), else the first unanswered. Returns { held,
 * added }: how many the draw holds now and how many this call added.
 */
async function stFeedSession(session, { size, draw }) {
  const items = await stListSessionItems(session.id);
  const mine = items.filter((i) => (Number(i.draw) || 0) === draw).sort((a, b) => (a.ord || 0) - (b.ord || 0) || a.id - b.id);
  const inSession = new Set(items.map((i) => i.questionId));
  const pool = await stScopePool(session.scope || {});
  const conceptById = new Map(pool.concepts.map((c) => [c.id, c]));
  const byId = new Map(pool.questions.map((q) => [q.id, q]));
  const order = (questions, placed) => stInterleaveConcepts(questions, {
    placed: placed.map((i) => byId.get(i.questionId)), concepts: pool.concepts,
    answerFormat: session.answerFormat, now: stNow(), staleDays: Number(cfg('staleDays', 14)) || 14,
  });
  const fresh = pool.questions.filter((q) => !inSession.has(q.id) && conceptById.has(q.conceptId));
  const room = Math.max(0, size - mine.length);
  const add = room && fresh.length ? order(fresh, mine).slice(0, room) : [];
  let added = [];
  if (add.length) {
    const formats = add.map((q) => stResolveFormat(conceptById.get(q.conceptId) || stPseudoConcept(q.conceptId), q, session.answerFormat));
    added = await stAddSessionItems(session.id, draw, add.map((q) => q.id), formats);
  }
  const isPending = (i) => !i.status || i.status === 'pending';
  const shown = _stOnScreen.get(Number(session.id));
  const head = mine.find((i) => i.id === shown && isPending(i)) || mine.find(isPending) || null;
  const fixed = mine.filter((i) => !isPending(i)).concat(head ? [head] : []);
  const waiting = mine.filter((i) => isPending(i) && i !== head).concat(added);
  if (added.length && waiting.length > 1) {
    // An item whose question left the pool (hidden since) goes last, as it was.
    const itemOf = new Map(waiting.map((i) => [i.questionId, i]));
    const known = waiting.filter((i) => byId.has(i.questionId));
    const ordered = order(known.map((i) => byId.get(i.questionId)), fixed).map((q) => itemOf.get(q.id)).concat(waiting.filter((i) => !byId.has(i.questionId)));
    const ords = waiting.map((i) => i.ord).sort((a, b) => a - b);
    const moves = ordered.map((item, k) => ({ item, ord: ords[k] })).filter((x) => x.item.ord !== x.ord);
    if (moves.length) {
      await db.runAll(moves.map((x) => ({ sql: 'UPDATE st_session_items SET ord = ? WHERE id = ?', params: [x.ord, x.item.id] })));
      _emitDataChanged();
    }
  }
  return { held: mine.length + added.length, added: added.length };
}

/**
 * A session's draw, shown as it is made. When the scope already holds a
 * draw's worth of unasked questions, or is a bank (nothing is written for
 * one), this is stNextDraw: one draw, weak concepts first. Otherwise what is
 * ready goes into the session at once (stFeedSession), stEnsureBank writes
 * the rest and each question joins the session as it is stored, and when
 * writing ends short of `size` the draw is filled with questions this
 * session asked before (stRepeatFill), as stNextDraw does. `onFed(held)`
 * hears every change to what the draw holds. Stop (the token) keeps what is
 * in the session. Returns { held, unreadable, unanswerable, unread }:
 * `unread` lists the pages in scope the model could not read (stScopeUnread).
 */
async function stFillSession(session, { token = null, onProgress = null, onFed = null } = {}) {
  const scope = session.scope || {};
  const size = Number(session.size) || Number(cfg('sessionSize', 20)) || 20;
  const draw = Number(session.refreshes) || 0;
  // A notes file edited since Study last read it is brought up to date before anything is drawn from it.
  await stNoticeEditedNotes(scope);
  const before = await stListSessionItems(session.id);
  const asked = new Set(before.map((i) => i.questionId));
  const heldBefore = before.filter((i) => (Number(i.draw) || 0) === draw).length;
  const start = await stScopePool(scope);
  const told = (held) => { if (onFed) { try { onFed(held); } catch { /* listener error is not ours */ } } };
  if (stFixedScope(scope) || (!heldBefore && start.questions.filter((q) => !asked.has(q.id)).length >= size)) {
    const drawn = await stNextDraw(session, { token, onProgress });
    told(drawn.length);
    return { held: drawn.length, unreadable: 0, unanswerable: Number(drawn.unanswerable) || 0, unread: [] };
  }
  // One feed at a time: a question stored while another is being placed waits its turn.
  // After Stop nothing more is read or placed: what the last feed held is the session.
  let chain = Promise.resolve({ held: heldBefore, added: 0 });
  const feed = () => {
    if (token && token.cancelled) return chain;
    chain = chain.then((prior) => (token && token.cancelled ? { ...prior, added: 0 } : stFeedSession(session, { size, draw }))).then((r) => { if (r.added) told(r.held); return r; });
    return chain;
  };
  let fed = await feed();
  let ensured = { unreadable: 0, unanswerable: start.unanswerable };
  if (fed.held < size && !(token && token.cancelled)) {
    ensured = await stEnsureBank(scope, {
      size: size + asked.size - heldBefore, modelId: session.model, numCtx: session.numCtx, token, onProgress, untilSize: true, sessionId: session.id,
      onKept: () => feed(),
    });
    fed = await feed();
  }
  // Writing ended short and was not stopped: the rest are questions asked before.
  if (fed.held < size && !(token && token.cancelled)) {
    const items = await stListSessionItems(session.id);
    const mine = new Set(items.filter((i) => (Number(i.draw) || 0) === draw).map((i) => i.questionId));
    const pool = await stScopePool(scope);
    const conceptById = new Map(pool.concepts.map((c) => [c.id, c]));
    const again = stRepeatFill({ items: items.filter((i) => (Number(i.draw) || 0) !== draw), questions: pool.questions.filter((q) => conceptById.has(q.conceptId)), exclude: mine, limit: size - fed.held });
    if (again.length) {
      const formats = again.map((q) => stResolveFormat(conceptById.get(q.conceptId) || stPseudoConcept(q.conceptId), q, session.answerFormat));
      await stAddSessionItems(session.id, draw, again.map((q) => q.id), formats);
      fed = { held: fed.held + again.length, added: again.length };
      told(fed.held);
    }
  }
  // Pages the model could not read are said, whether they are asked again or left out.
  const unread = token && token.cancelled ? [] : await stScopeUnread(scope);
  return { held: fed.held, unreadable: Number(ensured.unreadable) || 0, unanswerable: Number(ensured.unanswerable) || 0, unread };
}

// ── No model ────────────────────────────────────────────────────────────────

/** The error for "there is no model to ask": callers show it with a way on (Try Again, AI Settings). */
function stNoModelError(message) {
  const err = new Error(message || 'No model is available. Start the model backend, or choose a model in AI Settings.');
  err.stNoModel = true;
  return err;
}

function stIsNoModel(err) {
  return !!(err && err.stNoModel);
}

/**
 * The model a making would use, checked against what the backend lists now.
 * Throws stNoModelError when there is none, before anything is created, so
 * a start without a model leaves no session and no tab behind.
 */
async function stRequireModel(preferred, scope) {
  const firstMaterial = scope && Array.isArray(scope.materialIds) && scope.materialIds.length ? scope.materialIds[0] : null;
  let material = null;
  try { material = firstMaterial != null ? await stGetMaterial(firstMaterial) : null; } catch { material = null; }
  let listed = [];
  try { listed = (_api.lm && typeof _api.lm.getModels === 'function' ? await _api.lm.getModels() : []) || []; } catch { listed = []; }
  const id = String(preferred || '').trim() || (listed.length ? await stPickModel(material) : null);
  if (!id || !listed.length) throw stNoModelError();
  if (!listed.some((m) => m && m.id === id)) throw stNoModelError(`No model named ${id} is available. Choose another model, or start it in the model backend.`);
  return id;
}

/** The command that opens the app's model settings, or '' when the app has none to offer. */
async function stModelSettingsCommand() {
  try {
    const all = (await _api.commands.getCommands()) || [];
    return all.includes('ai-settings.open') ? 'ai-settings.open' : '';
  } catch { return ''; }
}

/**
 * Start a session from a command (no sheet to show a message on). With no
 * model, an error message with Try Again and, when the app offers it, Open
 * AI Settings; nothing is created. Returns the session, or null.
 */
async function stStartOrSay(args) {
  try {
    return await stStartSession(args);
  } catch (err) {
    if (!stIsNoModel(err)) throw err;
    const settings = await stModelSettingsCommand();
    const actions = [{ title: 'Try Again' }].concat(settings ? [{ title: 'Open AI Settings' }] : []);
    const picked = await _api.window.showErrorMessage(stPlainError(err), ...actions);
    if (picked && picked.title === 'Try Again') return stStartOrSay(args);
    if (picked && picked.title === 'Open AI Settings') await _api.commands.executeCommand(settings);
    return null;
  }
}
