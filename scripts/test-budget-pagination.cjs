// Test for the Gmail pagination loop in ext/budget/main.js (sync).
// Mocks the MCP tool to return batches and asserts:
//   (1) loop keeps pulling until a short page arrives
//   (2) total fetched count is >> the 100-per-page server limit
//   (3) `since` cursor advances by oldest+1ms between pages
//   (4) duplicate ids across batch boundaries are de-duped
//   (5) loop terminates on empty batch
//   (6) hard 50-page safety belt stops a degenerate server loop
//   (7) when there's nothing new, one call, zero messages — no infinite loop

let failures = 0;
const assert = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) failures++; };

// Mirror of the production pagination loop. Tests the algorithm without
// involving real MCP / SQLite. If you change ext/budget/main.js:6429-6489
// you MUST mirror the change here.
async function paginate(invokeMock, sinceIso) {
  const PAGE_SIZE = 100;
  const HARD_PAGE_LIMIT = 50;
  const seenIds = new Set();
  const messages = [];
  let pageSinceIso = sinceIso;
  let pageCount = 0;
  const pageSinceHistory = [];
  while (pageCount < HARD_PAGE_LIMIT) {
    pageCount++;
    pageSinceHistory.push(pageSinceIso);
    const batch = await invokeMock({ since: pageSinceIso, max: PAGE_SIZE });
    if (batch.length === 0) break;
    let newInBatch = 0;
    let newestInBatch = pageSinceIso;
    for (const m of batch) {
      if (!m || !m.id || seenIds.has(m.id)) continue;
      seenIds.add(m.id);
      messages.push(m);
      newInBatch++;
      if (m.receivedAt && m.receivedAt > newestInBatch) newestInBatch = m.receivedAt;
    }
    if (batch.length < PAGE_SIZE) break;
    if (newInBatch === 0) break;
    if (newestInBatch === pageSinceIso) break;
    pageSinceIso = new Date(new Date(newestInBatch).getTime() + 1).toISOString();
  }
  return { messages, pageCount, pageSinceHistory, hitSafetyBelt: pageCount === HARD_PAGE_LIMIT };
}

function mockPagesOf(totalCount, startMs) {
  // Generate totalCount messages spaced 1 minute apart starting at startMs.
  // Serve them in 100-per-page chunks filtered by `since`.
  const all = [];
  for (let i = 0; i < totalCount; i++) {
    all.push({ id: 'm-' + i, receivedAt: new Date(startMs + i * 60_000).toISOString() });
  }
  return async ({ since, max }) => {
    const filtered = all.filter(m => m.receivedAt > since);
    return filtered.slice(0, max);
  };
}

(async () => {
  // --- Test 1+2: 250-message backlog --------------------------------------
  const baseIso = '2026-04-21T07:16:45.000Z';
  const r1 = await paginate(mockPagesOf(250, Date.parse(baseIso) + 1000), baseIso);
  assert(r1.messages.length === 250, 'fetched all 250 messages (>>100 cap)');
  assert(r1.pageCount === 3, 'used 3 pages (100+100+50 short-page terminates)');

  // --- Test 3: since cursor advances per page ----------------------------
  assert(r1.pageSinceHistory.length === 3, 'recorded 3 since-cursor values');
  assert(r1.pageSinceHistory[0] === baseIso, 'page 1 uses the original since');
  assert(r1.pageSinceHistory[1] > r1.pageSinceHistory[0], 'page 2 since is strictly newer than page 1');
  assert(r1.pageSinceHistory[2] > r1.pageSinceHistory[1], 'page 3 since is strictly newer than page 2');
  // The +1ms advance prevents re-fetching the boundary.
  const expectedPage2Since = new Date(Date.parse(r1.messages[99].receivedAt) + 1).toISOString();
  assert(r1.pageSinceHistory[1] === expectedPage2Since, 'page 2 since = newest-of-page-1 + 1ms');

  // --- Test 4: duplicate ids across batch boundary --------------------------
  let callIdx = 0;
  const dupMock = async () => {
    callIdx++;
    if (callIdx === 1) {
      const batch = [];
      for (let i = 0; i < 100; i++) batch.push({ id: 'd-' + i, receivedAt: new Date(Date.parse(baseIso) + i * 60_000 + 1000).toISOString() });
      return batch;
    }
    if (callIdx === 2) {
      // Server resends id d-99 (boundary), plus 49 new ones.
      const batch = [{ id: 'd-99', receivedAt: new Date(Date.parse(baseIso) + 99 * 60_000 + 1000).toISOString() }];
      for (let i = 100; i < 149; i++) batch.push({ id: 'd-' + i, receivedAt: new Date(Date.parse(baseIso) + i * 60_000 + 1000).toISOString() });
      return batch;
    }
    return [];
  };
  const r2 = await paginate(dupMock, baseIso);
  assert(r2.messages.length === 149, 'dedup correctly drops the boundary duplicate (149 unique, not 150)');

  // --- Test 5: empty first batch terminates immediately -------------------
  const r3 = await paginate(async () => [], baseIso);
  assert(r3.pageCount === 1, 'empty first batch → exactly one call');
  assert(r3.messages.length === 0, 'empty first batch → zero messages');

  // --- Test 6: hard safety belt at 50 pages -------------------------------
  // Server always returns 100 fresh-looking messages with strictly newer
  // timestamps — would otherwise loop forever.
  let runaway = 0;
  const runawayMock = async () => {
    runaway++;
    const batch = [];
    for (let i = 0; i < 100; i++) {
      batch.push({ id: 'r-' + runaway + '-' + i, receivedAt: new Date(Date.parse(baseIso) + runaway * 1000_000 + i).toISOString() });
    }
    return batch;
  };
  const r4 = await paginate(runawayMock, baseIso);
  assert(r4.pageCount === 50, 'safety belt stops at 50 pages');
  assert(r4.hitSafetyBelt === true, 'safety-belt flag is set');
  assert(r4.messages.length === 5000, 'safety belt caps at exactly 5000 messages');

  // --- Test 7: cursor caught up, server returns short single page ---------
  const r5 = await paginate(mockPagesOf(7, Date.parse(baseIso) + 1000), baseIso);
  assert(r5.pageCount === 1, '7 messages fit in one short page → one call');
  assert(r5.messages.length === 7, '7 messages returned intact');

  console.log('\n' + (failures === 0 ? 'OK — all tests passed' : 'FAIL — ' + failures + ' assertion(s) failed'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
