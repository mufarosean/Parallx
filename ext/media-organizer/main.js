// Media Organizer — Parallx Extension
// Organize photos and videos with tags, albums, and EXIF metadata.
// All data lives in a per-extension isolated SQLite database at
// <workspace>/.parallx/extensions/media-organizer/data.db.
//
// Single-file constraint: Parallx loads extensions via blob URL, so all JS
// must live in this file. SQL migrations are separate (read by main process).
//
// Upstream reference: github.com/stashapp/stash

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: DATABASE WRAPPER
// ═══════════════════════════════════════════════════════════════════════════════
// Convenience layer over api.database that unwraps the
// { error, ... } envelope and throws on failure.
// Late-bound: _dbBridge is set during activate() from api.database.

let _dbBridge = null;

const db = {
  async run(sql, params = []) {
    const res = await _dbBridge.run(sql, params);
    if (res.error) throw new Error(`[MO-DB] ${res.error.message}`);
    return res;
  },
  async get(sql, params = []) {
    const res = await _dbBridge.get(sql, params);
    if (res.error) throw new Error(`[MO-DB] ${res.error.message}`);
    return res.row ?? null;
  },
  async all(sql, params = []) {
    const res = await _dbBridge.all(sql, params);
    if (res.error) throw new Error(`[MO-DB] ${res.error.message}`);
    return res.rows ?? [];
  },
  async transaction(ops) {
    const res = await _dbBridge.runTransaction(ops);
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
  const perPage = Math.max(1, Math.min(5000, pagination.perPage || 25));
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

  // M59: detect webp for later conversion. Animated -> gif, static -> jpg.
  const isWebp = entry.fileType === 'image' && /\.webp$/i.test(entry.path);
  let webpTarget = null; // 'gif' | 'jpg' | null
  if (isWebp) {
    webpTarget = (await isWebPAnimated(entry.path)) ? 'gif' : 'jpg';
    console.log(`[MediaOrganizer] WebP detected: ${entry.name} -> ${webpTarget}`);
  }
  const needsConversion = webpTarget ? 1 : 0;

  const txnOps = [
    { type: 'run',
      sql: `INSERT INTO mo_files (basename, size, mod_time, folder_id, needs_conversion, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
      params: [entry.name, entry.size, entry.mtime, entry.folderId, needsConversion] },
  ];

  const txnResult = await db.transaction(txnOps);
  const fileId = txnResult[0].lastInsertRowid;

  // M59 P2: queue for auto-convert after scan if it's a WebP
  if (webpTarget) _newWebPConversions.push({ id: fileId, target: webpTarget });

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
  if (isInternalPath(rootPath)) {
    api.window.showWarningMessage('Cannot scan internal .parallx directories.');
    return null;
  }

  const startTime = Date.now();
  _scanRunning = true;
  _scanCancelled = false;
  _newWebPConversions = [];

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

    // Record scan root so we can watch it for changes
    if (!stats.cancelled) {
      await recordScanRoot(rootPath);
      startWatcherForRoot(rootPath);
    }

    // Refresh sidebar sections (folders, tags, albums)
    _notifySidebarRefresh();

    // M59 P2: process animated WebP queue (auto/suggest/off)
    if (!stats.cancelled) {
      moAutoConvertWebPAfterScan(api).catch(err => {
        console.warn('[MediaOrganizer] auto webp post-scan failed:', err);
      });
    }

    // M59 P3: rebuild FTS search index (best-effort)
    if (!stats.cancelled) {
      moRebuildSearchIndex().catch(err => {
        console.warn('[MediaOrganizer] FTS rebuild post-scan failed:', err);
      });
    }
  }
}

function cancelScan() {
  if (_scanRunning) _scanCancelled = true;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 17B: FILE WATCHER & AUTO-SCAN
// ═══════════════════════════════════════════════════════════════════════════════
// After the first manual scan, we watch scanned directories for changes and
// auto-scan new/modified/deleted files incrementally. On relaunch we also run
// a delta scan to catch anything that changed while the app was closed.

/** Reject any path that passes through .parallx (thumbnails, extensions data, etc.) */
function isInternalPath(filePath) {
  return /[\/\\]\.parallx[\/\\]/i.test(filePath) || filePath.endsWith('.parallx');
}

/** @type {Map<string, { watchId: string, unsubscribe: () => void }>} */
const _activeMediaWatchers = new Map();

let _watcherProcessing = false;
let _watcherQueue = [];
let _watcherDebounceTimer = null;
const WATCHER_BATCH_DELAY_MS = 500;

// ── Scan root persistence ──

async function recordScanRoot(rootPath) {
  try {
    await db.run(
      `INSERT INTO mo_scan_roots (path, last_scan_at) VALUES (?, datetime('now'))
       ON CONFLICT(path) DO UPDATE SET last_scan_at = datetime('now')`,
      [rootPath]
    );
  } catch (err) {
    console.warn('[MediaOrganizer] Failed to record scan root:', err);
  }
}

async function getScanRoots() {
  try {
    return await db.all('SELECT * FROM mo_scan_roots ORDER BY path ASC');
  } catch {
    return [];
  }
}

// ── Incremental processing ──

async function processIncrementalCreate(filePath) {
  if (isInternalPath(filePath)) return null;
  const sep = _isWindows ? '\\' : '/';
  const lastSep = filePath.lastIndexOf(sep);
  const dirPath = lastSep > 0 ? filePath.slice(0, lastSep) : filePath;
  const fileName = lastSep > 0 ? filePath.slice(lastSep + 1) : filePath;

  const fileType = classifyFile(fileName);
  if (!fileType) return null;

  // Stat to get size/mtime
  const statResult = await window.parallxElectron.fs.stat(filePath);
  if (statResult.error) return null;
  if (statResult.size < SCAN_DEFAULTS.minFileSize) return null;

  const folder = await FolderQueries.findOrCreate(dirPath);
  const entry = {
    path: filePath,
    name: fileName,
    size: statResult.size,
    mtime: statResult.mtime,
    fileType,
    folderId: folder.id,
  };

  return processFile(entry);
}

async function processIncrementalDelete(filePath) {
  if (isInternalPath(filePath)) return null;
  const sep = _isWindows ? '\\' : '/';
  const lastSep = filePath.lastIndexOf(sep);
  const dirPath = lastSep > 0 ? filePath.slice(0, lastSep) : filePath;
  const fileName = lastSep > 0 ? filePath.slice(lastSep + 1) : filePath;

  if (!classifyFile(fileName)) return null;

  const folder = await FolderQueries.findByPath(dirPath);
  if (!folder) return null;

  const file = await FileQueries.findByFolderAndName(folder.id, fileName);
  if (!file) return null;

  // Remove domain entity links and the file record
  const photoLink = await db.get('SELECT photo_id FROM mo_photos_files WHERE file_id = ?', [file.id]);
  if (photoLink) {
    await db.run('DELETE FROM mo_photos_files WHERE file_id = ?', [file.id]);
    // If no other files linked to this photo, remove the photo too
    const otherLinks = await db.get('SELECT COUNT(*) as cnt FROM mo_photos_files WHERE photo_id = ?', [photoLink.photo_id]);
    if (!otherLinks || otherLinks.cnt === 0) {
      await db.run('DELETE FROM mo_photos WHERE id = ?', [photoLink.photo_id]);
    }
  }
  const videoLink = await db.get('SELECT video_id FROM mo_videos_files WHERE file_id = ?', [file.id]);
  if (videoLink) {
    await db.run('DELETE FROM mo_videos_files WHERE file_id = ?', [file.id]);
    const otherLinks = await db.get('SELECT COUNT(*) as cnt FROM mo_videos_files WHERE video_id = ?', [videoLink.video_id]);
    if (!otherLinks || otherLinks.cnt === 0) {
      await db.run('DELETE FROM mo_videos WHERE id = ?', [videoLink.video_id]);
    }
  }

  await db.run('DELETE FROM mo_fingerprints WHERE file_id = ?', [file.id]);
  await db.run('DELETE FROM mo_files WHERE id = ?', [file.id]);

  return { action: 'deleted', fileId: file.id };
}

// ── Batched watcher event processor ──

async function drainWatcherQueue() {
  if (_watcherProcessing || _watcherQueue.length === 0) return;
  _watcherProcessing = true;

  const batch = _watcherQueue.splice(0);
  let created = 0, updated = 0, deleted = 0, errors = 0;

  try {
    // Ensure tools are detected for metadata extraction
    await detectAllTools();

    for (const evt of batch) {
      try {
        if (evt.type === 'deleted') {
          const result = await processIncrementalDelete(evt.path);
          if (result) deleted++;
        } else {
          // 'created' or 'changed' — upsert via processFile
          const result = await processIncrementalCreate(evt.path);
          if (result) {
            if (result.action === 'created') created++;
            else if (result.action === 'updated') updated++;
          }
        }
      } catch (err) {
        console.warn(`[MediaOrganizer] Watcher: error processing ${evt.path}:`, err);
        errors++;
      }
    }

    if (created + updated + deleted > 0) {
      console.log(`[MediaOrganizer] Auto-scan: ${created} new, ${updated} updated, ${deleted} removed`);
      _notifySidebarRefresh();
    }
    // M59: process any WebP files queued during this watcher batch
    if (_newWebPConversions.length > 0 && _api) {
      moAutoConvertWebPAfterScan(_api).catch((err) =>
        console.warn('[MediaOrganizer] watcher webp auto-convert failed:', err)
      );
    }
  } finally {
    _watcherProcessing = false;
    // If more events arrived while processing, drain again
    if (_watcherQueue.length > 0) {
      drainWatcherQueue();
    }
  }
}

function enqueueWatcherEvent(evt) {
  _watcherQueue.push(evt);
  if (_watcherDebounceTimer) clearTimeout(_watcherDebounceTimer);
  _watcherDebounceTimer = setTimeout(() => {
    _watcherDebounceTimer = null;
    drainWatcherQueue();
  }, WATCHER_BATCH_DELAY_MS);
}

// ── Watcher lifecycle ──

function startWatcherForRoot(rootPath) {
  if (_activeMediaWatchers.has(rootPath)) return; // already watching

  const fsApi = window.parallxElectron.fs;
  fsApi.watch(rootPath, { recursive: true }).then(({ watchId, error }) => {
    if (error) {
      console.warn(`[MediaOrganizer] Could not watch ${rootPath}:`, error.message);
      return;
    }

    const unsubscribe = fsApi.onDidChange((payload) => {
      if (payload.watchId !== watchId) return;
      if (payload.error) {
        console.warn('[MediaOrganizer] Watcher error:', payload.error);
        return;
      }
      for (const evt of payload.events) {
        // Skip internal .parallx paths (thumbnails, extension data)
        if (isInternalPath(evt.path)) continue;
        // Only care about media files
        const fileName = evt.path.split(/[/\\]/).pop();
        if (!classifyFile(fileName)) continue;
        enqueueWatcherEvent(evt);
      }
    });

    _activeMediaWatchers.set(rootPath, { watchId, unsubscribe });
    console.log(`[MediaOrganizer] Watching ${rootPath} (${watchId})`);
  });
}

function stopAllWatchers() {
  const fsApi = window.parallxElectron.fs;
  for (const [rootPath, entry] of _activeMediaWatchers) {
    entry.unsubscribe();
    fsApi.unwatch(entry.watchId).catch(() => {});
    console.log(`[MediaOrganizer] Stopped watching ${rootPath}`);
  }
  _activeMediaWatchers.clear();
  _watcherQueue = [];
  if (_watcherDebounceTimer) { clearTimeout(_watcherDebounceTimer); _watcherDebounceTimer = null; }
}

// ── Delta scan on relaunch ──
// Compares filesystem state against DB for all scanned roots.
// Detects new files, modified files (mtime changed), and deleted files.

async function runDeltaScan(api) {
  const roots = await getScanRoots();
  if (roots.length === 0) return;

  await detectAllTools();

  let totalCreated = 0, totalUpdated = 0, totalDeleted = 0;

  for (const root of roots) {
    const rootPath = root.path;

    // Check root still exists
    const rootExists = await window.parallxElectron.fs.exists(rootPath);
    if (!rootExists) {
      console.warn(`[MediaOrganizer] Scan root no longer exists: ${rootPath}`);
      continue;
    }

    try {
      // Walk current filesystem state
      const currentEntries = await walkDirectory(rootPath, {
        excludePatterns: SCAN_DEFAULTS.excludePatterns,
        minFileSize: SCAN_DEFAULTS.minFileSize,
      }, () => {});

      // Build set of current paths for fast lookup
      const currentPathSet = new Set(currentEntries.map(e => e.path));

      // Find DB files under this root that no longer exist on disk
      const sep = _isWindows ? '\\' : '/';
      const rootPrefix = rootPath.endsWith(sep) ? rootPath : rootPath + sep;
      const allFolders = await db.all(
        `SELECT id, path FROM mo_folders WHERE path = ? OR path LIKE ?`,
        [rootPath, rootPrefix + '%']
      );
      const folderIds = allFolders.map(f => f.id);

      if (folderIds.length > 0) {
        const placeholders = folderIds.map(() => '?').join(',');
        const dbFiles = await db.all(
          `SELECT f.id, f.basename, fo.path AS folder_path
           FROM mo_files f JOIN mo_folders fo ON f.folder_id = fo.id
           WHERE f.folder_id IN (${placeholders})`,
          folderIds
        );

        for (const dbFile of dbFiles) {
          const fullPath = dbFile.folder_path + sep + dbFile.basename;
          if (!currentPathSet.has(fullPath)) {
            // File was deleted while app was closed
            const result = await processIncrementalDelete(fullPath);
            if (result) totalDeleted++;
          }
        }
      }

      // Process all current entries through processFile (it handles skip/update logic)
      for (const entry of currentEntries) {
        if (_scanCancelled) break;
        try {
          const result = await processFile(entry);
          if (result.action === 'created') totalCreated++;
          else if (result.action === 'updated') totalUpdated++;
        } catch (err) {
          console.warn(`[MediaOrganizer] Delta scan error on ${entry.path}:`, err);
        }
      }

      // Update last_scan_at
      await recordScanRoot(rootPath);
    } catch (err) {
      console.warn(`[MediaOrganizer] Delta scan failed for ${rootPath}:`, err);
    } finally {
      _folderIdCache.clear();
      _folderAlbumCache.clear();
      _folderAlbumInflight.clear();
    }
  }

  if (totalCreated + totalUpdated + totalDeleted > 0) {
    console.log(`[MediaOrganizer] Delta scan: ${totalCreated} new, ${totalUpdated} updated, ${totalDeleted} removed`);
    if (api) {
      api.window.showInformationMessage(
        `Media auto-scan: ${totalCreated} new, ${totalUpdated} updated, ${totalDeleted} removed`
      );
    }
    _notifySidebarRefresh();
  } else {
    console.log('[MediaOrganizer] Delta scan: no changes detected');
  }
}

// ── Startup: resume watchers + delta scan ──

async function resumeWatchersAndDeltaScan(api) {
  const roots = await getScanRoots();
  if (roots.length === 0) return; // No prior scans — nothing to watch

  // Start watchers for all known roots
  for (const root of roots) {
    const exists = await window.parallxElectron.fs.exists(root.path);
    if (exists) startWatcherForRoot(root.path);
  }

  // Run delta scan in background (non-blocking)
  runDeltaScan(api).catch(err => {
    console.warn('[MediaOrganizer] Background delta scan failed:', err);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 18: THUMBNAIL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: pkg/models/model_gallery.go — DefaultGthumbWidth
// Adapted from stash: pkg/models/paths/paths_generated.go — sharding constants
// Adapted from stash: pkg/image/thumbnail.go — quality settings

const THUMB_MAX_SIZE = 1536;       // Sharp at 800px zoom on 2x HiDPI displays
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
    seekSec = 0;
  }

  // Try ffmpeg first (preferred — handles all codecs, fast seek)
  if (_toolPaths.ffmpeg) {
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
      const result = await window.parallxElectron.terminal.exec(cmd, { timeout: 30000 });
      if (result.exitCode === 0) {
        const valid = await validateThumbnailFile(tempPath);
        if (valid) {
          const readResult = await window.parallxElectron.fs.readFile(tempPath);
          if (!readResult.error) {
            const writeResult = await window.parallxElectron.fs.writeFile(
              coverPath, readResult.content, readResult.encoding || 'base64'
            );
            await window.parallxElectron.fs.delete(tempPath).catch(() => {});
            if (!writeResult.error) {
              return { generated: true, path: coverPath, encoder: 'ffmpeg' };
            }
            await window.parallxElectron.fs.delete(coverPath).catch(() => {});
          } else {
            await window.parallxElectron.fs.delete(tempPath).catch(() => {});
          }
        }
      } else {
        if (result.stderr) console.debug('[MediaOrganizer] ffmpeg cover stderr:', result.stderr);
        await window.parallxElectron.fs.delete(tempPath).catch(() => {});
      }
    } catch (err) {
      console.warn('[MediaOrganizer] ffmpeg cover failed, trying canvas fallback:', err);
      await window.parallxElectron.fs.delete(tempPath).catch(() => {});
    }
  }

  // Canvas fallback — load video in <video> element, seek, draw frame to canvas
  // Works for browser-supported codecs (mp4/h264, webm/vp8/vp9) without external tools
  try {
    const url = await localFileToUrl(filePath);
    if (!url) return { generated: false, path: null, encoder: null };

    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';

    const frameUrl = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('video load timeout')); }, 15000);
      video.addEventListener('error', () => { clearTimeout(timeout); reject(new Error('video load error')); });
      video.addEventListener('loadedmetadata', () => {
        // Seek to 20% or provided timestamp
        video.currentTime = seekSec > 0 ? seekSec : Math.min(video.duration * COVER_TIMESTAMP_PERCENT, video.duration);
      });
      video.addEventListener('seeked', async () => {
        clearTimeout(timeout);
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          if (!vw || !vh) { reject(new Error('no video dimensions')); return; }
          const scale = Math.min(THUMB_MAX_SIZE / vw, THUMB_MAX_SIZE / vh, 1);
          const w = Math.round(vw * scale);
          const h = Math.round(vh * scale);
          const canvas = new OffscreenCanvas(w, h);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);
          const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
          const arrayBuffer = await blob.arrayBuffer();
          const uint8 = new Uint8Array(arrayBuffer);
          let binary = '';
          for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
          resolve(btoa(binary));
        } catch (e) { reject(e); }
      });
      video.src = url;
    });

    const writeResult = await window.parallxElectron.fs.writeFile(coverPath, frameUrl, 'base64');
    if (!writeResult.error) {
      return { generated: true, path: coverPath, encoder: 'canvas' };
    }
  } catch (err) {
    console.warn('[MediaOrganizer] Canvas video cover failed:', err);
  }

  return { generated: false, path: null, encoder: null };
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

  // Animated image detection — GIFs and animated WebPs get a first-frame
  // thumbnail via canvas instead of being skipped entirely.
  const animated = isAnimatedGif(filePath) || await isWebPAnimated(filePath);

  // Adapted from stash: task_generate_image_thumbnail.go — required()
  if (!animated && !isThumbnailRequired(width, height)) {
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

  // Animated images go straight to canvas (renders first frame only)
  if (animated) {
    const ok = await generateThumbCanvas(filePath, thumbPath, THUMB_MAX_SIZE);
    if (ok) return { generated: true, path: thumbPath, encoder: 'canvas' };
    return { generated: false, path: null, encoder: null };
  }

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

  // Compute source file path early — needed for GIF detection
  const sep = _isWindows ? '\\' : '/';
  const sourceFilePath = row.folder_path + sep + row.basename;
  // For GIFs, include the original source path so the grid can show the animation
  const gifSource = isAnimatedGif(sourceFilePath) ? sourceFilePath : undefined;

  // Fast path: check if thumbnail already exists on disk and is valid
  // Adapted from stash: serveThumbnail — exists check before generation
  const thumbPath = getThumbnailPath(thumbDir, row.checksum, THUMB_MAX_SIZE);
  const valid = await validateCachedThumbnail(thumbPath);
  if (valid) return { path: thumbPath, status: 'cached', sourcePath: gifSource };

  // Lazy generation: ensure tools are available, then generate under semaphore
  await detectAllTools();
  await _thumbSemaphore.acquire();
  try {
    // Double-check after acquiring semaphore (another call may have generated it)
    const validNow = await validateCachedThumbnail(thumbPath);
    if (validNow) return { path: thumbPath, status: 'cached', sourcePath: gifSource };

    const result = await generateImageThumbnail(
      row.checksum, sourceFilePath, row.width || 0, row.height || 0, api
    );

    if (result.generated) return { path: result.path, status: 'generated', sourcePath: gifSource };
    if (result.encoder === 'skip_small' || result.encoder === 'skip_animated') {
      return { path: null, status: 'skip', sourcePath: gifSource };
    }
    if (result.encoder === 'cached') return { path: result.path, status: 'cached', sourcePath: gifSource };
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

/**
 * Custom dropdown component — mirrors src/ui/dropdown.ts API but works standalone.
 * Returns { el, getValue, setValue, setItems, onChange, dispose }
 */
function moDropdown(options = {}) {
  const { items = [], selected, placeholder = '', ariaLabel = '', className = '' } = options;
  let _items = [...items];
  let _selectedValue = selected ?? '';
  let _isOpen = false;
  let _focusedIndex = -1;
  let _onChangeFn = null;

  const wrapper = moEl('div', `mo-dropdown ${className}`.trim());
  const button = moEl('button', 'mo-dropdown__button', { type: 'button' });
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);

  const textSpan = moEl('span', 'mo-dropdown__text');
  const chevron = moEl('span', 'mo-dropdown__chevron', { textContent: '\u25BE' });
  button.append(textSpan, chevron);
  wrapper.appendChild(button);

  const list = moEl('div', 'mo-dropdown__list');
  list.setAttribute('role', 'listbox');
  wrapper.appendChild(list);

  function updateText() {
    const item = _items.find(i => i.value === _selectedValue);
    textSpan.textContent = item ? item.label : placeholder;
  }

  function renderItems() {
    list.innerHTML = '';
    _items.forEach((item) => {
      const el = moEl('div', 'mo-dropdown__item');
      el.textContent = item.label;
      el.dataset.value = item.value;
      el.setAttribute('role', 'option');
      if (item.value === _selectedValue) {
        el.classList.add('mo-dropdown__item--selected');
        el.setAttribute('aria-selected', 'true');
      }
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        selectValue(item.value);
        close();
      });
      list.appendChild(el);
    });
  }

  function updateSelectedClass() {
    for (const el of list.children) {
      const isSelected = el.dataset.value === _selectedValue;
      el.classList.toggle('mo-dropdown__item--selected', isSelected);
      el.setAttribute('aria-selected', String(isSelected));
    }
  }

  function selectValue(value) {
    if (_selectedValue === value) return;
    _selectedValue = value;
    updateText();
    updateSelectedClass();
    if (_onChangeFn) _onChangeFn(value);
  }

  function open() {
    _isOpen = true;
    wrapper.classList.add('mo-dropdown--open');
    button.setAttribute('aria-expanded', 'true');
    _focusedIndex = _items.findIndex(i => i.value === _selectedValue);
    updateFocusedClass();
    // Auto-flip: open upward if not enough space below
    requestAnimationFrame(() => {
      const btnRect = button.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const spaceBelow = window.innerHeight - btnRect.bottom;
      if (spaceBelow < listRect.height && btnRect.top > listRect.height) {
        wrapper.classList.add('mo-dropdown--up');
      } else {
        wrapper.classList.remove('mo-dropdown--up');
      }
    });
  }

  function close() {
    _isOpen = false;
    wrapper.classList.remove('mo-dropdown--open');
    wrapper.classList.remove('mo-dropdown--up');
    button.setAttribute('aria-expanded', 'false');
    _focusedIndex = -1;
    updateFocusedClass();
  }

  function updateFocusedClass() {
    Array.from(list.children).forEach((el, idx) => {
      el.classList.toggle('mo-dropdown__item--focused', idx === _focusedIndex);
    });
  }

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    if (_isOpen) close(); else open();
  });

  wrapper.addEventListener('keydown', (e) => {
    if (!_isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); e.stopPropagation();
        open();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault(); e.stopPropagation();
        _focusedIndex = Math.min(_focusedIndex + 1, _items.length - 1);
        updateFocusedClass();
        break;
      case 'ArrowUp':
        e.preventDefault(); e.stopPropagation();
        _focusedIndex = Math.max(_focusedIndex - 1, 0);
        updateFocusedClass();
        break;
      case 'Enter': case ' ':
        e.preventDefault(); e.stopPropagation();
        if (_focusedIndex >= 0 && _focusedIndex < _items.length) {
          selectValue(_items[_focusedIndex].value);
        }
        close();
        break;
      case 'Escape':
        e.preventDefault(); e.stopPropagation();
        close();
        break;
    }
  });

  const outsideHandler = (e) => {
    if (_isOpen && !wrapper.contains(e.target)) close();
  };
  document.addEventListener('mousedown', outsideHandler, true);

  renderItems();
  updateText();

  return {
    el: wrapper,
    getValue() { return _selectedValue; },
    setValue(v) { _selectedValue = v; updateText(); updateSelectedClass(); },
    setItems(newItems) { _items = [...newItems]; renderItems(); updateText(); },
    set onChange(fn) { _onChangeFn = fn; },
    dispose() { document.removeEventListener('mousedown', outsideHandler, true); },
  };
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
  min-height: 0;
  overflow-y: auto;
  position: relative;
  user-select: none;
}
.mo-rubber-band {
  display: none;
  position: absolute;
  border: 1px solid var(--vscode-focusBorder, #9333ea);
  background: rgba(147, 51, 234, 0.15);
  pointer-events: none;
  z-index: 10;
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
.mo-toolbar-search:focus { border-color: var(--vscode-focusBorder, #9333ea); }
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
.mo-toolbar-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, #9333ea); outline-offset: -1px; }
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

/* ═══ Grid ═══ */
.mo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--mo-card-min-width, 280px), 1fr));
  gap: 8px;
  padding: 8px;
  align-content: start;
}

/* ═══ Card ═══ */
.mo-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--parallx-radius-md, 6px);
  overflow: hidden;
  cursor: pointer;
  background: var(--vscode-editor-background);
  border: 1px solid var(--vscode-panel-border, #333);
  transition: border-color 0.15s;
  /* M59 P4: browser-native virtualization — skip rendering work for off-screen cards */
  content-visibility: auto;
  contain-intrinsic-size: 280px 240px;
}
.mo-card:hover { border-color: var(--vscode-focusBorder, #9333ea); }
.mo-card:focus-visible { outline: 1px solid var(--vscode-focusBorder, #9333ea); outline-offset: -1px; }
.mo-card.mo-selected { border-color: var(--vscode-focusBorder, #9333ea); box-shadow: 0 0 0 1px var(--vscode-focusBorder, #9333ea); }
.mo-card-thumb {
  position: relative;
  overflow: hidden;
  background: var(--vscode-input-background, #1a1a1a);
  aspect-ratio: 4 / 3;
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
.mo-card-stack-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: var(--parallx-fontSize-xs, 10px);
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--parallx-color-accent, #9333ea);
  color: #fff;
  font-weight: 700;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0,0,0,0.3);
}
/* M59 P6: timeline + map */
.mo-timeline-dialog { width: 96vw; height: 92vh; max-width: 1400px; max-height: none; }
.mo-timeline-body {
  flex: 1; overflow-y: auto; padding: 0 16px 16px 16px;
  scroll-behavior: smooth;
}
.mo-timeline-section-header {
  position: sticky; top: 0;
  background: var(--parallx-color-background, #1f1f1f);
  font-weight: 600; font-size: 13px; padding: 10px 4px; margin-top: 8px;
  border-bottom: 1px solid var(--parallx-color-border, #444);
  z-index: 1;
}
.mo-timeline-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 6px; padding: 8px 0;
}
.mo-timeline-tile {
  position: relative; aspect-ratio: 1 / 1;
  background: var(--parallx-color-input-background, #2a2a2a);
  border-radius: 4px; cursor: pointer; overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid transparent;
}
.mo-timeline-tile:hover { border-color: var(--parallx-color-accent, #9333ea); }
.mo-timeline-tile img { width: 100%; height: 100%; object-fit: cover; }
.mo-timeline-tile-ph { opacity: 0.5; }
.mo-map-dialog { width: 940px; max-width: 96vw; }
.mo-map-canvas {
  display: block; width: 100%; height: auto;
  background: #1e1e1e; cursor: grab;
}
.mo-map-canvas:active { cursor: grabbing; }
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
  flex-shrink: 0;
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
.mo-page-btn:focus-visible { outline: 1px solid var(--vscode-focusBorder, #9333ea); outline-offset: -1px; }
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
  font-size: var(--parallx-fontSize-md, 13px);
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
.mo-sidebar-item:focus-visible { outline: 1px solid var(--vscode-focusBorder, #9333ea); outline-offset: -1px; }
.mo-sidebar-item.mo-drop-target { background: var(--vscode-list-dropBackground, rgba(0,100,200,0.18)); outline: 1px dashed var(--vscode-focusBorder, #9333ea); }
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
  font-size: var(--parallx-fontSize-md, 13px);
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
.mo-list-row:focus-visible { outline: 1px solid var(--vscode-focusBorder, #9333ea); outline-offset: -1px; }
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
.mo-list-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--parallx-fontSize-md, 13px); }
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
.mo-tag-pill-remove:focus-visible { outline: 1px solid var(--vscode-focusBorder, #9333ea); border-radius: 2px; }
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
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
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
.mo-star:focus-visible { outline: 1px solid var(--vscode-focusBorder, #9333ea); outline-offset: 1px; border-radius: 2px; }
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
  border-top-color: var(--vscode-focusBorder, #9333ea);
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
.mo-detail-preview.mo-preview-zoomed {
  cursor: grab;
}
.mo-detail-panel {
  width: 320px;
  min-width: 260px;
  flex-shrink: 0;
  border-left: 1px solid var(--vscode-panel-border, #333);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  transition: width 0.15s ease, min-width 0.15s ease, opacity 0.15s ease;
}
.mo-detail-panel.mo-collapsed {
  width: 0;
  min-width: 0;
  overflow: hidden;
  border-left: none;
  opacity: 0;
  pointer-events: none;
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
  border-bottom-color: var(--vscode-focusBorder, #9333ea);
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
  border-color: var(--vscode-focusBorder, #9333ea);
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
  border-color: var(--vscode-focusBorder, #9333ea);
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
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
  outline-offset: 1px;
  border-radius: 2px;
}
.mo-detail-tab-btn:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
  outline-offset: -1px;
}
.mo-detail-tag-pill button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
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
.mo-selection-bar .mo-sel-delete {
  border-color: var(--vscode-errorForeground, #f44747);
  color: var(--vscode-errorForeground, #f44747);
}
.mo-selection-bar .mo-sel-delete:hover {
  background: var(--vscode-errorForeground, #f44747);
  color: #fff;
}
.mo-bulk-dialog-warn {
  font-size: var(--parallx-fontSize-sm, 12px);
  color: var(--vscode-descriptionForeground, #999);
  margin: 4px 0 8px;
}
.mo-bulk-dialog .mo-sel-delete {
  background: var(--vscode-errorForeground, #f44747);
  color: #fff;
  border-color: var(--vscode-errorForeground, #f44747);
}
.mo-bulk-dialog .mo-sel-delete:hover { opacity: 0.85; }
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
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
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
  border-color: var(--vscode-focusBorder, #9333ea);
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

/* ═══ Focus Indicator (F2) ═══ */
.mo-card.mo-focused { outline: 2px solid var(--vscode-focusBorder, #9333ea); outline-offset: -2px; }
.mo-list-row.mo-focused { outline: 2px solid var(--vscode-focusBorder, #9333ea); outline-offset: -2px; }

/* ═══ Context Menu (F1) ═══ */
.mo-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  background: var(--vscode-menu-background, #252526);
  border: 1px solid var(--vscode-menu-border, #454545);
  border-radius: var(--parallx-radius-md, 6px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  padding: 4px 0;
  font-size: var(--parallx-fontSize-md, 13px);
  color: var(--vscode-menu-foreground, #ccc);
}
.mo-context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 16px;
  cursor: pointer;
  white-space: nowrap;
}
.mo-context-menu-item:hover {
  background: var(--vscode-menu-selectionBackground, #094771);
  color: var(--vscode-menu-selectionForeground, #fff);
}
.mo-context-menu-item.mo-ctx-danger {
  color: var(--vscode-errorForeground, #f44747);
}
.mo-context-menu-item.mo-ctx-danger:hover {
  background: var(--vscode-errorForeground, #f44747);
  color: #fff;
}
.mo-context-menu-sep {
  height: 1px;
  margin: 4px 8px;
  background: var(--vscode-menu-separatorBackground, var(--vscode-panel-border, #454545));
}
.mo-context-menu-sub {
  position: relative;
}
.mo-context-menu-sub .mo-context-submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 120px;
  background: var(--vscode-menu-background, #252526);
  border: 1px solid var(--vscode-menu-border, #454545);
  border-radius: var(--parallx-radius-md, 6px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  padding: 4px 0;
}
.mo-context-menu-sub:hover > .mo-context-submenu {
  display: block;
}
.mo-context-menu-item .mo-ctx-arrow {
  margin-left: auto;
  opacity: 0.6;
}

/* ═══ Lightbox / Slideshow (F7) ═══ */
.mo-lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.92);
  color: #fff;
}
.mo-lightbox-content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
}
.mo-lightbox-content img,
.mo-lightbox-content video {
  max-width: 90%;
  max-height: 90%;
  object-fit: contain;
}
.mo-lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(255,255,255,0.1);
  border: none;
  color: #fff;
  font-size: 28px;
  padding: 12px 16px;
  cursor: pointer;
  border-radius: var(--parallx-radius-md, 6px);
  opacity: 0.6;
  transition: opacity 0.2s;
}
.mo-lightbox-nav:hover { opacity: 1; }
.mo-lightbox-nav.prev { left: 12px; }
.mo-lightbox-nav.next { right: 12px; }
.mo-lightbox-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: rgba(0, 0, 0, 0.7);
  font-size: var(--parallx-fontSize-md, 13px);
}
.mo-lightbox-bar .mo-lb-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mo-lightbox-bar .mo-lb-rating { color: var(--mo-rating-color, #f5c518); }
.mo-lightbox-bar .mo-lb-counter { opacity: 0.7; }
.mo-lightbox-bar button {
  background: rgba(255,255,255,0.1);
  border: 1px solid rgba(255,255,255,0.2);
  color: #fff;
  padding: 3px 10px;
  border-radius: var(--parallx-radius-sm, 3px);
  cursor: pointer;
  font-size: var(--parallx-fontSize-xs, 10px);
}
.mo-lightbox-bar button:hover { background: rgba(255,255,255,0.2); }
.mo-lightbox-bar button.active { background: var(--vscode-focusBorder, #9333ea); border-color: var(--vscode-focusBorder, #9333ea); }
.mo-lightbox-close {
  position: absolute;
  top: 12px;
  right: 12px;
  background: rgba(255,255,255,0.1);
  border: none;
  color: #fff;
  font-size: 20px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.7;
}
.mo-lightbox-close:hover { opacity: 1; background: rgba(255,255,255,0.2); }

/* ═══ Custom Dropdown (replaces native <select>) ═══ */
.mo-dropdown {
  position: relative;
  display: inline-block;
  min-width: 80px;
}
.mo-dropdown__button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 3px 8px;
  font-size: var(--parallx-fontSize-sm, 11px);
  font-family: inherit;
  line-height: 20px;
  color: var(--vscode-dropdown-foreground, var(--vscode-foreground, #ccc));
  background: var(--vscode-dropdown-background, var(--vscode-input-background, #3c3c3c));
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-input-border, #555));
  border-radius: var(--parallx-radius-sm, 3px);
  cursor: pointer;
  outline: none;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  gap: 4px;
}
.mo-dropdown__button:hover {
  border-color: var(--vscode-focusBorder, #9333ea);
}
.mo-dropdown__button:focus-visible {
  outline: 1px solid var(--vscode-focusBorder, #9333ea);
  outline-offset: -1px;
}
.mo-dropdown__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mo-dropdown__chevron {
  font-size: 8px;
  opacity: 0.7;
  flex-shrink: 0;
}
.mo-dropdown__list {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 100%;
  z-index: 1000;
  margin-top: 2px;
  padding: 4px 0;
  background: var(--vscode-dropdown-listBackground, var(--vscode-editorWidget-background, #252526));
  border: 1px solid var(--vscode-dropdown-border, var(--vscode-widget-border, #454545));
  border-radius: var(--parallx-radius-sm, 3px);
  box-shadow: 0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.36));
  max-height: 200px;
  overflow-y: auto;
}
.mo-dropdown--open .mo-dropdown__list { display: block; }
.mo-dropdown--up .mo-dropdown__list { top: auto; bottom: 100%; margin-top: 0; margin-bottom: 2px; }
.mo-dropdown__item {
  padding: 4px 8px;
  font-size: var(--parallx-fontSize-sm, 11px);
  line-height: 20px;
  color: var(--vscode-foreground, #ccc);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mo-dropdown__item:hover,
.mo-dropdown__item--focused {
  background: var(--vscode-list-hoverBackground, rgba(255, 255, 255, 0.06));
}
.mo-dropdown__item--selected {
  color: var(--vscode-list-activeSelectionForeground, #fff);
  background: var(--vscode-list-activeSelectionBackground, #9333ea);
}
.mo-dropdown__item--selected:hover {
  background: var(--vscode-list-activeSelectionBackground, #9333ea);
}

/* ═══ Styled Date Input ═══ */
.mo-filter-date {
  background: var(--vscode-input-background, #3c3c3c);
  color: var(--vscode-input-foreground, #ccc);
  border: 1px solid var(--vscode-input-border, #555);
  border-radius: var(--parallx-radius-sm, 3px);
  padding: 3px 6px;
  font-size: var(--parallx-fontSize-sm, 11px);
  font-family: inherit;
  outline: none;
  width: 100px;
}
.mo-filter-date:focus { border-color: var(--vscode-focusBorder, #9333ea); }
.mo-filter-date::placeholder { color: var(--vscode-input-placeholderForeground, #888); }
.mo-filter-date::-webkit-calendar-picker-indicator { display: none; }

/* ═══ Styled Zoom Slider ═══ */
.mo-zoom-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 72px;
  height: 6px;
  border-radius: 3px;
  background: linear-gradient(to right,
    var(--vscode-button-background, #9333ea) 0%,
    var(--vscode-button-background, #9333ea) var(--slider-fill, 50%),
    var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4)) var(--slider-fill, 50%),
    var(--vscode-scrollbarSlider-background, rgba(121,121,121,0.4)) 100%);
  outline: none;
  cursor: pointer;
  margin: 0 4px;
}
.mo-zoom-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--vscode-button-background, #9333ea);
  border: 2px solid var(--vscode-editor-background, #1e1e1e);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.1);
  cursor: pointer;
  transition: transform 0.12s ease;
}
.mo-zoom-slider::-webkit-slider-thumb:hover { transform: scale(1.15); }

/* ═══ Lightbox Zoom ═══ */
.mo-lightbox-content img,
.mo-lightbox-content video {
  transition: none;
  transform-origin: center center;
}
.mo-lightbox-content.mo-lb-zoomed img,
.mo-lightbox-content.mo-lb-zoomed video {
  cursor: grab;
  max-width: none !important;
  max-height: none !important;
}
.mo-lightbox-content.mo-lb-zoomed.mo-lb-dragging img,
.mo-lightbox-content.mo-lb-zoomed.mo-lb-dragging video {
  cursor: grabbing;
}
.mo-lb-zoom-indicator {
  font-size: var(--parallx-fontSize-xs, 10px);
  opacity: 0.7;
  white-space: nowrap;
}

/* ═══ M59 Phase 1: custom video player + clip dialog + WebP review ═══ */
.mo-player {
  position: relative; width: 100%; height: 100%; background: #000;
  overflow: hidden; outline: none;
}
.mo-player-video {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: contain; background: #000;
}
.mo-player-preview-vid {
  position: absolute; left: -9999px; width: 1px; height: 1px; opacity: 0;
  pointer-events: none;
}
.mo-player-topbar {
  position: absolute; top: 0; left: 0; right: 0; padding: 8px 12px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
  color: #fff; display: flex; gap: 12px; align-items: baseline;
  pointer-events: none; transition: opacity 200ms;
  z-index: 2;
}
.mo-player-title { font-weight: 500; font-size: 13px; flex: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mo-player-meta { font-size: 11px; opacity: 0.8; }
.mo-player-bottombar {
  position: absolute; bottom: 0; left: 0; right: 0; padding: 4px 12px 8px;
  background: linear-gradient(to top, rgba(0,0,0,0.85), transparent);
  display: flex; flex-direction: column; gap: 4px;
  transition: opacity 200ms; z-index: 2;
}
.mo-player-rail {
  position: absolute; top: 50%; right: 8px; transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 6px;
  transition: opacity 200ms; z-index: 2;
}
.mo-player-chrome-hidden .mo-player-topbar,
.mo-player-chrome-hidden .mo-player-bottombar,
.mo-player-chrome-hidden .mo-player-rail {
  opacity: 0; pointer-events: none;
}
.mo-player-progrow {
  position: relative; padding: 8px 0 4px;
}
.mo-player-progress {
  position: relative; height: 5px; background: rgba(255,255,255,0.2);
  border-radius: 3px; cursor: pointer;
}
.mo-player-progress:hover { height: 7px; transition: height 100ms; }
.mo-player-progress-buf,
.mo-player-progress-played,
.mo-player-loop-range {
  position: absolute; top: 0; left: 0; height: 100%; border-radius: 3px;
  pointer-events: none;
}
.mo-player-progress-buf { background: rgba(255,255,255,0.35); width: 0; }
.mo-player-progress-played {
  background: var(--parallx-color-accent, #4d8eff);
  width: 0; z-index: 1;
}
.mo-player-loop-range {
  background: rgba(255, 200, 0, 0.35);
  z-index: 0; display: none;
}
.mo-player-mark {
  position: absolute; top: -2px; bottom: -2px; width: 2px;
  background: rgba(255, 200, 0, 0.9); pointer-events: none;
  z-index: 2; display: none;
}
.mo-player-progress-thumb {
  position: absolute; top: 50%; transform: translate(-50%, -50%);
  width: 11px; height: 11px; border-radius: 50%;
  background: var(--parallx-color-accent, #4d8eff);
  border: 2px solid #fff; display: none; z-index: 3;
  pointer-events: none;
}
.mo-player-hover {
  position: absolute; bottom: 100%; transform: translateX(-50%);
  background: rgba(0,0,0,0.85); padding: 4px; border-radius: 4px;
  display: none; pointer-events: none; margin-bottom: 6px;
}
.mo-player-hover-canvas {
  display: block; width: 160px; height: 90px; border-radius: 2px;
  background: #222;
}
.mo-player-hover-time {
  text-align: center; font-size: 10px; color: #fff; margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.mo-player-ctrlrow {
  display: flex; gap: 6px; align-items: center;
}
.mo-player-btn {
  background: transparent; border: 0; color: #fff; cursor: pointer;
  padding: 4px 6px; border-radius: 4px; display: inline-flex;
  align-items: center; justify-content: center; min-width: 28px; height: 28px;
}
.mo-player-btn:hover { background: rgba(255,255,255,0.15); }
.mo-player-btn-active { color: var(--parallx-color-accent, #4d8eff); }
.mo-player-time {
  color: #fff; font-size: 12px; font-variant-numeric: tabular-nums;
  margin: 0 8px; opacity: 0.9;
}
.mo-player-speed { position: relative; }
.mo-player-speed-btn { font-size: 12px; min-width: 36px; }
.mo-player-speed-menu {
  position: absolute; bottom: 32px; left: 0; background: rgba(0,0,0,0.92);
  border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;
  padding: 4px; display: flex; flex-direction: column; gap: 2px;
  z-index: 10; min-width: 60px;
}
.mo-player-speed-item {
  background: transparent; border: 0; color: #fff; cursor: pointer;
  padding: 4px 8px; text-align: left; font-size: 12px; border-radius: 3px;
}
.mo-player-speed-item:hover { background: rgba(255,255,255,0.15); }
.mo-hidden { display: none !important; }
.mo-player-vol { display: flex; align-items: center; gap: 4px; }
.mo-player-vol-slider {
  width: 60px; height: 4px; cursor: pointer; accent-color: var(--parallx-color-accent, #4d8eff);
}
.mo-player-rail-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.15);
  color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
}
.mo-player-rail-btn:hover { background: rgba(0,0,0,0.85); border-color: rgba(255,255,255,0.3); }
.mo-player-rail-btn:disabled { opacity: 0.4; cursor: default; }

/* ─── Clip / WebP modal ─── */
.mo-modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999;
}
.mo-modal {
  background: var(--parallx-color-background, #1f1f1f);
  color: var(--parallx-color-foreground, #ddd);
  border: 1px solid var(--parallx-color-border, #444);
  border-radius: 8px; min-width: 480px; max-width: 720px; max-height: 86vh;
  display: flex; flex-direction: column;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.mo-modal-header {
  display: flex; align-items: center; padding: 12px 16px;
  border-bottom: 1px solid var(--parallx-color-border, #444);
}
.mo-modal-title { flex: 1; font-weight: 600; font-size: 14px; }
.mo-modal-close {
  background: transparent; border: 0; color: inherit; font-size: 22px;
  cursor: pointer; line-height: 1; padding: 0 6px;
}
.mo-modal-footer {
  display: flex; gap: 8px; padding: 12px 16px;
  border-top: 1px solid var(--parallx-color-border, #444);
  align-items: center;
}
.mo-modal-footer .mo-clip-status { flex: 1; font-size: 12px; opacity: 0.7; }

.mo-clip-dialog { width: 800px; max-width: 96vw; }
.mo-clip-preview {
  display: block; width: 100%; max-height: 240px; background: #000;
  object-fit: contain;
}
.mo-clip-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 10px; }

/* M59 P2: frame strip + waveform */
.mo-clip-stripwrap {
  position: relative;
  background: var(--parallx-color-input-background, #1e1e1e);
  border: 1px solid var(--parallx-color-border, #444);
  border-radius: 4px;
  padding: 4px;
}
.mo-clip-wave {
  display: block;
  width: 100%;
  height: 36px;
  margin-bottom: 4px;
  opacity: 0.55;
  pointer-events: none;
  border-radius: 2px;
}
.mo-clip-framestrip {
  display: flex;
  gap: 2px;
  overflow-x: auto;
  padding: 2px 0;
  min-height: 56px;
}
.mo-clip-frame {
  position: relative;
  flex: 0 0 80px;
  width: 80px;
  height: 45px;
  border-radius: 2px;
  cursor: pointer;
  background: #000;
  user-select: none;
}
.mo-clip-frame img {
  width: 100%; height: 100%; display: block; object-fit: cover;
  border-radius: 2px;
}
.mo-clip-frame-idx {
  position: absolute; bottom: 2px; left: 3px;
  font-size: 9px; line-height: 1; padding: 1px 3px;
  background: rgba(0, 0, 0, 0.65); color: #fff;
  border-radius: 2px; font-variant-numeric: tabular-nums;
}
.mo-clip-frame-delay {
  position: absolute; top: 2px; right: 2px;
  font-size: 9px; line-height: 1; padding: 1px 3px;
  background: var(--parallx-color-accent, #4d8eff); color: #fff;
  border-radius: 2px; font-variant-numeric: tabular-nums;
}
.mo-clip-frame-deleted img { opacity: 0.25; filter: grayscale(1); }
.mo-clip-frame-deleted::after {
  content: '×';
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  color: #ff6b6b; font-size: 28px; line-height: 1; font-weight: 700;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.7); pointer-events: none;
}
.mo-clip-strip-status {
  font-size: 11px; opacity: 0.65; padding: 2px 4px;
  font-variant-numeric: tabular-nums;
}

.mo-clip-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
}
.mo-clip-label {
  min-width: 80px; font-size: 12px; opacity: 0.85;
}
.mo-clip-input {
  flex: 0 1 120px; padding: 4px 8px; font-size: 12px;
  background: var(--parallx-color-input-background, #2a2a2a);
  color: inherit;
  border: 1px solid var(--parallx-color-border, #444);
  border-radius: 4px;
}
.mo-clip-check { margin: 0 6px 0 0; }
.mo-clip-length {
  font-size: 11px; opacity: 0.7; font-variant-numeric: tabular-nums;
}
.mo-btn-primary, .mo-btn-secondary {
  padding: 6px 14px; font-size: 12px; border-radius: 4px; cursor: pointer;
  border: 1px solid var(--parallx-color-border, #444);
}
.mo-btn-primary {
  background: var(--parallx-color-accent, #4d8eff); color: #fff; border-color: transparent;
}
.mo-btn-primary:disabled { opacity: 0.5; cursor: default; }
.mo-btn-secondary {
  background: transparent; color: inherit;
}

.mo-webp-dialog { width: 600px; }
.mo-webp-list {
  flex: 1; overflow-y: auto; padding: 8px 16px;
  display: flex; flex-direction: column; gap: 6px;
  max-height: 60vh;
}
.mo-webp-row {
  display: grid; grid-template-columns: 1fr auto;
  grid-template-areas: "name select" "meta select";
  align-items: center; gap: 4px 12px;
  padding: 8px; border-radius: 4px;
  border: 1px solid var(--parallx-color-border, #444);
}
.mo-webp-name { grid-area: name; font-size: 13px; font-weight: 500; }
.mo-webp-meta { grid-area: meta; font-size: 11px; opacity: 0.65; }
.mo-webp-row select { grid-area: select; }
.mo-webp-empty { padding: 24px; text-align: center; opacity: 0.6; }

/* M59 P3: duplicate finder */
.mo-dup-dialog { width: 800px; max-width: 96vw; }
.mo-dup-body { padding: 12px 16px; max-height: 70vh; overflow-y: auto; }
.mo-dup-summary { font-size: 12px; opacity: 0.8; margin-bottom: 12px; }
.mo-dup-group {
  border: 1px solid var(--parallx-color-border, #444);
  border-radius: 4px; padding: 8px; margin-bottom: 10px;
}
.mo-dup-group-head { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
.mo-dup-group-label { font-weight: 600; }
.mo-dup-group-count { opacity: 0.7; }
.mo-dup-list { display: flex; flex-direction: column; gap: 4px; }
.mo-dup-row {
  display: grid; grid-template-columns: auto 1fr; gap: 8px;
  align-items: center; padding: 4px 6px;
}
.mo-dup-name { font-size: 12px; }
.mo-dup-meta { font-size: 11px; opacity: 0.6; }
.mo-dup-actions { margin-top: 8px; display: flex; justify-content: flex-end; }
.mo-dup-empty { padding: 24px; text-align: center; opacity: 0.65; }
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

const MO_ZOOM_MIN = 150;
const MO_ZOOM_MAX = 800;
const MO_ZOOM_DEFAULT = 280;
const MO_CARD_GAP = 8;
const MO_DEFAULT_PER_PAGE = 40;

// Session-level state: survives grid editor re-opens within the same session
let _sessionZoomWidth = MO_ZOOM_DEFAULT;
const _sessionGridState = new Map(); // keyed by instanceId

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

// ── Local file → blob URL converter ──────────────────────────────────────────
// The renderer loads from http://127.0.0.1, so file:// URLs are blocked by
// same-origin policy. Read files via IPC (base64) and create object URLs.
const _blobUrlCache = new Map();
const _BLOB_CACHE_MAX = 500;

const _MIME_FROM_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.tiff': 'image/tiff', '.tif': 'image/tiff',
  '.heic': 'image/heic', '.heif': 'image/heif', '.avif': 'image/avif',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg', '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg',
};

async function localFileToUrl(filePath) {
  if (!filePath) return null;
  const cached = _blobUrlCache.get(filePath);
  if (cached) return cached;
  try {
    const readResult = await window.parallxElectron.fs.readFile(filePath);
    if (readResult.error) return null;
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const mime = _MIME_FROM_EXT[ext] || 'application/octet-stream';
    const base64 = readResult.encoding === 'base64' ? readResult.content : btoa(readResult.content);
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    if (_blobUrlCache.size >= _BLOB_CACHE_MAX) {
      const firstKey = _blobUrlCache.keys().next().value;
      URL.revokeObjectURL(_blobUrlCache.get(firstKey));
      _blobUrlCache.delete(firstKey);
    }
    _blobUrlCache.set(filePath, url);
    return url;
  } catch (err) {
    console.warn('[MediaOrganizer] localFileToUrl failed:', filePath, err);
    return null;
  }
}

function renderMediaCard(item, options) {
  const { selecting, isSelected, isFocused, onSelect, onClick, onDblClick } = options;
  let cls = 'mo-card';
  if (isSelected) cls += ' mo-selected';
  if (isFocused) cls += ' mo-focused';
  const card = moEl('div', cls);
  card.dataset.key = `${item.type}:${item.id}`;
  card.setAttribute('draggable', 'true');

  // Thumbnail section
  const thumb = moEl('div', 'mo-card-thumb');
  const img = moEl('img');
  img.alt = item.title || '';
  img.loading = 'lazy';
  if (item._gifSourcePath || item.thumbnailPath) {
    // Prefer animated GIF source over static JPEG thumbnail
    localFileToUrl(item._gifSourcePath || item.thumbnailPath).then(url => { if (url) img.src = url; });
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

  // M59 P5: stack badge (populated lazily by loadPage when item._stackCount is set)
  const stackBadge = moEl('span', 'mo-card-stack-badge');
  stackBadge.style.display = 'none';
  if (item._stackCount && item._stackCount > 0) {
    stackBadge.textContent = `+${item._stackCount}`;
    stackBadge.style.display = '';
  }
  thumb.appendChild(stackBadge);
  card._stackBadge = stackBadge;

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

  card.addEventListener('pointerdown', (e) => {
    // Ctrl/Cmd+click toggles selection, Shift+click extends range
    if ((e.ctrlKey || e.metaKey) && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      const nowChecked = !cb.checked;
      cb.checked = nowChecked;
      if (onSelect) onSelect(item, nowChecked, false);
    } else if (e.shiftKey && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      cb.checked = true;
      if (onSelect) onSelect(item, true, true);
    }
  });
  card.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return; // handled by pointerdown
    if (onClick) onClick(item);
  });
  card.addEventListener('dblclick', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (onDblClick) onDblClick(item);
  });
  card.addEventListener('dragstart', (e) => {
    const key = `${item.type}:${item.id}`;
    const keys = (isSelected && options.selectedIds && options.selectedIds.size > 1)
      ? [...options.selectedIds]
      : [key];
    e.dataTransfer.setData('application/x-mo-items', JSON.stringify(keys));
    // M59 P7: also publish standard MIME types so OS / canvas / chat surfaces
    // can accept the drop natively. Path is best-effort — populated lazily by
    // resolveThumbnailForCard. If unresolved, we still set the MO key payload.
    const filePath = card._filePath || item._sourcePath;
    if (filePath) {
      const fileUrl = `file:///${String(filePath).replace(/\\/g, '/').replace(/^\/+/, '')}`;
      try { e.dataTransfer.setData('text/uri-list', fileUrl); } catch { /* ignore */ }
      try { e.dataTransfer.setData('text/plain', filePath); } catch { /* ignore */ }
    }
    e.dataTransfer.effectAllowed = 'copy';
  });
  card._imgEl = img;
  card._thumbEl = thumb;

  return card;
}

