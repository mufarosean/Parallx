/** @vitest-environment jsdom */
/**
 * Pin: aiSettings sectionBase — showSaveIndicator transitions,
 * createSettingRow DOM shape (label/desc/scope/reset slots), and the
 * SettingsSection.applySearch dim/no-matches logic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  showSaveIndicator,
  createSettingRow,
  SettingsSection,
} from "../../src/aiSettings/ui/sectionBase";

// rAF shim (vitest's jsdom may not have it)
beforeEach(() => {
  vi.useFakeTimers();
  // Always override — jsdom's native rAF doesn't tick under fake timers.
  (globalThis as any).requestAnimationFrame = (cb: FrameRequestCallback) => {
    return setTimeout(() => cb(performance.now()), 0) as unknown as number;
  };
});
afterEach(() => { vi.useRealTimers(); });

describe("showSaveIndicator — fade in / hold / fade out", () => {
  it("appends a span.ai-settings-save-indicator and toggles --visible class", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    showSaveIndicator(host);
    const ind = host.querySelector(".ai-settings-save-indicator") as HTMLElement;
    expect(ind).not.toBeNull();
    expect(ind.textContent).toBe("✓ Saved");
    expect(ind.classList.contains("ai-settings-save-indicator--visible")).toBe(false);

    vi.advanceTimersByTime(1); // run rAF shim
    expect(ind.classList.contains("ai-settings-save-indicator--visible")).toBe(true);

    vi.advanceTimersByTime(1500);
    expect(ind.classList.contains("ai-settings-save-indicator--visible")).toBe(false);

    vi.advanceTimersByTime(300);
    expect(host.querySelector(".ai-settings-save-indicator")).toBeNull();
  });

  it("removes a pre-existing indicator before creating a new one", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const old = document.createElement("span");
    old.className = "ai-settings-save-indicator";
    old.dataset.tag = "old";
    host.appendChild(old);
    showSaveIndicator(host);
    const indicators = host.querySelectorAll(".ai-settings-save-indicator");
    expect(indicators).toHaveLength(1);
    expect((indicators[0] as HTMLElement).dataset.tag).toBeUndefined();
  });
});

describe("createSettingRow — DOM shape + dataset", () => {
  it("creates a row with label, description, control slot, and search dataset", () => {
    const { row, controlSlot } = createSettingRow({
      label: "RAG Top K",
      description: "How many docs to retrieve",
      key: "retrieval.ragTopK",
    });
    expect(row.className).toBe("ai-settings-row");
    expect(row.dataset.settingKey).toBe("retrieval.ragTopK");
    expect(row.dataset.searchLabel).toBe("rag top k");
    expect(row.dataset.searchDesc).toBe("how many docs to retrieve");
    expect(row.querySelector(".ai-settings-row__label")?.textContent).toBe("RAG Top K");
    expect(row.querySelector(".ai-settings-row__description")?.textContent).toBe("How many docs to retrieve");
    expect(controlSlot.className).toBe("ai-settings-row__control");
    expect(row.contains(controlSlot)).toBe(true);
  });

  it("renders a reset button that fires onReset and stops click propagation", () => {
    const onReset = vi.fn();
    const outerClick = vi.fn();
    const { row } = createSettingRow({ label: "X", description: "Y", key: "k", onReset });
    document.body.appendChild(row);
    row.addEventListener("click", outerClick);
    const btn = row.querySelector(".ai-settings-row__reset") as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("Reset X to default");
    expect(btn.textContent).toBe("↺");
    btn.click();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(outerClick).not.toHaveBeenCalled();
  });

  it("does not render a reset button when onReset is absent", () => {
    const { row } = createSettingRow({ label: "X", description: "Y", key: "k" });
    expect(row.querySelector(".ai-settings-row__reset")).toBeNull();
  });

  it("scope badge: 'Global' (no --workspace class) when unifiedService.isOverridden() returns false", () => {
    const svc = { isOverridden: vi.fn().mockReturnValue(false), clearWorkspaceOverride: vi.fn() } as any;
    const { row } = createSettingRow({
      label: "X", description: "Y", key: "k", scopePath: "x.y", unifiedService: svc,
    });
    const badge = row.querySelector(".ai-settings-row__scope") as HTMLElement;
    expect(badge.textContent).toBe("Global");
    expect(badge.classList.contains("ai-settings-row__scope--workspace")).toBe(false);
  });

  it("scope badge: 'Workspace ↩' clickable; click calls clearWorkspaceOverride(scopePath)", () => {
    const svc = { isOverridden: vi.fn().mockReturnValue(true), clearWorkspaceOverride: vi.fn() } as any;
    const { row } = createSettingRow({
      label: "X", description: "Y", key: "k", scopePath: "x.y", unifiedService: svc,
    });
    const badge = row.querySelector(".ai-settings-row__scope") as HTMLElement;
    expect(badge.textContent).toBe("Workspace ↩");
    expect(badge.classList.contains("ai-settings-row__scope--workspace")).toBe(true);
    expect(badge.style.cursor).toBe("pointer");
    badge.click();
    expect(svc.clearWorkspaceOverride).toHaveBeenCalledWith("x.y");
  });
});

class _TestSection extends SettingsSection {
  build(): void {}
  update(): void {}
  publicAddRow(row: HTMLElement) { (this as any)._addRow(row); }
}

function makeService() {
  return { resetSection: vi.fn() } as any;
}

describe("SettingsSection — construction + applySearch", () => {
  it("constructor sets element, header, content with sectionId and id", () => {
    const s = new _TestSection(makeService(), "tools", "Tools");
    expect(s.element.className).toBe("ai-settings-section");
    expect(s.element.dataset.sectionId).toBe("tools");
    expect(s.headerElement.id).toBe("ai-settings-section-tools");
    expect(s.headerElement.textContent).toBe("Tools");
    expect(s.element.contains(s.contentElement)).toBe(true);
  });

  it("applySearch('') clears dims and no-matches class; returns row count", () => {
    const s = new _TestSection(makeService(), "id", "Title");
    const r1 = createSettingRow({ label: "Alpha", description: "first", key: "a" }).row;
    const r2 = createSettingRow({ label: "Beta", description: "second", key: "b" }).row;
    s.publicAddRow(r1); s.publicAddRow(r2);
    r1.classList.add("ai-settings-row--dimmed");
    s.element.classList.add("ai-settings-section--no-matches");
    expect(s.applySearch("")).toBe(2);
    expect(r1.classList.contains("ai-settings-row--dimmed")).toBe(false);
    expect(s.element.classList.contains("ai-settings-section--no-matches")).toBe(false);
  });

  it("applySearch dims non-matching rows; returns match count; clears no-matches when ≥1 match", () => {
    const s = new _TestSection(makeService(), "id", "Title");
    const r1 = createSettingRow({ label: "Alpha", description: "first", key: "a" }).row;
    const r2 = createSettingRow({ label: "Beta", description: "second", key: "b" }).row;
    s.publicAddRow(r1); s.publicAddRow(r2);
    const n = s.applySearch("alp");
    expect(n).toBe(1);
    expect(r1.classList.contains("ai-settings-row--dimmed")).toBe(false);
    expect(r2.classList.contains("ai-settings-row--dimmed")).toBe(true);
    expect(s.element.classList.contains("ai-settings-section--no-matches")).toBe(false);
  });

  it("applySearch matches descriptions too (lowercased)", () => {
    const s = new _TestSection(makeService(), "id", "Title");
    const r = createSettingRow({ label: "Alpha", description: "SECRET word", key: "a" }).row;
    s.publicAddRow(r);
    expect(s.applySearch("secret")).toBe(1);
  });

  it("applySearch sets no-matches class when 0 rows match", () => {
    const s = new _TestSection(makeService(), "id", "Title");
    const r = createSettingRow({ label: "Alpha", description: "first", key: "a" }).row;
    s.publicAddRow(r);
    expect(s.applySearch("zzz")).toBe(0);
    expect(s.element.classList.contains("ai-settings-section--no-matches")).toBe(true);
  });
});
