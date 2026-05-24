/**
 * Pin-the-invariant: tools/toolScanner.ts bridge wiring + manifest collation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolScanner } from "../../src/tools/toolScanner";
import { CURRENT_MANIFEST_VERSION } from "../../src/tools/toolManifest";

function validManifest(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    manifestVersion: CURRENT_MANIFEST_VERSION,
    id: "pin.test",
    name: "Pin Test",
    version: "1.0.0",
    publisher: "parallx",
    main: "dist/main.js",
    activationEvents: ["onStartupFinished"],
    engines: { parallx: "*" },
    ...over,
  };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  delete (globalThis as any).parallxElectron;
});

afterEach(() => {
  warnSpy.mockRestore();
  delete (globalThis as any).parallxElectron;
});

describe("ToolScanner.scanDefaults — bridge unavailable", () => {
  it("returns empty + warns when no bridge is exposed on globalThis", async () => {
    const r = await new ToolScanner().scanDefaults();
    expect(r).toEqual({ tools: [], failures: [], directoryErrors: [] });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("No Electron bridge"),
    );
  });
});

describe("ToolScanner.scanDirectory — bridge wiring", () => {
  it("reports a directory error when the bridge is missing", async () => {
    const r = await new ToolScanner().scanDirectory("/x", false);
    expect(r.tools).toEqual([]);
    expect(r.directoryErrors).toEqual([
      { directory: "/x", error: "No Electron bridge available" },
    ]);
  });

  it("propagates a thrown bridge error as a directoryErrors entry", async () => {
    (globalThis as any).parallxElectron = {
      scanToolDirectory: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const r = await new ToolScanner().scanDirectory("/x", false);
    expect(r.tools).toEqual([]);
    expect(r.directoryErrors[0].directory).toBe("/x");
    expect(r.directoryErrors[0].error).toContain("boom");
  });

  it("propagates a bridge result.error as a directoryErrors entry", async () => {
    (globalThis as any).parallxElectron = {
      scanToolDirectory: vi.fn().mockResolvedValue({ entries: [], error: "ENOENT" }),
    };
    const r = await new ToolScanner().scanDirectory("/x", true);
    expect(r.directoryErrors).toEqual([{ directory: "/x", error: "ENOENT" }]);
  });

  it("collects entry-level errors into failures without throwing", async () => {
    (globalThis as any).parallxElectron = {
      scanToolDirectory: vi.fn().mockResolvedValue({
        entries: [{ toolPath: "/x/a", error: "missing manifest" }],
        error: null,
      }),
    };
    const r = await new ToolScanner().scanDirectory("/x", false);
    expect(r.failures).toEqual([{ toolPath: "/x/a", reason: "missing manifest" }]);
    expect(r.tools).toEqual([]);
  });

  it("produces a validation failure with validationErrors for invalid manifests", async () => {
    (globalThis as any).parallxElectron = {
      scanToolDirectory: vi.fn().mockResolvedValue({
        entries: [{ toolPath: "/x/bad", manifestJson: { id: "" } }],
        error: null,
      }),
    };
    const r = await new ToolScanner().scanDirectory("/x", false);
    expect(r.tools).toEqual([]);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].toolPath).toBe("/x/bad");
    expect(r.failures[0].reason).toContain("validation failed");
    expect(r.failures[0].validationErrors!.length).toBeGreaterThan(0);
  });

  it("emits a valid IToolDescription for valid manifests, stamping isBuiltin from caller", async () => {
    const m = validManifest({ id: "pin.ok" });
    (globalThis as any).parallxElectron = {
      scanToolDirectory: vi.fn().mockResolvedValue({
        entries: [{ toolPath: "/x/ok", manifestJson: m }],
        error: null,
      }),
    };
    const r = await new ToolScanner().scanDirectory("/x", true);
    expect(r.failures).toEqual([]);
    expect(r.tools).toHaveLength(1);
    expect(r.tools[0]).toEqual({ manifest: m, toolPath: "/x/ok", isBuiltin: true });
  });
});

describe("ToolScanner.scanDirectories — aggregation", () => {
  it("flattens tools + failures + directoryErrors across multiple dirs", async () => {
    const okManifest = validManifest({ id: "pin.ok" });
    const calls = vi.fn(async (dirPath: string) => {
      if (dirPath === "/a") return { entries: [{ toolPath: "/a/ok", manifestJson: okManifest }], error: null };
      if (dirPath === "/b") return { entries: [{ toolPath: "/b/bad", manifestJson: {} }], error: null };
      return { entries: [], error: "ENOENT" };
    });
    (globalThis as any).parallxElectron = { scanToolDirectory: calls };
    const r = await new ToolScanner().scanDirectories([
      { path: "/a", isBuiltin: true },
      { path: "/b", isBuiltin: false },
      { path: "/missing", isBuiltin: false },
    ]);
    expect(r.tools.map((t) => t.toolPath)).toEqual(["/a/ok"]);
    expect(r.tools[0].isBuiltin).toBe(true);
    expect(r.failures.map((f) => f.toolPath)).toEqual(["/b/bad"]);
    expect(r.directoryErrors).toEqual([{ directory: "/missing", error: "ENOENT" }]);
  });
});

describe("ToolScanner.scanDefaults — bridge available", () => {
  it("queries getToolDirectories and prepends devDir before built-in + user", async () => {
    const getToolDirectories = vi.fn().mockResolvedValue({
      builtinDir: "/built",
      userDir: "/user",
      devDir: "/dev",
    });
    const scanToolDirectory = vi.fn().mockResolvedValue({ entries: [], error: null });
    (globalThis as any).parallxElectron = { getToolDirectories, scanToolDirectory };

    await new ToolScanner().scanDefaults();
    expect(getToolDirectories).toHaveBeenCalled();
    expect(scanToolDirectory.mock.calls.map((c) => c[0])).toEqual(["/dev", "/built", "/user"]);
  });

  it("omits devDir when null", async () => {
    const scanToolDirectory = vi.fn().mockResolvedValue({ entries: [], error: null });
    (globalThis as any).parallxElectron = {
      getToolDirectories: vi.fn().mockResolvedValue({
        builtinDir: "/built",
        userDir: "/user",
        devDir: null,
      }),
      scanToolDirectory,
    };
    await new ToolScanner().scanDefaults();
    expect(scanToolDirectory.mock.calls.map((c) => c[0])).toEqual(["/built", "/user"]);
  });
});

describe("ToolScanner.registerFromManifest", () => {
  it("returns an IToolDescription for valid manifests", () => {
    const m = validManifest({ id: "pin.reg" });
    const r = new ToolScanner().registerFromManifest(m as any, "/x", true);
    expect(r).toEqual({ manifest: m, toolPath: "/x", isBuiltin: true });
  });

  it("returns a ToolScanFailure for invalid manifests", () => {
    const r = new ToolScanner().registerFromManifest({} as any, "/x", false) as any;
    expect(r.toolPath).toBe("/x");
    expect(r.reason).toContain("validation failed");
    expect(r.validationErrors.length).toBeGreaterThan(0);
  });
});
