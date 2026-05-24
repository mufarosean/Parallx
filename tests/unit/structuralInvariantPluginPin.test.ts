/**
 * Pin: structuralInvariant plugin — dev-only guard, no-ops in production,
 * skips clean docs, only reports when the issue fingerprint changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const validate = vi.fn();
const fingerprint = vi.fn();
const report = vi.fn();
const devModeRef = { value: true };

vi.mock(
  "../../src/built-in/canvas/invariants/canvasStructuralInvariants.js",
  () => ({
    validateCanvasStructuralInvariants: (...a: any[]) => validate(...a),
    issueFingerprint: (...a: any[]) => fingerprint(...a),
    reportCanvasInvariantIssues: (...a: any[]) => report(...a),
  }),
);
vi.mock(
  "../../src/platform/devMode.js",
  () => ({ get isDevMode() { return devModeRef.value; } }),
);

import { structuralInvariantPlugin } from "../../src/built-in/canvas/plugins/structuralInvariantPlugin";

const newState = (size = 100): any => ({ doc: { content: { size } } });

describe("structuralInvariantPlugin", () => {
  beforeEach(() => {
    validate.mockReset();
    fingerprint.mockReset();
    report.mockReset();
    devModeRef.value = true;
  });

  it("appendTransaction returns null in production", () => {
    devModeRef.value = false;
    const p: any = structuralInvariantPlugin();
    const out = p.spec.appendTransaction([{ docChanged: true }], {}, newState());
    expect(out).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });

  it("returns null when no transaction changed the doc", () => {
    const p: any = structuralInvariantPlugin();
    const out = p.spec.appendTransaction([{ docChanged: false }], {}, newState());
    expect(out).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });

  it("clean doc (no issues) → no report, returns null", () => {
    validate.mockReturnValue([]);
    fingerprint.mockReturnValue("");
    const p: any = structuralInvariantPlugin();
    const out = p.spec.appendTransaction([{ docChanged: true }], {}, newState());
    expect(out).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("first issue fires report; identical fingerprint on next pass does NOT re-fire", () => {
    validate.mockReturnValue([{ id: "x" }]);
    fingerprint.mockReturnValue("fp-A");
    const p: any = structuralInvariantPlugin();

    p.spec.appendTransaction([{ docChanged: true }], {}, newState(50));
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toEqual({ source: "transaction", docVersion: 50 });

    // same fingerprint → suppressed
    p.spec.appendTransaction([{ docChanged: true }], {}, newState(75));
    expect(report).toHaveBeenCalledTimes(1);

    // fingerprint changes → re-fires
    fingerprint.mockReturnValue("fp-B");
    p.spec.appendTransaction([{ docChanged: true }], {}, newState(80));
    expect(report).toHaveBeenCalledTimes(2);
  });
});
