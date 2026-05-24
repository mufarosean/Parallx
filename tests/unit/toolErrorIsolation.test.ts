import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolErrorService } from "../../src/tools/toolErrorIsolation";

let errSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  errSpy.mockRestore();
  warnSpy.mockRestore();
});

describe("ToolErrorService.recordError", () => {
  it("captures Error message + stack, fills toolId/context/timestamp, and fires onDidRecordError", () => {
    const svc = new ToolErrorService();
    const events: any[] = [];
    svc.onDidRecordError((e) => events.push(e));
    const e = new Error("boom");
    const rec = svc.recordError("t", e, "activation");
    expect(rec.toolId).toBe("t");
    expect(rec.message).toBe("boom");
    expect(rec.stack).toBeTypeOf("string");
    expect(rec.context).toBe("activation");
    expect(rec.timestamp).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0]).toBe(rec);
  });

  it("coerces non-Error values to string with no stack", () => {
    const svc = new ToolErrorService();
    const rec = svc.recordError("t", "literal string", "ctx");
    expect(rec.message).toBe("literal string");
    expect(rec.stack).toBeUndefined();
  });
});

describe("ToolErrorService.wrap", () => {
  it("returns the value when the wrapped function returns synchronously", () => {
    const svc = new ToolErrorService();
    const wrapped = svc.wrap("t", "ctx", (n: number) => n * 2);
    expect(wrapped(5)).toBe(10);
    expect(svc.getErrorCount("t")).toBe(0);
  });

  it("records the error and returns undefined when the wrapped function throws", () => {
    const svc = new ToolErrorService();
    const wrapped = svc.wrap("t", "ctx", () => { throw new Error("nope"); });
    expect(wrapped()).toBeUndefined();
    expect(svc.getErrorCount("t")).toBe(1);
    expect(svc.getToolErrors("t")[0].message).toBe("nope");
  });

  it("forwards promise rejection to recordError and resolves to undefined", async () => {
    const svc = new ToolErrorService();
    const wrapped = svc.wrap("t", "ctx", async () => { throw new Error("async-boom"); });
    const result = await wrapped();
    expect(result).toBeUndefined();
    expect(svc.getErrorCount("t")).toBe(1);
    expect(svc.getToolErrors("t")[0].message).toBe("async-boom");
  });
});

describe("ToolErrorService.wrapAsync", () => {
  it("returns awaited value on success", async () => {
    const svc = new ToolErrorService();
    const wrapped = svc.wrapAsync("t", "ctx", async (n: number) => n + 1);
    expect(await wrapped(3)).toBe(4);
  });

  it("records and returns undefined on rejection", async () => {
    const svc = new ToolErrorService();
    const wrapped = svc.wrapAsync("t", "ctx", async () => { throw new Error("x"); });
    expect(await wrapped()).toBeUndefined();
    expect(svc.getErrorCount("t")).toBe(1);
  });
});

describe("ToolErrorService — queries", () => {
  it("getToolErrors returns empty array for unknown tool", () => {
    const svc = new ToolErrorService();
    expect(svc.getToolErrors("nope")).toEqual([]);
    expect(svc.getErrorCount("nope")).toBe(0);
  });

  it("getAllErrors returns the live map of every tool", () => {
    const svc = new ToolErrorService();
    svc.recordError("a", new Error("1"), "c");
    svc.recordError("b", new Error("2"), "c");
    const all = svc.getAllErrors();
    expect([...all.keys()].sort()).toEqual(["a", "b"]);
  });

  it("clearErrors removes recorded errors and rapid-error timestamps for that tool", () => {
    const svc = new ToolErrorService();
    svc.recordError("a", new Error("1"), "c");
    svc.clearErrors("a");
    expect(svc.getErrorCount("a")).toBe(0);
  });
});

describe("ToolErrorService — thresholds", () => {
  it("warns once when crossing the warning threshold (10 errors)", () => {
    const svc = new ToolErrorService();
    for (let i = 0; i < 10; i++) {
      svc.recordError("t", new Error("e"), "ctx");
    }
    const warningCalls = warnSpy.mock.calls.filter((c) =>
      String(c[0] ?? "").includes("recorded 10 errors"),
    );
    expect(warningCalls.length).toBe(1);
  });

  it("fires onWillForceDeactivate once the force threshold (50) is reached", () => {
    const svc = new ToolErrorService();
    const triggers: string[] = [];
    svc.onWillForceDeactivate((id) => triggers.push(id));
    for (let i = 0; i < 50; i++) {
      svc.recordError("t", new Error("e"), "ctx");
    }
    expect(triggers).toContain("t");
  });

  it("warns when rapid errors hit the 5-in-window threshold", () => {
    const svc = new ToolErrorService();
    for (let i = 0; i < 5; i++) {
      svc.recordError("t", new Error("e"), "ctx");
    }
    const rapidWarn = warnSpy.mock.calls.find((c) =>
      String(c[0] ?? "").includes("Rapid errors detected"),
    );
    expect(rapidWarn).toBeTruthy();
  });
});
