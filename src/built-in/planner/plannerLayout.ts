// plannerLayout.ts — side-by-side column packing for overlapping calendar
// items (events + tasks) in the week / day time grids.
//
// Classic interval-graph lane assignment: sort by start, walk a set of open
// columns, and drop each item into the first column whose previous item has
// already ended — else open a new column. Items that mutually overlap form a
// cluster and share a column count, so each renders at width 1 / laneCount.
// Pure data in, pure data out (no DOM) so it is unit-testable.

export interface TimeSpan {
  readonly startMs: number;
  /** Exclusive end. An item ending at T does not conflict with one starting at T. */
  readonly endMs: number;
}

export interface LaneAssignment<T> {
  readonly item: T;
  /** 0-based column within the item's overlap cluster. */
  readonly lane: number;
  /** Number of columns the cluster was split into (always ≥ 1). */
  readonly laneCount: number;
}

/**
 * Assign each item a lane (column) and the column count of its overlap
 * cluster. Input order is irrelevant; output is the items re-ordered by start
 * time. Back-to-back items (one ends exactly where the next begins) do not
 * overlap and may share a column.
 */
export function packLanes<T extends TimeSpan>(items: readonly T[]): LaneAssignment<T>[] {
  // Stable ordering: start asc, then longer items first, then original index.
  const ordered = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      a.item.startMs - b.item.startMs ||
      b.item.endMs - a.item.endMs ||
      a.index - b.index);

  const out: LaneAssignment<T>[] = [];
  let cluster: { item: T; lane: number }[] = [];
  let columnEnds: number[] = []; // last end time per currently-open column
  let clusterMaxEnd = -Infinity;

  const flush = (): void => {
    const laneCount = Math.max(1, columnEnds.length);
    for (const c of cluster) out.push({ item: c.item, lane: c.lane, laneCount });
    cluster = [];
    columnEnds = [];
    clusterMaxEnd = -Infinity;
  };

  for (const { item } of ordered) {
    // A clean gap (this item starts at/after everything emitted so far) ends
    // the current cluster — width sharing only applies within a cluster.
    if (cluster.length > 0 && item.startMs >= clusterMaxEnd) flush();

    let lane = columnEnds.findIndex((end) => end <= item.startMs);
    if (lane === -1) {
      lane = columnEnds.length;
      columnEnds.push(item.endMs);
    } else {
      columnEnds[lane] = item.endMs;
    }
    cluster.push({ item, lane });
    clusterMaxEnd = Math.max(clusterMaxEnd, item.endMs);
  }
  flush();
  return out;
}
