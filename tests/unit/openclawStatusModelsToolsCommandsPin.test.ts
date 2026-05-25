/**
 * Pin: openclaw /status, /models, /tools commands — slash-command handlers
 * that report runtime status, model list, and registered tools as markdown
 * to the response stream.  Locks the command gate, markdown headers, the
 * fallback paths when delegates are missing, and the marker-emit behaviour.
 */
import { describe, it, expect, vi } from "vitest";
import { tryHandleOpenclawStatusCommand } from "../../src/openclaw/commands/openclawStatusCommand";
import { tryHandleOpenclawModelsCommand } from "../../src/openclaw/commands/openclawModelsCommand";
import { tryHandleOpenclawToolsCommand } from "../../src/openclaw/commands/openclawToolsCommand";

function makeResponse() {
  const calls: string[] = [];
  return {
    calls,
    markdown(text: string) {
      calls.push(text);
    },
  } as any;
}

// ── /status ──────────────────────────────────────────────────────────────────

describe("tryHandleOpenclawStatusCommand", () => {
  it("returns false for non-'status' command without side effects", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawStatusCommand({} as any, "models", r)).toBe(false);
    expect(await tryHandleOpenclawStatusCommand({} as any, undefined, r)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it("happy path: emits AI Runtime Status with Connection/Model/Retrieval sections", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      getModelContextLength: () => 8192,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      checkProviderStatus: vi.fn().mockResolvedValue({ available: true, version: "0.1.40" }),
      getFileCount: vi.fn().mockResolvedValue(42),
      unifiedConfigService: {
        getEffectiveConfig: () => ({
          model: { temperature: 0.7, maxTokens: 4096 },
          agent: { maxIterations: 5 },
        }),
      },
    };
    expect(await tryHandleOpenclawStatusCommand(services, "status", r)).toBe(true);
    expect(r.calls).toHaveLength(1);
    const md = r.calls[0]!;
    expect(md).toContain("## AI Runtime Status");
    expect(md).toContain("### Connection");
    expect(md).toContain("Ollama");
    expect(md).toContain("Connected");
    expect(md).toContain("Version:** 0.1.40");
    expect(md).toContain("### Model");
    expect(md).toContain("Active Model:** llama3:8b");
    expect(md).toContain("8.0K tokens");
    expect(md).toContain("Temperature:** 0.7");
    expect(md).toContain("Max Tokens:** 4096");
    expect(md).toContain("### Retrieval");
    expect(md).toContain("RAG:** ✅ Available");
    expect(md).toContain("Indexing:** ✅ Idle");
    expect(md).toContain("Indexed Files:** 42");
    expect(md).toContain("### Agent");
    expect(md).toContain("Max Iterations:** 5");
  });

  it("disconnected provider path: emits Disconnected + error line", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "unknown",
      checkProviderStatus: vi.fn().mockResolvedValue({ available: false, error: "ECONNREFUSED" }),
    };
    await tryHandleOpenclawStatusCommand(services, "status", r);
    expect(r.calls[0]).toContain("Disconnected");
    expect(r.calls[0]).toContain("Error:** ECONNREFUSED");
  });

  it("no checkProviderStatus delegate → fallback connection line", async () => {
    const r = makeResponse();
    await tryHandleOpenclawStatusCommand({} as any, "status", r);
    expect(r.calls[0]).toContain("(status check unavailable)");
  });

  it("checkProviderStatus rejection is swallowed and treated as unavailable", async () => {
    const r = makeResponse();
    const services: any = {
      checkProviderStatus: vi.fn().mockRejectedValue(new Error("boom")),
    };
    await tryHandleOpenclawStatusCommand(services, "status", r);
    // Catch returns { available: false, error: 'Check failed' }
    expect(r.calls[0]).toContain("Disconnected");
    expect(r.calls[0]).toContain("Check failed");
  });
});

// ── /models ──────────────────────────────────────────────────────────────────

