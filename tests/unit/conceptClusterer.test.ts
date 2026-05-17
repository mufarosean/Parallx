import { describe, it, expect } from 'vitest';
import {
  cosineDistance,
  dbscan,
  groupByCluster,
  stableClusterId,
  applyCarryOverRule,
  type ClusterPoint,
} from '../../src/services/conceptClusterer.js';

// ── cosineDistance ───────────────────────────────────────────────────

describe('cosineDistance', () => {
  it('returns 0 for identical vectors', () => {
    expect(cosineDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0, 6);
    expect(cosineDistance([0.5, 0.5], [0.5, 0.5])).toBeCloseTo(0, 6);
  });

  it('returns 1 for orthogonal vectors', () => {
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1, 6);
  });

  it('returns 2 for opposite vectors', () => {
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 6);
  });

  it('returns 1 for zero vectors', () => {
    expect(cosineDistance([0, 0], [1, 1])).toBe(1);
    expect(cosineDistance([1, 1], [0, 0])).toBe(1);
  });

  it('handles different vector lengths gracefully (uses min length)', () => {
    expect(cosineDistance([1, 0, 0, 0], [1, 0])).toBeCloseTo(0, 6);
  });
});

// ── dbscan ────────────────────────────────────────────────────────────

describe('dbscan', () => {
  it('returns no clusters for empty input', () => {
    const result = dbscan([], { epsilon: 0.3, minPoints: 3 });
    expect(result.clusterCount).toBe(0);
    expect(result.assignments.size).toBe(0);
  });

  it('marks every point as noise when no cluster has minPoints', () => {
    // Three points, all far apart
    const points: ClusterPoint[] = [
      { id: 'a', vector: [1, 0, 0] },
      { id: 'b', vector: [0, 1, 0] },
      { id: 'c', vector: [0, 0, 1] },
    ];
    const result = dbscan(points, { epsilon: 0.1, minPoints: 3 });
    expect(result.clusterCount).toBe(0);
    for (const v of result.assignments.values()) expect(v).toBe(-1);
  });

  it('finds one cluster when minPoints similar vectors are present', () => {
    const points: ClusterPoint[] = [
      { id: 'a', vector: [1, 0, 0] },
      { id: 'b', vector: [0.99, 0.05, 0] },
      { id: 'c', vector: [0.98, 0.1, 0] },
    ];
    const result = dbscan(points, { epsilon: 0.05, minPoints: 3 });
    expect(result.clusterCount).toBe(1);
    expect(result.assignments.get('a')).toBe(0);
    expect(result.assignments.get('b')).toBe(0);
    expect(result.assignments.get('c')).toBe(0);
  });

  it('separates two distinct clusters', () => {
    const points: ClusterPoint[] = [
      // Cluster 1 around [1, 0]
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0.99, 0.01] },
      { id: 'c', vector: [0.98, 0.02] },
      // Cluster 2 around [0, 1]
      { id: 'd', vector: [0, 1] },
      { id: 'e', vector: [0.01, 0.99] },
      { id: 'f', vector: [0.02, 0.98] },
    ];
    const result = dbscan(points, { epsilon: 0.05, minPoints: 3 });
    expect(result.clusterCount).toBe(2);
    expect(result.assignments.get('a')).toBe(result.assignments.get('b'));
    expect(result.assignments.get('b')).toBe(result.assignments.get('c'));
    expect(result.assignments.get('d')).toBe(result.assignments.get('e'));
    expect(result.assignments.get('e')).toBe(result.assignments.get('f'));
    expect(result.assignments.get('a')).not.toBe(result.assignments.get('d'));
  });

  it('classifies isolated points as noise even with clusters elsewhere', () => {
    const points: ClusterPoint[] = [
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [0.99, 0.01] },
      { id: 'c', vector: [0.98, 0.02] },
      { id: 'lonely', vector: [-1, 0] },
    ];
    const result = dbscan(points, { epsilon: 0.05, minPoints: 3 });
    expect(result.clusterCount).toBe(1);
    expect(result.assignments.get('lonely')).toBe(-1);
  });
});

// ── groupByCluster ────────────────────────────────────────────────────

describe('groupByCluster', () => {
  it('groups assignments into per-cluster arrays', () => {
    const assignments = new Map([
      ['a', 0],
      ['b', 0],
      ['c', 1],
      ['noise', -1],
    ]);
    const result = groupByCluster({ assignments, clusterCount: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].sort()).toEqual(['a', 'b']);
    expect(result[1]).toEqual(['c']);
  });

  it('returns empty arrays for empty input', () => {
    const result = groupByCluster({ assignments: new Map(), clusterCount: 0 });
    expect(result).toEqual([]);
  });
});

// ── stableClusterId ───────────────────────────────────────────────────

describe('stableClusterId', () => {
  it('produces the same id for the same member set regardless of order', () => {
    const a = stableClusterId(['x', 'y', 'z']);
    const b = stableClusterId(['z', 'y', 'x']);
    expect(a).toBe(b);
  });

  it('produces different ids for different member sets', () => {
    const a = stableClusterId(['x', 'y']);
    const b = stableClusterId(['x', 'y', 'z']);
    expect(a).not.toBe(b);
  });

  it('returns an id with the concept- prefix and 8 hex chars', () => {
    const id = stableClusterId(['a', 'b']);
    expect(id).toMatch(/^concept-[0-9a-f]{8}$/);
  });
});

