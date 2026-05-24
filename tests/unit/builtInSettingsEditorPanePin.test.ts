/** @vitest-environment jsdom */
/**
 * Pin tests for src/built-in/editor/settingsEditorPane.ts.
 *
 * Pins:
 *   - id = 'settings-editor-pane'.
 *   - create() installs .settings-editor with header (h2 'Settings'), search input,
 *     count label, body, and an .settings-empty-message child.
 *   - With no IConfigurationService → empty message reads 'Configuration service not available.'.
 *   - With a config service that returns 0 schemas → renders the Quick Actions
 *     section ('Appearance') with 'Open Theme Editor' and 'Open AI Settings' buttons.
 *   - With schemas → groups by sectionTitle; renders one .settings-item per schema
 *     and one .settings-section per group; clicking the boolean checkbox calls
 *     _updateValue with the inverted boolean.
 *   - Search input filters by key/description/sectionTitle and updates the count label.
 *   - Quick-action buttons invoke ICommandService.executeCommand with the right ids.
 *   - onDidChangeConfiguration listener re-renders.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SettingsEditorPane } from "../../src/built-in/editor/settingsEditorPane";
import { ServiceCollection } from "../../src/services/serviceCollection";
import { IConfigurationService, ICommandService } from "../../src/services/serviceTypes";
import { PlaceholderEditorInput } from "../../src/editor/editorInput";

function makeConfig(schemas: any[] = []) {
  const listeners: Array<() => void> = [];
  const values = new Map<string, unknown>();
  return {
    getAllSchemas: vi.fn(() => schemas),
    _getValue: vi.fn((k: string) => values.get(k)),
    _updateValue: vi.fn((k: string, v: unknown) => { values.set(k, v); }),
    onDidChangeConfiguration: (cb: () => void) => {
      listeners.push(cb);
      return { dispose() {} };
    },
    _fire() { for (const l of listeners) l(); },
    _values: values,
  } as any;
}

function makeCmd() {
  return { executeCommand: vi.fn(async () => undefined) } as any;
}

beforeEach(() => {
  (globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
});

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(services: ServiceCollection) {
  const pane = new SettingsEditorPane(services);
  const container = document.createElement("div");
  document.body.appendChild(container);
  pane.create(container);
  return { pane, container };
}

describe("built-in/editor/settingsEditorPane — construction & DOM", () => {
  it("id = 'settings-editor-pane'", () => {
    const pane = new SettingsEditorPane(new ServiceCollection());
    expect(pane.id).toBe("settings-editor-pane");
  });

  it("create() installs header, search input, count label, body, empty message", () => {
    const { container } = mount(new ServiceCollection());
    expect(container.querySelector(".settings-editor")).toBeTruthy();
    expect(container.querySelector(".settings-editor-header h2")!.textContent).toBe("Settings");
    expect(container.querySelector("input.settings-search-input")).toBeTruthy();
    expect(container.querySelector(".settings-result-count")).toBeTruthy();
    expect(container.querySelector(".settings-body")).toBeTruthy();
    expect(container.querySelector(".settings-empty-message")).toBeTruthy();
  });
});

describe("built-in/editor/settingsEditorPane — renderInput", () => {
  it("without IConfigurationService → empty message 'Configuration service not available.'", async () => {
    const { pane, container } = mount(new ServiceCollection());
    await pane.setInput(new PlaceholderEditorInput("settings"));
    const empty = container.querySelector(".settings-empty-message") as HTMLElement;
    expect(empty.textContent).toBe("Configuration service not available.");
    expect(empty.style.display).not.toBe("none");
  });

  it("with 0 schemas → renders Quick Actions section with Theme Editor + AI Settings buttons", async () => {
    const services = new ServiceCollection();
    services.registerInstance(IConfigurationService, makeConfig([]));
    services.registerInstance(ICommandService, makeCmd());
    const { pane, container } = mount(services);
    await pane.setInput(new PlaceholderEditorInput("settings"));
    const titles = Array.from(container.querySelectorAll(".settings-section-title")).map(e => e.textContent);
    expect(titles).toContain("Appearance");
    const btnLabels = Array.from(container.querySelectorAll(".settings-quick-action-btn")).map(b => b.textContent);
    expect(btnLabels).toContain("Open Theme Editor");
    expect(btnLabels).toContain("Open AI Settings");
  });

  it("Theme Editor button invokes ICommandService.executeCommand('theme-editor.open')", async () => {
    const services = new ServiceCollection();
    services.registerInstance(IConfigurationService, makeConfig([]));
    const cmd = makeCmd();
    services.registerInstance(ICommandService, cmd);
    const { pane, container } = mount(services);
    await pane.setInput(new PlaceholderEditorInput("settings"));
    const themeBtn = Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-quick-action-btn"))
      .find(b => b.textContent === "Open Theme Editor")!;
    themeBtn.click();
    expect(cmd.executeCommand).toHaveBeenCalledWith("theme-editor.open");
  });

  it("AI Settings button invokes ICommandService.executeCommand('ai-settings.open')", async () => {
    const services = new ServiceCollection();
    services.registerInstance(IConfigurationService, makeConfig([]));
    const cmd = makeCmd();
    services.registerInstance(ICommandService, cmd);
    const { pane, container } = mount(services);
    await pane.setInput(new PlaceholderEditorInput("settings"));
    const aiBtn = Array.from(container.querySelectorAll<HTMLButtonElement>(".settings-quick-action-btn"))
      .find(b => b.textContent === "Open AI Settings")!;
    aiBtn.click();
    expect(cmd.executeCommand).toHaveBeenCalledWith("ai-settings.open");
  });
});

describe("built-in/editor/settingsEditorPane — schema rendering", () => {
  const SCHEMAS = [
    { key: "a.b", type: "boolean", defaultValue: false, description: "desc1", toolId: "t1", sectionTitle: "Group A" },
    { key: "a.c", type: "string",  defaultValue: "x",   description: "desc2", toolId: "t1", sectionTitle: "Group A" },
    { key: "z.q", type: "boolean", defaultValue: true,  description: "other", toolId: "t2", sectionTitle: "Group B" },
  ];

  it("groups schemas by sectionTitle and renders one .settings-item per schema", async () => {
    const services = new ServiceCollection();
    services.registerInstance(IConfigurationService, makeConfig(SCHEMAS));
    services.registerInstance(ICommandService, makeCmd());
    const { pane, container } = mount(services);
    await pane.setInput(new PlaceholderEditorInput("settings"));
    const titles = Array.from(container.querySelectorAll(".settings-section-title")).map(e => e.textContent);
    expect(titles).toContain("Group A");
    expect(titles).toContain("Group B");
    expect(container.querySelectorAll(".settings-item").length).toBeGreaterThanOrEqual(3);
  });

  it("boolean checkbox change calls _updateValue with the new bool value", async () => {
    const services = new ServiceCollection();
    const cfg = makeConfig(SCHEMAS);
    services.registerInstance(IConfigurationService, cfg);
    services.registerInstance(ICommandService, makeCmd());
    const { pane, container } = mount(services);
    await pane.setInput(new PlaceholderEditorInput("settings"));
    // The first boolean rendered is for key 'a.b' (default false)
    const checkbox = Array.from(container.querySelectorAll<HTMLInputElement>(".settings-item input[type='checkbox']"))[0];
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));
    expect(cfg._updateValue).toHaveBeenCalledWith("a.b", true);
  });

  it("search input filters schemas and updates count label", async () => {
    const services = new ServiceCollection();
    services.registerInstance(IConfigurationService, makeConfig(SCHEMAS));
    services.registerInstance(ICommandService, makeCmd());
    const { pane, container } = mount(services);
    await pane.setInput(new PlaceholderEditorInput("settings"));
    const search = container.querySelector<HTMLInputElement>(".settings-search-input")!;
    search.value = "other";
    search.dispatchEvent(new Event("input"));
    const count = container.querySelector(".settings-result-count")!;
    expect(count.textContent).toBe("1 of 3");
    // Only Group B should render (no quick actions during search)
    const titles = Array.from(container.querySelectorAll(".settings-section-title")).map(e => e.textContent);
    expect(titles).toEqual(["Group B"]);
  });

  it("onDidChangeConfiguration listener re-renders when fired", async () => {
    const services = new ServiceCollection();
    const cfg = makeConfig(SCHEMAS);
    services.registerInstance(IConfigurationService, cfg);
    services.registerInstance(ICommandService, makeCmd());
    const { pane } = mount(services);
    await pane.setInput(new PlaceholderEditorInput("settings"));
    cfg.getAllSchemas.mockClear();
    cfg._fire();
    expect(cfg.getAllSchemas).toHaveBeenCalled();
  });
});
