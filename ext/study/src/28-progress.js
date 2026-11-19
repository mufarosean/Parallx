// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 28: PROGRESS — the tools that report it, as they are now
// ═══════════════════════════════════════════════════════════════════════════════
//
// The other tools' progress comes through the core's progress providers
// (the core command `progress.getRegistry`, the same door as the question
// providers): Study names no tool, it lists whatever is registered. A
// provider's groups are read only once something of Study shows progress
// (a subject in the sidebar, an open Progress tab), then again whenever the
// provider says its counts changed. A tool turned off takes its provider out
// of the registry, and its bars go with the next paint. Everything here
// belongs to the activation: Study off, no provider is listened to or read.
// The pure part is 14-progress-model.js.

/** The live registry once `progress.getRegistry` answers. */
let _stProgressRegistry = null;
/** provider id → { provider, groups: null until read, counted: sets of groups counted together, asking, failed, sub, seq, timer }. */
const _stProgressProviders = new Map();
/** Has anything of Study asked to show progress in this activation? */
let _stProgressWanted = false;

/** A provider's groups as plain rows; whatever is not a group is left out. */
function stProgressCleanGroups(list) {
  return (Array.isArray(list) ? list : []).filter((g) => g && typeof g === 'object').map((g) => ({
    group: String(g.group ?? ''), label: String(g.label ?? g.group ?? ''), total: g.total, good: g.good, middling: g.middling, poor: g.poor,
  }));
}

/** A set of groups as one key, whatever order they are named in. */
const stProgressSetKey = (groups) => [...new Set((groups || []).map(String))].sort().join('\u0000');

/** Ask a provider for a set of its groups together, each item once; false when it cannot say. */
function stProgressAskCount(provider, key) {
  return Promise.resolve().then(() => provider.count(key.split('\u0000')))
    .then((c) => (c && typeof c === 'object' ? { total: c.total, good: c.good, middling: c.middling, poor: c.poor } : false), () => false);
}

/** Read one provider's groups now; the latest read wins, and one that outlives the activation is dropped. */
function stProgressRead(id, token) {
  const entry = _stProgressProviders.get(id);
  if (!entry || !stIsCurrent(token)) return;
  const seq = (entry.seq += 1);
  entry.failed = false;
  const current = () => stIsCurrent(token) && _stProgressProviders.get(id) === entry && entry.seq === seq;
  Promise.resolve()
    .then(() => entry.provider.groups())
    .then(async (list) => {
      const groups = stProgressCleanGroups(list);
      // The sets counted together are counted again with the groups, so a bar never shows new groups beside old sums.
      const keys = [...entry.counted.keys()].filter((key) => key.split('\u0000').every((k) => groups.some((g) => g.group === k)));
      const counted = new Map(await Promise.all(keys.map(async (key) => [key, await stProgressAskCount(entry.provider, key)])));
      if (current()) { entry.groups = groups; entry.counted = counted; bus.emit('progress'); }
    })
    .catch((err) => {
      if (!current()) return;
      // What was read last stays (one failed read does not empty a tool's bars), and the next thing that shows progress asks again.
      entry.failed = true;
      if (entry.groups !== null) return;
      // A tool that could never say is a tool with nothing to show, said once.
      console.warn(`[Study] progress of ${id} could not be read:`, err && err.message);
      entry.groups = [];
      bus.emit('progress');
    });
}

/**
 * A set of a provider's groups taken together, each item once (the
 * provider's own `count`): the counts once known, null while they are being
 * asked for (whoever shows progress hears 'progress' when they land), false
 * when the provider could not say.
 */
function stProgressCounted(id, groups, token = stActivation()) {
  const entry = _stProgressProviders.get(id);
  if (!entry || typeof entry.provider.count !== 'function') return false;
  const key = stProgressSetKey(groups);
  if (entry.counted.has(key)) return entry.counted.get(key);
  if (entry.asking.has(key) || !stIsCurrent(token)) return null;
  entry.asking.add(key);
  const seq = entry.seq;
  void stProgressAskCount(entry.provider, key).then((counts) => {
    entry.asking.delete(key);
    if (!stIsCurrent(token) || _stProgressProviders.get(id) !== entry) return;
    // Asked before a newer read of the groups: not kept, and whoever shows progress asks again.
    if (entry.seq === seq) entry.counted.set(key, counts);
    bus.emit('progress');
  });
  return null;
}

/** A provider said its counts changed: read it again shortly, if anything shows progress. */
function stProgressTouched(id, token) {
  const entry = _stProgressProviders.get(id);
  if (!entry || !_stProgressWanted || !stIsCurrent(token)) return;
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => stProgressRead(id, token), 60);
}

function stProgressDrop(id) {
  const entry = _stProgressProviders.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  entry.seq += 1;
  entry.sub.dispose();
  _stProgressProviders.delete(id);
}

