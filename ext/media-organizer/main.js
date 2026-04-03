// Media Organizer — Parallx Extension
// Organize photos and videos with tags, albums, and EXIF metadata.
// All data lives in the shared workspace SQLite DB with mo_ table prefix.
//
// Single-file constraint: Parallx loads extensions via blob URL, so all JS
// must live in this file. SQL migrations are separate (read by main process).
//
// Upstream reference: github.com/stashapp/stash

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: DATABASE WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════
// Convenience layer over window.parallxElectron.database that unwraps the
// { error, ... } envelope and throws on failure.

const db = {
  async run(sql, params = []) {
    const res = await window.parallxElectron.database.run(sql, params);
    if (res.error) throw new Error(`[MO-DB] ${res.error.message}`);
    return res;
  },
  async get(sql, params = []) {
    const res = await window.parallxElectron.database.get(sql, params);
    if (res.error) throw new Error(`[MO-DB] ${res.error.message}`);
    return res.row ?? null;
  },
  async all(sql, params = []) {
    const res = await window.parallxElectron.database.all(sql, params);
    if (res.error) throw new Error(`[MO-DB] ${res.error.message}`);
    return res.rows ?? [];
  },
  async transaction(ops) {
    const res = await window.parallxElectron.database.runTransaction(ops);
    if (res.error) throw new Error(`[MO-DB] ${res.error.message}`);
    return res.results ?? [];
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: SHARED HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build transaction operations for managing a many-to-many join table.
 * Adapted from stash: pkg/sqlite/table.go — tableJoin helpers
 *
 * @param {string} table       - Join table name (e.g. 'mo_photos_tags')
 * @param {string} entityCol   - Entity FK column (e.g. 'photo_id')
 * @param {string} relatedCol  - Related FK column (e.g. 'tag_id')
 * @param {number} entityId    - The entity's ID
 * @param {{ mode: 'SET'|'ADD'|'REMOVE', ids: number[] }} updateIDs
 * @returns {Array<{ type: string, sql: string, params: any[] }>}
 */
function buildRelationOps(table, entityCol, relatedCol, entityId, updateIDs) {
  const ops = [];
  const { mode, ids } = updateIDs;

  if (mode === 'SET') {
    ops.push({
      type: 'run',
      sql: `DELETE FROM ${table} WHERE ${entityCol} = ?`,
      params: [entityId],
    });
    for (const id of ids) {
      ops.push({
        type: 'run',
        sql: `INSERT INTO ${table} (${entityCol}, ${relatedCol}) VALUES (?, ?)`,
        params: [entityId, id],
      });
    }
  } else if (mode === 'ADD') {
    for (const id of ids) {
      ops.push({
        type: 'run',
        sql: `INSERT OR IGNORE INTO ${table} (${entityCol}, ${relatedCol}) VALUES (?, ?)`,
        params: [entityId, id],
      });
    }
  } else if (mode === 'REMOVE') {
    for (const id of ids) {
      ops.push({
        type: 'run',
        sql: `DELETE FROM ${table} WHERE ${entityCol} = ? AND ${relatedCol} = ?`,
        params: [entityId, id],
      });
    }
  }

  return ops;
}

/**
 * Build and execute a partial UPDATE statement.
 * Present key → set value; key with null → clear (set NULL); absent key → skip.
 * Always sets updated_at = datetime('now').
 *
 * @param {string} tableName - Table to update
 * @param {number} id        - Row id
 * @param {object} partial   - Partial update object
 * @param {object} colMap    - Maps JS property names to SQL column names
 */
async function buildPartialUpdate(tableName, id, partial, colMap) {
  const setClauses = [];
  const params = [];

  for (const [jsKey, sqlCol] of Object.entries(colMap)) {
    if (jsKey in partial) {
      setClauses.push(`${sqlCol} = ?`);
      params.push(partial[jsKey]);
    }
  }

  if (setClauses.length === 0) return;

  setClauses.push(`updated_at = datetime('now')`);
  params.push(id);

  const sql = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = ?`;
  await db.run(sql, params);
}

/**
 * Resolve pagination defaults and compute LIMIT/OFFSET.
 * @param {{ page?: number, perPage?: number }} pagination
 * @returns {{ limit: number, offset: number, page: number, perPage: number }}
 */
function resolvePagination(pagination = {}) {
  const page = Math.max(1, pagination.page || 1);
  const perPage = Math.max(1, Math.min(100, pagination.perPage || 25));
  return { limit: perPage, offset: (page - 1) * perPage, page, perPage };
}

/**
 * Resolve sort defaults.
 * @param {{ field?: string, direction?: string }} sort
 * @param {string[]} allowedFields - Whitelist of sortable columns
 * @param {string} defaultField
 * @returns {{ field: string, direction: string }}
 */
function resolveSort(sort = {}, allowedFields = ['created_at'], defaultField = 'created_at') {
  const dir = sort.direction === 'ASC' ? 'ASC' : 'DESC';
  const field = allowedFields.includes(sort.field) ? sort.field : defaultField;
  return { field, direction: dir };
}

// ── Error Classes ──
// Adapted from stash: pkg/models/errors + pkg/sqlite/table.go — typed errors

class NotFoundError extends Error {
  constructor(table, id) {
    super(`[MO] ${table} id=${id} not found`);
    this.name = 'NotFoundError';
    this.table = table;
    this.entityId = id;
  }
}

class DuplicateError extends Error {
  constructor(table, column, value) {
    super(`[MO] ${table}.${column} already exists: ${value}`);
    this.name = 'DuplicateError';
    this.table = table;
    this.column = column;
    this.value = value;
  }
}

class ValidationError extends Error {
  constructor(message) {
    super(`[MO] ${message}`);
    this.name = 'ValidationError';
  }
}

async function ensureExists(tableName, id) {
  const row = await db.get(`SELECT 1 FROM ${tableName} WHERE id = ?`, [id]);
  if (!row) throw new NotFoundError(tableName, id);
}

function ensureNameNotEmpty(name) {
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new ValidationError('Name must not be empty');
  }
}

async function ensureUnique(tableName, column, value, excludeId = null) {
  const sql = excludeId != null
    ? `SELECT id FROM ${tableName} WHERE ${column} = ? AND id != ?`
    : `SELECT id FROM ${tableName} WHERE ${column} = ?`;
  const params = excludeId != null ? [value, excludeId] : [value];
  const row = await db.get(sql, params);
  if (row) throw new DuplicateError(tableName, column, value);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: FOLDER QUERIES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/file.go — folder storage

const FOLDER_COL_MAP = {
  path: 'path',
  parentFolderId: 'parent_folder_id',
  modTime: 'mod_time',
};

const FolderQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      path: row.path,
      parentFolderId: row.parent_folder_id ?? null,
      modTime: row.mod_time ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_folders (path, parent_folder_id, created_at, updated_at)
       VALUES (?, ?, datetime('now'), datetime('now'))`,
      [input.path, input.parentFolderId ?? null]
    );
    return this.findById(res.lastInsertRowid);
  },

  async findById(id) {
    const row = await db.get(`SELECT * FROM mo_folders WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async findByPath(path) {
    const row = await db.get(`SELECT * FROM mo_folders WHERE path = ?`, [path]);
    return this.fromRow(row);
  },

  async findOrCreate(path, parentFolderId = null) {
    const existing = await this.findByPath(path);
    if (existing) return existing;
    return this.create({ path, parentFolderId });
  },

  async update(id, partial) {
    await ensureExists('mo_folders', id);
    await buildPartialUpdate('mo_folders', id, partial, FOLDER_COL_MAP);
    return this.findById(id);
  },

  async findManyByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.all(`SELECT * FROM mo_folders WHERE id IN (${placeholders})`, ids);
    return rows.map((r) => this.fromRow(r));
  },

  async count(filter = {}) {
    const where = [];
    const params = [];
    if (filter.parentFolderId !== undefined) {
      if (filter.parentFolderId === null) {
        where.push(`parent_folder_id IS NULL`);
      } else {
        where.push(`parent_folder_id = ?`);
        params.push(filter.parentFolderId);
      }
    }
    if (filter.pathLike) {
      where.push(`path LIKE ?`);
      params.push(filter.pathLike);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const row = await db.get(`SELECT COUNT(*) as count FROM mo_folders ${whereClause}`, params);
    return row ? row.count : 0;
  },

  async findMany(filter = {}, sort = {}, pagination = {}) {
    const where = [];
    const params = [];

    if (filter.parentFolderId !== undefined) {
      if (filter.parentFolderId === null) {
        where.push(`parent_folder_id IS NULL`);
      } else {
        where.push(`parent_folder_id = ?`);
        params.push(filter.parentFolderId);
      }
    }
    if (filter.pathLike) {
      where.push(`path LIKE ?`);
      params.push(filter.pathLike);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { field, direction } = resolveSort(sort, ['created_at', 'path', 'updated_at']);
    const { limit, offset, page, perPage } = resolvePagination(pagination);

    const countRow = await db.get(`SELECT COUNT(*) as count FROM mo_folders ${whereClause}`, params);
    const count = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT * FROM mo_folders ${whereClause} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { items: rows.map((r) => this.fromRow(r)), count, page, perPage };
  },

  async destroy(id) {
    await db.run(`DELETE FROM mo_folders WHERE id = ?`, [id]);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: FILE QUERIES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/file.go — baseFile storage

const FILE_COL_MAP = {
  basename: 'basename',
  size: 'size',
  modTime: 'mod_time',
  folderId: 'folder_id',
};

const FileQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      basename: row.basename,
      size: row.size,
      modTime: row.mod_time,
      folderId: row.folder_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_files (basename, size, mod_time, folder_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [input.basename, input.size, input.modTime, input.folderId]
    );
    return this.findById(res.lastInsertRowid);
  },

  async findById(id) {
    const row = await db.get(`SELECT * FROM mo_files WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async findByFolderAndName(folderId, basename) {
    const row = await db.get(
      `SELECT * FROM mo_files WHERE folder_id = ? AND basename = ?`,
      [folderId, basename]
    );
    return this.fromRow(row);
  },

  async findMany(filter = {}, sort = {}, pagination = {}) {
    const where = [];
    const params = [];

    if (filter.folderId !== undefined) {
      where.push(`folder_id = ?`);
      params.push(filter.folderId);
    }
    if (filter.basename) {
      where.push(`basename = ?`);
      params.push(filter.basename);
    }
    if (filter.basenameLike) {
      where.push(`basename LIKE ?`);
      params.push(filter.basenameLike);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { field, direction } = resolveSort(sort, ['created_at', 'basename', 'size', 'mod_time', 'updated_at']);
    const { limit, offset, page, perPage } = resolvePagination(pagination);

    const countRow = await db.get(`SELECT COUNT(*) as count FROM mo_files ${whereClause}`, params);
    const count = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT * FROM mo_files ${whereClause} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { items: rows.map((r) => this.fromRow(r)), count, page, perPage };
  },

  async update(id, partial) {
    await buildPartialUpdate('mo_files', id, partial, FILE_COL_MAP);
    return this.findById(id);
  },

  async countByFolderId(folderId) {
    const row = await db.get(`SELECT COUNT(*) as count FROM mo_files WHERE folder_id = ?`, [folderId]);
    return row ? row.count : 0;
  },

  async findManyByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.all(`SELECT * FROM mo_files WHERE id IN (${placeholders})`, ids);
    return rows.map((r) => this.fromRow(r));
  },

  async count(filter = {}) {
    const where = [];
    const params = [];
    if (filter.folderId !== undefined) {
      where.push(`folder_id = ?`);
      params.push(filter.folderId);
    }
    if (filter.basename) {
      where.push(`basename = ?`);
      params.push(filter.basename);
    }
    if (filter.basenameLike) {
      where.push(`basename LIKE ?`);
      params.push(filter.basenameLike);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const row = await db.get(`SELECT COUNT(*) as count FROM mo_files ${whereClause}`, params);
    return row ? row.count : 0;
  },

  async destroy(id) {
    await db.run(`DELETE FROM mo_files WHERE id = ?`, [id]);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: FINGERPRINT QUERIES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/file.go — fingerprint storage

const FingerprintQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      fileId: row.file_id,
      type: row.type,
      value: row.value,
      createdAt: row.created_at,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_fingerprints (file_id, type, value, created_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [input.fileId, input.type, input.value]
    );
    return { id: res.lastInsertRowid, fileId: input.fileId, type: input.type, value: input.value };
  },

  async findByFile(fileId) {
    const rows = await db.all(`SELECT * FROM mo_fingerprints WHERE file_id = ?`, [fileId]);
    return rows.map((r) => this.fromRow(r));
  },

  async findByValue(type, value) {
    const rows = await db.all(
      `SELECT * FROM mo_fingerprints WHERE type = ? AND value = ?`,
      [type, value]
    );
    return rows.map((r) => this.fromRow(r));
  },

  async upsert(input) {
    await db.run(
      `INSERT INTO mo_fingerprints (file_id, type, value, created_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(file_id, type) DO UPDATE SET value = excluded.value`,
      [input.fileId, input.type, input.value]
    );
    const row = await db.get(
      `SELECT * FROM mo_fingerprints WHERE file_id = ? AND type = ?`,
      [input.fileId, input.type]
    );
    return this.fromRow(row);
  },

  async destroy(id) {
    await db.run(`DELETE FROM mo_fingerprints WHERE id = ?`, [id]);
  },

  async destroyByFileId(fileId) {
    await db.run(`DELETE FROM mo_fingerprints WHERE file_id = ?`, [fileId]);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6: TAG QUERIES (with hierarchy)
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/tag.go — tag CRUD + hierarchy
// Hierarchy CTEs adapted from stash: FindAllAncestors, FindAllDescendants

const TAG_COL_MAP = {
  name: 'name',
  description: 'description',
  imagePath: 'image_path',
  sortName: 'sort_name',
  favorite: 'favorite',
};

const TagQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? '',
      imagePath: row.image_path ?? null,
      sortName: row.sort_name ?? '',
      favorite: row.favorite ?? 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async create(input) {
    ensureNameNotEmpty(input.name);
    await ensureUnique('mo_tags', 'name', input.name);
    const res = await db.run(
      `INSERT INTO mo_tags (name, description, image_path, sort_name, favorite, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [input.name, input.description ?? '', input.imagePath ?? null, input.sortName ?? '', input.favorite ?? 0]
    );
    return this.findById(res.lastInsertRowid);
  },

  async findById(id) {
    const row = await db.get(`SELECT * FROM mo_tags WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async findByName(name) {
    const row = await db.get(`SELECT * FROM mo_tags WHERE name = ?`, [name]);
    return this.fromRow(row);
  },

  async findMany(filter = {}, sort = {}, pagination = {}) {
    const where = [];
    const params = [];

    if (filter.nameLike) {
      where.push(`name LIKE ?`);
      params.push(filter.nameLike);
    }
    if (filter.favorite !== undefined) {
      where.push(`favorite = ?`);
      params.push(filter.favorite ? 1 : 0);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { field, direction } = resolveSort(sort, ['created_at', 'name', 'sort_name', 'updated_at']);
    const { limit, offset, page, perPage } = resolvePagination(pagination);

    const countRow = await db.get(`SELECT COUNT(*) as count FROM mo_tags ${whereClause}`, params);
    const count = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT * FROM mo_tags ${whereClause} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { items: rows.map((r) => this.fromRow(r)), count, page, perPage };
  },

  async update(id, partial) {
    await ensureExists('mo_tags', id);
    if ('name' in partial && partial.name !== undefined) {
      ensureNameNotEmpty(partial.name);
      await ensureUnique('mo_tags', 'name', partial.name, id);
    }
    await buildPartialUpdate('mo_tags', id, partial, TAG_COL_MAP);

    // Handle parentIds reassignment with cycle validation
    if (partial.parentIds) {
      const uniqueParentIds = [...new Set(partial.parentIds)];
      for (const pid of uniqueParentIds) {
        if (await this.wouldCreateCycle(pid, id)) {
          throw new ValidationError(
            `Setting parent ${pid} on tag ${id} would create a cycle`
          );
        }
      }
      const ops = [
        { type: 'run', sql: `DELETE FROM mo_tags_relations WHERE child_id = ?`, params: [id] },
      ];
      for (const pid of uniqueParentIds) {
        ops.push({
          type: 'run',
          sql: `INSERT INTO mo_tags_relations (parent_id, child_id) VALUES (?, ?)`,
          params: [pid, id],
        });
      }
      await db.transaction(ops);
    }

    return this.findById(id);
  },

  async destroy(id) {
    await ensureExists('mo_tags', id);
    await db.run(`DELETE FROM mo_tags WHERE id = ?`, [id]);
  },

  async findManyByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.all(`SELECT * FROM mo_tags WHERE id IN (${placeholders})`, ids);
    return rows.map((r) => this.fromRow(r));
  },

  async count(filter = {}) {
    const where = [];
    const params = [];
    if (filter.nameLike) {
      where.push(`name LIKE ?`);
      params.push(filter.nameLike);
    }
    if (filter.favorite !== undefined) {
      where.push(`favorite = ?`);
      params.push(filter.favorite ? 1 : 0);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const row = await db.get(`SELECT COUNT(*) as count FROM mo_tags ${whereClause}`, params);
    return row ? row.count : 0;
  },

  // Adapted from stash: pkg/models/tag.go — alias management
  async updateAliases(tagId, aliases) {
    await ensureExists('mo_tags', tagId);
    const ops = [
      { type: 'run', sql: `DELETE FROM mo_tag_aliases WHERE tag_id = ?`, params: [tagId] },
    ];
    for (const alias of aliases) {
      if (typeof alias === 'string' && alias.trim().length > 0) {
        ops.push({
          type: 'run',
          sql: `INSERT INTO mo_tag_aliases (tag_id, alias) VALUES (?, ?)`,
          params: [tagId, alias.trim()],
        });
      }
    }
    await db.transaction(ops);
  },

  async getAliases(tagId) {
    const rows = await db.all(`SELECT alias FROM mo_tag_aliases WHERE tag_id = ?`, [tagId]);
    return rows.map((r) => r.alias);
  },

  // --- Hierarchy ---
  // Adapted from stash: pkg/sqlite/tag.go — FindAllAncestors()
  async getAncestors(tagId) {
    const rows = await db.all(
      `WITH RECURSIVE ancestors(id, depth) AS (
         SELECT parent_id, 0 FROM mo_tags_relations WHERE child_id = ?
         UNION
         SELECT tr.parent_id, a.depth + 1 FROM mo_tags_relations tr
           INNER JOIN ancestors a ON a.id = tr.child_id
           WHERE a.depth < 50
       )
       SELECT t.* FROM mo_tags t INNER JOIN ancestors a ON t.id = a.id`,
      [tagId]
    );
    return rows.map((r) => this.fromRow(r));
  },

  // Adapted from stash: pkg/sqlite/tag.go — FindAllDescendants()
  async getDescendants(tagId) {
    const rows = await db.all(
      `WITH RECURSIVE descendants(id, depth) AS (
         SELECT child_id, 0 FROM mo_tags_relations WHERE parent_id = ?
         UNION
         SELECT tr.child_id, d.depth + 1 FROM mo_tags_relations tr
           INNER JOIN descendants d ON d.id = tr.parent_id
           WHERE d.depth < 50
       )
       SELECT t.* FROM mo_tags t INNER JOIN descendants d ON t.id = d.id`,
      [tagId]
    );
    return rows.map((r) => this.fromRow(r));
  },

  async getParents(tagId) {
    const rows = await db.all(
      `SELECT t.* FROM mo_tags t
       INNER JOIN mo_tags_relations tr ON t.id = tr.parent_id
       WHERE tr.child_id = ?`,
      [tagId]
    );
    return rows.map((r) => this.fromRow(r));
  },

  async getChildren(tagId) {
    const rows = await db.all(
      `SELECT t.* FROM mo_tags t
       INNER JOIN mo_tags_relations tr ON t.id = tr.child_id
       WHERE tr.parent_id = ?`,
      [tagId]
    );
    return rows.map((r) => this.fromRow(r));
  },

  // Adapted from stash: pkg/sqlite/tag.go — cycle validation
  async wouldCreateCycle(parentId, childId) {
    if (parentId === childId) return true;
    const ancestors = await this.getAncestors(parentId);
    return ancestors.some((a) => a.id === childId);
  },

  async addParent(tagId, parentId) {
    if (await this.wouldCreateCycle(parentId, tagId)) {
      throw new Error(`[MO-DB] Adding parent ${parentId} to tag ${tagId} would create a cycle`);
    }
    await db.run(
      `INSERT OR IGNORE INTO mo_tags_relations (parent_id, child_id) VALUES (?, ?)`,
      [parentId, tagId]
    );
  },

  async removeParent(tagId, parentId) {
    await db.run(
      `DELETE FROM mo_tags_relations WHERE parent_id = ? AND child_id = ?`,
      [parentId, tagId]
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7: PHOTO QUERIES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/image.go — image CRUD

const PHOTO_COL_MAP = {
  title: 'title',
  rating: 'rating',
  curated: 'curated',
  details: 'details',
  cameraMake: 'camera_make',
  cameraModel: 'camera_model',
  lens: 'lens',
  iso: 'iso',
  aperture: 'aperture',
  shutterSpeed: 'shutter_speed',
  focalLength: 'focal_length',
  gpsLatitude: 'gps_latitude',
  gpsLongitude: 'gps_longitude',
  takenAt: 'taken_at',
  photographer: 'photographer',
};

const PhotoQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title ?? '',
      rating: row.rating ?? 0,
      curated: row.curated ?? 0,
      details: row.details ?? '',
      cameraMake: row.camera_make ?? null,
      cameraModel: row.camera_model ?? null,
      lens: row.lens ?? null,
      iso: row.iso ?? null,
      aperture: row.aperture ?? null,
      shutterSpeed: row.shutter_speed ?? null,
      focalLength: row.focal_length ?? null,
      gpsLatitude: row.gps_latitude ?? null,
      gpsLongitude: row.gps_longitude ?? null,
      takenAt: row.taken_at ?? null,
      photographer: row.photographer ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_photos (title, rating, curated, details, camera_make, camera_model,
        lens, iso, aperture, shutter_speed, focal_length, gps_latitude, gps_longitude,
        taken_at, photographer, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        input.title ?? '',
        input.rating ?? 0,
        input.curated ?? 0,
        input.details ?? '',
        input.cameraMake ?? null,
        input.cameraModel ?? null,
        input.lens ?? null,
        input.iso ?? null,
        input.aperture ?? null,
        input.shutterSpeed ?? null,
        input.focalLength ?? null,
        input.gpsLatitude ?? null,
        input.gpsLongitude ?? null,
        input.takenAt ?? null,
        input.photographer ?? null,
      ]
    );
    const photoId = res.lastInsertRowid;

    // Optionally link files
    if (input.fileIds && input.fileIds.length > 0) {
      const ops = input.fileIds.map((fid, i) => ({
        type: 'run',
        sql: `INSERT INTO mo_photos_files (photo_id, file_id, is_primary) VALUES (?, ?, ?)`,
        params: [photoId, fid, i === 0 ? 1 : 0],
      }));
      await db.transaction(ops);
    }

    // Optionally link tags
    if (input.tagIds && input.tagIds.length > 0) {
      const ops = input.tagIds.map((tid) => ({
        type: 'run',
        sql: `INSERT INTO mo_photos_tags (photo_id, tag_id) VALUES (?, ?)`,
        params: [photoId, tid],
      }));
      await db.transaction(ops);
    }

    return this.findById(photoId);
  },

  async findById(id) {
    const row = await db.get(`SELECT * FROM mo_photos WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async findMany(filter = {}, sort = {}, pagination = {}) {
    const where = [];
    const params = [];

    if (filter.rating !== undefined) {
      where.push(`rating >= ?`);
      params.push(filter.rating);
    }
    if (filter.curated !== undefined) {
      where.push(`curated = ?`);
      params.push(filter.curated ? 1 : 0);
    }
    if (filter.tagId !== undefined) {
      where.push(`id IN (SELECT photo_id FROM mo_photos_tags WHERE tag_id = ?)`);
      params.push(filter.tagId);
    }
    // Multi-tag filter: tagIds with tagMode ('AND'|'OR')
    if (filter.tagIds && filter.tagIds.length > 0) {
      const placeholders = filter.tagIds.map(() => '?').join(', ');
      if (filter.tagMode === 'AND') {
        where.push(`id IN (SELECT photo_id FROM mo_photos_tags WHERE tag_id IN (${placeholders}) GROUP BY photo_id HAVING COUNT(DISTINCT tag_id) = ?)`);
        params.push(...filter.tagIds, filter.tagIds.length);
      } else {
        where.push(`id IN (SELECT photo_id FROM mo_photos_tags WHERE tag_id IN (${placeholders}))`);
        params.push(...filter.tagIds);
      }
    }
    if (filter.albumId !== undefined) {
      where.push(`id IN (SELECT photo_id FROM mo_albums_photos WHERE album_id = ?)`);
      params.push(filter.albumId);
    }
    if (filter.titleLike) {
      where.push(`title LIKE ?`);
      params.push(filter.titleLike);
    }
    if (filter.takenAtFrom) {
      where.push(`taken_at >= ?`);
      params.push(filter.takenAtFrom);
    }
    if (filter.takenAtTo) {
      where.push(`taken_at <= ?`);
      params.push(filter.takenAtTo);
    }
    if (filter.createdAtFrom) {
      where.push(`created_at >= ?`);
      params.push(filter.createdAtFrom);
    }
    if (filter.createdAtTo) {
      where.push(`created_at <= ?`);
      params.push(filter.createdAtTo);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { field, direction } = resolveSort(
      sort,
      ['created_at', 'title', 'rating', 'taken_at', 'updated_at'],
      'created_at'
    );
    const { limit, offset, page, perPage } = resolvePagination(pagination);

    const countRow = await db.get(`SELECT COUNT(*) as count FROM mo_photos ${whereClause}`, params);
    const count = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT * FROM mo_photos ${whereClause} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { items: rows.map((r) => this.fromRow(r)), count, page, perPage };
  },

  async update(id, partial) {
    await buildPartialUpdate('mo_photos', id, partial, PHOTO_COL_MAP);
    return this.findById(id);
  },

  async destroy(id) {
    await db.run(`DELETE FROM mo_photos WHERE id = ?`, [id]);
  },

  async findByFileId(fileId) {
    const row = await db.get(
      `SELECT p.* FROM mo_photos p
       INNER JOIN mo_photos_files pf ON p.id = pf.photo_id
       WHERE pf.file_id = ?`,
      [fileId]
    );
    return this.fromRow(row);
  },

  async findManyByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.all(`SELECT * FROM mo_photos WHERE id IN (${placeholders})`, ids);
    return rows.map((r) => this.fromRow(r));
  },

  async count(filter = {}) {
    const where = [];
    const params = [];
    if (filter.rating !== undefined) {
      where.push(`rating >= ?`);
      params.push(filter.rating);
    }
    if (filter.curated !== undefined) {
      where.push(`curated = ?`);
      params.push(filter.curated ? 1 : 0);
    }
    if (filter.tagId !== undefined) {
      where.push(`id IN (SELECT photo_id FROM mo_photos_tags WHERE tag_id = ?)`);
      params.push(filter.tagId);
    }
    if (filter.tagIds && filter.tagIds.length > 0) {
      const placeholders = filter.tagIds.map(() => '?').join(', ');
      if (filter.tagMode === 'AND') {
        where.push(`id IN (SELECT photo_id FROM mo_photos_tags WHERE tag_id IN (${placeholders}) GROUP BY photo_id HAVING COUNT(DISTINCT tag_id) = ?)`);
        params.push(...filter.tagIds, filter.tagIds.length);
      } else {
        where.push(`id IN (SELECT photo_id FROM mo_photos_tags WHERE tag_id IN (${placeholders}))`);
        params.push(...filter.tagIds);
      }
    }
    if (filter.albumId !== undefined) {
      where.push(`id IN (SELECT photo_id FROM mo_albums_photos WHERE album_id = ?)`);
      params.push(filter.albumId);
    }
    if (filter.titleLike) {
      where.push(`title LIKE ?`);
      params.push(filter.titleLike);
    }
    if (filter.takenAtFrom) {
      where.push(`taken_at >= ?`);
      params.push(filter.takenAtFrom);
    }
    if (filter.takenAtTo) {
      where.push(`taken_at <= ?`);
      params.push(filter.takenAtTo);
    }
    if (filter.createdAtFrom) {
      where.push(`created_at >= ?`);
      params.push(filter.createdAtFrom);
    }
    if (filter.createdAtTo) {
      where.push(`created_at <= ?`);
      params.push(filter.createdAtTo);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const row = await db.get(`SELECT COUNT(*) as count FROM mo_photos ${whereClause}`, params);
    return row ? row.count : 0;
  },

  // --- Relationships ---

  async loadTags(photoId) {
    const rows = await db.all(
      `SELECT t.* FROM mo_tags t
       INNER JOIN mo_photos_tags pt ON t.id = pt.tag_id
       WHERE pt.photo_id = ?`,
      [photoId]
    );
    return rows.map((r) => TagQueries.fromRow(r));
  },

  async updateTags(photoId, updateIDs) {
    const ops = buildRelationOps('mo_photos_tags', 'photo_id', 'tag_id', photoId, updateIDs);
    if (ops.length > 0) await db.transaction(ops);
  },

  async loadFiles(photoId) {
    const rows = await db.all(
      `SELECT f.*, pf.is_primary FROM mo_files f
       INNER JOIN mo_photos_files pf ON f.id = pf.file_id
       WHERE pf.photo_id = ?
       ORDER BY pf.is_primary DESC`,
      [photoId]
    );
    return rows.map((r) => ({ ...FileQueries.fromRow(r), isPrimary: r.is_primary === 1 }));
  },

  async updateFiles(photoId, updateIDs) {
    const ops = buildRelationOps('mo_photos_files', 'photo_id', 'file_id', photoId, updateIDs);
    if (ops.length > 0) await db.transaction(ops);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8: VIDEO QUERIES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/scene.go — scene CRUD

const VIDEO_COL_MAP = {
  title: 'title',
  rating: 'rating',
  curated: 'curated',
  details: 'details',
  duration: 'duration',
};

const VideoQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title ?? '',
      rating: row.rating ?? 0,
      curated: row.curated ?? 0,
      details: row.details ?? '',
      duration: row.duration ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_videos (title, rating, curated, details, duration, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        input.title ?? '',
        input.rating ?? 0,
        input.curated ?? 0,
        input.details ?? '',
        input.duration ?? null,
      ]
    );
    const videoId = res.lastInsertRowid;

    if (input.fileIds && input.fileIds.length > 0) {
      const ops = input.fileIds.map((fid, i) => ({
        type: 'run',
        sql: `INSERT INTO mo_videos_files (video_id, file_id, is_primary) VALUES (?, ?, ?)`,
        params: [videoId, fid, i === 0 ? 1 : 0],
      }));
      await db.transaction(ops);
    }

    if (input.tagIds && input.tagIds.length > 0) {
      const ops = input.tagIds.map((tid) => ({
        type: 'run',
        sql: `INSERT INTO mo_videos_tags (video_id, tag_id) VALUES (?, ?)`,
        params: [videoId, tid],
      }));
      await db.transaction(ops);
    }

    return this.findById(videoId);
  },

  async findById(id) {
    const row = await db.get(`SELECT * FROM mo_videos WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async findMany(filter = {}, sort = {}, pagination = {}) {
    const where = [];
    const params = [];

    if (filter.rating !== undefined) {
      where.push(`rating >= ?`);
      params.push(filter.rating);
    }
    if (filter.curated !== undefined) {
      where.push(`curated = ?`);
      params.push(filter.curated ? 1 : 0);
    }
    if (filter.tagId !== undefined) {
      where.push(`id IN (SELECT video_id FROM mo_videos_tags WHERE tag_id = ?)`);
      params.push(filter.tagId);
    }
    // Multi-tag filter: tagIds with tagMode ('AND'|'OR')
    if (filter.tagIds && filter.tagIds.length > 0) {
      const placeholders = filter.tagIds.map(() => '?').join(', ');
      if (filter.tagMode === 'AND') {
        where.push(`id IN (SELECT video_id FROM mo_videos_tags WHERE tag_id IN (${placeholders}) GROUP BY video_id HAVING COUNT(DISTINCT tag_id) = ?)`);
        params.push(...filter.tagIds, filter.tagIds.length);
      } else {
        where.push(`id IN (SELECT video_id FROM mo_videos_tags WHERE tag_id IN (${placeholders}))`);
        params.push(...filter.tagIds);
      }
    }
    if (filter.albumId !== undefined) {
      where.push(`id IN (SELECT video_id FROM mo_albums_videos WHERE album_id = ?)`);
      params.push(filter.albumId);
    }
    if (filter.titleLike) {
      where.push(`title LIKE ?`);
      params.push(filter.titleLike);
    }
    if (filter.createdAtFrom) {
      where.push(`created_at >= ?`);
      params.push(filter.createdAtFrom);
    }
    if (filter.createdAtTo) {
      where.push(`created_at <= ?`);
      params.push(filter.createdAtTo);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { field, direction } = resolveSort(
      sort,
      ['created_at', 'title', 'rating', 'duration', 'updated_at'],
      'created_at'
    );
    const { limit, offset, page, perPage } = resolvePagination(pagination);

    const countRow = await db.get(`SELECT COUNT(*) as count FROM mo_videos ${whereClause}`, params);
    const count = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT * FROM mo_videos ${whereClause} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { items: rows.map((r) => this.fromRow(r)), count, page, perPage };
  },

  async update(id, partial) {
    await buildPartialUpdate('mo_videos', id, partial, VIDEO_COL_MAP);
    return this.findById(id);
  },

  async destroy(id) {
    await db.run(`DELETE FROM mo_videos WHERE id = ?`, [id]);
  },

  async findByFileId(fileId) {
    const row = await db.get(
      `SELECT v.* FROM mo_videos v
       INNER JOIN mo_videos_files vf ON v.id = vf.video_id
       WHERE vf.file_id = ?`,
      [fileId]
    );
    return this.fromRow(row);
  },

  async findManyByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.all(`SELECT * FROM mo_videos WHERE id IN (${placeholders})`, ids);
    return rows.map((r) => this.fromRow(r));
  },

  async count(filter = {}) {
    const where = [];
    const params = [];
    if (filter.rating !== undefined) {
      where.push(`rating >= ?`);
      params.push(filter.rating);
    }
    if (filter.curated !== undefined) {
      where.push(`curated = ?`);
      params.push(filter.curated ? 1 : 0);
    }
    if (filter.tagId !== undefined) {
      where.push(`id IN (SELECT video_id FROM mo_videos_tags WHERE tag_id = ?)`);
      params.push(filter.tagId);
    }
    if (filter.tagIds && filter.tagIds.length > 0) {
      const placeholders = filter.tagIds.map(() => '?').join(', ');
      if (filter.tagMode === 'AND') {
        where.push(`id IN (SELECT video_id FROM mo_videos_tags WHERE tag_id IN (${placeholders}) GROUP BY video_id HAVING COUNT(DISTINCT tag_id) = ?)`);
        params.push(...filter.tagIds, filter.tagIds.length);
      } else {
        where.push(`id IN (SELECT video_id FROM mo_videos_tags WHERE tag_id IN (${placeholders}))`);
        params.push(...filter.tagIds);
      }
    }
    if (filter.albumId !== undefined) {
      where.push(`id IN (SELECT video_id FROM mo_albums_videos WHERE album_id = ?)`);
      params.push(filter.albumId);
    }
    if (filter.titleLike) {
      where.push(`title LIKE ?`);
      params.push(filter.titleLike);
    }
    if (filter.createdAtFrom) {
      where.push(`created_at >= ?`);
      params.push(filter.createdAtFrom);
    }
    if (filter.createdAtTo) {
      where.push(`created_at <= ?`);
      params.push(filter.createdAtTo);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const row = await db.get(`SELECT COUNT(*) as count FROM mo_videos ${whereClause}`, params);
    return row ? row.count : 0;
  },

  // --- Relationships ---

  async loadTags(videoId) {
    const rows = await db.all(
      `SELECT t.* FROM mo_tags t
       INNER JOIN mo_videos_tags vt ON t.id = vt.tag_id
       WHERE vt.video_id = ?`,
      [videoId]
    );
    return rows.map((r) => TagQueries.fromRow(r));
  },

  async updateTags(videoId, updateIDs) {
    const ops = buildRelationOps('mo_videos_tags', 'video_id', 'tag_id', videoId, updateIDs);
    if (ops.length > 0) await db.transaction(ops);
  },

  async loadFiles(videoId) {
    const rows = await db.all(
      `SELECT f.*, vf.is_primary FROM mo_files f
       INNER JOIN mo_videos_files vf ON f.id = vf.file_id
       WHERE vf.video_id = ?
       ORDER BY vf.is_primary DESC`,
      [videoId]
    );
    return rows.map((r) => ({ ...FileQueries.fromRow(r), isPrimary: r.is_primary === 1 }));
  },

  async updateFiles(videoId, updateIDs) {
    const ops = buildRelationOps('mo_videos_files', 'video_id', 'file_id', videoId, updateIDs);
    if (ops.length > 0) await db.transaction(ops);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9: ALBUM QUERIES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/gallery.go — gallery CRUD

const ALBUM_COL_MAP = {
  title: 'title',
  description: 'description',
  rating: 'rating',
  folderId: 'folder_id',
  date: 'date',
};

const AlbumQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      description: row.description ?? '',
      rating: row.rating ?? 0,
      folderId: row.folder_id ?? null,
      date: row.date ?? null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_albums (title, description, rating, folder_id, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      [
        input.title,
        input.description ?? '',
        input.rating ?? 0,
        input.folderId ?? null,
        input.date ?? null,
      ]
    );
    return this.findById(res.lastInsertRowid);
  },

  async findById(id) {
    const row = await db.get(`SELECT * FROM mo_albums WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async findMany(filter = {}, sort = {}, pagination = {}) {
    const where = [];
    const params = [];

    if (filter.rating !== undefined) {
      where.push(`rating >= ?`);
      params.push(filter.rating);
    }
    if (filter.folderId !== undefined) {
      if (filter.folderId === null) {
        where.push(`folder_id IS NULL`);
      } else {
        where.push(`folder_id = ?`);
        params.push(filter.folderId);
      }
    }
    if (filter.tagId !== undefined) {
      where.push(`id IN (SELECT album_id FROM mo_albums_tags WHERE tag_id = ?)`);
      params.push(filter.tagId);
    }
    if (filter.titleLike) {
      where.push(`title LIKE ?`);
      params.push(filter.titleLike);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const { field, direction } = resolveSort(sort, ['created_at', 'title', 'rating', 'updated_at']);
    const { limit, offset, page, perPage } = resolvePagination(pagination);

    const countRow = await db.get(`SELECT COUNT(*) as count FROM mo_albums ${whereClause}`, params);
    const count = countRow ? countRow.count : 0;

    const rows = await db.all(
      `SELECT * FROM mo_albums ${whereClause} ORDER BY ${field} ${direction} LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    return { items: rows.map((r) => this.fromRow(r)), count, page, perPage };
  },

  async update(id, partial) {
    await buildPartialUpdate('mo_albums', id, partial, ALBUM_COL_MAP);
    return this.findById(id);
  },

  async destroy(id) {
    await db.run(`DELETE FROM mo_albums WHERE id = ?`, [id]);
  },

  // --- Relationships ---

  async loadTags(albumId) {
    const rows = await db.all(
      `SELECT t.* FROM mo_tags t
       INNER JOIN mo_albums_tags at2 ON t.id = at2.tag_id
       WHERE at2.album_id = ?`,
      [albumId]
    );
    return rows.map((r) => TagQueries.fromRow(r));
  },

  async updateTags(albumId, updateIDs) {
    const ops = buildRelationOps('mo_albums_tags', 'album_id', 'tag_id', albumId, updateIDs);
    if (ops.length > 0) await db.transaction(ops);
  },

  async loadPhotos(albumId) {
    const rows = await db.all(
      `SELECT p.*, ap.position FROM mo_photos p
       INNER JOIN mo_albums_photos ap ON p.id = ap.photo_id
       WHERE ap.album_id = ?
       ORDER BY ap.position ASC, p.created_at DESC`,
      [albumId]
    );
    return rows.map((r) => ({ ...PhotoQueries.fromRow(r), position: r.position ?? 0 }));
  },

  // Adapted from stash: pkg/sqlite/gallery.go — position-aware photo assignment
  async updatePhotos(albumId, updateIDs) {
    const { mode, ids } = updateIDs;
    if (mode === 'SET') {
      const ops = [
        { type: 'run', sql: `DELETE FROM mo_albums_photos WHERE album_id = ?`, params: [albumId] },
      ];
      for (let i = 0; i < ids.length; i++) {
        ops.push({
          type: 'run',
          sql: `INSERT INTO mo_albums_photos (album_id, photo_id, position) VALUES (?, ?, ?)`,
          params: [albumId, ids[i], i],
        });
      }
      await db.transaction(ops);
    } else if (mode === 'ADD') {
      const maxRow = await db.get(
        `SELECT COALESCE(MAX(position), -1) as maxPos FROM mo_albums_photos WHERE album_id = ?`,
        [albumId]
      );
      let pos = (maxRow ? maxRow.maxPos : -1) + 1;
      const ops = [];
      for (const id of ids) {
        ops.push({
          type: 'run',
          sql: `INSERT OR IGNORE INTO mo_albums_photos (album_id, photo_id, position) VALUES (?, ?, ?)`,
          params: [albumId, id, pos++],
        });
      }
      if (ops.length > 0) await db.transaction(ops);
    } else if (mode === 'REMOVE') {
      const ops = ids.map((id) => ({
        type: 'run',
        sql: `DELETE FROM mo_albums_photos WHERE album_id = ? AND photo_id = ?`,
        params: [albumId, id],
      }));
      if (ops.length > 0) await db.transaction(ops);
    }
  },

  async loadVideos(albumId) {
    const rows = await db.all(
      `SELECT v.*, av.position FROM mo_videos v
       INNER JOIN mo_albums_videos av ON v.id = av.video_id
       WHERE av.album_id = ?
       ORDER BY av.position ASC, v.created_at DESC`,
      [albumId]
    );
    return rows.map((r) => ({ ...VideoQueries.fromRow(r), position: r.position ?? 0 }));
  },

  // Adapted from stash: pkg/sqlite/gallery.go — position-aware video assignment
  async updateVideos(albumId, updateIDs) {
    const { mode, ids } = updateIDs;
    if (mode === 'SET') {
      const ops = [
        { type: 'run', sql: `DELETE FROM mo_albums_videos WHERE album_id = ?`, params: [albumId] },
      ];
      for (let i = 0; i < ids.length; i++) {
        ops.push({
          type: 'run',
          sql: `INSERT INTO mo_albums_videos (album_id, video_id, position) VALUES (?, ?, ?)`,
          params: [albumId, ids[i], i],
        });
      }
      await db.transaction(ops);
    } else if (mode === 'ADD') {
      const maxRow = await db.get(
        `SELECT COALESCE(MAX(position), -1) as maxPos FROM mo_albums_videos WHERE album_id = ?`,
        [albumId]
      );
      let pos = (maxRow ? maxRow.maxPos : -1) + 1;
      const ops = [];
      for (const id of ids) {
        ops.push({
          type: 'run',
          sql: `INSERT OR IGNORE INTO mo_albums_videos (album_id, video_id, position) VALUES (?, ?, ?)`,
          params: [albumId, id, pos++],
        });
      }
      if (ops.length > 0) await db.transaction(ops);
    } else if (mode === 'REMOVE') {
      const ops = ids.map((id) => ({
        type: 'run',
        sql: `DELETE FROM mo_albums_videos WHERE album_id = ? AND video_id = ?`,
        params: [albumId, id],
      }));
      if (ops.length > 0) await db.transaction(ops);
    }
  },

  async findManyByIds(ids) {
    if (!ids || ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await db.all(`SELECT * FROM mo_albums WHERE id IN (${placeholders})`, ids);
    return rows.map((r) => this.fromRow(r));
  },

  async count(filter = {}) {
    const where = [];
    const params = [];
    if (filter.rating !== undefined) {
      where.push(`rating >= ?`);
      params.push(filter.rating);
    }
    if (filter.folderId !== undefined) {
      if (filter.folderId === null) {
        where.push(`folder_id IS NULL`);
      } else {
        where.push(`folder_id = ?`);
        params.push(filter.folderId);
      }
    }
    if (filter.tagId !== undefined) {
      where.push(`id IN (SELECT album_id FROM mo_albums_tags WHERE tag_id = ?)`);
      params.push(filter.tagId);
    }
    if (filter.titleLike) {
      where.push(`title LIKE ?`);
      params.push(filter.titleLike);
    }
    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const row = await db.get(`SELECT COUNT(*) as count FROM mo_albums ${whereClause}`, params);
    return row ? row.count : 0;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10: IMAGE FILE & VIDEO FILE QUERIES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/sqlite/file.go — typed file metadata

const IMAGE_FILE_COL_MAP = {
  width: 'width',
  height: 'height',
  format: 'format',
};

const ImageFileQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      fileId: row.file_id,
      width: row.width ?? null,
      height: row.height ?? null,
      format: row.format ?? null,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_image_files (file_id, width, height, format) VALUES (?, ?, ?, ?)`,
      [input.fileId, input.width ?? null, input.height ?? null, input.format ?? null]
    );
    return { id: res.lastInsertRowid, fileId: input.fileId, width: input.width ?? null, height: input.height ?? null, format: input.format ?? null };
  },

  async findByFileId(fileId) {
    const row = await db.get(`SELECT * FROM mo_image_files WHERE file_id = ?`, [fileId]);
    return this.fromRow(row);
  },

  async update(id, partial) {
    await buildPartialUpdate('mo_image_files', id, partial, IMAGE_FILE_COL_MAP);
    const row = await db.get(`SELECT * FROM mo_image_files WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async upsert(input) {
    const existing = await this.findByFileId(input.fileId);
    if (existing) {
      return this.update(existing.id, input);
    }
    return this.create(input);
  },
};

const VIDEO_FILE_COL_MAP = {
  duration: 'duration',
  width: 'width',
  height: 'height',
  codec: 'codec',
  bitRate: 'bit_rate',
  frameRate: 'frame_rate',
};

const VideoFileQueries = {
  fromRow(row) {
    if (!row) return null;
    return {
      id: row.id,
      fileId: row.file_id,
      duration: row.duration ?? null,
      width: row.width ?? null,
      height: row.height ?? null,
      codec: row.codec ?? null,
      bitRate: row.bit_rate ?? null,
      frameRate: row.frame_rate ?? null,
    };
  },

  async create(input) {
    const res = await db.run(
      `INSERT INTO mo_video_files (file_id, duration, width, height, codec, bit_rate, frame_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.fileId,
        input.duration ?? null,
        input.width ?? null,
        input.height ?? null,
        input.codec ?? null,
        input.bitRate ?? null,
        input.frameRate ?? null,
      ]
    );
    return {
      id: res.lastInsertRowid,
      fileId: input.fileId,
      duration: input.duration ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      codec: input.codec ?? null,
      bitRate: input.bitRate ?? null,
      frameRate: input.frameRate ?? null,
    };
  },

  async findByFileId(fileId) {
    const row = await db.get(`SELECT * FROM mo_video_files WHERE file_id = ?`, [fileId]);
    return this.fromRow(row);
  },

  async update(id, partial) {
    await buildPartialUpdate('mo_video_files', id, partial, VIDEO_FILE_COL_MAP);
    const row = await db.get(`SELECT * FROM mo_video_files WHERE id = ?`, [id]);
    return this.fromRow(row);
  },

  async upsert(input) {
    const existing = await this.findByFileId(input.fileId);
    if (existing) {
      return this.update(existing.id, input);
    }
    return this.create(input);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12: SCAN CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/manager/config.go — scan configuration defaults

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.tif',
  '.heic', '.heif', '.avif', '.svg', '.ico', '.raw', '.cr2', '.nef',
  '.arw', '.dng', '.orf', '.rw2', '.pef', '.srw',
]);

const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v',
  '.mpg', '.mpeg', '.3gp', '.ogv', '.ts', '.mts', '.m2ts', '.vob',
]);

const SCAN_DEFAULTS = {
  chunkSize: 5,
  yieldMs: 0,
  excludePatterns: [],
  minFileSize: 1,
  ffprobeTimeout: 15000,
  exiftoolTimeout: 10000,
  hashTimeout: 30000,
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13: EXTERNAL TOOL DETECTION
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/manager/manager.go — external binary detection

let _toolPaths = { ffprobe: null, exiftool: null, node: null, ffmpeg: null, vips: null };
let _toolsDetected = false;

const _isWindows = window.parallxElectron.platform === 'win32';

/**
 * Shell-safe path quoting. On Unix, wraps in single quotes with internal
 * single-quote escaping. On Windows PowerShell, wraps in single quotes
 * (no interpolation) with internal single-quote doubling.
 * Prevents $(), backtick, pipe, semicolon injection.
 * Adapted from: Go exec.Command passes args directly — we emulate that safety.
 */
function shellQuote(str) {
  if (_isWindows) {
    // PowerShell single-quoted strings: only escape is '' for literal '
    return "'" + str.replace(/'/g, "''") + "'";
  }
  // POSIX sh single-quoted strings: end quote, escaped quote, restart quote
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

async function detectTool(name) {
  try {
    const cmd = _isWindows ? `where.exe ${name}` : `which ${name}`;
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: 5000 });
    if (result.exitCode === 0 && result.stdout.trim()) {
      return result.stdout.trim().split(/\r?\n/)[0];
    }
    return null;
  } catch { return null; }
}

async function detectAllTools() {
  if (_toolsDetected) return _toolPaths;
  const [ffprobe, exiftool, node, ffmpeg, vips] = await Promise.all([
    detectTool('ffprobe'),
    detectTool('exiftool'),
    detectTool('node'),
    detectTool('ffmpeg'),
    detectTool('vips'),
  ]);
  _toolPaths = { ffprobe, exiftool, node, ffmpeg, vips };
  _toolsDetected = true;
  if (!ffprobe) console.warn('[MediaOrganizer] ffprobe not found — video metadata will be unavailable');
  if (!exiftool) console.warn('[MediaOrganizer] exiftool not found — EXIF data will be unavailable');
  if (!node) console.warn('[MediaOrganizer] node not found — oshash unavailable, using MD5 only');
  if (!ffmpeg && !vips) console.warn('[MediaOrganizer] Neither ffmpeg nor vips found — thumbnails will use canvas fallback');
  return _toolPaths;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14: FINGERPRINT SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/file/hash.go — oshash + MD5 computation

const OSHASH_CHUNK = 65536;

async function computeOshash(filePath) {
  if (!_toolPaths.node) return null;
  // Inline Node.js script — reads 64KB head + 64KB tail, sums uint64LE + filesize
  // Security: filePath passed via process.argv, not embedded in script
  const script = [
    `const fs=require('fs');const p=process.argv[1];`,
    `const s=fs.statSync(p).size;`,
    `if(s<${OSHASH_CHUNK * 2}){`,
    `const b=fs.readFileSync(p);let h=BigInt(s);`,
    `for(let i=0;i+7<b.length;i+=8){h=(h+b.readBigUInt64LE(i))&0xFFFFFFFFFFFFFFFFn;}`,
    `process.stdout.write(h.toString(16).padStart(16,'0'));}`,
    `else{const fd=fs.openSync(p,'r');`,
    `const hd=Buffer.alloc(${OSHASH_CHUNK});const tl=Buffer.alloc(${OSHASH_CHUNK});`,
    `fs.readSync(fd,hd,0,${OSHASH_CHUNK},0);`,
    `fs.readSync(fd,tl,0,${OSHASH_CHUNK},s-${OSHASH_CHUNK});fs.closeSync(fd);`,
    `let h=BigInt(s);`,
    `for(let i=0;i<${OSHASH_CHUNK};i+=8){h=(h+hd.readBigUInt64LE(i))&0xFFFFFFFFFFFFFFFFn;}`,
    `for(let i=0;i<${OSHASH_CHUNK};i+=8){h=(h+tl.readBigUInt64LE(i))&0xFFFFFFFFFFFFFFFFn;}`,
    `process.stdout.write(h.toString(16).padStart(16,'0'));}`
  ].join('');
  try {
    // Script is a fixed string (no user data); filePath is shell-quoted as a separate argument
    const cmd = `${shellQuote(_toolPaths.node)} -e ${shellQuote(script)} ${shellQuote(filePath)}`;
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: SCAN_DEFAULTS.hashTimeout });
    if (result.exitCode === 0 && result.stdout.trim()) return result.stdout.trim();
    return null;
  } catch { return null; }
}

async function computeMD5(filePath) {
  try {
    let cmd;
    if (_isWindows) {
      cmd = `certutil -hashfile ${shellQuote(filePath)} MD5`;
    } else {
      cmd = `md5sum ${shellQuote(filePath)}`;
    }
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: SCAN_DEFAULTS.hashTimeout });
    if (result.exitCode !== 0) return null;
    if (_isWindows) {
      // certutil output: line 0 = header, line 1 = hash, line 2 = status
      const lines = result.stdout.trim().split(/\r?\n/);
      return lines.length > 1 ? lines[1].trim().replace(/\s/g, '') : null;
    } else {
      return result.stdout.trim().split(/\s/)[0] || null;
    }
  } catch { return null; }
}

async function fingerprintFile(filePath, fileType) {
  const fps = [];
  if (fileType === 'video') {
    const oshash = await computeOshash(filePath);
    if (oshash) fps.push({ type: 'oshash', value: oshash });
  }
  const md5 = await computeMD5(filePath);
  if (md5) fps.push({ type: 'md5', value: md5 });
  return fps;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15: METADATA EXTRACTION SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/ffmpeg/ffprobe.go — ffprobe JSON parsing
// Adapted from stash: internal/manager/task_scan.go — EXIF extraction

async function extractVideoMeta(filePath) {
  if (!_toolPaths.ffprobe) return null;
  try {
    const cmd = `${shellQuote(_toolPaths.ffprobe)} -v quiet -print_format json -show_format -show_streams ${shellQuote(filePath)}`;
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: SCAN_DEFAULTS.ffprobeTimeout });
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const data = JSON.parse(result.stdout);
    const videoStream = (data.streams || []).find(s => s.codec_type === 'video');
    const format = data.format || {};
    return {
      duration: parseFloat(format.duration) || 0,
      width: videoStream ? (videoStream.width || 0) : 0,
      height: videoStream ? (videoStream.height || 0) : 0,
      codec: videoStream ? (videoStream.codec_name || '') : '',
      audioCodec: ((data.streams || []).find(s => s.codec_type === 'audio') || {}).codec_name || '',
      bitRate: parseInt(format.bit_rate) || 0,
      frameRate: videoStream ? parseFrameRate(videoStream.r_frame_rate) : 0,
      format: format.format_name || '',
    };
  } catch { return null; }
}

function parseFrameRate(rateStr) {
  if (!rateStr) return 0;
  const parts = rateStr.split('/');
  if (parts.length === 2) {
    const num = parseFloat(parts[0]);
    const den = parseFloat(parts[1]);
    return den > 0 ? Math.round((num / den) * 100) / 100 : 0;
  }
  return parseFloat(rateStr) || 0;
}

async function extractImageDimensions(filePath) {
  if (!_toolPaths.ffprobe) return null;
  try {
    const cmd = `${shellQuote(_toolPaths.ffprobe)} -v quiet -print_format json -show_streams ${shellQuote(filePath)}`;
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: SCAN_DEFAULTS.ffprobeTimeout });
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const data = JSON.parse(result.stdout);
    const stream = (data.streams || []).find(s => s.codec_type === 'video');
    if (!stream) return null;
    return {
      width: stream.width || 0,
      height: stream.height || 0,
      format: stream.codec_name || '',
    };
  } catch { return null; }
}

async function extractEXIF(filePath) {
  if (!_toolPaths.exiftool) return null;
  try {
    const cmd = `${shellQuote(_toolPaths.exiftool)} -json -n ${shellQuote(filePath)}`;
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: SCAN_DEFAULTS.exiftoolTimeout });
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const arr = JSON.parse(result.stdout);
    if (!arr || !arr.length) return null;
    const d = arr[0];
    return {
      cameraMake: d.Make || null,
      cameraModel: d.Model || null,
      lens: d.LensModel || d.Lens || null,
      iso: d.ISO != null ? Number(d.ISO) : null,
      aperture: d.FNumber != null ? Number(d.FNumber) : null,
      shutterSpeed: d.ExposureTime != null ? String(d.ExposureTime) : null,
      focalLength: d.FocalLength != null ? Number(d.FocalLength) : null,
      gpsLatitude: d.GPSLatitude != null ? Number(d.GPSLatitude) : null,
      gpsLongitude: d.GPSLongitude != null ? Number(d.GPSLongitude) : null,
      takenAt: d.DateTimeOriginal ? parseExifDate(d.DateTimeOriginal) : null,
    };
  } catch { return null; }
}

function parseExifDate(raw) {
  // ExifTool with -n returns "YYYY:MM:DD HH:MM:SS" → ISO 8601
  if (typeof raw !== 'string') return null;
  const iso = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function extractMetadata(filePath, fileType) {
  if (fileType === 'video') {
    const videoMeta = await extractVideoMeta(filePath);
    return { typeSpecific: videoMeta, exif: null };
  }
  // Image: extract dimensions and EXIF in parallel
  const [dims, exif] = await Promise.all([
    extractImageDimensions(filePath),
    extractEXIF(filePath),
  ]);
  return { typeSpecific: dims, exif };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16: DIRECTORY WALKER & FILTER PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: internal/manager/task_scan.go — recursive directory walk

function classifyFile(name) {
  const dot = name.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = name.slice(dot).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return null;
}

function shouldExclude(relPath, excludePatterns) {
  for (const pattern of excludePatterns) {
    if (pattern.test(relPath)) return true;
  }
  return false;
}

// Folder path→ID cache (cleared each scan)
// Adapted from stash: pkg/file/scan.go — folderPathToID sync.Map
let _folderIdCache = new Map();

async function walkDirectory(rootPath, options, onProgress) {
  const { excludePatterns = [], minFileSize = 1 } = options;
  const compiledExcludes = excludePatterns.map(p => new RegExp(p, 'i'));
  const entries = [];

  async function recurse(dirPath) {
    if (_scanCancelled) return;
    onProgress(dirPath);

    const result = await window.parallxElectron.fs.readdir(dirPath);
    if (result.error) {
      console.warn(`[MediaOrganizer] Cannot read directory: ${dirPath}`, result.error);
      return;
    }

    // Register folder in database (cached)
    let folderId;
    if (_folderIdCache.has(dirPath)) {
      folderId = _folderIdCache.get(dirPath);
    } else {
      const folder = await FolderQueries.findOrCreate(dirPath);
      folderId = folder.id;
      _folderIdCache.set(dirPath, folderId);
    }

    for (const item of result.entries) {
      if (_scanCancelled) return;
      if (!item.name || item.type == null) continue; // skip invalid entries

      const sep = _isWindows ? '\\' : '/';
      const fullPath = dirPath.replace(/[\\/]$/, '') + sep + item.name;
      const relPath = fullPath.slice(rootPath.length);

      if (item.type === 'directory') {
        if (item.name.startsWith('.') || shouldExclude(relPath, compiledExcludes)) continue;
        await recurse(fullPath);
        continue;
      }

      // File
      const fileType = classifyFile(item.name);
      if (!fileType) continue;
      if (item.size < minFileSize) continue;
      if (shouldExclude(relPath, compiledExcludes)) continue;

      entries.push({
        path: fullPath,
        name: item.name,
        size: item.size,
        mtime: item.mtime,
        fileType,
        folderId,
      });
    }
  }

  await recurse(rootPath);
  return entries;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 17: SCAN ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: internal/manager/task_scan.go — scan orchestration

let _scanRunning = false;
let _scanCancelled = false;
let _statusBarItem = null;

async function processFile(entry) {
  // 1. Check if file exists in DB
  const existing = await FileQueries.findByFolderAndName(entry.folderId, entry.name);

  if (existing) {
    // If mtime matches, check for missing data before skipping
    // Adapted from stash: pkg/file/scan.go — onUnchangedFile / setMissingFingerprints
    if (Number(existing.modTime) === Number(entry.mtime)) {
      let recovered = false;

      // Check for missing fingerprints (tools may have been installed since last scan)
      const existingFps = await FingerprintQueries.findByFile(existing.id);
      if (existingFps.length === 0) {
        const fps = await fingerprintFile(entry.path, entry.fileType);
        for (const fp of fps) {
          await FingerprintQueries.upsert({ fileId: existing.id, type: fp.type, value: fp.value });
        }
        if (fps.length > 0) recovered = true;
      }

      // Check for missing metadata (ffprobe/exiftool may now be available)
      const hasTypeMeta = entry.fileType === 'image'
        ? await ImageFileQueries.findByFileId(existing.id)
        : await VideoFileQueries.findByFileId(existing.id);
      if (!hasTypeMeta) {
        const meta = await extractMetadata(entry.path, entry.fileType);
        if (entry.fileType === 'image' && meta.typeSpecific) {
          await ImageFileQueries.upsert({ fileId: existing.id, width: meta.typeSpecific.width, height: meta.typeSpecific.height, format: meta.typeSpecific.format });
          recovered = true;
        }
        if (entry.fileType === 'video' && meta.typeSpecific) {
          await VideoFileQueries.upsert({ fileId: existing.id, ...meta.typeSpecific });
          recovered = true;
        }
      }

      return recovered
        ? { action: 'updated', fileId: existing.id }
        : { action: 'skipped', fileId: existing.id };
    }
    // mtime changed: update file record
    await db.run(
      'UPDATE mo_files SET size = ?, mod_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [entry.size, entry.mtime, existing.id]
    );
    // Update fingerprints
    const fps = await fingerprintFile(entry.path, entry.fileType);
    for (const fp of fps) {
      await FingerprintQueries.upsert({ fileId: existing.id, type: fp.type, value: fp.value });
    }
    // Update metadata
    const meta = await extractMetadata(entry.path, entry.fileType);
    if (entry.fileType === 'image' && meta.typeSpecific) {
      await ImageFileQueries.upsert({ fileId: existing.id, width: meta.typeSpecific.width, height: meta.typeSpecific.height, format: meta.typeSpecific.format });
    }
    if (entry.fileType === 'video' && meta.typeSpecific) {
      await VideoFileQueries.upsert({ fileId: existing.id, ...meta.typeSpecific });
    }
    // Update domain entity on rescan
    // Adapted from stash: pkg/scene/scan.go — associateExisting always touches updated_at
    if (entry.fileType === 'image') {
      const photoRow = await db.get('SELECT photo_id FROM mo_photos_files WHERE file_id = ?', [existing.id]);
      if (photoRow) {
        const photoUpdate = {};
        if (meta.exif) Object.assign(photoUpdate, meta.exif);
        await db.run('UPDATE mo_photos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [photoRow.photo_id]);
        if (Object.keys(photoUpdate).length > 0) {
          await PhotoQueries.update(photoRow.photo_id, photoUpdate);
        }
      }
    }
    if (entry.fileType === 'video') {
      const videoRow = await db.get('SELECT video_id FROM mo_videos_files WHERE file_id = ?', [existing.id]);
      if (videoRow) {
        const videoUpdate = {};
        if (meta.typeSpecific && meta.typeSpecific.duration != null) {
          videoUpdate.duration = meta.typeSpecific.duration;
        }
        await db.run('UPDATE mo_videos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [videoRow.video_id]);
        if (Object.keys(videoUpdate).length > 0) {
          await VideoQueries.update(videoRow.video_id, videoUpdate);
        }
      }
    }
    return { action: 'updated', fileId: existing.id };
  }

  // 2. New file — compute fingerprints first for dedup/rename check
  const fps = await fingerprintFile(entry.path, entry.fileType);

  // 3. Dedup/rename check via fingerprint
  // Adapted from stash: pkg/file/scan.go — handleRename
  // Same fingerprint + original missing = rename; same fingerprint + original exists = duplicate
  for (const fp of fps) {
    const matches = await FingerprintQueries.findByValue(fp.type, fp.value);
    if (matches.length > 0) {
      const match = matches[0];
      const matchedFile = await FileQueries.findById(match.fileId);
      if (!matchedFile) continue; // Orphan fingerprint — skip
      const matchedFolder = await db.get('SELECT path FROM mo_folders WHERE id = ?', [matchedFile.folderId]);
      if (!matchedFolder) continue; // Orphan folder — skip
      const sep = _isWindows ? '\\' : '/';
      const originalPath = matchedFolder.path + sep + matchedFile.basename;
      const stillExists = await window.parallxElectron.fs.exists(originalPath);
      if (!stillExists) {
        // Original gone — this is a rename
        await db.run(
          'UPDATE mo_files SET basename = ?, folder_id = ?, size = ?, mod_time = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [entry.name, entry.folderId, entry.size, entry.mtime, matchedFile.id]
        );
        // Touch domain entity updated_at
        const photoLink = await db.get('SELECT photo_id FROM mo_photos_files WHERE file_id = ?', [matchedFile.id]);
        if (photoLink) await db.run('UPDATE mo_photos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [photoLink.photo_id]);
        const videoLink = await db.get('SELECT video_id FROM mo_videos_files WHERE file_id = ?', [matchedFile.id]);
        if (videoLink) await db.run('UPDATE mo_videos SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [videoLink.video_id]);
        return { action: 'renamed', fileId: matchedFile.id };
      }
      // Original still exists — treat as duplicate
      return { action: 'duplicate', fileId: match.fileId };
    }
  }

  // 4-8. Create file + fingerprints + metadata + domain entity in transaction
  // Adapted from stash: pkg/file/scan.go — onNewFile wraps Create+Handlers in WithTxn
  const meta = await extractMetadata(entry.path, entry.fileType);

  const txnOps = [
    { type: 'run',
      sql: `INSERT INTO mo_files (basename, size, mod_time, folder_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
      params: [entry.name, entry.size, entry.mtime, entry.folderId] },
  ];

  const txnResult = await db.transaction(txnOps);
  const fileId = txnResult[0].lastInsertRowid;

  // 5. Store fingerprints (outside txn — these are idempotent via upsert)
  for (const fp of fps) {
    await FingerprintQueries.upsert({ fileId, type: fp.type, value: fp.value });
  }

  // 7. Upsert type-specific file record
  if (entry.fileType === 'image' && meta.typeSpecific) {
    await ImageFileQueries.upsert({ fileId, width: meta.typeSpecific.width, height: meta.typeSpecific.height, format: meta.typeSpecific.format });
  }
  if (entry.fileType === 'video' && meta.typeSpecific) {
    await VideoFileQueries.upsert({ fileId, ...meta.typeSpecific });
  }

  // 8. Create domain entity (Photo or Video) + link
  if (entry.fileType === 'image') {
    const photoData = { title: entry.name };
    if (meta.exif) Object.assign(photoData, meta.exif);
    const photo = await PhotoQueries.create(photoData);
    await db.run('INSERT INTO mo_photos_files (photo_id, file_id, is_primary) VALUES (?, ?, 1)', [photo.id, fileId]);

    // 9. Generate thumbnail for new photo (scan-time, synchronous, non-fatal)
    // Adapted from stash: internal/manager/task_scan.go — imageGenerators.Generate
    // Upstream treats thumbnail failure as non-fatal for the scan handler.
    if (_api) {
      try {
        const checksum = fps.find(f => f.type === 'md5');
        const imgW = meta.typeSpecific ? meta.typeSpecific.width : 0;
        const imgH = meta.typeSpecific ? meta.typeSpecific.height : 0;
        if (checksum) {
          await generateImageThumbnail(checksum.value, entry.path, imgW, imgH, _api);
        }
      } catch (thumbErr) {
        console.warn(`[MediaOrganizer] Thumbnail generation failed for ${entry.path}:`, thumbErr);
      }
    }
  } else {
    const videoData = { title: entry.name };
    if (meta.typeSpecific) videoData.duration = meta.typeSpecific.duration || 0;
    const video = await VideoQueries.create(videoData);
    await db.run('INSERT INTO mo_videos_files (video_id, file_id, is_primary) VALUES (?, ?, 1)', [video.id, fileId]);

    // 9. Generate cover frame for new video (scan-time, synchronous, non-fatal)
    // Adapted from stash: internal/manager/task_scan.go — sceneGenerators.Generate
    // Upstream treats cover-generation failure as non-fatal for the scan handler.
    if (_api) {
      try {
        const checksum = fps.find(f => f.type === 'md5');
        const dur = meta.typeSpecific ? meta.typeSpecific.duration : 0;
        const vidW = meta.typeSpecific ? (meta.typeSpecific.width || 0) : 0;
        const vidH = meta.typeSpecific ? (meta.typeSpecific.height || 0) : 0;
        if (checksum) {
          await generateVideoCoverFrame(checksum.value, entry.path, dur, _api, false, null, vidW, vidH);
        }
      } catch (coverErr) {
        console.warn(`[MediaOrganizer] Cover frame generation failed for ${entry.path}:`, coverErr);
      }
    }
  }

  return { action: 'created', fileId };
}

async function processChunk(chunk) {
  const results = await Promise.allSettled(chunk.map(entry => processFile(entry)));
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.error(`[MediaOrganizer] Error processing ${chunk[i].path}:`, r.reason);
    return { action: 'error', fileId: null };
  });
}

async function runScan(rootPath, api) {
  if (_scanRunning) {
    api.window.showWarningMessage('A scan is already in progress.');
    return null;
  }

  const startTime = Date.now();
  _scanRunning = true;
  _scanCancelled = false;

  const stats = { total: 0, created: 0, updated: 0, renamed: 0, skipped: 0, duplicates: 0, errors: 0, cancelled: false };

  try {
    // Ensure tools are detected
    await detectAllTools();

    // Phase 1: Walk
    if (_statusBarItem) {
      _statusBarItem.text = '$(search) Scanning directories\u2026';
      _statusBarItem.show();
    }

    const entries = await walkDirectory(rootPath, {
      excludePatterns: SCAN_DEFAULTS.excludePatterns,
      minFileSize: SCAN_DEFAULTS.minFileSize,
    }, (dir) => {
      if (_statusBarItem) _statusBarItem.text = '$(search) Walking\u2026';
    });

    if (_scanCancelled) {
      stats.cancelled = true;
      return stats;
    }

    stats.total = entries.length;

    // Phase 2: Process in chunks
    for (let i = 0; i < entries.length; i += SCAN_DEFAULTS.chunkSize) {
      if (_scanCancelled) { stats.cancelled = true; break; }

      const chunk = entries.slice(i, i + SCAN_DEFAULTS.chunkSize);
      const results = await processChunk(chunk);

      for (const r of results) {
        if (r.action === 'created') stats.created++;
        else if (r.action === 'updated') stats.updated++;
        else if (r.action === 'renamed') stats.renamed++;
        else if (r.action === 'skipped') stats.skipped++;
        else if (r.action === 'duplicate') stats.duplicates++;
        else if (r.action === 'error') stats.errors++;
      }

      const done = Math.min(i + chunk.length, entries.length);
      if (_statusBarItem) {
        _statusBarItem.text = `$(sync~spin) ${done}/${stats.total} files`;
      }

      // Yield to event loop
      await new Promise(r => setTimeout(r, SCAN_DEFAULTS.yieldMs));
    }

    return stats;
  } catch (err) {
    console.error('[MediaOrganizer] Scan error:', err);
    stats.errors++;
    return stats;
  } finally {
    _scanRunning = false;
    _folderIdCache.clear();
    const durationMs = Date.now() - startTime;
    const durationSec = (durationMs / 1000).toFixed(1);

    if (_statusBarItem) {
      if (stats.cancelled) {
        _statusBarItem.text = '$(warning) Scan cancelled';
      } else {
        _statusBarItem.text = `$(check) Scan done \u2014 ${stats.total} files (${durationSec}s)`;
      }
      setTimeout(() => { if (_statusBarItem) _statusBarItem.hide(); }, 5000);
    }

    const msg = stats.cancelled
      ? `Scan cancelled: ${stats.created + stats.updated + stats.renamed} files processed before cancellation.`
      : `Scan complete: ${stats.total} files (${stats.created} new, ${stats.updated} updated, ${stats.renamed} renamed, ${stats.skipped} unchanged, ${stats.duplicates} duplicates, ${stats.errors} errors) in ${durationSec}s`;
    api.window.showInformationMessage(msg);
  }
}

function cancelScan() {
  if (_scanRunning) _scanCancelled = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 18: THUMBNAIL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/models/model_gallery.go — DefaultGthumbWidth
// Adapted from stash: pkg/models/paths/paths_generated.go — sharding constants
// Adapted from stash: pkg/image/thumbnail.go — quality settings

const THUMB_MAX_SIZE = 640;        // Stash DefaultGthumbWidth
const THUMB_QUALITY_VIPS = 70;     // Stash vips Q=70
const THUMB_QUALITY_FFMPEG = 5;    // Stash ffmpegImageQuality = 5
const THUMB_DIR_DEPTH = 2;         // Stash thumbDirDepth
const THUMB_DIR_LENGTH = 2;        // Stash thumbDirLength
const THUMB_FORMAT = 'jpg';

const THUMB_SUBFOLDER = '.parallx/extensions/media-organizer/thumbnails';

// Video cover frame constants
// Adapted from stash: pkg/scene/generate/screenshot.go — screenshotDurationProportion, screenshotQuality
const COVER_TIMESTAMP_PERCENT = 0.2;  // Stash default: 20% into the video
const COVER_QUALITY_FFMPEG = 2;        // Stash screenshotQuality (-q:v scale, lower = better)

let _thumbDir = null;

/**
 * Convert a file:// URI to a filesystem path.
 */
function uriToFsPath(uri) {
  try {
    const url = new URL(uri);
    let p = decodeURIComponent(url.pathname);
    // Windows: /D:/folder → D:/folder
    if (_isWindows && p.length >= 3 && p[0] === '/' && p[2] === ':') {
      p = p.slice(1);
    }
    return p;
  } catch {
    return uri; // Already a plain path
  }
}

/**
 * Get the thumbnail root directory for the current workspace.
 * Adapted from stash: pkg/models/paths/paths.go — Paths.Generated
 * Uses the first workspace folder. Caches on first call.
 */
function getThumbDir(api) {
  if (_thumbDir) return _thumbDir;
  const folders = api.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const wsPath = uriToFsPath(folders[0].uri);
  const sep = _isWindows ? '\\' : '/';
  _thumbDir = wsPath + sep + THUMB_SUBFOLDER.replace(/\//g, sep);
  return _thumbDir;
}

/**
 * Compute intra-directory sharding path from checksum.
 * Adapted from stash: pkg/fsutil/dir.go — GetIntraDir
 * e.g. checksum "ab12cde..." with depth=2, length=2 → "ab/12"
 */
function getIntraDir(checksum) {
  if (!checksum || checksum.length < THUMB_DIR_DEPTH * THUMB_DIR_LENGTH) return '';
  const sep = _isWindows ? '\\' : '/';
  const parts = [];
  for (let i = 0; i < THUMB_DIR_DEPTH; i++) {
    parts.push(checksum.slice(THUMB_DIR_LENGTH * i, THUMB_DIR_LENGTH * (i + 1)));
  }
  return parts.join(sep);
}

/**
 * Construct full thumbnail path for a given checksum and width.
 * Adapted from stash: pkg/models/paths/paths_generated.go — GetThumbnailPath
 * Result: <thumbDir>/<intra>/<checksum>_<width>.jpg
 */
function getThumbnailPath(thumbDir, checksum, width) {
  const sep = _isWindows ? '\\' : '/';
  const intra = getIntraDir(checksum);
  const fname = `${checksum}_${width}.${THUMB_FORMAT}`;
  return thumbDir + sep + intra + sep + fname;
}

/**
 * Construct full cover frame path for a given video checksum.
 * Adapted from stash: pkg/models/paths/paths_scenes.go — GetLegacyScreenshotPath
 * Uses "_cover" suffix to distinguish from image thumbnails ("_<width>").
 * Result: <thumbDir>/<intra>/<checksum>_cover.jpg
 */
function getCoverFramePath(thumbDir, checksum) {
  const sep = _isWindows ? '\\' : '/';
  const intra = getIntraDir(checksum);
  const fname = `${checksum}_cover.${THUMB_FORMAT}`;
  return thumbDir + sep + intra + sep + fname;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19: THUMBNAIL SERVICE
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/image/thumbnail.go — ThumbnailEncoder
// Adapted from stash: internal/manager/task_generate_image_thumbnail.go

/**
 * Check whether a file is an animated GIF — Stash treats ALL GIFs as animated.
 * Adapted from stash: pkg/image/thumbnail.go — `animated := imageFile.Format == formatGif`
 */
function isAnimatedGif(filePath) {
  return /\.gif$/i.test(filePath);
}

/**
 * Check whether a WebP file is animated by reading the RIFF header.
 * Adapted from stash: pkg/image/webp.go — isWebPAnimated()
 * Reads the first 48 bytes: checks "WEBP" ident, animation bit at byte 20, "ANIM" chunk.
 */
async function isWebPAnimated(filePath) {
  if (!/\.webp$/i.test(filePath)) return false;
  try {
    // Read file — main process returns base64 for binary files
    const readResult = await window.parallxElectron.fs.readFile(filePath);
    if (readResult.error) return false;

    // Decode enough bytes for the header check
    let bytes;
    if (readResult.encoding === 'base64') {
      const raw = atob(readResult.content.slice(0, 68)); // 48 bytes → ~64 base64 chars + padding
      bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    } else {
      return false; // text mode — shouldn't happen for WebP
    }

    // Check "WEBP" at bytes 8-11
    if (bytes.length < 21) return false;
    const webpIdent = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (webpIdent !== 'WEBP') return false;

    // Check animation bit (bit 1) at byte 20
    const animBit = 1 << 1;
    if ((bytes[20] & animBit) !== animBit) return false;

    // Check for "ANIM" chunk signature after byte 20
    if (bytes.length < 25) return false;
    const tail = String.fromCharCode(...bytes.slice(21, Math.min(bytes.length, 48)));
    return tail.includes('ANIM');
  } catch { return false; }
}

/**
 * Check whether a thumbnail is needed for the given dimensions.
 * Adapted from stash: task_generate_image_thumbnail.go — required()
 * Skip if both dimensions are ≤ THUMB_MAX_SIZE.
 */
function isThumbnailRequired(width, height) {
  if (!width || !height) return true; // Unknown dimensions → generate to be safe
  return width > THUMB_MAX_SIZE || height > THUMB_MAX_SIZE;
}

/**
 * Generate image thumbnail using vips (preferred).
 * Adapted from stash: pkg/image/vips.go — ImageThumbnailPath
 * vips outputs directly to file — avoids binary-through-terminal issues.
 */
async function generateThumbVips(inputPath, outputPath, maxSize) {
  if (!_toolPaths.vips) return false;
  try {
    const outArg = outputPath + '[Q=' + THUMB_QUALITY_VIPS + ',strip]';
    const cmd = [
      shellQuote(_toolPaths.vips), 'thumbnail',
      shellQuote(inputPath), shellQuote(outArg),
      String(maxSize), '--size', 'down',
    ].join(' ');
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: 30000 });
    if (result.exitCode !== 0) {
      // Adapted from stash: task_generate_image_thumbnail.go — logStderr()
      if (result.stderr) console.debug('[MediaOrganizer] vips stderr:', result.stderr);
      return false;
    }
    // Validate output file exists and is non-empty
    // Guards against partial writes from killed processes
    const valid = await validateThumbnailFile(outputPath);
    return valid;
  } catch { return false; }
}

/**
 * Generate image thumbnail using ffmpeg (fallback).
 * Adapted from stash: pkg/ffmpeg/transcoder/image.go — ImageThumbnail
 * ffmpeg outputs directly to file — avoids binary-through-terminal issues.
 */
async function generateThumbFfmpeg(inputPath, outputPath, maxSize) {
  if (!_toolPaths.ffmpeg) return false;
  try {
    const vf = `scale='min(${maxSize},iw)':'min(${maxSize},ih)':force_original_aspect_ratio=decrease`;
    const cmd = [
      shellQuote(_toolPaths.ffmpeg),
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', shellQuote(inputPath),
      '-vf', shellQuote(vf),
      '-frames:v', '1',
      '-q:v', String(THUMB_QUALITY_FFMPEG),
      shellQuote(outputPath),
    ].join(' ');
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: 30000 });
    if (result.exitCode !== 0) {
      // Adapted from stash: task_generate_image_thumbnail.go — logStderr()
      if (result.stderr) console.debug('[MediaOrganizer] ffmpeg stderr:', result.stderr);
      return false;
    }
    // Validate output file exists and is non-empty
    const valid = await validateThumbnailFile(outputPath);
    return valid;
  } catch { return false; }
}

/**
 * Generate image thumbnail using Canvas API (last-resort browser-native fallback).
 * No upstream analog — Stash always requires ffmpeg. This extension uses Canvas
 * when no external tools are available.
 * Supports: JPEG, PNG, WebP, GIF (first frame), BMP, SVG.
 * Does NOT support: RAW, HEIC, AVIF, TIFF (Chromium lacks decoders).
 * NOTE: Canvas does NOT auto-rotate based on EXIF orientation. Thumbnails from
 * rotated photos may appear sideways. vips and ffmpeg handle this automatically.
 */
async function generateThumbCanvas(inputPath, outputPath, maxSize) {
  try {
    // Read image file — main process returns base64 for binary files
    const readResult = await window.parallxElectron.fs.readFile(inputPath);
    if (readResult.error) return false;

    // Determine MIME type from extension
    const ext = inputPath.slice(inputPath.lastIndexOf('.')).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
      '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    };
    const mime = mimeMap[ext];
    if (!mime) return false; // Unsupported format for Canvas

    // Build data URL from base64 content
    const dataUrl = readResult.encoding === 'base64'
      ? `data:${mime};base64,${readResult.content}`
      : `data:${mime};base64,${btoa(readResult.content)}`;

    // Load into Image element
    const img = new Image();
    const loaded = new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
    });
    img.src = dataUrl;
    await loaded;

    // Calculate thumbnail dimensions (fit within maxSize, maintain aspect ratio)
    const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);

    // Render to OffscreenCanvas and export as JPEG blob
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);

    // Convert to base64 for writeFile
    let binary = '';
    for (let i = 0; i < uint8.length; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    const base64 = btoa(binary);

    // Write file (parent dir auto-created by main process)
    const writeResult = await window.parallxElectron.fs.writeFile(outputPath, base64, 'base64');
    return !writeResult.error;
  } catch (err) {
    console.warn('[MediaOrganizer] Canvas thumbnail failed:', err);
    return false;
  }
}

/**
 * Validate a thumbnail file after write — must exist and be non-empty.
 * Adapted from stash: pkg/scene/generate/generator.go — stat check after generateFile
 * Guards against partial writes from killed subprocesses.
 */
async function validateThumbnailFile(thumbPath) {
  try {
    const stat = await window.parallxElectron.fs.stat(thumbPath);
    if (stat.error || stat.size === 0) {
      // Remove corrupt/empty file
      await window.parallxElectron.fs.delete(thumbPath);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a cover frame (thumbnail) for a video file using ffmpeg.
 * Adapted from stash: internal/manager/task_generate_screenshot.go — GenerateCoverTask
 * Adapted from stash: pkg/scene/generate/screenshot.go — Screenshot()
 * Adapted from stash: pkg/ffmpeg/transcoder/screenshot.go — ScreenshotTime()
 *
 * Extracts a single JPEG frame at 20% of video duration (configurable).
 * Scales to THUMB_MAX_SIZE for grid view consistency.
 * Requires ffmpeg — no canvas fallback for video frame extraction.
 * Uses temp file + atomic rename to prevent partial writes.
 * Adapted from stash: pkg/scene/generate/generator.go — generateFile() temp pattern
 *
 * @param {string} checksum  - File's MD5 checksum (used for sharded path)
 * @param {string} filePath  - Full path to the source video
 * @param {number} duration  - Video duration in seconds
 * @param {object} api       - Parallx extension API
 * @param {boolean} overwrite - Generate even if cover exists
 * @param {number|null} timestampOverride - Explicit seek timestamp in seconds (null = auto 20%)
 * @param {number} videoWidth  - Video width (0 = unknown)
 * @param {number} videoHeight - Video height (0 = unknown)
 * @returns {{ generated: boolean, path: string|null, encoder: string|null }}
 */
async function generateVideoCoverFrame(checksum, filePath, duration, api, overwrite = false, timestampOverride = null, videoWidth = 0, videoHeight = 0) {
  const thumbDir = getThumbDir(api);
  if (!thumbDir) return { generated: false, path: null, encoder: null };
  if (!checksum) return { generated: false, path: null, encoder: null };
  if (!_toolPaths.ffmpeg) return { generated: false, path: null, encoder: 'skip_no_ffmpeg' };

  // Skip audio-only files (no video stream detected by ffprobe)
  // Adapted from stash: internal/manager/task_generate_screenshot.go — videoFile == nil guard
  if (videoWidth === 0 && videoHeight === 0) {
    return { generated: false, path: null, encoder: 'skip_no_video_stream' };
  }

  const coverPath = getCoverFramePath(thumbDir, checksum);

  // Check if already exists (unless overwrite)
  // Adapted from stash: task_generate_screenshot.go — required()
  if (!overwrite) {
    const exists = await window.parallxElectron.fs.exists(coverPath);
    if (exists) return { generated: false, path: coverPath, encoder: 'cached' };
  }

  // Ensure parent directory exists
  const sep = _isWindows ? '\\' : '/';
  const parentDir = coverPath.slice(0, coverPath.lastIndexOf(sep));
  await window.parallxElectron.fs.mkdir(parentDir);

  // Compute seek timestamp
  // Adapted from stash: pkg/scene/generate/screenshot.go — screenshotDurationProportion = 0.2
  // Adapted from stash: internal/manager/task_generate_screenshot.go — ScreenshotAt override
  let seekSec;
  if (timestampOverride !== null && timestampOverride >= 0) {
    seekSec = timestampOverride;
  } else if (duration && duration > 0) {
    seekSec = duration * COVER_TIMESTAMP_PERCENT;
  } else {
    // Unknown duration — extract first frame (matches Stash: 0.2 * 0 = 0)
    seekSec = 0;
  }

  // Build ffmpeg command: -ss before -i for fast seek (Stash pattern)
  // Adapted from stash: pkg/ffmpeg/transcoder/screenshot.go — ScreenshotTime()
  const tempPath = coverPath + '.tmp';
  const vf = `scale='min(${THUMB_MAX_SIZE},iw)':'min(${THUMB_MAX_SIZE},ih)':force_original_aspect_ratio=decrease`;
  const cmd = [
    shellQuote(_toolPaths.ffmpeg),
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(seekSec),
    '-i', shellQuote(filePath),
    '-frames:v', '1',
    '-q:v', String(COVER_QUALITY_FFMPEG),
    '-vf', shellQuote(vf),
    '-f', 'image2',
    shellQuote(tempPath),
  ].join(' ');

  try {
    // NOTE: 30s timeout should be generous for single-frame extraction. If timeout fires,
    // terminal.exec rejects but the ffmpeg child process may not be killed — this is a
    // known limitation of the terminal API. Single-frame extraction rarely takes >5s.
    // Adapted from stash: exec.CommandContext auto-kills on cancel (Go-specific, no analog here).
    const result = await window.parallxElectron.terminal.exec(cmd, { timeout: 30000 });
    if (result.exitCode !== 0) {
      if (result.stderr) console.debug('[MediaOrganizer] ffmpeg cover stderr:', result.stderr);
      // Clean up temp file on failure
      await window.parallxElectron.fs.delete(tempPath).catch(() => {});
      return { generated: false, path: null, encoder: null };
    }
    // Validate temp file — guards against partial writes
    // Adapted from stash: pkg/scene/generate/generator.go — stat.Size() == 0 check
    const valid = await validateThumbnailFile(tempPath);
    if (!valid) return { generated: false, path: null, encoder: null };

    // Atomic rename: temp → final path
    // Adapted from stash: pkg/fsutil/file.go — SafeMove()
    // Read temp file, write to final path, delete temp
    const readResult = await window.parallxElectron.fs.readFile(tempPath);
    if (readResult.error) {
      await window.parallxElectron.fs.delete(tempPath).catch(() => {});
      return { generated: false, path: null, encoder: null };
    }
    const writeResult = await window.parallxElectron.fs.writeFile(
      coverPath, readResult.content, readResult.encoding || 'base64'
    );
    await window.parallxElectron.fs.delete(tempPath).catch(() => {});
    if (writeResult.error) {
      // Clean up potentially corrupt coverPath
      await window.parallxElectron.fs.delete(coverPath).catch(() => {});
      return { generated: false, path: null, encoder: null };
    }

    return { generated: true, path: coverPath, encoder: 'ffmpeg' };
  } catch (err) {
    console.warn('[MediaOrganizer] Video cover generation failed:', err);
    // Clean up temp file in catch path
    await window.parallxElectron.fs.delete(tempPath).catch(() => {});
    return { generated: false, path: null, encoder: null };
  }
}

/**
 * Generate a thumbnail for a photo, routing to the best available encoder.
 * Adapted from stash: pkg/image/thumbnail.go — GetThumbnail decision tree
 * Priority: vips → ffmpeg → canvas
 *
 * @param {string} checksum  - File's MD5 checksum (used for sharded path)
 * @param {string} filePath  - Full path to the source image
 * @param {number} width     - Image width in pixels
 * @param {number} height    - Image height in pixels
 * @param {object} api       - Parallx extension API
 * @param {boolean} overwrite - Generate even if thumbnail exists
 * @returns {{ generated: boolean, path: string|null, encoder: string|null }}
 */
async function generateImageThumbnail(checksum, filePath, width, height, api, overwrite = false) {
  const thumbDir = getThumbDir(api);
  if (!thumbDir) return { generated: false, path: null, encoder: null };
  if (!checksum) return { generated: false, path: null, encoder: null };

  // Adapted from stash: pkg/image/thumbnail.go — animated image exclusion
  // Stash treats all GIFs as animated and checks WebP header for animation bit.
  if (isAnimatedGif(filePath)) {
    return { generated: false, path: null, encoder: 'skip_animated' };
  }
  if (await isWebPAnimated(filePath)) {
    return { generated: false, path: null, encoder: 'skip_animated' };
  }

  // Adapted from stash: task_generate_image_thumbnail.go — required()
  if (!isThumbnailRequired(width, height)) {
    return { generated: false, path: null, encoder: 'skip_small' };
  }

  const thumbPath = getThumbnailPath(thumbDir, checksum, THUMB_MAX_SIZE);

  // Check if already exists (unless overwrite)
  if (!overwrite) {
    const exists = await window.parallxElectron.fs.exists(thumbPath);
    if (exists) return { generated: false, path: thumbPath, encoder: 'cached' };
  }

  // Ensure parent directory exists
  const sep = _isWindows ? '\\' : '/';
  const parentDir = thumbPath.slice(0, thumbPath.lastIndexOf(sep));
  await window.parallxElectron.fs.mkdir(parentDir);

  // Adapted from stash: pkg/image/thumbnail.go — GetThumbnail encoder priority
  if (_toolPaths.vips) {
    const ok = await generateThumbVips(filePath, thumbPath, THUMB_MAX_SIZE);
    if (ok) return { generated: true, path: thumbPath, encoder: 'vips' };
    console.warn(`[MediaOrganizer] vips thumbnail failed for ${filePath}, trying ffmpeg`);
  }

  if (_toolPaths.ffmpeg) {
    const ok = await generateThumbFfmpeg(filePath, thumbPath, THUMB_MAX_SIZE);
    if (ok) return { generated: true, path: thumbPath, encoder: 'ffmpeg' };
    console.warn(`[MediaOrganizer] ffmpeg thumbnail failed for ${filePath}, trying canvas`);
  }

  // Canvas fallback — no external tools needed
  const ok = await generateThumbCanvas(filePath, thumbPath, THUMB_MAX_SIZE);
  if (ok) return { generated: true, path: thumbPath, encoder: 'canvas' };

  console.warn(`[MediaOrganizer] All thumbnail encoders failed for ${filePath}`);
  return { generated: false, path: null, encoder: null };
}

/**
 * Batch-generate thumbnails for all photos missing them.
 * Adapted from stash: internal/manager/task_generate.go — queueImagesTasks
 *
 * @param {object} api       - Parallx extension API
 * @param {boolean} overwrite - Regenerate existing thumbnails
 */
async function generateAllThumbnails(api, overwrite = false) {
  const thumbDir = getThumbDir(api);
  if (!thumbDir) {
    api.window.showWarningMessage('No workspace folder found — cannot generate thumbnails.');
    return;
  }

  await detectAllTools();

  // Query all photos with their primary file's checksum and dimensions
  const photos = await db.all(`
    SELECT p.id, p.title,
           f.id AS file_id, f.basename,
           fp.value AS checksum,
           imf.width, imf.height,
           fo.path AS folder_path
    FROM mo_photos p
    JOIN mo_photos_files pf ON pf.photo_id = p.id AND pf.is_primary = 1
    JOIN mo_files f ON f.id = pf.file_id
    JOIN mo_folders fo ON fo.id = f.folder_id
    LEFT JOIN mo_fingerprints fp ON fp.file_id = f.id AND fp.type = 'md5'
    LEFT JOIN mo_image_files imf ON imf.file_id = f.id
  `);

  // Also query all videos for cover frame generation
  // Adapted from stash: internal/manager/task_generate.go — queueSceneJobs
  const videos = await db.all(`
    SELECT v.id, v.title, v.duration,
           f.id AS file_id, f.basename,
           fp.value AS checksum,
           fo.path AS folder_path,
           vf2.width AS video_width, vf2.height AS video_height
    FROM mo_videos v
    JOIN mo_videos_files vf ON vf.video_id = v.id AND vf.is_primary = 1
    JOIN mo_files f ON f.id = vf.file_id
    JOIN mo_folders fo ON fo.id = f.folder_id
    LEFT JOIN mo_fingerprints fp ON fp.file_id = f.id AND fp.type = 'md5'
    LEFT JOIN mo_video_files vf2 ON vf2.file_id = f.id
  `);

  const total = photos.length + videos.length;
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  let processed = 0;

  if (_statusBarItem) {
    _statusBarItem.text = `$(sync~spin) Generating thumbnails: 0/${total}`;
    _statusBarItem.show();
  }

  // Process in batches with bounded concurrency.
  // Adapted from stash: task_generate.go — SizedWaitGroup(parallelTasks)
  // Default concurrency: (cpu count / 4) + 1, minimum 2.
  const concurrency = Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 4) + 1);

  for (let i = 0; i < photos.length; i += concurrency) {
    const batch = photos.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(async (row) => {
      if (!row.checksum) return { encoder: 'skip_no_checksum' };

      const sep = _isWindows ? '\\' : '/';
      const filePath = row.folder_path + sep + row.basename;

      return generateImageThumbnail(
        row.checksum, filePath, row.width || 0, row.height || 0, api, overwrite
      );
    }));

    for (const r of results) {
      processed++;
      const result = r.status === 'fulfilled' ? r.value : null;
      if (!result) { failed++; continue; }
      if (result.generated) generated++;
      else if (result.encoder === 'cached' || result.encoder === 'skip_small'
            || result.encoder === 'skip_animated' || result.encoder === 'skip_no_checksum') skipped++;
      else failed++;
    }

    if (_statusBarItem) {
      _statusBarItem.text = `$(sync~spin) Thumbnails: ${processed}/${total}`;
    }
  }

  // Phase 2: Video cover frames
  // Adapted from stash: internal/manager/task_generate.go — queueSceneJobs
  for (let i = 0; i < videos.length; i += concurrency) {
    const batch = videos.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(async (row) => {
      if (!row.checksum) return { encoder: 'skip_no_checksum' };

      const sep = _isWindows ? '\\' : '/';
      const filePath = row.folder_path + sep + row.basename;

      return generateVideoCoverFrame(
        row.checksum, filePath, row.duration || 0, api, overwrite,
        null, row.video_width || 0, row.video_height || 0
      );
    }));

    for (const r of results) {
      processed++;
      const result = r.status === 'fulfilled' ? r.value : null;
      if (!result) { failed++; continue; }
      if (result.generated) generated++;
      else if (result.encoder === 'cached' || result.encoder === 'skip_no_ffmpeg'
            || result.encoder === 'skip_no_checksum'
            || result.encoder === 'skip_no_video_stream') skipped++;
      else failed++;
    }

    if (_statusBarItem) {
      _statusBarItem.text = `$(sync~spin) Thumbnails: ${processed}/${total}`;
    }
  }

  if (_statusBarItem) {
    _statusBarItem.text = `$(check) Thumbnails done — ${generated} new, ${skipped} skipped, ${failed} failed`;
    setTimeout(() => { if (_statusBarItem) _statusBarItem.hide(); }, 5000);
  }

  api.window.showInformationMessage(
    `Thumbnail generation complete: ${generated} generated, ${skipped} skipped, ${failed} failed (${total} total).`
  );
}

/**
 * Clean orphaned thumbnail files whose source photos or videos no longer exist in the DB.
 * Adapted from stash: internal/manager/task/clean_generated.go — cleanThumbnailFiles()
 * Walks the thumbnail directory tree, parses {checksum}_{width}.jpg filenames,
 * queries DB for matching fingerprints, deletes orphans.
 */
async function cleanOrphanThumbnails(api, options = {}) {
  const { photoThumbnails = true, videoCoverFrames = true, dryRun = false } = options;
  const thumbDir = getThumbDir(api);
  if (!thumbDir) {
    api.window.showWarningMessage('No workspace folder found — cannot clean thumbnails.');
    return;
  }

  const dirExists = await window.parallxElectron.fs.exists(thumbDir);
  if (!dirExists) {
    api.window.showInformationMessage('No thumbnail directory found — nothing to clean.');
    return;
  }

  const dryLabel = dryRun ? ' (dry run)' : '';
  if (_statusBarItem) {
    _statusBarItem.text = `$(sync~spin) Cleaning thumbnails${dryLabel}…`;
    _statusBarItem.show();
  }

  let deleted = 0;
  let kept = 0;
  let errors = 0;
  let skippedByFilter = 0;

  // Walk the sharded directory tree: thumbDir/<2char>/<2char>/<checksum>_<width>.jpg
  // Adapted from stash: cleanThumbnailFiles — filepath.Walk + getThumbnailFileHash
  async function walkAndClean(dirPath, isTopLevel) {
    const result = await window.parallxElectron.fs.readdir(dirPath);
    if (result.error) return;

    for (const item of (result.entries || [])) {
      const sep = _isWindows ? '\\' : '/';
      const fullPath = dirPath + sep + item.name;

      if (item.type === 'directory') {
        // Update progress for top-level shard directories (hex-prefixed)
        if (isTopLevel && _statusBarItem && item.name.length >= 1) {
          const pct = Math.round(hexPrefixProgress(item.name[0]) * 100);
          _statusBarItem.text = `$(sync~spin) Cleaning thumbnails${dryLabel}… ${pct}%`;
        }
        await walkAndClean(fullPath, false);
        continue;
      }

      // Parse filename: {checksum}_{width}.{ext}
      // Match both image thumbnails (<hash>_<width>.jpg) and video covers (<hash>_cover.jpg)
      const match = item.name.match(/^([a-f0-9]+)_(?:\d+|cover)\.jpg$/i);
      if (!match) {
        console.warn(`[MediaOrganizer] Ignoring unknown thumbnail file: ${item.name}`);
        continue;
      }

      // Type filtering: skip files that don't match the requested types
      const isCover = item.name.includes('_cover.');
      if (isCover && !videoCoverFrames) { kept++; skippedByFilter++; continue; }
      if (!isCover && !photoThumbnails) { kept++; skippedByFilter++; continue; }

      const checksum = match[1];

      // Check if any file (photo or video) has this checksum as MD5 fingerprint
      const fpRows = await db.all(
        'SELECT file_id FROM mo_fingerprints WHERE type = ? AND value = ? LIMIT 1',
        ['md5', checksum]
      );

      if (fpRows.length === 0) {
        // Orphan — delete (unless dry run)
        if (dryRun) {
          deleted++;
          console.log(`[MediaOrganizer] Dry run — would delete orphan: ${fullPath}`);
        } else {
          try {
            await window.parallxElectron.fs.delete(fullPath);
            deleted++;
          } catch (err) {
            console.warn(`[MediaOrganizer] Failed to delete orphan thumbnail: ${fullPath}`, err);
            errors++;
          }
        }
      } else {
        kept++;
      }
    }
  }

  try {
    await walkAndClean(thumbDir, true);
  } catch (err) {
    console.error('[MediaOrganizer] Error cleaning thumbnails:', err);
  }

  const filterNote = skippedByFilter > 0 ? `, ${skippedByFilter} skipped by filter` : '';
  if (_statusBarItem) {
    _statusBarItem.text = `$(check) Cleanup done${dryLabel} — ${deleted} orphans ${dryRun ? 'found' : 'removed'}, ${kept} kept`;
    setTimeout(() => { if (_statusBarItem) _statusBarItem.hide(); }, 5000);
  }

  api.window.showInformationMessage(
    `Thumbnail cleanup${dryLabel}: ${deleted} orphans ${dryRun ? 'found' : 'removed'}, ${kept} kept, ${errors} errors${filterNote}.`
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20: LAZY / ON-DEMAND THUMBNAIL RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: internal/api/routes_image.go — serveThumbnail()
// Stash generates missing thumbnails synchronously during HTTP request handling,
// then optionally caches to disk. Since Parallx extensions have no HTTP server,
// this section provides a function-call API that the D5 Grid Browser (and any
// other consumer) calls to resolve a thumbnail path — generating lazily if needed.

/**
 * Simple concurrency semaphore for on-demand thumbnail generation.
 * Adapted from stash: internal/manager/manager.go — ImageThumbnailGenerateWaitGroup
 * Prevents thumbnail request storms from spawning unbounded subprocesses when
 * the grid browser loads many items concurrently.
 */
const _thumbSemaphore = {
  _max: Math.max(2, Math.floor((typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 4) / 4) + 1),
  _active: 0,
  _queue: [],
  async acquire() {
    if (this._active < this._max) {
      this._active++;
      return;
    }
    await new Promise(resolve => this._queue.push(resolve));
  },
  release() {
    this._active--;
    if (this._queue.length > 0) {
      this._active++;
      const next = this._queue.shift();
      next();
    }
  },
};

/**
 * In-flight deduplication map — prevents redundant generation when the same
 * entity is requested multiple times before the first request completes.
 * Adapted from stash: pkg/utils/mutex.go — MutexManager pattern (per-key mutual exclusion),
 * applied to thumbnail resolution rather than file locking.
 */
const _thumbInflight = new Map();

/**
 * Resolve a photo's thumbnail — return the path, generating lazily if needed.
 * Adapted from stash: internal/api/routes_image.go — serveThumbnail() fallback chain:
 *   1. Pre-existing file on disk → return path
 *   2. Generate synchronously → persist → return path
 *   3. Generation fails → return null
 *
 * @param {number} photoId - The photo entity ID
 * @param {object} api     - Parallx extension API
 * @returns {Promise<{ path: string|null, status: 'cached'|'generated'|'skip'|'failed' }>}
 */
async function resolvePhotoThumbnail(photoId, api) {
  const thumbDir = getThumbDir(api);
  if (!thumbDir) return { path: null, status: 'failed' };

  // Fetch photo's primary file checksum + image dimensions in one query
  const row = await db.get(`
    SELECT fp.value AS checksum, imf.width, imf.height,
           fo.path AS folder_path, f.basename
    FROM mo_photos p
    JOIN mo_photos_files pf ON pf.photo_id = p.id AND pf.is_primary = 1
    JOIN mo_files f ON f.id = pf.file_id
    JOIN mo_folders fo ON fo.id = f.folder_id
    LEFT JOIN mo_fingerprints fp ON fp.file_id = f.id AND fp.type = 'md5'
    LEFT JOIN mo_image_files imf ON imf.file_id = f.id
    WHERE p.id = ?
  `, [photoId]);

  if (!row || !row.checksum) return { path: null, status: 'failed' };

  // Fast path: check if thumbnail already exists on disk and is valid
  // Adapted from stash: serveThumbnail — exists check before generation
  const thumbPath = getThumbnailPath(thumbDir, row.checksum, THUMB_MAX_SIZE);
  const valid = await validateCachedThumbnail(thumbPath);
  if (valid) return { path: thumbPath, status: 'cached' };

  // Lazy generation: ensure tools are available, then generate under semaphore
  await detectAllTools();
  await _thumbSemaphore.acquire();
  try {
    // Double-check after acquiring semaphore (another call may have generated it)
    const validNow = await validateCachedThumbnail(thumbPath);
    if (validNow) return { path: thumbPath, status: 'cached' };

    const sep = _isWindows ? '\\' : '/';
    const filePath = row.folder_path + sep + row.basename;
    const result = await generateImageThumbnail(
      row.checksum, filePath, row.width || 0, row.height || 0, api
    );

    if (result.generated) return { path: result.path, status: 'generated' };
    if (result.encoder === 'skip_small' || result.encoder === 'skip_animated') {
      return { path: null, status: 'skip' };
    }
    if (result.encoder === 'cached') return { path: result.path, status: 'cached' };
    return { path: null, status: 'failed' };
  } catch (err) {
    console.warn('[MediaOrganizer] resolvePhotoThumbnail failed for photo', photoId, err);
    return { path: null, status: 'failed' };
  } finally {
    _thumbSemaphore.release();
  }
}

/**
 * Resolve a video's cover frame — return the path, generating lazily if needed.
 * Adapted from stash: internal/manager/running_streams.go — ServeScreenshot() fallback:
 *   1. Pre-existing cover file on disk → return path
 *   2. Generate synchronously via ffmpeg → persist → return path
 *   3. No ffmpeg or generation fails → return null
 *
 * @param {number} videoId - The video entity ID
 * @param {object} api     - Parallx extension API
 * @returns {Promise<{ path: string|null, status: 'cached'|'generated'|'skip'|'failed' }>}
 */
async function resolveVideoThumbnail(videoId, api) {
  const thumbDir = getThumbDir(api);
  if (!thumbDir) return { path: null, status: 'failed' };

  // Fetch video's primary file checksum + video dimensions + duration
  const row = await db.get(`
    SELECT fp.value AS checksum, v.duration,
           vf2.width AS video_width, vf2.height AS video_height,
           fo.path AS folder_path, f.basename
    FROM mo_videos v
    JOIN mo_videos_files vf ON vf.video_id = v.id AND vf.is_primary = 1
    JOIN mo_files f ON f.id = vf.file_id
    JOIN mo_folders fo ON fo.id = f.folder_id
    LEFT JOIN mo_fingerprints fp ON fp.file_id = f.id AND fp.type = 'md5'
    LEFT JOIN mo_video_files vf2 ON vf2.file_id = f.id
    WHERE v.id = ?
  `, [videoId]);

  if (!row || !row.checksum) return { path: null, status: 'failed' };

  // Fast path: check if cover already exists and is valid
  const coverPath = getCoverFramePath(thumbDir, row.checksum);
  const valid = await validateCachedThumbnail(coverPath);
  if (valid) return { path: coverPath, status: 'cached' };

  // Lazy generation under semaphore
  await detectAllTools();
  await _thumbSemaphore.acquire();
  try {
    const validNow = await validateCachedThumbnail(coverPath);
    if (validNow) return { path: coverPath, status: 'cached' };

    const sep = _isWindows ? '\\' : '/';
    const filePath = row.folder_path + sep + row.basename;
    const result = await generateVideoCoverFrame(
      row.checksum, filePath, row.duration || 0, api, false, null,
      row.video_width || 0, row.video_height || 0
    );

    if (result.generated) return { path: result.path, status: 'generated' };
    if (result.encoder === 'cached') return { path: result.path, status: 'cached' };
    if (result.encoder === 'skip_no_ffmpeg' || result.encoder === 'skip_no_video_stream') {
      return { path: null, status: 'skip' };
    }
    return { path: null, status: 'failed' };
  } catch (err) {
    console.warn('[MediaOrganizer] resolveVideoThumbnail failed for video', videoId, err);
    return { path: null, status: 'failed' };
  } finally {
    _thumbSemaphore.release();
  }
}

/**
 * Resolve a thumbnail for any entity by type and ID.
 * This is the primary API that the D5 Grid Browser View will call.
 * Adapted from stash: internal/api/routes_image.go — serveThumbnail() + routes_scene.go — ServeScreenshot()
 *
 * @param {'photo'|'video'} entityType - Entity type
 * @param {number} entityId           - Entity ID
 * @param {object} api                - Parallx extension API
 * @returns {Promise<{ path: string|null, status: 'cached'|'generated'|'skip'|'failed' }>}
 */
async function resolveThumbnail(entityType, entityId, api) {
  const key = `${entityType}:${entityId}`;
  if (_thumbInflight.has(key)) return _thumbInflight.get(key);

  let resolver;
  if (entityType === 'photo') resolver = resolvePhotoThumbnail(entityId, api);
  else if (entityType === 'video') resolver = resolveVideoThumbnail(entityId, api);
  else return { path: null, status: 'failed' };

  _thumbInflight.set(key, resolver);
  try {
    return await resolver;
  } finally {
    _thumbInflight.delete(key);
  }
}

/**
 * Batch-resolve thumbnails for multiple entities.
 * Adapted from stash: internal/manager/task_generate.go — sizedwaitgroup worker-pool pattern;
 * N workers each pull the next item as soon as they finish, avoiding fixed-window stalls
 * when many items are already cached (instant resolution) alongside uncached items.
 *
 * @param {{ type: 'photo'|'video', id: number }[]} entities - Entities to resolve
 * @param {object} api - Parallx extension API
 * @returns {Promise<Map<string, { path: string|null, status: string }>>}
 *          Map keyed by "{type}:{id}" (e.g. "photo:42")
 */
async function resolveThumbnailBatch(entities, api) {
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < entities.length) {
      const idx = cursor++;
      const e = entities[idx];
      const key = `${e.type}:${e.id}`;
      try {
        results.set(key, await resolveThumbnail(e.type, e.id, api));
      } catch {
        results.set(key, { path: null, status: 'failed' });
      }
    }
  }

  const poolSize = _thumbSemaphore._max;
  await Promise.all(Array.from({ length: poolSize }, () => worker()));
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 21: THUMBNAIL CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════════
// F14 — cache stats, entity-level deletion, validation, progress helpers.

/**
 * Map a hex character ('0'–'f') to a linear progress value 0.0–1.0.
 * Used to estimate cleanup/walk progress when iterating shard directories
 * whose names are hex prefixes.
 * Adapted from stash: internal/manager/task/clean_generated.go — progress heuristic
 *
 * @param {string} hexChar - Single hex character ('0'–'f')
 * @returns {number} Progress ratio 0.0–1.0
 */
function hexPrefixProgress(hexChar) {
  const val = parseInt(hexChar, 16);
  if (isNaN(val)) return 0;
  return val / 15; // 0x0 → 0.0, 0xf → 1.0
}

/**
 * Validate that a cached thumbnail file exists AND has non-zero size.
 * Zero-byte files are treated as corrupt — deleted and reported as invalid.
 * Adapted from stash: implied validation in serveThumbnail (returns 500 on empty files)
 *
 * @param {string} thumbPath - Absolute path to thumbnail file
 * @returns {Promise<boolean>} true if file exists and is valid, false otherwise
 */
async function validateCachedThumbnail(thumbPath) {
  try {
    const exists = await window.parallxElectron.fs.exists(thumbPath);
    if (!exists) return false;

    const stat = await window.parallxElectron.fs.stat(thumbPath);
    if (stat.error || stat.size === 0) {
      // Corrupt zero-byte file — remove it
      console.warn(`[MediaOrganizer] Removing corrupt zero-byte thumbnail: ${thumbPath}`);
      await window.parallxElectron.fs.delete(thumbPath).catch(() => {});
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[MediaOrganizer] validateCachedThumbnail error for ${thumbPath}:`, err);
    return false;
  }
}

/**
 * Gather cache statistics by walking the entire thumbnail directory.
 * Classifies files as photo thumbnails, video cover frames, or unknown.
 * Adapted from stash: internal/manager/task/clean_generated.go — walkDir stats aggregation
 *
 * @param {object} api - Parallx extension API
 * @returns {Promise<{ totalFiles: number, totalSizeBytes: number, photoThumbnails: number, videoCoverFrames: number, unknownFiles: number }|null>}
 */
async function getCacheStats(api) {
  const thumbDir = getThumbDir(api);
  if (!thumbDir) {
    api.window.showWarningMessage('No workspace folder found — cannot get cache stats.');
    return null;
  }

  const dirExists = await window.parallxElectron.fs.exists(thumbDir);
  if (!dirExists) {
    api.window.showInformationMessage('No thumbnail directory found — cache is empty.');
    return { totalFiles: 0, totalSizeBytes: 0, photoThumbnails: 0, videoCoverFrames: 0, unknownFiles: 0 };
  }

  if (_statusBarItem) {
    _statusBarItem.text = '$(sync~spin) Gathering cache stats…';
    _statusBarItem.show();
  }

  let totalFiles = 0;
  let totalSizeBytes = 0;
  let photoThumbnails = 0;
  let videoCoverFrames = 0;
  let unknownFiles = 0;
  let walkError = false;

  async function walkStats(dirPath) {
    const result = await window.parallxElectron.fs.readdir(dirPath);
    if (result.error) return;

    for (const item of (result.entries || [])) {
      const sep = _isWindows ? '\\' : '/';
      const fullPath = dirPath + sep + item.name;

      if (item.type === 'directory') {
        await walkStats(fullPath);
        continue;
      }

      totalFiles++;
      const stat = await window.parallxElectron.fs.stat(fullPath);
      if (!stat.error) totalSizeBytes += (stat.size || 0);

      if (/_cover\.jpg$/i.test(item.name)) {
        videoCoverFrames++;
      } else if (/_\d+\.jpg$/i.test(item.name)) {
        photoThumbnails++;
      } else {
        unknownFiles++;
      }
    }
  }

  try {
    await walkStats(thumbDir);
  } catch (err) {
    console.error('[MediaOrganizer] Error gathering cache stats:', err);
    walkError = true;
  }

  const sizeMB = (totalSizeBytes / (1024 * 1024)).toFixed(1);
  const partial = walkError ? ' (partial — errors occurred)' : '';
  if (walkError) {
    api.window.showWarningMessage(
      `Thumbnail cache${partial}: ${totalFiles} files (${sizeMB} MB) — ${photoThumbnails} photo, ${videoCoverFrames} video, ${unknownFiles} unknown.`
    );
  } else {
    api.window.showInformationMessage(
      `Thumbnail cache: ${totalFiles} files (${sizeMB} MB) — ${photoThumbnails} photo, ${videoCoverFrames} video, ${unknownFiles} unknown.`
    );
  }

  if (_statusBarItem) {
    _statusBarItem.text = `$(check) Cache: ${totalFiles} files, ${sizeMB} MB`;
    setTimeout(() => { if (_statusBarItem) _statusBarItem.hide(); }, 5000);
  }

  return { totalFiles, totalSizeBytes, photoThumbnails, videoCoverFrames, unknownFiles };
}

/**
 * Delete all cached thumbnails for a specific entity identified by its MD5 checksum.
 * Removes both the photo thumbnail and video cover frame if they exist.
 * Adapted from stash: internal/manager/task/clean_generated.go — per-entity cleanup path
 *
 * @param {object} api      - Parallx extension API
 * @param {string} checksum - MD5 checksum identifying the entity
 * @returns {Promise<{ deleted: number, errors: number }>}
 */
async function deleteEntityThumbnails(api, checksum) {
  const thumbDir = getThumbDir(api);
  if (!thumbDir) return { deleted: 0, errors: 0 };

  let deleted = 0;
  let errors = 0;

  const paths = [
    getThumbnailPath(thumbDir, checksum, THUMB_MAX_SIZE),
    getCoverFramePath(thumbDir, checksum),
  ];

  for (const p of paths) {
    const exists = await window.parallxElectron.fs.exists(p);
    if (!exists) continue;
    try {
      await window.parallxElectron.fs.delete(p);
      deleted++;
      console.log(`[MediaOrganizer] Deleted cached thumbnail: ${p}`);
    } catch (err) {
      console.warn(`[MediaOrganizer] Failed to delete thumbnail: ${p}`, err);
      errors++;
    }
  }

  return { deleted, errors };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: ACTIVATION
// ═══════════════════════════════════════════════════════════════════════════════

let _toolPath = '';
let _activated = false;
let _commandDisposables = [];
let _api = null;

async function ensureDatabase(toolPath) {
  const status = await window.parallxElectron.database.isOpen();
  if (!status.isOpen) {
    console.warn('[MediaOrganizer] Database not open — cannot migrate');
    return false;
  }
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = toolPath + sep + 'db' + sep + 'migrations';
  const res = await window.parallxElectron.database.migrate(migrationsDir);
  if (res.error) {
    console.error('[MediaOrganizer] Migration failed:', res.error.message);
    return false;
  }
  return true;
}

export async function activate(api, context) {
  if (_activated) return;
  _activated = true;
  _api = api;
  _toolPath = api.env.toolPath;
  const ok = await ensureDatabase(_toolPath);
  if (!ok) {
    console.error('[MediaOrganizer] Activation failed — database not ready');
    return;
  }

  // Status bar item for scan progress
  _statusBarItem = api.window.createStatusBarItem(1, 100);

  // Register scan command
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.scan', async () => {
      const result = await window.parallxElectron.dialog.openFolder({
        title: 'Select folder to scan',
      });
      if (!result || result.length === 0) return;
      const folder = result[0];
      await runScan(folder, api);
    })
  );

  // Register cancel command
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.cancelScan', () => cancelScan())
  );

  // Register thumbnail generation command
  // Adapted from stash: internal/manager/task_generate.go — Generate task
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.generateThumbnails', () => generateAllThumbnails(api))
  );

  // Register thumbnail cleanup command
  // Adapted from stash: internal/manager/task/clean_generated.go — CleanGeneratedJob
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.cleanThumbnails', () => cleanOrphanThumbnails(api))
  );

  // Register cache stats command — F14: Thumbnail Cache Management
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.cacheStats', () => getCacheStats(api))
  );

  console.log('[MediaOrganizer] Activated — D1 data layer + D2 scan pipeline + D3 thumbnails ready');
}

export function deactivate() {
  cancelScan();
  for (const d of _commandDisposables) {
    if (d && typeof d.dispose === 'function') d.dispose();
  }
  _commandDisposables = [];
  if (_statusBarItem) _statusBarItem.dispose();
  _statusBarItem = null;
  _toolsDetected = false;
  _toolPaths = { ffprobe: null, exiftool: null, node: null, ffmpeg: null, vips: null };
  _thumbDir = null;
  _thumbInflight.clear();
  _api = null;
  _activated = false;
  console.log('[MediaOrganizer] Deactivated');
}
