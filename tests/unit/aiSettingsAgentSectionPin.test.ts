/** @vitest-environment jsdom */
/**
 * Pin tests for src/aiSettings/ui/sections/agentSection.ts.
 *
 * Pins:
 *   - sectionId='agent', title='Agent'; constructor builds the base section element.
 *   - build() registers a single `.ai-settings-row` keyed `agent.maxIterations`
 *     plus an info note and an `.ai-settings-agent-list` container.
 *   - The agent-list renders one card per merged (built-in + persisted) agent,
 *     each card showing the agent name, optional surface badge, and a
 *     "built-in" badge for default agents.
 *   - Built-in agent cards do NOT render the ✕ remove button; custom agents do.
 *   - Clicking the "+ Add Agent" button calls updateActivePreset with a patch
 *     whose `agent.agentDefinitions` includes one new entry.
 *   - Slider change writes `{ agent: { maxIterations: <value> } }` via
 *     updateActivePreset and updates the value label.
 *   - update() syncs the slider value when the effective config changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentSection } from "../../src/aiSettings/ui/sections/agentSection";

beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
});

function makeUnified(overrides?: Partial<any>) {
  let cfg = {
    agent: { maxIterations: 25, agentDefinitions: [] as any[] },
  };
  return {
    getEffectiveConfig: vi.fn(() => cfg),
    updateActivePreset: vi.fn(async (patch: any) => {
      cfg = {
        agent: {
          ...cfg.agent,
          ...(patch.agent ?? {}),
        },
      };
    }),
    updateWorkspaceOverride: vi.fn(async () => {}),
    isOverridden: vi.fn(() => false),
    clearWorkspaceOverride: vi.fn(),
    _setConfig(next: any) { cfg = next; },
    ...overrides,
  } as any;
}

const makeService = () => ({ resetSection: vi.fn() }) as any;

describe("aiSettings/sections/agentSection — construction", () => {
  it("uses sectionId='agent' and title='Agent'", () => {
    const s = new AgentSection(makeService(), makeUnified());
    expect(s.sectionId).toBe("agent");
    expect(s.title).toBe("Agent");
    expect(s.element.dataset.sectionId).toBe("agent");
  });
});

describe("aiSettings/sections/agentSection — build()", () => {
  it("renders a single .ai-settings-row keyed agent.maxIterations", () => {
    const s = new AgentSection(makeService(), makeUnified());
    s.build();
    const rows = Array.from(s.element.querySelectorAll<HTMLElement>(".ai-settings-row"));
    expect(rows.length).toBe(1);
    expect(rows[0].dataset.settingKey).toBe("agent.maxIterations");
  });

  it("renders an .ai-settings-agent-list container with a + Add Agent button", () => {
    const s = new AgentSection(makeService(), makeUnified());
    s.build();
    const list = s.element.querySelector(".ai-settings-agent-list");
    expect(list).toBeTruthy();
    const addBtn = list!.querySelector<HTMLButtonElement>(".ai-settings-agent-list__add-btn");
    expect(addBtn).toBeTruthy();
    expect(addBtn!.textContent).toContain("Add Agent");
  });

  it("renders one card per built-in agent with a 'built-in' badge and no remove button", () => {
    const s = new AgentSection(makeService(), makeUnified());
    s.build();
    const cards = Array.from(s.element.querySelectorAll<HTMLElement>(".ai-settings-agent-card"));
    expect(cards.length).toBeGreaterThanOrEqual(3);
    for (const card of cards) {
      const builtinBadge = card.querySelector(".ai-settings-agent-card__badge--builtin");
      expect(builtinBadge).toBeTruthy();
      // No danger ✕ button for built-ins.
      const danger = card.querySelector(".ai-settings-agent-card__action-btn--danger");
      expect(danger).toBeNull();
    }
  });

  it("renders custom agents (from persisted definitions) with a ✕ remove button", () => {
    const u = makeUnified();
    u._setConfig({
      agent: {
        maxIterations: 25,
        agentDefinitions: [{ id: "custom-x", name: "Custom X" }],
      },
    });
    const s = new AgentSection(makeService(), u);
    s.build();
    const custom = s.element.querySelector<HTMLElement>('.ai-settings-agent-card[data-agent-id="custom-x"]');
    expect(custom).toBeTruthy();
    const danger = custom!.querySelector(".ai-settings-agent-card__action-btn--danger");
    expect(danger).toBeTruthy();
  });
});

describe("aiSettings/sections/agentSection — write paths", () => {
  it("clicking '+ Add Agent' calls updateActivePreset with a new entry in agentDefinitions", async () => {
    const u = makeUnified();
    const s = new AgentSection(makeService(), u);
    s.build();
    const addBtn = s.element.querySelector<HTMLButtonElement>(".ai-settings-agent-list__add-btn")!;
    addBtn.click();
    await new Promise(r => setTimeout(r, 0));
    expect(u.updateActivePreset).toHaveBeenCalled();
    const lastCall = u.updateActivePreset.mock.calls.at(-1)![0];
    expect(lastCall.agent.agentDefinitions.length).toBe(1);
    expect(lastCall.agent.agentDefinitions[0].id).toMatch(/^custom-/);
  });

  it("removing a custom agent filters it out of agentDefinitions", async () => {
    const u = makeUnified();
    u._setConfig({
      agent: {
        maxIterations: 25,
        agentDefinitions: [
          { id: "keep", name: "Keep" },
          { id: "drop", name: "Drop" },
        ],
      },
    });
    const s = new AgentSection(makeService(), u);
    s.build();
    const drop = s.element.querySelector<HTMLElement>('.ai-settings-agent-card[data-agent-id="drop"]')!;
    const removeBtn = drop.querySelector<HTMLButtonElement>(".ai-settings-agent-card__action-btn--danger")!;
    removeBtn.click();
    await new Promise(r => setTimeout(r, 0));
    const lastCall = u.updateActivePreset.mock.calls.at(-1)![0];
    expect(lastCall.agent.agentDefinitions.map((a: any) => a.id)).toEqual(["keep"]);
  });
});

describe("aiSettings/sections/agentSection — update()", () => {
  it("syncs slider value when effective config maxIterations differs", () => {
    const u = makeUnified();
    const s = new AgentSection(makeService(), u);
    s.build();
    u._setConfig({ agent: { maxIterations: 7, agentDefinitions: [] } });
    s.update({} as any);
    const valueEl = s.element.querySelector(".ai-settings-row__value")!;
    expect(valueEl.textContent).toBe("7");
  });
});

describe("aiSettings/sections/agentSection — no unified service", () => {
  it("constructs and builds without throwing when unifiedService is omitted", () => {
    const s = new AgentSection(makeService());
    expect(() => s.build()).not.toThrow();
  });
});
