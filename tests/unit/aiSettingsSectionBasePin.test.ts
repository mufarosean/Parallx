/** @vitest-environment jsdom */
/**
 * Pin tests for src/aiSettings/ui/sectionBase.ts.
 *
 * Pins:
 *   - showSaveIndicator appends a `.ai-settings-save-indicator` element with "✓ Saved",
 *     toggles `--visible` after rAF, and removes itself after the fade-out timer.
 *   - createSettingRow produces a `.ai-settings-row` with dataset.{settingKey, searchLabel, searchDesc},
 *     a header with label, optional Workspace/Global scope badge, optional reset button,
 *     a description block, and a control slot.
 *   - createSettingRow's reset button invokes onReset; click does not propagate up.
 *   - createSettingRow's Workspace scope badge invokes clearWorkspaceOverride on click.
 *   - SettingsSection constructor builds `.ai-settings-section` with header + content elements.
 *   - applySearch dims non-matching rows and marks section as `--no-matches` when zero matches.
 *   - applySearch with empty query restores all rows and clears no-matches state.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  showSaveIndicator, createSettingRow, SettingsSection,
} from "../../src/aiSettings/ui/sectionBase";

// Polyfill requestAnimationFrame for jsdom.
beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
});

class FakeSection extends SettingsSection {
  build(): void {}
  update(): void {}
  // expose protected helpers for tests
  publicAddRow(r: HTMLElement) { this._addRow(r); }
}

describe("aiSettings/ui/sectionBase — showSaveIndicator", () => {
  it("appends a save indicator with '✓ Saved' text", () => {
    const host = document.createElement("div");
    showSaveIndicator(host);
    const ind = host.querySelector(".ai-settings-save-indicator");
    expect(ind).toBeTruthy();
    expect(ind!.textContent).toBe("✓ Saved");
  });

  it("removes any pre-existing indicator on the same element", () => {
    const host = document.createElement("div");
    showSaveIndicator(host);
    showSaveIndicator(host);
    const all = host.querySelectorAll(".ai-settings-save-indicator");
    expect(all.length).toBe(1);
  });
});

describe("aiSettings/ui/sectionBase — createSettingRow", () => {
  it("creates a row with dataset metadata and label/description/control slot", () => {
    const { row, controlSlot } = createSettingRow({
      label: "My Label",
      description: "My Description",
      key: "my.key",
    });
    expect(row.classList.contains("ai-settings-row")).toBe(true);
    expect(row.dataset.settingKey).toBe("my.key");
    expect(row.dataset.searchLabel).toBe("my label");
    expect(row.dataset.searchDesc).toBe("my description");
    expect(row.querySelector(".ai-settings-row__label")?.textContent).toBe("My Label");
    expect(row.querySelector(".ai-settings-row__description")?.textContent).toBe("My Description");
    expect(controlSlot.classList.contains("ai-settings-row__control")).toBe(true);
    expect(row.contains(controlSlot)).toBe(true);
  });

  it("renders reset button only when onReset provided; click invokes it and stops propagation", () => {
    const noResetRow = createSettingRow({ label: "L", description: "D", key: "k" }).row;
    expect(noResetRow.querySelector(".ai-settings-row__reset")).toBeNull();

    const onReset = vi.fn();
    const onParentClick = vi.fn();
    const { row } = createSettingRow({ label: "L", description: "D", key: "k", onReset });
    const parent = document.createElement("div");
    parent.appendChild(row);
    parent.addEventListener("click", onParentClick);

    const btn = row.querySelector(".ai-settings-row__reset") as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("renders Workspace scope badge when overridden; clicking calls clearWorkspaceOverride", () => {
    const clear = vi.fn();
    const svc = {
      isOverridden: vi.fn(() => true),
      clearWorkspaceOverride: clear,
    } as any;
    const { row } = createSettingRow({
      label: "L", description: "D", key: "k",
      scopePath: "path.to.field", unifiedService: svc,
    });
    const badge = row.querySelector(".ai-settings-row__scope") as HTMLElement;
    expect(badge).toBeTruthy();
    expect(badge.classList.contains("ai-settings-row__scope--workspace")).toBe(true);
    expect(badge.textContent).toBe("Workspace ↩");
    badge.click();
    expect(clear).toHaveBeenCalledWith("path.to.field");
  });

  it("renders 'Global' badge (no click handler) when scope path is not overridden", () => {
    const clear = vi.fn();
    const svc = {
      isOverridden: vi.fn(() => false),
      clearWorkspaceOverride: clear,
    } as any;
    const { row } = createSettingRow({
      label: "L", description: "D", key: "k",
      scopePath: "path", unifiedService: svc,
    });
    const badge = row.querySelector(".ai-settings-row__scope") as HTMLElement;
    expect(badge.textContent).toBe("Global");
    expect(badge.classList.contains("ai-settings-row__scope--workspace")).toBe(false);
    badge.click();
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("aiSettings/ui/sectionBase — SettingsSection", () => {
  it("constructs `.ai-settings-section` with dataset id + header + content elements", () => {
    const svc = {} as any;
    const s = new FakeSection(svc, "model", "Model");
    expect(s.element.classList.contains("ai-settings-section")).toBe(true);
    expect(s.element.dataset.sectionId).toBe("model");
    expect(s.headerElement.id).toBe("ai-settings-section-model");
    expect(s.headerElement.textContent).toBe("Model");
    expect(s.element.contains(s.headerElement)).toBe(true);
    expect(s.element.contains(s.contentElement)).toBe(true);
  });

  it("applySearch dims non-matching rows and marks section --no-matches when none match", () => {
    const s = new FakeSection({} as any, "sec", "Sec");
    const a = createSettingRow({ label: "Temperature", description: "Sampling temperature", key: "a" }).row;
    const b = createSettingRow({ label: "Top P", description: "Nucleus sampling", key: "b" }).row;
    s.publicAddRow(a);
    s.publicAddRow(b);

    const matches = s.applySearch("temp");
    expect(matches).toBe(1);
    expect(a.classList.contains("ai-settings-row--dimmed")).toBe(false);
    expect(b.classList.contains("ai-settings-row--dimmed")).toBe(true);
    expect(s.element.classList.contains("ai-settings-section--no-matches")).toBe(false);

    const zero = s.applySearch("xyzzy");
    expect(zero).toBe(0);
    expect(s.element.classList.contains("ai-settings-section--no-matches")).toBe(true);
  });

  it("applySearch with empty query restores all rows and clears no-matches state", () => {
    const s = new FakeSection({} as any, "sec", "Sec");
    const a = createSettingRow({ label: "Temperature", description: "x", key: "a" }).row;
    s.publicAddRow(a);
    s.applySearch("xyzzy");
    expect(s.element.classList.contains("ai-settings-section--no-matches")).toBe(true);
    const n = s.applySearch("");
    expect(n).toBe(1);
    expect(a.classList.contains("ai-settings-row--dimmed")).toBe(false);
    expect(s.element.classList.contains("ai-settings-section--no-matches")).toBe(false);
  });
});
