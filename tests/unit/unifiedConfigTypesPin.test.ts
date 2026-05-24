/**
 * Pin: unifiedConfigTypes — AGENT_*_OPTIONS literal tuples,
 * HEARTBEAT_REASON_OPTIONS, DEFAULT_UNIFIED_CONFIG canonical defaults,
 * and the three migration helpers (fromLegacyProfile, fromLegacyParallxConfig,
 * tolegacyProfile). These are the source-of-truth shapes the AI Settings UI
 * binds to — any drift will break the unified config surface.
 */
import { describe, it, expect } from "vitest";
import {
  AGENT_VERBOSITY_OPTIONS,
  AGENT_APPROVAL_STRICTNESS_OPTIONS,
  AGENT_EXECUTION_STYLE_OPTIONS,
  AGENT_PROACTIVITY_OPTIONS,
  HEARTBEAT_REASON_OPTIONS,
  DEFAULT_UNIFIED_CONFIG,
  fromLegacyProfile,
  fromLegacyParallxConfig,
  tolegacyProfile,
} from "../../src/aiSettings/unifiedConfigTypes";

describe("aiSettings/unifiedConfigTypes — OPTIONS tuples", () => {
  it("AGENT_VERBOSITY_OPTIONS = ['concise','balanced','detailed']", () => {
    expect([...AGENT_VERBOSITY_OPTIONS]).toEqual(["concise", "balanced", "detailed"]);
  });
  it("AGENT_APPROVAL_STRICTNESS_OPTIONS = ['strict','balanced','streamlined']", () => {
    expect([...AGENT_APPROVAL_STRICTNESS_OPTIONS]).toEqual(["strict", "balanced", "streamlined"]);
  });
  it("AGENT_EXECUTION_STYLE_OPTIONS = ['stepwise','balanced','batch']", () => {
    expect([...AGENT_EXECUTION_STYLE_OPTIONS]).toEqual(["stepwise", "balanced", "batch"]);
  });
  it("AGENT_PROACTIVITY_OPTIONS = ['low','balanced','high']", () => {
    expect([...AGENT_PROACTIVITY_OPTIONS]).toEqual(["low", "balanced", "high"]);
  });
  it("HEARTBEAT_REASON_OPTIONS = ['interval','system-event','cron','wake','hook']", () => {
    expect([...HEARTBEAT_REASON_OPTIONS]).toEqual(["interval", "system-event", "cron", "wake", "hook"]);
  });
});

