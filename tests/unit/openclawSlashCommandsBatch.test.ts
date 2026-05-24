import { describe, it, expect, vi } from "vitest";
import { tryHandleOpenclawStatusCommand } from "../../src/openclaw/commands/openclawStatusCommand";
import { tryHandleOpenclawModelsCommand } from "../../src/openclaw/commands/openclawModelsCommand";
import { tryHandleOpenclawUsageCommand } from "../../src/openclaw/commands/openclawUsageCommand";
import { tryHandleOpenclawDoctorCommand } from "../../src/openclaw/commands/openclawDoctorCommand";
import { tryHandleOpenclawToolsCommand } from "../../src/openclaw/commands/openclawToolsCommand";

function makeResponse() {
  const calls: string[] = [];
  const progressCalls: string[] = [];
  return {
    response: {
      markdown: (s: string) => calls.push(s),
      progress: (s: string) => progressCalls.push(s),
    } as any,
    calls,
    progressCalls,
  };
}

describe("tryHandleOpenclawStatusCommand", () => {
  it("returns false for non-'status' commands", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawStatusCommand({} as any, "x", r.response)).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it("renders connection ✅ + active model + context window + temperature when fully wired", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3",
      getModelContextLength: () => 8192,
      isRAGAvailable: () => true,
      isIndexing: () => false,
      checkProviderStatus: async () => ({ available: true, version: "0.1.0" }),
      unifiedConfigService: { getEffectiveConfig: () => ({ model: { temperature: 0.5, maxTokens: 1024 }, agent: { maxIterations: 5 } }) },
      getFileCount: async () => 42,
    };
    const handled = await tryHandleOpenclawStatusCommand(services, "status", r.response);
    expect(handled).toBe(true);
    const md = r.calls[0];
    expect(md).toContain("AI Runtime Status");
    expect(md).toContain("✅ Connected");
    expect(md).toContain("llama3");
    expect(md).toContain("8.0K tokens");
    expect(md).toContain("Temperature:** 0.5");
    expect(md).toContain("Max Tokens:** 1024");
    expect(md).toContain("RAG:** ✅ Available");
    expect(md).toContain("Indexed Files:** 42");
    expect(md).toContain("Max Iterations:** 5");
  });

  it("renders disconnected branch when checkProviderStatus reports unavailable", async () => {
    const r = makeResponse();
    const services: any = {
      checkProviderStatus: async () => ({ available: false, error: "boom" }),
    };
    await tryHandleOpenclawStatusCommand(services, "status", r.response);
    expect(r.calls[0]).toContain("❌ Disconnected");
    expect(r.calls[0]).toContain("boom");
  });
});

describe("tryHandleOpenclawModelsCommand", () => {
  it("returns false for non-'models' commands", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawModelsCommand({} as any, "x", r.response)).toBe(false);
  });

  it("renders table with active marker when listModels returns rows", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3",
      listModels: async () => [
        { id: "llama3", name: "llama3", parameterSize: "7B", quantization: "Q4_0", contextLength: 8192 },
        { id: "phi", name: "phi", parameterSize: "3B", quantization: "Q5", contextLength: 4096 },
      ],
    };
    await tryHandleOpenclawModelsCommand(services, "models", r.response);
    const md = r.calls[0];
    expect(md).toContain("Available Models");
    expect(md).toContain("Active:** llama3");
    expect(md).toContain("llama3 **←**");
    expect(md).toContain("8K");
    expect(md).toContain("2 model(s) available");
  });

  it("falls back to getAvailableModelIds when listModels is missing", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3",
      getAvailableModelIds: async () => ["llama3", "phi"],
    };
    await tryHandleOpenclawModelsCommand(services, "models", r.response);
    expect(r.calls[0]).toContain("← active");
    expect(r.calls[0]).toContain("phi");
  });

  it("instructs running /doctor when nothing is available at all", async () => {
    const r = makeResponse();
    const services: any = { getActiveModel: () => "llama3" };
    await tryHandleOpenclawModelsCommand(services, "models", r.response);
    expect(r.calls[0]).toContain("/doctor");
  });

  it("renders 'No models found' when listModels resolves empty", async () => {
    const r = makeResponse();
    const services: any = { listModels: async () => [] };
    await tryHandleOpenclawModelsCommand(services, "models", r.response);
    expect(r.calls[0]).toContain("No models found");
  });
});

