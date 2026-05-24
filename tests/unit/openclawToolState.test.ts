import { describe, it, expect } from "vitest";
import {
  buildOpenclawRuntimeToolState,
  buildToolDefinitionFromSkillCatalogEntry,
} from "../../src/openclaw/openclawToolState";
import type { IToolDefinition } from "../../src/services/chatTypes";
import type { ISkillCatalogEntry } from "../../src/openclaw/openclawTypes";

function pt(name: string, over: Partial<IToolDefinition> = {}): IToolDefinition {
  return {
    name,
    description: over.description ?? `desc-${name}`,
    parameters: over.parameters ?? {
      type: "object",
      properties: { x: { type: "string" } },
    },
    ...over,
  };
}

describe("buildOpenclawRuntimeToolState — empty and basic", () => {
  it("empty input → empty definitions and zero counts", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [],
      mode: "full",
    });
    expect(out.exposedDefinitions).toEqual([]);
    expect(out.availableDefinitions).toEqual([]);
    expect(out.reportEntries).toEqual([]);
    expect(out.totalCount).toBe(0);
    expect(out.availableCount).toBe(0);
    expect(out.filteredCount).toBe(0);
    expect(out.skillDerivedCount).toBe(0);
  });

  it("platform tool under 'full' profile is exposed and available", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [pt("read_file")],
      skillCatalog: [],
      mode: "full",
    });
    expect(out.exposedDefinitions.map(t => t.name)).toEqual(["read_file"]);
    expect(out.availableDefinitions.map(t => t.name)).toEqual(["read_file"]);
    const entry = out.reportEntries.find(e => e.name === "read_file")!;
    expect(entry.source).toBe("platform");
    expect(entry.exposed).toBe(true);
    expect(entry.available).toBe(true);
    expect(entry.filteredReason).toBeUndefined();
    expect(entry.summaryChars).toBe("desc-read_file".length);
    expect(entry.propertiesCount).toBe(1);
  });
});

describe("buildOpenclawRuntimeToolState — dedupe and filter reasons", () => {
  it("duplicate platform tool names are deduped (first one wins)", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [
        pt("read_file", { description: "first" }),
        pt("read_file", { description: "second" }),
      ],
      skillCatalog: [],
      mode: "full",
    });
    expect(out.exposedDefinitions).toHaveLength(1);
    expect(out.exposedDefinitions[0].description).toBe("first");
    const entries = out.reportEntries.filter(e => e.name === "read_file");
    expect(entries).toHaveLength(1);
  });

  it("tool not on readonly allowlist is exposed but filtered with 'tool-profile-deny'", () => {
    // isToolDeniedByProfile(toolName, mode) returns true when the name is not
    // on the profile's static allow list, so the reason is 'tool-profile-deny'
    // for any platform tool that isn't in the readonly allowlist.
    const out = buildOpenclawRuntimeToolState({
      platformTools: [pt("write_file")],
      skillCatalog: [],
      mode: "readonly",
    });
    expect(out.availableDefinitions).toEqual([]);
    const entry = out.reportEntries[0];
    expect(entry.exposed).toBe(true);
    expect(entry.available).toBe(false);
    expect(entry.filteredReason).toBe("tool-profile-deny");
  });

  it("permissions 'never-allowed' overrides profile and reports 'permission-never-allowed'", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [pt("read_file")],
      skillCatalog: [],
      mode: "readonly",
      permissions: { read_file: "never-allowed" },
    });
    const entry = out.reportEntries[0];
    expect(entry.available).toBe(false);
    expect(entry.filteredReason).toBe("permission-never-allowed");
  });

  it("count buckets partition correctly under readonly profile", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [
        pt("read_file"),
        pt("write_file"),
        pt("grep_search"),
      ],
      skillCatalog: [],
      mode: "readonly",
    });
    // read_file + grep_search are allowed, write_file is filtered.
    expect(out.totalCount).toBe(3);
    expect(out.availableCount).toBe(2);
    expect(out.filteredCount).toBe(1);
    expect(out.skillDerivedCount).toBe(0);
  });
});

