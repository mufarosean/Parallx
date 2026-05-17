// conceptNodeService.ts — concept-clustering refresh pass (M76 Phase 5)
//
// Runs DBSCAN over stored source centroids, applies the 70% carry-over
// rule to preserve stable cluster identity, LLM-labels new/changed
// clusters via the active chat model, and emits `member-of` edges from
// each source to its concept node.
//
// Like LineageClassifierService (Phase 4), this service registers itself
// as a RefreshPass with the MindMapRefreshOrchestrator. It never runs
// autonomously — only when the user clicks Refresh.
//
// Clustering is fundamentally workspace-global (one source change can
// shift assignments for many others), so the pass uses the orchestrator's
// changedSources signal only to decide whether to RUN at all. If the
// list is non-empty, we re-cluster everything; the carry-over rule keeps
// labels stable when membership barely shifted.

import { Disposable, type IDisposable } from '../platform/lifecycle.js';
import type {
  IDatabaseService,
  IVectorStoreService,
  IMindMapRefreshOrchestrator,
  IWorkspaceService,
} from './serviceTypes.js';
import type { ILanguageModelsService, IChatMessage } from './chatTypes.js';
import type {
  RefreshContext,
  RefreshPass,
} from './mindMapRefreshOrchestrator.js';
import type { SemanticGraphSourceType } from './semanticGraphService.js';
import { semanticSourceToNodeId } from './semanticGraphService.js';
import {
  dbscan,
  groupByCluster,
  applyCarryOverRule,
  type ClusterPoint,
  type ExistingCluster,
  type NewCluster,
} from './conceptClusterer.js';

const PASS_ID = 'concept-clustering';
const PASS_DISPLAY_NAME = 'Concept clustering';

/** DBSCAN epsilon — cosine distance threshold for "near" embeddings. */
const DBSCAN_EPSILON = 0.3;
/** Minimum cluster size. Clusters smaller than this are noise / unclustered. */
const DBSCAN_MIN_POINTS = 3;
/** Carry-over threshold — fraction of original members that must survive. */
const CARRY_OVER_THRESHOLD = 0.7;
/** Token budget for the labelling call. Labels are 1-3 words; 30 is plenty. */
const LABEL_MAX_TOKENS = 30;
/** Estimated wall-clock cost in seconds per source for the orchestrator's preview. */
const ESTIMATED_SECONDS_PER_SOURCE = 1;

interface SourceMember {
  readonly sourceType: SemanticGraphSourceType;
  readonly sourceId: string;
  readonly key: string; // "<type>:<id>" — the same key DBSCAN uses
}