describe("tryHandleOpenclawUsageCommand", () => {
  it("returns false for non-'usage' commands", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawUsageCommand({} as any, "x", {} as any, r.response)).toBe(false);
  });

  it("aggregates prompt/completion tokens from chat history and reports turn count", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3",
      getModelContextLength: () => 8192,
    };
    const context: any = {
      history: [
        { response: { promptTokens: 100, completionTokens: 50 } },
        { response: { promptTokens: 200, completionTokens: 80 } },
        { response: null }, // ignored
      ],
    };
    await tryHandleOpenclawUsageCommand(services, "usage", context, r.response);
    const md = r.calls[0];
    expect(md).toContain("Turns | 2");
    expect(md).toContain("Prompt Tokens | 300");
    expect(md).toContain("Completion Tokens | 130");
    expect(md).toContain("**430**");
  });

  it("uses observabilityService data when available", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3",
      getModelContextLength: () => 8192,
      observabilityService: {
        getSessionMetrics: () => ({
          turnCount: 3,
          totalPromptTokens: 100,
          totalCompletionTokens: 200,
          totalTokens: 300,
          totalDurationMs: 1500,
          avgDurationMs: 500,
          avgPromptTokens: 33,
          avgCompletionTokens: 66,
        }),
        getModelMetrics: () => [],
      },
    };
    await tryHandleOpenclawUsageCommand(services, "usage", { history: [] } as any, r.response);
    const md = r.calls[0];
    expect(md).toContain("Turns | 3");
    expect(md).toContain("**300**");
    expect(md).toContain("1.5s");
  });

  it("notes 'No turns completed' when history is empty", async () => {
    const r = makeResponse();
    await tryHandleOpenclawUsageCommand({} as any, "usage", { history: [] } as any, r.response);
    expect(r.calls[0]).toContain("No turns completed yet");
  });
});

describe("tryHandleOpenclawDoctorCommand", () => {
  it("returns false for non-'doctor' commands", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawDoctorCommand({} as any, "x", r.response)).toBe(false);
  });

  it("emits progress + delegates to diagnosticsService when available", async () => {
    const r = makeResponse();
    const services: any = {
      diagnosticsService: {
        runChecks: vi.fn().mockResolvedValue([
          { name: "A", status: "pass", detail: "ok", timestamp: 0, category: "x" },
          { name: "B", status: "fail", detail: "boom", timestamp: 0, category: "y" },
        ]),
      },
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r.response);
    expect(r.progressCalls[0]).toContain("Running diagnostics");
    expect(services.diagnosticsService.runChecks).toHaveBeenCalled();
    const md = r.calls[0];
    expect(md).toContain("Diagnostic Report");
    expect(md).toContain("**1** pass, **1** fail");
    expect(md).toContain("Recommended Actions");
  });

  it("runs inline fallback checks when diagnosticsService is missing", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3",
      getWorkspaceName: () => "ws1",
      checkProviderStatus: async () => ({ available: true }),
      isRAGAvailable: () => false,
      getFileCount: async () => 0,
      getModelContextLength: () => 0,
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r.response);
    const md = r.calls[0];
    expect(md).toContain("Ollama Connection");
    expect(md).toContain("Active Model");
    expect(md).toContain("Workspace");
  });
});

describe("tryHandleOpenclawToolsCommand", () => {
  it("returns false for non-'tools' commands", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawToolsCommand({} as any, "x", r.response)).toBe(false);
  });

  it("renders 'No tools registered' when both lists are empty", async () => {
    const r = makeResponse();
    const services: any = {
      getToolDefinitions: () => [],
      getReadOnlyToolDefinitions: () => [],
      getActiveModel: () => "llama3",
    };
    await tryHandleOpenclawToolsCommand(services, "tools", r.response);
    expect(r.calls[0]).toContain("No tools registered");
  });

  it("renders both sections with permission icons + skills + capability count", async () => {
    const r = makeResponse();
    const services: any = {
      getToolDefinitions: () => [
        { name: "edit", description: "Edit a file" },
        { name: "shell", description: "Run shell" },
      ],
      getReadOnlyToolDefinitions: () => [{ name: "read", description: "Read a file" }],
      getToolPermissions: () => ({ edit: "always-allowed", shell: "never-allowed" }),
      getActiveModel: () => "llama3",
      getSkillCatalog: () => [{ name: "skill-a", description: "Do thing" }],
    };
    await tryHandleOpenclawToolsCommand(services, "tools", r.response, "agent");
    const md = r.calls[0];
    expect(md).toContain("Tool-Calling Tools");
    expect(md).toContain("✅ always-allowed");
    expect(md).toContain("🚫 never-allowed");
    expect(md).toContain("Read-Only Tools");
    expect(md).toContain("skill-a");
    expect(md).toContain("4 total capabilities");
    expect(md).toContain("Mode:** agent");
  });
});
