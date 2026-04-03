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

/**
 * Ensure each alias is unique across all tag names and all other tags' aliases.
 * Adapted from stash: pkg/tag/validate.go — EnsureTagNameUnique() + EnsureAliasesUnique()
 *
 * @param {number} tagId     - The tag owning these aliases (excluded from collision check)
 * @param {string[]} aliases - Proposed alias values
 */
async function ensureAliasesUnique(tagId, aliases) {
  for (const alias of aliases) {
    const trimmed = typeof alias === 'string' ? alias.trim() : '';
    if (!trimmed) continue;
    const nameHit = await db.get(
      `SELECT id FROM mo_tags WHERE name = ? AND id != ?`,
      [trimmed, tagId]
    );
    if (nameHit) throw new DuplicateError('mo_tags', 'name', trimmed);
    const aliasHit = await db.get(
      `SELECT tag_id FROM mo_tag_aliases WHERE alias = ? AND tag_id != ?`,
      [trimmed, tagId]
    );
    if (aliasHit) throw new DuplicateError('mo_tag_aliases', 'alias', trimmed);
  }
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
    // Cross-check: name must not collide with existing aliases
    // Adapted from stash: pkg/tag/validate.go — EnsureTagNameUnique
    const aliasConflict = await db.get(
      `SELECT tag_id FROM mo_tag_aliases WHERE alias = ?`, [input.name]
    );
    if (aliasConflict) throw new DuplicateError('mo_tag_aliases', 'alias', input.name);
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

  // Adapted from stash: pkg/sqlite/tag.go — FindByNames()
  async findByNames(names) {
    if (!names || names.length === 0) return [];
    const placeholders = names.map(() => '?').join(', ');
    const rows = await db.all(
      `SELECT * FROM mo_tags WHERE name IN (${placeholders})`, names
    );
    return rows.map((r) => this.fromRow(r));
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
    // Hierarchy filters — adapted from stash: pkg/sqlite/tag_filter.go
    if (filter.parentId !== undefined) {
      where.push(`id IN (SELECT child_id FROM mo_tags_relations WHERE parent_id = ?)`);
      params.push(filter.parentId);
    }
    if (filter.childId !== undefined) {
      where.push(`id IN (SELECT parent_id FROM mo_tags_relations WHERE child_id = ?)`);
      params.push(filter.childId);
    }
    if (filter.hasParents === true) {
      where.push(`id IN (SELECT child_id FROM mo_tags_relations)`);
    } else if (filter.hasParents === false) {
      where.push(`id NOT IN (SELECT child_id FROM mo_tags_relations)`);
    }
    if (filter.hasChildren === true) {
      where.push(`id IN (SELECT parent_id FROM mo_tags_relations)`);
    } else if (filter.hasChildren === false) {
      where.push(`id NOT IN (SELECT parent_id FROM mo_tags_relations)`);
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
      // Cross-check: name must not collide with existing aliases
      const aliasConflict = await db.get(
        `SELECT tag_id FROM mo_tag_aliases WHERE alias = ? AND tag_id != ?`,
        [partial.name, id]
      );
      if (aliasConflict) throw new DuplicateError('mo_tag_aliases', 'alias', partial.name);
    }
    await buildPartialUpdate('mo_tags', id, partial, TAG_COL_MAP);

    // Handle parentIds reassignment with cycle validation
    if (partial.parentIds) {
      const uniqueParentIds = [...new Set(partial.parentIds)];
      for (const pid of uniqueParentIds) {
        await ensureExists('mo_tags', pid);
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

    // Handle childIds reassignment with bidirectional cycle validation
    // Adapted from stash: pkg/sqlite/tag.go — UpdateChildTags()
    if (partial.childIds) {
      const uniqueChildIds = [...new Set(partial.childIds)];
      for (const cid of uniqueChildIds) {
        await ensureExists('mo_tags', cid);
        if (await this.wouldCreateCycle(id, cid)) {
          throw new ValidationError(
            `Setting child ${cid} on tag ${id} would create a cycle`
          );
        }
      }
      const childOps = [
        { type: 'run', sql: `DELETE FROM mo_tags_relations WHERE parent_id = ?`, params: [id] },
      ];
      for (const cid of uniqueChildIds) {
        childOps.push({
          type: 'run',
          sql: `INSERT INTO mo_tags_relations (parent_id, child_id) VALUES (?, ?)`,
          params: [id, cid],
        });
      }
      await db.transaction(childOps);
    }

    return this.findById(id);
  },

  async destroy(id) {
    await ensureExists('mo_tags', id);
    await db.run(`DELETE FROM mo_tags WHERE id = ?`, [id]);
  },

  // Adapted from stash: internal/api/resolver_mutation_tag.go — TagsDestroy
  async destroyMany(ids) {
    if (!ids || ids.length === 0) return;
    const uniqueIds = [...new Set(ids)];
    for (const id of uniqueIds) {
      await ensureExists('mo_tags', id);
    }
    const ops = uniqueIds.map((id) => ({
      type: 'run',
      sql: `DELETE FROM mo_tags WHERE id = ?`,
      params: [id],
    }));
    await db.transaction(ops);
  },

  // Adapted from stash: pkg/sqlite/tag.go — Merge()
  async merge(sourceIds, destinationId) {
    if (!sourceIds || sourceIds.length === 0) return this.findById(destinationId);
    await ensureExists('mo_tags', destinationId);
    const uniqueSources = [...new Set(sourceIds)];
    for (const sid of uniqueSources) {
      if (sid === destinationId) {
        throw new ValidationError('Cannot merge a tag into itself');
      }
      await ensureExists('mo_tags', sid);
    }
    const placeholders = uniqueSources.map(() => '?').join(', ');
    const ops = [];
    // 1. Reassign photo tag associations (skip duplicates)
    ops.push({
      type: 'run',
      sql: `UPDATE OR IGNORE mo_photos_tags SET tag_id = ? WHERE tag_id IN (${placeholders})`,
      params: [destinationId, ...uniqueSources],
    });
    ops.push({
      type: 'run',
      sql: `DELETE FROM mo_photos_tags WHERE tag_id IN (${placeholders})`,
      params: [...uniqueSources],
    });
    // 2. Reassign video tag associations
    ops.push({
      type: 'run',
      sql: `UPDATE OR IGNORE mo_videos_tags SET tag_id = ? WHERE tag_id IN (${placeholders})`,
      params: [destinationId, ...uniqueSources],
    });
    ops.push({
      type: 'run',
      sql: `DELETE FROM mo_videos_tags WHERE tag_id IN (${placeholders})`,
      params: [...uniqueSources],
    });
    // 3. Reassign parent relations (skip self-references + dupes)
    ops.push({
      type: 'run',
      sql: `UPDATE OR IGNORE mo_tags_relations SET parent_id = ? WHERE parent_id IN (${placeholders}) AND child_id != ?`,
      params: [destinationId, ...uniqueSources, destinationId],
    });
    ops.push({
      type: 'run',
      sql: `DELETE FROM mo_tags_relations WHERE parent_id IN (${placeholders})`,
      params: [...uniqueSources],
    });
    // 4. Reassign child relations
    ops.push({
      type: 'run',
      sql: `UPDATE OR IGNORE mo_tags_relations SET child_id = ? WHERE child_id IN (${placeholders}) AND parent_id != ?`,
      params: [destinationId, ...uniqueSources, destinationId],
    });
    ops.push({
      type: 'run',
      sql: `DELETE FROM mo_tags_relations WHERE child_id IN (${placeholders})`,
      params: [...uniqueSources],
    });
    // 5. Add source names as aliases on destination
    ops.push({
      type: 'run',
      sql: `INSERT OR IGNORE INTO mo_tag_aliases (tag_id, alias)
            SELECT ?, name FROM mo_tags WHERE id IN (${placeholders})`,
      params: [destinationId, ...uniqueSources],
    });
    // 6. Move existing aliases to destination
    ops.push({
      type: 'run',
      sql: `UPDATE OR IGNORE mo_tag_aliases SET tag_id = ? WHERE tag_id IN (${placeholders})`,
      params: [destinationId, ...uniqueSources],
    });
    ops.push({
      type: 'run',
      sql: `DELETE FROM mo_tag_aliases WHERE tag_id IN (${placeholders})`,
      params: [...uniqueSources],
    });
    // 7. Delete source tags
    for (const sid of uniqueSources) {
      ops.push({ type: 'run', sql: `DELETE FROM mo_tags WHERE id = ?`, params: [sid] });
    }
    await db.transaction(ops);
    return this.findById(destinationId);
  },

  // Adapted from stash: internal/api/resolver_mutation_tag.go — BulkTagUpdate
  async bulkUpdate(ids, input) {
    if (!ids || ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)];
    for (const id of uniqueIds) {
      await ensureExists('mo_tags', id);
    }
    const ops = [];
    // Scalar fields
    const setClauses = [];
    const setParams = [];
    if (input.description !== undefined) { setClauses.push('description = ?'); setParams.push(input.description); }
    if (input.favorite !== undefined) { setClauses.push('favorite = ?'); setParams.push(input.favorite ? 1 : 0); }
    if (setClauses.length > 0) {
      setClauses.push("updated_at = datetime('now')");
      const placeholders = uniqueIds.map(() => '?').join(', ');
      ops.push({
        type: 'run',
        sql: `UPDATE mo_tags SET ${setClauses.join(', ')} WHERE id IN (${placeholders})`,
        params: [...setParams, ...uniqueIds],
      });
    }
    if (ops.length > 0) await db.transaction(ops);
    // Relation updates per-tag (need individual cycle validation)
    for (const id of uniqueIds) {
      if (input.parentIds) {
        const { mode, values = [] } = input.parentIds;
        if (values.length > 0) {
          if (mode === 'set') {
            await this.update(id, { parentIds: values });
          } else if (mode === 'add') {
            for (const pid of values) await this.addParent(id, pid);
          } else if (mode === 'remove') {
            for (const pid of values) await this.removeParent(id, pid);
          }
        }
      }
      if (input.childIds) {
        const { mode, values = [] } = input.childIds;
        if (values.length > 0) {
          if (mode === 'set') {
            await this.updateChildTags(id, values);
          } else if (mode === 'add') {
            for (const cid of values) await this.addChild(id, cid);
          } else if (mode === 'remove') {
            for (const cid of values) await this.removeChild(id, cid);
          }
        }
      }
    }
    return this.findManyByIds(uniqueIds);
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

  // Adapted from stash: pkg/sqlite/tag.go — CountByParentTagID (counts parents of a tag)
  async countParents(tagId) {
    const row = await db.get(
      `SELECT COUNT(*) as count FROM mo_tags_relations WHERE child_id = ?`, [tagId]
    );
    return row ? row.count : 0;
  },

  // Adapted from stash: pkg/sqlite/tag.go — CountByChildTagID (counts children of a tag)
  async countChildren(tagId) {
    const row = await db.get(
      `SELECT COUNT(*) as count FROM mo_tags_relations WHERE parent_id = ?`, [tagId]
    );
    return row ? row.count : 0;
  },

  // Adapted from stash: pkg/models/tag.go — alias management
  async updateAliases(tagId, aliases) {
    await ensureExists('mo_tags', tagId);
    await ensureAliasesUnique(tagId, aliases);
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

  // Adapted from stash: pkg/sqlite/tag.go — FindBySceneID / FindByImageID
  async findByPhotoId(photoId) {
    const rows = await db.all(
      `SELECT t.* FROM mo_tags t
       INNER JOIN mo_photos_tags pt ON pt.tag_id = t.id
       WHERE pt.photo_id = ?
       ORDER BY t.name COLLATE NOCASE ASC`,
      [photoId]
    );
    return rows.map((r) => this.fromRow(r));
  },

  async findByVideoId(videoId) {
    const rows = await db.all(
      `SELECT t.* FROM mo_tags t
       INNER JOIN mo_videos_tags vt ON vt.tag_id = t.id
       WHERE vt.video_id = ?
       ORDER BY t.name COLLATE NOCASE ASC`,
      [videoId]
    );
    return rows.map((r) => this.fromRow(r));
  },

  // Adapted from stash: pkg/sqlite/tag.go — cycle validation
  // Adapted from stash: pkg/tag/update.go — ValidateHierarchyExisting (bidirectional)
  async wouldCreateCycle(parentId, childId) {
    if (parentId === childId) return true;
    // Upward: is childId an ancestor of parentId?
    const ancestors = await this.getAncestors(parentId);
    if (ancestors.some((a) => a.id === childId)) return true;
    // Belt-and-suspenders: also check that parentId isn't already a descendant of childId.
    // This is logically equivalent to the ancestor check above for acyclic graphs,
    // but catches edge cases in corrupted data where traversal directions may diverge.
    const descendants = await this.getDescendants(childId);
    return descendants.some((d) => d.id === parentId);
  },

  async addParent(tagId, parentId) {
    await ensureExists('mo_tags', tagId);
    await ensureExists('mo_tags', parentId);
    if (await this.wouldCreateCycle(parentId, tagId)) {
      throw new ValidationError(
        `Adding parent ${parentId} to tag ${tagId} would create a cycle`
      );
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

  // Adapted from stash: pkg/sqlite/tag.go — child-side operations (symmetric to addParent)
  async addChild(tagId, childId) {
    await ensureExists('mo_tags', tagId);
    await ensureExists('mo_tags', childId);
    if (await this.wouldCreateCycle(tagId, childId)) {
      throw new ValidationError(
        `Adding child ${childId} to tag ${tagId} would create a cycle`
      );
    }
    await db.run(
      `INSERT OR IGNORE INTO mo_tags_relations (parent_id, child_id) VALUES (?, ?)`,
      [tagId, childId]
    );
  },

  async removeChild(tagId, childId) {
    await db.run(
      `DELETE FROM mo_tags_relations WHERE parent_id = ? AND child_id = ?`,
      [tagId, childId]
    );
  },

  // Adapted from stash: pkg/sqlite/tag.go — UpdateChildTags()
  async updateChildTags(tagId, childIds) {
    await ensureExists('mo_tags', tagId);
    const uniqueChildIds = [...new Set(childIds)];
    for (const cid of uniqueChildIds) {
      await ensureExists('mo_tags', cid);
      if (await this.wouldCreateCycle(tagId, cid)) {
        throw new ValidationError(
          `Setting child ${cid} on tag ${tagId} would create a cycle`
        );
      }
    }
    const ops = [
      { type: 'run', sql: `DELETE FROM mo_tags_relations WHERE parent_id = ?`, params: [tagId] },
    ];
    for (const cid of uniqueChildIds) {
      ops.push({
        type: 'run',
        sql: `INSERT INTO mo_tags_relations (parent_id, child_id) VALUES (?, ?)`,
        params: [tagId, cid],
      });
    }
    await db.transaction(ops);
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

    // 10. Associate with folder-based auto-album (D8/F31)
    await associateWithFolderAlbum(entry.folderId, 'photo', photo.id);
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

    // 10. Associate with folder-based auto-album (D8/F31)
    await associateWithFolderAlbum(entry.folderId, 'video', video.id);
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
    _folderAlbumCache.clear();
    _folderAlbumInflight.clear();
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
// SECTION 22: UI HELPERS & STYLES
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5 — imperative DOM rendering for extension UI

let _moStyleInjected = false;

function moEl(tag, className, attrs) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'textContent') e.textContent = v;
      else if (k === 'innerHTML') e.innerHTML = v;
      else if (k === 'onclick') e.addEventListener('click', v);
      else if (k === 'onchange') e.addEventListener('change', v);
      else if (k === 'oninput') e.addEventListener('input', v);
      else e.setAttribute(k, v);
    }
  }
  return e;
}

function moIcon(name, size) {
  if (_api?.icons) return _api.icons.createIconHtml(name, size || 16);
  return '';
}

const MO_CSS = `
/* ═══ Grid Browser ═══ */
.mo-grid-browser {
  --mo-rating-color: #f5c518;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  font-family: var(--parallx-fontFamily-ui, system-ui, sans-serif);
  font-size: var(--parallx-fontSize-base, 12px);
}
.mo-grid-area {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ═══ Toolbar ═══ */
.mo-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.mo-toolbar-search {
  flex: 1;
  min-width: 120px;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 4px 8px;
  font-size: var(--parallx-fontSize-base, 12px);
  font-family: inherit;
  outline: none;
}
.mo-toolbar-search:focus { border-color: var(--vscode-focusBorder, #007fd4); }
.mo-toolbar-search::placeholder { color: var(--vscode-input-placeholderForeground, #888); }
.mo-toolbar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.mo-toolbar-btn {
  position: relative;
  background: var(--vscode-button-secondaryBackground, #3a3a3a);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: 1px solid var(--vscode-panel-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 3px 8px;
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
.mo-toolbar-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #4a4a4a); }
.mo-toolbar-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
.mo-toolbar-select {
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 3px 6px;
  font-size: var(--parallx-fontSize-sm, 11px);
  font-family: inherit;
  outline: none;
}
.mo-toolbar-label {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground, #888);
  white-space: nowrap;
}
.mo-toolbar-count {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-descriptionForeground, #888);
  white-space: nowrap;
  margin-left: auto;
}
.mo-zoom-slider {
  width: 72px;
  accent-color: var(--vscode-focusBorder, #007fd4);
}

/* ═══ Grid ═══ */
.mo-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
  align-content: flex-start;
}

/* ═══ Card ═══ */
.mo-card {
  border-radius: var(--parallx-radius-md, 6px);
  overflow: hidden;
  cursor: pointer;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border, #333);
  transition: border-color 0.15s;
  flex-shrink: 0;
}
.mo-card:hover { border-color: var(--vscode-focusBorder, #007fd4); }
.mo-card:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
.mo-card.mo-selected { border-color: var(--vscode-focusBorder, #007fd4); box-shadow: 0 0 0 1px var(--vscode-focusBorder, #007fd4); }
.mo-card-thumb {
  position: relative;
  overflow: hidden;
  background: var(--vscode-input-background, #1a1a1a);
}
.mo-card-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.mo-card-badge {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: var(--parallx-fontSize-xs, 10px);
  padding: 1px 5px;
  border-radius: var(--parallx-radius-sm, 3px);
  background: rgba(0,0,0,0.65);
  color: #fff;
  font-weight: 600;
  letter-spacing: 0.3px;
  text-transform: uppercase;
  pointer-events: none;
}
.mo-card-rating {
  position: absolute;
  bottom: 4px;
  right: 4px;
  font-size: var(--parallx-fontSize-xs, 10px);
  color: var(--mo-rating-color, #f5c518);
  pointer-events: none;
}
.mo-card-select {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 2;
  opacity: 0;
  transition: opacity 0.15s;
}
.mo-card:hover .mo-card-select,
.mo-card-select.mo-selecting,
.mo-card.mo-selected .mo-card-select {
  opacity: 1;
}
.mo-card-select input { cursor: pointer; }
.mo-list-select {
  opacity: 0;
  transition: opacity 0.15s;
  cursor: pointer;
}
.mo-list-row:hover .mo-list-select,
.mo-list-select.mo-selecting,
.mo-list-row.mo-selected .mo-list-select {
  opacity: 1;
}
.mo-card-info {
  padding: 5px 8px 6px;
}
.mo-card-title {
  font-size: var(--parallx-fontSize-sm, 11px);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--vscode-editor-foreground);
}
.mo-card-detail {
  font-size: var(--parallx-fontSize-xs, 10px);
  color: var(--vscode-descriptionForeground, #888);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-top: 1px;
}

/* Zoom-dependent thumb heights */
.mo-card.zoom-0 .mo-card-thumb { height: 180px; }
.mo-card.zoom-1 .mo-card-thumb { height: 240px; }
.mo-card.zoom-2 .mo-card-thumb { height: 360px; }
.mo-card.zoom-3 .mo-card-thumb { height: 480px; }

/* ═══ Pagination ═══ */
.mo-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 12px;
  border-top: 1px solid var(--vscode-panel-border, #2a2a2a);
  flex-shrink: 0;
  font-size: var(--parallx-fontSize-sm, 11px);
}
.mo-page-btn {
  background: var(--vscode-button-secondaryBackground, #3a3a3a);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: 1px solid var(--vscode-panel-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 2px 8px;
  font-size: var(--parallx-fontSize-sm, 11px);
  cursor: pointer;
}
.mo-page-btn:hover { background: var(--vscode-button-secondaryHoverBackground, #4a4a4a); }
.mo-page-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
.mo-page-btn:disabled { opacity: 0.4; cursor: default; }
.mo-page-info { color: var(--vscode-descriptionForeground, #888); }

/* ═══ Sidebar ═══ */
.mo-sidebar {
  --mo-rating-color: #f5c518;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--vscode-sideBar-background, var(--vscode-editor-background));
  color: var(--vscode-sideBar-foreground, var(--vscode-editor-foreground));
  font-family: var(--parallx-fontFamily-ui, system-ui, sans-serif);
  font-size: var(--parallx-fontSize-base, 12px);
  overflow: hidden;
}
.mo-sidebar-sections {
  flex: 1;
  overflow-y: auto;
}
.mo-sidebar-section {}
.mo-sidebar-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: var(--parallx-fontSize-sm, 11px);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--vscode-sideBarSectionHeader-foreground, #ccc);
  background: var(--vscode-sideBarSectionHeader-background, transparent);
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
  cursor: pointer;
  user-select: none;
}
.mo-sidebar-section-header .mo-chevron {
  margin-left: auto;
  transition: transform 0.15s;
}
.mo-sidebar-section-header.collapsed .mo-chevron { transform: rotate(-90deg); }
.mo-sidebar-section-body { padding: 2px 0; }
.mo-sidebar-section-body.collapsed { display: none; }
.mo-sidebar-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px 4px 16px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mo-sidebar-item:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
.mo-sidebar-item:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
.mo-sidebar-item-label { flex: 1; overflow: hidden; text-overflow: ellipsis; }
.mo-sidebar-item-count {
  font-size: var(--parallx-fontSize-xs, 10px);
  color: var(--vscode-descriptionForeground, #888);
  flex-shrink: 0;
}
.mo-sidebar-item .mo-icon-wrap { flex-shrink: 0; display: flex; align-items: center; }
.mo-empty {
  text-align: center;
  padding: 24px 16px;
  color: var(--vscode-descriptionForeground, #888);
  font-size: var(--parallx-fontSize-base, 12px);
}
.mo-thumb-placeholder {
  width: 100%;
  height: 100%;
  background: var(--vscode-input-background, #2a2a2a);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--vscode-descriptionForeground, #555);
}

/* ═══ Display Mode Toggle ═══ */
.mo-toolbar-btn.active {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: var(--vscode-button-background, #0e639c);
}

/* ═══ List Mode ═══ */
.mo-grid.mo-list-mode {
  flex-direction: column;
  flex-wrap: nowrap;
  gap: 0;
  padding: 0;
}
.mo-list-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, #2a2a2a);
  cursor: pointer;
  min-height: 40px;
}
.mo-list-row:hover { background: var(--vscode-list-hoverBackground, #2a2d2e); }
.mo-list-row:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: -1px; }
.mo-list-row.mo-selected { background: var(--vscode-list-activeSelectionBackground, #094771); }
.mo-list-thumb {
  width: 40px;
  height: 40px;
  border-radius: var(--parallx-radius-sm, 3px);
  overflow: hidden;
  flex-shrink: 0;
  background: var(--vscode-input-background, #1a1a1a);
}
.mo-list-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.mo-list-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--parallx-fontSize-base, 12px); }
.mo-list-type { font-size: var(--parallx-fontSize-xs, 10px); text-transform: uppercase; color: var(--vscode-descriptionForeground, #888); width: 50px; flex-shrink: 0; }
.mo-list-rating { font-size: var(--parallx-fontSize-sm, 11px); color: var(--mo-rating-color, #f5c518); width: 60px; flex-shrink: 0; }
.mo-list-date { font-size: var(--parallx-fontSize-xs, 10px); color: var(--vscode-descriptionForeground, #888); width: 80px; flex-shrink: 0; text-align: right; }

/* ═══ Filter Panel ═══ */
.mo-filter-panel {
  display: none;
  flex-direction: column;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  background: var(--vscode-sideBar-background, #1e1e1e);
  font-size: var(--parallx-fontSize-sm, 11px);
}
.mo-filter-section { display: flex; flex-direction: column; gap: 4px; }
.mo-filter-section-label {
  font-weight: 600;
  font-size: var(--parallx-fontSize-xs, 10px);
  text-transform: uppercase;
  color: var(--vscode-descriptionForeground, #888);
  letter-spacing: 0.5px;
}
.mo-filter-tag-row { display: flex; align-items: flex-start; gap: 6px; }
.mo-filter-row-label {
  font-size: var(--parallx-fontSize-sm, 11px);
  color: var(--vscode-foreground, #ccc);
  min-width: 48px;
  padding-top: 3px;
  flex-shrink: 0;
}
.mo-filter-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  flex: 1;
  min-height: 24px;
  align-items: center;
}
.mo-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: var(--parallx-radius-sm, 3px);
  background: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
  font-size: var(--parallx-fontSize-xs, 10px);
  white-space: nowrap;
}
.mo-tag-pill.exclude {
  background: var(--vscode-inputValidation-errorBackground, #5a1d1d);
  border: 1px solid var(--vscode-inputValidation-errorBorder, #be1100);
}
.mo-tag-pill-remove {
  cursor: pointer;
  opacity: 0.6;
  font-size: var(--parallx-fontSize-xs, 10px);
  line-height: 1;
}
.mo-tag-pill-remove:hover { opacity: 1; }
.mo-tag-pill-remove:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); border-radius: 2px; }
.mo-filter-tag-select {
  flex: 1;
  max-width: 200px;
  font-size: var(--parallx-fontSize-sm, 11px);
  padding: 2px 4px;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
}
.mo-filter-tag-select:focus-visible, .mo-filter-date:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -1px;
}
.mo-filter-depth-label {
  font-size: var(--parallx-fontSize-xs, 10px);
  color: var(--vscode-descriptionForeground, #888);
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.mo-star-bar {
  display: flex;
  gap: 2px;
  align-items: center;
}
.mo-star {
  cursor: pointer;
  font-size: var(--parallx-fontSize-md, 16px);
  color: var(--vscode-descriptionForeground, #555);
  transition: color 0.1s;
  user-select: none;
}
.mo-star.filled, .mo-star.active { color: var(--mo-rating-color, #f5c518); }
.mo-star:hover { color: var(--mo-rating-color, #f5c518); }
.mo-star:focus-visible { outline: 1px solid var(--vscode-focusBorder, #007fd4); outline-offset: 1px; border-radius: 2px; }
.mo-filter-date-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.mo-filter-date {
  font-size: var(--parallx-fontSize-sm, 11px);
  padding: 2px 4px;
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  width: 130px;
}
.mo-filter-clear {
  align-self: flex-start;
  padding: 3px 8px;
  font-size: var(--parallx-fontSize-xs, 10px);
  background: var(--vscode-button-secondaryBackground, #3a3d41);
  color: var(--vscode-button-secondaryForeground, #ccc);
  border: none;
  border-radius: var(--parallx-radius-sm, 3px);
  cursor: pointer;
}
.mo-filter-clear:hover { background: var(--vscode-button-secondaryHoverBackground, #45494e); }
.mo-filter-empty {
  font-size: var(--parallx-fontSize-xs, 10px);
  color: var(--vscode-descriptionForeground, #666);
  font-style: italic;
}
.mo-filter-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  min-width: 14px;
  height: 14px;
  border-radius: 7px;
  background: var(--vscode-badge-background, #4d4d4d);
  color: var(--vscode-badge-foreground, #fff);
  font-size: var(--parallx-fontSize-xs, 10px);
  line-height: 14px;
  text-align: center;
  padding: 0 3px;
  font-weight: 600;
}

/* ═══ Loading Spinner ═══ */
.mo-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vscode-editor-background);
  opacity: 0;
  animation: mo-fade-in 200ms ease forwards;
  z-index: 10;
  pointer-events: none;
}
@keyframes mo-fade-in { to { opacity: 0.85; } }
.mo-spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--vscode-panel-border, #555);
  border-top-color: var(--vscode-focusBorder, #007fd4);
  border-radius: 50%;
  animation: mo-spin 0.6s linear infinite;
}
@keyframes mo-spin { to { transform: rotate(360deg); } }

/* ── Detail Editor (D7) ── */
.mo-detail-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
}
.mo-detail-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  flex-shrink: 0;
}
.mo-detail-header-icon {
  opacity: 0.7;
  flex-shrink: 0;
}
.mo-detail-header-title {
  flex: 1;
  font-size: var(--parallx-fontSize-base, 13px);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mo-detail-header-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
}
.mo-detail-header-actions button {
  background: none;
  border: 1px solid var(--vscode-button-secondaryBackground, #333);
  color: var(--vscode-button-secondaryForeground, #ccc);
  padding: 3px 8px;
  border-radius: var(--parallx-radius-sm, 3px);
  cursor: pointer;
  font-size: var(--parallx-fontSize-xs, 11px);
}
.mo-detail-header-actions button:hover {
  background: var(--vscode-button-secondaryHoverBackground, #444);
}
.mo-detail-body {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.mo-detail-preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--vscode-sideBar-background, #1e1e1e);
  overflow: hidden;
  min-width: 200px;
}
.mo-detail-preview img,
.mo-detail-preview video {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.mo-detail-panel {
  width: 320px;
  min-width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.mo-detail-tab-bar {
  display: flex;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  flex-shrink: 0;
}
.mo-detail-tab-btn {
  flex: 1;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--vscode-foreground, #ccc);
  padding: 6px 12px;
  cursor: pointer;
  font-size: var(--parallx-fontSize-xs, 11px);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.7;
}
.mo-detail-tab-btn.active {
  border-bottom-color: var(--vscode-focusBorder, #007fd4);
  opacity: 1;
}
.mo-detail-tab-btn:hover {
  opacity: 1;
}
.mo-detail-tab-content {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.mo-detail-section {
  margin-bottom: 16px;
}
.mo-detail-section-label {
  font-size: var(--parallx-fontSize-xs, 11px);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  opacity: 0.6;
  margin-bottom: 6px;
}
.mo-detail-dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: var(--parallx-fontSize-xs, 11px);
}
.mo-detail-dl dt {
  opacity: 0.6;
  white-space: nowrap;
}
.mo-detail-dl dd {
  margin: 0;
  word-break: break-word;
}
.mo-detail-rating {
  display: flex;
  align-items: center;
  gap: 2px;
}
.mo-detail-star {
  cursor: pointer;
  font-size: var(--parallx-fontSize-md, 16px);
  color: var(--vscode-panel-border, #555);
  transition: color 0.1s;
  background: none;
  border: none;
  padding: 0;
  line-height: 1;
}
.mo-detail-star.filled {
  color: var(--mo-rating-color, #f5c518);
}
.mo-detail-star:hover {
  color: var(--mo-rating-color, #f5c518);
}
.mo-detail-field {
  margin-bottom: 8px;
}
.mo-detail-field label {
  display: block;
  font-size: var(--parallx-fontSize-xs, 11px);
  opacity: 0.6;
  margin-bottom: 3px;
}
.mo-detail-field input,
.mo-detail-field textarea {
  width: 100%;
  box-sizing: border-box;
  background: var(--vscode-input-background, #1e1e1e);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #333);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 4px 6px;
  font-size: var(--parallx-fontSize-base, 13px);
  font-family: inherit;
}
.mo-detail-field input:focus,
.mo-detail-field textarea:focus {
  border-color: var(--vscode-focusBorder, #007fd4);
  outline: none;
}
.mo-detail-field textarea {
  resize: vertical;
  min-height: 60px;
}
.mo-detail-field input:read-only,
.mo-detail-field textarea:read-only {
  opacity: 0.7;
  cursor: default;
}
.mo-detail-tag-editor {
  position: relative;
}
.mo-detail-tag-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 6px;
}
.mo-detail-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: var(--vscode-badge-background, #333);
  color: var(--vscode-badge-foreground, #fff);
  padding: 2px 6px;
  border-radius: var(--parallx-radius-sm, 3px);
  font-size: var(--parallx-fontSize-xs, 11px);
}
.mo-detail-tag-pill button {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0 2px;
  opacity: 0.7;
  font-size: var(--parallx-fontSize-xs, 10px);
  line-height: 1;
}
.mo-detail-tag-pill button:hover {
  opacity: 1;
}
.mo-detail-autocomplete {
  position: relative;
}
.mo-detail-autocomplete input {
  width: 100%;
  box-sizing: border-box;
  background: var(--vscode-input-background, #1e1e1e);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #333);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 4px 6px;
  font-size: var(--parallx-fontSize-xs, 11px);
}
.mo-detail-autocomplete input:focus {
  border-color: var(--vscode-focusBorder, #007fd4);
  outline: none;
}
.mo-detail-autocomplete-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--vscode-editorWidget-background, #252526);
  border: 1px solid var(--vscode-editorWidget-border, #454545);
  border-radius: var(--parallx-radius-sm, 3px);
  max-height: 150px;
  overflow-y: auto;
  z-index: 100;
}
.mo-detail-autocomplete-item {
  padding: 4px 8px;
  cursor: pointer;
  font-size: var(--parallx-fontSize-xs, 11px);
}
.mo-detail-autocomplete-item:hover,
.mo-detail-autocomplete-item.selected {
  background: var(--vscode-list-hoverBackground, #2a2d2e);
}
.mo-detail-nav-btn {
  background: none;
  border: none;
  color: var(--vscode-foreground, #ccc);
  cursor: pointer;
  padding: 4px;
  opacity: 0.7;
  border-radius: var(--parallx-radius-sm, 3px);
}
.mo-detail-nav-btn:hover {
  opacity: 1;
  background: var(--vscode-toolbar-hoverBackground, #333);
}
.mo-detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  opacity: 0;
  animation: mo-fade-in 200ms ease 200ms forwards;
}
.mo-detail-loading .mo-spinner {
  width: 20px;
  height: 20px;
}
.mo-detail-loading span {
  margin-left: 8px;
  font-size: var(--parallx-fontSize-xs, 11px);
  opacity: 0.7;
}
.mo-detail-autocomplete-create {
  font-style: italic;
  opacity: 0.8;
}
.mo-detail-empty-state {
  opacity: 0.6;
}
/* Responsive: stack to vertical below 520px editor width */
@container (max-width: 520px) {
  .mo-detail-body { flex-direction: column; }
  .mo-detail-panel { width: 100%; border-left: none; border-top: 1px solid var(--vscode-panel-border, #333); }
  .mo-detail-preview { min-height: 200px; }
}
.mo-detail-star:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: 1px;
  border-radius: 2px;
}
.mo-detail-tab-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -1px;
}
.mo-detail-tag-pill button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  border-radius: 2px;
}
/* D8: Selection Toolbar */
.mo-selection-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  background: var(--vscode-toolbar-activeBackground, rgba(90,93,110,.31));
  border-bottom: 1px solid var(--vscode-panel-border, #333);
  font-size: var(--parallx-fontSize-sm, 12px);
}
.mo-selection-bar .mo-sel-count {
  font-weight: 600;
  white-space: nowrap;
}
.mo-selection-bar button {
  background: none;
  border: 1px solid var(--vscode-button-secondaryBackground, #444);
  color: var(--vscode-button-secondaryForeground, #ccc);
  padding: 2px 8px;
  border-radius: var(--parallx-radius-sm, 3px);
  cursor: pointer;
  font-size: var(--parallx-fontSize-xs, 10px);
}
.mo-selection-bar button:hover {
  background: var(--vscode-button-secondaryHoverBackground, #555);
}
.mo-selection-bar .mo-sel-spacer { flex: 1; }
/* D8: Bulk Dialog */
.mo-bulk-dialog-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}
.mo-bulk-dialog {
  background: var(--vscode-editor-background, #1e1e1e);
  border: 1px solid var(--vscode-panel-border, #333);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 16px;
  min-width: 360px;
  max-width: 500px;
  max-height: 80vh;
  overflow-y: auto;
}
.mo-bulk-dialog h3 {
  margin: 0 0 12px 0;
  font-size: var(--parallx-fontSize-base, 13px);
  font-weight: 600;
}
.mo-bulk-dialog-section {
  margin-bottom: 12px;
}
.mo-bulk-dialog-section label {
  display: block;
  font-size: var(--parallx-fontSize-sm, 12px);
  margin-bottom: 4px;
  color: var(--vscode-descriptionForeground, #999);
}
.mo-bulk-dialog-section select,
.mo-bulk-dialog-section input[type="number"] {
  width: 100%;
  padding: 4px 6px;
  background: var(--vscode-input-background, #333);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  font-size: var(--parallx-fontSize-sm, 12px);
}
.mo-bulk-mode-btns {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}
.mo-bulk-mode-btns button {
  flex: 1;
  padding: 3px 0;
  border: 1px solid var(--vscode-button-secondaryBackground, #444);
  background: none;
  color: var(--vscode-button-secondaryForeground, #ccc);
  cursor: pointer;
  font-size: var(--parallx-fontSize-xs, 10px);
  border-radius: var(--parallx-radius-sm, 3px);
}
.mo-bulk-mode-btns button.active {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: var(--vscode-button-background, #0e639c);
}
.mo-bulk-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
.mo-bulk-dialog-footer button {
  padding: 4px 12px;
  border-radius: var(--parallx-radius-sm, 3px);
  cursor: pointer;
  font-size: var(--parallx-fontSize-sm, 12px);
  border: 1px solid var(--vscode-button-secondaryBackground, #444);
  background: none;
  color: var(--vscode-button-secondaryForeground, #ccc);
}
.mo-bulk-dialog-footer button.primary {
  background: var(--vscode-button-background, #0e639c);
  color: var(--vscode-button-foreground, #fff);
  border-color: var(--vscode-button-background, #0e639c);
}
.mo-bulk-dialog-footer button:hover {
  background: var(--vscode-button-secondaryHoverBackground, #555);
}
.mo-bulk-dialog-footer button.primary:hover {
  background: var(--vscode-button-hoverBackground, #1177bb);
}
.mo-bulk-dialog-footer button:disabled {
  opacity: 0.4;
  cursor: default;
  pointer-events: none;
}
.mo-selection-bar button:focus-visible,
.mo-bulk-dialog-footer button:focus-visible,
.mo-bulk-mode-btns button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #007fd4);
  outline-offset: -1px;
}
/* D8: Album Editor */
.mo-album-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.mo-album-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--vscode-panel-border, #333);
}
.mo-album-header h2 {
  margin: 0;
  font-size: var(--parallx-fontSize-base, 13px);
  flex: 1;
}
.mo-album-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
}
.mo-album-field {
  margin-bottom: 12px;
}
.mo-album-field label {
  display: block;
  font-size: var(--parallx-fontSize-sm, 12px);
  margin-bottom: 4px;
  color: var(--vscode-descriptionForeground, #999);
}
.mo-album-field input,
.mo-album-field textarea {
  width: 100%;
  padding: 4px 6px;
  background: var(--vscode-input-background, #333);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  font-size: var(--parallx-fontSize-sm, 12px);
  box-sizing: border-box;
}
.mo-album-field input:focus,
.mo-album-field textarea:focus {
  outline: none;
  border-color: var(--vscode-focusBorder, #007fd4);
}
.mo-album-field textarea {
  min-height: 60px;
  resize: vertical;
}
.mo-album-contents-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.mo-album-contents-label {
  display: block;
  font-weight: 600;
  margin-bottom: 8px;
}
.mo-album-mini-card {
  width: 120px;
  cursor: pointer;
}
.mo-album-mini-card .mo-card-thumb {
  position: relative;
}
.mo-album-remove-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: var(--parallx-fontSize-base, 14px);
  padding: 0 4px;
  z-index: 1;
}
.mo-album-empty {
  opacity: 0.6;
  padding: 16px 0;
  text-align: center;
}
`;

function moInjectStyles() {
  if (_moStyleInjected) return;
  _moStyleInjected = true;
  const style = document.createElement('style');
  style.id = 'media-organizer-styles';
  style.textContent = MO_CSS;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 23: GRID CARD RENDERING
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/Shared/GridCard/ — calculateCardWidth + card DOM

const MO_ZOOM_WIDTHS  = [280, 340, 480, 640];
const MO_ZOOM_HEIGHTS = [180, 240, 360, 480];
const MO_CARD_GAP = 8;
const MO_DEFAULT_ZOOM = 1;
const MO_DEFAULT_PER_PAGE = 40;

// Adapted from stash: GridCard.tsx — calculateCardWidth()
function calculateCardWidth(containerWidth, preferredWidth) {
  const count = Math.max(1, Math.floor((containerWidth + MO_CARD_GAP) / (preferredWidth + MO_CARD_GAP)));
  return Math.floor((containerWidth - (count - 1) * MO_CARD_GAP) / count);
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatShortDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

function renderMediaCard(item, options) {
  const { cardWidth, zoomIndex, selecting, isSelected, onSelect, onClick } = options;
  const card = moEl('div', `mo-card zoom-${zoomIndex}${isSelected ? ' mo-selected' : ''}`);
  card.style.width = `${cardWidth}px`;

  // Thumbnail section
  const thumb = moEl('div', 'mo-card-thumb');
  const img = moEl('img');
  img.alt = item.title || '';
  img.loading = 'lazy';
  if (item.thumbnailPath) {
    img.src = `file://${item.thumbnailPath.replace(/\\/g, '/')}`;
  } else {
    // Placeholder
    const placeholder = moEl('div', 'mo-thumb-placeholder', { innerHTML: moIcon('image', 32) });
    thumb.appendChild(placeholder);
    img.style.display = 'none';
  }
  img.addEventListener('error', () => { img.style.display = 'none'; });
  thumb.appendChild(img);

  // Badge (type or duration)
  const badgeText = item.type === 'video' && item.duration
    ? formatDuration(item.duration)
    : item.type.toUpperCase();
  thumb.appendChild(moEl('span', 'mo-card-badge', { textContent: badgeText }));

  // Rating
  if (item.rating && item.rating > 0) {
    const stars = '\u2605'.repeat(item.rating);
    thumb.appendChild(moEl('span', 'mo-card-rating', { textContent: stars }));
  }

  // Selection checkbox — always render, show on hover or in selection mode
  const selectWrap = moEl('label', `mo-card-select${selecting ? ' mo-selecting' : ''}`);
  const cb = moEl('input', null, { type: 'checkbox' });
  cb.checked = isSelected;
  cb.addEventListener('change', (e) => {
    e.stopPropagation();
    if (onSelect) onSelect(item, cb.checked, e.shiftKey);
  });
  cb.addEventListener('click', (e) => e.stopPropagation());
  selectWrap.appendChild(cb);
  thumb.appendChild(selectWrap);

  card.appendChild(thumb);

  // Info section
  const info = moEl('div', 'mo-card-info');
  const title = item.title || (item.filePath ? item.filePath.split(/[/\\]/).pop() : `${item.type} #${item.id}`);
  info.appendChild(moEl('div', 'mo-card-title', { textContent: title, title: title }));
  const detail = item.takenAt ? formatShortDate(item.takenAt) : formatShortDate(item.createdAt);
  if (detail) info.appendChild(moEl('div', 'mo-card-detail', { textContent: detail }));
  card.appendChild(info);

  card.addEventListener('click', () => { if (onClick) onClick(item); });

  // Expose img element for async thumbnail loading
  card._imgEl = img;
  card._thumbEl = thumb;

  return card;
}

// Adapted from stash: list display mode — compact row rendering
function renderMediaListRow(item, options) {
  const { selecting, isSelected, onSelect, onClick } = options;
  const row = moEl('div', `mo-list-row${isSelected ? ' mo-selected' : ''}`);

  // Thumb
  const thumb = moEl('div', 'mo-list-thumb');
  const img = moEl('img');
  img.alt = item.title || '';
  img.loading = 'lazy';
  if (item.thumbnailPath) {
    img.src = `file://${item.thumbnailPath.replace(/\\/g, '/')}`;
  } else {
    img.style.display = 'none';
  }
  img.addEventListener('error', () => { img.style.display = 'none'; });
  thumb.appendChild(img);
  row.appendChild(thumb);

  const cb = moEl('input', `mo-list-select${selecting ? ' mo-selecting' : ''}`, { type: 'checkbox' });
  cb.checked = isSelected;
  cb.addEventListener('change', (e) => { e.stopPropagation(); if (onSelect) onSelect(item, cb.checked, e.shiftKey); });
  cb.addEventListener('click', (e) => e.stopPropagation());
  row.appendChild(cb);

  const title = item.title || `${item.type} #${item.id}`;
  row.appendChild(moEl('span', 'mo-list-title', { textContent: title, title: title }));
  row.appendChild(moEl('span', 'mo-list-type', { textContent: item.type }));

  const stars = item.rating > 0 ? '\u2605'.repeat(item.rating) : '';
  row.appendChild(moEl('span', 'mo-list-rating', { textContent: stars }));
  row.appendChild(moEl('span', 'mo-list-date', { textContent: formatShortDate(item.createdAt) }));

  row.addEventListener('click', () => { if (onClick) onClick(item); });
  row._imgEl = img;
  row._thumbEl = thumb;
  return row;
}

function renderCardGrid(container, items, options) {
  const { zoomIndex, selecting, selectedIds, onSelect, onClick } = options;
  const grid = moEl('div', 'mo-grid');
  container.appendChild(grid);

  let currentWidth = 0;
  let resizeTimer = null;

  function getCardWidth() {
    const cw = grid.clientWidth;
    if (cw <= 0) return MO_ZOOM_WIDTHS[zoomIndex];
    return calculateCardWidth(cw, MO_ZOOM_WIDTHS[zoomIndex]);
  }

  function renderAll(itemList, opts) {
    grid.innerHTML = '';
    const listMode = opts.displayMode === 'list';
    grid.classList.toggle('mo-list-mode', listMode);
    if (!itemList || itemList.length === 0) {
      grid.appendChild(moEl('div', 'mo-empty', { textContent: 'No media items found' }));
      return;
    }

    if (listMode) {
      for (const item of itemList) {
        const row = renderMediaListRow(item, {
          selecting: opts.selecting ?? selecting,
          isSelected: opts.selectedIds ? opts.selectedIds.has(`${item.type}:${item.id}`) : false,
          onSelect: opts.onSelect ?? onSelect,
          onClick: opts.onClick ?? onClick,
        });
        grid.appendChild(row);
        if (!item.thumbnailPath && item.type && item.id) {
          resolveThumbnailForCard(row, item);
        }
      }
    } else {
      const cardWidth = getCardWidth();
      const zi = opts.zoomIndex ?? zoomIndex;
      for (const item of itemList) {
        const card = renderMediaCard(item, {
          cardWidth,
          zoomIndex: zi,
          selecting: opts.selecting ?? selecting,
          isSelected: opts.selectedIds ? opts.selectedIds.has(`${item.type}:${item.id}`) : false,
          onSelect: opts.onSelect ?? onSelect,
          onClick: opts.onClick ?? onClick,
        });
        grid.appendChild(card);

        // Async thumbnail resolution
        if (!item.thumbnailPath && item.type && item.id) {
          resolveThumbnailForCard(card, item);
        }
      }
    }
  }

  async function resolveThumbnailForCard(card, item) {
    try {
      const result = await resolveThumbnail(item.type === 'photo' ? 'photo' : 'video', item.id, _api);
      if (result && result.path) {
        item.thumbnailPath = result.path;
        const img = card._imgEl;
        if (img) {
          img.src = `file://${result.path.replace(/\\/g, '/')}`;
          img.style.display = '';
          // Remove placeholder if present
          const ph = card._thumbEl?.querySelector('.mo-thumb-placeholder');
          if (ph) ph.remove();
        }
      }
    } catch { /* thumbnail resolution failure — leave placeholder */ }
  }

  const ro = new ResizeObserver((entries) => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const newWidth = entries[0]?.contentRect?.width ?? 0;
      if (Math.abs(newWidth - currentWidth) > 20) {
        currentWidth = newWidth;
        // Re-apply card widths
        const cardWidth = calculateCardWidth(currentWidth, MO_ZOOM_WIDTHS[options.zoomIndex ?? zoomIndex]);
        for (const card of grid.querySelectorAll('.mo-card')) {
          card.style.width = `${cardWidth}px`;
        }
      }
    }, 50);
  });
  ro.observe(grid);

  renderAll(items, options);

  return {
    refresh(newItems, newOptions) {
      renderAll(newItems, { ...options, ...newOptions });
    },
    dispose() {
      clearTimeout(resizeTimer);
      ro.disconnect();
      grid.innerHTML = '';
      grid.remove();
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 24: SIDEBAR VIEW
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: sidebar navigation pattern

function renderBrowserSidebar(container, api) {
  moInjectStyles();
  const root = moEl('div', 'mo-sidebar');
  container.appendChild(root);

  const sections = moEl('div', 'mo-sidebar-sections');
  root.appendChild(sections);

  function openGrid(filterKey, title, icon) {
    api.editors.openEditor({
      typeId: 'media-organizer-grid',
      title: title || 'Media Library',
      icon: icon || 'image',
      instanceId: `grid:${filterKey}`,
    });
  }

  function sidebarSection(title, iconName, collapsed) {
    const section = moEl('div', 'mo-sidebar-section');
    const header = moEl('div', `mo-sidebar-section-header${collapsed ? ' collapsed' : ''}`);
    header.innerHTML = moIcon(iconName, 12);
    header.appendChild(moEl('span', null, { textContent: title }));
    const chevron = moEl('span', 'mo-chevron', { innerHTML: moIcon('chevron-down', 10) });
    header.appendChild(chevron);
    section.appendChild(header);

    const body = moEl('div', `mo-sidebar-section-body${collapsed ? ' collapsed' : ''}`);
    section.appendChild(body);

    header.addEventListener('click', () => {
      header.classList.toggle('collapsed');
      body.classList.toggle('collapsed');
    });

    return { section, body };
  }

  function sidebarItem(iconName, label, count, onClick) {
    const item = moEl('div', 'mo-sidebar-item');
    const iconWrap = moEl('span', 'mo-icon-wrap', { innerHTML: moIcon(iconName, 14) });
    item.appendChild(iconWrap);
    item.appendChild(moEl('span', 'mo-sidebar-item-label', { textContent: label }));
    if (count !== undefined && count !== null) {
      item.appendChild(moEl('span', 'mo-sidebar-item-count', { textContent: String(count) }));
    }
    item.addEventListener('click', onClick);
    return item;
  }

  // Quick Filters
  const { section: qfSection, body: qfBody } = sidebarSection('Quick Filters', 'filter', false);
  qfBody.appendChild(sidebarItem('grid', 'All Media', null, () => openGrid('all', 'All Media')));
  qfBody.appendChild(sidebarItem('image', 'Photos', null, () => openGrid('photos', 'Photos')));
  qfBody.appendChild(sidebarItem('film', 'Videos', null, () => openGrid('videos', 'Videos')));
  qfBody.appendChild(sidebarItem('star', 'Favorites', null, () => openGrid('favorites', 'Favorites')));
  qfBody.appendChild(sidebarItem('clock', 'Recent', null, () => openGrid('recent', 'Recent')));
  sections.appendChild(qfSection);

  // Folders section
  const { section: folderSection, body: folderBody } = sidebarSection('Folders', 'folder', false);
  sections.appendChild(folderSection);

  // Tags section
  const { section: tagSection, body: tagBody } = sidebarSection('Tags', 'tag', false);
  sections.appendChild(tagSection);

  async function loadFolders() {
    try {
      const result = await FolderQueries.findMany({ parentFolderId: null }, { field: 'path', direction: 'ASC' }, { page: 1, perPage: 200 });
      folderBody.innerHTML = '';
      if (!result.items || result.items.length === 0) {
        folderBody.appendChild(moEl('div', 'mo-empty', { textContent: 'No folders scanned yet' }));
        return;
      }
      for (const folder of result.items) {
        const name = folder.path ? folder.path.split(/[/\\]/).pop() || folder.path : `Folder ${folder.id}`;
        folderBody.appendChild(sidebarItem('folder', name, null, () => openGrid(`folder:${folder.id}`, name, 'folder')));
      }
    } catch {
      folderBody.appendChild(moEl('div', 'mo-empty', { textContent: 'Could not load folders' }));
    }
  }

  async function loadTags() {
    try {
      const result = await TagQueries.findMany({ hasParents: false }, { field: 'name', direction: 'ASC' }, { page: 1, perPage: 200 });
      tagBody.innerHTML = '';
      if (!result.items || result.items.length === 0) {
        tagBody.appendChild(moEl('div', 'mo-empty', { textContent: 'No tags created yet' }));
        return;
      }
      for (const tag of result.items) {
        tagBody.appendChild(sidebarItem('tag', tag.name, null, () => openGrid(`tag:${tag.id}`, tag.name, 'tag')));
      }
    } catch {
      tagBody.appendChild(moEl('div', 'mo-empty', { textContent: 'Could not load tags' }));
    }
  }

  // Albums section (D8)
  const { section: albumSection, body: albumBody } = sidebarSection('Albums', 'folder-library', false);
  sections.appendChild(albumSection);

  async function loadAlbums() {
    try {
      const result = await AlbumQueries.findMany({}, { field: 'title', direction: 'ASC' }, { page: 1, perPage: 200 });
      albumBody.innerHTML = '';
      // "Create Album" action
      albumBody.appendChild(sidebarItem('add', 'Create Album...', null, () => {
        api.editors.openEditor({
          typeId: 'media-organizer-grid',
          title: 'New Album',
          icon: 'folder-library',
          instanceId: 'album:new',
        });
      }));
      if (!result.items || result.items.length === 0) {
        albumBody.appendChild(moEl('div', 'mo-empty', { textContent: 'No albums yet' }));
        return;
      }
      for (const album of result.items) {
        const icon = album.folderId ? 'folder' : 'folder-library';
        // Count items in album via efficient SQL
        const countRow = await db.get(
          `SELECT (SELECT COUNT(*) FROM mo_albums_photos WHERE album_id = ?) + (SELECT COUNT(*) FROM mo_albums_videos WHERE album_id = ?) AS total`,
          [album.id, album.id]
        );
        const itemCount = countRow ? countRow.total : 0;
        const badge = itemCount > 0 ? String(itemCount) : null;
        albumBody.appendChild(sidebarItem(icon, album.title || `Album #${album.id}`, badge, () => {
          api.editors.openEditor({
            typeId: 'media-organizer-grid',
            title: album.title || 'Album',
            icon: 'folder-library',
            instanceId: `album:${album.id}`,
          });
        }));
      }
    } catch {
      albumBody.appendChild(moEl('div', 'mo-empty', { textContent: 'Could not load albums' }));
    }
  }

  loadFolders();
  loadTags();
  loadAlbums();

  return { dispose() { container.innerHTML = ''; } };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 25: GRID BROWSER EDITOR
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/List/ItemList — grid browser with toolbar + pagination

// Allowlist for SQL ORDER BY columns — prevents injection via sort field
const MO_SAFE_SORT_COLUMNS = { created_at: 'created_at', title: 'title', rating: 'rating', taken_at: 'taken_at', file_mod_time: 'file_mod_time' };

function renderGridBrowser(container, api, input) {
  moInjectStyles();
  const root = moEl('div', 'mo-grid-browser');
  container.appendChild(root);

  // Parse filter context from input.id
  const instanceId = (input && input.id) || 'grid:all';
  const parts = instanceId.replace(/^grid:/, '').split(':');
  const filterType = parts[0] || 'all';
  const filterId = parts[1] ? parseInt(parts[1], 10) : null;

  const state = {
    currentPage: 1,
    perPage: MO_DEFAULT_PER_PAGE,
    zoomIndex: MO_DEFAULT_ZOOM,
    sortBy: 'created_at',
    sortDir: 'DESC',
    mediaType: (filterType === 'photos' || filterType === 'videos') ? filterType : 'all',
    displayMode: 'grid',
    totalCount: 0,
    items: [],
    selectedIds: new Set(),
    selecting: false,
    lastClickedKey: null,
    filters: {
      tagIds: [],
      excludeTagIds: [],
      tagDepth: 0,
      ratingMin: null,
      dateFrom: null,
      dateTo: null,
    },
  };

  // If Recent, override sort
  if (filterType === 'recent') {
    state.sortBy = 'created_at';
    state.sortDir = 'DESC';
  }

  // ── Toolbar ──
  const toolbar = moEl('div', 'mo-toolbar');
  root.appendChild(toolbar);

  const searchInput = moEl('input', 'mo-toolbar-search', { type: 'text', placeholder: 'Filter by title...' });
  toolbar.appendChild(searchInput);

  // Sort controls
  const sortGroup = moEl('div', 'mo-toolbar-group');
  const sortSelect = moEl('select', 'mo-toolbar-select');
  for (const [val, label] of [['created_at', 'Date Added'], ['title', 'Title'], ['rating', 'Rating'], ['taken_at', 'Date Taken'], ['file_mod_time', 'File Modified']]) {
    const opt = moEl('option', null, { value: val, textContent: label });
    if (val === state.sortBy) opt.selected = true;
    sortSelect.appendChild(opt);
  }
  sortGroup.appendChild(sortSelect);

  const sortDirBtn = moEl('button', 'mo-toolbar-btn', { innerHTML: moIcon('arrow-down', 12), title: 'Sort direction' });
  sortDirBtn.setAttribute('aria-label', 'Sort direction');
  sortGroup.appendChild(sortDirBtn);
  toolbar.appendChild(sortGroup);

  // Zoom slider
  const zoomGroup = moEl('div', 'mo-toolbar-group');
  zoomGroup.appendChild(moEl('span', 'mo-toolbar-label', { textContent: 'Zoom' }));
  const zoomSlider = moEl('input', 'mo-zoom-slider', { type: 'range', min: '0', max: '3', value: String(state.zoomIndex) });
  zoomGroup.appendChild(zoomSlider);
  toolbar.appendChild(zoomGroup);

  // Display mode toggle (Grid / List)
  const modeGroup = moEl('div', 'mo-toolbar-group');
  const gridModeBtn = moEl('button', 'mo-toolbar-btn active', { title: 'Grid view' });
  gridModeBtn.innerHTML = moIcon('grid', 12);
  gridModeBtn.setAttribute('aria-label', 'Grid view');
  const listModeBtn = moEl('button', 'mo-toolbar-btn', { title: 'List view' });
  listModeBtn.innerHTML = moIcon('list-unordered', 12);
  listModeBtn.setAttribute('aria-label', 'List view');
  modeGroup.append(gridModeBtn, listModeBtn);
  toolbar.appendChild(modeGroup);

  // Filter toggle button + count badge
  const filterToggleBtn = moEl('button', 'mo-toolbar-btn', { title: 'Toggle filters' });
  filterToggleBtn.innerHTML = moIcon('filter', 12);
  filterToggleBtn.setAttribute('aria-label', 'Toggle filters');
  const filterBadge = moEl('span', 'mo-filter-badge');
  filterBadge.style.display = 'none';
  filterToggleBtn.appendChild(filterBadge);
  toolbar.appendChild(filterToggleBtn);

  function updateFilterBadge() {
    let count = 0;
    if (state.filters.tagIds.length > 0) count++;
    if (state.filters.excludeTagIds.length > 0) count++;
    if (state.filters.ratingMin != null) count++;
    if (state.filters.dateFrom) count++;
    if (state.filters.dateTo) count++;
    filterBadge.textContent = count > 0 ? String(count) : '';
    filterBadge.style.display = count > 0 ? '' : 'none';
  }

  // Item count
  const countLabel = moEl('span', 'mo-toolbar-count', { textContent: '' });
  toolbar.appendChild(countLabel);

  // ── Selection Toolbar (D8/F34) ──
  let selectionBar = null;

  function refreshGrid() {
    if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
  }

  selectionBar = buildSelectionToolbar(root, state, api, refreshGrid);

  // ── Filter Panel ──
  const filterPanel = moEl('div', 'mo-filter-panel');
  filterPanel.style.display = 'none';
  root.appendChild(filterPanel);

  // -- Tag filter section --
  const tagSection = moEl('div', 'mo-filter-section');
  tagSection.appendChild(moEl('div', 'mo-filter-section-label', { textContent: 'Tags' }));

  const tagIncludeRow = moEl('div', 'mo-filter-tag-row');
  tagIncludeRow.appendChild(moEl('span', 'mo-filter-row-label', { textContent: 'Include:' }));
  const tagIncludePills = moEl('div', 'mo-filter-pills');
  tagIncludeRow.appendChild(tagIncludePills);
  tagSection.appendChild(tagIncludeRow);

  const tagExcludeRow = moEl('div', 'mo-filter-tag-row');
  tagExcludeRow.appendChild(moEl('span', 'mo-filter-row-label', { textContent: 'Exclude:' }));
  const tagExcludePills = moEl('div', 'mo-filter-pills');
  tagExcludeRow.appendChild(tagExcludePills);
  tagSection.appendChild(tagExcludeRow);

  const tagAddRow = moEl('div', 'mo-filter-tag-row');
  const tagAddSelect = moEl('select', 'mo-toolbar-select', {});
  tagAddSelect.setAttribute('aria-label', 'Add tag filter');
  tagAddSelect.appendChild(moEl('option', null, { value: '', textContent: '+ Add tag...' }));
  tagAddRow.appendChild(tagAddSelect);
  const tagAddExcludeBtn = moEl('button', 'mo-toolbar-btn', { textContent: 'Exclude', title: 'Add as excluded tag' });
  tagAddExcludeBtn.setAttribute('aria-label', 'Exclude selected tag');
  tagAddRow.appendChild(tagAddExcludeBtn);
  const tagDepthCb = moEl('input', null, { type: 'checkbox' });
  tagDepthCb.setAttribute('aria-label', 'Include sub-tags');
  const tagDepthLabel = moEl('label', 'mo-filter-depth-label');
  tagDepthLabel.appendChild(tagDepthCb);
  tagDepthLabel.appendChild(document.createTextNode(' Include sub-tags'));
  tagAddRow.appendChild(tagDepthLabel);
  tagSection.appendChild(tagAddRow);
  filterPanel.appendChild(tagSection);

  // -- Rating filter section --
  const ratingSection = moEl('div', 'mo-filter-section');
  ratingSection.appendChild(moEl('div', 'mo-filter-section-label', { textContent: 'Min Rating' }));
  const starBar = moEl('div', 'mo-star-bar');
  starBar.setAttribute('role', 'radiogroup');
  starBar.setAttribute('aria-label', 'Minimum rating');
  for (let i = 1; i <= 5; i++) {
    const star = moEl('span', 'mo-star', { textContent: '\u2606' });
    star.dataset.value = String(i);
    star.setAttribute('role', 'radio');
    star.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
    star.setAttribute('aria-checked', 'false');
    star.setAttribute('tabindex', '0');
    starBar.appendChild(star);
  }
  ratingSection.appendChild(starBar);
  filterPanel.appendChild(ratingSection);

  // -- Date range section --
  const dateSection = moEl('div', 'mo-filter-section');
  dateSection.appendChild(moEl('div', 'mo-filter-section-label', { textContent: 'Date Range' }));
  const dateRow = moEl('div', 'mo-filter-date-row');
  const dateFrom = moEl('input', 'mo-filter-date', { type: 'date', title: 'From date' });
  dateFrom.setAttribute('aria-label', 'From date');
  const dateTo = moEl('input', 'mo-filter-date', { type: 'date', title: 'To date' });
  dateTo.setAttribute('aria-label', 'To date');
  dateRow.appendChild(moEl('span', 'mo-filter-row-label', { textContent: 'From:' }));
  dateRow.appendChild(dateFrom);
  dateRow.appendChild(moEl('span', 'mo-filter-row-label', { textContent: 'To:' }));
  dateRow.appendChild(dateTo);
  dateSection.appendChild(dateRow);
  filterPanel.appendChild(dateSection);

  // -- Clear all button --
  const clearFiltersBtn = moEl('button', 'mo-toolbar-btn mo-filter-clear', { textContent: 'Clear All Filters' });
  clearFiltersBtn.setAttribute('aria-label', 'Clear all filters');
  filterPanel.appendChild(clearFiltersBtn);

  // ── Filter panel helpers ──
  let _filterTagCache = null;
  async function loadFilterTags() {
    if (_filterTagCache) return _filterTagCache;
    try {
      const result = await TagQueries.findMany({}, { field: 'name', direction: 'ASC' }, { page: 1, perPage: 500 });
      _filterTagCache = result.items || [];
    } catch { _filterTagCache = []; }
    return _filterTagCache;
  }

  function refreshTagDropdown() {
    const usedIds = new Set([...state.filters.tagIds, ...state.filters.excludeTagIds]);
    while (tagAddSelect.options.length > 1) tagAddSelect.remove(1);
    if (_filterTagCache) {
      for (const tag of _filterTagCache) {
        if (!usedIds.has(tag.id)) {
          tagAddSelect.appendChild(moEl('option', null, { value: String(tag.id), textContent: tag.name }));
        }
      }
    }
  }

  function renderTagPills() {
    tagIncludePills.innerHTML = '';
    tagExcludePills.innerHTML = '';
    if (!_filterTagCache) return;
    const tagMap = new Map(_filterTagCache.map((t) => [t.id, t.name]));
    for (const id of state.filters.tagIds) {
      const pill = moEl('span', 'mo-tag-pill');
      const tagName = tagMap.get(id) || `Tag ${id}`;
      pill.textContent = tagName;
      const removeBtn = moEl('span', 'mo-tag-pill-remove', { textContent: '\u00D7' });
      removeBtn.setAttribute('role', 'button');
      removeBtn.setAttribute('tabindex', '0');
      removeBtn.setAttribute('aria-label', `Remove tag ${tagName}`);
      removeBtn.addEventListener('click', () => {
        state.filters.tagIds = state.filters.tagIds.filter((tid) => tid !== id);
        renderTagPills(); refreshTagDropdown();
        state.currentPage = 1; loadPage();
      });
      removeBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeBtn.click(); } });
      pill.appendChild(removeBtn);
      tagIncludePills.appendChild(pill);
    }
    for (const id of state.filters.excludeTagIds) {
      const pill = moEl('span', 'mo-tag-pill exclude');
      const tagName = tagMap.get(id) || `Tag ${id}`;
      pill.textContent = tagName;
      const removeBtn = moEl('span', 'mo-tag-pill-remove', { textContent: '\u00D7' });
      removeBtn.setAttribute('role', 'button');
      removeBtn.setAttribute('tabindex', '0');
      removeBtn.setAttribute('aria-label', `Remove tag ${tagName}`);
      removeBtn.addEventListener('click', () => {
        state.filters.excludeTagIds = state.filters.excludeTagIds.filter((tid) => tid !== id);
        renderTagPills(); refreshTagDropdown();
        state.currentPage = 1; loadPage();
      });
      removeBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); removeBtn.click(); } });
      pill.appendChild(removeBtn);
      tagExcludePills.appendChild(pill);
    }
    if (state.filters.tagIds.length === 0) tagIncludePills.appendChild(moEl('span', 'mo-filter-empty', { textContent: 'none' }));
    if (state.filters.excludeTagIds.length === 0) tagExcludePills.appendChild(moEl('span', 'mo-filter-empty', { textContent: 'none' }));
  }

  function updateStarBar() {
    const stars = starBar.querySelectorAll('.mo-star');
    for (const star of stars) {
      const val = parseInt(star.dataset.value, 10);
      const filled = state.filters.ratingMin !== null && val <= state.filters.ratingMin;
      star.textContent = filled ? '\u2605' : '\u2606';
      star.classList.toggle('filled', filled);
      star.setAttribute('aria-checked', String(state.filters.ratingMin === val));
    }
  }

  // ── Filter panel event handlers ──
  filterToggleBtn.addEventListener('click', () => {
    const visible = filterPanel.style.display === 'flex';
    filterPanel.style.display = visible ? 'none' : 'flex';
    filterToggleBtn.classList.toggle('active', !visible);
    if (!visible) {
      loadFilterTags().then(() => { refreshTagDropdown(); renderTagPills(); });
    }
  });

  tagAddSelect.addEventListener('change', () => {
    const tagId = parseInt(tagAddSelect.value, 10);
    if (!tagId || state.filters.tagIds.includes(tagId)) return;
    state.filters.tagIds.push(tagId);
    tagAddSelect.value = '';
    renderTagPills(); refreshTagDropdown();
    state.currentPage = 1; loadPage();
  });

  tagAddExcludeBtn.addEventListener('click', () => {
    const tagId = parseInt(tagAddSelect.value, 10);
    if (!tagId || state.filters.excludeTagIds.includes(tagId)) return;
    state.filters.excludeTagIds.push(tagId);
    tagAddSelect.value = '';
    renderTagPills(); refreshTagDropdown();
    state.currentPage = 1; loadPage();
  });

  tagDepthCb.addEventListener('change', () => {
    state.filters.tagDepth = tagDepthCb.checked ? -1 : 0;
    state.currentPage = 1; loadPage();
  });

  starBar.addEventListener('click', (e) => {
    const star = e.target.closest('.mo-star');
    if (!star) return;
    const val = parseInt(star.dataset.value, 10);
    state.filters.ratingMin = (state.filters.ratingMin === val) ? null : val;
    updateStarBar();
    state.currentPage = 1; loadPage();
  });

  dateFrom.addEventListener('change', () => {
    state.filters.dateFrom = dateFrom.value || null;
    state.currentPage = 1; loadPage();
  });

  dateTo.addEventListener('change', () => {
    state.filters.dateTo = dateTo.value || null;
    state.currentPage = 1; loadPage();
  });

  clearFiltersBtn.addEventListener('click', () => {
    state.filters = { tagIds: [], excludeTagIds: [], tagDepth: 0, ratingMin: null, dateFrom: null, dateTo: null };
    tagDepthCb.checked = false;
    dateFrom.value = '';
    dateTo.value = '';
    updateStarBar(); renderTagPills(); refreshTagDropdown();
    state.currentPage = 1; loadPage();
  });

  // ── refreshOpts helper ──
  function refreshOpts() {
    return { zoomIndex: state.zoomIndex, displayMode: state.displayMode, selecting: state.selecting, selectedIds: state.selectedIds, onSelect: handleSelect, onClick: handleCardClick };
  }

  // ── Grid area ──
  const gridArea = moEl('div', 'mo-grid-area');
  root.appendChild(gridArea);

  // Loading overlay
  const loadingOverlay = moEl('div', 'mo-loading-overlay');
  loadingOverlay.appendChild(moEl('div', 'mo-spinner'));
  loadingOverlay.style.display = 'none';
  gridArea.appendChild(loadingOverlay);

  let cardGrid = null;

  // ── Pagination ──
  const paginationBar = moEl('div', 'mo-pagination');
  const pageFirst = moEl('button', 'mo-page-btn', { textContent: '\u00AB', title: 'First page' });
  const pagePrev = moEl('button', 'mo-page-btn', { textContent: '\u2039', title: 'Previous page' });
  const pageInfo = moEl('span', 'mo-page-info');
  const pageNext = moEl('button', 'mo-page-btn', { textContent: '\u203A', title: 'Next page' });
  const pageLast = moEl('button', 'mo-page-btn', { textContent: '\u00BB', title: 'Last page' });
  const perPageSelect = moEl('select', 'mo-toolbar-select');
  for (const pp of [20, 40, 80, 120]) {
    const opt = moEl('option', null, { value: String(pp), textContent: `${pp}/page` });
    if (pp === state.perPage) opt.selected = true;
    perPageSelect.appendChild(opt);
  }
  paginationBar.append(pageFirst, pagePrev, pageInfo, pageNext, pageLast, perPageSelect);
  root.appendChild(paginationBar);

  function updatePagination() {
    const totalPages = Math.max(1, Math.ceil(state.totalCount / state.perPage));
    pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;
    pageFirst.disabled = state.currentPage <= 1;
    pagePrev.disabled = state.currentPage <= 1;
    pageNext.disabled = state.currentPage >= totalPages;
    pageLast.disabled = state.currentPage >= totalPages;
  }

  // ── Shared filter criteria applier ──
  // Adapted from stash: pkg/sqlite/criterion_handlers.go — AND-combined criteria
  function applyFilterCriteria(alias, where, params, joinParts, filters) {
    const tagTable = alias === 'p' ? 'mo_photos_tags' : 'mo_videos_tags';
    const tagFk = alias === 'p' ? 'photo_id' : 'video_id';

    // Tag include via subquery with AND semantics (stash: IncludesAll — media must have ALL included tags)
    if (filters.resolvedTagIds && filters.resolvedTagIds.length > 0) {
      const placeholders = filters.resolvedTagIds.map(() => '?').join(',');
      where.push(`${alias}.id IN (SELECT ${tagFk} FROM ${tagTable} WHERE tag_id IN (${placeholders}) GROUP BY ${tagFk} HAVING COUNT(DISTINCT tag_id) = ?)`);
      params.push(...filters.resolvedTagIds, filters.resolvedTagIds.length);
    }

    // Tag exclude via subquery
    if (filters.resolvedExcludeTagIds && filters.resolvedExcludeTagIds.length > 0) {
      const placeholders = filters.resolvedExcludeTagIds.map(() => '?').join(',');
      where.push(`${alias}.id NOT IN (SELECT ${tagFk} FROM ${tagTable} WHERE tag_id IN (${placeholders}))`);
      params.push(...filters.resolvedExcludeTagIds);
    }

    // Rating min (schema stores 0-5 integers, no scale conversion needed)
    if (filters.ratingMin != null) {
      where.push(`${alias}.rating >= ?`);
      params.push(filters.ratingMin);
    }

    // Date range
    if (filters.dateFrom) {
      where.push(`${alias}.created_at >= ?`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      where.push(`${alias}.created_at <= ?`);
      params.push(filters.dateTo + 'T23:59:59');
    }
  }

  // ── Unified media query helpers ──
  // Adapted from stash: unified query with UNION ALL for correct pagination across photo+video
  function buildUnifiedQuery(filterType, filterId, searchText, safeColumn, safeDir, limit, offset, filters) {
    const photoWhere = [];
    const videoWhere = [];
    const photoParams = [];
    const videoParams = [];
    const photoJoinParts = [];
    const videoJoinParts = [];

    if (filterType === 'folder' && filterId) {
      photoJoinParts.push(` JOIN mo_photos_files pf ON pf.photo_id = p.id JOIN mo_files f ON f.id = pf.file_id`);
      photoWhere.push('f.folder_id = ?'); photoParams.push(filterId);
      videoJoinParts.push(` JOIN mo_videos_files vf ON vf.video_id = v.id JOIN mo_files f2 ON f2.id = vf.file_id`);
      videoWhere.push('f2.folder_id = ?'); videoParams.push(filterId);
    } else if (filterType === 'tag' && filterId) {
      photoJoinParts.push(` JOIN mo_photos_tags pt ON pt.photo_id = p.id`);
      photoWhere.push('pt.tag_id = ?'); photoParams.push(filterId);
      videoJoinParts.push(` JOIN mo_videos_tags vt ON vt.video_id = v.id`);
      videoWhere.push('vt.tag_id = ?'); videoParams.push(filterId);
    } else if (filterType === 'favorites') {
      photoWhere.push('p.rating >= 5'); videoWhere.push('v.rating >= 5');
    }

    if (searchText) {
      photoWhere.push('p.title LIKE ?'); photoParams.push(`%${searchText}%`);
      videoWhere.push('v.title LIKE ?'); videoParams.push(`%${searchText}%`);
    }

    if (filters) {
      applyFilterCriteria('p', photoWhere, photoParams, photoJoinParts, filters);
      applyFilterCriteria('v', videoWhere, videoParams, videoJoinParts, filters);
    }

    // file_mod_time sort requires JOIN to files table in each sub-query
    const needsFileSort = safeColumn === 'file_mod_time';
    if (needsFileSort) {
      if (!photoJoinParts.some((j) => j.includes('mo_files'))) {
        photoJoinParts.push(` JOIN mo_photos_files psf ON psf.photo_id = p.id JOIN mo_files pfs ON pfs.id = psf.file_id`);
      }
      if (!videoJoinParts.some((j) => j.includes('mo_files'))) {
        videoJoinParts.push(` JOIN mo_videos_files vsf ON vsf.video_id = v.id JOIN mo_files vfs ON vfs.id = vsf.file_id`);
      }
    }
    const photoFileAlias = photoJoinParts.some((j) => j.includes(' f ON ')) ? 'f' : 'pfs';
    const videoFileAlias = videoJoinParts.some((j) => j.includes(' f2 ON ')) ? 'f2' : 'vfs';

    const photoJoin = photoJoinParts.join('');
    const videoJoin = videoJoinParts.join('');
    const pw = photoWhere.length > 0 ? ` WHERE ${photoWhere.join(' AND ')}` : '';
    const vw = videoWhere.length > 0 ? ` WHERE ${videoWhere.join(' AND ')}` : '';

    const photoModTime = needsFileSort ? `, ${photoFileAlias}.mod_time AS file_mod_time` : '';
    const videoModTime = needsFileSort ? `, ${videoFileAlias}.mod_time AS file_mod_time` : '';
    const effectiveSort = safeColumn === 'file_mod_time' ? 'file_mod_time' : safeColumn;

    const dataQuery = `
      SELECT * FROM (
        SELECT 'photo' AS media_type, p.id, p.title, p.rating, p.created_at, p.taken_at, NULL AS duration${photoModTime}
        FROM mo_photos p${photoJoin}${pw}
        UNION ALL
        SELECT 'video' AS media_type, v.id, v.title, v.rating, v.created_at, NULL AS taken_at, v.duration${videoModTime}
        FROM mo_videos v${videoJoin}${vw}
      ) combined
      ORDER BY ${effectiveSort} ${safeDir}, COALESCE(title, '') COLLATE NOCASE ASC, id ASC
      LIMIT ? OFFSET ?`;
    const dataParams = [...photoParams, ...videoParams, limit, offset];

    const countQuery = `
      SELECT (
        SELECT COUNT(*) FROM mo_photos p${photoJoin}${pw}
      ) + (
        SELECT COUNT(*) FROM mo_videos v${videoJoin}${vw}
      ) AS count`;
    const countParams = [...photoParams, ...videoParams];

    return { dataQuery, dataParams, countQuery, countParams };
  }

  function buildSingleTypeQuery(type, filterType, filterId, searchText, safeColumn, safeDir, limit, offset, filters) {
    const table = type === 'photo' ? 'mo_photos' : 'mo_videos';
    const alias = type === 'photo' ? 'p' : 'v';
    const where = [];
    const params = [];
    const joinParts = [];

    if (filterType === 'folder' && filterId) {
      const joinTable = type === 'photo' ? 'mo_photos_files' : 'mo_videos_files';
      const joinCol = type === 'photo' ? 'photo_id' : 'video_id';
      joinParts.push(` JOIN ${joinTable} jf ON jf.${joinCol} = ${alias}.id JOIN mo_files f ON f.id = jf.file_id`);
      where.push('f.folder_id = ?'); params.push(filterId);
    } else if (filterType === 'tag' && filterId) {
      const tagTable = type === 'photo' ? 'mo_photos_tags' : 'mo_videos_tags';
      const tagCol = type === 'photo' ? 'photo_id' : 'video_id';
      joinParts.push(` JOIN ${tagTable} jt ON jt.${tagCol} = ${alias}.id`);
      where.push('jt.tag_id = ?'); params.push(filterId);
    } else if (filterType === 'favorites') {
      where.push(`${alias}.rating >= 5`);
    }

    if (searchText) {
      where.push(`${alias}.title LIKE ?`); params.push(`%${searchText}%`);
    }

    if (filters) {
      applyFilterCriteria(alias, where, params, joinParts, filters);
    }

    // file_mod_time sort requires JOIN to files table
    let hasFileJoin = joinParts.some((j) => j.includes('mo_files'));
    if (safeColumn === 'file_mod_time' && !hasFileJoin) {
      const joinTable = type === 'photo' ? 'mo_photos_files' : 'mo_videos_files';
      const joinCol = type === 'photo' ? 'photo_id' : 'video_id';
      joinParts.push(` JOIN ${joinTable} sf ON sf.${joinCol} = ${alias}.id JOIN mo_files fsort ON fsort.id = sf.file_id`);
    }

    // Fallback: videos lack taken_at column — use created_at instead
    let effectiveColumn = (safeColumn === 'taken_at' && type === 'video') ? 'created_at' : safeColumn;
    // file_mod_time → reference the files table column
    let orderExpr;
    if (effectiveColumn === 'file_mod_time') {
      const fAlias = hasFileJoin ? 'f' : 'fsort';
      orderExpr = `${fAlias}.mod_time`;
    } else {
      orderExpr = `${alias}.${effectiveColumn}`;
    }

    const join = joinParts.join('');
    const w = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';
    const dataQuery = `SELECT ${alias}.* FROM ${table} ${alias}${join}${w} ORDER BY ${orderExpr} ${safeDir}, COALESCE(${alias}.title, '') COLLATE NOCASE ASC, ${alias}.id ASC LIMIT ? OFFSET ?`;
    const dataParams = [...params, limit, offset];
    const countQuery = `SELECT COUNT(*) AS count FROM ${table} ${alias}${join}${w}`;
    const countParams = [...params];

    return { dataQuery, dataParams, countQuery, countParams };
  }

  function rowToMediaItem(row, type) {
    if (type === 'photo') {
      const p = PhotoQueries.fromRow(row);
      return { type: 'photo', id: p.id, title: p.title, rating: p.rating, createdAt: p.createdAt, takenAt: p.takenAt, duration: null, thumbnailPath: null, thumbnailStatus: 'pending' };
    }
    if (type === 'video') {
      const v = VideoQueries.fromRow(row);
      return { type: 'video', id: v.id, title: v.title, rating: v.rating, createdAt: v.createdAt, takenAt: null, duration: v.duration, thumbnailPath: null, thumbnailStatus: 'pending' };
    }
    // UNION result row (media_type column present)
    return {
      type: row.media_type,
      id: row.id,
      title: row.title,
      rating: row.rating,
      createdAt: row.created_at,
      takenAt: row.taken_at || null,
      duration: row.duration || null,
      thumbnailPath: null,
      thumbnailStatus: 'pending',
    };
  }

  // ── Data loading ──
  let _pageRecursionGuard = false;
  async function loadPage() {
    // Show loading spinner
    loadingOverlay.style.display = '';
    loadingOverlay.style.animation = 'none';
    loadingOverlay.offsetHeight; // reflow to restart animation
    loadingOverlay.style.animation = '';

    const searchText = searchInput.value.trim();
    const safeColumn = MO_SAFE_SORT_COLUMNS[state.sortBy] || 'created_at';
    const safeDir = state.sortDir === 'ASC' ? 'ASC' : 'DESC';
    const limit = state.perPage;
    const offset = (state.currentPage - 1) * state.perPage;

    let items = [];
    let totalCount = 0;

    // Resolve filter tag descendants (stash: hierarchical tag filtering via CTE)
    const resolvedFilters = { ratingMin: state.filters.ratingMin, dateFrom: state.filters.dateFrom, dateTo: state.filters.dateTo };
    if (state.filters.tagIds.length > 0) {
      if (state.filters.tagDepth === -1) {
        // Include descendants — flatten all descendant IDs
        const allIds = new Set(state.filters.tagIds);
        for (const tid of state.filters.tagIds) {
          const desc = await TagQueries.getDescendants(tid);
          for (const d of desc) allIds.add(d.id);
        }
        resolvedFilters.resolvedTagIds = [...allIds];
      } else {
        resolvedFilters.resolvedTagIds = [...state.filters.tagIds];
      }
    }
    if (state.filters.excludeTagIds.length > 0) {
      if (state.filters.tagDepth === -1) {
        const allIds = new Set(state.filters.excludeTagIds);
        for (const tid of state.filters.excludeTagIds) {
          const desc = await TagQueries.getDescendants(tid);
          for (const d of desc) allIds.add(d.id);
        }
        resolvedFilters.resolvedExcludeTagIds = [...allIds];
      } else {
        resolvedFilters.resolvedExcludeTagIds = [...state.filters.excludeTagIds];
      }
    }

    try {
      if (state.mediaType === 'all') {
        // Unified UNION ALL query for correct pagination
        const q = buildUnifiedQuery(filterType, filterId, searchText, safeColumn, safeDir, limit, offset, resolvedFilters);
        const rows = await db.all(q.dataQuery, q.dataParams);
        const countRow = await db.get(q.countQuery, q.countParams);
        items = (rows || []).map((r) => rowToMediaItem(r, null));
        totalCount = countRow ? countRow.count : 0;
      } else {
        // Single-type query (photos or videos)
        const q = buildSingleTypeQuery(state.mediaType === 'photos' ? 'photo' : 'video', filterType, filterId, searchText, safeColumn, safeDir, limit, offset, resolvedFilters);
        const rows = await db.all(q.dataQuery, q.dataParams);
        const countRow = await db.get(q.countQuery, q.countParams);
        const type = state.mediaType === 'photos' ? 'photo' : 'video';
        items = (rows || []).map((r) => rowToMediaItem(r, type));
        totalCount = countRow ? countRow.count : 0;
      }
    } catch (err) {
      console.error('[MO-Grid] load error:', err);
    }

    // Hide spinner
    loadingOverlay.style.display = 'none';

    // ensureValidPage — auto-correct if past last page
    state.totalCount = totalCount;
    const totalPages = Math.max(1, Math.ceil(totalCount / state.perPage));
    if (state.currentPage > totalPages && totalPages > 0 && !_pageRecursionGuard) {
      state.currentPage = totalPages;
      _pageRecursionGuard = true;
      return loadPage();
    }
    _pageRecursionGuard = false;

    state.items = items;
    countLabel.textContent = `${totalCount} items`;
    updatePagination();
    updateFilterBadge();

    if (cardGrid) {
      cardGrid.refresh(items, refreshOpts());
    }

    // Scroll grid to top on page change
    const scrollEl = gridArea.querySelector('.mo-grid');
    if (scrollEl) scrollEl.scrollTop = 0;
  }

  function handleSelect(item, checked, shiftKey) {
    const key = `${item.type}:${item.id}`;

    if (shiftKey && state.lastClickedKey) {
      // Shift-click range selection — adapted from stash: useListSelect.multiSelect
      const startIdx = state.items.findIndex(i => `${i.type}:${i.id}` === state.lastClickedKey);
      const endIdx = state.items.findIndex(i => `${i.type}:${i.id}` === key);
      if (startIdx >= 0 && endIdx >= 0) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        for (let j = lo; j <= hi; j++) {
          const k = `${state.items[j].type}:${state.items[j].id}`;
          state.selectedIds.add(k);
        }
      }
    } else {
      if (checked) state.selectedIds.add(key);
      else state.selectedIds.delete(key);
    }

    state.lastClickedKey = key;
    state.selecting = state.selectedIds.size > 0;
    if (selectionBar) selectionBar.update();
    if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
  }

  function handleCardClick(item) {
    api.editors.openEditor({
      typeId: 'media-organizer-grid',
      title: item.title || `${item.type} #${item.id}`,
      icon: item.type === 'video' ? 'file-media' : 'image',
      instanceId: `detail:${item.type}:${item.id}`,
    });
  }

  // Initialize grid
  cardGrid = renderCardGrid(gridArea, [], refreshOpts());

  // Event handlers
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.currentPage = 1; loadPage(); }, 500);
  });

  sortSelect.addEventListener('change', () => {
    state.sortBy = sortSelect.value;
    state.currentPage = 1;
    loadPage();
  });

  sortDirBtn.addEventListener('click', () => {
    state.sortDir = state.sortDir === 'DESC' ? 'ASC' : 'DESC';
    sortDirBtn.innerHTML = moIcon(state.sortDir === 'DESC' ? 'arrow-down' : 'arrow-up', 12);
    state.currentPage = 1;
    loadPage();
  });

  zoomSlider.addEventListener('input', () => {
    state.zoomIndex = parseInt(zoomSlider.value, 10);
    if (cardGrid) {
      cardGrid.refresh(state.items, refreshOpts());
    }
  });

  // Display mode toggle handlers
  gridModeBtn.addEventListener('click', () => {
    state.displayMode = 'grid';
    gridModeBtn.classList.add('active');
    listModeBtn.classList.remove('active');
    zoomGroup.style.display = '';
    if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
  });
  listModeBtn.addEventListener('click', () => {
    state.displayMode = 'list';
    listModeBtn.classList.add('active');
    gridModeBtn.classList.remove('active');
    zoomGroup.style.display = 'none';
    if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
  });

  pageFirst.addEventListener('click', () => { state.currentPage = 1; loadPage(); });
  pagePrev.addEventListener('click', () => { if (state.currentPage > 1) { state.currentPage--; loadPage(); } });
  pageNext.addEventListener('click', () => {
    const max = Math.ceil(state.totalCount / state.perPage);
    if (state.currentPage < max) { state.currentPage++; loadPage(); }
  });
  pageLast.addEventListener('click', () => {
    state.currentPage = Math.max(1, Math.ceil(state.totalCount / state.perPage));
    loadPage();
  });
  perPageSelect.addEventListener('change', () => {
    state.perPage = parseInt(perPageSelect.value, 10);
    state.currentPage = 1;
    loadPage();
  });

  // Initial load
  loadPage();

  // Keyboard shortcuts for grid — adapted from stash: useListSelect + KeyboardShortcuts.md
  function handleGridKeydown(e) {
    // Escape — deselect all
    if (e.key === 'Escape' && state.selectedIds.size > 0) {
      state.selectedIds.clear();
      state.selecting = false;
      if (selectionBar) selectionBar.update();
      if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
      e.preventDefault();
      return;
    }
    // Ctrl+A — select all on current page (adapted from stash: KeyboardShortcuts.md)
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      for (const item of state.items) {
        state.selectedIds.add(`${item.type}:${item.id}`);
      }
      state.selecting = true;
      if (selectionBar) selectionBar.update();
      if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
      return;
    }
  }
  root.addEventListener('keydown', handleGridKeydown);

  return {
    dispose() {
      clearTimeout(searchTimer);
      root.removeEventListener('keydown', handleGridKeydown);
      if (cardGrid) cardGrid.dispose();
      container.innerHTML = '';
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 26: DETAIL EDITOR — CORE LAYOUT
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/Scenes/SceneDetails — detail view layout
// Input ID format: 'detail:<type>:<id>' e.g. 'detail:photo:42'

function parseDetailInput(inputId) {
  const str = (inputId || '').replace(/^detail:/, '');
  const [type, idStr] = str.split(':');
  return { type: type || 'photo', id: parseInt(idStr, 10) || 0 };
}

async function loadDetailData(type, id) {
  const Queries = type === 'video' ? VideoQueries : PhotoQueries;
  const entity = await Queries.findById(id);
  if (!entity) return null;

  const tags = await Queries.loadTags(id);
  const files = await Queries.loadFiles(id);
  const primaryFile = files.find(f => f.isPrimary) || files[0] || null;

  let folder = null;
  let fullPath = null;
  let imageFile = null;
  let videoFile = null;

  if (primaryFile) {
    folder = await FolderQueries.findById(primaryFile.folderId);
    if (folder) {
      const sep = folder.path.includes('\\') ? '\\' : '/';
      fullPath = folder.path.replace(/[\\/]+$/, '') + sep + primaryFile.basename;
    }
    if (type === 'photo') {
      imageFile = await ImageFileQueries.findByFileId(primaryFile.id);
    } else {
      videoFile = await VideoFileQueries.findByFileId(primaryFile.id);
    }
  }

  return { type, entity, tags, files, primaryFile, folder, fullPath, imageFile, videoFile };
}

function renderDetailEditor(container, api, input) {
  moInjectStyles();
  const root = moEl('div', 'mo-detail-editor');
  container.appendChild(root);

  const { type, id } = parseDetailInput(input && input.id);
  if (!id) {
    root.textContent = 'Invalid detail input.';
    return { dispose() { container.innerHTML = ''; } };
  }

  const headerEl = moEl('div', 'mo-detail-header');
  root.appendChild(headerEl);
  const bodyEl = moEl('div', 'mo-detail-body');
  root.appendChild(bodyEl);

  // Show loading placeholder with delayed fade-in
  const loadingEl = moEl('div', 'mo-detail-loading');
  loadingEl.setAttribute('role', 'status');
  const spinner = moEl('div', 'mo-spinner');
  loadingEl.appendChild(spinner);
  loadingEl.appendChild(moEl('span', null, { textContent: ' Loading...' }));
  bodyEl.appendChild(loadingEl);

  let currentCtx = null;

  async function loadAndRender() {
    if (bodyEl._moKeydownCleanup) { bodyEl._moKeydownCleanup(); bodyEl._moKeydownCleanup = null; }
    const ctx = await loadDetailData(type, id);
    if (!ctx) {
      root.innerHTML = '';
      root.textContent = `${type} #${id} not found.`;
      return;
    }
    currentCtx = ctx;
    headerEl.innerHTML = '';
    bodyEl.innerHTML = '';
    buildDetailHeader(ctx, api, headerEl, {
      onPrev: null, // D7 iter 2+ can add navigation
      onNext: null,
    });
    buildDetailLayout(ctx, api, bodyEl, loadAndRender);
  }

  loadAndRender().catch(err => { root.textContent = 'Error loading detail: ' + err.message; });

  return {
    dispose() {
      if (bodyEl._moKeydownCleanup) bodyEl._moKeydownCleanup();
      // Clear any pending save timers from editable fields
      const tabContent = root.querySelector('.mo-detail-tab-content');
      if (tabContent && tabContent._moSaveTimers) {
        tabContent._moSaveTimers.forEach(t => t.clear());
      }
      container.innerHTML = '';
    },
  };
}

function buildDetailHeader(ctx, api, headerEl, callbacks) {
  const iconSpan = moEl('span', 'mo-detail-header-icon');
  iconSpan.innerHTML = moIcon(ctx.type === 'video' ? 'file-media' : 'image', 14);
  headerEl.appendChild(iconSpan);

  const titleText = ctx.entity.title || (ctx.primaryFile ? ctx.primaryFile.basename : `${ctx.type} #${ctx.entity.id}`);
  const titleEl = moEl('span', 'mo-detail-header-title', { textContent: titleText });
  headerEl.appendChild(titleEl);

  const actions = moEl('div', 'mo-detail-header-actions');
  // Navigation buttons (prev/next — stubs for now)
  if (callbacks.onPrev) {
    const prevBtn = moEl('button', 'mo-detail-nav-btn', { title: 'Previous' });
    prevBtn.innerHTML = moIcon('arrow-left', 12);
    prevBtn.addEventListener('click', callbacks.onPrev);
    actions.appendChild(prevBtn);
  }
  if (callbacks.onNext) {
    const nextBtn = moEl('button', 'mo-detail-nav-btn', { title: 'Next' });
    nextBtn.innerHTML = moIcon('arrow-right', 12);
    nextBtn.addEventListener('click', callbacks.onNext);
    actions.appendChild(nextBtn);
  }
  headerEl.appendChild(actions);
}

function buildDetailLayout(ctx, api, bodyEl, onRefresh) {
  // Left: media preview
  const preview = buildMediaPreview(ctx);
  bodyEl.appendChild(preview);

  // Right: tabbed panel
  const panel = moEl('div', 'mo-detail-panel');
  bodyEl.appendChild(panel);

  const tabBar = moEl('div', 'mo-detail-tab-bar');
  tabBar.setAttribute('role', 'tablist');
  panel.appendChild(tabBar);

  const tabContent = moEl('div', 'mo-detail-tab-content');
  panel.appendChild(tabContent);

  const tabs = [
    { key: 'details', label: 'Details' },
    { key: 'fileinfo', label: ctx.files && ctx.files.length > 1 ? `File Info (${ctx.files.length})` : 'File Info' },
  ];

  let activeTab = 'details';
  const tabBtns = {};

  function switchTab(key) {
    activeTab = key;
    for (const [k, btn] of Object.entries(tabBtns)) {
      const isActive = k === key;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    }
    tabContent.innerHTML = '';
    tabContent.setAttribute('aria-labelledby', `mo-tab-${key}`);
    if (key === 'details') {
      buildDetailsTab(ctx, api, tabContent, onRefresh);
    } else if (key === 'fileinfo') {
      buildFileInfoTab(ctx, tabContent);
    }
  }

  for (const tab of tabs) {
    const btn = moEl('button', `mo-detail-tab-btn${tab.key === activeTab ? ' active' : ''}`, { textContent: tab.label });
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(tab.key === activeTab));
    btn.setAttribute('aria-controls', 'mo-detail-tab-content');
    btn.id = `mo-tab-${tab.key}`;
    btn.addEventListener('click', () => switchTab(tab.key));
    tabBar.appendChild(btn);
    tabBtns[tab.key] = btn;
  }

  tabContent.setAttribute('role', 'tabpanel');
  tabContent.setAttribute('aria-labelledby', `mo-tab-${activeTab}`);

  // Tab bar arrow key navigation (WAI-ARIA tabs pattern)
  tabBar.addEventListener('keydown', (e) => {
    const tabKeys = Object.keys(tabBtns);
    const currentIdx = tabKeys.indexOf(activeTab);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (currentIdx + 1) % tabKeys.length;
      switchTab(tabKeys[nextIdx]);
      tabBtns[tabKeys[nextIdx]].focus();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx = (currentIdx - 1 + tabKeys.length) % tabKeys.length;
      switchTab(tabKeys[prevIdx]);
      tabBtns[tabKeys[prevIdx]].focus();
    }
  });

  // Keyboard shortcuts for tab switching — scoped to editor root
  function handleKeydown(e) {
    // Only when not focused on an input/textarea and within this editor
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!bodyEl.closest('.mo-detail-editor')?.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (e.key === 'a' || e.key === 'A') { switchTab('details'); }
    else if (e.key === 'i' || e.key === 'I') { switchTab('fileinfo'); }
  }
  document.addEventListener('keydown', handleKeydown);
  bodyEl._moKeydownCleanup = () => document.removeEventListener('keydown', handleKeydown);

  // Render initial tab
  switchTab(activeTab);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 27: DETAIL EDITOR — MEDIA PREVIEW
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/Scenes/ScenePlayer

function buildMediaPreview(ctx) {
  const wrap = moEl('div', 'mo-detail-preview');
  if (!ctx.fullPath) {
    wrap.textContent = 'No file available';
    return wrap;
  }
  if (ctx.type === 'video') {
    buildVideoPlayer(wrap, ctx.fullPath);
  } else {
    buildPhotoPreview(wrap, ctx.fullPath);
  }
  return wrap;
}

function buildPhotoPreview(container, fullPath) {
  const img = moEl('img');
  img.src = 'file://' + fullPath.replace(/\\/g, '/');
  img.alt = 'Photo preview';
  img.addEventListener('error', () => { img.style.display = 'none'; container.textContent = 'Failed to load image'; });
  container.appendChild(img);
}

function buildVideoPlayer(container, fullPath) {
  const video = document.createElement('video');
  video.controls = true;
  video.preload = 'metadata';

  const source = document.createElement('source');
  source.src = 'file://' + fullPath.replace(/\\/g, '/');
  video.appendChild(source);
  video.addEventListener('error', () => { video.style.display = 'none'; container.textContent = 'Failed to load video'; });
  container.appendChild(video);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 28: DETAIL EDITOR — DETAILS TAB
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/Scenes/SceneEditPanel — edit/detail tab

function buildDetailsTab(ctx, api, container, onRefresh) {
  const Queries = ctx.type === 'video' ? VideoQueries : PhotoQueries;

  // Title field
  buildEditableField(container, 'Title', ctx.entity.title || '', false, async (val) => {
    try {
      await Queries.update(ctx.entity.id, { title: val });
      ctx.entity.title = val;
    } catch (err) { console.error('[MO-Detail] Title save failed:', err); }
  });

  // Details/notes field
  buildEditableField(container, 'Details', ctx.entity.details || '', true, async (val) => {
    try {
      await Queries.update(ctx.entity.id, { details: val });
      ctx.entity.details = val;
    } catch (err) { console.error('[MO-Detail] Details save failed:', err); }
  });

  // Rating — inline auto-save (fire-and-forget, per stash pattern)
  const ratingSection = moEl('div', 'mo-detail-section');
  const ratingLabel = moEl('div', 'mo-detail-section-label', { textContent: 'Rating' });
  ratingSection.appendChild(ratingLabel);
  buildRatingWidget(ratingSection, ctx.entity.rating || 0, async (newRating) => {
    try {
      await Queries.update(ctx.entity.id, { rating: newRating });
      ctx.entity.rating = newRating;
    } catch (err) { console.error('[MO-Detail] Rating save failed:', err); }
  });
  container.appendChild(ratingSection);

  // Tags
  const tagSection = moEl('div', 'mo-detail-section');
  const tagLabel = moEl('div', 'mo-detail-section-label', { textContent: 'Tags' });
  tagSection.appendChild(tagLabel);
  buildTagEditor(tagSection, ctx.tags, ctx.type, ctx.entity.id, api, onRefresh);
  container.appendChild(tagSection);

  // Photo-specific fields
  if (ctx.type === 'photo') {
    buildEditableField(container, 'Photographer', ctx.entity.photographer || '', false, async (val) => {
      try {
        await Queries.update(ctx.entity.id, { photographer: val });
        ctx.entity.photographer = val;
      } catch (err) { console.error('[MO-Detail] Photographer save failed:', err); }
    });
  }

  // Date taken (read-only display)
  if (ctx.entity.takenAt) {
    const dateSection = moEl('div', 'mo-detail-section');
    const dateLabel = moEl('div', 'mo-detail-section-label', { textContent: 'Date Taken' });
    dateSection.appendChild(dateLabel);
    const dateVal = moEl('div', null, { textContent: new Date(ctx.entity.takenAt).toLocaleString() });
    dateSection.appendChild(dateVal);
    container.appendChild(dateSection);
  }
}

function buildRatingWidget(container, currentRating, onRate) {
  const wrap = moEl('div', 'mo-detail-rating');
  wrap.setAttribute('role', 'radiogroup');
  wrap.setAttribute('aria-label', 'Rating');

  let focusedIndex = currentRating > 0 ? currentRating - 1 : 0;

  for (let i = 1; i <= 5; i++) {
    const star = moEl('button', `mo-detail-star${i <= currentRating ? ' filled' : ''}`, { textContent: '★' });
    star.setAttribute('role', 'radio');
    star.setAttribute('aria-checked', String(i <= currentRating));
    star.setAttribute('aria-label', `${i} star${i > 1 ? 's' : ''}`);
    // Roving tabindex: only focused star gets tabindex 0
    star.setAttribute('tabindex', i - 1 === focusedIndex ? '0' : '-1');
    star.title = i === currentRating ? 'Clear rating' : `Rate ${i} star${i > 1 ? 's' : ''}`;
    star.addEventListener('click', async () => {
      const newRating = i === currentRating ? 0 : i;
      currentRating = newRating;
      focusedIndex = i - 1;
      updateStars();
      await onRate(newRating);
    });
    star.addEventListener('keydown', (e) => {
      const stars = wrap.querySelectorAll('.mo-detail-star');
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        focusedIndex = Math.min(focusedIndex + 1, 4);
        updateTabindex(stars);
        stars[focusedIndex].focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        focusedIndex = Math.max(focusedIndex - 1, 0);
        updateTabindex(stars);
        stars[focusedIndex].focus();
      }
    });
    wrap.appendChild(star);
  }

  function updateTabindex(stars) {
    stars.forEach((s, idx) => s.setAttribute('tabindex', idx === focusedIndex ? '0' : '-1'));
  }

  function updateStars() {
    const stars = wrap.querySelectorAll('.mo-detail-star');
    stars.forEach((s, idx) => {
      const starNum = idx + 1;
      s.classList.toggle('filled', starNum <= currentRating);
      s.setAttribute('aria-checked', String(starNum <= currentRating));
      s.title = starNum === currentRating ? 'Clear rating' : `Rate ${starNum} star${starNum > 1 ? 's' : ''}`;
    });
    updateTabindex(stars);
  }

  container.appendChild(wrap);
}

function buildEditableField(container, label, value, multiline, onSave) {
  const wrap = moEl('div', 'mo-detail-field');
  const lbl = moEl('label', null, { textContent: label });
  wrap.appendChild(lbl);

  const input = multiline
    ? moEl('textarea', null)
    : moEl('input', null, { type: 'text', value: value });
  if (multiline) input.value = value;

  let saveTimer = null;
  // Store timer for cleanup (detail editor dispose clears all timers)
  if (!container._moSaveTimers) container._moSaveTimers = [];
  const timerRef = { clear() { clearTimeout(saveTimer); } };
  container._moSaveTimers.push(timerRef);

  input.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { onSave(input.value); }, 800);
  });
  input.addEventListener('blur', () => {
    clearTimeout(saveTimer);
    onSave(input.value);
  });

  wrap.appendChild(input);
  container.appendChild(wrap);
}