describe("buildOpenclawRuntimeToolState — skill-derived tools", () => {
  function skill(over: Partial<ISkillCatalogEntry>): ISkillCatalogEntry {
    return {
      name: over.name ?? "s",
      description: over.description ?? "skill desc",
      kind: over.kind ?? "tool",
      tags: [],
      location: over.location,
      parameters: over.parameters,
    };
  }

  it("non-'tool' kind skills are excluded from the report entirely", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [skill({ name: "wf", kind: "workflow" })],
      mode: "full",
    });
    expect(out.reportEntries).toEqual([]);
    expect(out.exposedDefinitions).toEqual([]);
  });

  it("kind='tool' becomes exposed skill-derived definition under 'full'", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [
        skill({
          name: "skill_tool",
          description: "d",
          location: ".parallx/skills/skill_tool/SKILL.md",
          parameters: [
            { name: "a", type: "string", description: "param a", required: true },
            { name: "b", type: "number", description: "param b", required: false },
          ],
        }),
      ],
      mode: "full",
    });
    expect(out.exposedDefinitions.map(t => t.name)).toEqual(["skill_tool"]);
    expect(out.availableDefinitions.map(t => t.name)).toEqual(["skill_tool"]);
    const entry = out.reportEntries[0];
    expect(entry.source).toBe("skill");
    expect(entry.exposed).toBe(true);
    expect(entry.available).toBe(true);
    expect((entry as { skillLocation?: string }).skillLocation).toBe(
      ".parallx/skills/skill_tool/SKILL.md",
    );
    expect(entry.propertiesCount).toBe(2);
    expect(out.skillDerivedCount).toBe(1);
  });

  it("skill name colliding with platform tool is reported with 'name-collision' and not exposed", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [pt("read_file")],
      skillCatalog: [skill({ name: "read_file" })],
      mode: "full",
    });
    const platform = out.reportEntries.find(e => e.source === "platform")!;
    const collision = out.reportEntries.find(e => e.source === "skill")!;
    expect(platform.exposed).toBe(true);
    expect(collision.exposed).toBe(false);
    expect(collision.available).toBe(false);
    expect(collision.filteredReason).toBe("name-collision");
    expect(out.exposedDefinitions.map(t => t.name)).toEqual(["read_file"]); // only platform
    expect(out.skillDerivedCount).toBe(0);
  });
});

describe("buildOpenclawRuntimeToolState — MCP tools", () => {
  it("undefined mcpTools is treated as empty list (no error)", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [],
      mode: "full",
    });
    expect(out.reportEntries).toEqual([]);
  });

  it("MCP tool not colliding is exposed and available under 'full'", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [],
      mcpTools: [pt("mcp_search")],
      mode: "full",
    });
    expect(out.exposedDefinitions.map(t => t.name)).toEqual(["mcp_search"]);
    const entry = out.reportEntries[0];
    expect(entry.source).toBe("mcp");
    expect(entry.exposed).toBe(true);
  });

  it("MCP tool colliding with platform is filtered 'name-collision', not exposed", () => {
    const out = buildOpenclawRuntimeToolState({
      platformTools: [pt("read_file")],
      skillCatalog: [],
      mcpTools: [pt("read_file", { description: "mcp version" })],
      mode: "full",
    });
    const collision = out.reportEntries.find(e => e.source === "mcp")!;
    expect(collision.exposed).toBe(false);
    expect(collision.filteredReason).toBe("name-collision");
    expect(out.exposedDefinitions).toHaveLength(1);
    expect(out.exposedDefinitions[0].name).toBe("read_file");
    expect(out.exposedDefinitions[0].description).toBe("desc-read_file"); // platform wins
  });
});

describe("buildToolDefinitionFromSkillCatalogEntry", () => {
  it("emits an empty object schema (no required) when no parameters", () => {
    const def = buildToolDefinitionFromSkillCatalogEntry({
      name: "x", description: "d", kind: "tool", tags: [],
    });
    expect(def.name).toBe("x");
    expect(def.description).toBe("d");
    expect(def.parameters).toEqual({ type: "object", properties: {} });
  });

  it("emits required[] only for params marked required:true", () => {
    const def = buildToolDefinitionFromSkillCatalogEntry({
      name: "x", description: "d", kind: "tool", tags: [],
      parameters: [
        { name: "a", type: "string", description: "A", required: true },
        { name: "b", type: "number", description: "B", required: false },
      ],
    });
    expect(def.parameters).toEqual({
      type: "object",
      properties: {
        a: { type: "string", description: "A" },
        b: { type: "number", description: "B" },
      },
      required: ["a"],
    });
  });

  it("omits required[] entirely when no params are required", () => {
    const def = buildToolDefinitionFromSkillCatalogEntry({
      name: "x", description: "d", kind: "tool", tags: [],
      parameters: [{ name: "a", type: "string", description: "A", required: false }],
    });
    expect(def.parameters).toEqual({
      type: "object",
      properties: { a: { type: "string", description: "A" } },
    });
    expect((def.parameters as Record<string, unknown>).required).toBeUndefined();
  });
});
