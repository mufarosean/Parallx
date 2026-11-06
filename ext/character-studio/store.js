// store.js — characters in the extension's own database, one row each.

/** A new character: a young adult, every detail at rest, a first look. */
export function defaultCharacter(figure) {
  const pick = (kind, name) => (figure.items.find((i) => i.kind === kind && i.name === name) || figure.items.find((i) => i.kind === kind) || {}).id || 'none';
  return {
    version: 1,
    body: { gender: 1, age: 2 / 3, muscle: 0.5, weight: 0.5, height: 0.5, proportions: 0.5 },
    details: {},
    symmetric: true,
    look: {
      skin: (figure.meta.skins.find((s) => s.name === 'young_caucasian_female') || figure.meta.skins[0]).id,
      iris: (figure.meta.irises.find((i) => i.name === 'brown') || figure.meta.irises[0]).id,
      hair: pick('hair', 'long01'), hairColour: 'natural',
      eyebrows: pick('eyebrows', 'eyebrow001'), eyelashes: pick('eyelashes', 'eyelashes01'),
    },
  };
}

/** A stored character's data, made whole against the defaults (fields added later fill in). */
export function normaliseCharacter(data, figure) {
  const d = defaultCharacter(figure);
  const src = data && typeof data === 'object' ? data : {};
  const clamp = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
  const body = {};
  for (const k of Object.keys(d.body)) body[k] = clamp(src.body && src.body[k], 0, 1, d.body[k]);
  const details = {};
  for (const [k, v] of Object.entries(src.details || {})) if (figure.detailByLabel.has(k) && Number.isFinite(v) && v !== 0) details[k] = clamp(v, -1, 1, 0);
  const look = { ...d.look, ...(src.look || {}) };
  return { version: 1, body, details, symmetric: src.symmetric !== false, look };
}

const newId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export class Store {
  constructor(api) { this.api = api; this.ready = null; this.listeners = new Set(); }

  /** Open the database and run the migrations (again after a workspace switch). */
  open() {
    this.ready = (async () => {
      const db = this.api.database;
      if (!db) throw new Error('Character Studio needs its database, which this install does not give it.');
      const o = await db.open();
      if (o.error) throw new Error(o.error.message || String(o.error));
      const sep = this.api.env.toolPath.includes('\\') ? '\\' : '/';
      const m = await db.migrate(`${this.api.env.toolPath}${sep}db${sep}migrations`);
      if (m && m.error) throw new Error(m.error.message || String(m.error));
    })();
    return this.ready;
  }

  async q(kind, sql, params = []) {
    await this.ready;
    const r = await this.api.database[kind](sql, params);
    if (r.error) throw new Error(r.error.message || String(r.error));
    return kind === 'get' ? r.row : kind === 'all' ? r.rows : r;
  }

  changed() { for (const fn of [...this.listeners]) { try { fn(); } catch { /* a closed view */ } } }
  onDidChange(fn) { this.listeners.add(fn); return { dispose: () => this.listeners.delete(fn) }; }

  /** Every character, newest change first: { id, name, thumbnail, updated_at }. */
  list() { return this.q('all', 'SELECT id, name, thumbnail, updated_at FROM characters ORDER BY updated_at DESC, name'); }

  async get(id) {
    const row = await this.q('get', 'SELECT id, name, data, thumbnail FROM characters WHERE id = ?', [id]);
    if (!row) return null;
    let data = null; try { data = JSON.parse(row.data); } catch { data = null; }
    return { id: row.id, name: row.name, data, thumbnail: row.thumbnail };
  }

  async create(name, data) {
    const id = newId();
    await this.q('run', 'INSERT INTO characters (id, name, data) VALUES (?, ?, ?)', [id, name, JSON.stringify(data)]);
    this.changed();
    return id;
  }

  async save(id, data, thumbnail) {
    await this.q('run', "UPDATE characters SET data = ?, thumbnail = COALESCE(?, thumbnail), updated_at = datetime('now') WHERE id = ?", [JSON.stringify(data), thumbnail || null, id]);
    this.changed();
  }

  async rename(id, name) {
    await this.q('run', "UPDATE characters SET name = ?, updated_at = datetime('now') WHERE id = ?", [name, id]);
    this.changed();
  }

  async remove(id) {
    const row = await this.get(id);
    await this.q('run', 'DELETE FROM characters WHERE id = ?', [id]);
    this.changed();
    return row;
  }

  /** Put a removed character back as it was (the undo of remove). */
  async restore(row) {
    await this.q('run', 'INSERT OR REPLACE INTO characters (id, name, data, thumbnail) VALUES (?, ?, ?, ?)', [row.id, row.name, JSON.stringify(row.data), row.thumbnail || null]);
    this.changed();
  }

  /** A name not yet taken: "Character", "Character 2", ... */
  async freeName(base = 'Character') {
    const names = new Set((await this.list()).map((r) => r.name));
    if (!names.has(base)) return base;
    for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
  }
}