// Adapted from stash: list display mode — compact row rendering
function renderMediaListRow(item, options) {
  const { selecting, isSelected, isFocused, onSelect, onClick, onDblClick } = options;
  let cls = 'mo-list-row';
  if (isSelected) cls += ' mo-selected';
  if (isFocused) cls += ' mo-focused';
  const row = moEl('div', cls);
  row.dataset.key = `${item.type}:${item.id}`;
  row.setAttribute('draggable', 'true');

  // Thumb
  const thumb = moEl('div', 'mo-list-thumb');
  const img = moEl('img');
  img.alt = item.title || '';
  img.loading = 'lazy';
  if (item.thumbnailPath) {
    localFileToUrl(item.thumbnailPath).then(url => { if (url) img.src = url; });
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

  row.addEventListener('pointerdown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      const nowChecked = !cb.checked;
      cb.checked = nowChecked;
      if (onSelect) onSelect(item, nowChecked, false);
    } else if (e.shiftKey && e.button === 0) {
      e.preventDefault();
      e.stopPropagation();
      cb.checked = true;
      if (onSelect) onSelect(item, true, true);
    }
  });
  row.addEventListener('click', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (onClick) onClick(item);
  });
  row.addEventListener('dblclick', (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (onDblClick) onDblClick(item);
  });
  row.addEventListener('dragstart', (e) => {
    const key = `${item.type}:${item.id}`;
    const keys = (isSelected && options.selectedIds && options.selectedIds.size > 1)
      ? [...options.selectedIds]
      : [key];
    e.dataTransfer.setData('application/x-mo-items', JSON.stringify(keys));
    e.dataTransfer.effectAllowed = 'copy';
  });
  row._imgEl = img;
  row._thumbEl = thumb;
  return row;
}

