// conceptClusterer.ts — DBSCAN clustering + stable-ID carry-over (M76 Phase 5)
//
// Pure helpers used by ConceptNodeService. Kept dependency-free so they can
// be unit-tested without spinning up the orchestrator / vector store / DB.
//
// Two key pieces:
//
// 1. dbscan() — Density-based spatial clustering. Given a set of points
//    (source centroids) and a (epsilon, minPoints) pair, returns each
//    point's cluster index (-1 for noise / unclustered). We use cosine
//    distance because embedding vectors are well-modelled as directional.
//
// 2. applyCarryOverRule() — Cluster identity stability. Given a fresh
//    clustering result and the previous clustering state, decides which
//    fresh clusters reuse an existing stable_id+label (70% member
//    retention) versus which spawn fresh ids that need LLM-labelling.
//    This is the difference between "your Existentialism cluster gained
//    one book" (no churn) and "your Existentialism cluster fractured
//    and got re-labelled" (acceptable when membership genuinely shifted).
//
// HDBSCAN has no usable pure-JS implementation in npm; DBSCAN is the
// pragmatic substitute. We implement it inline rather than depending on
// `density-clustering` to avoid one more package and to keep cosine-
// distance support first-class.

export interface ClusterPoint {
  /** Stable identifier for the point — e.g. `"page_block:abc"`. */
  readonly id: string;
  /** Embedding vector. All points must share dimensionality. */
  readonly vector: readonly number[];
}

export interface DbscanOptions {
  /**
   * Maximum cosine distance for two points to be neighbors. For unit-
   * normalised embeddings, 0.3 ≈ cosine similarity > 0.7. Lower values
   * make clusters tighter (more, smaller clusters); higher values make
   * them looser. Defaults set by ConceptNodeService.
   */
  readonly epsilon: number;
  /**
   * Minimum number of points (including self) for a region to seed a
   * cluster. Typical: 3 to require at least three related documents.
   */
  readonly minPoints: number;
}

export interface ClusterAssignment {
  /** Maps point.id → cluster index (0, 1, …) or -1 for noise/unclustered. */
  readonly assignments: ReadonlyMap<string, number>;
  /** Number of distinct clusters (cluster indices range 0..clusterCount-1). */
  readonly clusterCount: number;
}

/**
 * Cosine distance: 1 - (a·b) / (|a||b|). Returns 1 (max distance) when
 * either vector is zero. Stable for non-unit vectors. Pure.
 */
export function cosineDistance(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 1;
  const sim = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return 1 - Math.max(-1, Math.min(1, sim));
}

/**
 * Standard DBSCAN. O(n²) but n is workspace-source-count, which is small
 * (~hundreds to low thousands). Runs in well under a second on typical
 * hardware.
 *
 * Algorithm: every point is either a "core" point (>= minPoints neighbors
 * within epsilon), a "border" point (neighbor of a core but not core
 * itself), or "noise" (neither). Core points spawn clusters; clusters
 * expand transitively through other core points.
 *
 * Cluster indices are arbitrary integers — caller maps them to stable
 * ids via stableClusterId().
 */
export function dbscan(
  points: readonly ClusterPoint[],
  opts: DbscanOptions,
): ClusterAssignment {
  const assignments = new Map<string, number>();
  if (points.length === 0) return { assignments, clusterCount: 0 };

  // Pre-compute neighborhood lookups. We do it lazily on first need so
  // workspaces with mostly-noise points don't pay the O(n²) cost.
  const neighborCache = new Map<string, ClusterPoint[]>();
  const findNeighbors = (point: ClusterPoint): ClusterPoint[] => {
    const cached = neighborCache.get(point.id);
    if (cached) return cached;
    const result: ClusterPoint[] = [];
    for (const candidate of points) {
      if (candidate.id === point.id) continue;
      if (cosineDistance(point.vector, candidate.vector) <= opts.epsilon) {
        result.push(candidate);
      }
    }
    neighborCache.set(point.id, result);
    return result;
  };

  let clusterIdx = 0;

  for (const point of points) {
    if (assignments.has(point.id)) continue;

    const neighbors = findNeighbors(point);
    if (neighbors.length + 1 < opts.minPoints) {
      // Mark as noise. A later iteration may upgrade this to a border
      // point if it's reachable from a core point.
      assignments.set(point.id, -1);
      continue;
    }

    // Seed a new cluster.
    const cid = clusterIdx++;
    assignments.set(point.id, cid);

    // BFS expansion through reachable core points.
    const queue: ClusterPoint[] = [...neighbors];
    while (queue.length > 0) {
      const current = queue.shift() as ClusterPoint;
      const currentAssignment = assignments.get(current.id);
      if (currentAssignment === -1) {
        // Border point: upgrade from noise into this cluster.
        assignments.set(current.id, cid);
        continue;
      }
      if (currentAssignment !== undefined) {
        // Already assigned to some cluster — skip.
        continue;
      }
      assignments.set(current.id, cid);
      const currentNeighbors = findNeighbors(current);
      if (currentNeighbors.length + 1 >= opts.minPoints) {
        // Core point — extend the frontier.
        for (const n of currentNeighbors) {
          if (!assignments.has(n.id)) queue.push(n);
        }
      }
    }
  }

  return { assignments, clusterCount: clusterIdx };
}

