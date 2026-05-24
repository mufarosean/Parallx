/**
 * Pin: columnAutoDissolve plugin shape — has the expected PluginKey name and
 * its appendTransaction returns null when no transactions changed the doc.
 */
import { describe, it, expect, vi } from "vitest";

// Hoisted mock for the dissolve helper — we only care that it gets called
// when at least one transaction changes the doc.
vi.mock(
  "../../src/built-in/canvas/config/blockStateRegistry/blockStateRegistry.js",
  () => ({ dissolveOrphanedColumnLists: vi.fn() }),
);

import { columnAutoDissolvePlugin } from "../../src/built-in/canvas/plugins/columnAutoDissolve";

describe("columnAutoDissolve plugin", () => {
  it("constructs a Plugin with key name 'columnAutoDissolve'", () => {
    const p: any = columnAutoDissolvePlugin();
    expect(p).toBeTruthy();
    expect(typeof p.spec.appendTransaction).toBe("function");
    expect(p.spec.key.key).toMatch(/^columnAutoDissolve/);
  });

  it("appendTransaction returns null when no transaction changed the doc", () => {
    const p: any = columnAutoDissolvePlugin();
    const newState = { tr: { docChanged: false } } as any;
    const out = p.spec.appendTransaction(
      [{ docChanged: false }],
      {} as any,
      newState,
    );
    expect(out).toBeNull();
  });

  it("appendTransaction returns null when tr.docChanged stays false after dissolve", () => {
    const p: any = columnAutoDissolvePlugin();
    // At least one input tr changed → dissolve runs; output tr did not change.
    const tr = { docChanged: false };
    const newState = { tr } as any;
    const out = p.spec.appendTransaction(
      [{ docChanged: true }],
      {} as any,
      newState,
    );
    expect(out).toBeNull();
  });
});