describe("aiSettings/unifiedConfigTypes — DEFAULT_UNIFIED_CONFIG", () => {
  it("persona defaults: 'Parallx AI', description, avatarEmoji='avatar-brain'", () => {
    expect(DEFAULT_UNIFIED_CONFIG.persona).toEqual({
      name: "Parallx AI",
      description: "Your intelligent workspace assistant",
      avatarEmoji: "avatar-brain",
    });
  });

  it("chat defaults: empty systemPrompt, systemPromptIsCustom=false, responseLength='adaptive'", () => {
    expect(DEFAULT_UNIFIED_CONFIG.chat).toEqual({
      systemPrompt: "",
      systemPromptIsCustom: false,
      responseLength: "adaptive",
    });
  });

  it("model defaults: chatModel='', embeddingModel='nomic-embed-text', temp=0.7, maxTokens=0, contextWindow=0", () => {
    expect(DEFAULT_UNIFIED_CONFIG.model).toEqual({
      chatModel: "",
      embeddingModel: "nomic-embed-text",
      temperature: 0.7,
      maxTokens: 0,
      contextWindow: 0,
    });
  });

  it("retrieval defaults: autoRag=true, ragTopK=20, ragScoreThreshold=0.01, contextBudget {3,2,1,4}/{5,0,0,0}", () => {
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.autoRag).toBe(true);
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragTopK).toBe(20);
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.ragScoreThreshold).toBe(0.01);
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.contextBudget.trimPriority).toEqual({
      systemPrompt: 3, ragContext: 2, history: 1, userMessage: 4,
    });
    expect(DEFAULT_UNIFIED_CONFIG.retrieval.contextBudget.minPercent).toEqual({
      systemPrompt: 5, ragContext: 0, history: 0, userMessage: 0,
    });
  });

  it("suggestions defaults: tone='balanced', focusDomain='general', confidenceThreshold=0.65, enabled=true, maxPending=5", () => {
    expect(DEFAULT_UNIFIED_CONFIG.suggestions).toEqual({
      tone: "balanced",
      focusDomain: "general",
      customFocusDescription: "",
      suggestionConfidenceThreshold: 0.65,
      suggestionsEnabled: true,
      maxPendingSuggestions: 5,
    });
  });

  it("agent defaults: maxIterations=25, all four levers='balanced', empty agentDefinitions", () => {
    expect(DEFAULT_UNIFIED_CONFIG.agent).toEqual({
      maxIterations: 25,
      verbosity: "balanced",
      approvalStrictness: "balanced",
      executionStyle: "balanced",
      proactivity: "balanced",
      agentDefinitions: [],
    });
  });

  it("runtime defaults: implementation='openclaw'", () => {
    expect(DEFAULT_UNIFIED_CONFIG.runtime).toEqual({ implementation: "openclaw" });
  });

  it("memory defaults: memoryEnabled=true, autoSummarize=true, transcriptIndexingEnabled=false, evictionDays=90", () => {
    expect(DEFAULT_UNIFIED_CONFIG.memory).toEqual({
      memoryEnabled: true,
      autoSummarize: true,
      transcriptIndexingEnabled: false,
      evictionDays: 90,
    });
  });

  it("indexing defaults: autoIndex=true, watchFiles=true, maxFileSize=262144 (256 KB), empty excludePatterns", () => {
    expect(DEFAULT_UNIFIED_CONFIG.indexing).toEqual({
      autoIndex: true,
      watchFiles: true,
      maxFileSize: 262144,
      excludePatterns: [],
    });
  });

  it("tools defaults: empty enabledOverrides, workbenchControlEnabled=false (M70 opt-in)", () => {
    expect(DEFAULT_UNIFIED_CONFIG.tools).toEqual({
      enabledOverrides: {},
      workbenchControlEnabled: false,
    });
  });

  it("heartbeat defaults: enabled=false (M58 W2 opt-in), interval=5min, all 5 reasons, coalesce=2s, dedup=24h, autonomy='allow-safe-actions'", () => {
    const h = DEFAULT_UNIFIED_CONFIG.heartbeat;
    expect(h.enabled).toBe(false);
    expect(h.intervalMs).toBe(5 * 60 * 1000);
    expect([...h.reasons]).toEqual(["interval", "system-event", "cron", "wake", "hook"]);
    expect(h.coalesceWindowMs).toBe(2000);
    expect(h.outputDedupWindowMs).toBe(24 * 60 * 60 * 1000);
    expect(h.autonomy).toBe("allow-safe-actions");
  });

  it("heartbeat watchIncludeExtensions covers source + text + config extensions", () => {
    const ext = DEFAULT_UNIFIED_CONFIG.heartbeat.watchIncludeExtensions;
    for (const e of [".ts", ".tsx", ".js", ".py", ".rs", ".go", ".md", ".json", ".yaml", ".html", ".css"]) {
      expect(ext, e).toContain(e);
    }
  });

  it("heartbeat watchExcludeGlobs covers common ignore directories + log files", () => {
    const exc = DEFAULT_UNIFIED_CONFIG.heartbeat.watchExcludeGlobs;
    for (const g of [
      "**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**",
      "**/out/**", "**/.next/**", "**/target/**", "**/*.log",
    ]) {
      expect(exc, g).toContain(g);
    }
  });
});

