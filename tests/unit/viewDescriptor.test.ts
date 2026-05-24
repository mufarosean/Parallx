/**
 * Pin-the-invariant: views/viewDescriptor.ts ViewDescriptorBuilder + serializer invariants.
 */
import { describe, it, expect } from "vitest";
import {
  ViewDescriptorBuilder,
  serializeViewDescriptor,
} from "../../src/views/viewDescriptor";
import { DEFAULT_SIZE_CONSTRAINTS } from "../../src/layout/layoutTypes";

describe("ViewDescriptorBuilder.build", () => {
  it("throws when no factory is provided", () => {
    expect(() =>
      ViewDescriptorBuilder.create("explorer", "Explorer").container("c").build(),
    ).toThrowError(/requires a factory/);
  });

  it("throws when no containerId is provided", () => {
    expect(() =>
      ViewDescriptorBuilder.create("explorer", "Explorer")
        .factory(() => ({} as any))
        .build(),
    ).toThrowError(/requires a containerId/);
  });

  it("builds a minimal descriptor with defaults", () => {
    const fn = () => ({} as any);
    const d = ViewDescriptorBuilder.create("ex", "Explorer")
      .container("c1")
      .factory(fn)
      .build();
    expect(d).toEqual({
      id: "ex",
      name: "Explorer",
      icon: undefined,
      containerId: "c1",
      when: undefined,
      constraints: DEFAULT_SIZE_CONSTRAINTS,
      focusOnActivate: false,
      keybinding: undefined,
      order: 100,
      factory: fn,
    });
  });

  it("propagates each fluent setter into the descriptor", () => {
    const constraints = { minWidth: 1, maxWidth: 2, minHeight: 3, maxHeight: 4 };
    const fn = () => ({} as any);
    const d = ViewDescriptorBuilder.create("v", "V")
      .icon("files")
      .container("sidebar")
      .when("clause")
      .constraints(constraints as any)
      .focusOnActivate()
      .keybinding("Ctrl+1")
      .order(42)
      .factory(fn)
      .build();
    expect(d.icon).toBe("files");
    expect(d.containerId).toBe("sidebar");
    expect(d.when).toBe("clause");
    expect(d.constraints).toBe(constraints);
    expect(d.focusOnActivate).toBe(true);
    expect(d.keybinding).toBe("Ctrl+1");
    expect(d.order).toBe(42);
    expect(d.factory).toBe(fn);
  });

  it("focusOnActivate(false) explicitly disables the flag", () => {
    const d = ViewDescriptorBuilder.create("v", "V")
      .container("c")
      .factory(() => ({} as any))
      .focusOnActivate(false)
      .build();
    expect(d.focusOnActivate).toBe(false);
  });
});

describe("serializeViewDescriptor", () => {
  it("strips the factory and preserves all other fields", () => {
    const d = ViewDescriptorBuilder.create("ex", "Explorer")
      .container("c1")
      .icon("files")
      .when("foo")
      .order(7)
      .keybinding("Ctrl+E")
      .focusOnActivate()
      .factory(() => ({} as any))
      .build();
    const s = serializeViewDescriptor(d);
    expect(s).toEqual({
      id: "ex",
      name: "Explorer",
      icon: "files",
      containerId: "c1",
      when: "foo",
      constraints: DEFAULT_SIZE_CONSTRAINTS,
      focusOnActivate: true,
      keybinding: "Ctrl+E",
      order: 7,
    });
    expect((s as any).factory).toBeUndefined();
  });
});