function renderCardGrid(container, items, options) {
  const { zoomWidth, selecting, selectedIds, onSelect, onClick, onDblClick } = options;
  const grid = moEl('div', 'mo-grid');
  grid.style.setProperty('--mo-card-min-width', `${zoomWidth || MO_ZOOM_DEFAULT}px`);
  container.appendChild(grid);

  // M59 P4: lazy thumbnail resolution — only kick off DB queries for cards
  // visible (or near-visible) in the viewport. Saves 100s of queries when
  // perPage is high or "Auto" mode is on.
  const _thumbObserver = ('IntersectionObserver' in window) ? new IntersectionObserver((entries, obs) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        const card = entry.target;
        const item = card._moItem;
        obs.unobserve(card);
        if (item && !item.thumbnailPath && item.type && item.id) {
          resolveThumbnailForCard(card, item);
        }
      }
    }
  }, { rootMargin: '400px 0px', threshold: 0.01 }) : null;

  function _attachLazyThumb(card, item) {
    card._moItem = item;
    if (_thumbObserver) _thumbObserver.observe(card);
    else if (!item.thumbnailPath && item.type && item.id) {
      resolveThumbnailForCard(card, item);
    }
    // M59 P5: lazily fetch stack member count and update badge
    if (item.type && item.id && card._stackBadge && item._stackCount == null) {
      moGetStackMemberCount(item.type, item.id).then(n => {
        if (n > 0) {
          item._stackCount = n;
          card._stackBadge.textContent = `+${n}`;
          card._stackBadge.style.display = '';
        }
      }).catch(() => {});
    }
  }

  function renderAll(itemList, opts) {
    grid.innerHTML = '';
    if (_thumbObserver) _thumbObserver.disconnect();
    const listMode = opts.displayMode === 'list';
    grid.classList.toggle('mo-list-mode', listMode);
    if (!itemList || itemList.length === 0) {
      grid.appendChild(moEl('div', 'mo-empty', { textContent: 'No media items found' }));
      return;
    }

    const focIdx = opts.focusedIndex ?? null;
    if (listMode) {
      for (let idx = 0; idx < itemList.length; idx++) {
        const item = itemList[idx];
        const row = renderMediaListRow(item, {
          selecting: opts.selecting ?? selecting,
          isSelected: opts.selectedIds ? opts.selectedIds.has(`${item.type}:${item.id}`) : false,
          isFocused: focIdx === idx,
          selectedIds: opts.selectedIds ?? selectedIds,
          onSelect: opts.onSelect ?? onSelect,
          onClick: opts.onClick ?? onClick,
          onDblClick: opts.onDblClick ?? onDblClick,
        });
        grid.appendChild(row);
        if (focIdx === idx) row.scrollIntoView({ block: 'nearest' });
        // List rows: lazy-load via observer too (treat row as card)
        _attachLazyThumb(row, item);
      }
    } else {
      const zw = opts.zoomWidth ?? zoomWidth;
      grid.style.setProperty('--mo-card-min-width', `${zw || MO_ZOOM_DEFAULT}px`);
      for (let idx = 0; idx < itemList.length; idx++) {
        const item = itemList[idx];
        const card = renderMediaCard(item, {
          selecting: opts.selecting ?? selecting,
          isSelected: opts.selectedIds ? opts.selectedIds.has(`${item.type}:${item.id}`) : false,
          isFocused: focIdx === idx,
          selectedIds: opts.selectedIds ?? selectedIds,
          onSelect: opts.onSelect ?? onSelect,
          onClick: opts.onClick ?? onClick,
          onDblClick: opts.onDblClick ?? onDblClick,
        });
        grid.appendChild(card);
        if (focIdx === idx) card.scrollIntoView({ block: 'nearest' });

        // M59 P4: defer thumbnail resolution until card scrolls near viewport
        _attachLazyThumb(card, item);
      }
    }
  }

  async function resolveThumbnailForCard(card, item) {
    try {
      const result = await resolveThumbnail(item.type === 'photo' ? 'photo' : 'video', item.id, _api);
      if (result && (result.path || result.sourcePath)) {
        item.thumbnailPath = result.path;
        // Persist GIF source on item so it survives grid refreshes (zoom changes)
        if (result.sourcePath) item._gifSourcePath = result.sourcePath;
        // M59 P7: stash original source path for drag-out interop (text/uri-list)
        if (result.sourcePath) {
          card._filePath = result.sourcePath;
          item._sourcePath = result.sourcePath;
        }
        const img = card._imgEl;
        if (img) {
          // For GIFs, show the original animated file instead of the static thumbnail
          const displayPath = result.sourcePath || result.path;
          const url = await localFileToUrl(displayPath);
          if (url) {
            img.src = url;
            img.style.display = '';
            // Remove placeholder if present
            const ph = card._thumbEl?.querySelector('.mo-thumb-placeholder');
            if (ph) ph.remove();
          }
        }
      }
    } catch { /* thumbnail resolution failure — leave placeholder */ }
  }



  renderAll(items, options);

  return {
    refresh(newItems, newOptions) {
      renderAll(newItems, { ...options, ...newOptions });
    },
    dispose() {
      if (_thumbObserver) _thumbObserver.disconnect();
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
  qfBody.appendChild(sidebarItem('copy', 'Duplicates', null, () => openGrid('duplicates', 'Duplicates')));
  qfBody.appendChild(sidebarItem('trash', 'Trash', null, () => openGrid('trash', 'Trash')));
  qfBody.appendChild(sidebarItem('calendar', 'Timeline', null, () => moOpenTimeline(_api)));
  qfBody.appendChild(sidebarItem('globe', 'Map', null, () => moOpenMap(_api)));
  sections.appendChild(qfSection);

  // Folders section
  const { section: folderSection, body: folderBody } = sidebarSection('Folders', 'folder', false);
  sections.appendChild(folderSection);

  // Tags section
  const { section: tagSection, body: tagBody } = sidebarSection('Tags', 'tag', false);
  sections.appendChild(tagSection);

  async function loadFolders() {
    try {
      // Only show folders that directly contain at least one media file.
      // Display as relative path from the common scan root for disambiguation.
      const rows = await db.all(`
        SELECT fo.id, fo.path, COUNT(f.id) AS file_count
        FROM mo_folders fo
        JOIN mo_files f ON f.folder_id = fo.id
        GROUP BY fo.id
        HAVING file_count > 0
        ORDER BY fo.path ASC
      `);
      // Filter out internal .parallx paths (thumbnail dirs, extension data)
      const filtered = rows.filter(row => !isInternalPath(row.path));
      folderBody.innerHTML = '';
      if (filtered.length === 0) {
        folderBody.appendChild(moEl('div', 'mo-empty', { textContent: 'No folders scanned yet' }));
        return;
      }

      // Compute common prefix of all folder paths to derive scan root
      let commonPrefix = filtered[0].path;
      for (let i = 1; i < filtered.length; i++) {
        while (commonPrefix && !filtered[i].path.startsWith(commonPrefix)) {
          // Walk up one directory
          const sepIdx = Math.max(commonPrefix.lastIndexOf('/'), commonPrefix.lastIndexOf('\\'));
          if (sepIdx <= 0) { commonPrefix = ''; break; }
          commonPrefix = commonPrefix.slice(0, sepIdx);
        }
      }
      // Include trailing separator so relative paths don't start with one
      if (commonPrefix && !commonPrefix.endsWith('/') && !commonPrefix.endsWith('\\')) {
        const sepIdx = Math.max(commonPrefix.lastIndexOf('/'), commonPrefix.lastIndexOf('\\'));
        commonPrefix = sepIdx > 0 ? commonPrefix.slice(0, sepIdx + 1) : commonPrefix + '/';
      } else if (commonPrefix && (commonPrefix.endsWith('/') || commonPrefix.endsWith('\\'))) {
        // already has trailing sep
      } else {
        commonPrefix = '';
      }

      for (const row of filtered) {
        const relPath = commonPrefix ? row.path.slice(commonPrefix.length) : row.path;
        const displayName = relPath.replace(/\\/g, '/') || row.path.split(/[/\\]/).pop() || `Folder ${row.id}`;
        const badge = String(row.file_count);
        folderBody.appendChild(sidebarItem('folder', displayName, badge, () => openGrid(`folder:${row.id}`, displayName, 'folder')));
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
        const albumItem = sidebarItem(icon, album.title || `Album #${album.id}`, badge, () => {
          api.editors.openEditor({
            typeId: 'media-organizer-grid',
            title: album.title || 'Album',
            icon: 'folder-library',
            instanceId: `album:${album.id}`,
          });
        });
        // F5: Drag-to-Album drop target
        albumItem.addEventListener('dragover', (e) => {
          if (e.dataTransfer.types.includes('application/x-mo-items')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            albumItem.classList.add('mo-drop-target');
          }
        });
        albumItem.addEventListener('dragleave', () => { albumItem.classList.remove('mo-drop-target'); });
        albumItem.addEventListener('drop', async (e) => {
          e.preventDefault();
          albumItem.classList.remove('mo-drop-target');
          try {
            const keys = JSON.parse(e.dataTransfer.getData('application/x-mo-items'));
            const photoIds = [];
            const videoIds = [];
            for (const k of keys) {
              const [type, id] = k.split(':');
              if (type === 'photo') photoIds.push(parseInt(id, 10));
              else if (type === 'video') videoIds.push(parseInt(id, 10));
            }
            if (photoIds.length > 0) await AlbumQueries.updatePhotos(album.id, { mode: 'ADD', ids: photoIds });
            if (videoIds.length > 0) await AlbumQueries.updateVideos(album.id, { mode: 'ADD', ids: videoIds });
            api.statusBar.setMessage(`Added ${keys.length} item(s) to "${album.title || 'Album'}"`, 3000);
            loadAlbums(); // refresh counts
          } catch (err) {
            console.error('[MO] drag-to-album error:', err);
          }
        });
        albumBody.appendChild(albumItem);
      }
    } catch {
      albumBody.appendChild(moEl('div', 'mo-empty', { textContent: 'Could not load albums' }));
    }
  }

  loadFolders();
  loadTags();
  loadAlbums();

  // Register for refresh after scan completes
  const refreshAll = () => { loadFolders(); loadTags(); loadAlbums(); };
  _sidebarRefreshCallbacks.push(refreshAll);

  return { dispose() { container.innerHTML = ''; const idx = _sidebarRefreshCallbacks.indexOf(refreshAll); if (idx >= 0) _sidebarRefreshCallbacks.splice(idx, 1); } };
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
  root.setAttribute('tabindex', '-1');
  container.appendChild(root);

  // Parse filter context from input.id
  const instanceId = (input && input.id) || 'grid:all';
  const parts = instanceId.replace(/^grid:/, '').split(':');
  const filterType = parts[0] || 'all';
  const filterId = parts[1] ? parseInt(parts[1], 10) : null;

  // Restore session state if available for this grid instance
  const cached = _sessionGridState.get(instanceId);
  const state = {
    currentPage: cached?.currentPage ?? 1,
    perPage: cached?.perPage ?? MO_DEFAULT_PER_PAGE,
    zoomWidth: _sessionZoomWidth,
    sortBy: cached?.sortBy ?? 'created_at',
    sortDir: cached?.sortDir ?? 'DESC',
    mediaType: cached?.mediaType ?? ((filterType === 'photos' || filterType === 'videos') ? filterType : 'all'),
    displayMode: cached?.displayMode ?? 'grid',
    totalCount: 0,
    items: [],
    selectedIds: new Set(),
    selecting: false,
    lastClickedKey: null,
    focusedIndex: null,
    filters: cached?.filters ? { ...cached.filters, tagIds: [...(cached.filters.tagIds || [])], excludeTagIds: [...(cached.filters.excludeTagIds || [])] } : {
      tagIds: [],
      excludeTagIds: [],
      tagDepth: 0,
      ratingMin: null,
      dateFrom: null,
      dateTo: null,
    },
  };

  // Save state snapshot on every loadPage
  let _scrollResetOnLoad = false; // true = scroll to top after loadPage
  let _lastScrollTop = cached?.scrollTop ?? 0; // live-tracked scroll position
  function saveSessionState() {
    _sessionGridState.set(instanceId, {
      currentPage: state.currentPage,
      perPage: state.perPage,
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      mediaType: state.mediaType,
      displayMode: state.displayMode,
      scrollTop: _lastScrollTop,
      filters: {
        tagIds: [...state.filters.tagIds],
        excludeTagIds: [...state.filters.excludeTagIds],
        tagDepth: state.filters.tagDepth,
        ratingMin: state.filters.ratingMin,
        dateFrom: state.filters.dateFrom,
        dateTo: state.filters.dateTo,
      },
    });
  }

  // Live scroll tracking is attached after gridArea is created (see below)

  // If Recent, override sort
  if (filterType === 'recent' && !cached) {
    state.sortBy = 'created_at';
    state.sortDir = 'DESC';
  }

  // ── Toolbar ──
  const toolbar = moEl('div', 'mo-toolbar');
  root.appendChild(toolbar);

  const searchInput = moEl('input', 'mo-toolbar-search', {
    type: 'text',
    placeholder: 'Search… (try: cat tag:beach rating:>=4 taken:2024)',
    title: 'Free text searches title/details/tags/folder.\nOperators: tag:NAME, -tag:NAME, rating:>=4 (or 3..5), folder:TERM, taken:2024 (or 2024-06), type:photo/video',
  });
  toolbar.appendChild(searchInput);

  // Sort controls
  const sortGroup = moEl('div', 'mo-toolbar-group');
  const sortDropdown = moDropdown({
    items: [
      { value: 'created_at', label: 'Date Added' },
      { value: 'title', label: 'Title' },
      { value: 'rating', label: 'Rating' },
      { value: 'taken_at', label: 'Date Taken' },
      { value: 'file_mod_time', label: 'File Modified' },
    ],
    selected: state.sortBy,
    ariaLabel: 'Sort by',
  });
  sortGroup.appendChild(sortDropdown.el);

  const sortDirBtn = moEl('button', 'mo-toolbar-btn', { innerHTML: moIcon('arrow-down', 12), title: 'Sort direction' });
  sortDirBtn.setAttribute('aria-label', 'Sort direction');
  sortGroup.appendChild(sortDirBtn);
  toolbar.appendChild(sortGroup);

  // Zoom slider
  const zoomGroup = moEl('div', 'mo-toolbar-group');
  zoomGroup.appendChild(moEl('span', 'mo-toolbar-label', { textContent: 'Zoom' }));
  const zoomSlider = moEl('input', 'mo-zoom-slider', { type: 'range', min: String(MO_ZOOM_MIN), max: String(MO_ZOOM_MAX), step: '10', value: String(state.zoomWidth) });
  function updateSliderFill() {
    const pct = ((state.zoomWidth - MO_ZOOM_MIN) / (MO_ZOOM_MAX - MO_ZOOM_MIN)) * 100;
    zoomSlider.style.setProperty('--slider-fill', pct + '%');
  }
  updateSliderFill();
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
  const tagAddDropdown = moDropdown({
    items: [],
    placeholder: '+ Add tag...',
    ariaLabel: 'Add tag filter',
  });
  tagAddRow.appendChild(tagAddDropdown.el);
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
  const dateFrom = moEl('input', 'mo-filter-date', { type: 'text', placeholder: 'YYYY-MM-DD', title: 'From date' });
  dateFrom.setAttribute('aria-label', 'From date');
  const dateTo = moEl('input', 'mo-filter-date', { type: 'text', placeholder: 'YYYY-MM-DD', title: 'To date' });
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
    const items = [];
    if (_filterTagCache) {
      for (const tag of _filterTagCache) {
        if (!usedIds.has(tag.id)) {
          items.push({ value: String(tag.id), label: tag.name });
        }
      }
    }
    tagAddDropdown.setItems(items);
    tagAddDropdown.setValue('');
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

  tagAddDropdown.onChange = (value) => {
    const tagId = parseInt(value, 10);
    if (!tagId || state.filters.tagIds.includes(tagId)) return;
    state.filters.tagIds.push(tagId);
    tagAddDropdown.setValue('');
    renderTagPills(); refreshTagDropdown();
    state.currentPage = 1; loadPage();
  };

  tagAddExcludeBtn.addEventListener('click', () => {
    const tagId = parseInt(tagAddDropdown.getValue(), 10);
    if (!tagId || state.filters.excludeTagIds.includes(tagId)) return;
    state.filters.excludeTagIds.push(tagId);
    tagAddDropdown.setValue('');
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
    const v = dateFrom.value.trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { dateFrom.value = ''; }
    state.filters.dateFrom = dateFrom.value || null;
    state.currentPage = 1; loadPage();
  });

  dateTo.addEventListener('change', () => {
    const v = dateTo.value.trim();
    if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { dateTo.value = ''; }
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
    return { zoomWidth: state.zoomWidth, displayMode: state.displayMode, selecting: state.selecting, selectedIds: state.selectedIds, focusedIndex: state.focusedIndex, onSelect: handleSelect, onClick: handleCardClick, onDblClick: handleCardOpen };
  }

  // ── Grid area ──
  const gridArea = moEl('div', 'mo-grid-area');
  root.appendChild(gridArea);

  // Live-track scroll position for session restore
  gridArea.addEventListener('scroll', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('mo-grid')) {
      _lastScrollTop = e.target.scrollTop;
      saveSessionState();
    }
  }, true);

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
  const perPageDropdown = moDropdown({
    items: [
      { value: '20', label: '20/page' },
      { value: '40', label: '40/page' },
      { value: '80', label: '80/page' },
      { value: '120', label: '120/page' },
      { value: '500', label: '500/page' },
      { value: '2000', label: 'Auto (large)' },
    ],
    selected: String(state.perPage),
    ariaLabel: 'Items per page',
  });
  paginationBar.append(pageFirst, pagePrev, pageInfo, pageNext, pageLast, perPageDropdown.el);
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
    // M59 P3: rating max (used by "rating:<=4" / "rating:3..5")
    if (filters.ratingMax != null) {
      where.push(`${alias}.rating <= ?`);
      params.push(filters.ratingMax);
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

    // M59 P3: id whitelist from FTS / folder lookup
    const wl = alias === 'p' ? filters.idWhitelistPhotos : filters.idWhitelistVideos;
    if (wl != null) {
      if (wl.length === 0) {
        where.push('1 = 0'); // no matches
      } else {
        const placeholders = wl.map(() => '?').join(',');
        where.push(`${alias}.id IN (${placeholders})`);
        params.push(...wl);
      }
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
    } else if (filterType === 'duplicates') {
      photoJoinParts.push(` JOIN mo_photos_files dpf ON dpf.photo_id = p.id JOIN mo_fingerprints dfp ON dfp.file_id = dpf.file_id AND dfp.type = 'md5'`);
      photoWhere.push(`dfp.value IN (SELECT value FROM mo_fingerprints WHERE type = 'md5' GROUP BY value HAVING COUNT(DISTINCT file_id) > 1)`);
      videoJoinParts.push(` JOIN mo_videos_files dvf ON dvf.video_id = v.id JOIN mo_fingerprints dfv ON dfv.file_id = dvf.file_id AND dfv.type = 'md5'`);
      videoWhere.push(`dfv.value IN (SELECT value FROM mo_fingerprints WHERE type = 'md5' GROUP BY value HAVING COUNT(DISTINCT file_id) > 1)`);
    }

    // M59 P5: trash filter — exclude trashed by default, include only when filterType is 'trash'
    if (filterType === 'trash') {
      photoWhere.push('p.deleted_at IS NOT NULL');
      videoWhere.push('v.deleted_at IS NOT NULL');
    } else {
      photoWhere.push('p.deleted_at IS NULL');
      videoWhere.push('v.deleted_at IS NULL');
      // M59 P5: hide stack non-primary members from default views
      photoWhere.push(`NOT EXISTS (SELECT 1 FROM mo_stack_members sm WHERE sm.member_type = 'photo' AND sm.member_id = p.id AND sm.role <> 'primary')`);
      videoWhere.push(`NOT EXISTS (SELECT 1 FROM mo_stack_members sm WHERE sm.member_type = 'video' AND sm.member_id = v.id AND sm.role <> 'primary')`);
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
    } else if (filterType === 'duplicates') {
      const fileJoin = type === 'photo' ? 'mo_photos_files' : 'mo_videos_files';
      const fileCol = type === 'photo' ? 'photo_id' : 'video_id';
      joinParts.push(` JOIN ${fileJoin} djf ON djf.${fileCol} = ${alias}.id JOIN mo_fingerprints dfp ON dfp.file_id = djf.file_id AND dfp.type = 'md5'`);
      where.push(`dfp.value IN (SELECT value FROM mo_fingerprints WHERE type = 'md5' GROUP BY value HAVING COUNT(DISTINCT file_id) > 1)`);
    }

    // M59 P5: trash filter
    if (filterType === 'trash') {
      where.push(`${alias}.deleted_at IS NOT NULL`);
    } else {
      where.push(`${alias}.deleted_at IS NULL`);
      // M59 P5: hide stack non-primary members from default views
      const memType = type === 'photo' ? 'photo' : 'video';
      where.push(`NOT EXISTS (SELECT 1 FROM mo_stack_members sm WHERE sm.member_type = '${memType}' AND sm.member_id = ${alias}.id AND sm.role <> 'primary')`);
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

    const rawSearch = searchInput.value.trim();
    const safeColumn = MO_SAFE_SORT_COLUMNS[state.sortBy] || 'created_at';
    const safeDir = state.sortDir === 'ASC' ? 'ASC' : 'DESC';
    const limit = state.perPage;
    const offset = (state.currentPage - 1) * state.perPage;

    // M59 P3: parse search syntax (tag:, rating:, folder:, taken:, type:, free text → FTS)
    const parsed = moParseSearchQuery(rawSearch);

    // type:photo / type:video temporarily overrides mediaType for this query
    const effectiveMediaType = parsed.type || state.mediaType;

    // Search text fed into the legacy LIKE path is only the leftover free text
    // when FTS is NOT used (we'll prefer FTS for free text). Pass empty when FTS is used.
    const fallbackSearchText = '';

    let items = [];
    let totalCount = 0;

    // Resolve filter tag descendants (stash: hierarchical tag filtering via CTE)
    const resolvedFilters = {
      ratingMin: parsed.ratingMin != null ? parsed.ratingMin : state.filters.ratingMin,
      ratingMax: parsed.ratingMax,
      dateFrom: parsed.dateFrom || state.filters.dateFrom,
      dateTo: parsed.dateTo || state.filters.dateTo,
    };

    // Merge UI tag filters with parsed tag: operators
    const includeTagIds = [...state.filters.tagIds];
    const excludeTagIds = [...state.filters.excludeTagIds];
    if (parsed.tags.length) {
      const ids = await moResolveTagNames(parsed.tags);
      for (const id of ids) if (!includeTagIds.includes(id)) includeTagIds.push(id);
    }
    if (parsed.excludeTags.length) {
      const ids = await moResolveTagNames(parsed.excludeTags);
      for (const id of ids) if (!excludeTagIds.includes(id)) excludeTagIds.push(id);
    }

    if (includeTagIds.length > 0) {
      if (state.filters.tagDepth === -1) {
        // Include descendants — flatten all descendant IDs
        const allIds = new Set(includeTagIds);
        for (const tid of includeTagIds) {
          const desc = await TagQueries.getDescendants(tid);
          for (const d of desc) allIds.add(d.id);
        }
        resolvedFilters.resolvedTagIds = [...allIds];
      } else {
        resolvedFilters.resolvedTagIds = [...includeTagIds];
      }
    }
    if (excludeTagIds.length > 0) {
      if (state.filters.tagDepth === -1) {
        const allIds = new Set(excludeTagIds);
        for (const tid of excludeTagIds) {
          const desc = await TagQueries.getDescendants(tid);
          for (const d of desc) allIds.add(d.id);
        }
        resolvedFilters.resolvedExcludeTagIds = [...allIds];
      } else {
        resolvedFilters.resolvedExcludeTagIds = [...excludeTagIds];
      }
    }

    // M59 P3: FTS lookup → restrict to matching ids
    const ftsExpr = moBuildFtsMatch(parsed.freeText);
    if (ftsExpr) {
      const fts = await moFtsLookup(ftsExpr, 50000);
      resolvedFilters.idWhitelistPhotos = fts.photoIds;
      resolvedFilters.idWhitelistVideos = fts.videoIds;
    }

    // M59 P3: folder: operator → restrict ids
    if (parsed.folderTerm) {
      const fids = await moResolveFolderMatchIds(parsed.folderTerm);
      // Intersect with existing whitelist if any
      if (resolvedFilters.idWhitelistPhotos) {
        resolvedFilters.idWhitelistPhotos = resolvedFilters.idWhitelistPhotos.filter(id => fids.photoIds.includes(id));
      } else {
        resolvedFilters.idWhitelistPhotos = fids.photoIds;
      }
      if (resolvedFilters.idWhitelistVideos) {
        resolvedFilters.idWhitelistVideos = resolvedFilters.idWhitelistVideos.filter(id => fids.videoIds.includes(id));
      } else {
        resolvedFilters.idWhitelistVideos = fids.videoIds;
      }
    }

    try {
      if (effectiveMediaType === 'all') {
        // Unified UNION ALL query for correct pagination
        const q = buildUnifiedQuery(filterType, filterId, fallbackSearchText, safeColumn, safeDir, limit, offset, resolvedFilters);
        const rows = await db.all(q.dataQuery, q.dataParams);
        const countRow = await db.get(q.countQuery, q.countParams);
        items = (rows || []).map((r) => rowToMediaItem(r, null));
        totalCount = countRow ? countRow.count : 0;
      } else {
        // Single-type query (photos or videos)
        const q = buildSingleTypeQuery(effectiveMediaType === 'photos' ? 'photo' : 'video', filterType, filterId, fallbackSearchText, safeColumn, safeDir, limit, offset, resolvedFilters);
        const rows = await db.all(q.dataQuery, q.dataParams);
        const countRow = await db.get(q.countQuery, q.countParams);
        const type = effectiveMediaType === 'photos' ? 'photo' : 'video';
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

    // Scroll: reset on page change, restore on re-open
    const scrollEl = gridArea.querySelector('.mo-grid');
    if (scrollEl) {
      if (_scrollResetOnLoad) {
        scrollEl.scrollTop = 0;
        _lastScrollTop = 0;
      } else if (_lastScrollTop > 0) {
        // Defer restore to next frame so the grid has its full height
        const restoreTo = _lastScrollTop;
        requestAnimationFrame(() => { scrollEl.scrollTop = restoreTo; });
      }
    }
    _scrollResetOnLoad = true; // all subsequent loads reset to top

    // Persist state for session
    saveSessionState();
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
    // Single click: focus the card (keyboard shortcuts act on it)
    const idx = state.items.indexOf(item);
    if (idx >= 0) {
      state.focusedIndex = idx;
      if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
    }
  }

  // Double-click / Enter: open detail editor
  function handleCardOpen(item) {
    api.editors.openEditor({
      typeId: 'media-organizer-grid',
      title: item.title || `${item.type} #${item.id}`,
      icon: item.type === 'video' ? 'file-media' : 'image',
      instanceId: `detail:${item.type}:${item.id}`,
    });
  }

  // F7: Lightbox (context menu "View Full Size")
  function handleCardViewFullSize(item) {
    const idx = state.items.indexOf(item);
    openLightbox(state.items, idx >= 0 ? idx : 0, resolveItemFilePath);
  }

  // Initialize grid
  cardGrid = renderCardGrid(gridArea, [], refreshOpts());

  // M59 P3: respond to smart album save/open commands
  const _smartAlbumReplyHandler = () => {
    const ev = new CustomEvent('mo:reply-search-state', {
      detail: { query: searchInput.value || '', filters: state.filters },
    });
    document.dispatchEvent(ev);
  };
  document.addEventListener('mo:request-search-state', _smartAlbumReplyHandler);
  const _smartAlbumApplyHandler = (e) => {
    const parsed = e.detail || {};
    if (parsed.query != null) searchInput.value = parsed.query;
    if (parsed.filters) {
      state.filters = {
        tagIds: parsed.filters.tagIds || [],
        excludeTagIds: parsed.filters.excludeTagIds || [],
        tagDepth: parsed.filters.tagDepth || 0,
        ratingMin: parsed.filters.ratingMin != null ? parsed.filters.ratingMin : null,
        dateFrom: parsed.filters.dateFrom || null,
        dateTo: parsed.filters.dateTo || null,
      };
    }
    state.currentPage = 1;
    loadPage();
  };
  document.addEventListener('mo:apply-search-state', _smartAlbumApplyHandler);

  // M59 P5: respond to selection requests + grid refresh broadcasts
  const _selectionReplyHandler = () => {
    document.dispatchEvent(new CustomEvent('mo:reply-selection', {
      detail: { selectedIds: new Set(state.selectedIds) },
    }));
  };
  document.addEventListener('mo:request-selection', _selectionReplyHandler);
  const _gridRefreshHandler = () => { state.selectedIds.clear(); state.selecting = false; loadPage(); };
  document.addEventListener('mo:refresh-grid', _gridRefreshHandler);

  // Event handlers
  let searchTimer = null;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.currentPage = 1; loadPage(); }, 500);
  });

  sortDropdown.onChange = (value) => {
    state.sortBy = value;
    state.currentPage = 1;
    loadPage();
  };

  sortDirBtn.addEventListener('click', () => {
    state.sortDir = state.sortDir === 'DESC' ? 'ASC' : 'DESC';
    sortDirBtn.innerHTML = moIcon(state.sortDir === 'DESC' ? 'arrow-down' : 'arrow-up', 12);
    state.currentPage = 1;
    loadPage();
  });

  zoomSlider.addEventListener('input', () => {
    state.zoomWidth = parseInt(zoomSlider.value, 10);
    _sessionZoomWidth = state.zoomWidth;
    updateSliderFill();
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
  perPageDropdown.onChange = (value) => {
    state.perPage = parseInt(value, 10);
    state.currentPage = 1;
    loadPage();
  };

  // Sync UI controls to restored state
  if (cached) {
    sortDirBtn.innerHTML = moIcon(state.sortDir === 'DESC' ? 'arrow-down' : 'arrow-up', 12);
    if (state.displayMode === 'list') {
      listModeBtn.classList.add('active');
      gridModeBtn.classList.remove('active');
    }
  }

  // Initial load
  loadPage();

  // Helper: detect column count from CSS Grid auto-fill
  function getGridColumnCount() {
    const grid = gridArea.querySelector('.mo-grid');
    if (!grid || state.displayMode === 'list') return 1;
    const cols = getComputedStyle(grid).gridTemplateColumns;
    return cols ? cols.split(' ').length : 1;
  }

  // Helper: refresh grid + selection bar after state change
  function refreshAfterStateChange() {
    state.selecting = state.selectedIds.size > 0;
    if (selectionBar) selectionBar.update();
    if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
  }

  // F3: Bulk rate items by key (0-5)
  async function rateItemsByKey(rating) {
    const targetKeys = state.selectedIds.size > 0
      ? [...state.selectedIds]
      : (state.focusedIndex !== null && state.items[state.focusedIndex]
          ? [`${state.items[state.focusedIndex].type}:${state.items[state.focusedIndex].id}`]
          : []);
    if (targetKeys.length === 0) return;

    const photoIds = [];
    const videoIds = [];
    for (const k of targetKeys) {
      const [type, id] = k.split(':');
      if (type === 'photo') photoIds.push(parseInt(id, 10));
      else if (type === 'video') videoIds.push(parseInt(id, 10));
    }

    const txnOps = [];
    for (const id of photoIds) {
      txnOps.push({ type: 'run', sql: 'UPDATE mo_photos SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', params: [rating, id] });
    }
    for (const id of videoIds) {
      txnOps.push({ type: 'run', sql: 'UPDATE mo_videos SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', params: [rating, id] });
    }
    if (txnOps.length > 0) {
      await db.transaction(txnOps);
    }

    // Update local item data
    for (const item of state.items) {
      const k = `${item.type}:${item.id}`;
      if (targetKeys.includes(k)) item.rating = rating;
    }

    const stars = rating > 0 ? '\u2605'.repeat(rating) : '\u2606';
    if (_statusBarItem) {
      _statusBarItem.text = `Rated ${targetKeys.length} item${targetKeys.length > 1 ? 's' : ''} ${stars}`;
      _statusBarItem.show();
    }
    refreshAfterStateChange();
  }

  // Keyboard shortcuts for grid — adapted from stash: useListSelect + KeyboardShortcuts.md
  function handleGridKeydown(e) {
    // Skip when focus is in input/textarea/select
    const tag = e.target.tagName;
    const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    // Escape — deselect all (or clear focus)
    if (e.key === 'Escape') {
      if (state.selectedIds.size > 0) {
        state.selectedIds.clear();
        refreshAfterStateChange();
        e.preventDefault();
        return;
      }
      if (state.focusedIndex !== null) {
        state.focusedIndex = null;
        if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
        e.preventDefault();
        return;
      }
      return;
    }

    // Ctrl+A — select all on current page
    if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      for (const item of state.items) {
        state.selectedIds.add(`${item.type}:${item.id}`);
      }
      refreshAfterStateChange();
      return;
    }

    // Delete / Backspace — delete selected items (with confirmation)
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selectedIds.size > 0) {
      if (inInput) return;
      e.preventDefault();
      showBulkDeleteDialog(state, api, () => {
        if (selectionBar) selectionBar.update();
        loadPage();
      });
      return;
    }

    // Ctrl+I — invert selection
    if ((e.ctrlKey || e.metaKey) && e.key === 'i') {
      e.preventDefault();
      const newSel = new Set();
      for (const item of state.items) {
        const key = `${item.type}:${item.id}`;
        if (!state.selectedIds.has(key)) newSel.add(key);
      }
      state.selectedIds = newSel;
      refreshAfterStateChange();
      return;
    }

    // F2: Arrow key navigation
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && !inInput) {
      e.preventDefault();
      e.stopPropagation();
      if (state.items.length === 0) return;
      const cols = getGridColumnCount();
      const maxIdx = state.items.length - 1;
      let idx = state.focusedIndex ?? -1;

      if (e.key === 'ArrowRight') idx = Math.min(idx + 1, maxIdx);
      else if (e.key === 'ArrowLeft') idx = Math.max(idx - 1, 0);
      else if (e.key === 'ArrowDown') idx = Math.min(idx + cols, maxIdx);
      else if (e.key === 'ArrowUp') idx = Math.max(idx - cols, 0);
      else if (e.key === 'Home') idx = 0;
      else if (e.key === 'End') idx = maxIdx;

      if (idx < 0) idx = 0;

      // Shift+Arrow extends selection range
      if (e.shiftKey && state.items[idx]) {
        const key = `${state.items[idx].type}:${state.items[idx].id}`;
        state.selectedIds.add(key);
        state.selecting = true;
        if (selectionBar) selectionBar.update();
      }

      state.focusedIndex = idx;
      if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
      return;
    }

    // F2: Space — toggle selection on focused item
    if (e.key === ' ' && !inInput && state.focusedIndex !== null) {
      e.preventDefault();
      const item = state.items[state.focusedIndex];
      if (!item) return;
      const key = `${item.type}:${item.id}`;
      if (state.selectedIds.has(key)) state.selectedIds.delete(key);
      else state.selectedIds.add(key);
      refreshAfterStateChange();
      return;
    }

    // Enter — open detail editor for focused item
    if (e.key === 'Enter' && !inInput && state.focusedIndex !== null) {
      e.preventDefault();
      const item = state.items[state.focusedIndex];
      if (item) handleCardOpen(item);
      return;
    }

    // F3: Number keys 0-5 — set star rating
    if (!inInput && !e.ctrlKey && !e.metaKey && !e.altKey && e.key >= '0' && e.key <= '5') {
      e.preventDefault();
      rateItemsByKey(parseInt(e.key, 10));
      return;
    }

    // F8: Ctrl+Shift+E — open file location for focused item
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E' && !inInput && state.focusedIndex !== null) {
      e.preventDefault();
      const item = state.items[state.focusedIndex];
      if (item) {
        resolveItemFilePath(item).then(fp => {
          if (fp && window.parallxElectron?.shell?.showItemInFolder) {
            window.parallxElectron.shell.showItemInFolder(fp);
          }
        });
      }
      return;
    }
  }
  // ── Keyboard: capture-phase listener on document ──
  // Focus may land on an ancestor (.editor-group) rather than root,
  // so a bubble-phase listener on root would never fire.
  // We listen in capture phase and check that our pane is active.
  function isGridActive() {
    if (!root.isConnected) return false;
    // Hidden panes (inactive tabs) have offsetParent null
    if (root.offsetParent === null) return false;
    // Focus must be on root, inside root, on an ancestor that contains root, or on body
    const ae = document.activeElement;
    if (!ae || ae === document.body) return true;
    if (root.contains(ae)) return true;
    if (container.contains(ae)) return true;
    // Focus on an ancestor (e.g. .editor-group) that contains our container
    if (ae.contains && ae.contains(container)) return true;
    return false;
  }
  function docKeyHandler(e) {
    if (isGridActive()) {
      console.log('[MO-KEY]', e.key, 'ctrl:', e.ctrlKey, 'target:', e.target?.tagName, 'active:', document.activeElement?.tagName, document.activeElement?.className?.slice(0,40));
      handleGridKeydown(e);
    }
  }
  document.addEventListener('keydown', docKeyHandler, true);

  // Auto-focus root on click so interactive elements like stars keep working
  gridArea.addEventListener('mousedown', () => {
    requestAnimationFrame(() => {
      if (!root.contains(document.activeElement) || document.activeElement === document.body) {
        root.focus({ preventScroll: true });
      }
    });
  });
  // Focus root on initial load
  requestAnimationFrame(() => root.focus({ preventScroll: true }));
  async function resolveItemFilePath(item) {
    try {
      const type = item.type;
      const primary = type === 'photo'
        ? await db.get(`SELECT f.basename, fo.path AS folder_path FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id JOIN mo_folders fo ON fo.id = f.folder_id WHERE pf.photo_id = ? AND pf.is_primary = 1`, [item.id])
        : await db.get(`SELECT f.basename, fo.path AS folder_path FROM mo_videos_files vf JOIN mo_files f ON f.id = vf.file_id JOIN mo_folders fo ON fo.id = f.folder_id WHERE vf.video_id = ? AND vf.is_primary = 1`, [item.id]);
      if (primary) {
        const sep = primary.folder_path.includes('\\') ? '\\' : '/';
        return primary.folder_path.replace(/[\\/]+$/, '') + sep + primary.basename;
      }
    } catch { /* ignore */ }
    return null;
  }

  function buildContextMenuActions(item, isMulti) {
    const actions = [];
    if (!isMulti) {
      // Single-item actions
      actions.push({ label: 'View Full Size', handler: () => handleCardViewFullSize(item) });
      actions.push({ label: 'Edit Details', handler: () => handleCardOpen(item) });
      actions.push({ separator: true });
      actions.push({ label: 'Tag\u2026', handler: () => {
        const tmpState = { selectedIds: new Set([`${item.type}:${item.id}`]) };
        showBulkTagDialog(tmpState, api, () => loadPage());
      }});
      actions.push({ label: 'Rate', submenu: [
        { label: '\u2606 Clear', handler: () => rateItemsByKey(0) },
        { label: '\u2605', handler: () => rateItemsByKey(1) },
        { label: '\u2605\u2605', handler: () => rateItemsByKey(2) },
        { label: '\u2605\u2605\u2605', handler: () => rateItemsByKey(3) },
        { label: '\u2605\u2605\u2605\u2605', handler: () => rateItemsByKey(4) },
        { label: '\u2605\u2605\u2605\u2605\u2605', handler: () => rateItemsByKey(5) },
      ]});
      actions.push({ label: 'Add to Album\u2026', handler: () => {
        const tmpState = { selectedIds: new Set([`${item.type}:${item.id}`]) };
        showAddToAlbumDialog(tmpState, api, () => loadPage());
      }});
      actions.push({ separator: true });
      actions.push({ label: 'Open File Location', handler: async () => {
        const fp = await resolveItemFilePath(item);
        if (fp && window.parallxElectron?.shell?.showItemInFolder) {
          window.parallxElectron.shell.showItemInFolder(fp);
        }
      }});
      actions.push({ label: 'Copy File Path', handler: async () => {
        const fp = await resolveItemFilePath(item);
        if (fp) {
          try { await navigator.clipboard.writeText(fp); } catch { /* fallback */ }
        }
      }});
      actions.push({ separator: true });
      actions.push({ label: 'Delete\u2026', danger: true, handler: () => {
        const tmpState = { selectedIds: new Set([`${item.type}:${item.id}`]) };
        showBulkDeleteDialog(tmpState, api, () => loadPage());
      }});
    } else {
      // Multi-selection actions
      actions.push({ label: `${state.selectedIds.size} selected`, handler: () => {} });
      actions.push({ separator: true });
      actions.push({ label: 'Tag\u2026', handler: () => {
        showBulkTagDialog(state, api, () => { if (selectionBar) selectionBar.update(); loadPage(); });
      }});
      actions.push({ label: 'Rate', submenu: [
        { label: '\u2606 Clear', handler: () => rateItemsByKey(0) },
        { label: '\u2605', handler: () => rateItemsByKey(1) },
        { label: '\u2605\u2605', handler: () => rateItemsByKey(2) },
        { label: '\u2605\u2605\u2605', handler: () => rateItemsByKey(3) },
        { label: '\u2605\u2605\u2605\u2605', handler: () => rateItemsByKey(4) },
        { label: '\u2605\u2605\u2605\u2605\u2605', handler: () => rateItemsByKey(5) },
      ]});
      actions.push({ label: 'Add to Album\u2026', handler: () => {
        showAddToAlbumDialog(state, api, () => { if (selectionBar) selectionBar.update(); loadPage(); });
      }});
      actions.push({ separator: true });
      actions.push({ label: 'Delete\u2026', danger: true, handler: () => {
        showBulkDeleteDialog(state, api, () => { if (selectionBar) selectionBar.update(); loadPage(); });
      }});
    }
    return actions;
  }

  gridArea.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.mo-card, .mo-list-row');
    if (!el) return;
    e.preventDefault();

    // Find the item from data-key
    const key = el.dataset.key;
    if (!key) return;
    const item = state.items.find(i => `${i.type}:${i.id}` === key);
    if (!item) return;

    // If item is in current selection → multi-mode, otherwise single-item
    const isMulti = state.selectedIds.has(key) && state.selectedIds.size > 1;

    // If item is NOT in selection, focus on it and treat as single
    if (!state.selectedIds.has(key)) {
      state.focusedIndex = state.items.indexOf(item);
    }

    showContextMenu(e.clientX, e.clientY, buildContextMenuActions(item, isMulti));
  });

  // ── Drag-to-select (rubber band) ──
  const rubberBand = moEl('div', 'mo-rubber-band');
  gridArea.appendChild(rubberBand);
  let _drag = null;

  function rectsOverlap(a, b) {
    return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
  }

  gridArea.addEventListener('pointerdown', (e) => {
    // Only left button, only on grid background (not on a card/row/checkbox)
    if (e.button !== 0) return;
    const target = e.target;
    if (target.closest('.mo-card, .mo-list-row, .mo-card-select, .mo-list-select, button, input, select, a')) return;

    e.preventDefault();
    const rect = gridArea.getBoundingClientRect();
    const startX = e.clientX - rect.left + gridArea.scrollLeft;
    const startY = e.clientY - rect.top + gridArea.scrollTop;
    _drag = { startX, startY, rect, active: false };

    // Save pre-drag selection for additive mode (Ctrl held)
    _drag.additive = e.ctrlKey || e.metaKey;
    _drag.priorSelection = _drag.additive ? new Set(state.selectedIds) : new Set();

    gridArea.setPointerCapture(e.pointerId);
  });

  gridArea.addEventListener('pointermove', (e) => {
    if (!_drag) return;
    const rect = _drag.rect;
    const curX = e.clientX - rect.left + gridArea.scrollLeft;
    const curY = e.clientY - rect.top + gridArea.scrollTop;

    // Start showing rubber band after 4px of movement
    if (!_drag.active) {
      const dx = curX - _drag.startX;
      const dy = curY - _drag.startY;
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      _drag.active = true;
      rubberBand.style.display = 'block';
    }

    const left = Math.min(_drag.startX, curX);
    const top = Math.min(_drag.startY, curY);
    const width = Math.abs(curX - _drag.startX);
    const height = Math.abs(curY - _drag.startY);
    rubberBand.style.left = left + 'px';
    rubberBand.style.top = top + 'px';
    rubberBand.style.width = width + 'px';
    rubberBand.style.height = height + 'px';

    // Hit-test cards against rubber band rect
    const bandRect = { left, top, right: left + width, bottom: top + height };
    const newSelection = new Set(_drag.priorSelection);
    const grid = gridArea.querySelector('.mo-grid');
    if (grid) {
      const cards = grid.querySelectorAll('.mo-card, .mo-list-row');
      for (let i = 0; i < cards.length && i < state.items.length; i++) {
        const cardEl = cards[i];
        const cr = cardEl.getBoundingClientRect();
        // Convert card rect to gridArea-relative coords
        const cardRelRect = {
          left: cr.left - rect.left + gridArea.scrollLeft,
          top: cr.top - rect.top + gridArea.scrollTop,
          right: cr.right - rect.left + gridArea.scrollLeft,
          bottom: cr.bottom - rect.top + gridArea.scrollTop,
        };
        const item = state.items[i];
        const key = `${item.type}:${item.id}`;
        if (rectsOverlap(bandRect, cardRelRect)) {
          newSelection.add(key);
        } else if (!_drag.priorSelection.has(key)) {
          newSelection.delete(key);
        }
      }
    }
    state.selectedIds = newSelection;
    state.selecting = newSelection.size > 0;
    if (selectionBar) selectionBar.update();
    if (cardGrid) cardGrid.refresh(state.items, refreshOpts());
  });

  function endDrag() {
    if (!_drag) return;
    rubberBand.style.display = 'none';
    _drag = null;
  }
  gridArea.addEventListener('pointerup', endDrag);
  gridArea.addEventListener('pointercancel', endDrag);

  return {
    dispose() {
      clearTimeout(searchTimer);
      document.removeEventListener('keydown', docKeyHandler, true);
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
  // Toggle sidebar button
  const toggleBtn = moEl('button', 'mo-detail-nav-btn', { title: 'Toggle details panel' });
  toggleBtn.innerHTML = moIcon('panel-right', 12);
  toggleBtn.addEventListener('click', () => {
    const panel = headerEl.closest('.mo-detail-editor')?.querySelector('.mo-detail-panel');
    if (panel) panel.classList.toggle('mo-collapsed');
  });
  actions.appendChild(toggleBtn);

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
    buildVideoPlayer(wrap, ctx.fullPath, ctx);
  } else {
    buildPhotoPreview(wrap, ctx.fullPath);
  }
  return wrap;
}

