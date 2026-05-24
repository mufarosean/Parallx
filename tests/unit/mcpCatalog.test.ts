import { describe, it, expect } from "vitest";
import { MCP_CATALOG } from "../../src/openclaw/mcp/mcpCatalog";

describe("MCP_CATALOG shape invariants", () => {
  it("is frozen at the array level", () => {
    expect(Object.isFrozen(MCP_CATALOG)).toBe(true);
  });

  it("has non-empty length and unique stable ids", () => {
    expect(MCP_CATALOG.length).toBeGreaterThan(0);
    const ids = MCP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("requires every entry to declare displayName / description / category / homepage / command / args / env", () => {
    for (const entry of MCP_CATALOG) {
      expect(typeof entry.id).toBe("string");
      expect(entry.id.length).toBeGreaterThan(0);
      expect(typeof entry.displayName).toBe("string");
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.category).toBe("string");
      expect(entry.category.length).toBeGreaterThan(0);
      expect(entry.homepage.startsWith("https://")).toBe(true);
      expect(typeof entry.command).toBe("string");
      expect(entry.command.length).toBeGreaterThan(0);
      expect(Array.isArray(entry.args)).toBe(true);
      expect(Array.isArray(entry.env)).toBe(true);
    }
  });

  it("uses npx for non-bundled entries", () => {
    for (const entry of MCP_CATALOG) {
      if (!entry.bundled) {
        expect(entry.command).toBe("npx");
      }
    }
  });

  it("bundled entries reference {appRoot} placeholder somewhere in args", () => {
    const bundled = MCP_CATALOG.filter((e) => e.bundled);
    expect(bundled.length).toBeGreaterThan(0);
    for (const entry of bundled) {
      const joined = entry.args.join(" ");
      expect(joined).toMatch(/\{appRoot\}/);
    }
  });

  it("requiresOAuth and bundled are booleans when set", () => {
    for (const entry of MCP_CATALOG) {
      if (entry.bundled !== undefined) expect(typeof entry.bundled).toBe("boolean");
      if (entry.requiresOAuth !== undefined) expect(typeof entry.requiresOAuth).toBe("boolean");
    }
  });

  it("every env var has key/label/description/required and optional secret", () => {
    for (const entry of MCP_CATALOG) {
      for (const v of entry.env) {
        expect(typeof v.key).toBe("string");
        expect(v.key.length).toBeGreaterThan(0);
        expect(typeof v.label).toBe("string");
        expect(typeof v.description).toBe("string");
        expect(typeof v.required).toBe("boolean");
        if (v.secret !== undefined) expect(typeof v.secret).toBe("boolean");
      }
    }
  });

  it("known core ids are present (filesystem, github, gmail, slack, brave-search, memory, sequential-thinking, fetch)", () => {
    const ids = new Set(MCP_CATALOG.map((e) => e.id));
    for (const k of [
      "filesystem", "github", "gmail", "slack",
      "brave-search", "memory", "sequential-thinking", "fetch",
    ]) {
      expect(ids.has(k)).toBe(true);
    }
  });

  it("github entry requires a secret PAT", () => {
    const gh = MCP_CATALOG.find((e) => e.id === "github");
    expect(gh).toBeDefined();
    const pat = gh!.env.find((v) => v.key === "GITHUB_PERSONAL_ACCESS_TOKEN");
    expect(pat).toBeDefined();
    expect(pat!.required).toBe(true);
    expect(pat!.secret).toBe(true);
  });

  it("gmail entry is bundled and requiresOAuth", () => {
    const gmail = MCP_CATALOG.find((e) => e.id === "gmail");
    expect(gmail).toBeDefined();
    expect(gmail!.bundled).toBe(true);
    expect(gmail!.requiresOAuth).toBe(true);
  });

  it("filesystem entry's optional env var is not marked required", () => {
    const fs = MCP_CATALOG.find((e) => e.id === "filesystem");
    expect(fs).toBeDefined();
    const root = fs!.env.find((v) => v.key === "PARALLX_MCP_FS_ROOT");
    expect(root).toBeDefined();
    expect(root!.required).toBe(false);
  });
});
