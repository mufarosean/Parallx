/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi } from "vitest";
import { ToolEnablementService } from "../../src/tools/toolEnablementService";
import { ToolEnablementState } from "../../src/tools/toolEnablement";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    async get(k: string) { return map.get(k); },
    async set(k: string, v: string) { map.set(k, v); },
    async delete(k: string) { map.delete(k); },
    async has(k: string) { return map.has(k); },
    async keys(prefix?: string) {
      return [...map.keys()].filter((k) => !prefix || k.startsWith(prefix));
    },
    async clear() { map.clear(); },
  };
}

function fakeRegistry(entries: Record<string, { isBuiltin: boolean }>) {
  return {
    getById(id: string) {
      const e = entries[id];
      return e ? { description: { isBuiltin: e.isBuiltin } } : undefined;
    },
  };
}

describe("ToolEnablementService — isEnabled defaults", () => {
  it("built-in tools are always enabled even with no load", async () => {
    const svc = new ToolEnablementService(
      fakeStorage() as any,
      fakeRegistry({ "b": { isBuiltin: true } }) as any,
    );
    expect(svc.isEnabled("b")).toBe(true);
  });

  it("external tools default to DISABLED until explicitly enabled", async () => {
    const svc = new ToolEnablementService(
      fakeStorage() as any,
      fakeRegistry({ "x": { isBuiltin: false } }) as any,
    );
    expect(svc.isEnabled("x")).toBe(false);
  });

  it("unknown tools are reported as disabled", () => {
    const svc = new ToolEnablementService(fakeStorage() as any, fakeRegistry({}) as any);
    expect(svc.isEnabled("nope")).toBe(false);
  });

  it("getEnablementState mirrors isEnabled", () => {
    const reg = fakeRegistry({ "b": { isBuiltin: true }, "x": { isBuiltin: false } });
    const svc = new ToolEnablementService(fakeStorage() as any, reg as any);
    expect(svc.getEnablementState("b")).toBe(ToolEnablementState.EnabledGlobally);
    expect(svc.getEnablementState("x")).toBe(ToolEnablementState.DisabledGlobally);
  });
});

describe("ToolEnablementService — canChangeEnablement", () => {
  it("returns false for built-in tools and unknown tools, true for external", () => {
    const reg = fakeRegistry({ "b": { isBuiltin: true }, "x": { isBuiltin: false } });
    const svc = new ToolEnablementService(fakeStorage() as any, reg as any);
    expect(svc.canChangeEnablement("b")).toBe(false);
    expect(svc.canChangeEnablement("x")).toBe(true);
    expect(svc.canChangeEnablement("unknown")).toBe(false);
  });
});

describe("ToolEnablementService — setEnablement", () => {
  it("throws when changing enablement of a built-in or unknown tool", async () => {
    const reg = fakeRegistry({ "b": { isBuiltin: true } });
    const svc = new ToolEnablementService(fakeStorage() as any, reg as any);
    await expect(svc.setEnablement("b", false)).rejects.toThrow(/Cannot change enablement/);
    await expect(svc.setEnablement("unknown", true)).rejects.toThrow(/Cannot change enablement/);
  });

  it("enabling an external tool persists it to the enabled-external set and fires onDidChangeEnablement", async () => {
    const reg = fakeRegistry({ "x": { isBuiltin: false } });
    const s = fakeStorage();
    const svc = new ToolEnablementService(s as any, reg as any);
    const events: any[] = [];
    svc.onDidChangeEnablement((e) => events.push(e));
    await svc.setEnablement("x", true);
    expect(svc.isEnabled("x")).toBe(true);
    expect(s.map.get("tool-enablement:enabled-external")).toBe(JSON.stringify(["x"]));
    expect(s.map.get("tool-enablement:disabled")).toBe(JSON.stringify([]));
    expect(events).toEqual([{ toolId: "x", newState: ToolEnablementState.EnabledGlobally }]);
  });

  it("disabling an already-enabled external tool removes it from enabled-external and adds to disabled", async () => {
    const reg = fakeRegistry({ "x": { isBuiltin: false } });
    const s = fakeStorage();
    const svc = new ToolEnablementService(s as any, reg as any);
    await svc.setEnablement("x", true);
    await svc.setEnablement("x", false);
    expect(svc.isEnabled("x")).toBe(false);
    expect(s.map.get("tool-enablement:enabled-external")).toBe(JSON.stringify([]));
    expect(s.map.get("tool-enablement:disabled")).toBe(JSON.stringify(["x"]));
  });

  it("setEnablement is a no-op when the requested state matches the current state", async () => {
    const reg = fakeRegistry({ "x": { isBuiltin: false } });
    const svc = new ToolEnablementService(fakeStorage() as any, reg as any);
    const events: any[] = [];
    svc.onDidChangeEnablement((e) => events.push(e));
    // Already disabled → set disabled again
    await svc.setEnablement("x", false);
    expect(events).toEqual([]);
  });

  it("getDisabledToolIds returns the live disabled set", async () => {
    const reg = fakeRegistry({ "x": { isBuiltin: false }, "y": { isBuiltin: false } });
    const svc = new ToolEnablementService(fakeStorage() as any, reg as any);
    await svc.setEnablement("x", true);
    await svc.setEnablement("x", false);
    expect([...svc.getDisabledToolIds()]).toEqual(["x"]);
  });
});

describe("ToolEnablementService — load", () => {
  it("load() restores the disabled and enabled-external sets from storage", async () => {
    const reg = fakeRegistry({ "x": { isBuiltin: false }, "y": { isBuiltin: false } });
    const s = fakeStorage();
    s.map.set("tool-enablement:disabled", JSON.stringify(["y"]));
    s.map.set("tool-enablement:enabled-external", JSON.stringify(["x"]));
    const svc = new ToolEnablementService(s as any, reg as any);
    // Silence the info log
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await svc.load();
    log.mockRestore();
    expect(svc.isEnabled("x")).toBe(true);
    expect(svc.isEnabled("y")).toBe(false);
  });

  it("load() warns and falls back to empty sets on corrupt JSON", async () => {
    const reg = fakeRegistry({ "x": { isBuiltin: false } });
    const s = fakeStorage();
    s.map.set("tool-enablement:disabled", "{not json");
    s.map.set("tool-enablement:enabled-external", "[also broken");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const svc = new ToolEnablementService(s as any, reg as any);
    await svc.load();
    expect(warn).toHaveBeenCalled();
    expect(svc.isEnabled("x")).toBe(false);
    expect([...svc.getDisabledToolIds()]).toEqual([]);
    warn.mockRestore();
    log.mockRestore();
  });

  it("load() ignores non-string, empty, and non-array entries", async () => {
    const reg = fakeRegistry({ "x": { isBuiltin: false } });
    const s = fakeStorage();
    s.map.set("tool-enablement:disabled", JSON.stringify(["", 123, null, "x"]));
    s.map.set("tool-enablement:enabled-external", JSON.stringify({ not: "array" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const svc = new ToolEnablementService(s as any, reg as any);
    await svc.load();
    log.mockRestore();
    expect([...svc.getDisabledToolIds()]).toEqual(["x"]);
  });
});