function buildPhotoPreview(container, fullPath) {
  const img = moEl('img');
  img.alt = 'Photo preview';
  img.draggable = false;
  img.addEventListener('error', () => { img.style.display = 'none'; container.textContent = 'Failed to load image'; });
  container.appendChild(img);
  localFileToUrl(fullPath).then(url => {
    if (url) img.src = url;
    else { img.style.display = 'none'; container.textContent = 'Failed to load image'; }
  });

  // ── Scroll-to-zoom + pan ──
  let scale = 1;
  const MIN_SCALE = 1;
  const MAX_SCALE = 20;
  const ZOOM_FACTOR = 0.15;
  let tx = 0, ty = 0; // translate offsets

  function applyTransform() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    img.style.transformOrigin = '0 0';
    container.classList.toggle('mo-preview-zoomed', scale > 1);
  }

  container.addEventListener('wheel', (e) => {
    e.preventDefault();
    // Cursor position relative to the image's current rendered top-left
    const imgRect = img.getBoundingClientRect();
    const px = e.clientX - imgRect.left;
    const py = e.clientY - imgRect.top;

    const prevScale = scale;
    if (e.deltaY < 0) {
      scale = Math.min(MAX_SCALE, scale * (1 + ZOOM_FACTOR));
    } else {
      scale = Math.max(MIN_SCALE, scale / (1 + ZOOM_FACTOR));
    }

    // Shift so the point under the cursor stays fixed after scale change
    tx -= px * (scale / prevScale - 1);
    ty -= py * (scale / prevScale - 1);

    if (scale <= MIN_SCALE) { tx = 0; ty = 0; scale = MIN_SCALE; }
    applyTransform();
  }, { passive: false });

  // Pan via mouse drag when zoomed
  let dragging = false, dragStartX = 0, dragStartY = 0, startTx = 0, startTy = 0;

  container.addEventListener('mousedown', (e) => {
    if (scale <= MIN_SCALE) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    startTx = tx;
    startTy = ty;
    container.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    tx = startTx + (e.clientX - dragStartX);
    ty = startTy + (e.clientY - dragStartY);
    applyTransform();
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    container.style.cursor = '';
  });

  // Double-click to reset zoom
  container.addEventListener('dblclick', () => {
    scale = MIN_SCALE;
    tx = 0;
    ty = 0;
    applyTransform();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// M59 Phase 1: Custom video player
// Replaces native <video controls> with a ScreenToGif/YouTube-style player.
// Features: hover-preview thumbs, A-B loop, in/out trim markers, frame-by-frame
// stepping, J/K/L hotkeys, speed picker, capture frame, set as cover, trim→export.
// ─────────────────────────────────────────────────────────────────────────────

function moTimeStr(secs, withMs = false) {
  if (!Number.isFinite(secs) || secs < 0) secs = 0;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const base = h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
  if (!withMs) return base;
  const ms = Math.floor((secs - Math.floor(secs)) * 1000);
  return `${base}.${String(ms).padStart(3, '0')}`;
}

function buildVideoPlayer(container, fullPath, ctx) {
  container.classList.add('mo-player');
  container.tabIndex = 0; // make focusable for keyboard

  const video = document.createElement('video');
  video.preload = 'metadata';
  video.draggable = false;
  video.controls = false;
  video.className = 'mo-player-video';
  container.appendChild(video);

  // Hidden seek-preview video (separate element so seeking it doesn't disturb playback)
  const previewVid = document.createElement('video');
  previewVid.preload = 'metadata';
  previewVid.muted = true;
  previewVid.className = 'mo-player-preview-vid';
  container.appendChild(previewVid);

  // ── Top bar (auto-hide) ──
  const topBar = moEl('div', 'mo-player-topbar');
  const titleEl = moEl('div', 'mo-player-title');
  const filename = (ctx && ctx.primaryFile && ctx.primaryFile.basename) || (fullPath.split(/[\\/]/).pop() || '');
  titleEl.textContent = filename;
  const metaEl = moEl('div', 'mo-player-meta');
  topBar.append(titleEl, metaEl);
  container.appendChild(topBar);

  // ── Bottom bar (auto-hide) ──
  const bottomBar = moEl('div', 'mo-player-bottombar');
  // Progress row
  const progRow = moEl('div', 'mo-player-progrow');
  const progress = moEl('div', 'mo-player-progress');
  const progBuf = moEl('div', 'mo-player-progress-buf');
  const progPlayed = moEl('div', 'mo-player-progress-played');
  const inMark = moEl('div', 'mo-player-mark mo-player-mark-in');
  const outMark = moEl('div', 'mo-player-mark mo-player-mark-out');
  const loopRange = moEl('div', 'mo-player-loop-range');
  const progThumb = moEl('div', 'mo-player-progress-thumb');
  progress.append(progBuf, progPlayed, loopRange, inMark, outMark, progThumb);
  // Hover preview
  const hoverWrap = moEl('div', 'mo-player-hover');
  const hoverCanvas = document.createElement('canvas');
  hoverCanvas.width = 160; hoverCanvas.height = 90;
  hoverCanvas.className = 'mo-player-hover-canvas';
  const hoverTime = moEl('div', 'mo-player-hover-time');
  hoverWrap.append(hoverCanvas, hoverTime);
  progRow.append(progress, hoverWrap);
  bottomBar.appendChild(progRow);

  // Controls row
  const ctrlRow = moEl('div', 'mo-player-ctrlrow');
  const mkBtn = (icon, title, onClick) => {
    const b = moEl('button', 'mo-player-btn', { title });
    b.innerHTML = moIcon(icon, 14);
    b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
    return b;
  };

  const playBtn = mkBtn('play', 'Play / Pause (Space)', () => togglePlay());
  const skipBackBtn = mkBtn('chevron-left', 'Skip back 5s (J / ←)', () => seekBy(-5));
  const skipFwdBtn = mkBtn('chevron-right', 'Skip forward 5s (L / →)', () => seekBy(5));
  const frameBackBtn = mkBtn('debug-step-back', 'Previous frame (,)', () => stepFrame(-1));
  const frameFwdBtn = mkBtn('debug-step-over', 'Next frame (.)', () => stepFrame(1));

  const timeDisp = moEl('div', 'mo-player-time');
  timeDisp.textContent = '0:00 / 0:00';

  // Speed picker
  const speedWrap = moEl('div', 'mo-player-speed');
  const speedBtn = moEl('button', 'mo-player-btn mo-player-speed-btn', { title: 'Playback speed', textContent: '1×' });
  const speedMenu = moEl('div', 'mo-player-speed-menu mo-hidden');
  const speeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4];
  speeds.forEach(s => {
    const item = moEl('button', 'mo-player-speed-item', { textContent: s + '×' });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      video.playbackRate = s;
      speedBtn.textContent = s + '×';
      speedMenu.classList.add('mo-hidden');
    });
    speedMenu.appendChild(item);
  });
  speedBtn.addEventListener('click', (e) => { e.stopPropagation(); speedMenu.classList.toggle('mo-hidden'); });
  speedWrap.append(speedBtn, speedMenu);

  // Volume
  const volWrap = moEl('div', 'mo-player-vol');
  const muteBtn = mkBtn('unmute', 'Mute (M)', () => { video.muted = !video.muted; updateVolIcon(); });
  const volSlider = document.createElement('input');
  volSlider.type = 'range'; volSlider.min = '0'; volSlider.max = '1'; volSlider.step = '0.01'; volSlider.value = '1';
  volSlider.className = 'mo-player-vol-slider';
  volSlider.addEventListener('input', () => { video.volume = parseFloat(volSlider.value); video.muted = video.volume === 0; updateVolIcon(); });
  volWrap.append(muteBtn, volSlider);
  function updateVolIcon() {
    muteBtn.innerHTML = moIcon(video.muted || video.volume === 0 ? 'mute' : 'unmute', 14);
  }

  // In/out + A-B loop
  const inBtn = mkBtn('bookmark', 'Set in point ([)', () => setInPoint());
  const outBtn = mkBtn('bookmark', 'Set out point (])', () => setOutPoint());
  outBtn.style.transform = 'scaleX(-1)';
  const loopBtn = mkBtn('refresh', 'Toggle A-B loop', () => toggleLoop());

  const fsBtn = mkBtn('screen-full', 'Fullscreen (F)', () => toggleFullscreen());

  ctrlRow.append(playBtn, skipBackBtn, frameBackBtn, frameFwdBtn, skipFwdBtn, timeDisp, speedWrap, volWrap, inBtn, outBtn, loopBtn, fsBtn);
  bottomBar.appendChild(ctrlRow);
  container.appendChild(bottomBar);

  // ── Right action rail ──
  const rail = moEl('div', 'mo-player-rail');
  const captureBtn = moEl('button', 'mo-player-rail-btn', { title: 'Capture frame as photo' });
  captureBtn.innerHTML = moIcon('device-camera', 14);
  captureBtn.addEventListener('click', (e) => { e.stopPropagation(); moCaptureFrame(_api, fullPath, video.currentTime, ctx); });

  const coverBtn = moEl('button', 'mo-player-rail-btn', { title: 'Set as cover frame' });
  coverBtn.innerHTML = moIcon('image', 14);
  coverBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!ctx || !ctx.entity || !ctx.entity.checksum) {
      _api && _api.window.showWarningMessage('Cannot set cover — video has no fingerprint yet.');
      return;
    }
    coverBtn.disabled = true;
    try {
      const r = await generateVideoCoverFrame(
        ctx.entity.checksum, fullPath, video.duration || 0, _api, true, video.currentTime,
        video.videoWidth || 0, video.videoHeight || 0
      );
      if (r && r.generated) _api.window.showInformationMessage('Cover frame updated.');
      else _api.window.showErrorMessage('Failed to update cover frame.');
    } catch (err) {
      _api.window.showErrorMessage('Cover update error: ' + (err && err.message || err));
    } finally { coverBtn.disabled = false; }
  });

  const trimBtn = moEl('button', 'mo-player-rail-btn', { title: 'Trim → export clip / GIF' });
  trimBtn.innerHTML = moIcon('split-horizontal', 14);
  trimBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const inT = inPoint != null ? inPoint : 0;
    const outT = outPoint != null ? outPoint : (video.duration || 0);
    moOpenClipDialog(_api, fullPath, video.duration || 0, inT, outT);
  });

  rail.append(captureBtn, coverBtn, trimBtn);
  container.appendChild(rail);

  // ── State ──
  let inPoint = null;
  let outPoint = null;
  let loopActive = false;
  let nominalFps = 30; // updated from ffprobe later if available

  // Load video src
  localFileToUrl(fullPath).then(url => {
    if (!url) { container.textContent = 'Failed to load video'; return; }
    video.src = url;
    previewVid.src = url;
    video.load();
  });

  video.addEventListener('error', () => { container.textContent = 'Failed to load video'; });

  video.addEventListener('loadedmetadata', () => {
    metaEl.textContent = `${video.videoWidth || '?'}×${video.videoHeight || '?'}  ·  ${moTimeStr(video.duration)}`;
    timeDisp.textContent = `0:00 / ${moTimeStr(video.duration)}`;
    if (ctx && ctx.entity && ctx.entity.frame_rate) nominalFps = ctx.entity.frame_rate;
  });

  function setPlayingClass() {
    container.classList.toggle('mo-player-playing', !video.paused);
    playBtn.innerHTML = moIcon(video.paused ? 'play' : 'debug-pause', 14);
  }
  video.addEventListener('play', setPlayingClass);
  video.addEventListener('pause', setPlayingClass);

  function refreshTime() {
    const cur = video.currentTime || 0;
    const dur = video.duration || 0;
    timeDisp.textContent = `${moTimeStr(cur)} / ${moTimeStr(dur)}`;
    if (dur > 0) progPlayed.style.width = ((cur / dur) * 100) + '%';
    // Update buffered range
    try {
      if (video.buffered.length > 0 && dur > 0) {
        const end = video.buffered.end(video.buffered.length - 1);
        progBuf.style.width = ((end / dur) * 100) + '%';
      }
    } catch {}
    // A-B loop logic
    if (loopActive && inPoint != null && outPoint != null && cur >= outPoint) {
      video.currentTime = inPoint;
    }
  }
  video.addEventListener('timeupdate', refreshTime);
  video.addEventListener('progress', refreshTime);

  function togglePlay() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }

  function seekBy(delta) {
    const dur = video.duration || 0;
    video.currentTime = Math.max(0, Math.min(dur, (video.currentTime || 0) + delta));
  }

  function stepFrame(dir) {
    video.pause();
    const step = 1 / Math.max(1, nominalFps);
    seekBy(dir * step);
  }

  function setInPoint() {
    inPoint = video.currentTime;
    if (outPoint != null && inPoint > outPoint) outPoint = null;
    refreshMarks();
  }
  function setOutPoint() {
    outPoint = video.currentTime;
    if (inPoint != null && outPoint < inPoint) inPoint = null;
    refreshMarks();
  }
  function toggleLoop() {
    if (inPoint == null || outPoint == null) {
      _api && _api.window.showWarningMessage('Set in ([) and out (]) points first.');
      return;
    }
    loopActive = !loopActive;
    loopBtn.classList.toggle('mo-player-btn-active', loopActive);
  }
  function refreshMarks() {
    const dur = video.duration || 0;
    if (inPoint != null && dur > 0) { inMark.style.left = ((inPoint / dur) * 100) + '%'; inMark.style.display = 'block'; }
    else inMark.style.display = 'none';
    if (outPoint != null && dur > 0) { outMark.style.left = ((outPoint / dur) * 100) + '%'; outMark.style.display = 'block'; }
    else outMark.style.display = 'none';
    if (inPoint != null && outPoint != null && dur > 0) {
      const a = (inPoint / dur) * 100;
      const b = (outPoint / dur) * 100;
      loopRange.style.left = a + '%';
      loopRange.style.width = (b - a) + '%';
      loopRange.style.display = 'block';
    } else loopRange.style.display = 'none';
  }

  function toggleFullscreen() {
    if (document.fullscreenElement === container) document.exitFullscreen();
    else container.requestFullscreen().catch(() => {});
  }

  // ── Progress bar interaction ──
  function pctFromEvent(e) {
    const r = progress.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  }
  progress.addEventListener('click', (e) => {
    const dur = video.duration || 0;
    if (dur > 0) video.currentTime = pctFromEvent(e) * dur;
  });

  let scrubbing = false;
  progress.addEventListener('mousedown', (e) => { scrubbing = true; e.preventDefault(); });
  window.addEventListener('mousemove', (e) => {
    if (!scrubbing) return;
    const dur = video.duration || 0;
    if (dur > 0) video.currentTime = pctFromEvent(e) * dur;
  });
  window.addEventListener('mouseup', () => { scrubbing = false; });

  // Hover preview thumbnail
  let previewSeekToken = 0;
  progress.addEventListener('mousemove', (e) => {
    const dur = video.duration || 0;
    if (dur <= 0) return;
    const pct = pctFromEvent(e);
    const t = pct * dur;
    hoverWrap.style.display = 'block';
    const r = progress.getBoundingClientRect();
    hoverWrap.style.left = (e.clientX - r.left) + 'px';
    hoverTime.textContent = moTimeStr(t);
    progThumb.style.left = (pct * 100) + '%';
    progThumb.style.display = 'block';

    const myToken = ++previewSeekToken;
    try { previewVid.currentTime = t; } catch {}
    const onSeeked = () => {
      previewVid.removeEventListener('seeked', onSeeked);
      if (myToken !== previewSeekToken) return;
      try {
        const cctx = hoverCanvas.getContext('2d');
        cctx.drawImage(previewVid, 0, 0, hoverCanvas.width, hoverCanvas.height);
      } catch {}
    };
    previewVid.addEventListener('seeked', onSeeked);
  });
  progress.addEventListener('mouseleave', () => {
    hoverWrap.style.display = 'none';
    progThumb.style.display = 'none';
  });

  // ── Click-to-pause / dblclick fullscreen on video itself ──
  video.addEventListener('click', () => togglePlay());
  video.addEventListener('dblclick', () => toggleFullscreen());

  // ── Auto-hide top/bottom bars after 2.5s idle ──
  let hideTimer = null;
  function showChrome() {
    container.classList.remove('mo-player-chrome-hidden');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!video.paused) container.classList.add('mo-player-chrome-hidden');
    }, 2500);
  }
  container.addEventListener('mousemove', showChrome);
  container.addEventListener('mouseleave', () => { if (!video.paused) container.classList.add('mo-player-chrome-hidden'); });
  showChrome();

  // ── Keyboard shortcuts (only when player has focus or is fullscreen) ──
  function isFocused() {
    return document.activeElement === container || document.fullscreenElement === container;
  }
  const keyHandler = (e) => {
    if (!isFocused()) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    let handled = true;
    switch (e.key) {
      case ' ': case 'k': case 'K': togglePlay(); break;
      case 'j': case 'J': seekBy(-10); break;
      case 'l': case 'L': seekBy(10); break;
      case 'ArrowLeft': seekBy(e.shiftKey ? -1 : -5); break;
      case 'ArrowRight': seekBy(e.shiftKey ? 1 : 5); break;
      case ',': stepFrame(-1); break;
      case '.': stepFrame(1); break;
      case '[': setInPoint(); break;
      case ']': setOutPoint(); break;
      case 'm': case 'M': video.muted = !video.muted; updateVolIcon(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case '0': case '1': case '2': case '3': case '4': case '5': case '6': case '7': case '8': case '9':
        if (video.duration) video.currentTime = video.duration * (parseInt(e.key, 10) / 10);
        break;
      default: handled = false;
    }
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  };
  container.addEventListener('keydown', keyHandler);

  // ── Click container to focus for keyboard ──
  container.addEventListener('mousedown', () => container.focus());

  updateVolIcon();
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
          _notifySidebarRefresh();
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

  // Autocomplete for adding tags — pass getter so it always sees current list
  buildTagAutocomplete(wrap, () => currentTags, async (selectedTag) => {
    try {
      await Queries.updateTags(entityId, { mode: 'ADD', ids: [selectedTag.id] });
      currentTags.push(selectedTag);
      renderPills();
      _notifySidebarRefresh();
    } catch (err) { console.error('[MO-Detail] Tag add failed:', err); }
  });
}

