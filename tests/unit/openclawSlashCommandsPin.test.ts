/**
 * Pin tests for openclaw slash command handlers.
 *
 * Pins:
 *   - tryHandleOpenclawStatusCommand returns false unless command === "status"; otherwise emits markdown.
 *   - tryHandleOpenclawModelsCommand returns false unless command === "models"; otherwise emits markdown.
 *   - tryHandleOpenclawToolsCommand returns false unless command === "tools"; otherwise emits markdown.
 *   - Each handler renders the "active model" + relevant section headers when invoked.
 *   - Handlers degrade gracefully when optional service delegates are absent.
 */
import { describe, it, expect } from "vitest";
import { tryHandleOpenclawStatusCommand } from "../../src/openclaw/commands/openclawStatusCommand";
import { tryHandleOpenclawModelsCommand } from "../../src/openclaw/commands/openclawModelsCommand";
import { tryHandleOpenclawToolsCommand } from "../../src/openclaw/commands/openclawToolsCommand";

function makeStream() {
  const chunks: string[] = [];
  return {
    chunks,
    stream: {
      markdown: (s: string) => { chunks.push(s); },
      progress: () => {},
      reference: () => {},
      anchor: () => {},
      button: () => {},
      filetree: () => {},
      confirmation: () => {},
      warning: () => {},
    } as any,
  };
}

describe("openclaw commands — gating", () => {
  it("returns false when command does not match", async () => {
    const a = makeStream();
    expect(await tryHandleOpenclawStatusCommand({} as any, "models", a.stream)).toBe(false);
    expect(await tryHandleOpenclawModelsCommand({} as any, "status", a.stream)).toBe(false);
    expect(await tryHandleOpenclawToolsCommand({} as any, "status", a.stream)).toBe(false);
    expect(a.chunks.length).toBe(0);
  });

  it("returns false when command is undefined", async () => {
    const a = makeStream();
    expect(await tryHandleOpenclawStatusCommand({} as any, undefined, a.stream)).toBe(false);
    expect(await tryHandleOpenclawModelsCommand({} as any, undefined, a.stream)).toBe(false);
    expect(await tryHandleOpenclawToolsCommand({} as any, undefined, a.stream)).toBe(false);
  });
});

describe("openclaw /status", () => {
  it("emits AI Runtime Status sections + active model when invoked", async () => {
    const a = makeStream();
    const services = {
      getActiveModel: () => "test-model",
      getModelContextLength: () => 8192,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      checkProviderStatus: async () => ({ available: true, version: "1.2.3" } as any),
      getFileCount: async () => 42,
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          model: { temperature: 0.7, maxTokens: 1000 },
          agent: { maxIterations: 5 },
        }),
      },
    } as any;
    expect(await tryHandleOpenclawStatusCommand(services, "status", a.stream)).toBe(true);
    expect(a.chunks.length).toBe(1);
    const md = a.chunks[0];
    expect(md).toContain("## AI Runtime Status");
    expect(md).toContain("### Connection");
    expect(md).toContain("### Model");
    expect(md).toContain("### Retrieval");
    expect(md).toContain("test-model");
    expect(md).toContain("Indexed Files:** 42");
  });

  it("renders disconnected provider gracefully when checkProviderStatus rejects", async () => {
    const a = makeStream();
    const services = {
      getActiveModel: () => "m",
      checkProviderStatus: async () => { throw new Error("nope"); },
    } as any;
    expect(await tryHandleOpenclawStatusCommand(services, "status", a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("Disconnected");
  });
});

describe("openclaw /models", () => {
  it("renders 'No models found' message when listModels returns empty", async () => {
    const a = makeStream();
    const services = {
      getActiveModel: () => "m",
      listModels: async () => [],
    } as any;
    expect(await tryHandleOpenclawModelsCommand(services, "models", a.stream)).toBe(true);
    expect(a.chunks[0]).toMatch(/No models found/);
  });

  it("renders model table with active marker when listModels returns entries", async () => {
    const a = makeStream();
    const services = {
      getActiveModel: () => "llama3",
      listModels: async () => [
        { id: "llama3", name: "llama3", parameterSize: "8B", quantization: "Q4", contextLength: 8192 },
        { id: "phi", name: "phi", parameterSize: "3B", quantization: "Q4", contextLength: 4096 },
      ],
    } as any;
    expect(await tryHandleOpenclawModelsCommand(services, "models", a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("## Available Models");
    expect(md).toContain("llama3");
    expect(md).toContain("**←**");
    expect(md).toContain("2 model(s) available");
  });

  it("falls back to getAvailableModelIds when listModels delegate is absent", async () => {
    const a = makeStream();
    const services = {
      getActiveModel: () => "x",
      getAvailableModelIds: async () => ["x", "y"],
    } as any;
    expect(await tryHandleOpenclawModelsCommand(services, "models", a.stream)).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("## Available Models");
    expect(md).toContain("← active");
  });

  it("falls back to doctor hint when no list delegates are available", async () => {
    const a = makeStream();
    const services = { getActiveModel: () => "x" } as any;
    expect(await tryHandleOpenclawModelsCommand(services, "models", a.stream)).toBe(true);
    expect(a.chunks[0]).toMatch(/\/doctor/);
  });
});

describe("openclaw /tools", () => {
  it("renders 'No tools registered' when both definitions arrays are empty", async () => {
    const a = makeStream();
    const services = {
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      getActiveModel: () => "m",
    } as any;
    expect(await tryHandleOpenclawToolsCommand(services, "tools", a.stream)).toBe(true);
    expect(a.chunks[0]).toContain("No tools registered");
  });

  it("renders tables for tool-calling tools, read-only tools, and skills", async () => {
    const a = makeStream();
    const services = {
      getToolDefinitions: () => [{ name: "tcall", description: "tool-calling tool" }],
      getReadOnlyToolDefinitions: () => [{ name: "tread", description: "read tool" }],
      getToolPermissions: () => ({ tcall: "always-allowed" }),
      getSkillCatalog: () => [{ name: "skillA", description: "a skill" }],
      getActiveModel: () => "m",
    } as any;
    expect(await tryHandleOpenclawToolsCommand(services, "tools", a.stream, "agent")).toBe(true);
    const md = a.chunks[0];
    expect(md).toContain("## Available Tools");
    expect(md).toContain("### Tool-Calling Tools");
    expect(md).toContain("### Read-Only Tools");
    expect(md).toContain("### Skills");
    expect(md).toContain("tcall");
    expect(md).toContain("tread");
    expect(md).toContain("skillA");
    expect(md).toContain("3 total capabilities");
  });
});
