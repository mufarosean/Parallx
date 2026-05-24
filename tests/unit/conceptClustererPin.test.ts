/**
 * Pin: conceptClusterer — pure helpers (cosineDistance, dbscan,
 * groupByCluster, stableClusterId, applyCarryOverRule).
 */
import { describe, it, expect } from "vitest";
import {
  cosineDistance,
  dbscan,
  groupByCluster,
  stableClusterId,
  applyCarryOverRule,
} from "../../src/services/conceptClusterer";

describe("services/conceptClusterer/cosineDistance", () => {
  it("identical vectors → 0", () => {
    expect(cosineDistance([1, 0], [1, 0])).toBeCloseTo(0, 10);
  });

  it("orthogonal vectors → 1", () => {
    expect(cosineDistance([1, 0], [0, 1])).toBeCloseTo(1, 10);
  });

  it("opposite vectors → 2", () => {
    expect(cosineDistance([1, 0], [-1, 0])).toBeCloseTo(2, 10);
  });

  it("zero vector on either side → 1 (max distance, no NaN)", () => {
    expect(cosineDistance([0, 0], [1, 1])).toBe(1);
    expect(cosineDistance([1, 1], [0, 0])).toBe(1);
  });

  it("clamps numerical similarity into [-1, 1] (no overflow → NaN)", () => {
    const v = [1, 0];
    expect(Number.isFinite(cosineDistance(v, v))).toBe(true);
  });
});

describe("services/conceptClusterer/dbscan", () => {
  it("empty input returns empty assignments and clusterCount=0", () => {
    const r = dbscan([], { epsilon: 0.3, minPoints: 3 });
    expect(r.clusterCount).toBe(0);
    expect(r.assignments.size).toBe(0);
  });

  it("two tight clusters: 3 nearly-identical + 3 nearly-identical = clusterCount=2", () => {
    const points = [
      { id: "a1", vector: [1, 0, 0] },
      { id: "a2", vector: [0.99, 0.01, 0] },
      { id: "a3", vector: [0.98, 0.02, 0] },
      { id: "b1", vector: [0, 1, 0] },
      { id: "b2", vector: [0.01, 0.99, 0] },
      { id: "b3", vector: [0.02, 0.98, 0] },
    ];
    const r = dbscan(points, { epsilon: 0.05, minPoints: 3 });
    expect(r.clusterCount).toBe(2);
    expect(r.assignments.get("a1")).toBe(r.assignments.get("a2"));
    expect(r.assignments.get("a1")).toBe(r.assignments.get("a3"));
    expect(r.assignments.get("b1")).toBe(r.assignments.get("b2"));
    expect(r.assignments.get("a1")).not.toBe(r.assignments.get("b1"));
  });

  it("isolated points become noise (-1)", () => {
    const points = [
      { id: "a1", vector: [1, 0] },
      { id: "a2", vector: [0.99, 0.01] },
      { id: "a3", vector: [0.98, 0.02] },
      { id: "lone", vector: [0, 1] },
    ];
    const r = dbscan(points, { epsilon: 0.05, minPoints: 3 });
    expect(r.assignments.get("lone")).toBe(-1);
  });

  it("when no point hits minPoints neighbors, everything is noise (clusterCount=0)", () => {
    const points = [
      { id: "p1", vector: [1, 0] },
      { id: "p2", vector: [0, 1] },
    ];
    const r = dbscan(points, { epsilon: 0.05, minPoints: 3 });
    expect(r.clusterCount).toBe(0);
    expect(r.assignments.get("p1")).toBe(-1);
    expect(r.assignments.get("p2")).toBe(-1);
  });
});

describe("services/conceptClusterer/groupByCluster", () => {
  it("collects member ids per cluster and excludes noise", () => {
    const groups = groupByCluster({
      assignments: new Map<string, number>([
        ["a", 0], ["b", 0], ["c", 1], ["d", -1],
      ]),
      clusterCount: 2,
    });
    expect(groups).toHaveLength(2);
    expect(groups[0].sort()).toEqual(["a", "b"]);
    expect(groups[1]).toEqual(["c"]);
  });
});