function buildTagAutocomplete(container, getExistingTags, onAdd) {
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
      const existingIds = new Set(getExistingTags().map(t => t.id));
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
      const miniCard = moEl('div', 'mo-album-mini-card mo-card');
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
        const url = await localFileToUrl(result.path);
        if (url) img.src = url;
      }
    }
  } catch { /* thumbnail resolution failure */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 31A: LIGHTBOX / SLIDESHOW (F7)
// ═══════════════════════════════════════════════════════════════════════════════

let _activeLightbox = null;

function dismissLightbox() {
  if (_activeLightbox) {
    _activeLightbox.cleanup();
    _activeLightbox.el.remove();
    _activeLightbox = null;
  }
}

/**
 * Open a fullscreen lightbox starting at `startIndex` within `items`.
 * items: array of media items (from state.items).
 * resolveFilePath: async (item) => string|null — resolves the original file path.
 */
function openLightbox(items, startIndex, resolveFilePath) {
  dismissLightbox();
  if (!items || items.length === 0) return;

  let currentIdx = Math.max(0, Math.min(startIndex, items.length - 1));
  let slideshowTimer = null;
  let slideshowInterval = 0; // 0 = off

  // Zoom/pan state — adapted from src/built-in/editor/imageEditorPane.ts
  const LB_ZOOM_MIN = 0.1;
  const LB_ZOOM_MAX = 10;
  const LB_ZOOM_STEP = 0.1;
  let lbZoom = 1;
  let lbPanX = 0;
  let lbPanY = 0;
  let lbDragging = false;
  let lbDragStartX = 0;
  let lbDragStartY = 0;
  let lbPanStartX = 0;
  let lbPanStartY = 0;

  const overlay = moEl('div', 'mo-lightbox');
  const content = moEl('div', 'mo-lightbox-content');
  overlay.appendChild(content);

  // Close button
  const closeBtn = moEl('button', 'mo-lightbox-close', { textContent: '\u00D7' });
  closeBtn.addEventListener('click', dismissLightbox);
  content.appendChild(closeBtn);

  // Nav buttons
  const prevBtn = moEl('button', 'mo-lightbox-nav prev', { textContent: '\u2039' });
  const nextBtn = moEl('button', 'mo-lightbox-nav next', { textContent: '\u203A' });
  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(1));
  content.appendChild(prevBtn);
  content.appendChild(nextBtn);

  // Info bar
  const bar = moEl('div', 'mo-lightbox-bar');
  const titleEl = moEl('span', 'mo-lb-title');
  const ratingEl = moEl('span', 'mo-lb-rating');
  const counterEl = moEl('span', 'mo-lb-counter');
  const zoomIndicator = moEl('span', 'mo-lb-zoom-indicator');
  bar.append(titleEl, ratingEl, counterEl, zoomIndicator);

  // Slideshow controls
  const playBtn = moEl('button', null, { textContent: '\u25B6 Slideshow' });
  const speedDropdown = moDropdown({
    items: [
      { value: '3000', label: '3s' },
      { value: '5000', label: '5s' },
      { value: '10000', label: '10s' },
    ],
    selected: '5000',
    ariaLabel: 'Slideshow speed',
  });
  playBtn.addEventListener('click', () => {
    if (slideshowInterval > 0) {
      stopSlideshow();
    } else {
      slideshowInterval = parseInt(speedDropdown.getValue(), 10);
      startSlideshow();
    }
  });
  bar.append(playBtn, speedDropdown.el);
  overlay.appendChild(bar);

  // Zoom helpers
  function applyZoom() {
    if (!mediaEl) return;
    mediaEl.style.transform = `scale(${lbZoom}) translate(${lbPanX / lbZoom}px, ${lbPanY / lbZoom}px)`;
    const isZoomed = Math.abs(lbZoom - 1) > 0.01;
    content.classList.toggle('mo-lb-zoomed', isZoomed);
    zoomIndicator.textContent = isZoomed ? `${Math.round(lbZoom * 100)}%` : '';
  }

  function resetZoom() {
    lbZoom = 1;
    lbPanX = 0;
    lbPanY = 0;
    applyZoom();
  }

  function zoomBy(delta) {
    lbZoom = Math.round(Math.max(LB_ZOOM_MIN, Math.min(LB_ZOOM_MAX, lbZoom + delta)) * 100) / 100;
    if (lbZoom <= 1) { lbPanX = 0; lbPanY = 0; }
    applyZoom();
  }

  // Wheel zoom — scroll zooms toward cursor position (like image editors)
  content.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!mediaEl) return;

    const oldZoom = lbZoom;
    const delta = e.deltaY < 0 ? LB_ZOOM_STEP : -LB_ZOOM_STEP;
    lbZoom = Math.round(Math.max(LB_ZOOM_MIN, Math.min(LB_ZOOM_MAX, lbZoom + delta)) * 100) / 100;

    if (lbZoom <= 1) {
      // Snap back to center when at 1x or below
      lbPanX = 0;
      lbPanY = 0;
    } else {
      // Zoom toward cursor: adjust pan so the point under the cursor stays fixed
      const rect = content.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      const factor = lbZoom / oldZoom;
      lbPanX = cx - factor * (cx - lbPanX);
      lbPanY = cy - factor * (cy - lbPanY);
    }

    applyZoom();
  }, { passive: false });

  // Double-click to reset zoom
  content.addEventListener('dblclick', (e) => {
    if (e.target === closeBtn || e.target === prevBtn || e.target === nextBtn) return;
    e.preventDefault();
    if (Math.abs(lbZoom - 1) > 0.01) {
      resetZoom();
    } else {
      zoomBy(1); // zoom to 2x on double-click when at 1x
    }
  });

  // Drag to pan when zoomed
  content.addEventListener('mousedown', (e) => {
    if (lbZoom <= 1.01 || e.button !== 0) return;
    if (e.target === closeBtn || e.target === prevBtn || e.target === nextBtn) return;
    lbDragging = true;
    lbDragStartX = e.clientX;
    lbDragStartY = e.clientY;
    lbPanStartX = lbPanX;
    lbPanStartY = lbPanY;
    content.classList.add('mo-lb-dragging');
    e.preventDefault();
  });

  function onDragMove(e) {
    if (!lbDragging) return;
    lbPanX = lbPanStartX + (e.clientX - lbDragStartX);
    lbPanY = lbPanStartY + (e.clientY - lbDragStartY);
    applyZoom();
  }

  function onDragEnd() {
    if (!lbDragging) return;
    lbDragging = false;
    content.classList.remove('mo-lb-dragging');
  }

  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragEnd);

  // Media display element
  let mediaEl = null;
  // Preload cache
  const preloadCache = new Map();

  async function preloadItem(idx) {
    if (idx < 0 || idx >= items.length) return;
    const item = items[idx];
    const cacheKey = `${item.type}:${item.id}`;
    if (preloadCache.has(cacheKey)) return;
    const fp = await resolveFilePath(item);
    if (fp) {
      const url = await localFileToUrl(fp);
      if (url) preloadCache.set(cacheKey, { url, type: item.type });
    }
  }

  async function showItem(idx) {
    const item = items[idx];
    const cacheKey = `${item.type}:${item.id}`;

    // Remove old media
    if (mediaEl) { mediaEl.remove(); mediaEl = null; }

    // Reset zoom when changing items
    resetZoom();

    // Resolve URL
    let cached = preloadCache.get(cacheKey);
    if (!cached) {
      const fp = await resolveFilePath(item);
      if (fp) {
        const url = await localFileToUrl(fp);
        if (url) {
          cached = { url, type: item.type };
          preloadCache.set(cacheKey, cached);
        }
      }
    }

    if (cached) {
      if (cached.type === 'video') {
        mediaEl = moEl('video');
        mediaEl.src = cached.url;
        mediaEl.controls = true;
        mediaEl.autoplay = true;
      } else {
        mediaEl = moEl('img');
        mediaEl.src = cached.url;
        mediaEl.alt = item.title || '';
        mediaEl.draggable = false;
      }
      // Insert before close button
      content.insertBefore(mediaEl, closeBtn);
    }

    // Update info bar
    const title = item.title || (item.filePath ? item.filePath.split(/[/\\]/).pop() : `${item.type} #${item.id}`);
    titleEl.textContent = title;
    ratingEl.textContent = item.rating > 0 ? '\u2605'.repeat(item.rating) : '';
    counterEl.textContent = `${idx + 1} of ${items.length}`;

    // Nav button visibility
    prevBtn.style.display = idx > 0 ? '' : 'none';
    nextBtn.style.display = idx < items.length - 1 ? '' : 'none';

    // Preload adjacent
    preloadItem(idx - 1);
    preloadItem(idx + 1);
  }

  function navigate(delta) {
    const newIdx = currentIdx + delta;
    if (newIdx < 0 || newIdx >= items.length) return;
    currentIdx = newIdx;
    showItem(currentIdx);
  }

  function startSlideshow() {
    playBtn.textContent = '\u23F8 Pause';
    playBtn.classList.add('active');
    slideshowTimer = setInterval(() => {
      if (currentIdx < items.length - 1) navigate(1);
      else stopSlideshow();
    }, slideshowInterval);
  }

  function stopSlideshow() {
    slideshowInterval = 0;
    clearInterval(slideshowTimer);
    slideshowTimer = null;
    playBtn.textContent = '\u25B6 Slideshow';
    playBtn.classList.remove('active');
  }

  function onKey(e) {
    e.stopPropagation(); // Prevent Parallx keybinding service from intercepting
    if (e.key === 'Escape') { dismissLightbox(); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft') { navigate(-1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { navigate(1); e.preventDefault(); return; }
    // Zoom keys: +/- and 0 to reset
    if (e.key === '+' || e.key === '=') { zoomBy(LB_ZOOM_STEP); e.preventDefault(); return; }
    if (e.key === '-' || e.key === '_') { zoomBy(-LB_ZOOM_STEP); e.preventDefault(); return; }
    if (e.key === '0' && !e.ctrlKey) { resetZoom(); e.preventDefault(); return; }
  }

  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(overlay);

  _activeLightbox = {
    el: overlay,
    cleanup() {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      if (slideshowTimer) clearInterval(slideshowTimer);
    }
  };

  showItem(currentIdx);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 31B: CONTEXT MENU (F1)
// ═══════════════════════════════════════════════════════════════════════════════

let _activeContextMenu = null;

function dismissContextMenu() {
  if (_activeContextMenu) {
    _activeContextMenu.remove();
    _activeContextMenu = null;
  }
}

/**
 * Show a context menu at (x, y) with the given action definitions.
 * Each action: { label, icon?, handler?, danger?, separator?, submenu?: [{ label, handler }] }
 */
function showContextMenu(x, y, actions) {
  dismissContextMenu();
  const menu = moEl('div', 'mo-context-menu');
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;

  for (const action of actions) {
    if (action.separator) {
      menu.appendChild(moEl('div', 'mo-context-menu-sep'));
      continue;
    }
    if (action.submenu) {
      const sub = moEl('div', 'mo-context-menu-sub');
      const trigger = moEl('div', `mo-context-menu-item${action.danger ? ' mo-ctx-danger' : ''}`);
      trigger.textContent = action.label;
      trigger.appendChild(moEl('span', 'mo-ctx-arrow', { textContent: '\u25B8' }));
      sub.appendChild(trigger);
      const subMenu = moEl('div', 'mo-context-submenu');
      for (const si of action.submenu) {
        const subItem = moEl('div', 'mo-context-menu-item');
        subItem.textContent = si.label;
        subItem.addEventListener('click', (e) => {
          e.stopPropagation();
          dismissContextMenu();
          si.handler();
        });
        subMenu.appendChild(subItem);
      }
      sub.appendChild(subMenu);
      menu.appendChild(sub);
    } else {
      const item = moEl('div', `mo-context-menu-item${action.danger ? ' mo-ctx-danger' : ''}`);
      item.textContent = action.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissContextMenu();
        action.handler();
      });
      menu.appendChild(item);
    }
  }

  document.body.appendChild(menu);
  _activeContextMenu = menu;

  // Clamp to viewport
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = `${window.innerWidth - rect.width - 4}px`;
  if (rect.bottom > window.innerHeight) menu.style.top = `${window.innerHeight - rect.height - 4}px`;

  // Dismiss on outside click / Escape / scroll
  setTimeout(() => {
    function onDismiss(ev) {
      if (ev && ev.target && menu.contains(ev.target)) return; // click inside menu — don't dismiss
      dismissContextMenu(); cleanup();
    }
    function onKey(ev) { if (ev.key === 'Escape') { dismissContextMenu(); cleanup(); ev.preventDefault(); } }
    function cleanup() {
      document.removeEventListener('pointerdown', onDismiss);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onDismiss, true);
    }
    document.addEventListener('pointerdown', onDismiss);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onDismiss, true);
  }, 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 32: BULK OPERATIONS (F33, F34)
// ═══════════════════════════════════════════════════════════════════════════════
// Adapted from stash: ui/v2.5/src/components/List/useListSelect, EditGalleriesDialog, MultiSet

