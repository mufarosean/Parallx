// relationResolver.ts — Relation property resolution and reciprocal sync
//
// Relations link pages across databases. A "relation" property on Database A
// points to rows in Database B (or itself for self-referential relations).
// When a reciprocal property exists on Database B, adding/removing a link
// on one side automatically updates the other.
//
// This module provides:
//   - Relation resolution (expand relation value IDs to page metadata)
//   - Reciprocal sync (add/remove link on one side → mirror on the other)
//   - Relation picker support (available pages from the target database)
//
// Gate compliance: imports only from databaseRegistry (parent gate).

import type {
  IDatabaseDataService,
  IDatabaseProperty,
  IPropertyValue,
  IRelationPropertyConfig,
} from '../databaseRegistry.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * A resolved relation entry — the raw `{ id }` expanded with the page's title
 * so renderers can display clickable page names.
 */
export interface IResolvedRelation {
  readonly id: string;
  readonly title: string;
}

/**
 * A page available for linking in a relation picker.
 */
export interface IRelationCandidate {
  readonly id: string;
  readonly title: string;
  readonly isLinked: boolean;
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolve a relation property value to page titles.
 *
 * Given a relation value `{ type: 'relation', relation: [{ id: 'p1' }, { id: 'p2' }] }`,
 * fetches the rows from the target database and maps each ID to its title.
 * Pages that no longer exist (deleted) are silently dropped.
 */
export async function resolveRelation(
  dataService: IDatabaseDataService,
  property: IDatabaseProperty,
  value: IPropertyValue | undefined,
): Promise<IResolvedRelation[]> {
  if (!value || value.type !== 'relation') return [];

  const config = property.config as IRelationPropertyConfig;
  if (!config.databaseId) return [];

  const linkedIds = new Set(value.relation.map(r => r.id));
  if (linkedIds.size === 0) return [];

  const rows = await dataService.getRows(config.databaseId);
  const result: IResolvedRelation[] = [];

  for (const row of rows) {
    if (linkedIds.has(row.page.id)) {
      result.push({
        id: row.page.id,
        title: row.page.title || 'Untitled',
      });
    }
  }

  return result;
}

/**
 * Get candidate pages from the target database for a relation picker.
 * Returns all pages in the target database, marking which ones are already linked.
 */
export async function getRelationCandidates(
  dataService: IDatabaseDataService,
  property: IDatabaseProperty,
  currentValue: IPropertyValue | undefined,
): Promise<IRelationCandidate[]> {
  const config = property.config as IRelationPropertyConfig;
  if (!config.databaseId) return [];

  const linkedIds = new Set(
    currentValue?.type === 'relation'
      ? currentValue.relation.map(r => r.id)
      : [],
  );

  const rows = await dataService.getRows(config.databaseId);

  return rows.map(row => ({
    id: row.page.id,
    title: row.page.title || 'Untitled',
    isLinked: linkedIds.has(row.page.id),
  }));
}

// ─── Link Mutation ───────────────────────────────────────────────────────────

/**
 * Add a link to a relation property value.
 * Returns the new IPropertyValue to store.
 */
export function addRelationLink(
  currentValue: IPropertyValue | undefined,
  targetPageId: string,
): IPropertyValue {
  const existing = currentValue?.type === 'relation'
    ? currentValue.relation.filter(r => r.id !== targetPageId)
    : [];

  return {
    type: 'relation',
    relation: [...existing, { id: targetPageId }],
  };
}

/**
 * Remove a link from a relation property value.
 * Returns the new IPropertyValue to store.
 */
export function removeRelationLink(
  currentValue: IPropertyValue | undefined,
  targetPageId: string,
): IPropertyValue {
  const existing = currentValue?.type === 'relation'
    ? currentValue.relation.filter(r => r.id !== targetPageId)
    : [];

  return {
    type: 'relation',
    relation: existing,
  };
}

/**
 * Toggle a link in a relation property value (add if absent, remove if present).
 * Returns the new IPropertyValue and whether the link was added.
 */
export function toggleRelationLink(
  currentValue: IPropertyValue | undefined,
  targetPageId: string,
): { value: IPropertyValue; added: boolean } {
  const existing = currentValue?.type === 'relation'
    ? currentValue.relation
    : [];

  const isLinked = existing.some(r => r.id === targetPageId);

  if (isLinked) {
    return {
      value: removeRelationLink(currentValue, targetPageId),
      added: false,
    };
  } else {
    return {
      value: addRelationLink(currentValue, targetPageId),
      added: true,
    };
  }
}

// ─── Reciprocal Sync ─────────────────────────────────────────────────────────

/**
 * Create a reciprocal relation property on the target database.
 *
 * When a relation property is created on Database A pointing to Database B,
 * this function creates the mirror property on Database B pointing back to A.
 * Both properties then reference each other via `syncedPropertyId`.
 */
export async function createReciprocalRelation(
  dataService: IDatabaseDataService,
  sourceProperty: IDatabaseProperty,
  sourceDatabaseId: string,
  targetDatabaseId: string,
): Promise<IDatabaseProperty> {
  // Get source database to build the reciprocal name
  const sourceDb = await dataService.getDatabase(sourceDatabaseId);
  const reciprocalName = sourceDb ? `Related to ${sourceDb.pageId}` : 'Related';

  // Create the reciprocal property on the target
  const reciprocalConfig: IRelationPropertyConfig = {
    databaseId: sourceDatabaseId,
    syncedPropertyId: sourceProperty.id,
    syncedPropertyName: sourceProperty.name,
  };

  const reciprocal = await dataService.addProperty(
    targetDatabaseId,
    reciprocalName,
    'relation',
    reciprocalConfig,
  );

  // Update the source property to reference the reciprocal
  await dataService.updateProperty(sourceDatabaseId, sourceProperty.id, {
    config: {
      ...(sourceProperty.config as IRelationPropertyConfig),
      syncedPropertyId: reciprocal.id,
      syncedPropertyName: reciprocal.name,
    },
  });

  return reciprocal;
}

/**
 * Sync reciprocal relation after a link is added or removed.
 *
 * When page P1 in Database A links to page P2 in Database B via a relation
 * property, this function updates P2's reciprocal relation property to include P1.
 *
 * @param dataService - The database data service
 * @param sourceProperty - The relation property on the source database
 * @param sourcePageId - The page that initiated the link change
 * @param targetPageId - The linked/unlinked page on the target database
 * @param added - `true` if the link was added, `false` if removed
 */
export async function syncReciprocal(
  dataService: IDatabaseDataService,
  sourceProperty: IDatabaseProperty,
  sourcePageId: string,
  targetPageId: string,
  added: boolean,
): Promise<void> {
  const config = sourceProperty.config as IRelationPropertyConfig;
  if (!config.syncedPropertyId || !config.databaseId) return;

  // Get the current value of the reciprocal property on the target page
  const targetValues = await dataService.getPropertyValues(
    config.databaseId,
    targetPageId,
  );

  const reciprocalValue = targetValues[config.syncedPropertyId];

  // Compute the new reciprocal value
  const newValue = added
    ? addRelationLink(reciprocalValue, sourcePageId)
    : removeRelationLink(reciprocalValue, sourcePageId);

  // Write it back
  await dataService.setPropertyValue(
    config.databaseId,
    targetPageId,
    config.syncedPropertyId,
    newValue,
  );
}

/**
 * Perform a relation link change with automatic reciprocal sync.
 *
 * This is the primary entry point for relation mutations. It:
 * 1. Toggles the link on the source side
 * 2. Writes the new value to the data service
 * 3. Syncs the reciprocal side (if a synced property exists)
 */
export async function setRelationWithSync(
  dataService: IDatabaseDataService,
  sourceDatabaseId: string,
  sourcePageId: string,
  sourceProperty: IDatabaseProperty,
  targetPageId: string,
): Promise<{ value: IPropertyValue; added: boolean }> {
  // Get current value
  const values = await dataService.getPropertyValues(sourceDatabaseId, sourcePageId);
  const currentValue = values[sourceProperty.id];

  // Toggle the link
  const { value: newValue, added } = toggleRelationLink(currentValue, targetPageId);

  // Write the source side
  await dataService.setPropertyValue(
    sourceDatabaseId,
    sourcePageId,
    sourceProperty.id,
    newValue,
  );

  // Sync the reciprocal side
  await syncReciprocal(dataService, sourceProperty, sourcePageId, targetPageId, added);

  return { value: newValue, added };
}

// ─── Self-Referential Relations ──────────────────────────────────────────────

/**
 * Check if a relation is self-referential (database relates to itself).
 */
export function isSelfRelation(property: IDatabaseProperty): boolean {
  const config = property.config as IRelationPropertyConfig;
  return config.databaseId === property.databaseId;
}

/**
 * Get candidate pages for a self-referential relation, excluding the current page
 * to prevent direct self-links (a page linking to itself).
 */
export async function getSelfRelationCandidates(
  dataService: IDatabaseDataService,
  property: IDatabaseProperty,
  currentPageId: string,
  currentValue: IPropertyValue | undefined,
): Promise<IRelationCandidate[]> {
  const candidates = await getRelationCandidates(dataService, property, currentValue);
  return candidates.filter(c => c.id !== currentPageId);
}
