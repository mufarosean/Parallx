/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ConfigurationRegistry } from "../../src/configuration/configurationRegistry";

let warnSpy: any;
beforeEach(() => { warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

describe("ConfigurationRegistry — registerProperties", () => {
  it("registers properties, fires onDidChangeSchema, and exposes them via queries", () => {
    const r = new ConfigurationRegistry();
    const fired = vi.fn();
    r.onDidChangeSchema(fired);
    r.registerProperties("tool-A", "Tool A", {
      "tool.a.flag": { type: "boolean", default: true, description: "flag" },
      "tool.a.name": { type: "string", default: "x", enum: ["x", "y"] },
    });
    expect(fired).toHaveBeenCalledTimes(1);
    expect(fired.mock.calls[0][0]).toEqual({ toolId: "tool-A", affectedKeys: ["tool.a.flag", "tool.a.name"] });
    expect(r.hasSchema("tool.a.flag")).toBe(true);
    expect(r.getDefault("tool.a.flag")).toBe(true);
    expect(r.getPropertySchema("tool.a.name")?.enum).toEqual(["x", "y"]);
    expect(r.getAllSchemas()).toHaveLength(2);
    expect(r.getToolSchemas("tool-A")).toHaveLength(2);
  });

  it("returns a disposable that removes only the keys this call registered", () => {
    const r = new ConfigurationRegistry();
    const d1 = r.registerProperties("t", "T", { "k1": { type: "string", default: "a" } });
    r.registerProperties("t", "T", { "k2": { type: "string", default: "b" } });
    d1.dispose();
    expect(r.hasSchema("k1")).toBe(false);
    expect(r.hasSchema("k2")).toBe(true);
  });

  it("disposing one tool's registration does not remove another tool's key with the same name", () => {
    const r = new ConfigurationRegistry();
    const dA = r.registerProperties("A", "TA", { "shared": { type: "string", default: "a" } });
    r.registerProperties("B", "TB", { "shared": { type: "string", default: "b" } });
    // B's registration overwrote the entry — when A's disposable fires, the
    // current schema.toolId is "B" so A's disposable must NOT delete it.
    dA.dispose();
    expect(r.hasSchema("shared")).toBe(true);
    expect(r.getPropertySchema("shared")?.toolId).toBe("B");
  });

  it("warns on duplicate key but still overwrites", () => {
    const r = new ConfigurationRegistry();
    r.registerProperties("A", "TA", { "shared": { type: "string", default: "a" } });
    r.registerProperties("B", "TB", { "shared": { type: "string", default: "b" } });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Duplicate configuration key "shared"'));
    expect(r.getDefault("shared")).toBe("b");
  });
});

describe("ConfigurationRegistry — registerFromManifest", () => {
  it("registers all properties across multiple manifest configurations", () => {
    const r = new ConfigurationRegistry();
    r.registerFromManifest("tool-A", [
      { title: "Group 1", properties: { "g1.k": { type: "string", default: "v" } } } as any,
      { title: "Group 2", properties: { "g2.k": { type: "number", default: 1 } } } as any,
    ]);
    expect(r.hasSchema("g1.k")).toBe(true);
    expect(r.hasSchema("g2.k")).toBe(true);
    expect(r.getAllSections()).toHaveLength(2);
  });

  it("manifest disposable only removes its own keys", () => {
    const r = new ConfigurationRegistry();
    const d = r.registerFromManifest("A", [{ title: "T", properties: { "a.k": { type: "string", default: "v" } } } as any]);
    r.registerProperties("A", "Other", { "a.other": { type: "string", default: "v" } });
    d.dispose();
    expect(r.hasSchema("a.k")).toBe(false);
    expect(r.hasSchema("a.other")).toBe(true);
  });
});

describe("ConfigurationRegistry — unregisterTool", () => {
  it("removes all keys for the tool and fires onDidChangeSchema", () => {
    const r = new ConfigurationRegistry();
    r.registerProperties("A", "TA", { "a.k": { type: "string", default: "" }, "a.k2": { type: "string", default: "" } });
    const fired = vi.fn();
    r.onDidChangeSchema(fired);
    r.unregisterTool("A");
    expect(r.hasSchema("a.k")).toBe(false);
    expect(r.hasSchema("a.k2")).toBe(false);
    expect(fired).toHaveBeenCalledWith({ toolId: "A", affectedKeys: ["a.k", "a.k2"] });
    expect(r.getToolSchemas("A")).toEqual([]);
  });

  it("is a no-op for an unknown tool", () => {
    const r = new ConfigurationRegistry();
    const fired = vi.fn();
    r.onDidChangeSchema(fired);
    r.unregisterTool("never-registered");
    expect(fired).not.toHaveBeenCalled();
  });
});

describe("ConfigurationRegistry — validateValue", () => {
  function build() {
    const r = new ConfigurationRegistry();
    r.registerProperties("A", "T", {
      "s": { type: "string", default: "" },
      "se": { type: "string", default: "x", enum: ["x", "y"] },
      "n": { type: "number", default: 0 },
      "b": { type: "boolean", default: false },
      "o": { type: "object", default: {} },
    });
    return r;
  }

  it("returns true for unknown keys (forward compatibility)", () => {
    expect(build().validateValue("does-not-exist", 42)).toBe(true);
  });

  it("returns true for null/undefined regardless of type", () => {
    const r = build();
    expect(r.validateValue("s", null)).toBe(true);
    expect(r.validateValue("n", undefined)).toBe(true);
  });

  it("validates string + enum", () => {
    const r = build();
    expect(r.validateValue("s", "hello")).toBe(true);
    expect(r.validateValue("s", 5)).toMatch(/expects a string/);
    expect(r.validateValue("se", "x")).toBe(true);
    expect(r.validateValue("se", "z")).toMatch(/must be one of \[x, y\]/);
  });

  it("validates number, boolean, object", () => {
    const r = build();
    expect(r.validateValue("n", 3)).toBe(true);
    expect(r.validateValue("n", "3")).toMatch(/expects a number/);
    expect(r.validateValue("n", NaN)).toMatch(/expects a number/);
    expect(r.validateValue("b", true)).toBe(true);
    expect(r.validateValue("b", 1)).toMatch(/expects a boolean/);
    expect(r.validateValue("o", { a: 1 })).toBe(true);
    expect(r.validateValue("o", [1, 2])).toMatch(/expects an object, got array/);
  });
});

describe("ConfigurationRegistry — dispose", () => {
  it("clears all state", () => {
    const r = new ConfigurationRegistry();
    r.registerProperties("A", "T", { "k": { type: "string", default: "" } });
    r.dispose();
    expect(r.hasSchema("k")).toBe(false);
    expect(r.getAllSections()).toEqual([]);
  });
});