// F9: Batch Export — copy selected files to a chosen folder
async function exportSelectedItems(state, api) {
  if (!state.selectedIds || state.selectedIds.size === 0) return;
  const pe = window.parallxElectron;
  if (!pe || !pe.dialog || !pe.fs) return;

  // Pick destination folder
  const destFolder = await pe.dialog.openFolder({ title: 'Export — Choose Destination Folder' });
  if (!destFolder) return;

  const { photos, videos } = parseSelectedIds(state.selectedIds);
  const db = _db;
  let copied = 0;
  let failed = 0;

  api.statusBar.setMessage(`Exporting ${state.selectedIds.size} file(s)…`, 0);

  for (const id of photos) {
    try {
      const row = await db.get(`SELECT f.basename, fo.path AS folder_path FROM mo_photos_files pf JOIN mo_files f ON f.id = pf.file_id JOIN mo_folders fo ON fo.id = f.folder_id WHERE pf.photo_id = ? AND pf.is_primary = 1`, [id]);
      if (row) {
        const sep = row.folder_path.includes('\\') ? '\\' : '/';
        const srcPath = row.folder_path.replace(/[\\/]+$/, '') + sep + row.basename;
        const destPath = destFolder + sep + row.basename;
        const read = await pe.fs.readFile(srcPath);
        if (!read.error) {
          await pe.fs.writeFile(destPath, read.content, read.encoding || 'base64');
          copied++;
        } else failed++;
      }
    } catch { failed++; }
  }

  for (const id of videos) {
    try {
      const row = await db.get(`SELECT f.basename, fo.path AS folder_path FROM mo_videos_files vf JOIN mo_files f ON f.id = vf.file_id JOIN mo_folders fo ON fo.id = f.folder_id WHERE vf.video_id = ? AND vf.is_primary = 1`, [id]);
      if (row) {
        const sep = row.folder_path.includes('\\') ? '\\' : '/';
        const srcPath = row.folder_path.replace(/[\\/]+$/, '') + sep + row.basename;
        const destPath = destFolder + sep + row.basename;
        const read = await pe.fs.readFile(srcPath);
        if (!read.error) {
          await pe.fs.writeFile(destPath, read.content, read.encoding || 'base64');
          copied++;
        } else failed++;
      }
    } catch { failed++; }
  }

  const msg = failed > 0
    ? `Exported ${copied} file(s), ${failed} failed`
    : `Exported ${copied} file(s) to ${destFolder}`;
  api.statusBar.setMessage(msg, 5000);
}

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

  // F9: Export button
  const exportBtn = moEl('button', null, { textContent: 'Export...' });
  exportBtn.addEventListener('click', () => {
    exportSelectedItems(state, api);
  });
  bar.appendChild(exportBtn);

  // Delete button
  const deleteBtn = moEl('button', 'mo-sel-delete', { textContent: 'Delete...' });
  deleteBtn.addEventListener('click', () => {
    showBulkDeleteDialog(state, api, () => { updateBar(); refreshFn(); });
  });
  bar.appendChild(deleteBtn);

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
  const bulkTagDropdown = moDropdown({
    items: [],
    placeholder: 'Select a tag...',
    ariaLabel: 'Select tag',
  });
  tagSection.appendChild(bulkTagDropdown.el);
  dialog.appendChild(tagSection);

  // Load tags
  TagQueries.findMany({}, { field: 'name', direction: 'ASC' }, { page: 1, perPage: 500 })
    .then(result => {
      bulkTagDropdown.setItems(result.items.map(tag => ({ value: String(tag.id), label: tag.name })));
    })
    .catch(() => {});

  // Footer
  const footer = moEl('div', 'mo-bulk-dialog-footer');
  const cancelBtn = moEl('button', null, { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  const applyBtn = moEl('button', 'primary', { textContent: 'Apply' });
  applyBtn.addEventListener('click', async () => {
    const tagId = parseInt(bulkTagDropdown.getValue(), 10);
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
  const bulkAlbumDropdown = moDropdown({
    items: [],
    placeholder: 'Select an album...',
    ariaLabel: 'Select album',
  });
  albumSection.appendChild(bulkAlbumDropdown.el);
  dialog.appendChild(albumSection);

  // Load albums (manual collections only — folderId IS NULL)
  AlbumQueries.findMany({ folderId: null }, { field: 'title', direction: 'ASC' }, { page: 1, perPage: 500 })
    .then(result => {
      bulkAlbumDropdown.setItems(result.items.map(album => ({ value: String(album.id), label: album.title || `Album #${album.id}` })));
    })
    .catch(() => {});

  const footer = moEl('div', 'mo-bulk-dialog-footer');
  const cancelBtn = moEl('button', null, { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  const applyBtn = moEl('button', 'primary', { textContent: 'Add' });
  applyBtn.addEventListener('click', async () => {
    const albumId = parseInt(bulkAlbumDropdown.getValue(), 10);
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

// Bulk delete confirmation dialog
function showBulkDeleteDialog(state, api, onComplete) {
  const overlay = moEl('div', 'mo-bulk-dialog-overlay');
  const dialog = moEl('div', 'mo-bulk-dialog');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Delete Items');
  overlay.appendChild(dialog);

  const count = state.selectedIds.size;
  dialog.appendChild(moEl('h3', null, { textContent: `Delete ${count} item${count !== 1 ? 's' : ''}?` }));
  dialog.appendChild(moEl('p', 'mo-bulk-dialog-warn', {
    textContent: 'This will remove the selected items from the Media Organizer database. Original files on disk will NOT be deleted.',
  }));

  const footer = moEl('div', 'mo-bulk-dialog-footer');
  const cancelBtn = moEl('button', null, { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  const confirmBtn = moEl('button', 'mo-sel-delete', { textContent: 'Delete' });
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled = true;
    cancelBtn.disabled = true;
    confirmBtn.textContent = 'Deleting…';
    const { photos, videos } = parseSelectedIds(state.selectedIds);
    try {
      for (const id of photos) await PhotoQueries.destroy(id);
      for (const id of videos) await VideoQueries.destroy(id);
      state.selectedIds.clear();
      state.selecting = false;
      api.window.showInformationMessage(`${photos.length + videos.length} item(s) deleted.`);
      overlay.remove();
      onComplete();
    } catch (err) {
      confirmBtn.disabled = false;
      cancelBtn.disabled = false;
      confirmBtn.textContent = 'Delete';
      api.window.showErrorMessage('Delete failed: ' + err.message);
    }
  });
  footer.append(cancelBtn, confirmBtn);
  dialog.appendChild(footer);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') overlay.remove(); });
  document.body.appendChild(overlay);
  overlay.setAttribute('tabindex', '-1');
  overlay.focus();
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10.5: M59 PHASE 1 — CLIP/GIF EXPORT, FRAME CAPTURE, WEBP CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Frame capture: extract still from video, save next to source, link to video ──
async function moCaptureFrame(api, videoPath, timestampSec, ctx) {
  if (!_toolPaths.ffmpeg) {
    api.window.showErrorMessage('ffmpeg not available — cannot capture frames.');
    return;
  }
  if (!ctx || !ctx.entity || !ctx.entity.id) {
    api.window.showErrorMessage('Cannot capture frame — video context missing.');
    return;
  }
  const sep = _isWindows ? '\\' : '/';
  const lastSep = videoPath.lastIndexOf(sep);
  const dir = videoPath.slice(0, lastSep);
  const base = videoPath.slice(lastSep + 1).replace(/\.[^.]+$/, '');
  const ts = moTimeStr(timestampSec, true).replace(/[:.]/g, '-');
  const outPath = `${dir}${sep}${base}_frame_${ts}.jpg`;

  const cmd = [
    shellQuote(_toolPaths.ffmpeg),
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', String(timestampSec),
    '-i', shellQuote(videoPath),
    '-frames:v', '1',
    '-q:v', '2',
    shellQuote(outPath),
  ].join(' ');
  try {
    const r = await window.parallxElectron.terminal.exec(cmd, { timeout: 30000 });
    if (r.exitCode !== 0) {
      api.window.showErrorMessage('Frame capture failed: ' + (r.stderr || 'ffmpeg error'));
      return;
    }
    api.window.showInformationMessage('Frame captured: ' + outPath.split(sep).pop());
    // Trigger a delta-scan of the folder so the new frame becomes a Photo entry.
    // The mo_video_frames link will be populated by the watcher in a follow-up
    // (Phase 1 keeps it simple — the user's filesystem now has the frame).
  } catch (err) {
    api.window.showErrorMessage('Frame capture error: ' + (err && err.message || err));
  }
}

// ─── Clip / GIF export dialog ──────────────────────────────────────────────────
function moOpenClipDialog(api, videoPath, duration, initialIn, initialOut) {
  if (!_toolPaths.ffmpeg) {
    api.window.showErrorMessage('ffmpeg not available — cannot export clips.');
    return;
  }
  if (!duration || duration <= 0) {
    api.window.showErrorMessage('Video duration unknown — cannot export.');
    return;
  }

  const overlay = moEl('div', 'mo-modal-overlay');
  const dialog = moEl('div', 'mo-modal mo-clip-dialog');
  overlay.appendChild(dialog);

  const header = moEl('div', 'mo-modal-header');
  header.appendChild(moEl('div', 'mo-modal-title', { textContent: 'Export Clip / GIF' }));
  const closeBtn = moEl('button', 'mo-modal-close', { textContent: '×' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  // Preview video (loops over selected range)
  const preview = document.createElement('video');
  preview.className = 'mo-clip-preview';
  preview.muted = true;
  preview.loop = false;
  preview.controls = false;
  localFileToUrl(videoPath).then(u => { if (u) preview.src = u; });
  dialog.appendChild(preview);

  const body = moEl('div', 'mo-clip-body');
  dialog.appendChild(body);

  // ── M59 P2: Frame strip + waveform timeline ──
  // State for per-frame edits (only honored when format=gif on export)
  /** @type {Array<{ index: number, src: string, deleted: boolean, delayMs: number|null }>} */
  let frames = [];
  let revFrames = false;
  const stripWrap = moEl('div', 'mo-clip-stripwrap');
  const stripWave = document.createElement('img');
  stripWave.className = 'mo-clip-wave';
  stripWave.alt = '';
  stripWave.style.display = 'none';
  stripWrap.appendChild(stripWave);
  const stripEl = moEl('div', 'mo-clip-framestrip');
  stripEl.title = 'Click frame to set per-frame delay (GIF). Right-click to delete (GIF).';
  stripWrap.appendChild(stripEl);
  const stripStatus = moEl('div', 'mo-clip-strip-status', { textContent: 'Loading frames…' });
  stripWrap.appendChild(stripStatus);
  body.appendChild(stripWrap);

  // ── In/Out controls ──
  const ioRow = moEl('div', 'mo-clip-row');
  ioRow.appendChild(moEl('label', 'mo-clip-label', { textContent: 'In' }));
  const inInput = document.createElement('input');
  inInput.type = 'number'; inInput.step = '0.01'; inInput.min = '0'; inInput.max = String(duration);
  inInput.value = String(Math.max(0, initialIn || 0));
  inInput.className = 'mo-clip-input';
  ioRow.appendChild(inInput);
  ioRow.appendChild(moEl('label', 'mo-clip-label', { textContent: 'Out' }));
  const outInput = document.createElement('input');
  outInput.type = 'number'; outInput.step = '0.01'; outInput.min = '0'; outInput.max = String(duration);
  outInput.value = String(initialOut > 0 ? initialOut : duration);
  outInput.className = 'mo-clip-input';
  ioRow.appendChild(outInput);
  const lengthLabel = moEl('span', 'mo-clip-length');
  ioRow.appendChild(lengthLabel);
  body.appendChild(ioRow);

  // ── Format picker ──
  const fmtRow = moEl('div', 'mo-clip-row');
  fmtRow.appendChild(moEl('label', 'mo-clip-label', { textContent: 'Format' }));
  const fmtSel = document.createElement('select');
  fmtSel.className = 'mo-clip-input';
  for (const f of ['mp4', 'webm', 'gif']) {
    const o = document.createElement('option'); o.value = f; o.textContent = f.toUpperCase();
    if (f === 'mp4') o.selected = true;
    fmtSel.appendChild(o);
  }
  fmtRow.appendChild(fmtSel);
  body.appendChild(fmtRow);

  // ── FPS ──
  const fpsRow = moEl('div', 'mo-clip-row');
  fpsRow.appendChild(moEl('label', 'mo-clip-label', { textContent: 'FPS' }));
  const fpsSel = document.createElement('select');
  fpsSel.className = 'mo-clip-input';
  for (const f of [10, 15, 24, 30, 60]) {
    const o = document.createElement('option'); o.value = String(f); o.textContent = String(f);
    if (f === 30) o.selected = true;
    fpsSel.appendChild(o);
  }
  fpsRow.appendChild(fpsSel);
  body.appendChild(fpsRow);

  // ── Size scale ──
  const sizeRow = moEl('div', 'mo-clip-row');
  sizeRow.appendChild(moEl('label', 'mo-clip-label', { textContent: 'Scale (%)' }));
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number'; sizeInput.min = '10'; sizeInput.max = '200'; sizeInput.value = '100'; sizeInput.step = '5';
  sizeInput.className = 'mo-clip-input';
  sizeRow.appendChild(sizeInput);
  body.appendChild(sizeRow);

  // ── Speed ──
  const speedRow = moEl('div', 'mo-clip-row');
  speedRow.appendChild(moEl('label', 'mo-clip-label', { textContent: 'Speed' }));
  const speedSel = document.createElement('select');
  speedSel.className = 'mo-clip-input';
  for (const s of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4]) {
    const o = document.createElement('option'); o.value = String(s); o.textContent = s + '×';
    if (s === 1) o.selected = true;
    speedSel.appendChild(o);
  }
  speedRow.appendChild(speedSel);
  body.appendChild(speedRow);

  // ── Reverse ──
  const revRow = moEl('div', 'mo-clip-row');
  const revChk = document.createElement('input');
  revChk.type = 'checkbox'; revChk.id = 'mo-clip-rev'; revChk.className = 'mo-clip-check';
  revRow.appendChild(revChk);
  const revLabel = moEl('label', 'mo-clip-label', { textContent: 'Reverse' });
  revLabel.htmlFor = 'mo-clip-rev';
  revRow.appendChild(revLabel);
  // M59 P2: reverse-individual-frames (only honored for GIF when frame strip edits are applied)
  const revFrChk = document.createElement('input');
  revFrChk.type = 'checkbox'; revFrChk.id = 'mo-clip-rev-frames'; revFrChk.className = 'mo-clip-check';
  revFrChk.style.marginLeft = '16px';
  revFrChk.addEventListener('change', () => { revFrames = revFrChk.checked; });
  revRow.appendChild(revFrChk);
  const revFrLabel = moEl('label', 'mo-clip-label', { textContent: 'Reverse frame order (GIF)' });
  revFrLabel.htmlFor = 'mo-clip-rev-frames';
  revFrLabel.title = 'Reverses the order of edited frames in GIF export (frame strip)';
  revRow.appendChild(revFrLabel);
  body.appendChild(revRow);

  // ── GIF-only quality controls (hidden unless format=gif) ──
  const gifBox = moEl('div', 'mo-clip-row mo-clip-gif-only');
  gifBox.appendChild(moEl('label', 'mo-clip-label', { textContent: 'Dither' }));
  const ditherSel = document.createElement('select');
  ditherSel.className = 'mo-clip-input';
  for (const d of [['none', 'None'], ['bayer', 'Bayer'], ['floyd_steinberg', 'Floyd-Steinberg']]) {
    const o = document.createElement('option'); o.value = d[0]; o.textContent = d[1];
    if (d[0] === 'bayer') o.selected = true;
    ditherSel.appendChild(o);
  }
  gifBox.appendChild(ditherSel);
  gifBox.appendChild(moEl('label', 'mo-clip-label', { textContent: 'Loop' }));
  const loopInput = document.createElement('input');
  loopInput.type = 'number'; loopInput.min = '0'; loopInput.max = '100'; loopInput.value = '0';
  loopInput.className = 'mo-clip-input'; loopInput.title = '0 = infinite';
  gifBox.appendChild(loopInput);
  body.appendChild(gifBox);

  // ── MP4/WebM CRF ──
  const crfBox = moEl('div', 'mo-clip-row mo-clip-vid-only');
  crfBox.appendChild(moEl('label', 'mo-clip-label', { textContent: 'Quality (CRF)' }));
  const crfInput = document.createElement('input');
  crfInput.type = 'number'; crfInput.min = '15'; crfInput.max = '35'; crfInput.value = '23';
  crfInput.className = 'mo-clip-input'; crfInput.title = 'Lower = better quality, larger file';
  crfBox.appendChild(crfInput);
  body.appendChild(crfBox);

  function syncFormatVisibility() {
    const isGif = fmtSel.value === 'gif';
    gifBox.style.display = isGif ? '' : 'none';
    crfBox.style.display = isGif ? 'none' : '';
  }
  fmtSel.addEventListener('change', syncFormatVisibility);
  syncFormatVisibility();

  // ── Length display + preview loop ──
  function updateLength() {
    const a = Math.max(0, parseFloat(inInput.value) || 0);
    const b = Math.min(duration, parseFloat(outInput.value) || duration);
    const len = Math.max(0, b - a);
    lengthLabel.textContent = `(${len.toFixed(2)}s)`;
  }
  inInput.addEventListener('input', updateLength);
  outInput.addEventListener('input', updateLength);
  updateLength();

  let previewTimer = null;
  function loopPreview() {
    if (previewTimer) clearInterval(previewTimer);
    const a = Math.max(0, parseFloat(inInput.value) || 0);
    const b = Math.min(duration, parseFloat(outInput.value) || duration);
    if (b <= a) return;
    try { preview.currentTime = a; preview.play().catch(() => {}); } catch {}
    previewTimer = setInterval(() => {
      if (preview.currentTime >= b) {
        try { preview.currentTime = a; preview.play().catch(() => {}); } catch {}
      }
    }, 200);
  }
  preview.addEventListener('loadedmetadata', loopPreview);
  inInput.addEventListener('change', loopPreview);
  outInput.addEventListener('change', loopPreview);

  // ── M59 P2: Frame strip + waveform generator ──
  const FRAME_COUNT = 30;
  const sepCh = _isWindows ? '\\' : '/';
  let stripDir = null;
  let stripGen = 0;

  async function ensureStripDir() {
    if (stripDir) return stripDir;
    const base = await getThumbDir();
    if (!base) return null;
    stripDir = base + sepCh + '.clipstrip-' + Date.now();
    await window.parallxElectron.fs.mkdir(stripDir);
    return stripDir;
  }

  function clearStrip() {
    while (stripEl.firstChild) stripEl.removeChild(stripEl.firstChild);
    frames = [];
  }

  async function regenerateStrip() {
    if (!_toolPaths.ffmpeg) { stripStatus.textContent = 'ffmpeg unavailable'; return; }
    const a = Math.max(0, parseFloat(inInput.value) || 0);
    const b = Math.min(duration, parseFloat(outInput.value) || duration);
    const len = Math.max(0.1, b - a);
    const myGen = ++stripGen;
    stripStatus.textContent = 'Loading frames…';
    clearStrip();
    stripWave.style.display = 'none';

    const dir = await ensureStripDir();
    if (!dir) { stripStatus.textContent = 'Workspace unavailable'; return; }
    // Wipe previous frames in the dir
    const prev = await window.parallxElectron.fs.readdir(dir).catch(() => null);
    if (prev && prev.entries) {
      for (const e of prev.entries) {
        await window.parallxElectron.fs.delete(dir + sepCh + e.name).catch(() => {});
      }
    }

    const ff = shellQuote(_toolPaths.ffmpeg);
    const fpsExpr = (FRAME_COUNT / len).toFixed(4);
    const vf = `fps=${fpsExpr},scale=80:45:force_original_aspect_ratio=decrease,pad=80:45:(ow-iw)/2:(oh-ih)/2:color=black`;
    const outPattern = dir + sepCh + 'frame_%03d.jpg';
    const cmd = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(a), '-t', String(len),
      '-i', shellQuote(videoPath),
      '-vf', shellQuote(vf),
      '-frames:v', String(FRAME_COUNT + 4),
      shellQuote(outPattern),
    ].join(' ');
    const r = await window.parallxElectron.terminal.exec(cmd, { timeout: 60000 });
    if (myGen !== stripGen) return; // superseded
    if (r.exitCode !== 0) { stripStatus.textContent = 'Frame extract failed'; return; }

    const list = await window.parallxElectron.fs.readdir(dir);
    if (myGen !== stripGen) return;
    const jpgs = (list.entries || []).filter(e => /^frame_\d+\.jpg$/.test(e.name)).sort((x, y) => x.name.localeCompare(y.name)).slice(0, FRAME_COUNT);
    for (let i = 0; i < jpgs.length; i++) {
      const fpath = dir + sepCh + jpgs[i].name;
      const url = await localFileToUrl(fpath);
      if (myGen !== stripGen) return;
      const cell = moEl('div', 'mo-clip-frame');
      cell.dataset.idx = String(i);
      const img = document.createElement('img');
      if (url) img.src = url;
      cell.appendChild(img);
      const idxLabel = moEl('div', 'mo-clip-frame-idx', { textContent: String(i + 1) });
      cell.appendChild(idxLabel);
      const delayBadge = moEl('div', 'mo-clip-frame-delay');
      delayBadge.style.display = 'none';
      cell.appendChild(delayBadge);
      cell.addEventListener('click', async () => {
        const f = frames[i];
        if (!f || f.deleted) return;
        const cur = f.delayMs == null ? '' : String(f.delayMs);
        const inp = await api.window.showInputBox({
          prompt: `Delay for frame ${i + 1} (ms). Empty = use FPS default.`,
          value: cur,
        });
        if (inp === undefined) return;
        if (inp === '') { f.delayMs = null; delayBadge.style.display = 'none'; return; }
        const v = parseInt(inp, 10);
        if (!Number.isFinite(v) || v < 0) return;
        f.delayMs = v;
        delayBadge.textContent = v + 'ms';
        delayBadge.style.display = '';
      });
      cell.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        const f = frames[i];
        if (!f) return;
        f.deleted = !f.deleted;
        cell.classList.toggle('mo-clip-frame-deleted', f.deleted);
      });
      stripEl.appendChild(cell);
      frames.push({ index: i, src: fpath, deleted: false, delayMs: null });
    }
    stripStatus.textContent = jpgs.length === 0 ? 'No frames extracted' : `${jpgs.length} frames — click to set delay, right-click to delete (GIF only)`;

    // Waveform (best-effort; ignore failure)
    try {
      const wavePath = dir + sepCh + 'wave.png';
      await window.parallxElectron.fs.delete(wavePath).catch(() => {});
      const cmdW = [
        ff, '-hide_banner', '-loglevel', 'error', '-y',
        '-ss', String(a), '-t', String(len),
        '-i', shellQuote(videoPath),
        '-filter_complex', shellQuote('showwavespic=s=' + (FRAME_COUNT * 80) + 'x36:colors=0x6e94ffaa:split_channels=0'),
        '-frames:v', '1',
        shellQuote(wavePath),
      ].join(' ');
      const rw = await window.parallxElectron.terminal.exec(cmdW, { timeout: 30000 });
      if (myGen === stripGen && rw.exitCode === 0) {
        const url = await localFileToUrl(wavePath);
        if (url) { stripWave.src = url; stripWave.style.display = ''; }
      }
    } catch { /* no audio or failed */ }
  }

  let regenTimer = null;
  function scheduleRegen() {
    if (regenTimer) clearTimeout(regenTimer);
    regenTimer = setTimeout(() => regenerateStrip().catch(() => {}), 500);
  }
  inInput.addEventListener('input', scheduleRegen);
  outInput.addEventListener('input', scheduleRegen);
  preview.addEventListener('loadedmetadata', () => regenerateStrip().catch(() => {}));

  async function cleanupStripDir() {
    if (!stripDir) return;
    await window.parallxElectron.fs.delete(stripDir).catch(() => {});
    stripDir = null;
  }

  // ── Footer ──
  const footer = moEl('div', 'mo-modal-footer');
  const cancelBtn = moEl('button', 'mo-btn-secondary', { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => { if (previewTimer) clearInterval(previewTimer); cleanupStripDir(); overlay.remove(); });
  const exportBtn = moEl('button', 'mo-btn-primary', { textContent: 'Export' });
  const status = moEl('div', 'mo-clip-status');
  footer.append(status, cancelBtn, exportBtn);
  dialog.appendChild(footer);

  exportBtn.addEventListener('click', async () => {
    const a = Math.max(0, parseFloat(inInput.value) || 0);
    const b = Math.min(duration, parseFloat(outInput.value) || duration);
    if (b <= a) { api.window.showWarningMessage('Out point must be after in point.'); return; }

    exportBtn.disabled = true; cancelBtn.disabled = true;
    status.textContent = 'Exporting…';

    // Detect frame edits — only honored when format=gif
    const hasFrameEdits = frames.some(f => f.deleted || f.delayMs != null) || revFrames;
    const useFrameEdits = (fmtSel.value === 'gif') && hasFrameEdits && frames.length > 0;

    try {
      const result = await moExportClip(api, {
        videoPath, inPoint: a, outPoint: b,
        format: fmtSel.value,
        fps: parseInt(fpsSel.value, 10),
        scalePct: Math.max(10, parseInt(sizeInput.value, 10) || 100),
        speed: parseFloat(speedSel.value),
        reverse: revChk.checked,
        crf: parseInt(crfInput.value, 10) || 23,
        dither: ditherSel.value,
        loops: parseInt(loopInput.value, 10) || 0,
        // M59 P2: per-frame edits (GIF only)
        frameEdits: useFrameEdits ? {
          frames: frames.map(f => ({ src: f.src, deleted: f.deleted, delayMs: f.delayMs })),
          reverseFrameOrder: revFrames,
        } : null,
      });
      if (previewTimer) clearInterval(previewTimer);
      cleanupStripDir();
      overlay.remove();
      api.window.showInformationMessage('Exported: ' + result.outPath);
    } catch (err) {
      status.textContent = '';
      api.window.showErrorMessage('Export failed: ' + (err && err.message || err));
      exportBtn.disabled = false; cancelBtn.disabled = false;
    }
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { if (previewTimer) clearInterval(previewTimer); cleanupStripDir(); overlay.remove(); }
  });
  document.body.appendChild(overlay);
}

async function moExportClip(api, opts) {
  const sep = _isWindows ? '\\' : '/';
  const lastSep = opts.videoPath.lastIndexOf(sep);
  const dir = opts.videoPath.slice(0, lastSep);
  const base = opts.videoPath.slice(lastSep + 1).replace(/\.[^.]+$/, '');
  const tag = `clip_${Math.floor(opts.inPoint)}-${Math.floor(opts.outPoint)}`;
  const outExt = opts.format === 'mp4' ? 'mp4' : (opts.format === 'webm' ? 'webm' : 'gif');
  let outPath = `${dir}${sep}${base}_${tag}.${outExt}`;

  // Avoid clobbering existing files by adding a counter
  let counter = 1;
  while (await window.parallxElectron.fs.exists(outPath)) {
    outPath = `${dir}${sep}${base}_${tag}_${counter}.${outExt}`;
    counter++;
  }

  const ff = shellQuote(_toolPaths.ffmpeg);
  const startSs = String(opts.inPoint);
  const len = String(Math.max(0.01, opts.outPoint - opts.inPoint));

  // Build filter chain
  const filters = [];
  filters.push(`fps=${opts.fps}`);
  if (opts.scalePct !== 100) {
    const s = (opts.scalePct / 100).toFixed(3);
    filters.push(`scale=trunc(iw*${s}/2)*2:trunc(ih*${s}/2)*2`);
  } else {
    // ensure even dims for video formats
    if (opts.format !== 'gif') filters.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }
  if (opts.speed && opts.speed !== 1) {
    // setpts inverse: 0.5x speed ⇒ setpts=PTS/0.5
    filters.push(`setpts=PTS/${opts.speed}`);
  }
  if (opts.reverse) filters.push('reverse');

  if (opts.format === 'gif') {
    // M59 P2: per-frame edits (delete/delay/reverse-frame-order) → concat path
    if (opts.frameEdits && opts.frameEdits.frames && opts.frameEdits.frames.length > 0) {
      return await moExportGifWithFrameEdits(api, opts, outPath);
    }
    // Two-pass palette
    const tmpPalette = `${dir}${sep}.mo_palette_${Date.now()}.png`;
    const vfA = filters.concat(['palettegen=stats_mode=diff']).join(',');
    const cmd1 = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', startSs, '-t', len, '-i', shellQuote(opts.videoPath),
      '-vf', shellQuote(vfA),
      shellQuote(tmpPalette),
    ].join(' ');
    const r1 = await window.parallxElectron.terminal.exec(cmd1, { timeout: 600000 });
    if (r1.exitCode !== 0) throw new Error('palettegen: ' + (r1.stderr || 'unknown'));

    const dither = opts.dither || 'bayer';
    const vfB = filters.join(',') + `[x];[x][1:v]paletteuse=dither=${dither}`;
    const cmd2 = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', startSs, '-t', len, '-i', shellQuote(opts.videoPath),
      '-i', shellQuote(tmpPalette),
      '-lavfi', shellQuote(vfB),
      '-loop', String(opts.loops || 0),
      shellQuote(outPath),
    ].join(' ');
    const r2 = await window.parallxElectron.terminal.exec(cmd2, { timeout: 600000 });
    await window.parallxElectron.fs.delete(tmpPalette).catch(() => {});
    if (r2.exitCode !== 0) throw new Error('paletteuse: ' + (r2.stderr || 'unknown'));
  } else {
    const vid = opts.format === 'mp4'
      ? ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart']
      : ['-c:v', 'libvpx-vp9', '-crf', String(opts.crf), '-b:v', '0', '-row-mt', '1'];
    const cmd = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', startSs, '-t', len, '-i', shellQuote(opts.videoPath),
      '-vf', shellQuote(filters.join(',')),
      ...vid,
      // strip audio if reversed (audio reverse is rarely desired) or speed != 1 (atempo handles 0.5-2 only)
      (opts.reverse || opts.speed !== 1) ? '-an' : '-c:a',
      (opts.reverse || opts.speed !== 1) ? '' : 'aac',
      shellQuote(outPath),
    ].filter(Boolean).join(' ');
    const r = await window.parallxElectron.terminal.exec(cmd, { timeout: 1800000 });
    if (r.exitCode !== 0) throw new Error(r.stderr || 'ffmpeg failed');
  }

  return { outPath };
}

// ─── GIF export with per-frame edits (M59 P2) ─────────────────────────────────
// When the user has marked frames as deleted, set per-frame delays, or toggled
// "reverse frame order", we re-extract frames at the strip cadence (one frame
// per strip cell) at the configured scale, drop the deleted ones, optionally
// reverse, then build a concat demuxer file with explicit per-frame durations.
// Two-pass palette gives consistent colors.
async function moExportGifWithFrameEdits(api, opts, outPath) {
  const ff = shellQuote(_toolPaths.ffmpeg);
  const sep = _isWindows ? '\\' : '/';
  const len = Math.max(0.01, opts.outPoint - opts.inPoint);
  const totalFrames = opts.frameEdits.frames.length;
  const stripFps = totalFrames / len;
  const defaultDelaySec = 1 / Math.max(1, stripFps);

  // Temp dir under thumbDir
  const baseDir = await getThumbDir();
  if (!baseDir) throw new Error('No workspace open');
  const workDir = baseDir + sep + '.clipexport-' + Date.now();
  await window.parallxElectron.fs.mkdir(workDir);

  try {
    // 1. Re-extract all frames at full size with the user's scale applied
    const scaleS = (opts.scalePct / 100).toFixed(3);
    const vfExtract = `fps=${stripFps.toFixed(4)},scale=trunc(iw*${scaleS}/2)*2:trunc(ih*${scaleS}/2)*2`;
    const pattern = workDir + sep + 'f_%04d.png';
    const cmdEx = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-ss', String(opts.inPoint), '-t', String(len),
      '-i', shellQuote(opts.videoPath),
      '-vf', shellQuote(vfExtract),
      '-frames:v', String(totalFrames + 4),
      shellQuote(pattern),
    ].join(' ');
    const rEx = await window.parallxElectron.terminal.exec(cmdEx, { timeout: 300000 });
    if (rEx.exitCode !== 0) throw new Error('frame extract: ' + (rEx.stderr || 'failed'));

    const list = await window.parallxElectron.fs.readdir(workDir);
    const pngs = (list.entries || [])
      .filter(e => /^f_\d+\.png$/.test(e.name))
      .sort((x, y) => x.name.localeCompare(y.name))
      .slice(0, totalFrames)
      .map(e => workDir + sep + e.name);
    if (pngs.length === 0) throw new Error('no frames extracted');

    // 2. Build sequence honoring deleted/delay/reverse
    let seq = pngs.map((p, i) => ({
      path: p,
      delaySec: opts.frameEdits.frames[i] && opts.frameEdits.frames[i].delayMs != null
        ? Math.max(0.01, opts.frameEdits.frames[i].delayMs / 1000)
        : defaultDelaySec,
      deleted: opts.frameEdits.frames[i] ? !!opts.frameEdits.frames[i].deleted : false,
    })).filter(f => !f.deleted);
    if (opts.frameEdits.reverseFrameOrder) seq.reverse();
    if (seq.length === 0) throw new Error('all frames deleted');

    // 3. Build concat demuxer file
    // Format:  file 'path'\nduration <seconds>\n  (last frame must repeat to honor duration)
    let concat = '';
    for (const f of seq) {
      // ffmpeg concat demuxer requires forward slashes and escape single quotes
      const cleanPath = f.path.replace(/\\/g, '/').replace(/'/g, "'\\''");
      concat += `file '${cleanPath}'\nduration ${f.delaySec.toFixed(4)}\n`;
    }
    // Required final file repeat
    const lastClean = seq[seq.length - 1].path.replace(/\\/g, '/').replace(/'/g, "'\\''");
    concat += `file '${lastClean}'\n`;
    const concatPath = workDir + sep + 'concat.txt';
    await window.parallxElectron.fs.writeFile(concatPath, concat, 'utf8');

    // 4. Two-pass palette over the concat sequence
    const dither = opts.dither || 'bayer';
    const palettePath = workDir + sep + 'palette.png';
    const cmd1 = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', shellQuote(concatPath),
      '-vf', shellQuote('palettegen=stats_mode=diff'),
      shellQuote(palettePath),
    ].join(' ');
    const r1 = await window.parallxElectron.terminal.exec(cmd1, { timeout: 300000 });
    if (r1.exitCode !== 0) throw new Error('palettegen: ' + (r1.stderr || 'failed'));

    const cmd2 = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-i', shellQuote(concatPath),
      '-i', shellQuote(palettePath),
      '-lavfi', shellQuote(`paletteuse=dither=${dither}`),
      '-loop', String(opts.loops || 0),
      shellQuote(outPath),
    ].join(' ');
    const r2 = await window.parallxElectron.terminal.exec(cmd2, { timeout: 300000 });
    if (r2.exitCode !== 0) throw new Error('paletteuse: ' + (r2.stderr || 'failed'));

    return { outPath };
  } finally {
    // Cleanup temp work dir
    await window.parallxElectron.fs.delete(workDir).catch(() => {});
  }
}


// M59 P2: simple key/value settings. Currently used for autoWebpMode.
async function moGetSetting(key, fallback) {
  try {
    const row = await db.get('SELECT value FROM mo_settings WHERE key = ?', [key]);
    return row ? row.value : fallback;
  } catch {
    return fallback;
  }
}

async function moSetSetting(key, value) {
  await db.run(
    `INSERT INTO mo_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value]
  );
}

// ─── Auto-WebP conversion (background, after scan) ────────────────────────────
// New WebP files discovered during scan are queued here for automatic
// conversion after scan completes. Animated -> GIF, static -> JPG.
// Originals are hard-deleted after a successful conversion (no quarantine).
let _newWebPConversions = []; // [{ id, target: 'gif' | 'jpg' }]

async function moAutoConvertWebPAfterScan(api) {
  const queue = _newWebPConversions.slice();
  _newWebPConversions = [];
  if (queue.length === 0) return;
  const mode = await moGetSetting('autoWebpMode', 'auto');
  console.log(`[MediaOrganizer] WebP auto-convert: mode=${mode}, queue=${queue.length}`);
  if (mode === 'off') return;
  if (mode === 'suggest') {
    api.window.showInformationMessage(
      `${queue.length} WebP file${queue.length === 1 ? '' : 's'} found. Run "Review WebP Files" to convert.`
    );
    return;
  }
  // mode === 'auto' — animated -> gif, static -> jpg, hard-delete original.
  let ok = 0, fail = 0;
  for (const item of queue) {
    try { await moConvertWebP(api, item.id, item.target); ok++; }
    catch (err) {
      console.error(`[MediaOrganizer] auto webp convert failed (id=${item.id}, target=${item.target}):`, err);
      fail++;
    }
  }
  console.log(`[MediaOrganizer] WebP auto-convert done: ok=${ok}, fail=${fail}`);
  if (ok > 0 || fail > 0) {
    api.window.showInformationMessage(
      `Auto-converted ${ok} WebP file${ok === 1 ? '' : 's'}` + (fail > 0 ? ` (${fail} failed — see console)` : '') + '.'
    );
    _notifySidebarRefresh();
  }
}

async function moPickAutoWebPMode(api) {
  const current = await moGetSetting('autoWebpMode', 'auto');
  const items = [
    { label: 'Off', description: 'Ignore WebP files' },
    { label: 'Suggest', description: 'Notify after scan; convert via Review command' },
    { label: 'Auto', description: 'Convert animated->GIF, static->JPG, delete original (default)' },
  ];
  for (const it of items) {
    if (it.label.toLowerCase() === current) it.description = '✓ Currently selected — ' + it.description;
  }
  const pick = await api.window.showQuickPick(items, { placeholder: 'Auto-convert animated WebP files?' });
  if (!pick) return;
  const value = pick.label.toLowerCase();
  await moSetSetting('autoWebpMode', value);
  api.window.showInformationMessage(`Auto-WebP mode: ${pick.label}`);
}

// ─── WebP conversion review + bulk convert ────────────────────────────────────
function moQuarantineDir(api) {
  const folders = api.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;
  const wsPath = uriToFsPath(folders[0].uri);
  const sep = _isWindows ? '\\' : '/';
  return wsPath + sep + '.parallx/extensions/media-organizer/converted-originals'.replace(/\//g, sep);
}

async function moPurgeQuarantine(api) {
  const dir = moQuarantineDir(api);
  if (!dir) return;
  const exists = await window.parallxElectron.fs.exists(dir);
  if (!exists) return;
  try {
    const list = await window.parallxElectron.fs.readdir(dir);
    if (!list || list.error) return;
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const e of (list.entries || [])) {
      if (!e || !/^\d{4}-\d{2}-\d{2}$/.test(e.name)) continue;
      if (e.mtime && e.mtime < cutoff) {
        const subPath = dir + (_isWindows ? '\\' : '/') + e.name;
        await window.parallxElectron.fs.delete(subPath).catch(() => {});
      }
    }
  } catch (err) {
    console.warn('[MediaOrganizer] quarantine purge failed:', err);
  }
}

async function moOpenWebPReviewDialog(api) {
  const rows = await db.all(
    `SELECT f.id, f.basename, f.size, fl.path AS folder_path
     FROM mo_files f
     LEFT JOIN mo_folders fl ON fl.id = f.folder_id
     WHERE f.needs_conversion = 1 AND f.converted_at IS NULL
     ORDER BY f.basename ASC`
  );

  const overlay = moEl('div', 'mo-modal-overlay');
  const dialog = moEl('div', 'mo-modal mo-webp-dialog');
  overlay.appendChild(dialog);

  const header = moEl('div', 'mo-modal-header');
  header.appendChild(moEl('div', 'mo-modal-title', { textContent: `WebP review (${rows.length})` }));
  const closeBtn = moEl('button', 'mo-modal-close', { textContent: '×' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const list = moEl('div', 'mo-webp-list');
  if (rows.length === 0) {
    list.appendChild(moEl('div', 'mo-webp-empty', { textContent: 'No WebP files pending review.' }));
  }
  const choices = new Map(); // fileId → 'mp4' | 'gif' | 'jpg' | 'skip'
  for (const r of rows) {
    // Detect animated vs static so we can default the right target.
    const sep = _isWindows ? '\\' : '/';
    const fullPath = (r.folder_path || '') + sep + r.basename;
    let isAnim = false;
    try { isAnim = await isWebPAnimated(fullPath); } catch (_) { isAnim = false; }
    const row = moEl('div', 'mo-webp-row');
    const label = moEl('div', 'mo-webp-name', { textContent: r.basename + (isAnim ? ' (animated)' : ' (static)') });
    const meta = moEl('div', 'mo-webp-meta', { textContent: `${(r.size / 1024).toFixed(0)} KB · ${r.folder_path || ''}` });
    const sel = document.createElement('select');
    sel.className = 'mo-clip-input';
    const opts = isAnim
      ? [['gif', 'Convert to GIF'], ['mp4', 'Convert to MP4'], ['skip', 'Skip']]
      : [['jpg', 'Convert to JPG'], ['skip', 'Skip']];
    for (const opt of opts) {
      const o = document.createElement('option'); o.value = opt[0]; o.textContent = opt[1];
      sel.appendChild(o);
    }
    const defaultTarget = isAnim ? 'gif' : 'jpg';
    sel.value = defaultTarget;
    choices.set(r.id, defaultTarget);
    sel.addEventListener('change', () => choices.set(r.id, sel.value));
    row.append(label, meta, sel);
    list.appendChild(row);
  }
  dialog.appendChild(list);

  const footer = moEl('div', 'mo-modal-footer');
  const cancelBtn = moEl('button', 'mo-btn-secondary', { textContent: 'Cancel' });
  cancelBtn.addEventListener('click', () => overlay.remove());
  const goBtn = moEl('button', 'mo-btn-primary', { textContent: 'Convert all' });
  const status = moEl('div', 'mo-clip-status');
  footer.append(status, cancelBtn, goBtn);
  dialog.appendChild(footer);

  goBtn.addEventListener('click', async () => {
    goBtn.disabled = true; cancelBtn.disabled = true;
    let done = 0; let failed = 0;
    for (const [fileId, target] of choices) {
      if (target === 'skip') {
        await db.run('UPDATE mo_files SET conversion_target = ?, needs_conversion = 0 WHERE id = ?', ['skip', fileId]);
        continue;
      }
      status.textContent = `Converting ${++done}/${rows.length}…`;
      try {
        await moConvertWebP(api, fileId, target);
      } catch (err) {
        failed++;
        console.error('[MediaOrganizer] webp convert failed:', err);
      }
    }
    overlay.remove();
    api.window.showInformationMessage(
      failed === 0 ? `Converted ${rows.length - failed} file(s).` : `Converted ${rows.length - failed}, ${failed} failed.`
    );
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

async function moConvertWebP(api, fileId, target) {
  if (!_toolPaths.ffmpeg) throw new Error('ffmpeg not available (tool not detected)');
  const fileRow = await db.get(
    `SELECT f.id, f.basename, f.folder_id, fl.path AS folder_path
     FROM mo_files f LEFT JOIN mo_folders fl ON fl.id = f.folder_id
     WHERE f.id = ?`, [fileId]
  );
  if (!fileRow || !fileRow.folder_path) throw new Error('file not found');
  const sep = _isWindows ? '\\' : '/';
  const srcPath = fileRow.folder_path + sep + fileRow.basename;
  const baseName = fileRow.basename.replace(/\.webp$/i, '');
  const outPath = fileRow.folder_path + sep + baseName + '.' + target;
  console.log(`[MediaOrganizer] Converting ${srcPath} -> ${outPath}`);

  const ff = shellQuote(_toolPaths.ffmpeg);
  let cmd;
  if (target === 'mp4') {
    cmd = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-i', shellQuote(srcPath),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '23',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-vf', shellQuote('scale=trunc(iw/2)*2:trunc(ih/2)*2'),
      shellQuote(outPath),
    ].join(' ');
  } else if (target === 'jpg') {
    // Static WebP -> JPG. -q:v 2 is high quality (1 best, 31 worst).
    cmd = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-i', shellQuote(srcPath),
      '-q:v', '2',
      shellQuote(outPath),
    ].join(' ');
  } else {
    // GIF — use a single-pass conversion (palette generation baked in via split filter)
    const vf = "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer";
    cmd = [
      ff, '-hide_banner', '-loglevel', 'error', '-y',
      '-i', shellQuote(srcPath),
      '-lavfi', shellQuote(vf),
      '-loop', '0',
      shellQuote(outPath),
    ].join(' ');
  }
  const r = await window.parallxElectron.terminal.exec(cmd, { timeout: 600000 });
  if (r.exitCode !== 0) {
    console.error(`[MediaOrganizer] ffmpeg failed (exit=${r.exitCode}): ${r.stderr || r.stdout || '(no output)'}`);
    throw new Error('ffmpeg: ' + (r.stderr || 'failed'));
  }
  // Verify output exists before deleting source.
  const outExists = await window.parallxElectron.fs.exists(outPath);
  if (!outExists) {
    throw new Error(`ffmpeg reported success but output missing: ${outPath}`);
  }

  // Hard-delete original WebP — user opted out of quarantine to avoid duplicates.
  const delResult = await window.parallxElectron.fs.delete(srcPath);
  if (delResult && delResult.error) {
    console.warn(`[MediaOrganizer] Failed to delete original webp ${srcPath}:`, delResult.error);
  } else {
    console.log(`[MediaOrganizer] Deleted original ${srcPath}`);
  }

  // Stat the new file so we can update mod_time/size on the row. This makes
  // the watcher's subsequent 'created' event a no-op (matches existing row).
  const outStat = await window.parallxElectron.fs.stat(outPath);
  const newSize = (outStat && !outStat.error) ? outStat.size : fileRow.size;
  const newMtime = (outStat && !outStat.error) ? outStat.mtime : Date.now();

  // Update DB row to point at new file
  await db.run(
    `UPDATE mo_files
     SET basename = ?, size = ?, mod_time = ?, conversion_target = ?, needs_conversion = 0,
         converted_from = ?, converted_at = datetime('now'), updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [baseName + '.' + target, newSize, newMtime, target, srcPath, fileId]
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10B: SEARCH (FTS5) + QUERY PARSER + SMART ALBUMS — M59 P3
// ═══════════════════════════════════════════════════════════════════════════════

// ── FTS5 rebuild ──
// Wipes and repopulates mo_photos_fts and mo_videos_fts. Called after scan,
// after tag mutations, and after photo/video updates. Cheap enough for the
// expected library sizes (sub-100k items) — full rebuild keeps logic simple.
let _ftsRebuilding = false;
async function moRebuildSearchIndex() {
  if (_ftsRebuilding) return;
  _ftsRebuilding = true;
  try {
    // Photos
    const photos = await db.all(
      `SELECT p.id AS pid, p.title AS title, p.details AS details,
              GROUP_CONCAT(DISTINCT t.name) AS tags_text,
              GROUP_CONCAT(DISTINCT fl.path) AS folder_text
         FROM mo_photos p
    LEFT JOIN mo_photos_tags pt ON pt.photo_id = p.id
    LEFT JOIN mo_tags t ON t.id = pt.tag_id
    LEFT JOIN mo_photos_files pf ON pf.photo_id = p.id
    LEFT JOIN mo_files f ON f.id = pf.file_id
    LEFT JOIN mo_folders fl ON fl.id = f.folder_id
        GROUP BY p.id`
    );
    await db.run('DELETE FROM mo_photos_fts');
    for (const r of photos || []) {
      await db.run(
        `INSERT INTO mo_photos_fts (rowid, title, details, tags_text, folder_text) VALUES (?, ?, ?, ?, ?)`,
        [r.pid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '']
      );
    }
    // Videos
    const videos = await db.all(
      `SELECT v.id AS vid, v.title AS title, v.details AS details,
              GROUP_CONCAT(DISTINCT t.name) AS tags_text,
              GROUP_CONCAT(DISTINCT fl.path) AS folder_text
         FROM mo_videos v
    LEFT JOIN mo_videos_tags vt ON vt.video_id = v.id
    LEFT JOIN mo_tags t ON t.id = vt.tag_id
    LEFT JOIN mo_videos_files vf ON vf.video_id = v.id
    LEFT JOIN mo_files f ON f.id = vf.file_id
    LEFT JOIN mo_folders fl ON fl.id = f.folder_id
        GROUP BY v.id`
    );
    await db.run('DELETE FROM mo_videos_fts');
    for (const r of videos || []) {
      await db.run(
        `INSERT INTO mo_videos_fts (rowid, title, details, tags_text, folder_text) VALUES (?, ?, ?, ?, ?)`,
        [r.vid, r.title || '', r.details || '', r.tags_text || '', r.folder_text || '']
      );
    }
  } catch (err) {
    console.warn('[MediaOrganizer] FTS rebuild failed:', err);
  } finally {
    _ftsRebuilding = false;
  }
}

// ── Query parser ──
// Supports: tag:foo  -tag:foo  rating:>=4  rating:5  rating:3..5
//           folder:beach  taken:2024  taken:2024-06  type:photo|video
//           and bare words → free-text FTS MATCH
function moParseSearchQuery(input) {
  const result = {
    freeText: '',
    tags: [], excludeTags: [],
    ratingMin: null, ratingMax: null,
    folderTerm: null,
    dateFrom: null, dateTo: null,
    type: null,
  };
  if (!input) return result;
  const words = [];
  const re = /(-?)(\w+):(\S+)|(\S+)/g;
  let m;
  while ((m = re.exec(input)) !== null) {
    if (m[4]) { words.push(m[4]); continue; }
    const neg = m[1] === '-';
    const key = m[2].toLowerCase();
    const val = m[3];
    switch (key) {
      case 'tag':
        (neg ? result.excludeTags : result.tags).push(val);
        break;
      case 'rating': {
        const r = val.match(/^(>=|<=|>|<|=)?(\d)(?:\.\.(\d))?$/);
        if (r) {
          const op = r[1] || '=';
          const a = parseInt(r[2], 10);
          const b = r[3] != null ? parseInt(r[3], 10) : null;
          if (b != null) { result.ratingMin = a; result.ratingMax = b; }
          else if (op === '>=' || op === '=') result.ratingMin = a;
          else if (op === '>') result.ratingMin = a + 1;
          else if (op === '<=') result.ratingMax = a;
          else if (op === '<') result.ratingMax = a - 1;
        }
        break;
      }
      case 'folder':
        result.folderTerm = val;
        break;
      case 'taken':
      case 'date': {
        const d = val.match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/);
        if (d) {
          const y = d[1]; const mo = d[2]; const da = d[3];
          if (da) { result.dateFrom = `${y}-${mo}-${da}`; result.dateTo = `${y}-${mo}-${da}`; }
          else if (mo) {
            result.dateFrom = `${y}-${mo}-01`;
            const last = new Date(parseInt(y, 10), parseInt(mo, 10), 0).getDate();
            result.dateTo = `${y}-${mo}-${String(last).padStart(2, '0')}`;
          } else { result.dateFrom = `${y}-01-01`; result.dateTo = `${y}-12-31`; }
        }
        break;
      }
      case 'type':
        if (val === 'photo' || val === 'photos') result.type = 'photos';
        else if (val === 'video' || val === 'videos') result.type = 'videos';
        break;
      default:
        words.push(m[0]);
    }
  }
  result.freeText = words.join(' ').trim();
  return result;
}

// Convert freeText into an FTS5 MATCH expression (prefix on each token).
// FTS5 treats most punctuation as token separators; we strip operator chars.
function moBuildFtsMatch(freeText) {
  if (!freeText) return null;
  const tokens = freeText.replace(/["()*]/g, ' ').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map(t => `"${t.replace(/"/g, '')}"*`).join(' AND ');
}

// Look up tag IDs by name (case-insensitive). Returns array of ids;
// names that don't match are silently dropped.
async function moResolveTagNames(names) {
  if (!names || names.length === 0) return [];
  const out = [];
  for (const n of names) {
    const row = await db.get('SELECT id FROM mo_tags WHERE LOWER(name) = LOWER(?)', [n]);
    if (row) out.push(row.id);
  }
  return out;
}

// Look up photo+video IDs whose folder path contains the term.
async function moResolveFolderMatchIds(term) {
  const like = '%' + term + '%';
  const photoRows = await db.all(
    `SELECT DISTINCT pf.photo_id AS id
       FROM mo_photos_files pf
       JOIN mo_files f ON f.id = pf.file_id
       JOIN mo_folders fl ON fl.id = f.folder_id
      WHERE fl.path LIKE ?`, [like]
  );
  const videoRows = await db.all(
    `SELECT DISTINCT vf.video_id AS id
       FROM mo_videos_files vf
       JOIN mo_files f ON f.id = vf.file_id
       JOIN mo_folders fl ON fl.id = f.folder_id
      WHERE fl.path LIKE ?`, [like]
  );
  return {
    photoIds: photoRows.map(r => r.id),
    videoIds: videoRows.map(r => r.id),
  };
}

// FTS MATCH lookup → returns { photoIds, videoIds } limited to N.
async function moFtsLookup(matchExpr, limit) {
  if (!matchExpr) return { photoIds: null, videoIds: null };
  const lim = Math.min(50000, limit || 5000);
  try {
    const photoRows = await db.all(
      `SELECT rowid AS id FROM mo_photos_fts WHERE mo_photos_fts MATCH ? LIMIT ?`,
      [matchExpr, lim]
    );
    const videoRows = await db.all(
      `SELECT rowid AS id FROM mo_videos_fts WHERE mo_videos_fts MATCH ? LIMIT ?`,
      [matchExpr, lim]
    );
    return {
      photoIds: photoRows.map(r => r.id),
      videoIds: videoRows.map(r => r.id),
    };
  } catch (err) {
    console.warn('[MediaOrganizer] FTS lookup failed:', err);
    return { photoIds: null, videoIds: null };
  }
}

// ── Smart albums ──
async function moSaveSmartAlbum(api, queryStr, currentFilters) {
  if (!queryStr && (!currentFilters || (
    (!currentFilters.tagIds || currentFilters.tagIds.length === 0) &&
    (!currentFilters.excludeTagIds || currentFilters.excludeTagIds.length === 0) &&
    currentFilters.ratingMin == null && !currentFilters.dateFrom && !currentFilters.dateTo
  ))) {
    api.window.showWarningMessage('Nothing to save — type a search query or apply filters first.');
    return;
  }
  const name = await api.window.showInputBox({
    prompt: 'Smart album name',
    placeholder: 'e.g. Beach 2024 — top picks',
  });
  if (!name) return;
  const payload = JSON.stringify({ query: queryStr || '', filters: currentFilters || {} });
  try {
    await db.run(
      `INSERT INTO mo_smart_albums (name, query_json) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET query_json = excluded.query_json, updated_at = datetime('now')`,
      [name, payload]
    );
    api.window.showInformationMessage(`Smart album "${name}" saved.`);
  } catch (err) {
    api.window.showErrorMessage('Save failed: ' + (err && err.message || err));
  }
}

async function moOpenSmartAlbum(api, applyFn) {
  const rows = await db.all('SELECT id, name, query_json FROM mo_smart_albums ORDER BY name COLLATE NOCASE ASC');
  if (!rows || rows.length === 0) {
    api.window.showInformationMessage('No smart albums saved yet. Run a search and use "Save Smart Album".');
    return;
  }
  const items = rows.map(r => ({ label: r.name, description: 'Smart album' }));
  items.push({ label: '$(trash) Manage…', description: 'Delete a smart album' });
  const pick = await api.window.showQuickPick(items, { placeholder: 'Open smart album' });
  if (!pick) return;
  if (pick.label.includes('Manage…')) {
    return moManageSmartAlbums(api);
  }
  const row = rows.find(r => r.name === pick.label);
  if (!row) return;
  let parsed;
  try { parsed = JSON.parse(row.query_json); } catch { parsed = { query: '', filters: {} }; }
  if (typeof applyFn === 'function') applyFn(parsed);
}

async function moManageSmartAlbums(api) {
  const rows = await db.all('SELECT id, name FROM mo_smart_albums ORDER BY name COLLATE NOCASE ASC');
  if (!rows || rows.length === 0) return;
  const items = rows.map(r => ({ label: r.name, description: 'Click to delete' }));
  const pick = await api.window.showQuickPick(items, { placeholder: 'Delete which smart album?' });
  if (!pick) return;
  const row = rows.find(r => r.name === pick.label);
  if (!row) return;
  await db.run('DELETE FROM mo_smart_albums WHERE id = ?', [row.id]);
  api.window.showInformationMessage(`Deleted "${row.name}".`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10C: PERCEPTUAL HASH (dHash 64-bit) — M59 P3
// ═══════════════════════════════════════════════════════════════════════════════
// Computes a 64-bit difference hash by resizing each image to 9×8 grayscale,
// then comparing adjacent horizontal pixels. Hamming distance ≤ 8 across two
// hashes ⇒ near-duplicate.

// 64-bit popcount (BigInt). Accepts BigInt; returns Number.
function moPopcount64(b) {
  let count = 0;
  while (b) { if (b & 1n) count++; b >>= 1n; }
  return count;
}

function moHammingDistance(aBig, bBig) {
  return moPopcount64(aBig ^ bBig);
}

// Compute dHash for a single image. Uses ffmpeg (always available — required
// for video features) so we don't depend on sharp/vips. Pipeline: resize to
// 9×8, gray, raw pixels via -f rawvideo. Returns 64-bit BigInt or null.
async function moComputePHash(filePath) {
  if (!_toolPaths.ffmpeg) return null;
  const tmpDir = await getThumbDir();
  if (!tmpDir) return null;
  const sep = _isWindows ? '\\' : '/';
  const tmp = tmpDir + sep + '.phash_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + '.gray';
  const ff = shellQuote(_toolPaths.ffmpeg);
  const cmd = [
    ff, '-hide_banner', '-loglevel', 'error', '-y',
    '-i', shellQuote(filePath),
    '-vf', 'scale=9:8:flags=area,format=gray',
    '-f', 'rawvideo', '-pix_fmt', 'gray',
    '-frames:v', '1',
    shellQuote(tmp),
  ].join(' ');
  try {
    const r = await window.parallxElectron.terminal.exec(cmd, { timeout: 30000 });
    if (r.exitCode !== 0) return null;
    const fr = await window.parallxElectron.fs.readFile(tmp);
    if (fr.error) return null;
    // readFile returns base64 by default — decode
    let bytes;
    if (fr.encoding === 'base64' || !fr.encoding) {
      const bin = atob(fr.content);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(fr.content);
    }
    if (bytes.length < 72) return null; // 9×8 = 72 bytes
    let hash = 0n;
    let bit = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const left = bytes[row * 9 + col];
        const right = bytes[row * 9 + col + 1];
        if (left > right) hash |= (1n << BigInt(63 - bit));
        bit++;
      }
    }
    return hash;
  } catch (err) {
    console.warn('[MediaOrganizer] phash failed:', err);
    return null;
  } finally {
    await window.parallxElectron.fs.delete(tmp).catch(() => {});
  }
}

// SQLite stores INTEGER as signed 64-bit. Convert BigInt ↔ signed.
function moBigIntToSqlite(b) {
  // Wrap to signed 64-bit
  const SIGN = 1n << 63n;
  if (b & SIGN) return Number(b - (1n << 64n));
  return Number(b);
}
function moSqliteToBigInt(n) {
  let b = BigInt(n);
  if (b < 0n) b += 1n << 64n;
  return b;
}

let _phashRunning = false;
async function moRunPHashIndexer(api) {
  if (_phashRunning) { api.window.showInformationMessage('Perceptual hash indexer already running.'); return; }
  if (!_toolPaths.ffmpeg) { api.window.showWarningMessage('ffmpeg required for perceptual hash.'); return; }
  _phashRunning = true;

  const rows = await db.all(
    `SELECT i.file_id AS file_id, fl.path AS folder_path, f.basename AS basename
       FROM mo_image_files i
       JOIN mo_files f ON f.id = i.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      WHERE i.phash IS NULL AND fl.path IS NOT NULL`
  );
  if (rows.length === 0) {
    _phashRunning = false;
    api.window.showInformationMessage('Perceptual hash already up-to-date.');
    return;
  }

  if (_statusBarItem) {
    _statusBarItem.text = `$(sync~spin) pHash 0 / ${rows.length}`;
    _statusBarItem.show();
  }

  let done = 0, fail = 0;
  const sep = _isWindows ? '\\' : '/';
  for (const row of rows) {
    const fpath = row.folder_path + sep + row.basename;
    const exists = await window.parallxElectron.fs.exists(fpath);
    if (!exists) { fail++; done++; continue; }
    const hash = await moComputePHash(fpath);
    if (hash != null) {
      await db.run('UPDATE mo_image_files SET phash = ? WHERE file_id = ?', [moBigIntToSqlite(hash), row.file_id]);
    } else {
      fail++;
    }
    done++;
    if (_statusBarItem && done % 5 === 0) {
      _statusBarItem.text = `$(sync~spin) pHash ${done} / ${rows.length}`;
    }
  }

  if (_statusBarItem) {
    _statusBarItem.text = `$(check) pHash done — ${done - fail}/${rows.length} indexed`;
    setTimeout(() => { if (_statusBarItem) _statusBarItem.hide(); }, 5000);
  }
  _phashRunning = false;
  api.window.showInformationMessage(`Perceptual hash: ${done - fail} indexed, ${fail} skipped.`);
}

// ── Duplicate Finder ──
async function moOpenDuplicateFinder(api) {
  const exactRows = await db.all(
    `SELECT fp.value AS hash, GROUP_CONCAT(fp.file_id) AS file_ids
       FROM mo_fingerprints fp
      WHERE fp.type = 'md5'
      GROUP BY fp.value
     HAVING COUNT(DISTINCT fp.file_id) > 1`
  );
  const phashRows = await db.all(
    `SELECT i.file_id AS file_id, i.phash AS phash, f.basename AS basename, fl.path AS folder_path
       FROM mo_image_files i
       JOIN mo_files f ON f.id = i.file_id
  LEFT JOIN mo_folders fl ON fl.id = f.folder_id
      WHERE i.phash IS NOT NULL`
  );

  // Cluster pHash rows by Hamming distance ≤ 8 (greedy single-link)
  const clusters = [];
  const visited = new Set();
  for (let i = 0; i < phashRows.length; i++) {
    if (visited.has(i)) continue;
    const seedBig = moSqliteToBigInt(phashRows[i].phash);
    const group = [phashRows[i]];
    visited.add(i);
    for (let j = i + 1; j < phashRows.length; j++) {
      if (visited.has(j)) continue;
      const otherBig = moSqliteToBigInt(phashRows[j].phash);
      if (moHammingDistance(seedBig, otherBig) <= 8) {
        group.push(phashRows[j]); visited.add(j);
      }
    }
    if (group.length > 1) clusters.push(group);
  }

  // Build modal
  const overlay = moEl('div', 'mo-modal-overlay');
  const dialog = moEl('div', 'mo-modal mo-dup-dialog');
  overlay.appendChild(dialog);
  const header = moEl('div', 'mo-modal-header');
  header.appendChild(moEl('div', 'mo-modal-title', { textContent: 'Duplicate Finder' }));
  const closeBtn = moEl('button', 'mo-modal-close', { textContent: '×' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = moEl('div', 'mo-dup-body');
  dialog.appendChild(body);

  const summary = moEl('div', 'mo-dup-summary');
  summary.textContent = `${exactRows.length} exact-match group${exactRows.length === 1 ? '' : 's'} (md5), ${clusters.length} near-duplicate cluster${clusters.length === 1 ? '' : 's'} (pHash ≤ 8).`;
  body.appendChild(summary);

  // Render exact match groups
  for (const r of exactRows) {
    const fileIds = r.file_ids.split(',').map(s => parseInt(s, 10));
    const files = await db.all(
      `SELECT f.id, f.basename, f.size, fl.path AS folder_path
         FROM mo_files f LEFT JOIN mo_folders fl ON fl.id = f.folder_id
        WHERE f.id IN (${fileIds.map(() => '?').join(',')})`, fileIds
    );
    body.appendChild(buildDupGroup(api, files, 'Exact match (md5)'));
  }
  for (const cluster of clusters) {
    const ids = cluster.map(c => c.file_id);
    const files = await db.all(
      `SELECT f.id, f.basename, f.size, fl.path AS folder_path
         FROM mo_files f LEFT JOIN mo_folders fl ON fl.id = f.folder_id
        WHERE f.id IN (${ids.map(() => '?').join(',')})`, ids
    );
    body.appendChild(buildDupGroup(api, files, 'Near-duplicate (pHash)'));
  }

  if (exactRows.length === 0 && clusters.length === 0) {
    const empty = moEl('div', 'mo-dup-empty');
    empty.textContent = 'No duplicates found. (Run "Build Perceptual Hashes" first if you haven\'t.)';
    body.appendChild(empty);
  }

  const footer = moEl('div', 'mo-modal-footer');
  const close2 = moEl('button', 'mo-btn-secondary', { textContent: 'Close' });
  close2.addEventListener('click', () => overlay.remove());
  footer.appendChild(close2);
  dialog.appendChild(footer);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function buildDupGroup(api, files, label) {
  const group = moEl('div', 'mo-dup-group');
  const head = moEl('div', 'mo-dup-group-head');
  head.appendChild(moEl('span', 'mo-dup-group-label', { textContent: label }));
  head.appendChild(moEl('span', 'mo-dup-group-count', { textContent: `${files.length} file${files.length === 1 ? '' : 's'}` }));
  group.appendChild(head);

  const list = moEl('div', 'mo-dup-list');
  group.appendChild(list);
  // Auto-pick the largest as keeper
  let keeperId = files.reduce((acc, f) => (f.size > (acc ? acc.size : -1) ? f : acc), null)?.id;

  function renderList() {
    list.innerHTML = '';
    for (const f of files) {
      const row = moEl('div', 'mo-dup-row');
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'mo-dup-keep-' + label;
      radio.checked = f.id === keeperId;
      radio.addEventListener('change', () => { if (radio.checked) keeperId = f.id; });
      row.appendChild(radio);
      const name = moEl('div', 'mo-dup-name');
      name.textContent = f.basename;
      const meta = moEl('div', 'mo-dup-meta');
      const sizeKb = (f.size / 1024).toFixed(1);
      meta.textContent = `${sizeKb} KB · ${f.folder_path || '(no folder)'}`;
      const text = moEl('div', 'mo-dup-text');
      text.appendChild(name); text.appendChild(meta);
      row.appendChild(text);
      list.appendChild(row);
    }
  }
  renderList();

  const actions = moEl('div', 'mo-dup-actions');
  const trashBtn = moEl('button', 'mo-btn-secondary', { textContent: 'Send others to OS trash' });
  trashBtn.addEventListener('click', async () => {
    if (!keeperId) return;
    const sep = _isWindows ? '\\' : '/';
    const targets = files.filter(f => f.id !== keeperId);
    if (targets.length === 0) return;
    const ok = await api.window.showWarningMessage(
      `Move ${targets.length} file(s) to OS trash? Database rows will be deleted.`,
      'Move to Trash', 'Cancel'
    );
    if (ok !== 'Move to Trash') return;
    let moved = 0, failed = 0;
    for (const f of targets) {
      const fpath = (f.folder_path || '') + sep + f.basename;
      // Use Electron shell.trashItem via fs.delete (extension fs API uses recycle bin on Windows)
      const r = await window.parallxElectron.fs.delete(fpath).catch(() => ({ error: 'fail' }));
      if (r && !r.error) {
        await db.run('DELETE FROM mo_files WHERE id = ?', [f.id]);
        moved++;
      } else {
        failed++;
      }
    }
    api.window.showInformationMessage(`Trashed ${moved} file${moved === 1 ? '' : 's'}` + (failed ? `, ${failed} failed` : '') + '.');
    group.style.opacity = '0.4'; group.style.pointerEvents = 'none';
    _notifySidebarRefresh();
    moRebuildSearchIndex().catch(() => {});
  });
  actions.appendChild(trashBtn);
  group.appendChild(actions);
  return group;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10D: STACKS + TRASH — M59 P5
// ═══════════════════════════════════════════════════════════════════════════════

// ── Stacks ──
// Group selected items under a primary. Promotes the highest-rated (or first)
// as primary; the rest become 'member'. Stack-aware queries hide members.
async function moStackSelected(api, selectedIds) {
  // selectedIds is a Set of "type:id" strings (matches grid selection format)
  if (!selectedIds || selectedIds.size < 2) {
    api.window.showWarningMessage('Select at least 2 items to stack.');
    return;
  }
  const items = [...selectedIds].map(s => {
    const [type, id] = s.split(':');
    return { type, id: parseInt(id, 10) };
  });
  // Pick the first as primary by default; could enhance with "highest rated"
  const primary = items[0];
  const members = items.slice(1);
  try {
    const r = await db.run(
      `INSERT INTO mo_stacks (primary_type, primary_id) VALUES (?, ?)
       ON CONFLICT(primary_type, primary_id) DO UPDATE SET updated_at = datetime('now')`,
      [primary.type, primary.id]
    );
    let stackId;
    const existing = await db.get('SELECT id FROM mo_stacks WHERE primary_type = ? AND primary_id = ?', [primary.type, primary.id]);
    stackId = existing ? existing.id : (r && r.lastID);
    if (!stackId) throw new Error('Failed to obtain stack id');
    // Insert primary as a stack_member with role='primary'
    await db.run(
      `INSERT OR IGNORE INTO mo_stack_members (stack_id, member_type, member_id, role, position) VALUES (?, ?, ?, 'primary', 0)`,
      [stackId, primary.type, primary.id]
    );
    let pos = 1;
    for (const m of members) {
      await db.run(
        `INSERT OR IGNORE INTO mo_stack_members (stack_id, member_type, member_id, role, position) VALUES (?, ?, ?, 'member', ?)`,
        [stackId, m.type, m.id, pos++]
      );
    }
    api.window.showInformationMessage(`Stacked ${items.length} items.`);
    _notifySidebarRefresh();
  } catch (err) {
    api.window.showErrorMessage('Stack failed: ' + (err && err.message || err));
  }
}

async function moUnstackItem(api, type, id) {
  // If item is a stack primary, dissolve the stack entirely.
  const stack = await db.get('SELECT id FROM mo_stacks WHERE primary_type = ? AND primary_id = ?', [type, id]);
  if (!stack) {
    // Maybe a member — remove just that member
    await db.run(
      `DELETE FROM mo_stack_members WHERE member_type = ? AND member_id = ?`, [type, id]
    );
    api.window.showInformationMessage('Removed from stack.');
    return;
  }
  await db.run('DELETE FROM mo_stacks WHERE id = ?', [stack.id]);
  api.window.showInformationMessage('Stack dissolved.');
  _notifySidebarRefresh();
}

async function moGetStackMemberCount(type, id) {
  const row = await db.get(
    `SELECT COUNT(*) AS n FROM mo_stack_members
       WHERE stack_id = (SELECT id FROM mo_stacks WHERE primary_type = ? AND primary_id = ?)`,
    [type, id]
  );
  return row ? row.n : 0;
}

async function moAutoStackByBasename(api) {
  // Group photos by stripped basename (no extension, no _edited/_v2 suffix).
  // Items sharing a normalized basename within the same folder become a stack.
  const rows = await db.all(
    `SELECT 'photo' AS type, p.id AS id, f.basename AS basename, f.folder_id AS folder_id
       FROM mo_photos p
       JOIN mo_photos_files pf ON pf.photo_id = p.id AND pf.is_primary = 1
       JOIN mo_files f ON f.id = pf.file_id
      WHERE p.deleted_at IS NULL`
  );
  const groups = new Map();
  function norm(name) {
    // Strip extension and common edit suffixes
    return name
      .replace(/\.[^.]+$/, '')
      .replace(/[-_](edited|v\d+|copy|edit)$/i, '')
      .toLowerCase();
  }
  for (const r of rows) {
    const key = `${r.folder_id}::${norm(r.basename)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  let created = 0;
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    // Skip if any item already in a stack
    let already = false;
    for (const it of list) {
      const ex = await db.get('SELECT 1 FROM mo_stack_members WHERE member_type = ? AND member_id = ?', [it.type, it.id]);
      if (ex) { already = true; break; }
    }
    if (already) continue;
    const primary = list[0];
    const result = await db.run(
      `INSERT OR IGNORE INTO mo_stacks (primary_type, primary_id) VALUES (?, ?)`,
      [primary.type, primary.id]
    );
    const sRow = await db.get('SELECT id FROM mo_stacks WHERE primary_type = ? AND primary_id = ?', [primary.type, primary.id]);
    if (!sRow) continue;
    await db.run(
      `INSERT OR IGNORE INTO mo_stack_members (stack_id, member_type, member_id, role, position) VALUES (?, ?, ?, 'primary', 0)`,
      [sRow.id, primary.type, primary.id]
    );
    let pos = 1;
    for (const m of list.slice(1)) {
      await db.run(
        `INSERT OR IGNORE INTO mo_stack_members (stack_id, member_type, member_id, role, position) VALUES (?, ?, ?, 'member', ?)`,
        [sRow.id, m.type, m.id, pos++]
      );
    }
    created++;
  }
  api.window.showInformationMessage(`Auto-stacked: ${created} new stack${created === 1 ? '' : 's'} created.`);
  _notifySidebarRefresh();
}

// ── Trash ──
async function moMoveToTrash(api, items) {
  // items: array of { type, id }
  if (!items || items.length === 0) return 0;
  let n = 0;
  for (const it of items) {
    const table = it.type === 'photo' ? 'mo_photos' : 'mo_videos';
    await db.run(`UPDATE ${table} SET deleted_at = datetime('now') WHERE id = ?`, [it.id]);
    n++;
  }
  _notifySidebarRefresh();
  return n;
}

async function moRestoreFromTrash(api, items) {
  if (!items || items.length === 0) return 0;
  let n = 0;
  for (const it of items) {
    const table = it.type === 'photo' ? 'mo_photos' : 'mo_videos';
    await db.run(`UPDATE ${table} SET deleted_at = NULL WHERE id = ?`, [it.id]);
    n++;
  }
  _notifySidebarRefresh();
  return n;
}

async function moEmptyTrash(api) {
  const photos = await db.all(
    `SELECT 'photo' AS type, p.id AS id, fl.path AS folder_path, f.basename
       FROM mo_photos p
       JOIN mo_photos_files pf ON pf.photo_id = p.id
       JOIN mo_files f ON f.id = pf.file_id
       JOIN mo_folders fl ON fl.id = f.folder_id
      WHERE p.deleted_at IS NOT NULL`
  );
  const videos = await db.all(
    `SELECT 'video' AS type, v.id AS id, fl.path AS folder_path, f.basename
       FROM mo_videos v
       JOIN mo_videos_files vf ON vf.video_id = v.id
       JOIN mo_files f ON f.id = vf.file_id
       JOIN mo_folders fl ON fl.id = f.folder_id
      WHERE v.deleted_at IS NOT NULL`
  );
  const total = photos.length + videos.length;
  if (total === 0) {
    api.window.showInformationMessage('Trash is empty.');
    return;
  }
  const ok = await api.window.showWarningMessage(
    `Permanently delete ${total} trashed item${total === 1 ? '' : 's'}? Files will be moved to OS recycle bin.`,
    'Empty Trash', 'Cancel'
  );
  if (ok !== 'Empty Trash') return;
  const sep = _isWindows ? '\\' : '/';
  let trashed = 0, failed = 0;
  // Delete OS files first
  const allItems = [...photos, ...videos];
  const seenFiles = new Set();
  for (const it of allItems) {
    const fpath = (it.folder_path || '') + sep + it.basename;
    if (seenFiles.has(fpath)) continue;
    seenFiles.add(fpath);
    const r = await window.parallxElectron.fs.delete(fpath).catch(() => ({ error: 'fail' }));
    if (r && !r.error) trashed++; else failed++;
  }
  // Hard-delete DB rows (cascades take care of joins via FK if defined)
  await db.run(`DELETE FROM mo_photos WHERE deleted_at IS NOT NULL`);
  await db.run(`DELETE FROM mo_videos WHERE deleted_at IS NOT NULL`);
  // Orphan files (no remaining photo/video links) get deleted too
  await db.run(`
    DELETE FROM mo_files
     WHERE id NOT IN (SELECT file_id FROM mo_photos_files)
       AND id NOT IN (SELECT file_id FROM mo_videos_files)
  `);
  api.window.showInformationMessage(`Trash emptied: ${trashed} file${trashed === 1 ? '' : 's'} moved to recycle bin` + (failed ? `, ${failed} failed` : '') + '.');
  _notifySidebarRefresh();
  moRebuildSearchIndex().catch(() => {});
}

// Auto-empty trash older than N days (default 30). Setting key: trash_auto_purge_days.
async function moAutoEmptyTrashIfStale() {
  try {
    const row = await db.get(`SELECT value FROM mo_settings WHERE key = 'trash_auto_purge_days'`);
    const days = row && row.value ? parseInt(row.value, 10) : 30;
    if (!days || days <= 0) return;
    // Hard-delete rows whose deleted_at is older than N days
    await db.run(
      `DELETE FROM mo_photos WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)`,
      [`-${days} days`]
    );
    await db.run(
      `DELETE FROM mo_videos WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)`,
      [`-${days} days`]
    );
    await db.run(`
      DELETE FROM mo_files
       WHERE id NOT IN (SELECT file_id FROM mo_photos_files)
         AND id NOT IN (SELECT file_id FROM mo_videos_files)
    `);
  } catch (err) {
    console.warn('[MediaOrganizer] auto-purge trash failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10E: TIMELINE + MAP — M59 P6
// ═══════════════════════════════════════════════════════════════════════════════

// ── Timeline view ──
// Modal full-screen view: all photos+videos grouped by year/month/day with
// sticky date headers. Click a thumbnail to open the detail dialog (delegated
// via the standard mo:request-open-detail event).
async function moOpenTimeline(api) {
  const photos = await db.all(
    `SELECT 'photo' AS type, p.id, p.title, COALESCE(p.taken_at, p.created_at) AS dt
       FROM mo_photos p
      WHERE p.deleted_at IS NULL
      ORDER BY dt DESC
      LIMIT 5000`
  );
  const videos = await db.all(
    `SELECT 'video' AS type, v.id, v.title, v.created_at AS dt
       FROM mo_videos v
      WHERE v.deleted_at IS NULL
      ORDER BY dt DESC
      LIMIT 5000`
  );
  const all = [...photos, ...videos].sort((a, b) => (b.dt || '').localeCompare(a.dt || ''));
  if (all.length === 0) {
    api.window.showInformationMessage('No items to show on timeline.');
    return;
  }

  // Bucket by year-month-day
  const buckets = new Map(); // key = YYYY-MM-DD
  for (const it of all) {
    const day = (it.dt || '').slice(0, 10) || 'Unknown';
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day).push(it);
  }

  const overlay = moEl('div', 'mo-modal-overlay');
  const dialog = moEl('div', 'mo-modal mo-timeline-dialog');
  overlay.appendChild(dialog);
  const header = moEl('div', 'mo-modal-header');
  header.appendChild(moEl('div', 'mo-modal-title', { textContent: `Timeline (${all.length} items)` }));
  const closeBtn = moEl('button', 'mo-modal-close', { textContent: '×' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const body = moEl('div', 'mo-timeline-body');
  dialog.appendChild(body);

  const monthFmt = (key) => {
    if (key === 'Unknown') return 'Unknown date';
    const [y, m, d] = key.split('-');
    const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
    return date.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'long', day: 'numeric' });
  };

  for (const [day, items] of buckets) {
    const sectHeader = moEl('div', 'mo-timeline-section-header');
    sectHeader.textContent = monthFmt(day);
    body.appendChild(sectHeader);

    const grid = moEl('div', 'mo-timeline-grid');
    for (const item of items) {
      const tile = moEl('div', 'mo-timeline-tile');
      tile.dataset.type = item.type; tile.dataset.id = String(item.id);
      tile.title = item.title || `${item.type} #${item.id}`;
      const ph = moEl('div', 'mo-timeline-tile-ph', { innerHTML: moIcon(item.type === 'video' ? 'device-camera-video' : 'image', 24) });
      tile.appendChild(ph);
      // Lazy thumbnail: defer until visible
      tile.addEventListener('click', () => {
        _api.editors.openEditor({
          typeId: 'media-organizer-grid',
          title: item.title || `${item.type} #${item.id}`,
          icon: item.type === 'video' ? 'file-media' : 'image',
          instanceId: `detail:${item.type}:${item.id}`,
        });
        overlay.remove();
      });
      grid.appendChild(tile);
    }
    body.appendChild(grid);
  }

  // Lazy-load thumbnails as tiles enter viewport
  if ('IntersectionObserver' in window) {
    const tilesObs = new IntersectionObserver(async (entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const tile = e.target;
        obs.unobserve(tile);
        const type = tile.dataset.type;
        const id = parseInt(tile.dataset.id, 10);
        try {
          const r = await resolveThumbnail(type, id, _api);
          if (r && r.path) {
            const url = await localFileToUrl(r.path);
            if (url) {
              tile.innerHTML = '';
              const img = moEl('img');
              img.src = url; img.loading = 'lazy';
              tile.appendChild(img);
            }
          }
        } catch { /* ignore */ }
      }
    }, { rootMargin: '300px 0px' });
    body.querySelectorAll('.mo-timeline-tile').forEach(t => tilesObs.observe(t));
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ── Map view ──
// Offline canvas-based world plot. Uses an equirectangular projection;
// adequate for "where were these taken?" overview. Click a point to open
// the detail dialog. Pan via drag, zoom via wheel.
async function moOpenMap(api) {
  const rows = await db.all(
    `SELECT p.id, p.title, p.gps_latitude AS lat, p.gps_longitude AS lon
       FROM mo_photos p
      WHERE p.deleted_at IS NULL
        AND p.gps_latitude IS NOT NULL
        AND p.gps_longitude IS NOT NULL`
  );
  if (rows.length === 0) {
    api.window.showInformationMessage('No photos with GPS coordinates found.');
    return;
  }

  const overlay = moEl('div', 'mo-modal-overlay');
  const dialog = moEl('div', 'mo-modal mo-map-dialog');
  overlay.appendChild(dialog);
  const header = moEl('div', 'mo-modal-header');
  header.appendChild(moEl('div', 'mo-modal-title', { textContent: `Map (${rows.length} geotagged)` }));
  const closeBtn = moEl('button', 'mo-modal-close', { textContent: '×' });
  closeBtn.addEventListener('click', () => overlay.remove());
  header.appendChild(closeBtn);
  dialog.appendChild(header);

  const canvas = moEl('canvas', 'mo-map-canvas');
  canvas.width = 900; canvas.height = 540;
  dialog.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  // Camera state — pan offsets in screen px, zoom factor
  let zoom = 1;
  let panX = 0, panY = 0;
  let dragging = false;
  let dragStartX = 0, dragStartY = 0, panStartX = 0, panStartY = 0;

  function project(lat, lon) {
    // Equirectangular: lon → x ∈ [-180,180] → [0, w], lat → y ∈ [90,-90] → [0, h]
    const baseW = canvas.width, baseH = canvas.height;
    let x = ((lon + 180) / 360) * baseW;
    let y = ((90 - lat) / 180) * baseH;
    x = (x - baseW / 2) * zoom + baseW / 2 + panX;
    y = (y - baseH / 2) * zoom + baseH / 2 + panY;
    return { x, y };
  }

  function unproject(sx, sy) {
    const baseW = canvas.width, baseH = canvas.height;
    let x = (sx - baseW / 2 - panX) / zoom + baseW / 2;
    let y = (sy - baseH / 2 - panY) / zoom + baseH / 2;
    const lon = (x / baseW) * 360 - 180;
    const lat = 90 - (y / baseH) * 180;
    return { lat, lon };
  }

  // Draw world graticule + points
  function draw() {
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Graticule lines every 30°
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1;
    for (let lon = -180; lon <= 180; lon += 30) {
      const a = project(-90, lon), b = project(90, lon);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const a = project(lat, -180), b = project(lat, 180);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    // Equator stronger
    ctx.strokeStyle = '#555';
    const a = project(0, -180), b = project(0, 180);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // Cluster points by approximate proximity at current zoom
    const clusters = [];
    const radius = 14;
    for (const r of rows) {
      const p = project(r.lat, r.lon);
      let assigned = false;
      for (const c of clusters) {
        if (Math.hypot(c.x - p.x, c.y - p.y) < radius) {
          c.x = (c.x * c.count + p.x) / (c.count + 1);
          c.y = (c.y * c.count + p.y) / (c.count + 1);
          c.count++;
          c.items.push(r);
          assigned = true; break;
        }
      }
      if (!assigned) clusters.push({ x: p.x, y: p.y, count: 1, items: [r] });
    }

    // Draw clusters
    for (const c of clusters) {
      const r = c.count > 1 ? Math.min(28, 8 + Math.sqrt(c.count) * 2) : 6;
      ctx.fillStyle = c.count > 1 ? 'rgba(147,51,234,0.85)' : 'rgba(245,197,24,0.95)';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (c.count > 1) {
        ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(c.count), c.x, c.y);
      }
    }
    canvas._clusters = clusters;
  }

  draw();

  canvas.addEventListener('mousedown', (e) => {
    dragging = true;
    dragStartX = e.clientX; dragStartY = e.clientY;
    panStartX = panX; panStartY = panY;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panX = panStartX + (e.clientX - dragStartX);
    panY = panStartY + (e.clientY - dragStartY);
    draw();
  });
  window.addEventListener('mouseup', () => { dragging = false; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoom = Math.max(1, Math.min(20, zoom * factor));
    draw();
  }, { passive: false });
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const clusters = canvas._clusters || [];
    for (const c of clusters) {
      if (Math.hypot(c.x - sx, c.y - sy) < 16) {
        if (c.count === 1) {
          _api.editors.openEditor({
            typeId: 'media-organizer-grid',
            title: c.items[0].title || `photo #${c.items[0].id}`,
            icon: 'image',
            instanceId: `detail:photo:${c.items[0].id}`,
          });
          overlay.remove();
        } else {
          // Zoom in toward cluster
          zoom = Math.min(20, zoom * 2);
          const baseW = canvas.width, baseH = canvas.height;
          panX -= (c.x - baseW / 2);
          panY -= (c.y - baseH / 2);
          draw();
        }
        return;
      }
    }
  });

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10F: AI CHAT TOOLS — M59 P8
// ═══════════════════════════════════════════════════════════════════════════════
//
// Tools registered via `api.chat.registerTool(name, def)` so the AI agent
// (and users via /tool invocation) can query the library deterministically.
//
// Vision-based tools (tagUntagged, describePhoto, autoRate, searchByDescription)
// are NOT registered — the current `parallx.lm` API only accepts text content
// (no image attachments), so a vision pipeline cannot be implemented from an
// extension today. They will be added when the LM API gains multimodal support.

async function moToolFindSimilar(args) {
  const photoId = parseInt(args.photoId, 10);
  const limit = Math.min(100, parseInt(args.limit, 10) || 20);
  if (!photoId || isNaN(photoId)) {
    return { content: 'Error: photoId is required (integer).', isError: true };
  }
  const seedRow = await db.get(
    `SELECT i.phash AS phash
       FROM mo_photos_files pf
       JOIN mo_image_files i ON i.file_id = pf.file_id
      WHERE pf.photo_id = ? AND i.phash IS NOT NULL
      LIMIT 1`,
    [photoId]
  );
  if (!seedRow || seedRow.phash == null) {
    return { content: `Photo ${photoId} has no perceptual hash. Run "Index Perceptual Hashes" first.`, isError: true };
  }
  const seedBig = moSqliteToBigInt(seedRow.phash);
  const all = await db.all(
    `SELECT pf.photo_id AS photo_id, i.phash AS phash, p.title AS title
       FROM mo_image_files i
       JOIN mo_photos_files pf ON pf.file_id = i.file_id
       JOIN mo_photos p ON p.id = pf.photo_id
      WHERE i.phash IS NOT NULL AND p.deleted_at IS NULL AND p.id <> ?`,
    [photoId]
  );
  const scored = [];
  for (const r of all) {
    const d = moHammingDistance(seedBig, moSqliteToBigInt(r.phash));
    scored.push({ photoId: r.photo_id, title: r.title || '', distance: d });
  }
  scored.sort((a, b) => a.distance - b.distance);
  const top = scored.slice(0, limit);
  return {
    content: JSON.stringify({ seed: photoId, results: top }, null, 2),
  };
}

async function moToolSuggestStacks(args) {
  const limit = Math.min(50, parseInt(args.limit, 10) || 20);
  // Re-use the basename heuristic without applying — return proposed groups.
  const rows = await db.all(
    `SELECT 'photo' AS type, p.id AS id, f.basename AS basename, fl.path AS folder_path
       FROM mo_photos p
       JOIN mo_photos_files pf ON pf.photo_id = p.id
       JOIN mo_files f ON f.id = pf.file_id
       JOIN mo_folders fl ON fl.id = f.folder_id
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM mo_stack_members sm WHERE sm.member_type='photo' AND sm.member_id=p.id)`
  );
  const groups = new Map();
  const stripExt = (s) => s.replace(/\.[^.]+$/, '');
  const stripSuffix = (s) => s.replace(/[-_\s]?(edited|edit|v\d+|copy|final|hdr)$/i, '');
  for (const r of rows) {
    const key = `${r.folder_path}::${stripSuffix(stripExt(r.basename || '')).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ type: r.type, id: r.id, basename: r.basename });
  }
  const candidates = [];
  for (const [k, items] of groups) {
    if (items.length >= 2) candidates.push({ key: k, items });
  }
  return {
    content: JSON.stringify({
      proposed: candidates.slice(0, limit),
      total: candidates.length,
      note: 'Proposed only. Run "Auto-Stack by Filename" command to apply.',
    }, null, 2),
  };
}

async function moToolGetStats() {
  const photoCount = await db.get(`SELECT COUNT(*) AS n FROM mo_photos WHERE deleted_at IS NULL`);
  const videoCount = await db.get(`SELECT COUNT(*) AS n FROM mo_videos WHERE deleted_at IS NULL`);
  const trashedPhotos = await db.get(`SELECT COUNT(*) AS n FROM mo_photos WHERE deleted_at IS NOT NULL`);
  const trashedVideos = await db.get(`SELECT COUNT(*) AS n FROM mo_videos WHERE deleted_at IS NOT NULL`);
  const untaggedPhotos = await db.get(
    `SELECT COUNT(*) AS n FROM mo_photos p
      WHERE p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM mo_photo_tags pt WHERE pt.photo_id = p.id)`
  );
  const geotagged = await db.get(
    `SELECT COUNT(*) AS n FROM mo_photos
      WHERE deleted_at IS NULL AND gps_latitude IS NOT NULL AND gps_longitude IS NOT NULL`
  );
  const phashed = await db.get(`SELECT COUNT(*) AS n FROM mo_image_files WHERE phash IS NOT NULL`);
  const stacks = await db.get(`SELECT COUNT(*) AS n FROM mo_stacks`);
  const topTags = await db.all(
    `SELECT t.name AS name, COUNT(*) AS n FROM mo_photo_tags pt
       JOIN mo_tags t ON t.id = pt.tag_id
      GROUP BY t.id ORDER BY n DESC LIMIT 10`
  );
  return {
    content: JSON.stringify({
      photos: photoCount.n,
      videos: videoCount.n,
      trashed: { photos: trashedPhotos.n, videos: trashedVideos.n },
      untaggedPhotos: untaggedPhotos.n,
      geotagged: geotagged.n,
      perceptualHashIndexed: phashed.n,
      stacks: stacks.n,
      topTags: topTags.map(t => ({ name: t.name, count: t.n })),
    }, null, 2),
  };
}

async function moToolSearch(args) {
  const query = String(args.query || '').trim();
  const limit = Math.min(200, parseInt(args.limit, 10) || 50);
  if (!query) return { content: 'Error: query is required.', isError: true };
  // Use FTS5 if available for free-text; otherwise LIKE fallback
  const like = `%${query.replace(/[%_]/g, '\\$&')}%`;
  const photos = await db.all(
    `SELECT p.id, p.title, p.taken_at FROM mo_photos p
       JOIN mo_photos_files pf ON pf.photo_id = p.id
       JOIN mo_files f ON f.id = pf.file_id
      WHERE p.deleted_at IS NULL
        AND (p.title LIKE ? ESCAPE '\\' OR p.details LIKE ? ESCAPE '\\' OR f.basename LIKE ? ESCAPE '\\')
      ORDER BY COALESCE(p.taken_at, p.created_at) DESC
      LIMIT ?`,
    [like, like, like, limit]
  );
  const videos = await db.all(
    `SELECT v.id, v.title, v.created_at FROM mo_videos v
       JOIN mo_videos_files vf ON vf.video_id = v.id
       JOIN mo_files f ON f.id = vf.file_id
      WHERE v.deleted_at IS NULL
        AND (v.title LIKE ? ESCAPE '\\' OR v.details LIKE ? ESCAPE '\\' OR f.basename LIKE ? ESCAPE '\\')
      ORDER BY v.created_at DESC
      LIMIT ?`,
    [like, like, like, limit]
  );
  return {
    content: JSON.stringify({
      query,
      photos: photos.map(p => ({ id: p.id, title: p.title, taken_at: p.taken_at })),
      videos: videos.map(v => ({ id: v.id, title: v.title, created_at: v.created_at })),
    }, null, 2),
  };
}

function moRegisterAITools(api) {
  if (!api.chat || typeof api.chat.registerTool !== 'function') {
    console.warn('[MediaOrganizer] api.chat.registerTool not available — AI tools skipped');
    return;
  }
  try {
    _commandDisposables.push(api.chat.registerTool('mediaOrganizer.findSimilar', {
      description: 'Find photos visually similar to a given photo using perceptual hash (Hamming distance). Requires pHash indexing to have run first.',
      parameters: {
        type: 'object',
        properties: {
          photoId: { type: 'integer', description: 'The mo_photos.id to find similar images for.' },
          limit: { type: 'integer', description: 'Max results (default 20, max 100).' },
        },
        required: ['photoId'],
      },
      handler: async (args) => moToolFindSimilar(args),
      requiresConfirmation: false,
    }));
    _commandDisposables.push(api.chat.registerTool('mediaOrganizer.suggestStacks', {
      description: 'Suggest photo stacks (versions/variants) by grouping unstacked photos with similar basenames in the same folder. Returns proposed groups; does not apply them.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'integer', description: 'Max proposed groups to return (default 20, max 50).' },
        },
      },
      handler: async (args) => moToolSuggestStacks(args),
      requiresConfirmation: false,
    }));
    _commandDisposables.push(api.chat.registerTool('mediaOrganizer.getStats', {
      description: 'Return summary statistics for the media library: photo/video counts, trashed counts, untagged photos, geotagged photos, perceptual-hash coverage, stack count, top 10 tags.',
      parameters: { type: 'object', properties: {} },
      handler: async () => moToolGetStats(),
      requiresConfirmation: false,
    }));
    _commandDisposables.push(api.chat.registerTool('mediaOrganizer.search', {
      description: 'Search the media library by free-text against title, description, and filename. Returns matching photos and videos with IDs.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query.' },
          limit: { type: 'integer', description: 'Max results per type (default 50, max 200).' },
        },
        required: ['query'],
      },
      handler: async (args) => moToolSearch(args),
      requiresConfirmation: false,
    }));
    console.log('[MediaOrganizer] Registered 4 AI chat tools (findSimilar, suggestStacks, getStats, search)');
  } catch (err) {
    console.warn('[MediaOrganizer] AI tool registration failed:', err);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11: ACTIVATION
// ═══════════════════════════════════════════════════════════════════════════════

let _toolPath = '';
let _activated = false;
const _sidebarRefreshCallbacks = [];
function _notifySidebarRefresh() { for (const cb of _sidebarRefreshCallbacks) { try { cb(); } catch {} } }
let _commandDisposables = [];
let _api = null;

async function ensureDatabase(api) {
  // Open the per-extension database (creates it if needed)
  const openResult = await api.database.open();
  if (openResult.error) {
    console.error('[MediaOrganizer] Database open failed:', openResult.error.message);
    return false;
  }
  const toolPath = api.env.toolPath;
  const sep = toolPath.includes('\\') ? '\\' : '/';
  const migrationsDir = toolPath + sep + 'db' + sep + 'migrations';
  const res = await api.database.migrate(migrationsDir);
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

  // Bind the per-extension database bridge for the db wrapper
  if (!api.database) {
    console.error('[MediaOrganizer] Activation failed — api.database not available (extension database required)');
    return;
  }
  _dbBridge = api.database;

  const ok = await ensureDatabase(api);
  if (!ok) {
    console.error('[MediaOrganizer] Activation failed — database not ready');
    return;
  }

  // Status bar item for scan progress
  _statusBarItem = api.window.createStatusBarItem(1, 100);

  // Purge any .parallx internal paths from the media database.
  // These should never have been scanned (thumbnail dirs, extension data).
  try {
    const internalFolders = await db.all(
      `SELECT id FROM mo_folders WHERE path LIKE '%/.parallx/%' OR path LIKE '%\\.parallx\\%' OR path LIKE '%\\.parallx'`
    );
    if (internalFolders.length > 0) {
      const ids = internalFolders.map(f => f.id);
      const placeholders = ids.map(() => '?').join(',');
      // Get files in these folders
      const internalFiles = await db.all(
        `SELECT id FROM mo_files WHERE folder_id IN (${placeholders})`, ids
      );
      if (internalFiles.length > 0) {
        const fileIds = internalFiles.map(f => f.id);
        const fph = fileIds.map(() => '?').join(',');
        // Remove domain entity links and orphan entities
        const photoLinks = await db.all(`SELECT DISTINCT photo_id FROM mo_photos_files WHERE file_id IN (${fph})`, fileIds);
        const videoLinks = await db.all(`SELECT DISTINCT video_id FROM mo_videos_files WHERE file_id IN (${fph})`, fileIds);
        await db.run(`DELETE FROM mo_photos_files WHERE file_id IN (${fph})`, fileIds);
        await db.run(`DELETE FROM mo_videos_files WHERE file_id IN (${fph})`, fileIds);
        // Remove orphan photos (no remaining file links)
        for (const pl of photoLinks) {
          const remaining = await db.get(`SELECT COUNT(*) as cnt FROM mo_photos_files WHERE photo_id = ?`, [pl.photo_id]);
          if (!remaining || remaining.cnt === 0) await db.run(`DELETE FROM mo_photos WHERE id = ?`, [pl.photo_id]);
        }
        for (const vl of videoLinks) {
          const remaining = await db.get(`SELECT COUNT(*) as cnt FROM mo_videos_files WHERE video_id = ?`, [vl.video_id]);
          if (!remaining || remaining.cnt === 0) await db.run(`DELETE FROM mo_videos WHERE id = ?`, [vl.video_id]);
        }
        await db.run(`DELETE FROM mo_fingerprints WHERE file_id IN (${fph})`, fileIds);
        await db.run(`DELETE FROM mo_files WHERE id IN (${fph})`, fileIds);
      }
      await db.run(`DELETE FROM mo_folders WHERE id IN (${placeholders})`, ids);
      console.log(`[MediaOrganizer] Purged ${internalFolders.length} internal .parallx folder(s) and ${internalFiles.length} file(s) from database`);
    }
  } catch (err) {
    console.warn('[MediaOrganizer] .parallx cleanup failed:', err);
  }

  // Backfill mo_scan_roots from existing root folders (pre-watcher scans)
  try {
    const existingRoots = await getScanRoots();
    if (existingRoots.length === 0) {
      const rootFolders = await db.all(
        `SELECT path FROM mo_folders WHERE parent_folder_id IS NULL ORDER BY path ASC`
      );
      for (const rf of rootFolders) {
        if (isInternalPath(rf.path)) continue;
        await recordScanRoot(rf.path);
      }
      if (rootFolders.length > 0) {
        console.log(`[MediaOrganizer] Backfilled ${rootFolders.length} scan root(s) from existing folders`);
      }
    }
  } catch (err) {
    console.warn('[MediaOrganizer] Scan root backfill failed:', err);
  }

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

  // F4: Regenerate all thumbnails with overwrite
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.regenerateThumbnails', async () => {
      const confirmed = await api.window.showInformationMessage(
        'This will re-generate ALL thumbnails at the current quality setting. Continue?',
        { modal: true },
        'Regenerate'
      );
      if (confirmed === 'Regenerate') generateAllThumbnails(api, true);
    })
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

  // M59 P1: Review animated WebP files
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.reviewWebP', () => moOpenWebPReviewDialog(api))
  );

  // M59 P2: Configure auto-WebP mode
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.setAutoWebPMode', () => moPickAutoWebPMode(api))
  );

  // M59 P3: Search index, perceptual hash, duplicate finder, smart albums
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.rebuildSearchIndex', async () => {
      api.window.showInformationMessage('Rebuilding search index…');
      await moRebuildSearchIndex();
      api.window.showInformationMessage('Search index rebuilt.');
    })
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.buildPHashes', () => moRunPHashIndexer(api))
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.findDuplicates', () => moOpenDuplicateFinder(api))
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.saveSmartAlbum', async () => {
      // Read current grid query state via the active grid editor's exposed state.
      // We reach into the latest cached state by dispatching a custom event the grid listens for.
      const ev = new CustomEvent('mo:request-search-state');
      const handler = (e) => {
        document.removeEventListener('mo:reply-search-state', handler);
        const s = e.detail || {};
        moSaveSmartAlbum(api, s.query || '', s.filters || {});
      };
      document.addEventListener('mo:reply-search-state', handler, { once: true });
      document.dispatchEvent(ev);
      // Fallback if no grid is open
      setTimeout(() => {
        document.removeEventListener('mo:reply-search-state', handler);
      }, 500);
    })
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.openSmartAlbum', async () => {
      await moOpenSmartAlbum(api, (parsed) => {
        const ev = new CustomEvent('mo:apply-search-state', { detail: parsed });
        document.dispatchEvent(ev);
      });
    })
  );

  // M59 P5: stacks + trash
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.stackSelected', () => {
      const ev = new CustomEvent('mo:request-selection');
      const handler = (e) => {
        document.removeEventListener('mo:reply-selection', handler);
        const sel = (e.detail && e.detail.selectedIds) || new Set();
        moStackSelected(api, sel);
      };
      document.addEventListener('mo:reply-selection', handler, { once: true });
      document.dispatchEvent(ev);
      setTimeout(() => document.removeEventListener('mo:reply-selection', handler), 500);
    })
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.autoStack', () => moAutoStackByBasename(api))
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.moveToTrash', () => {
      const ev = new CustomEvent('mo:request-selection');
      const handler = async (e) => {
        document.removeEventListener('mo:reply-selection', handler);
        const sel = (e.detail && e.detail.selectedIds) || new Set();
        const items = [...sel].map(s => { const [type, id] = s.split(':'); return { type, id: parseInt(id, 10) }; });
        const n = await moMoveToTrash(api, items);
        api.window.showInformationMessage(`Moved ${n} item${n === 1 ? '' : 's'} to trash.`);
        const refresh = new CustomEvent('mo:refresh-grid');
        document.dispatchEvent(refresh);
      };
      document.addEventListener('mo:reply-selection', handler, { once: true });
      document.dispatchEvent(ev);
      setTimeout(() => document.removeEventListener('mo:reply-selection', handler), 500);
    })
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.emptyTrash', () => moEmptyTrash(api))
  );

  // M59 P6: timeline + map views
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.openTimeline', () => moOpenTimeline(api))
  );
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.openMap', () => moOpenMap(api))
  );

  // M59 P7: reveal-in-MO from any file path
  _commandDisposables.push(
    api.commands.registerCommand('media-organizer.revealInMO', async (arg) => {
      const path = (typeof arg === 'string') ? arg : (arg && arg.path) || '';
      if (!path) {
        api.window.showWarningMessage('Reveal in Media Organizer: no path provided.');
        return;
      }
      // Open the All Media grid first
      await api.editors.openEditor({
        typeId: 'media-organizer-grid',
        title: 'Media Library',
        icon: 'image',
        instanceId: 'grid:all',
      });
      // Then dispatch search to filter to that file's basename
      const basename = String(path).split(/[\\/]/).pop() || '';
      setTimeout(() => {
        document.dispatchEvent(new CustomEvent('mo:apply-search-state', {
          detail: { query: basename, filters: {} },
        }));
      }, 80);
    })
  );

  // M59 P1: Purge expired quarantine (>30d)
  moPurgeQuarantine(api).catch(() => {});
  // M59 P5: auto-empty trash older than N days (default 30)
  moAutoEmptyTrashIfStale().catch(() => {});
  // M59 P8: register AI chat tools
  moRegisterAITools(api);

  console.log('[MediaOrganizer] Activated — D1-D8 ready (data, scan, thumbnails, tags, grid, filter, detail, albums)');

  // Resume file watchers for previously scanned directories + run delta scan
  resumeWatchersAndDeltaScan(api);
}

export function deactivate() {
  cancelScan();
  stopAllWatchers();
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
