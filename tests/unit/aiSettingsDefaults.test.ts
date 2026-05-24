import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROFILE,
  BUILT_IN_PRESETS,
} from "../../src/aiSettings/aiSettingsDefaults";

describe("aiSettingsDefaults — DEFAULT_PROFILE", () => {
  it("identifies as the built-in 'default' profile", () => {
    expect(DEFAULT_PROFILE.id).toBe("default");
    expect(DEFAULT_PROFILE.presetName).toBe("Default");
    expect(DEFAULT_PROFILE.isBuiltIn).toBe(true);
  });

  it("has the documented Parallx AI persona shape", () => {
    expect(DEFAULT_PROFILE.persona).toEqual({
      name: "Parallx AI",
      description: "Your intelligent workspace assistant",
      avatarEmoji: "avatar-brain",
    });
  });

  it("chat defaults: blank system prompt, not custom, adaptive length", () => {
    expect(DEFAULT_PROFILE.chat).toEqual({
      systemPrompt: "",
      systemPromptIsCustom: false,
      responseLength: "adaptive",
    });
  });

  it("model defaults: empty defaultModel, temperature 0.7, maxTokens/contextWindow 0 (auto)", () => {
    expect(DEFAULT_PROFILE.model.defaultModel).toBe("");
    expect(DEFAULT_PROFILE.model.temperature).toBe(0.7);
    expect(DEFAULT_PROFILE.model.maxTokens).toBe(0);
    expect(DEFAULT_PROFILE.model.contextWindow).toBe(0);
  });

  it("suggestions defaults: balanced/general, threshold 0.65, enabled, cap 5", () => {
    expect(DEFAULT_PROFILE.suggestions.tone).toBe("balanced");
    expect(DEFAULT_PROFILE.suggestions.focusDomain).toBe("general");
    expect(DEFAULT_PROFILE.suggestions.customFocusDescription).toBe("");
    expect(DEFAULT_PROFILE.suggestions.suggestionConfidenceThreshold).toBe(0.65);
    expect(DEFAULT_PROFILE.suggestions.suggestionsEnabled).toBe(true);
    expect(DEFAULT_PROFILE.suggestions.maxPendingSuggestions).toBe(5);
  });

  it("createdAt/updatedAt are zero on the factory profile", () => {
    expect(DEFAULT_PROFILE.createdAt).toBe(0);
    expect(DEFAULT_PROFILE.updatedAt).toBe(0);
  });
});

describe("aiSettingsDefaults — BUILT_IN_PRESETS", () => {
  it("contains exactly three presets in documented order: default, finance-focus, creative-mode", () => {
    expect(BUILT_IN_PRESETS.map((p) => p.id)).toEqual([
      "default",
      "finance-focus",
      "creative-mode",
    ]);
  });

  it("every preset is flagged isBuiltIn", () => {
    expect(BUILT_IN_PRESETS.every((p) => p.isBuiltIn)).toBe(true);
  });

  it("Finance Focus overrides persona and tunes suggestions for finance", () => {
    const fin = BUILT_IN_PRESETS.find((p) => p.id === "finance-focus")!;
    expect(fin.presetName).toBe("Finance Focus");
    expect(fin.persona.name).toBe("Finance Assistant");
    expect(fin.persona.avatarEmoji).toBe("avatar-coins");
    expect(fin.suggestions.tone).toBe("concise");
    expect(fin.suggestions.focusDomain).toBe("finance");
    expect(fin.suggestions.suggestionConfidenceThreshold).toBe(0.6);
  });

  it("Creative Mode bumps temperature to 0.9 and switches tone/domain", () => {
    const cre = BUILT_IN_PRESETS.find((p) => p.id === "creative-mode")!;
    expect(cre.persona.name).toBe("Creative Partner");
    expect(cre.persona.avatarEmoji).toBe("avatar-pen");
    expect(cre.model.temperature).toBe(0.9);
    expect(cre.suggestions.tone).toBe("detailed");
    expect(cre.suggestions.focusDomain).toBe("writing");
  });

  it("presets are independent objects — mutating one preset's nested object must not mutate DEFAULT_PROFILE", () => {
    const fin = BUILT_IN_PRESETS.find((p) => p.id === "finance-focus")!;
    expect(fin.suggestions).not.toBe(DEFAULT_PROFILE.suggestions);
    expect(fin.persona).not.toBe(DEFAULT_PROFILE.persona);
  });
});