function buildTagEditor(container, tags, entityType, entityId, api, onRefresh) {
  const Queries = entityType === 'video' ? VideoQueries : entityType === 'album' ? AlbumQueries : PhotoQueries;
  let currentTags = [...tags];

  const wrap = moEl('div', 'mo-detail-tag-editor');
  container.appendChild(wrap);

  const pillsWrap = moEl('div', 'mo-detail-tag-pills');
  wrap.appendChild(pillsWrap);

  function renderPills() {
    pillsWrap.innerHTML = '';
    for (const tag of currentTags) {
      const pill = moEl('span', 'mo-detail-tag-pill');
      pill.textContent = tag.name;
      const removeBtn = moEl('button', null, { textContent: '×', title: `Remove ${tag.name}` });
      removeBtn.setAttribute('aria-label', `Remove tag ${tag.name}`);
      removeBtn.addEventListener('click', async () => {
        try {
          await Queries.updateTags(entityId, { mode: 'REMOVE', ids: [tag.id] });
          currentTags = currentTags.filter(t => t.id !== tag.id);
          renderPills();
          // Focus next pill remove button or the add input
          const nextBtn = pillsWrap.querySelector('.mo-detail-tag-pill button');
          if (nextBtn) nextBtn.focus();
          else { const addInput = wrap.querySelector('.mo-detail-autocomplete input'); if (addInput) addInput.focus(); }
        } catch (err) { console.error('[MO-Detail] Tag remove failed:', err); }
      });
      pill.appendChild(removeBtn);
      pillsWrap.appendChild(pill);
    }
  }

  renderPills();

  // Autocomplete for adding tags
  buildTagAutocomplete(wrap, currentTags, async (selectedTag) => {
    try {
      await Queries.updateTags(entityId, { mode: 'ADD', ids: [selectedTag.id] });
      currentTags.push(selectedTag);
      renderPills();
    } catch (err) { console.error('[MO-Detail] Tag add failed:', err); }
  });
}

