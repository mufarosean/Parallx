// aiProfileSettingsSchemasPin.test.ts — pin AI profile schema registration.

import { describe, it, expect, vi } from "vitest";
import {
  registerAIProfileSettings,
  registerSettingsActions,
  type ISettingsActionDescriptor,
} from "../../src/aiSettings/aiProfileSettingsSchemas";

function fakeRegistry() {
  const register = vi.fn();
  const bind = vi.fn();
  return { register, bind } as any;
}

function fakeUnified(getCfg: () => any) {
  const listeners: Array<() => void> = [];
  return {
    getEffectiveConfig: vi.fn(() => JSON.parse(JSON.stringify(getCfg()))),
    updateActivePreset: vi.fn(async () => {}),
    onDidChangeConfig: (fn: () => void) => {
      listeners.push(fn);
      return { dispose: () => {} };
    },
    _fire: () => listeners.forEach(fn => fn()),
  } as any;
}

function deepProxy(seed: any = {}): any {
  return new Proxy(seed, {
    get(t, k: string) {
      if (k in t) return (t as any)[k];
      const child = deepProxy({});
      (t as any)[k] = child;
      return child;
    },
  });
}

function makeConfig() {
  return {
    persona: { name: "P", description: "D", avatarEmoji: "av" },
    chat: { systemPrompt: "sp", responseLength: "medium" },
    model: { chatModel: "m", contextWindow: 8192, temperature: 0.7, maxTokens: 1024 },
    suggestions: {
      suggestionsEnabled: true, tone: "neutral", focusDomain: "general",
      customFocusDescription: "", suggestionConfidenceThreshold: 0.5, maxPendingSuggestions: 5,
    },
    retrieval: { autoRag: true, ragTopK: 8, ragScoreThreshold: 0.3 },
    indexing: { autoIndex: true, watchFiles: true, maxFileSize: 1_000_000 },
    agent: { maxIterations: 10 },
    tools: { workbenchControlEnabled: true },
    heartbeat: { coalesceWindowMs: 30000, outputDedupWindowMs: 86_400_000 },
  };
}

describe("registerAIProfileSettings", () => {
  it("registers many schemas and binds each one (one bind per register)", () => {
    const reg = fakeRegistry();
    const u = fakeUnified(() => makeConfig());
    registerAIProfileSettings(reg, u);
    expect(reg.register.mock.calls.length).toBeGreaterThan(0);
    expect(reg.bind.mock.calls.length).toBe(reg.register.mock.calls.length);
  });

  it("each registered schema has key + type + scope='workspace'", () => {
    const reg = fakeRegistry();
    registerAIProfileSettings(reg, fakeUnified(() => makeConfig()));
    for (const call of reg.register.mock.calls) {
      const s = call[0];
      expect(typeof s.key).toBe("string");
      expect(typeof s.type).toBe("string");
      expect(s.scope).toBe("workspace");
    }
  });

  it("getValue binding reads through unified.getEffectiveConfig()", () => {
    const reg = fakeRegistry();
    const u = fakeUnified(() => makeConfig());
    registerAIProfileSettings(reg, u);
    const personaName = reg.bind.mock.calls.find((c: any[]) => c[0] === "persona.name");
    expect(personaName).toBeTruthy();
    const binding = personaName![1];
    expect(binding.getValue()).toBe("P");
  });

  it("setValue binding routes through unified.updateActivePreset with a deep patch", async () => {
    const reg = fakeRegistry();
    const u = fakeUnified(() => makeConfig());
    registerAIProfileSettings(reg, u);
    const call = reg.bind.mock.calls.find((c: any[]) => c[0] === "persona.name");
    await call![1].setValue("NewName");
    expect(u.updateActivePreset).toHaveBeenCalledWith({ persona: { name: "NewName" } });
  });

  it("onDidChange fires only for keys whose effective value changed", () => {
    const reg = fakeRegistry();
    const cfg = makeConfig();
    const u = fakeUnified(() => cfg);
    registerAIProfileSettings(reg, u);
    const personaCall = reg.bind.mock.calls.find((c: any[]) => c[0] === "persona.name");
    const tempCall = reg.bind.mock.calls.find((c: any[]) => c[0] === "chat.systemPrompt");
    const personaListener = vi.fn();
    const tempListener = vi.fn();
    personaCall![1].onDidChange(personaListener);
    tempCall![1].onDidChange(tempListener);
    // Mutate only persona.name; re-fire
    cfg.persona.name = "Renamed";
    u._fire();
    expect(personaListener).toHaveBeenCalledWith("Renamed");
    expect(tempListener).not.toHaveBeenCalled();
  });

  it("duplicate registration errors propagate (registry rejects duplicates)", () => {
    const reg: any = {
      register: vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error("dup"); }),
      bind: vi.fn(),
    };
    expect(() => registerAIProfileSettings(reg, fakeUnified(() => makeConfig()))).toThrow(/dup/);
  });
});

describe("registerSettingsActions", () => {
  it("registers one action-typed entry per descriptor with default=null", () => {
    const reg = fakeRegistry();
    const actions: ISettingsActionDescriptor[] = [
      { key: "agent.manager", category: "Agent", description: "Open the agent manager", actionLabel: "Open", command: "agent.openManager" },
      { key: "data.export", category: "Data", description: "Export data", actionLabel: "Export", command: "data.export" },
    ];
    registerSettingsActions(reg, actions);
    expect(reg.register).toHaveBeenCalledTimes(2);
    const first = reg.register.mock.calls[0][0];
    expect(first.key).toBe("agent.manager");
    expect(first.type).toBe("action");
    expect(first.scope).toBe("workspace");
    expect(first.default).toBeNull();
    expect(first.command).toBe("agent.openManager");
    expect(first.actionLabel).toBe("Open");
  });

  it("does not bind action entries (they are command-driven)", () => {
    const reg = fakeRegistry();
    registerSettingsActions(reg, [
      { key: "a", category: "c", description: "d", actionLabel: "go", command: "cmd.a" },
    ]);
    expect(reg.bind).not.toHaveBeenCalled();
  });
});