describe("services/conceptClusterer/stableClusterId", () => {
  it("returns concept-<8 hex> prefix and is order-independent", () => {
    const id1 = stableClusterId(["x", "y", "z"]);
    const id2 = stableClusterId(["z", "y", "x"]);
    expect(id1).toBe(id2);
    expect(id1).toMatch(/^concept-[0-9a-f]{8}$/);
  });

  it("different member sets produce different ids", () => {
    expect(stableClusterId(["a", "b"])).not.toBe(stableClusterId(["a", "c"]));
  });
});

describe("services/conceptClusterer/applyCarryOverRule", () => {
  it("inherits stable_id+label when ≥70% of existing members survive", () => {
    const existing = [{ stableId: "concept-old", members: ["a", "b", "c", "d"], label: "Old", userRenamed: false, userDeleted: false }];
    const fresh = [{ members: ["a", "b", "c", "e"] }]; // 3/4 = 0.75
    const r = applyCarryOverRule(fresh, existing);
    expect(r.carried).toHaveLength(1);
    expect(r.carried[0].stableId).toBe("concept-old");
    expect(r.carried[0].label).toBe("Old");
    expect(r.fresh).toHaveLength(0);
    expect(r.obsolete).toHaveLength(0);
  });

  it("spawns a fresh cluster when overlap < threshold", () => {
    const existing = [{ stableId: "concept-old", members: ["a", "b", "c", "d"], label: "Old", userRenamed: false, userDeleted: false }];
    const fresh = [{ members: ["a", "x", "y", "z"] }]; // 1/4 = 0.25
    const r = applyCarryOverRule(fresh, existing);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].stableId).toMatch(/^concept-[0-9a-f]{8}$/);
    expect(r.carried).toHaveLength(0);
    expect(r.obsolete).toHaveLength(1);
    expect(r.obsolete[0].stableId).toBe("concept-old");
  });

  it("userDeleted clusters are never matched (remain obsolete even on full overlap)", () => {
    const existing = [{ stableId: "concept-del", members: ["a", "b"], label: "X", userRenamed: false, userDeleted: true }];
    const fresh = [{ members: ["a", "b"] }];
    const r = applyCarryOverRule(fresh, existing);
    expect(r.carried).toHaveLength(0);
    expect(r.fresh).toHaveLength(1);
    expect(r.obsolete).toHaveLength(1);
    expect(r.obsolete[0].stableId).toBe("concept-del");
  });

  it("one existing cluster can be carried by at most one new cluster (best overlap wins)", () => {
    const existing = [{ stableId: "concept-old", members: ["a", "b", "c", "d"], label: "Old", userRenamed: false, userDeleted: false }];
    const fresh = [
      { members: ["a", "b", "c", "d"] }, // overlap 4
      { members: ["a", "b", "c", "e"] }, // overlap 3
    ];
    const r = applyCarryOverRule(fresh, existing);
    expect(r.carried).toHaveLength(1);
    expect(r.carried[0].newCluster.members).toEqual(["a", "b", "c", "d"]);
    expect(r.fresh).toHaveLength(1);
    expect(r.fresh[0].newCluster.members).toEqual(["a", "b", "c", "e"]);
  });

  it("userRenamed flag is propagated through carry-over", () => {
    const existing = [{ stableId: "concept-old", members: ["a", "b"], label: "Renamed", userRenamed: true, userDeleted: false }];
    const fresh = [{ members: ["a", "b", "c"] }];
    const r = applyCarryOverRule(fresh, existing);
    expect(r.carried[0].userRenamed).toBe(true);
    expect(r.carried[0].label).toBe("Renamed");
  });
});
