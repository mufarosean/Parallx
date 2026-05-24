/**
 * Pin: workspaceManifest — version constant, create/parse/validate/manifest→state
 * round-trip, default boundary/settings/storage applied when not overridden,
 * validation error branches.
 */
import { describe, it, expect } from "vitest";
import {
  PARALLX_WORKSPACE_MANIFEST_VERSION,
  createWorkspaceManifestFromState,
  parseWorkspaceManifest,
  manifestToWorkspaceState,
  validateWorkspaceManifest,
  type WorkspaceManifest,
} from "../../src/workspace/workspaceManifest";

const stateLike = (): any => ({
  version: 1,
  identity: { id: "ws-1", name: "Demo", iconOrColor: "blue" },
  metadata: { createdAt: "2025-01-01T00:00:00.000Z", lastAccessedAt: "2025-01-02T00:00:00.000Z" },
  layout: {},
  parts: [],
  viewContainers: [],
  views: [],
  editors: { groups: [{ editors: [], activeEditorIndex: -1 }], activeGroupIndex: 0 },
  context: {},
  folders: [{ scheme: "file", path: "/work/demo", name: "demo" }],
});

describe("workspace/workspaceManifest", () => {
  it("PARALLX_WORKSPACE_MANIFEST_VERSION is 1", () => {
    expect(PARALLX_WORKSPACE_MANIFEST_VERSION).toBe(1);
  });

  it("createWorkspaceManifestFromState produces a manifest with defaults", () => {
    const m = createWorkspaceManifestFromState(stateLike());
    expect(m.manifestVersion).toBe(1);
    expect(m.identity.id).toBe("ws-1");
    expect(m.identity.name).toBe("Demo");
    expect(m.identity.iconOrColor).toBe("blue");
    expect(m.identity.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(m.identity.updatedAt).toBe("2025-01-02T00:00:00.000Z");
    expect(typeof m.identity.savedAt).toBe("string");
    expect(m.folders).toHaveLength(1);
    expect(m.folders[0].uri).toBe("file:///work/demo");
    expect(m.folders[0].name).toBe("demo");
    expect(m.folders[0].index).toBe(0);
    expect(m.folders[0].trusted).toBe(true);
    expect(m.boundary).toEqual({
      mode: "strict",
      allowWorkspaceFoldersOnly: true,
      defaultFileAccess: "deny",
      policyVersion: 1,
    });
    expect(m.settings).toEqual({ global: {}, tools: {} });
    expect(m.storage.workspaceDataDir).toBe(".parallx");
    expect(m.storage.canvas.database.relativePath).toBe(".parallx/data.db");
    expect(m.storage.canvas.database.strategy).toBe("workspace-root-relative");
    expect(m.storage.canvas.database.journalMode).toBe("WAL");
    expect(m.meta?.exportedBy).toBe("Parallx");
  });

  it("createWorkspaceManifestFromState honors option overrides", () => {
    const m = createWorkspaceManifestFromState(stateLike(), {
      sourceUri: "file:///exported.parallxworkspace",
      exportedBy: "test-suite",
      notes: "hello",
      tags: ["a", "b"],
    });
    expect(m.identity.sourceUri).toBe("file:///exported.parallxworkspace");
    expect(m.identity.tags).toEqual(["a", "b"]);
    expect(m.meta?.exportedBy).toBe("test-suite");
    expect(m.meta?.notes).toBe("hello");
  });

  it("validateWorkspaceManifest accepts a manifest built from state", () => {
    const m = createWorkspaceManifestFromState(stateLike());
    const r = validateWorkspaceManifest(m);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("validateWorkspaceManifest rejects non-objects", () => {
    expect(validateWorkspaceManifest(null).valid).toBe(false);
    expect(validateWorkspaceManifest("nope").valid).toBe(false);
    expect(validateWorkspaceManifest(42).valid).toBe(false);
  });

  it("validateWorkspaceManifest enumerates missing identity / boundary / version errors", () => {
    const r = validateWorkspaceManifest({ manifestVersion: 99 });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.includes("manifestVersion must be 1"))).toBe(true);
    expect(r.errors.some(e => e.includes("identity is required"))).toBe(true);
    expect(r.errors.some(e => e.includes("folders must be an array"))).toBe(true);
    expect(r.errors.some(e => e.includes("boundary is required"))).toBe(true);
    expect(r.errors.some(e => e.includes("settings is required"))).toBe(true);
    expect(r.errors.some(e => e.includes("storage is required"))).toBe(true);
    expect(r.errors.some(e => e.includes("state is required"))).toBe(true);
  });

  it("validateWorkspaceManifest catches per-field boundary violations", () => {
    const m = createWorkspaceManifestFromState(stateLike());
    const bad: WorkspaceManifest = {
      ...m,
      boundary: { ...m.boundary, mode: "lenient" as any, allowWorkspaceFoldersOnly: false as any, defaultFileAccess: "allow" as any },
    };
    const r = validateWorkspaceManifest(bad);
    expect(r.valid).toBe(false);
    expect(r.errors).toEqual(expect.arrayContaining([
      'boundary.mode must be "strict"',
      'boundary.allowWorkspaceFoldersOnly must be true',
      'boundary.defaultFileAccess must be "deny"',
    ]));
  });

  it("parseWorkspaceManifest succeeds on round-trip JSON", () => {
    const m = createWorkspaceManifestFromState(stateLike());
    const parsed = parseWorkspaceManifest(JSON.stringify(m));
    expect(parsed.identity.id).toBe("ws-1");
  });

  it("parseWorkspaceManifest throws on invalid JSON", () => {
    expect(() => parseWorkspaceManifest("{not json")).toThrow(/Invalid JSON/);
  });

  it("parseWorkspaceManifest throws on validation failure", () => {
    expect(() => parseWorkspaceManifest(JSON.stringify({ manifestVersion: 99 }))).toThrow(/Validation failed/);
  });

  it("manifestToWorkspaceState restores folders + identity + metadata from manifest", () => {
    const original = stateLike();
    const m = createWorkspaceManifestFromState(original);
    const restored = manifestToWorkspaceState(m);
    expect(restored.identity.id).toBe("ws-1");
    expect(restored.identity.name).toBe("Demo");
    expect(restored.identity.iconOrColor).toBe("blue");
    expect(restored.folders).toEqual([{ scheme: "file", path: "/work/demo", name: "demo" }]);
    expect(restored.metadata.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(restored.metadata.lastAccessedAt).toBe("2025-01-02T00:00:00.000Z");
  });

  it("manifestToWorkspaceState throws on invalid manifest", () => {
    expect(() => manifestToWorkspaceState({ manifestVersion: 99 } as any)).toThrow(/Invalid manifest/);
  });
});
