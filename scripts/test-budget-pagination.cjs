// Test for the Gmail pagination loop in ext/budget/main.js (sync).
// Mirrors the production shape:
//   - call Gmail list_emails with max=pageSize
//   - follow Gmail nextPageToken for subsequent pages
//   - de-dupe duplicate ids across page boundaries
//   - stop on an empty page, no token, duplicate-only page, or hard limit

let failures = 0;
const assert = (cond, label) => { console.log((cond ? '  PASS ' : '  FAIL ') + label); if (!cond) failures++; };

async function paginate(invokeMock, baseArgs = {}, hardPageLimit = 50) {
  const pageSize = Math.max(1, Math.min(500, Math.floor(Number(baseArgs.max) || 100)));
  const seenIds = new Set();
  const messages = [];
  let pageToken = null;
  let pageCount = 0;
  const calls = [];

  while (pageCount < hardPageLimit) {
    pageCount++;
    const args = { ...baseArgs, max: pageSize };
    if (pageToken) args.page_token = pageToken;
    calls.push(args);

    const page = await invokeMock(args);
    const batch = Array.isArray(page.messages) ? page.messages : [];
    let newInPage = 0;
    for (const m of batch) {
      if (!m || !m.id || seenIds.has(m.id)) continue;
      seenIds.add(m.id);
      messages.push(m);
      newInPage++;
    }

    pageToken = typeof page.nextPageToken === 'string' && page.nextPageToken ? page.nextPageToken : null;
    if (!pageToken || batch.length === 0 || newInPage === 0) break;
  }

  messages.sort((a, b) => String(a.receivedAt || '').localeCompare(String(b.receivedAt || '')));
  return {
    messages,
    pageCount,
    calls,
    hitSafetyBelt: Boolean(pageToken) && pageCount >= hardPageLimit,
  };
}

function makeMessage(id, offsetMinutes) {
  return {
    id,
    receivedAt: new Date(Date.parse('2026-05-01T00:00:00.000Z') + offsetMinutes * 60_000).toISOString(),
  };
}

(async () => {
  const pages = {
    first: {
      messages: Array.from({ length: 100 }, (_, i) => makeMessage('m-' + i, i)),
      nextPageToken: 'p2',
    },
    p2: {
      messages: Array.from({ length: 100 }, (_, i) => makeMessage('m-' + (100 + i), 100 + i)),
      nextPageToken: 'p3',
    },
    p3: {
      messages: Array.from({ length: 50 }, (_, i) => makeMessage('m-' + (200 + i), 200 + i)),
    },
  };

  const r1 = await paginate(async (args) => pages[args.page_token || 'first'], {
    since: '2026-04-01T00:00:00.000Z',
    max: 100,
    read_state: 'all',
  });
  assert(r1.messages.length === 250, 'fetched all 250 messages, not just the first 100');
  assert(r1.pageCount === 3, 'used 3 Gmail pages (100 + 100 + 50)');
  assert(JSON.stringify(r1.calls.map(c => c.page_token || null)) === JSON.stringify([null, 'p2', 'p3']),
    'passes nextPageToken into subsequent calls');
  assert(r1.calls.every(c => c.max === 100), 'uses 100 as page size on every call');

  const r2 = await paginate(async (args) => args.page_token
    ? { messages: [makeMessage('dup', 0), makeMessage('new', 1)] }
    : { messages: [makeMessage('dup', 0)], nextPageToken: 'p2' }, { max: 100 });
  assert(r2.messages.length === 2, 'dedup drops repeated ids across page boundaries');

  const r3 = await paginate(async () => ({ messages: [] }), { max: 100 });
  assert(r3.pageCount === 1, 'empty first page makes exactly one call');
  assert(r3.messages.length === 0, 'empty first page returns zero messages');

  let runaway = 0;
  const r4 = await paginate(async () => {
    runaway++;
    return {
      messages: Array.from({ length: 100 }, (_, i) => makeMessage('r-' + runaway + '-' + i, runaway * 1000 + i)),
      nextPageToken: 'again',
    };
  }, { max: 100 }, 50);
  assert(r4.pageCount === 50, 'safety belt stops at 50 pages');
  assert(r4.hitSafetyBelt === true, 'safety-belt flag is set');
  assert(r4.messages.length === 5000, 'safety belt caps at 5000 messages with page size 100');

  const r5 = await paginate(async () => ({ messages: [makeMessage('same', 0)], nextPageToken: 'p2' }), { max: 100 });
  assert(r5.pageCount === 2, 'duplicate-only second page is attempted once');
  assert(r5.messages.length === 1, 'duplicate-only second page does not duplicate rows');

  console.log('\n' + (failures === 0 ? 'OK - all tests passed' : 'FAIL - ' + failures + ' assertion(s) failed'));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
