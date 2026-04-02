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

let _toolPaths = { ffprobe: null, exiftool: null, node: null };
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
  const [ffprobe, exiftool, node] = await Promise.all([
    detectTool('ffprobe'),
    detectTool('exiftool'),
    detectTool('node'),
  ]);
  _toolPaths = { ffprobe, exiftool, node };
  _toolsDetected = true;
  if (!ffprobe) console.warn('[MediaOrganizer] ffprobe not found — video metadata will be unavailable');
  if (!exiftool) console.warn('[MediaOrganizer] exiftool not found — EXIF data will be unavailable');
  if (!node) console.warn('[MediaOrganizer] node not found — oshash unavailable, using MD5 only');
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
  } else {
    const videoData = { title: entry.name };
    if (meta.typeSpecific) videoData.duration = meta.typeSpecific.duration || 0;
    const video = await VideoQueries.create(videoData);
    await db.run('INSERT INTO mo_videos_files (video_id, file_id, is_primary) VALUES (?, ?, 1)', [video.id, fileId]);
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
// SECTION 11: ACTIVATION
// ═══════════════════════════════════════════════════════════════════════════════

let _toolPath = '';
let _activated = false;
let _commandDisposables = [];

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

  console.log('[MediaOrganizer] Activated — D1 data layer + D2 scan pipeline ready');
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
  _toolPaths = { ffprobe: null, exiftool: null, node: null };
  _activated = false;
  console.log('[MediaOrganizer] Deactivated');
}