function _keyOf(sourceType: SemanticGraphSourceType, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

function _parseKey(key: string): SourceMember | null {
  const sep = key.indexOf(':');
  if (sep < 0) return null;
  const type = key.slice(0, sep) as SemanticGraphSourceType;
  const id = key.slice(sep + 1);
  if (type !== 'page_block' && type !== 'file_chunk') return null;
  return { sourceType: type, sourceId: id, key };
}

export class ConceptNodeService extends Disposable {
  private _schemaReady = false;
  private readonly _passRegistration: IDisposable;

  constructor(
    private readonly _db: IDatabaseService,
    private readonly _vectorStore: IVectorStoreService,
    private readonly _languageModels: ILanguageModelsService,
    private readonly _workspaceService: IWorkspaceService,
    orchestrator: IMindMapRefreshOrchestrator,
  ) {
    super();
    const pass: RefreshPass = {
      id: PASS_ID,
      displayName: PASS_DISPLAY_NAME,
      estimateSecondsPerSource: () => ESTIMATED_SECONDS_PER_SOURCE,
      run: (ctx) => this._runPass(ctx),
    };
    this._passRegistration = orchestrator.registerPass(pass);
    this._register(this._passRegistration);
  }

  // ── Pass implementation ──────────────────────────────────────────────

  private async _runPass(ctx: RefreshContext): Promise<void> {
    if (!this._db.isOpen) return;
    if (ctx.changedSources.length === 0) return;
    await this._ensureSchema();

    ctx.reportProgress(0, 4, `${PASS_DISPLAY_NAME}: gathering source centroids`);
    const points = await this._loadCentroids();
    if (ctx.signal.aborted) return;
    if (points.length === 0) {
      // Workspace is empty after the changed-sources filter — nothing to do.
      for (const cs of ctx.changedSources) {
        await ctx.markProcessed(cs.sourceType, cs.sourceId, cs.currentHash);
      }
      return;
    }

    ctx.reportProgress(1, 4, `${PASS_DISPLAY_NAME}: clustering ${points.length} sources`);
    const assignment = dbscan(points, { epsilon: DBSCAN_EPSILON, minPoints: DBSCAN_MIN_POINTS });
    if (ctx.signal.aborted) return;

    const groups = groupByCluster(assignment);
    const newClusters: NewCluster[] = groups
      .filter((g) => g.length >= DBSCAN_MIN_POINTS)
      .map((g) => ({ members: [...g].sort() }));

    ctx.reportProgress(2, 4, `${PASS_DISPLAY_NAME}: matching ${newClusters.length} clusters against existing`);
    const existing = await this._loadExistingClusters();
    if (ctx.signal.aborted) return;

    const carryOver = applyCarryOverRule(newClusters, existing, CARRY_OVER_THRESHOLD);

    ctx.reportProgress(
      3,
      4,
      `${PASS_DISPLAY_NAME}: labelling ${carryOver.fresh.length} new cluster${carryOver.fresh.length === 1 ? '' : 's'}`,
    );

    // Label fresh clusters first (the slow part — LLM calls). Bail on
    // cancellation between calls.
    const freshLabels = new Map<string, string>();
    for (const f of carryOver.fresh) {
      if (ctx.signal.aborted) return;
      const label = await this._labelCluster(f.newCluster.members, ctx.signal);
      freshLabels.set(f.stableId, label);
    }

    if (ctx.signal.aborted) return;

    // Persist everything in one transaction. The DELETE+INSERT pattern
    // keeps concept_node_members + member-of edges in sync with the new
    // cluster state; carried-over clusters that aren't user-deleted are
    // refreshed; obsolete clusters that AREN'T user-deleted are removed.
    await this._persistClusters(carryOver, freshLabels);
    if (ctx.signal.aborted) return;

    ctx.reportProgress(4, 4, `${PASS_DISPLAY_NAME}: complete`);

    for (const cs of ctx.changedSources) {
      await ctx.markProcessed(cs.sourceType, cs.sourceId, cs.currentHash);
    }
  }

  // ── Centroid + existing-cluster loaders ──────────────────────────────

  private async _loadCentroids(): Promise<ClusterPoint[]> {
    const indexed = await this._vectorStore.getIndexedSources();
    const points: ClusterPoint[] = [];
    for (const src of indexed) {
      if (src.sourceType !== 'page_block' && src.sourceType !== 'file_chunk') continue;
      const centroid = await this._vectorStore.getSourceCentroid(src.sourceType, src.sourceId);
      if (!centroid || !centroid.vector || centroid.vector.length === 0) continue;
      points.push({ id: _keyOf(src.sourceType as SemanticGraphSourceType, src.sourceId), vector: centroid.vector });
    }
    return points;
  }

  private async _loadExistingClusters(): Promise<ExistingCluster[]> {
    const nodes = await this._db.all<{
      stable_id: string;
      label: string;
      user_renamed: number;
      user_deleted: number;
    }>(
      `SELECT stable_id, label, user_renamed, user_deleted FROM concept_nodes`,
    );
    if (nodes.length === 0) return [];

    const result: ExistingCluster[] = [];
    for (const n of nodes) {
      const members = await this._db.all<{ source_type: string; source_id: string }>(
        `SELECT source_type, source_id FROM concept_node_members WHERE concept_id = ?`,
        [n.stable_id],
      );
      result.push({
        stableId: n.stable_id,
        label: n.label,
        userRenamed: n.user_renamed === 1,
        userDeleted: n.user_deleted === 1,
        members: members.map((m) => _keyOf(m.source_type as SemanticGraphSourceType, m.source_id)),
      });
    }
    return result;
  }

  // ── LLM labelling ────────────────────────────────────────────────────

  private async _labelCluster(
    memberKeys: readonly string[],
    signal: AbortSignal,
  ): Promise<string> {
    const modelId = this._languageModels.getActiveModel();
    if (!modelId) return 'Unlabelled cluster';

    const terms = await this._distinctiveTermsForCluster(memberKeys);
    if (terms.length === 0) return 'Unlabelled cluster';

    const messages: IChatMessage[] = [
      {
        role: 'system',
        content:
          'You name groups of related documents. Reply with a SHORT topic name only — 1 to 3 words. No quotes, no explanation.',
      },
      {
        role: 'user',
        content:
          `These documents all share these distinctive terms: ${terms.join(', ')}.\n\nWhat is the single topic that best describes this group? Reply with 1-3 words only.`,
      },
    ];

    let assembled = '';
    try {
      const stream = this._languageModels.sendChatRequestForModel(
        modelId,
        messages,
        { temperature: 0.2, maxTokens: LABEL_MAX_TOKENS },
        signal,
      );
      for await (const chunk of stream) {
        assembled += chunk.content;
        if (signal.aborted) return 'Unlabelled cluster';
      }
    } catch {
      return 'Unlabelled cluster';
    }

    return cleanLabel(assembled);
  }

  /**
   * Get distinctive terms shared across a cluster's members, ranked by
   * how many members carry the term. The Phase 2 co-occurrence producer
   * populates source_distinctive_terms — we reuse that index here so
   * labelling doesn't need its own term extraction.
   */
  private async _distinctiveTermsForCluster(memberKeys: readonly string[]): Promise<string[]> {
    if (memberKeys.length === 0) return [];
    const conditions = memberKeys.map(() => '(source_type = ? AND source_id = ?)').join(' OR ');
    const params: unknown[] = [];
    for (const key of memberKeys) {
      const parsed = _parseKey(key);
      if (!parsed) continue;
      params.push(parsed.sourceType, parsed.sourceId);
    }
    if (params.length === 0) return [];
    const rows = await this._db.all<{ term: string; count: number }>(
      `SELECT term, COUNT(*) as count
         FROM source_distinctive_terms
        WHERE ${conditions}
        GROUP BY term
        ORDER BY count DESC, term ASC
        LIMIT 12`,
      params,
    );
    return rows.map((r) => r.term);
  }

  // ── Persistence ──────────────────────────────────────────────────────

  private async _persistClusters(
    carryOver: ReturnType<typeof applyCarryOverRule>,
    freshLabels: ReadonlyMap<string, string>,
  ): Promise<void> {
    // 1. Delete obsolete clusters that aren't user-deleted. User-deleted
    //    rows are preserved so their stable_id remains a tombstone in the
    //    workspace's history (the carry-over rule continues to skip them).
    const obsoleteToDelete = carryOver.obsolete.filter((o) => !o.userDeleted);

    // 2. Wipe the member-of edges and member rows for every cluster we're
    //    about to rewrite — carried + fresh + obsolete-to-delete. This is
    //    the entire "concept-clustering" output for this run.
    const allConceptIds: string[] = [
      ...carryOver.carried.map((c) => c.stableId),
      ...carryOver.fresh.map((f) => f.stableId),
      ...obsoleteToDelete.map((o) => o.stableId),
    ];

    const ops: { type: 'run'; sql: string; params?: unknown[] }[] = [];

    // Wipe the member-of edges for every concept we're touching. The
    // 'origin' marker for these edges is the concept node itself
    // ('concept-node'/<stable_id>) so we filter by that to avoid
    // touching unrelated edges.
    for (const cid of allConceptIds) {
      ops.push({
        type: 'run',
        sql: `DELETE FROM semantic_graph_edges
                WHERE kind = 'member-of'
                  AND origin_type = 'concept-node'
                  AND origin_id = ?`,
        params: [cid],
      });
      ops.push({
        type: 'run',
        sql: `DELETE FROM concept_node_members WHERE concept_id = ?`,
        params: [cid],
      });
    }

    // Drop obsolete (non-user-deleted) cluster rows entirely.
    for (const o of obsoleteToDelete) {
      ops.push({
        type: 'run',
        sql: `DELETE FROM concept_nodes WHERE stable_id = ?`,
        params: [o.stableId],
      });
    }

    // Insert/update carried-over clusters (keep their label + flags).
    for (const c of carryOver.carried) {
      const memberKeys = [...c.newCluster.members].sort();
      const memberHash = _shortHash(memberKeys.join('|'));
      ops.push({
        type: 'run',
        sql: `INSERT INTO concept_nodes
                (stable_id, label, member_count, member_hash, user_renamed, user_deleted, last_clustered_at)
              VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
              ON CONFLICT(stable_id) DO UPDATE SET
                member_count = excluded.member_count,
                member_hash  = excluded.member_hash,
                last_clustered_at = datetime('now')`,
        params: [c.stableId, c.label, memberKeys.length, memberHash, c.userRenamed ? 1 : 0],
      });
      for (const key of memberKeys) {
        const parsed = _parseKey(key);
        if (!parsed) continue;
        ops.push({
          type: 'run',
          sql: `INSERT INTO concept_node_members (concept_id, source_type, source_id) VALUES (?, ?, ?)`,
          params: [c.stableId, parsed.sourceType, parsed.sourceId],
        });
      }
    }

    // Insert fresh clusters with the LLM-derived label.
    for (const f of carryOver.fresh) {
      const memberKeys = [...f.newCluster.members].sort();
      const memberHash = _shortHash(memberKeys.join('|'));
      const label = freshLabels.get(f.stableId) ?? 'Unlabelled cluster';
      ops.push({
        type: 'run',
        sql: `INSERT OR REPLACE INTO concept_nodes
                (stable_id, label, member_count, member_hash, user_renamed, user_deleted, last_clustered_at)
              VALUES (?, ?, ?, ?, 0, 0, datetime('now'))`,
        params: [f.stableId, label, memberKeys.length, memberHash],
      });
      for (const key of memberKeys) {
        const parsed = _parseKey(key);
        if (!parsed) continue;
        ops.push({
          type: 'run',
          sql: `INSERT INTO concept_node_members (concept_id, source_type, source_id) VALUES (?, ?, ?)`,
          params: [f.stableId, parsed.sourceType, parsed.sourceId],
        });
      }
    }

    // Emit member-of edges (directed source → concept). One edge per
    // member per concept. origin = ('concept-node', stable_id) so we
    // can wipe the right rows in the next refresh.
    const allClusters = [...carryOver.carried, ...carryOver.fresh];
    for (const c of allClusters) {
      const stableId =
        'stableId' in c
          ? c.stableId
          : (c as { stableId: string }).stableId;
      const conceptNodeId = `concept:${stableId}`;
      for (const key of c.newCluster.members) {
        const parsed = _parseKey(key);
        if (!parsed) continue;
        const sourceNodeId = semanticSourceToNodeId(
          parsed.sourceType,
          parsed.sourceId,
          this._workspaceRootUri(),
        );
        if (!sourceNodeId) continue;
        ops.push({
          type: 'run',
          sql: `INSERT OR REPLACE INTO semantic_graph_edges (
                  source_node_id, target_node_id, source_type, source_id,
                  target_type, target_id, origin_type, origin_id, score, kind,
                  direction, source_content_hash, target_content_hash, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'member-of', 'forward', NULL, NULL, datetime('now'))`,
          params: [
            sourceNodeId,
            conceptNodeId,
            parsed.sourceType,
            parsed.sourceId,
            'concept-node',
            stableId,
            'concept-node',
            stableId,
            1.0,
          ],
        });
      }
    }

    await this._db.runTransaction(ops);
  }

  // ── Schema ───────────────────────────────────────────────────────────

  private async _ensureSchema(): Promise<void> {
    // The concept_nodes + concept_node_members tables are created by
    // SemanticGraphService._ensureSchema (since Phase 1). We don't
    // re-create them here, but we DO have to wait until the schema is
    // present in case our pass runs before SemanticGraphService has
    // had a chance. In practice the orchestrator's startRefresh always
    // runs after schema setup, so this is a safety net.
    if (this._schemaReady) return;
    // Touching a known-existing table forces an open-handshake in
    // services that defer-create — cheap and idempotent.
    await this._db.run(
      `CREATE TABLE IF NOT EXISTS concept_nodes (
         stable_id TEXT PRIMARY KEY,
         label TEXT NOT NULL,
         member_count INTEGER NOT NULL,
         member_hash TEXT NOT NULL,
         user_renamed INTEGER NOT NULL DEFAULT 0,
         user_deleted INTEGER NOT NULL DEFAULT 0,
         last_clustered_at TEXT NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    await this._db.run(
      `CREATE TABLE IF NOT EXISTS concept_node_members (
         concept_id TEXT NOT NULL,
         source_type TEXT NOT NULL,
         source_id TEXT NOT NULL,
         PRIMARY KEY (concept_id, source_type, source_id),
         FOREIGN KEY (concept_id) REFERENCES concept_nodes(stable_id) ON DELETE CASCADE
       )`,
    );
    this._schemaReady = true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private _workspaceRootUri(): string | undefined {
    const root = this._workspaceService.folders[0]?.uri;
    return root ? root.toString() : undefined;
  }
}

/**
 * Clean a raw chat-model label response: trim whitespace and trailing
 * punctuation, strip wrapping quotes, drop trailing periods, fall back
 * to 'Unlabelled cluster' on empty/garbage input. Small local models
 * sometimes wrap labels in quotes or add a trailing period; we tolerate
 * both. Exported for unit testing.
 */
export function cleanLabel(raw: string): string {
  if (typeof raw !== 'string') return 'Unlabelled cluster';
  // Take the first non-empty line only — some models add a brief
  // explanation on a subsequent line even when told not to.
  const firstLine = raw.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  let label = firstLine
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.!,;:]+$/g, '')
    .trim();
  if (label.length === 0) return 'Unlabelled cluster';
  if (label.length > 50) label = label.slice(0, 50).trim();
  return label;
}

function _shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
