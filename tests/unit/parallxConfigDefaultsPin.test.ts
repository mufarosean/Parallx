/**
 * Pin: parallxConfigService DEFAULT_* constants + mergeConfig — accepts
 * known sections, applies per-key type validation, allows null only where
 * default is null (or default is non-object), filters non-string array
 * entries, silently ignores unknown sections/keys, returns canonical
 * IParallxConfig shape.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_CONTEXT_BUDGET,
  DEFAULT_PERMISSIONS,
  DEFAULT_INDEXING,
  DEFAULT_CONFIG,
  mergeConfig,
} from "../../src/services/parallxConfigService";

describe("services/parallxConfigService — DEFAULT_* constants", () => {
  it("DEFAULT_MODEL_CONFIG pins chat/embedding/contextLength=null", () => {
    expect(DEFAULT_MODEL_CONFIG).toEqual({
      chat: "qwen2.5:32b-instruct",
      embedding: "nomic-embed-text",
      contextLength: null,
    });
  });

  it("DEFAULT_AGENT_CONFIG pins maxIterations=10, autoRag=true, ragTopK=10, ragScoreThreshold=0.3", () => {
    expect(DEFAULT_AGENT_CONFIG).toEqual({
      maxIterations: 10,
      autoRag: true,
      ragTopK: 10,
      ragScoreThreshold: 0.3,
    });
  });

  it("DEFAULT_CONTEXT_BUDGET pins systemPrompt=10, ragContext=30, history=30, userMessage=30", () => {
    expect(DEFAULT_CONTEXT_BUDGET).toEqual({
      systemPrompt: 10,
      ragContext: 30,
      history: 30,
      userMessage: 30,
    });
  });

  it("DEFAULT_PERMISSIONS pins every action to 'ask-every-time'", () => {
    expect(DEFAULT_PERMISSIONS).toEqual({
      fileWrite: "ask-every-time",
      fileDelete: "ask-every-time",
      terminalCommand: "ask-every-time",
    });
  });

  it("DEFAULT_INDEXING pins autoIndex=true, watchFiles=true, maxFileSize=262144, excludePatterns=[]", () => {
    expect(DEFAULT_INDEXING).toEqual({
      autoIndex: true,
      watchFiles: true,
      maxFileSize: 262144,
      excludePatterns: [],
    });
  });

  it("DEFAULT_CONFIG composes all section defaults", () => {
    expect(DEFAULT_CONFIG).toEqual({
      model: DEFAULT_MODEL_CONFIG,
      agent: DEFAULT_AGENT_CONFIG,
      contextBudget: DEFAULT_CONTEXT_BUDGET,
      permissions: DEFAULT_PERMISSIONS,
      indexing: DEFAULT_INDEXING,
    });
  });
});

describe("services/parallxConfigService — mergeConfig", () => {
  it("returns canonical DEFAULT_CONFIG-shaped object when partial is empty", () => {
    expect(mergeConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it("ignores unknown top-level sections silently", () => {
    expect(mergeConfig({ pancakes: { syrup: true } } as any)).toEqual(DEFAULT_CONFIG);
  });

  it("ignores unknown keys within a known section", () => {
    const r = mergeConfig({ model: { chat: "llama3", bogusKey: "x" } });
    expect(r.model.chat).toBe("llama3");
    expect((r.model as any).bogusKey).toBeUndefined();
  });

  it("rejects override of wrong type (string for number); falls back to default", () => {
    const r = mergeConfig({ agent: { maxIterations: "lots" as any } });
    expect(r.agent.maxIterations).toBe(10);
  });

  it("rejects array override; falls back to default", () => {
    expect(mergeConfig({ model: [] as any }).model).toEqual(DEFAULT_MODEL_CONFIG);
  });

  it("accepts null for model.contextLength (default is null) AND for any non-object default", () => {
    const r = mergeConfig({ model: { contextLength: null } });
    expect(r.model.contextLength).toBe(null);
    // chat default is a string — null is allowed for non-object scalars per impl
    const r2 = mergeConfig({ model: { chat: null as any } });
    expect(r2.model.chat).toBe(null);
  });

  it("filters non-string entries from string-array overrides (excludePatterns)", () => {
    const r = mergeConfig({ indexing: { excludePatterns: ["**/*.log", 42, null, "node_modules/**"] as any } });
    expect(r.indexing.excludePatterns).toEqual(["**/*.log", "node_modules/**"]);
  });

  it("contextLength quirk: default is null (typeof 'object'), so a numeric override is rejected via the typeof check and stays null", () => {
    expect(mergeConfig({ model: { contextLength: 4096 } }).model.contextLength).toBe(null);
  });

  it("accepts valid same-type overrides across every section", () => {
    const r = mergeConfig({
      model: { chat: "m", embedding: "e", contextLength: null },
      agent: { maxIterations: 5, autoRag: false, ragTopK: 3, ragScoreThreshold: 0.1 },
      contextBudget: { systemPrompt: 1, ragContext: 2, history: 3, userMessage: 4 },
      permissions: { fileWrite: "auto-allow", fileDelete: "ask-once", terminalCommand: "ask-every-time" },
      indexing: { autoIndex: false, watchFiles: false, maxFileSize: 1024, excludePatterns: ["a"] },
    });
    expect(r.model.chat).toBe("m");
    expect(r.agent.autoRag).toBe(false);
    expect(r.contextBudget.systemPrompt).toBe(1);
    expect(r.permissions.fileWrite).toBe("auto-allow");
    expect(r.indexing.maxFileSize).toBe(1024);
    expect(r.indexing.excludePatterns).toEqual(["a"]);
  });
});
