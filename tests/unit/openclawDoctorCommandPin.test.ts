/**
 * Pin: tryHandleOpenclawDoctorCommand — /doctor slash-command handler.
 * Two paths: delegate to diagnosticsService when available, or inline
 * checks fallback (pre-D3).  Locks the command gate, both render paths,
 * the status-icon roll-up, the diagnostics-table shape, and the
 * recommended-actions section.
 */
import { describe, it, expect, vi } from "vitest";
import { tryHandleOpenclawDoctorCommand } from "../../src/openclaw/commands/openclawDoctorCommand";

function makeResponse() {
  const progressCalls: string[] = [];
  const calls: string[] = [];
  return {
    progressCalls,
    calls,
    progress(text: string) { progressCalls.push(text); },
    markdown(text: string) { calls.push(text); },
  } as any;
}

describe("tryHandleOpenclawDoctorCommand", () => {
  it("returns false for non-'doctor' command without progress or markdown", async () => {
    const r = makeResponse();
    expect(await tryHandleOpenclawDoctorCommand({} as any, "status", r)).toBe(false);
    expect(r.progressCalls).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it("emits 'Running diagnostics...' progress before any rendering", async () => {
    const r = makeResponse();
    const services: any = {
      diagnosticsService: { runChecks: vi.fn().mockResolvedValue([]) },
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    expect(r.progressCalls).toEqual(["Running diagnostics..."]);
  });

  it("diagnosticsService path: delegates and renders pass-only report with green check rollup", async () => {
    const r = makeResponse();
    const services: any = {
      diagnosticsService: {
        runChecks: vi.fn().mockResolvedValue([
          { name: "Ollama", status: "pass", detail: "Connected", timestamp: 0, category: "connection" },
          { name: "Model", status: "pass", detail: "llama3:8b ready", timestamp: 0, category: "model" },
        ]),
      },
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    expect(services.diagnosticsService.runChecks).toHaveBeenCalled();
    const md = r.calls[0]!;
    expect(md).toContain("## Diagnostic Report");
    expect(md).toContain("✅ **2** pass, **0** fail, **0** warn");
    expect(md).toContain("| Check | Status | Detail |");
    expect(md).toContain("| Ollama | ✅ | Connected |");
    expect(md).toContain("| Model | ✅ | llama3:8b ready |");
    expect(md).not.toContain("### Recommended Actions");
  });

  it("fail rollup uses red-x icon and emits Recommended Actions section listing only failures", async () => {
    const r = makeResponse();
    const services: any = {
      diagnosticsService: {
        runChecks: vi.fn().mockResolvedValue([
          { name: "Ollama", status: "fail", detail: "ECONNREFUSED", timestamp: 0, category: "connection" },
          { name: "RAG", status: "warn", detail: "Indexing", timestamp: 0, category: "rag" },
          { name: "Model", status: "pass", detail: "OK", timestamp: 0, category: "model" },
        ]),
      },
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    const md = r.calls[0]!;
    expect(md).toContain("❌ **1** pass, **1** fail, **1** warn");
    expect(md).toContain("| Ollama | ❌ | ECONNREFUSED |");
    expect(md).toContain("| RAG | ⚠️ | Indexing |");
    expect(md).toContain("### Recommended Actions");
    expect(md).toContain("- **Ollama:** ECONNREFUSED");
    // Pass/warn entries are NOT in the recommended actions list
    expect(md).not.toContain("- **RAG:**");
    expect(md).not.toContain("- **Model:**");
  });

  it("warn-only rollup uses warning icon and omits Recommended Actions", async () => {
    const r = makeResponse();
    const services: any = {
      diagnosticsService: {
        runChecks: vi.fn().mockResolvedValue([
          { name: "RAG", status: "warn", detail: "Indexing", timestamp: 0, category: "rag" },
        ]),
      },
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    const md = r.calls[0]!;
    expect(md).toContain("⚠️ **0** pass, **0** fail, **1** warn");
    expect(md).not.toContain("### Recommended Actions");
  });

  it("inline fallback: runs Ollama Connection, Active Model, RAG, Workspace, Context Window, Configuration checks", async () => {
    const r = makeResponse();
    const services: any = {
      checkProviderStatus: vi.fn().mockResolvedValue({ available: true, version: "0.1.40" }),
      getActiveModel: () => "llama3:8b",
      listModels: vi.fn().mockResolvedValue([{ id: "llama3:8b", name: "llama3:8b" }]),
      isRAGAvailable: () => true,
      isIndexing: () => false,
      getFileCount: vi.fn().mockResolvedValue(42),
      getWorkspaceName: () => "my-workspace",
      getModelContextLength: () => 8192,
      unifiedConfigService: { getEffectiveConfig: () => ({}) },
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    const md = r.calls[0]!;
    expect(md).toContain("| Ollama Connection | ✅ | Connected (v0.1.40) |");
    expect(md).toContain("| Active Model | ✅ | llama3:8b |");
    expect(md).toContain("| Model Available | ✅ | llama3:8b is installed |");
    expect(md).toContain("| RAG Engine | ✅ | Available and idle |");
    expect(md).toContain("| File Index | ✅ | 42 files indexed |");
    expect(md).toContain("| Workspace | ✅ | Workspace: my-workspace |");
    expect(md).toContain("| Context Window | ✅ | 8K tokens |");
    expect(md).toContain("| Configuration | ✅ | Unified config loaded |");
  });

  it("inline fallback: provider disconnected → Ollama Connection fail with error detail", async () => {
    const r = makeResponse();
    const services: any = {
      checkProviderStatus: vi.fn().mockResolvedValue({ available: false, error: "ECONNREFUSED" }),
      getActiveModel: () => undefined,
      isRAGAvailable: () => false,
      isIndexing: () => false,
      getFileCount: vi.fn().mockResolvedValue(0),
      getWorkspaceName: () => "",
      getModelContextLength: () => 0,
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    const md = r.calls[0]!;
    expect(md).toContain("| Ollama Connection | ❌ | ECONNREFUSED |");
    expect(md).toContain("| Active Model | ❌ | No model selected |");
    expect(md).toContain("| RAG Engine | ⚠️ | Not available — workspace retrieval will be limited |");
    expect(md).toContain("| File Index | ⚠️ | No files indexed yet |");
    expect(md).toContain("| Workspace | ⚠️ | No workspace open |");
    expect(md).toContain("| Context Window | ⚠️ | Unknown (model info unavailable) |");
    expect(md).toContain("| Configuration | ⚠️ | Using defaults |");
  });

  it("inline fallback: checkProviderStatus rejection rendered as 'Check failed'", async () => {
    const r = makeResponse();
    const services: any = {
      checkProviderStatus: vi.fn().mockRejectedValue(new Error("network")),
      getActiveModel: () => "llama3:8b",
      getWorkspaceName: () => "ws",
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    expect(r.calls[0]).toContain("| Ollama Connection | ❌ | Check failed |");
  });

  it("inline fallback: AGENTS.md presence check appended when existsRelative provided", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      getWorkspaceName: () => "ws",
      existsRelative: vi.fn().mockResolvedValue(true),
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    expect(services.existsRelative).toHaveBeenCalledWith(".parallx/AGENTS.md");
    expect(r.calls[0]).toContain("| Bootstrap (AGENTS.md) | ✅ | Found |");
  });

  it("inline fallback: AGENTS.md missing → warn with /init hint", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      getWorkspaceName: () => "ws",
      existsRelative: vi.fn().mockResolvedValue(false),
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    expect(r.calls[0]).toContain("| Bootstrap (AGENTS.md) | ⚠️ | Missing — run /init to generate |");
  });

  it("inline fallback: Model Available missing → fail with ollama pull hint", async () => {
    const r = makeResponse();
    const services: any = {
      getActiveModel: () => "llama3:8b",
      listModels: vi.fn().mockResolvedValue([{ id: "qwen2:7b", name: "qwen2:7b" }]),
      getWorkspaceName: () => "ws",
    };
    await tryHandleOpenclawDoctorCommand(services, "doctor", r);
    expect(r.calls[0]).toContain("| Model Available | ❌ | llama3:8b not found (run: ollama pull llama3:8b) |");
  });
});
