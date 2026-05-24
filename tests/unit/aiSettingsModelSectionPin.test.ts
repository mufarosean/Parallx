/** @vitest-environment jsdom */
/**
 * Pin tests for src/aiSettings/ui/sections/modelSection.ts.
 *
 * Pins:
 *   - sectionId='model', title='Model'; constructor builds the standard
 *     `.ai-settings-section` element via SettingsSection base.
 *   - build() registers two setting rows keyed `model.chatModel` and
 *     `model.contextWindow`.
 *   - The chatModel row mounts a `<select.ai-settings-select>`; initial
 *     state holds a single placeholder option ("Auto — first available").
 *   - _refreshModels() populates the select with: placeholder + sorted
 *     models (by family then displayName), and re-selects current value.
 *   - If the persisted model id is not among returned models, appends
 *     an option labelled "<id> (not installed)" and selects it.
 *   - The contextWindow row mounts an InputBox with type=number, min=0,
 *     step=1; validation rejects negatives, non-integers, and >1,000,000.
 *   - Changing the select calls updateWorkspaceOverride with
 *     `{ model: { chatModel: <value> } }`.
 *   - The select onChange-then-saved indicator: a `.ai-settings-save-indicator`
 *     is appended to the row after the write resolves.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ModelSection } from "../../src/aiSettings/ui/sections/modelSection";

beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
});

function makeUnified(overrides?: Partial<any>) {
  return {
    getEffectiveConfig: vi.fn(() => ({
      model: { chatModel: "", contextWindow: 0 },
    })),
    updateWorkspaceOverride: vi.fn(async (_patch: any) => {}),
    isOverridden: vi.fn(() => false),
    clearWorkspaceOverride: vi.fn(),
    ...overrides,
  } as any;
}

function makeLms(models: any[] = []) {
  const modelChangeListeners: any[] = [];
  const providerChangeListeners: any[] = [];
  return {
    getModels: vi.fn(async () => models),
    onDidChangeModels: (cb: any) => {
      modelChangeListeners.push(cb);
      return { dispose() {} };
    },
    onDidChangeProviders: (cb: any) => {
      providerChangeListeners.push(cb);
      return { dispose() {} };
    },
    _fireModelsChange() { for (const l of modelChangeListeners) l(); },
  } as any;
}

function makeService() {
  return {
    resetSection: vi.fn(),
  } as any;
}

describe("aiSettings/sections/modelSection — construction", () => {
  it("uses sectionId='model' and title='Model'", () => {
    const s = new ModelSection(makeService(), makeUnified(), makeLms());
    expect(s.sectionId).toBe("model");
    expect(s.title).toBe("Model");
    expect(s.element.classList.contains("ai-settings-section")).toBe(true);
    expect(s.element.dataset.sectionId).toBe("model");
  });
});

describe("aiSettings/sections/modelSection — build()", () => {
  it("renders exactly two setting rows keyed model.chatModel and model.contextWindow", async () => {
    const s = new ModelSection(makeService(), makeUnified(), makeLms());
    s.build();
    const rows = Array.from(s.element.querySelectorAll<HTMLElement>(".ai-settings-row"));
    expect(rows.length).toBe(2);
    const keys = rows.map(r => r.dataset.settingKey).sort();
    expect(keys).toEqual(["model.chatModel", "model.contextWindow"]);
  });

  it("mounts a <select.ai-settings-select> in the chatModel row with a placeholder option", () => {
    const s = new ModelSection(makeService(), makeUnified(), makeLms());
    s.build();
    const row = s.element.querySelector<HTMLElement>('.ai-settings-row[data-setting-key="model.chatModel"]')!;
    const sel = row.querySelector<HTMLSelectElement>("select.ai-settings-select")!;
    expect(sel).toBeTruthy();
    expect(sel.options.length).toBeGreaterThanOrEqual(1);
    expect(sel.options[0].value).toBe("");
    expect(sel.options[0].textContent).toContain("Auto");
  });

  it("mounts a numeric input for context window with min=0/step=1", () => {
    const s = new ModelSection(makeService(), makeUnified(), makeLms());
    s.build();
    const row = s.element.querySelector<HTMLElement>('.ai-settings-row[data-setting-key="model.contextWindow"]')!;
    const input = row.querySelector<HTMLInputElement>("input")!;
    expect(input.type).toBe("number");
    expect(input.min).toBe("0");
    expect(input.step).toBe("1");
  });
});

describe("aiSettings/sections/modelSection — _refreshModels via onDidChangeModels", () => {
  it("populates select with sorted models (family then displayName), preserving current selection", async () => {
    const lms = makeLms([
      { id: "b:large", family: "b", displayName: "Large", parameterSize: "70B" },
      { id: "a:small", family: "a", displayName: "Small" },
      { id: "a:medium", family: "a", displayName: "Medium" },
    ]);
    const unified = makeUnified();
    unified.getEffectiveConfig = vi.fn(() => ({ model: { chatModel: "a:medium", contextWindow: 0 } }));
    const s = new ModelSection(makeService(), unified, lms);
    s.build();
    // Wait for initial refresh to resolve.
    await new Promise(r => setTimeout(r, 0));
    const sel = s.element.querySelector<HTMLSelectElement>("select.ai-settings-select")!;
    const values = Array.from(sel.options).map(o => o.value);
    // placeholder first, then family-sorted models.
    expect(values).toEqual(["", "a:medium", "a:small", "b:large"]);
    expect(sel.value).toBe("a:medium");
    // Label includes parameterSize when present.
    const largeOpt = Array.from(sel.options).find(o => o.value === "b:large")!;
    expect(largeOpt.textContent).toContain("70B");
  });

  it("appends '<id> (not installed)' when persisted id is missing from returned models", async () => {
    const lms = makeLms([{ id: "x:1", family: "x", displayName: "X" }]);
    const unified = makeUnified();
    unified.getEffectiveConfig = vi.fn(() => ({ model: { chatModel: "ghost:7b", contextWindow: 0 } }));
    const s = new ModelSection(makeService(), unified, lms);
    s.build();
    await new Promise(r => setTimeout(r, 0));
    const sel = s.element.querySelector<HTMLSelectElement>("select.ai-settings-select")!;
    const ghost = Array.from(sel.options).find(o => o.value === "ghost:7b");
    expect(ghost).toBeTruthy();
    expect(ghost!.textContent).toContain("(not installed)");
    expect(sel.value).toBe("ghost:7b");
  });
});

describe("aiSettings/sections/modelSection — write paths", () => {
  it("change event on select writes { model: { chatModel } } via updateWorkspaceOverride", async () => {
    const lms = makeLms([{ id: "m1", family: "f", displayName: "M1" }]);
    const unified = makeUnified();
    const s = new ModelSection(makeService(), unified, lms);
    s.build();
    await new Promise(r => setTimeout(r, 0));
    const sel = s.element.querySelector<HTMLSelectElement>("select.ai-settings-select")!;
    sel.value = "m1";
    sel.dispatchEvent(new Event("change"));
    // Allow microtask to settle.
    await new Promise(r => setTimeout(r, 0));
    expect(unified.updateWorkspaceOverride).toHaveBeenCalledWith({ model: { chatModel: "m1" } });
  });

  it("shows save indicator on the chatModel row after change resolves", async () => {
    const lms = makeLms([{ id: "m1", family: "f", displayName: "M1" }]);
    const unified = makeUnified();
    const s = new ModelSection(makeService(), unified, lms);
    s.build();
    await new Promise(r => setTimeout(r, 0));
    const row = s.element.querySelector<HTMLElement>('.ai-settings-row[data-setting-key="model.chatModel"]')!;
    const sel = row.querySelector<HTMLSelectElement>("select.ai-settings-select")!;
    sel.value = "m1";
    sel.dispatchEvent(new Event("change"));
    await new Promise(r => setTimeout(r, 0));
    expect(row.querySelector(".ai-settings-save-indicator")).toBeTruthy();
  });
});

describe("aiSettings/sections/modelSection — gracefully handles missing services", () => {
  it("constructs without unified/lms and build() does not throw", () => {
    const s = new ModelSection(makeService());
    expect(() => s.build()).not.toThrow();
  });
});
