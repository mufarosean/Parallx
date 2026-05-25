/**
 * Pin: buildOpenclawRuntimeToolState — assembles the model-visible tool
 * catalog from platform tools + skill catalog + MCP tools, runs each
 * through the profile/permission policy, and emits the runtime report.
 *
 * Uses the real openclawToolPolicy so the pin doubles as an integration
 * pin for the full {platform,skill,mcp} × {readonly,standard,full} matrix.
 */
import { describe, it, expect } from "vitest";
import {
  buildOpenclawRuntimeToolState,
  buildToolDefinitionFromSkillCatalogEntry,
} from "../../src/openclaw/openclawToolState";
import type { IToolDefinition } from "../../src/services/chatTypes";
import type { ISkillCatalogEntry } from "../../src/openclaw/openclawTypes";

const PLATFORM_TOOL = (name: string, extra?: Partial<IToolDefinition>): IToolDefinition => ({
  name,
  description: `desc:${name}`,
  parameters: { type: "object", properties: { x: { type: "string" } } },
  ...extra,
});

describe("buildOpenclawRuntimeToolState — dedupe platform tools", () => {
  it("dedupes by name, keeping the first occurrence", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file"), PLATFORM_TOOL("read_file", { description: "dup" })],
      skillCatalog: [],
      mode: "full",
    });
    expect(state.exposedDefinitions.map(t => t.name)).toEqual(["read_file"]);
    expect(state.exposedDefinitions[0].description).toBe("desc:read_file");
  });
});

describe("buildOpenclawRuntimeToolState — full profile exposes everything", () => {
  it("full profile: all platform tools available; report entries reflect platform source", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("write_file"), PLATFORM_TOOL("read_file"), PLATFORM_TOOL("anything_goes")],
      skillCatalog: [],
      mode: "full",
    });
    expect(state.availableCount).toBe(3);
    expect(state.filteredCount).toBe(0);
    expect(state.totalCount).toBe(3);
    expect(state.reportEntries.every(e => e.source === "platform" && e.exposed && e.available)).toBe(true);
  });
});

describe("buildOpenclawRuntimeToolState — readonly profile gates writes", () => {
  it("readonly: read_file allowed, write_file filtered with 'tool-profile-deny'", () => {
    // Note: isToolDeniedByProfile returns true whenever the name is not in the
    // allow list (and the allow list is not '*'), so platform tools missing from
    // the profile's allow report 'tool-profile-deny' (the deny-precedence reason).
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file"), PLATFORM_TOOL("write_file")],
      skillCatalog: [],
      mode: "readonly",
    });
    expect(state.availableDefinitions.map(t => t.name)).toEqual(["read_file"]);
    expect(state.filteredCount).toBe(1);
    const writeEntry = state.reportEntries.find(e => e.name === "write_file");
    expect(writeEntry?.exposed).toBe(true);
    expect(writeEntry?.available).toBe(false);
    expect(writeEntry?.filteredReason).toBe("tool-profile-deny");
  });
});

describe("buildOpenclawRuntimeToolState — permission filter (never-allowed)", () => {
  it("permissions: 'never-allowed' removes the tool with 'permission-never-allowed' reason", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file"), PLATFORM_TOOL("write_file")],
      skillCatalog: [],
      mode: "full",
      permissions: { read_file: "never-allowed" },
    });
    expect(state.availableDefinitions.map(t => t.name)).toEqual(["write_file"]);
    const readEntry = state.reportEntries.find(e => e.name === "read_file");
    expect(readEntry?.available).toBe(false);
    expect(readEntry?.filteredReason).toBe("permission-never-allowed");
  });
});