/**
 * Convert a DBSCAN ClusterAssignment into groups of member ids, keyed by
 * cluster index. Noise points (-1) are excluded.
 */
export function groupByCluster(assignment: ClusterAssignment): string[][] {
  const groups: string[][] = Array.from({ length: assignment.clusterCount }, () => []);
  for (const [id, cidx] of assignment.assignments) {
    if (cidx >= 0 && cidx < groups.length) groups[cidx].push(id);
  }
  return groups;
}

// ── Stable cluster identifier ─────────────────────────────────────────

/**
 * Compute a stable id from a cluster's member set. Two cluster results
 * with the same sorted member list produce the same id; any change
 * produces a different id. The id is short (`concept-<8 hex>`) and
 * deterministic — collisions are theoretically 1-in-4-billion using
 * FNV-1a, well below the practical workspace cluster count.
 */
export function stableClusterId(memberIds: readonly string[]): string {
  const joined = [...memberIds].sort().join('|');
  return `concept-${_fnv1aHex(joined)}`;
}

function _fnv1aHex(s: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    // FNV prime 0x01000193; Math.imul to keep 32-bit semantics
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// ── Carry-over rule ───────────────────────────────────────────────────

export interface ExistingCluster {
  readonly stableId: string;
  readonly members: readonly string[];
  readonly label: string;
  readonly userRenamed: boolean;
  readonly userDeleted: boolean;
}

export interface NewCluster {
  /** Sorted member ids — caller is responsible for sorting before invocation. */
  readonly members: readonly string[];
}

export interface CarriedCluster {
  /** The fresh cluster as produced by clustering. */
  readonly newCluster: NewCluster;
  /** Existing stable id that this cluster inherits. */
  readonly stableId: string;
  /** Existing label this cluster inherits. */
  readonly label: string;
  /** True if the existing label was manually set by the user. */
  readonly userRenamed: boolean;
}

export interface FreshCluster {
  readonly newCluster: NewCluster;
  /** Stable id minted from the member set. */
  readonly stableId: string;
}

export interface CarryOverResult {
  /** Clusters that inherit an existing stable_id + label. */
  readonly carried: readonly CarriedCluster[];
  /** Clusters that need a new stable_id and (LLM-)label. */
  readonly fresh: readonly FreshCluster[];
  /** Existing clusters with no matching new cluster — candidates for deletion. */
  readonly obsolete: readonly ExistingCluster[];
}

/**
 * Match new clusters against existing clusters by member overlap. A new
 * cluster carries over an existing cluster's identity when at least
 * `threshold` (default 0.7) of the existing cluster's members are still
 * present in the new cluster. The best match wins when multiple new
 * clusters could carry over the same existing cluster; ties go to the
 * cluster with the most members in common.
 *
 * Existing clusters marked `userDeleted` are never matched — they remain
 * obsolete so the user-deletion stays sticky across refreshes.
 *
 * Time complexity: O(N×M) where N = new clusters, M = existing clusters.
 * Both are workspace-cluster-count, typically small.
 */
export function applyCarryOverRule(
  newClusters: readonly NewCluster[],
  existingClusters: readonly ExistingCluster[],
  threshold: number = 0.7,
): CarryOverResult {
  const carried: CarriedCluster[] = [];
  const fresh: FreshCluster[] = [];
  const usedExistingIds = new Set<string>();

  // Skip user-deleted clusters entirely from matching, but keep them in
  // the obsolete list so the caller knows they remain absent.
  const matchable = existingClusters.filter((e) => !e.userDeleted);

  for (const nc of newClusters) {
    const ncMemberSet = new Set(nc.members);
    let best: { existing: ExistingCluster; overlap: number; overlapFrac: number } | null = null;

    for (const ec of matchable) {
      if (usedExistingIds.has(ec.stableId)) continue;
      if (ec.members.length === 0) continue;
      let overlap = 0;
      for (const m of ec.members) if (ncMemberSet.has(m)) overlap += 1;
      const overlapFrac = overlap / ec.members.length;
      if (overlapFrac < threshold) continue;
      if (!best || overlap > best.overlap) {
        best = { existing: ec, overlap, overlapFrac };
      }
    }

    if (best) {
      usedExistingIds.add(best.existing.stableId);
      carried.push({
        newCluster: nc,
        stableId: best.existing.stableId,
        label: best.existing.label,
        userRenamed: best.existing.userRenamed,
      });
    } else {
      fresh.push({ newCluster: nc, stableId: stableClusterId(nc.members) });
    }
  }

  const obsolete = existingClusters.filter((e) => !usedExistingIds.has(e.stableId));
  return { carried, fresh, obsolete };
}