// ── applyCarryOverRule ───────────────────────────────────────────────

describe('applyCarryOverRule', () => {
  it('carries an existing cluster forward when >= 70% members are retained', () => {
    const existing = [
      {
        stableId: 'concept-aaaa',
        label: 'Existentialism',
        members: ['p1', 'p2', 'p3', 'p4', 'p5'],
        userRenamed: false,
        userDeleted: false,
      },
    ];
    // New cluster has 4 of 5 original members (80%) plus one new
    const fresh = [{ members: ['p1', 'p2', 'p3', 'p4', 'p6'] }];
    const result = applyCarryOverRule(fresh, existing);
    expect(result.carried).toHaveLength(1);
    expect(result.carried[0].stableId).toBe('concept-aaaa');
    expect(result.carried[0].label).toBe('Existentialism');
    expect(result.fresh).toHaveLength(0);
    expect(result.obsolete).toHaveLength(0);
  });

  it('mints a fresh cluster when overlap is below threshold', () => {
    const existing = [
      {
        stableId: 'concept-aaaa',
        label: 'Existentialism',
        members: ['p1', 'p2', 'p3', 'p4', 'p5'],
        userRenamed: false,
        userDeleted: false,
      },
    ];
    // 2 of 5 members retained = 40%, below threshold
    const fresh = [{ members: ['p1', 'p2', 'q1', 'q2', 'q3'] }];
    const result = applyCarryOverRule(fresh, existing);
    expect(result.carried).toHaveLength(0);
    expect(result.fresh).toHaveLength(1);
    expect(result.fresh[0].stableId).toMatch(/^concept-/);
    expect(result.obsolete).toHaveLength(1);
    expect(result.obsolete[0].stableId).toBe('concept-aaaa');
  });

  it('respects user-renamed flag when carrying over', () => {
    const existing = [
      {
        stableId: 'concept-aaaa',
        label: 'My Custom Label',
        members: ['p1', 'p2', 'p3'],
        userRenamed: true,
        userDeleted: false,
      },
    ];
    const fresh = [{ members: ['p1', 'p2', 'p3', 'p4'] }];
    const result = applyCarryOverRule(fresh, existing);
    expect(result.carried[0].label).toBe('My Custom Label');
    expect(result.carried[0].userRenamed).toBe(true);
  });

  it('does not match user-deleted clusters even when membership overlaps', () => {
    const existing = [
      {
        stableId: 'concept-aaaa',
        label: 'Deleted Topic',
        members: ['p1', 'p2', 'p3'],
        userRenamed: false,
        userDeleted: true,
      },
    ];
    const fresh = [{ members: ['p1', 'p2', 'p3', 'p4'] }];
    const result = applyCarryOverRule(fresh, existing);
    // The deletion is sticky — a fresh cluster is minted instead.
    expect(result.carried).toHaveLength(0);
    expect(result.fresh).toHaveLength(1);
    // The user-deleted cluster remains in obsolete (its deletion sticks).
    expect(result.obsolete.find((o) => o.stableId === 'concept-aaaa')).toBeDefined();
  });

  it('handles obsolete clusters when membership shifts away entirely', () => {
    const existing = [
      {
        stableId: 'concept-keep',
        label: 'Kept',
        members: ['p1', 'p2', 'p3'],
        userRenamed: false,
        userDeleted: false,
      },
      {
        stableId: 'concept-drop',
        label: 'Dropped',
        members: ['q1', 'q2', 'q3'],
        userRenamed: false,
        userDeleted: false,
      },
    ];
    const fresh = [{ members: ['p1', 'p2', 'p3'] }];
    const result = applyCarryOverRule(fresh, existing);
    expect(result.carried).toHaveLength(1);
    expect(result.carried[0].stableId).toBe('concept-keep');
    expect(result.obsolete.map((o) => o.stableId)).toContain('concept-drop');
  });

  it('breaks ties by picking the existing cluster with the most members in common', () => {
    const existing = [
      {
        stableId: 'concept-big',
        label: 'Big',
        members: ['p1', 'p2', 'p3', 'p4', 'p5'],
        userRenamed: false,
        userDeleted: false,
      },
      {
        stableId: 'concept-small',
        label: 'Small',
        members: ['p1', 'p2', 'p3'],
        userRenamed: false,
        userDeleted: false,
      },
    ];
    // Fresh cluster has all of small's members + 4 of big's.
    const fresh = [{ members: ['p1', 'p2', 'p3', 'p4'] }];
    const result = applyCarryOverRule(fresh, existing);
    // Both qualify for carry-over (small at 100%, big at 80%), but small has
    // higher overlap fraction. The 'most members in common' (overlap count)
    // tiebreak picks small=3 vs big=4 — big wins, since absolute overlap is
    // larger. Verify the implementation picks the absolute overlap winner.
    expect(result.carried[0].stableId).toBe('concept-big');
    // The small cluster ends up obsolete because big claimed the match.
    expect(result.obsolete.map((o) => o.stableId)).toContain('concept-small');
  });

  it('returns no carry-over when both lists are empty', () => {
    const result = applyCarryOverRule([], []);
    expect(result.carried).toHaveLength(0);
    expect(result.fresh).toHaveLength(0);
    expect(result.obsolete).toHaveLength(0);
  });
});
