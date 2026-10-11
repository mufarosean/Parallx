// conceptClustererNeighbourhoods.test.ts — the faster DBSCAN clusters exactly as the plain one.
//
// dbscan now keeps each vector's length once and walks its queue with an
// index instead of shift(). Against a plain DBSCAN written here with
// cosineDistance, the partition into clusters and noise is the same on a
// fixed pseudo-random set.

import { describe, it, expect } from 'vitest';
import { dbscan, cosineDistance, type ClusterPoint } from '../../src/services/conceptClusterer';

/** A fixed sequence (a linear congruential generator), so the set is the same on every machine. */
function pseudoRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

function points(count: number, dims: number, seed: number): ClusterPoint[] {
  const next = pseudoRandom(seed);
  const centres = [0, 1, 2].map(() => Array.from({ length: dims }, () => next() * 2 - 1));
  return Array.from({ length: count }, (_, i) => {
    const centre = centres[i % 3];
    // Most points sit near a centre; every seventh is far from all of them.
    const spread = i % 7 === 0 ? 2 : 0.15;
    return { id: `p${i}`, vector: centre.map((c) => c + (next() * 2 - 1) * spread) };
  });
}

/** Plain DBSCAN, as in the textbook, with cosineDistance for every pair. */
function plainDbscan(pts: readonly ClusterPoint[], epsilon: number, minPoints: number): Map<string, number> {
  const neighbours = (p: ClusterPoint) => pts.filter((q) => q.id !== p.id && cosineDistance(p.vector, q.vector) <= epsilon);
  const out = new Map<string, number>();
  let cluster = 0;
  for (const p of pts) {
    if (out.has(p.id)) continue;
    const n = neighbours(p);
    if (n.length + 1 < minPoints) { out.set(p.id, -1); continue; }
    const cid = cluster++;
    out.set(p.id, cid);
    const queue = [...n];
    while (queue.length) {
      const q = queue.shift()!;
      const was = out.get(q.id);
      if (was === -1) { out.set(q.id, cid); continue; }
      if (was !== undefined) continue;
      out.set(q.id, cid);
      const qn = neighbours(q);
      if (qn.length + 1 >= minPoints) for (const r of qn) if (!out.has(r.id)) queue.push(r);
    }
  }
  return out;
}

function sameCluster(assign: ReadonlyMap<string, number>, a: string, b: string): boolean {
  const x = assign.get(a)!;
  const y = assign.get(b)!;
  return x !== -1 && x === y;
}

describe('dbscan', () => {
  it('partitions a fixed set exactly as a plain DBSCAN over cosineDistance', () => {
    for (const seed of [1, 7, 42]) {
      const pts = points(90, 6, seed);
      const fast = dbscan(pts, { epsilon: 0.08, minPoints: 3 }).assignments;
      const plain = plainDbscan(pts, 0.08, 3);
      for (const p of pts) expect(fast.get(p.id) === -1, `${p.id} noise (seed ${seed})`).toBe(plain.get(p.id) === -1);
      for (const a of pts) for (const b of pts) {
        expect(sameCluster(fast, a.id, b.id), `${a.id}~${b.id} (seed ${seed})`).toBe(sameCluster(plain, a.id, b.id));
      }
      expect(new Set(fast.values()).size).toBeGreaterThan(1);
    }
  });

  it('takes the plain path for vectors of unequal length', () => {
    const pts: ClusterPoint[] = [
      { id: 'a', vector: [1, 0, 0, 5] }, { id: 'b', vector: [1, 0, 0] }, { id: 'c', vector: [1, 0.01, 0] },
    ];
    const fast = dbscan(pts, { epsilon: 0.01, minPoints: 2 }).assignments;
    const plain = plainDbscan(pts, 0.01, 2);
    for (const p of pts) expect(fast.get(p.id)).toBe(plain.get(p.id));
  });
});