describe("buildOpenclawRuntimeToolState — skill-derived tools", () => {
  const toolSkill: ISkillCatalogEntry = {
    name: "custom_tool",
    kind: "tool",
    description: "skill-derived",
    location: "ext/x/skills/custom_tool.md",
    parameters: [
      { name: "topic", type: "string", description: "the topic", required: true },
      { name: "count", type: "number", description: "n", required: false },
    ],
  } as any;

  it("buildToolDefinitionFromSkillCatalogEntry: derives name/description/parameters", () => {
    const def = buildToolDefinitionFromSkillCatalogEntry(toolSkill);
    expect(def.name).toBe("custom_tool");
    expect(def.description).toBe("skill-derived");
    expect(def.parameters).toEqual({
      type: "object",
      properties: {
        topic: { type: "string", description: "the topic" },
        count: { type: "number", description: "n" },
      },
      required: ["topic"],
    });
  });

  it("omits the 'required' field when no parameters are required", () => {
    const optional: ISkillCatalogEntry = {
      ...toolSkill,
      parameters: [{ name: "q", type: "string", description: "q", required: false }],
    } as any;
    const def = buildToolDefinitionFromSkillCatalogEntry(optional);
    expect((def.parameters as any).required).toBeUndefined();
  });

  it("kind='workflow' skills are NOT exposed as tools (no entries, no defs)", () => {
    const workflow: ISkillCatalogEntry = { ...toolSkill, name: "wf", kind: "workflow" } as any;
    const state = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [workflow],
      mode: "full",
    });
    expect(state.exposedDefinitions).toEqual([]);
    expect(state.skillDerivedCount).toBe(0);
    expect(state.reportEntries).toEqual([]);
  });

  it("kind='tool' skill becomes an exposed tool with source='skill' + skillLocation", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [],
      skillCatalog: [toolSkill],
      mode: "full",
    });
    expect(state.exposedDefinitions.map(t => t.name)).toEqual(["custom_tool"]);
    expect(state.skillDerivedCount).toBe(1);
    const entry = state.reportEntries[0];
    expect(entry.source).toBe("skill");
    expect(entry.skillLocation).toBe("ext/x/skills/custom_tool.md");
  });

  it("name-collision: skill name matches a platform tool → skill marked exposed=false available=false reason='name-collision'", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("custom_tool")],
      skillCatalog: [toolSkill],
      mode: "full",
    });
    expect(state.exposedDefinitions.map(t => t.name)).toEqual(["custom_tool"]); // platform wins
    const skillEntry = state.reportEntries.find(e => e.source === "skill");
    expect(skillEntry?.exposed).toBe(false);
    expect(skillEntry?.available).toBe(false);
    expect(skillEntry?.filteredReason).toBe("name-collision");
  });
});

describe("buildOpenclawRuntimeToolState — MCP tools (D1)", () => {
  it("MCP tools are tagged source='mcp' and run through the policy", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file")],
      skillCatalog: [],
      mcpTools: [PLATFORM_TOOL("mcp_search")],
      mode: "full",
    });
    expect(state.exposedDefinitions.map(t => t.name)).toEqual(["read_file", "mcp_search"]);
    const mcpEntry = state.reportEntries.find(e => e.name === "mcp_search");
    expect(mcpEntry?.source).toBe("mcp");
    expect(mcpEntry?.available).toBe(true);
  });

  it("MCP name-collision with platform → mcp entry exposed=false reason='name-collision'", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file")],
      skillCatalog: [],
      mcpTools: [PLATFORM_TOOL("read_file")],
      mode: "full",
    });
    expect(state.exposedDefinitions.map(t => t.name)).toEqual(["read_file"]);
    const mcpEntry = state.reportEntries.find(e => e.source === "mcp");
    expect(mcpEntry?.exposed).toBe(false);
    expect(mcpEntry?.filteredReason).toBe("name-collision");
  });
});

describe("buildOpenclawRuntimeToolState — D8 agentTools filter", () => {
  it("agentTools.deny excludes a tool that the profile would allow", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file"), PLATFORM_TOOL("write_file")],
      skillCatalog: [],
      mode: "full",
      agentTools: { deny: ["write_file"] } as any,
    });
    expect(state.availableDefinitions.map(t => t.name)).toEqual(["read_file"]);
  });

  it("agentTools.allow (non-empty) restricts to listed names", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file"), PLATFORM_TOOL("write_file"), PLATFORM_TOOL("grep_search")],
      skillCatalog: [],
      mode: "full",
      agentTools: { allow: ["read_file"] } as any,
    });
    expect(state.availableDefinitions.map(t => t.name)).toEqual(["read_file"]);
  });
});

describe("buildOpenclawRuntimeToolState — report invariants", () => {
  it("schemaChars = JSON.stringify(parameters).length; summaryChars = description.length", () => {
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file")],
      skillCatalog: [],
      mode: "full",
    });
    const entry = state.reportEntries[0];
    expect(entry.summaryChars).toBe("desc:read_file".length);
    expect(entry.schemaChars).toBe(JSON.stringify({ type: "object", properties: { x: { type: "string" } } }).length);
    expect(entry.propertiesCount).toBe(1);
  });

  it("totalCount = number of exposed entries (skill-collision excluded)", () => {
    const skill: ISkillCatalogEntry = {
      name: "read_file", kind: "tool", description: "", location: "", parameters: [],
    } as any;
    const state = buildOpenclawRuntimeToolState({
      platformTools: [PLATFORM_TOOL("read_file"), PLATFORM_TOOL("write_file")],
      skillCatalog: [skill],
      mode: "full",
    });
    expect(state.totalCount).toBe(2); // skill collision is exposed=false
    expect(state.skillDerivedCount).toBe(0);
  });
});