describe("aiSettings/unifiedConfigTypes — migration helpers", () => {
  const legacyProfile: any = {
    id: "p1",
    presetName: "Custom",
    isBuiltIn: false,
    createdAt: "2024-01-01",
    updatedAt: "2024-02-02",
    persona: { name: "P", description: "D", avatarEmoji: "avatar-brain" },
    chat: { systemPrompt: "Hi", systemPromptIsCustom: true, responseLength: "balanced" },
    model: { defaultModel: "qwen", temperature: 0.5, maxTokens: 1024, contextWindow: 2048 },
    suggestions: {
      tone: "warm", focusDomain: "writing", customFocusDescription: "x",
      suggestionConfidenceThreshold: 0.5, suggestionsEnabled: false, maxPendingSuggestions: 3,
    },
  };

  it("fromLegacyProfile copies known fields and fills the rest from defaults; arrays are fresh copies", () => {
    const r = fromLegacyProfile(legacyProfile);
    expect(r.id).toBe("p1");
    expect(r.config.persona).toEqual(legacyProfile.persona);
    expect(r.config.chat).toEqual(legacyProfile.chat);
    expect(r.config.model).toEqual({
      chatModel: "qwen",
      embeddingModel: DEFAULT_UNIFIED_CONFIG.model.embeddingModel,
      temperature: 0.5,
      maxTokens: 1024,
      contextWindow: 2048,
    });
    expect(r.config.agent).toEqual(DEFAULT_UNIFIED_CONFIG.agent);
    expect(r.config.runtime).toEqual(DEFAULT_UNIFIED_CONFIG.runtime);
    expect(r.config.heartbeat.reasons).not.toBe(DEFAULT_UNIFIED_CONFIG.heartbeat.reasons);
    expect(r.config.heartbeat.watchIncludeExtensions).not.toBe(DEFAULT_UNIFIED_CONFIG.heartbeat.watchIncludeExtensions);
    expect(r.config.heartbeat.watchExcludeGlobs).not.toBe(DEFAULT_UNIFIED_CONFIG.heartbeat.watchExcludeGlobs);
  });

  it("fromLegacyParallxConfig returns a sparse override; omits contextWindow when contextLength is null", () => {
    const cfg: any = {
      model: { chat: "m", embedding: "e", contextLength: null },
      agent: { maxIterations: 7, autoRag: false, ragTopK: 4, ragScoreThreshold: 0.2 },
      indexing: { autoIndex: false, watchFiles: false, maxFileSize: 1024, excludePatterns: ["a"] },
    };
    const r: any = fromLegacyParallxConfig(cfg);
    expect(r.model).toEqual({ chatModel: "m", embeddingModel: "e" });
    expect(r.retrieval.autoRag).toBe(false);
    expect(r.retrieval.ragTopK).toBe(4);
    expect(r.agent.maxIterations).toBe(7);
    expect(r.indexing).toEqual({
      autoIndex: false, watchFiles: false, maxFileSize: 1024, excludePatterns: ["a"],
    });
    expect(r.indexing.excludePatterns).not.toBe(cfg.indexing.excludePatterns);
  });

  it("fromLegacyParallxConfig includes contextWindow when contextLength is set", () => {
    const cfg: any = {
      model: { chat: "m", embedding: "e", contextLength: 8192 },
      agent: { maxIterations: 1, autoRag: true, ragTopK: 1, ragScoreThreshold: 0 },
      indexing: { autoIndex: true, watchFiles: true, maxFileSize: 0, excludePatterns: [] },
    };
    const r: any = fromLegacyParallxConfig(cfg);
    expect(r.model.contextWindow).toBe(8192);
  });

  it("tolegacyProfile flattens unified preset back; defaultModel = preset.model.chatModel", () => {
    const preset: any = {
      id: "p2", presetName: "N", isBuiltIn: true, createdAt: "a", updatedAt: "b",
      config: {
        persona: { name: "P", description: "D", avatarEmoji: "avatar-brain" },
        chat: { systemPrompt: "x", systemPromptIsCustom: false, responseLength: "adaptive" },
        model: { chatModel: "qwen", embeddingModel: "e", temperature: 0.3, maxTokens: 0, contextWindow: 0 },
        suggestions: { tone: "balanced", focusDomain: "general", customFocusDescription: "", suggestionConfidenceThreshold: 0.5, suggestionsEnabled: true, maxPendingSuggestions: 5 },
      },
    };
    const r = tolegacyProfile(preset);
    expect(r.id).toBe("p2");
    expect(r.model.defaultModel).toBe("qwen");
    expect(r.model.temperature).toBe(0.3);
    expect(r.persona).toEqual(preset.config.persona);
    expect(r.chat).toEqual(preset.config.chat);
  });
});