function buildTagAutocomplete(container, existingTags, onAdd) {
  const autocomplete = moEl('div', 'mo-detail-autocomplete');
  const input = moEl('input', null, { type: 'text', placeholder: 'Add tag...' });
  input.setAttribute('aria-label', 'Search tags to add');
  autocomplete.appendChild(input);
  container.appendChild(autocomplete);

  let dropdown = null;
  let searchTimer = null;
  let selectedIndex = -1;
  let currentItems = [];

  async function doSearch(query) {
    if (!query || query.length < 1) {
      closeDropdown();
      return;
    }
    try {
      const result = await TagQueries.findMany({ nameLike: `%${query}%` }, { field: 'name', direction: 'ASC' }, { page: 1, perPage: 10 });
      const existingIds = new Set(existingTags.map(t => t.id));
      const filtered = result.items.filter(t => !existingIds.has(t.id));
      // Check if exact match exists — if not, offer "Create" option
      const exactMatch = result.items.some(t => t.name.toLowerCase() === query.toLowerCase());
      showDropdown(filtered, exactMatch ? null : query);
    } catch (err) {
      console.error('[MO-Detail] Tag search failed:', err);
    }
  }

  function showDropdown(items, createName) {
    closeDropdown();
    currentItems = items;
    selectedIndex = -1;
    if (items.length === 0 && !createName) return;

    dropdown = moEl('div', 'mo-detail-autocomplete-list');

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = moEl('div', 'mo-detail-autocomplete-item', { textContent: item.name });
      row.addEventListener('click', () => selectItem(item));
      row.addEventListener('mouseenter', () => highlightIndex(i));
      dropdown.appendChild(row);
    }

    // "Create new tag" option
    if (createName) {
      const createRow = moEl('div', 'mo-detail-autocomplete-item mo-detail-autocomplete-create', { textContent: `Create "${createName}"` });
      createRow.addEventListener('click', () => createAndAddTag(createName));
      createRow.addEventListener('mouseenter', () => highlightIndex(items.length));
      dropdown.appendChild(createRow);
      currentItems = [...items, { _create: true, name: createName }];
    }

    autocomplete.appendChild(dropdown);
  }

  function highlightIndex(idx) {
    selectedIndex = idx;
    if (!dropdown) return;
    const rows = dropdown.querySelectorAll('.mo-detail-autocomplete-item');
    rows.forEach((r, i) => r.classList.toggle('selected', i === idx));
  }

  async function selectItem(item) {
    await onAdd(item);
    input.value = '';
    closeDropdown();
    input.focus();
  }

  async function createAndAddTag(name) {
    try {
      const newTag = await TagQueries.create({ name });
      await onAdd(newTag);
      input.value = '';
      closeDropdown();
      input.focus();
    } catch (err) {
      console.error('[MO-Detail] Tag creation failed:', err);
    }
  }

  function closeDropdown() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    currentItems = [];
    selectedIndex = -1;
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => doSearch(input.value.trim()), 300);
  });

  input.addEventListener('blur', () => {
    setTimeout(closeDropdown, 200);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeDropdown(); input.value = ''; return; }
    if (!dropdown) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlightIndex(Math.min(selectedIndex + 1, currentItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlightIndex(Math.max(selectedIndex - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < currentItems.length) {
        const sel = currentItems[selectedIndex];
        if (sel._create) {
          createAndAddTag(sel.name);
        } else {
          selectItem(sel);
        }
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 29: DETAIL EDITOR — FILE INFO TAB
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/Shared/DetailItem (definition list pattern)

function buildFileInfoTab(ctx, container) {
  // Empty state when no files
  if (!ctx.primaryFile && (!ctx.files || ctx.files.length === 0)) {
    const empty = moEl('div', 'mo-detail-section');
    empty.textContent = 'No files associated with this item.';
    empty.classList.add('mo-detail-empty-state');
    container.appendChild(empty);
    return;
  }

  // File info section
  if (ctx.primaryFile) {
    const fileSection = moEl('div', 'mo-detail-section');
    const fileLbl = moEl('div', 'mo-detail-section-label', { textContent: ctx.files.length > 1 ? 'Primary File' : 'File' });
    fileSection.appendChild(fileLbl);
    const dl = moEl('dl', 'mo-detail-dl');
    dlRow(dl, 'Filename', ctx.primaryFile.basename);
    dlRow(dl, 'Size', formatFileSize(ctx.primaryFile.size));
    if (ctx.fullPath) dlRow(dl, 'Path', ctx.fullPath);
    if (ctx.primaryFile.modTime) dlRow(dl, 'Modified', new Date(ctx.primaryFile.modTime).toLocaleString());
    fileSection.appendChild(dl);
    container.appendChild(fileSection);
  }

  // Additional files (multi-file entities, adapted from stash accordion pattern)
  if (ctx.files && ctx.files.length > 1) {
    const otherFiles = ctx.files.filter(f => f.id !== (ctx.primaryFile && ctx.primaryFile.id));
    for (const file of otherFiles) {
      const fileSection = moEl('div', 'mo-detail-section');
      const fileLbl = moEl('div', 'mo-detail-section-label', { textContent: `File: ${file.basename}` });
      fileSection.appendChild(fileLbl);
      const dl = moEl('dl', 'mo-detail-dl');
      dlRow(dl, 'Size', formatFileSize(file.size));
      if (file.modTime) dlRow(dl, 'Modified', new Date(file.modTime).toLocaleString());
      fileSection.appendChild(dl);
      container.appendChild(fileSection);
    }
  }

  // Image-specific info
  if (ctx.type === 'photo' && ctx.imageFile) {
    buildCameraInfoDL(ctx, container);
  }

  // Video-specific info
  if (ctx.type === 'video' && ctx.videoFile) {
    buildVideoInfoDL(ctx, container);
  }

  // Folder info
  if (ctx.folder) {
    const folderSection = moEl('div', 'mo-detail-section');
    const folderLbl = moEl('div', 'mo-detail-section-label', { textContent: 'Folder' });
    folderSection.appendChild(folderLbl);
    const dl = moEl('dl', 'mo-detail-dl');
    dlRow(dl, 'Path', ctx.folder.path);
    folderSection.appendChild(dl);
    container.appendChild(folderSection);
  }
}

function buildCameraInfoDL(ctx, container) {
  const section = moEl('div', 'mo-detail-section');
  const lbl = moEl('div', 'mo-detail-section-label', { textContent: 'Image Info' });
  section.appendChild(lbl);
  const dl = moEl('dl', 'mo-detail-dl');

  if (ctx.imageFile) {
    dlRow(dl, 'Dimensions', `${ctx.imageFile.width} × ${ctx.imageFile.height}`);
    if (ctx.imageFile.format) dlRow(dl, 'Format', ctx.imageFile.format);
  }

  const e = ctx.entity;
  if (e.cameraMake || e.cameraModel) dlRow(dl, 'Camera', [e.cameraMake, e.cameraModel].filter(Boolean).join(' '));
  if (e.lens) dlRow(dl, 'Lens', e.lens);
  if (e.iso) dlRow(dl, 'ISO', String(e.iso));
  if (e.aperture) dlRow(dl, 'Aperture', `f/${e.aperture}`);
  if (e.shutterSpeed) dlRow(dl, 'Shutter', e.shutterSpeed);
  if (e.focalLength) dlRow(dl, 'Focal Length', `${e.focalLength}mm`);
  if (e.gpsLatitude && e.gpsLongitude) dlRow(dl, 'GPS', `${e.gpsLatitude.toFixed(6)}, ${e.gpsLongitude.toFixed(6)}`);

  section.appendChild(dl);
  container.appendChild(section);
}

function buildVideoInfoDL(ctx, container) {
  const section = moEl('div', 'mo-detail-section');
  const lbl = moEl('div', 'mo-detail-section-label', { textContent: 'Video Info' });
  section.appendChild(lbl);
  const dl = moEl('dl', 'mo-detail-dl');

  if (ctx.videoFile) {
    dlRow(dl, 'Dimensions', `${ctx.videoFile.width} × ${ctx.videoFile.height}`);
    if (ctx.videoFile.codec) dlRow(dl, 'Codec', ctx.videoFile.codec);
    if (ctx.videoFile.bitRate) dlRow(dl, 'Bitrate', formatBitRate(ctx.videoFile.bitRate));
    if (ctx.videoFile.frameRate) dlRow(dl, 'Frame Rate', `${ctx.videoFile.frameRate} fps`);
  }

  if (ctx.entity.duration) dlRow(dl, 'Duration', formatDuration(ctx.entity.duration));

  section.appendChild(dl);
  container.appendChild(section);
}

function dlRow(dl, term, definition) {
  const dt = moEl('dt', null, { textContent: term });
  const dd = moEl('dd', null, { textContent: definition || '—' });
  dl.appendChild(dt);
  dl.appendChild(dd);
}

function formatFileSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatBitRate(bps) {
  if (!bps) return '—';
  if (bps >= 1000000) return (bps / 1000000).toFixed(1) + ' Mbps';
  if (bps >= 1000) return (bps / 1000).toFixed(0) + ' Kbps';
  return bps + ' bps';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 30: AUTO-ALBUM FROM DIRECTORY STRUCTURE (F31)
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/image/scan.go — getOrCreateFolderBasedGallery
// During scan, each folder with media automatically gets an album entry.

const _folderAlbumCache = new Map();
const _folderAlbumInflight = new Map();

async function getOrCreateFolderAlbum(folderId) {
  if (_folderAlbumCache.has(folderId)) return _folderAlbumCache.get(folderId);

  // Dedup concurrent calls for same folderId — prevents duplicate album creation
  if (_folderAlbumInflight.has(folderId)) return _folderAlbumInflight.get(folderId);

  const promise = _getOrCreateFolderAlbumImpl(folderId);
  _folderAlbumInflight.set(folderId, promise);
  try {
    const result = await promise;
    _folderAlbumCache.set(folderId, result);
    return result;
  } finally {
    _folderAlbumInflight.delete(folderId);
  }
}

async function _getOrCreateFolderAlbumImpl(folderId) {
  // Check if album already exists for this folder
  const existing = await AlbumQueries.findMany({ folderId }, {}, { page: 1, perPage: 1 });
  if (existing.items.length > 0) return existing.items[0];

  // Resolve folder path for title
  const folder = await FolderQueries.findById(folderId);
  const folderPath = folder ? folder.path : '';
  const parts = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/);
  const title = parts[parts.length - 1] || folderPath || `Folder ${folderId}`;
  return AlbumQueries.create({ title, folderId });
}

// Associate a media item with its folder's auto-album
// Adapted from stash: pkg/image/scan.go — associateExisting / galleries_images join
async function associateWithFolderAlbum(folderId, entityType, entityId) {
  try {
    const album = await getOrCreateFolderAlbum(folderId);
    if (!album) return;
    if (entityType === 'photo') {
      await AlbumQueries.updatePhotos(album.id, { mode: 'ADD', ids: [entityId] });
    } else if (entityType === 'video') {
      await AlbumQueries.updateVideos(album.id, { mode: 'ADD', ids: [entityId] });
    }
  } catch (err) {
    console.warn('[MO] Auto-album association failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 31: ALBUM EDITOR VIEW (F32)
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/Galleries/GalleryDetails/ — album detail + edit

function renderAlbumEditor(container, api, input) {
  moInjectStyles();
  const root = moEl('div', 'mo-album-editor');
  container.appendChild(root);

  // Parse album:<id> or album:new
  const instanceId = (input && input.id) || '';
  const albumIdStr = instanceId.replace(/^album:/, '');
  const isNew = albumIdStr === 'new';
  const albumId = isNew ? null : parseInt(albumIdStr, 10);

  // Loading state
  const loadingEl = moEl('div', 'mo-detail-loading');
  const spinner = moEl('span', 'mo-spinner');
  spinner.setAttribute('role', 'status');
  loadingEl.appendChild(spinner);
  root.appendChild(loadingEl);

  let album = null;

  async function loadAndRender() {
    try {
      if (isNew) {
        album = { id: null, title: '', description: '', rating: 0, folderId: null, date: null };
      } else {
        album = await AlbumQueries.findById(albumId);
        if (!album) {
          root.innerHTML = '';
          root.appendChild(moEl('div', 'mo-album-empty', { textContent: 'Album not found.' }));
          return;
        }
      }
      root.innerHTML = '';
      buildAlbumUI(root, album, api, isNew);
    } catch (err) {
      root.innerHTML = '';
      root.appendChild(moEl('div', 'mo-album-empty', { textContent: 'Error loading album: ' + err.message }));
    }
  }

  loadAndRender().catch((err) => console.error('[MO-Album] Load error:', err));

  return { dispose() { container.innerHTML = ''; } };
}

function buildAlbumUI(root, album, api, isNew) {
  // Header
  const header = moEl('div', 'mo-album-header');
  const titleEl = moEl('h2', null, { textContent: isNew ? 'New Album' : (album.title || 'Untitled Album') });
  header.appendChild(titleEl);

  if (isNew) {
    const saveBtn = moEl('button', 'mo-toolbar-btn', { textContent: 'Create' });
    saveBtn.addEventListener('click', async () => {
      const titleInput = root.querySelector('.mo-album-title-input');
      const descInput = root.querySelector('.mo-album-desc-input');
      const title = titleInput ? titleInput.value.trim() : '';
      if (!title) { api.window.showWarningMessage('Album title is required.'); return; }
      try {
        const newAlbum = await AlbumQueries.create({ title, description: descInput ? descInput.value : '' });
        api.editors.openEditor({
          typeId: 'media-organizer-grid',
          title: newAlbum.title,
          icon: 'folder-library',
          instanceId: `album:${newAlbum.id}`,
        });
      } catch (err) {
        api.window.showErrorMessage('Failed to create album: ' + err.message);
      }
    });
    header.appendChild(saveBtn);
  } else {
    const deleteBtn = moEl('button', 'mo-toolbar-btn', { textContent: 'Delete', title: 'Delete album' });
    deleteBtn.addEventListener('click', async () => {
      const confirmed = await api.window.showWarningMessage(
        `Delete album "${album.title}"? This cannot be undone.`,
        { modal: true },
        'Delete'
      );
      if (confirmed !== 'Delete') return;
      try {
        await AlbumQueries.destroy(album.id);
        api.window.showInformationMessage(`Album "${album.title}" deleted.`);
        // Replace editor content with deleted message
        root.innerHTML = '';
        root.appendChild(moEl('div', 'mo-album-empty', { textContent: 'Album has been deleted.' }));
      } catch (err) {
        api.window.showErrorMessage('Delete failed: ' + err.message);
      }
    });
    header.appendChild(deleteBtn);
  }
  root.appendChild(header);

  // Body
  const body = moEl('div', 'mo-album-body');
  root.appendChild(body);

  // Title field
  const titleField = moEl('div', 'mo-album-field');
  titleField.appendChild(moEl('label', null, { textContent: 'Title' }));
  const titleInput = moEl('input', 'mo-album-title-input', { type: 'text', value: album.title || '' });
  if (!isNew) {
    let titleTimer = null;
    titleInput.addEventListener('input', () => {
      clearTimeout(titleTimer);
      titleTimer = setTimeout(async () => {
        try {
          await AlbumQueries.update(album.id, { title: titleInput.value });
          titleEl.textContent = titleInput.value || 'Untitled Album';
        } catch (err) { console.error('[MO-Album] Title save failed:', err); }
      }, 800);
    });
  }
  titleField.appendChild(titleInput);
  body.appendChild(titleField);

  // Description field
  const descField = moEl('div', 'mo-album-field');
  descField.appendChild(moEl('label', null, { textContent: 'Description' }));
  const descInput = moEl('textarea', 'mo-album-desc-input');
  descInput.value = album.description || '';
  if (!isNew) {
    let descTimer = null;
    descInput.addEventListener('input', () => {
      clearTimeout(descTimer);
      descTimer = setTimeout(async () => {
        try { await AlbumQueries.update(album.id, { description: descInput.value }); }
        catch (err) { console.error('[MO-Album] Description save failed:', err); }
      }, 800);
    });
  }
  descField.appendChild(descInput);
  body.appendChild(descField);

  // Rating
  if (!isNew) {
    const ratingField = moEl('div', 'mo-album-field');
    ratingField.appendChild(moEl('label', null, { textContent: 'Rating' }));
    const starBar = moEl('div', 'mo-star-bar');
    for (let i = 1; i <= 5; i++) {
      const star = moEl('span', `mo-star${album.rating >= i ? ' active' : ''}`, { textContent: album.rating >= i ? '\u2605' : '\u2606' });
      star.addEventListener('click', async () => {
        const newRating = album.rating === i ? 0 : i;
        try {
          await AlbumQueries.update(album.id, { rating: newRating });
          album.rating = newRating;
          for (const s of starBar.children) {
            const v = parseInt(s.dataset.value, 10);
            s.textContent = newRating >= v ? '\u2605' : '\u2606';
            s.classList.toggle('active', newRating >= v);
          }
        } catch (err) { console.error('[MO-Album] Rating save failed:', err); }
      });
      star.dataset.value = String(i);
      starBar.appendChild(star);
    }
    ratingField.appendChild(starBar);
    body.appendChild(ratingField);
  }

  // Tag editor (reuse pattern from detail editor)
  if (!isNew) {
    const tagField = moEl('div', 'mo-album-field');
    tagField.appendChild(moEl('label', null, { textContent: 'Tags' }));
    const tagContainer = moEl('div', 'mo-detail-tag-editor');
    tagField.appendChild(tagContainer);
    body.appendChild(tagField);

    (async () => {
      try {
        const tags = await AlbumQueries.loadTags(album.id);
        buildTagEditor(tagContainer, tags, 'album', album.id, api);
      } catch (err) { console.error('[MO-Album] Tag load failed:', err); }
    })();
  }

  // Folder info (for auto-albums)
  if (album.folderId) {
    const folderField = moEl('div', 'mo-album-field');
    folderField.appendChild(moEl('label', null, { textContent: 'Source Folder' }));
    (async () => {
      try {
        const folder = await FolderQueries.findById(album.folderId);
        folderField.appendChild(moEl('span', null, { textContent: folder ? folder.path : 'Unknown' }));
      } catch { folderField.appendChild(moEl('span', null, { textContent: 'Unknown' })); }
    })();
    body.appendChild(folderField);
  }

  // Album contents section (F32)
  if (!isNew) {
    body.appendChild(moEl('hr'));
    const contentsLabel = moEl('label', 'mo-album-contents-label', { textContent: 'Contents' });
    body.appendChild(contentsLabel);

    const contentsGrid = moEl('div', 'mo-album-contents-grid');
    body.appendChild(contentsGrid);

    loadAlbumContents(album, contentsGrid, api);
  }
}

async function loadAlbumContents(album, container, api) {
  try {
    const [photos, videos] = await Promise.all([
      AlbumQueries.loadPhotos(album.id),
      AlbumQueries.loadVideos(album.id),
    ]);
    const items = [
      ...photos.map(p => ({ ...p, type: 'photo', _entity: p })),
      ...videos.map(v => ({ ...v, type: 'video', _entity: v })),
    ];

    container.innerHTML = '';
    if (items.length === 0) {
      container.appendChild(moEl('div', 'mo-album-empty', { textContent: 'No items in this album yet.' }));
      return;
    }

    for (const item of items) {
      const miniCard = moEl('div', 'mo-album-mini-card mo-card zoom-0');
      const thumb = moEl('div', 'mo-card-thumb');
      const img = moEl('img');
      img.alt = item.title || '';
      img.loading = 'lazy';
      thumb.appendChild(img);

      // Remove button
      const removeBtn = moEl('button', 'mo-toolbar-btn mo-album-remove-btn', { textContent: '×', title: 'Remove from album' });
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          if (item.type === 'photo') {
            await AlbumQueries.updatePhotos(album.id, { mode: 'REMOVE', ids: [item.id] });
          } else {
            await AlbumQueries.updateVideos(album.id, { mode: 'REMOVE', ids: [item.id] });
          }
          miniCard.remove();
        } catch (err) { console.error('[MO-Album] Remove failed:', err); }
      });
      thumb.appendChild(removeBtn);
      miniCard.appendChild(thumb);

      const info = moEl('div', 'mo-card-info');
      info.appendChild(moEl('div', 'mo-card-title', { textContent: item.title || `${item.type} #${item.id}`, title: item.title || '' }));
      miniCard.appendChild(info);

      miniCard.addEventListener('click', () => {
        api.editors.openEditor({
          typeId: 'media-organizer-grid',
          title: item.title || `${item.type} #${item.id}`,
          icon: item.type === 'video' ? 'file-media' : 'image',
          instanceId: `detail:${item.type}:${item.id}`,
        });
      });

      // Resolve thumbnail
      miniCard._imgEl = img;
      miniCard._thumbEl = thumb;
      if (_api) {
        resolveThumbnailForMiniCard(miniCard, item);
      }

      container.appendChild(miniCard);
    }
  } catch (err) {
    container.innerHTML = '';
    container.appendChild(moEl('div', 'mo-album-empty', { textContent: 'Error loading contents.' }));
  }
}

async function resolveThumbnailForMiniCard(card, item) {
  try {
    const result = await resolveThumbnail(item.type === 'photo' ? 'photo' : 'video', item.id, _api);
    if (result && result.path) {
      const img = card._imgEl;
      if (img) {
        img.src = `file://${result.path.replace(/\\/g, '/')}`;
      }
    }
  } catch { /* thumbnail resolution failure */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 32: BULK OPERATIONS (F33, F34)
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/List/useListSelect, EditGalleriesDialog, MultiSet

function buildSelectionToolbar(container, state, api, refreshFn) {
  // Adapted from stash: FilteredListToolbar — selection mode toolbar
  const bar = moEl('div', 'mo-selection-bar');

  const countEl = moEl('span', 'mo-sel-count');
  bar.appendChild(countEl);

  const selectAllBtn = moEl('button', null, { textContent: 'Select All' });
  selectAllBtn.addEventListener('click', () => {
    for (const item of state.items) {
      state.selectedIds.add(`${item.type}:${item.id}`);
    }
    state.selecting = true;
    updateBar();
    refreshFn();
  });
  bar.appendChild(selectAllBtn);

  const deselectBtn = moEl('button', null, { textContent: 'Deselect All' });
  deselectBtn.addEventListener('click', () => {
    state.selectedIds.clear();
    state.selecting = false;
    updateBar();
    refreshFn();
  });
  bar.appendChild(deselectBtn);

  const invertBtn = moEl('button', null, { textContent: 'Invert' });
  invertBtn.addEventListener('click', () => {
    const newSelection = new Set();
    for (const item of state.items) {
      const key = `${item.type}:${item.id}`;
      if (!state.selectedIds.has(key)) newSelection.add(key);
    }
    state.selectedIds.clear();
    for (const k of newSelection) state.selectedIds.add(k);
    state.selecting = state.selectedIds.size > 0;
    updateBar();
    refreshFn();
  });
  bar.appendChild(invertBtn);

  bar.appendChild(moEl('span', 'mo-sel-spacer'));

  // Bulk Tag button
  const bulkTagBtn = moEl('button', null, { textContent: 'Tag...' });
  bulkTagBtn.addEventListener('click', () => {
    showBulkTagDialog(state, api, () => { updateBar(); refreshFn(); });
  });
  bar.appendChild(bulkTagBtn);

  // Bulk Rating button
  const bulkRatingBtn = moEl('button', null, { textContent: 'Rate...' });
  bulkRatingBtn.addEventListener('click', () => {
    showBulkRatingDialog(state, api, () => { updateBar(); refreshFn(); });
  });
  bar.appendChild(bulkRatingBtn);

  // Add to Album button
  const addToAlbumBtn = moEl('button', null, { textContent: 'Add to Album...' });
  addToAlbumBtn.addEventListener('click', () => {
    showAddToAlbumDialog(state, api, () => { updateBar(); refreshFn(); });
  });
  bar.appendChild(addToAlbumBtn);

  function updateBar() {
    const count = state.selectedIds.size;
    countEl.textContent = `${count} selected`;
    bar.style.display = count > 0 ? 'flex' : 'none';
  }

  updateBar();
  container.appendChild(bar);

  return { update: updateBar, element: bar };
}

// Parse selectedIds set into { photos: [id,...], videos: [id,...] }
function parseSelectedIds(selectedIds) {
  const photos = [];
  const videos = [];
  for (const key of selectedIds) {
    const [type, idStr] = key.split(':');
    const id = parseInt(idStr, 10);
    if (type === 'photo') photos.push(id);
    else if (type === 'video') videos.push(id);
  }
  return { photos, videos };
}

// Adapted from stash: EditGalleriesDialog — bulk tag with Set/Add/Remove modes
function showBulkTagDialog(state, api, onComplete) {
  const overlay = moEl('div', 'mo-bulk-dialog-overlay');
  const dialog = moEl('div', 'mo-bulk-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Bulk Tag');
  overlay.appendChild(dialog);

  dialog.appendChild(moEl('h3', null, { textContent: `Bulk Tag (${state.selectedIds.size} items)` }));

  // Mode selector (Add / Remove)
  // Adapted from stash: MultiSet — BulkUpdateIdMode buttons
  const modeSection = moEl('div', 'mo-bulk-dialog-section');
  modeSection.appendChild(moEl('label', null, { textContent: 'Mode' }));
  const modeBtns = moEl('div', 'mo-bulk-mode-btns');
  let mode = 'ADD';
  const addBtn = moEl('button', 'active', { textContent: 'Add' });
  const removeBtn = moEl('button', null, { textContent: 'Remove' });
  addBtn.addEventListener('click', () => { mode = 'ADD'; addBtn.classList.add('active'); removeBtn.classList.remove('active'); });
  removeBtn.addEventListener('click', () => { mode = 'REMOVE'; removeBtn.classList.add('active'); addBtn.classList.remove('active'); });
  modeBtns.append(addBtn, removeBtn);
  modeSection.appendChild(modeBtns);
  dialog.appendChild(modeSection);

  // Tag selector
  const tagSection = moEl('div', 'mo-bulk-dialog-section');
  tagSection.appendChild(moEl('label', null, { textContent: 'Tag' }));
  const tagSelect = moEl('select');
  tagSelect.appendChild(moEl('option', null, { value: '', textContent: 'Select a tag...' }));
  tagSection.appendChild(tagSelect);
  dialog.appendChild(tagSection);

  // Load tags
  TagQueries.findMany({}, { field: 'name', direction: 'ASC' }, { page: 1, perPage: 500 })
    .then(result => {
      for (const tag of result.items) {
        tagSelect.appendChild(moEl('option', null, { value: String(tag.id), textContent: tag.name }));
      }
    })
    .catch(() => {});

  // Footer
  const footer = moEl('div', 'mo-bulk-dialog-footer');
  const cancelBtn = moEl('button', null, { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  const applyBtn = moEl('button', 'primary', { textContent: 'Apply' });
  applyBtn.addEventListener('click', async () => {
    const tagId = parseInt(tagSelect.value, 10);
    if (!tagId) { api.window.showWarningMessage('Please select a tag.'); return; }
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
    const { photos, videos } = parseSelectedIds(state.selectedIds);
    try {
      const txnOps = [];
      for (const photoId of photos) {
        if (mode === 'ADD') {
          txnOps.push({ type: 'run', sql: 'INSERT OR IGNORE INTO mo_photos_tags (photo_id, tag_id) VALUES (?, ?)', params: [photoId, tagId] });
        } else {
          txnOps.push({ type: 'run', sql: 'DELETE FROM mo_photos_tags WHERE photo_id = ? AND tag_id = ?', params: [photoId, tagId] });
        }
      }
      for (const videoId of videos) {
        if (mode === 'ADD') {
          txnOps.push({ type: 'run', sql: 'INSERT OR IGNORE INTO mo_videos_tags (video_id, tag_id) VALUES (?, ?)', params: [videoId, tagId] });
        } else {
          txnOps.push({ type: 'run', sql: 'DELETE FROM mo_videos_tags WHERE video_id = ? AND tag_id = ?', params: [videoId, tagId] });
        }
      }
      if (txnOps.length > 0) await db.transaction(txnOps);
      api.window.showInformationMessage(`Tags ${mode === 'ADD' ? 'added to' : 'removed from'} ${photos.length + videos.length} items.`);
      overlay.remove();
      onComplete();
    } catch (err) {
      applyBtn.disabled = false;
      cancelBtn.disabled = false;
      applyBtn.textContent = 'Apply';
      api.window.showErrorMessage('Bulk tag failed: ' + err.message);
    }
  });
  footer.append(cancelBtn, applyBtn);
  dialog.appendChild(footer);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.setAttribute('tabindex', '-1');
  overlay.focus();
}

function showBulkRatingDialog(state, api, onComplete) {
  const overlay = moEl('div', 'mo-bulk-dialog-overlay');
  const dialog = moEl('div', 'mo-bulk-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Set Rating');
  overlay.appendChild(dialog);

  dialog.appendChild(moEl('h3', null, { textContent: `Set Rating (${state.selectedIds.size} items)` }));

  const ratingSection = moEl('div', 'mo-bulk-dialog-section');
  ratingSection.appendChild(moEl('label', null, { textContent: 'Rating' }));
  const starBar = moEl('div', 'mo-star-bar');
  let selectedRating = 0;
  for (let i = 1; i <= 5; i++) {
    const star = moEl('span', 'mo-star', { textContent: '\u2606' });
    star.dataset.value = String(i);
    star.addEventListener('click', () => {
      selectedRating = selectedRating === i ? 0 : i;
      for (const s of starBar.children) {
        const v = parseInt(s.dataset.value, 10);
        s.textContent = selectedRating >= v ? '\u2605' : '\u2606';
        s.classList.toggle('active', selectedRating >= v);
      }
    });
    starBar.appendChild(star);
  }
  ratingSection.appendChild(starBar);
  dialog.appendChild(ratingSection);

  const footer = moEl('div', 'mo-bulk-dialog-footer');
  const cancelBtn = moEl('button', null, { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  const applyBtn = moEl('button', 'primary', { textContent: 'Apply' });
  applyBtn.addEventListener('click', async () => {
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
    const { photos, videos } = parseSelectedIds(state.selectedIds);
    try {
      const txnOps = [];
      for (const id of photos) {
        txnOps.push({ type: 'run', sql: 'UPDATE mo_photos SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', params: [selectedRating, id] });
      }
      for (const id of videos) {
        txnOps.push({ type: 'run', sql: 'UPDATE mo_videos SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', params: [selectedRating, id] });
      }
      if (txnOps.length > 0) await db.transaction(txnOps);
      api.window.showInformationMessage(`Rating set to ${selectedRating} for ${photos.length + videos.length} items.`);
      overlay.remove();
      onComplete();
    } catch (err) {
      applyBtn.disabled = false;
      cancelBtn.disabled = false;
      applyBtn.textContent = 'Apply';
      api.window.showErrorMessage('Bulk rating failed: ' + err.message);
    }
  });
  footer.append(cancelBtn, applyBtn);
  dialog.appendChild(footer);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.setAttribute('tabindex', '-1');
  overlay.focus();
}

function showAddToAlbumDialog(state, api, onComplete) {
  const overlay = moEl('div', 'mo-bulk-dialog-overlay');
  const dialog = moEl('div', 'mo-bulk-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Add to Album');
  overlay.appendChild(dialog);

  dialog.appendChild(moEl('h3', null, { textContent: `Add to Album (${state.selectedIds.size} items)` }));

  const albumSection = moEl('div', 'mo-bulk-dialog-section');
  albumSection.appendChild(moEl('label', null, { textContent: 'Album' }));
  const albumSelect = moEl('select');
  albumSelect.appendChild(moEl('option', null, { value: '', textContent: 'Select an album...' }));
  albumSection.appendChild(albumSelect);
  dialog.appendChild(albumSection);

  // Load albums (manual collections only — folderId IS NULL)
  AlbumQueries.findMany({ folderId: null }, { field: 'title', direction: 'ASC' }, { page: 1, perPage: 500 })
    .then(result => {
      for (const album of result.items) {
        albumSelect.appendChild(moEl('option', null, { value: String(album.id), textContent: album.title || `Album #${album.id}` }));
      }
    })
    .catch(() => {});

  const footer = moEl('div', 'mo-bulk-dialog-footer');
  const cancelBtn = moEl('button', null, { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  const applyBtn = moEl('button', 'primary', { textContent: 'Add' });
  applyBtn.addEventListener('click', async () => {
    const albumId = parseInt(albumSelect.value, 10);
    if (!albumId) { api.window.showWarningMessage('Please select an album.'); return; }
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    applyBtn.textContent = 'Adding…';
    const { photos, videos } = parseSelectedIds(state.selectedIds);
    try {
      if (photos.length > 0) await AlbumQueries.updatePhotos(albumId, { mode: 'ADD', ids: photos });
      if (videos.length > 0) await AlbumQueries.updateVideos(albumId, { mode: 'ADD', ids: videos });
      api.window.showInformationMessage(`${photos.length + videos.length} items added to album.`);
      overlay.remove();
      onComplete();
    } catch (err) {
      applyBtn.disabled = false;
      cancelBtn.disabled = false;
      applyBtn.textContent = 'Add';
      api.window.showErrorMessage('Add to album failed: ' + err.message);
    }
  });
  footer.append(cancelBtn, applyBtn);
  dialog.appendChild(footer);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.setAttribute('tabindex', '-1');
  overlay.focus();
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

  // D5: Grid Browser
  moInjectStyles();

  _commandDisposables.push(
    api.views.registerViewProvider('mediaOrganizer.browser', {
      createView(container) {
        return renderBrowserSidebar(container, api);
      },
    })
  );

  _commandDisposables.push(
    api.editors.registerEditorProvider('media-organizer-grid', {
      createEditorPane(container, input) {
        const inputId = (input && input.id) || '';
        if (inputId.startsWith('detail:')) {
          return renderDetailEditor(container, api, input);
        }
        if (inputId.startsWith('album:')) {
          return renderAlbumEditor(container, api, input);
        }
        return renderGridBrowser(container, api, input);
      },
    })
  );

  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.openGrid', () => {
      api.editors.openEditor({
        typeId: 'media-organizer-grid',
        title: 'Media Library',
        icon: 'image',
        instanceId: 'grid:all',
      });
    })
  );

  // D8: Create Album command
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.createAlbum', () => {
      api.editors.openEditor({
        typeId: 'media-organizer-grid',
        title: 'New Album',
        icon: 'folder-library',
        instanceId: 'album:new',
      });
    })
  );

  console.log('[MediaOrganizer] Activated — D1-D8 ready (data, scan, thumbnails, tags, grid, filter, detail, albums)');
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
  _folderAlbumCache.clear();
  _folderAlbumInflight.clear();
  _api = null;
  const moStyleEl = document.getElementById('media-organizer-styles');
  if (moStyleEl) moStyleEl.remove();
  _moStyleInjected = false;
  _activated = false;
  console.log('[MediaOrganizer] Deactivated');
}