/** Make Study's list agree with the registry: providers that went are dropped, new ones heard (and read, when progress is shown). */
function stProgressSync(context, token) {
  const registry = _stProgressRegistry;
  if (!registry || !stIsCurrent(token)) return;
  let listed = [];
  try { listed = (registry.list() || []).filter((p) => p && typeof p.id === 'string' && p.id && typeof p.groups === 'function'); } catch { listed = []; }
  let changed = false;
  for (const [id, entry] of [..._stProgressProviders]) {
    if (listed.some((p) => p === entry.provider)) continue;
    stProgressDrop(id);
    changed = true;
  }
  for (const provider of listed) {
    if (_stProgressProviders.has(provider.id)) continue;
    const id = provider.id;
    let raw = null;
    try { raw = typeof provider.onDidChange === 'function' ? provider.onDidChange(() => stProgressTouched(id, token)) : null; } catch { raw = null; }
    // Disposed once, by whichever comes first: the provider going, or the activation (with Study off, nothing listens to any provider).
    let done = false;
    const sub = { dispose() { if (done) return; done = true; try { if (raw && typeof raw.dispose === 'function') raw.dispose(); else if (typeof raw === 'function') raw(); } catch { /* the provider's own */ } } };
    context.subscriptions.push(sub);
    _stProgressProviders.set(id, { provider, groups: null, counted: new Map(), asking: new Set(), failed: false, sub, seq: 0, timer: 0 });
    changed = true;
    if (_stProgressWanted) stProgressRead(id, token);
  }
  if (changed) bus.emit('progress');
}

/** Something of Study shows progress: read every provider not read yet, and again one whose last read failed. */
function stProgressWant(token = stActivation()) {
  if (!stIsCurrent(token)) return;
  _stProgressWanted = true;
  for (const [id, entry] of _stProgressProviders) if ((entry.groups === null && entry.seq === 0) || entry.failed) stProgressRead(id, token);
}

/** The providers as the view model takes them: [{ id, kind, words, canOpen, groups }], in registration order; with `counted` for one whose groups can share items. */
function stProgressProviders() {
  return [..._stProgressProviders.values()].map(({ provider, groups }) => ({
    id: provider.id,
    kind: String(provider.displayName || provider.id),
    words: provider.words && typeof provider.words === 'object' ? provider.words : {},
    canOpen: typeof provider.open === 'function',
    groups: groups || [],
    ...(typeof provider.count === 'function' ? { counted: (set) => stProgressCounted(provider.id, set) } : {}),
  }));
}

/** Units' order in the Units database: Order, then the table's own. */
function stProgressUnitsOf(st) {
  const order = (r) => { const v = (r.values || {}).Order; const n = Number(v); return Number.isFinite(n) && v !== '' && v != null ? n : Infinity; };
  const also = (r) => { const key = Object.keys(r.values || {}).find((k) => stSubjectSameName(k, ST_PROGRESS_ALSO)); return key ? r.values[key] : ''; };
  return (st.unitRows || []).map((r, i) => ({ r, i })).filter((x) => String(x.r.title || '').trim())
    .sort((a, b) => (order(a.r) - order(b.r)) || (a.i - b.i))
    .map(({ r }) => ({ name: String(r.title).trim(), rowId: r.pageId, also: also(r) }));
}

/**
 * A subject's progress as it is now (stProgressBuild's view), or null while
 * the subject is not read yet or has a problem (its database in the Trash).
 */
function stProgressOfSubject(subjectId) {
  const st = _stSubjects.get(Number(subjectId));
  if (!st || !st.synced || st.problem) return null;
  const questions = stProgressQuestions([...st.rows.values()], st.names, st.titleById, st.unitRelation);
  return stProgressBuild({ units: stProgressUnitsOf(st), questions, providers: stProgressProviders() });
}

/**
 * Open a tool on the items behind one part of its bar: the provider's own
 * `open`, on every group the unit matched, so what opens is what the part
 * counts. Resolves false when the tool could not.
 */
async function stProgressOpenItems(providerId, groups, state) {
  const entry = _stProgressProviders.get(String(providerId));
  const at = ST_PROGRESS_STATES.indexOf(state);
  if (!entry || at < 0 || typeof entry.provider.open !== 'function') return false;
  const wanted = [...new Set((Array.isArray(groups) ? groups : [groups]).filter((g) => g !== undefined && g !== null).map(String))];
  if (!wanted.length) return false;
  try { return (await entry.provider.open(wanted, state)) !== false; } catch (err) { console.warn('[Study] a tool could not open its items:', err && err.message); return false; }
}

/**
 * Hear the progress providers for this activation. Retries while the core
 * command is not there yet (an older host never has it: Study then shows
 * its own questions only).
 */
function registerProgress(context, attempt = 0, token = stActivation()) {
  const live = () => stIsCurrent(token);
  if (!live()) return;
  _api.commands.executeCommand('progress.getRegistry')
    .then((registry) => {
      if (!live()) return;
      if (!registry || typeof registry.list !== 'function') throw new Error('no registry');
      _stProgressRegistry = registry;
      if (typeof registry.onDidChange === 'function') context.subscriptions.push(registry.onDidChange(() => stProgressSync(context, token)));
      stProgressSync(context, token);
    })
    .catch(() => {
      if (attempt < 5 && live()) stRetryLater(() => registerProgress(context, attempt + 1, token), 2000, token);
    });
}

/** Forget every provider (deactivate): no timer left, nothing read. */
function stProgressReset() {
  for (const id of [..._stProgressProviders.keys()]) stProgressDrop(id);
  _stProgressRegistry = null;
  _stProgressWanted = false;
}
