/** @vitest-environment jsdom */
import { describe, it, expect } from "vitest";
import {
  explorerViewDescriptor,
  searchViewDescriptor,
  terminalViewDescriptor,
  outputViewDescriptor,
  allPlaceholderViewDescriptors,
  allAuxiliaryBarViewDescriptors,
  ExplorerPlaceholderView,
  SearchPlaceholderView,
  TerminalPlaceholderView,
  OutputPlaceholderView,
} from "../../src/views/placeholderViews";

describe("placeholderViews pin", () => {
  it("descriptor IDs, names, and containers are stable", () => {
    expect(explorerViewDescriptor.id).toBe("view.explorer");
    expect(explorerViewDescriptor.name).toBe("Explorer");
    expect(explorerViewDescriptor.containerId).toBe("sidebar");

    expect(searchViewDescriptor.id).toBe("view.search");
    expect(searchViewDescriptor.containerId).toBe("sidebar");

    expect(terminalViewDescriptor.id).toBe("view.terminal");
    expect(terminalViewDescriptor.containerId).toBe("panel");

    expect(outputViewDescriptor.id).toBe("view.output");
    expect(outputViewDescriptor.containerId).toBe("panel");
  });

  it("sidebar descriptors carry the documented width constraints", () => {
    expect(explorerViewDescriptor.constraints.minimumWidth).toBe(170);
    expect(explorerViewDescriptor.constraints.maximumWidth).toBe(800);
    expect(searchViewDescriptor.constraints.minimumWidth).toBe(200);
    expect(searchViewDescriptor.constraints.maximumWidth).toBe(600);
  });

  it("panel descriptors carry the documented height bounds", () => {
    expect(terminalViewDescriptor.constraints.minimumHeight).toBe(100);
    expect(terminalViewDescriptor.constraints.maximumHeight).toBe(500);
    expect(outputViewDescriptor.constraints.minimumHeight).toBe(80);
    expect(outputViewDescriptor.constraints.maximumHeight).toBe(400);
  });

  it("each factory builds the matching concrete View class", () => {
    expect(explorerViewDescriptor.factory()).toBeInstanceOf(ExplorerPlaceholderView);
    expect(searchViewDescriptor.factory()).toBeInstanceOf(SearchPlaceholderView);
    expect(terminalViewDescriptor.factory()).toBeInstanceOf(TerminalPlaceholderView);
    expect(outputViewDescriptor.factory()).toBeInstanceOf(OutputPlaceholderView);
  });

  it("allPlaceholderViewDescriptors lists explorer, search, terminal, output in order", () => {
    expect(allPlaceholderViewDescriptors.map(d => d.id)).toEqual([
      "view.explorer",
      "view.search",
      "view.terminal",
      "view.output",
    ]);
  });

  it("allAuxiliaryBarViewDescriptors is intentionally empty", () => {
    expect(allAuxiliaryBarViewDescriptors).toEqual([]);
  });

  it("view classes expose the constraint getters as instance methods", () => {
    const v = new ExplorerPlaceholderView();
    expect(v.minimumWidth).toBe(170);
    expect(v.maximumWidth).toBe(800);
    expect(v.minimumHeight).toBe(100);
    expect(v.maximumHeight).toBe(Number.POSITIVE_INFINITY);
    v.dispose();
  });
});
