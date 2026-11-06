// store.js — characters in the extension's own database, one row each (the
// character itself is JSON: see anime.js defaultCharacter).

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