describe("tryHandleOpenclawModelsCommand", () => {
  it("returns false for non-'models' command without side effects", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawModelsCommand({} as any, "status", r)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it("happy path with listModels: emits 4-column table marking active model", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      listModels: vi.fn().mockResolvedValue([
        { id: "llama3:8b", name: "llama3:8b", parameterSize: "8B", quantization: "Q4_K_M", contextLength: 8192 },
        { id: "qwen2:7b", name: "qwen2:7b", parameterSize: "7B", quantization: "Q4", contextLength: 32768 },
      ]),
    };
    expect(await tryHandleOpenclawModelsCommand(services, "models", r)).toBe(true);
    const md = r.calls[0]!;
    expect(md).toContain("## Available Models");
    expect(md).toContain("**Active:** llama3:8b");
    expect(md).toContain("| Model | Size | Quantization | Context |");
    expect(md).toContain("llama3:8b **←**");
    expect(md).toContain("qwen2:7b");
    expect(md).toContain("8B");
    expect(md).toContain("Q4_K_M");
    expect(md).toContain("8K");
    expect(md).toContain("32K");
    expect(md).toContain("*2 model(s) available*");
  });

  it("listModels resolves empty → 'No models found' message", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "unknown",
      listModels: vi.fn().mockResolvedValue([]),
    };
    expect(await tryHandleOpenclawModelsCommand(services, "models", r)).toBe(true);
    expect(r.calls[0]).toContain("No models found");
  });

  it("no listModels: falls back to getAvailableModelIds and emits 1-column table", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      getAvailableModelIds: vi.fn().mockResolvedValue(["llama3:8b", "qwen2:7b"]),
    };
    await tryHandleOpenclawModelsCommand(services, "models", r);
    const md = r.calls[0]!;
    expect(md).toContain("## Available Models");
    expect(md).toContain("**Active:** llama3:8b");
    expect(md).toContain("| Model |");
    expect(md).toContain("llama3:8b ← active");
    expect(md).toContain("qwen2:7b");
    // No size/context columns in fallback
    expect(md).not.toContain("Size");
  });

  it("no listModels AND no model ids: emits doctor-hint message", async () => {
    const r = makeResponse();
    await tryHandleOpenclawModelsCommand({} as any, "models", r);
    expect(r.calls[0]).toContain("No models available");
    expect(r.calls[0]).toContain("/doctor");
  });
});

// ── /tools ───────────────────────────────────────────────────────────────────

describe("tryHandleOpenclawToolsCommand", () => {
  it("returns false for non-'tools' command without side effects", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawToolsCommand({} as any, "status", r)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it("empty tool registry: emits 'No tools registered.'", async () => {
    const r = makeResponse();
    const services: any = {
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      getActiveModel: () => "llama3:8b",
    };
    expect(await tryHandleOpenclawToolsCommand(services, "tools", r)).toBe(true);
    expect(r.calls[0]).toContain("No tools registered.");
  });

  it("happy path: emits Tool-Calling + Read-Only + Skills sections with permission icons + capability total", async () => {
    const r = makeResponse();
    const services: any = {
      getToolDefinitions: () => [
        { name: "writeFile", description: "Write a file to disk" },
        { name: "deleteFile", description: "Delete a file" },
      ],
      getReadOnlyToolDefinitions: () => [
        { name: "readFile", description: "Read a file" },
      ],
      getToolPermissions: () => ({
        writeFile: "always-allowed",
        deleteFile: "never-allowed",
      }),
      getActiveModel: () => "llama3:8b",
      getSkillCatalog: () => [{ name: "summarize", description: "Summarize text" }],
    };
    await tryHandleOpenclawToolsCommand(services, "tools", r);
    const md = r.calls[0]!;
    expect(md).toContain("## Available Tools");
    expect(md).toContain("**Mode:** agent");
    expect(md).toContain("### Tool-Calling Tools");
    expect(md).toContain("writeFile");
    expect(md).toContain("✅ always-allowed");
    expect(md).toContain("🚫 never-allowed");
    expect(md).toContain("### Read-Only Tools");
    expect(md).toContain("readFile");
    expect(md).toContain("### Skills");
    expect(md).toContain("summarize");
    expect(md).toContain("*4 total capabilities registered*"); // 2 + 1 + 1
  });

  it("default permission renders as '🔒 default' when permission map missing entry", async () => {
    const r = makeResponse();
    const services: any = {
      getToolDefinitions: () => [{ name: "writeFile", description: "Write" }],
      getReadOnlyToolDefinitions: () => [],
      getActiveModel: () => "llama3:8b",
    };
    await tryHandleOpenclawToolsCommand(services, "tools", r);
    expect(r.calls[0]).toContain("🔒 default");
  });

  it("mode override defaults to 'agent' when omitted", async () => {
    const r = makeResponse();
    const services: any = {
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      getActiveModel: () => "llama3:8b",
    };
    await tryHandleOpenclawToolsCommand(services, "tools", r);
    expect(r.calls[0]).toContain("**Mode:** agent");

    const r2 = makeResponse();
    await tryHandleOpenclawToolsCommand(services, "tools", r2, "ask");
    expect(r2.calls[0]).toContain("**Mode:** ask");
  });
});
