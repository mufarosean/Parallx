import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  registerEditorInputDeserializer,
  deserializeEditorInput,
  hasEditorInputDeserializer,
} from "../../src/editor/editorInputDeserializer";

describe("editorInputDeserializer pin", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("register + hasEditorInputDeserializer + deserialize round-trip", () => {
    const typeId = "pin.t1";
    expect(hasEditorInputDeserializer(typeId)).toBe(false);
    const fake = { id: "x", typeId } as any;
    registerEditorInputDeserializer(typeId, () => fake);
    expect(hasEditorInputDeserializer(typeId)).toBe(true);
    expect(deserializeEditorInput(typeId, { a: 1 })).toBe(fake);
  });

  it("deserializeEditorInput returns null and warns for unregistered typeId", () => {
    const result = deserializeEditorInput("pin.unknown-" + Math.random());
    expect(result).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("deserializeEditorInput catches factory throws, returns null, and warns", () => {
    const typeId = "pin.t2";
    registerEditorInputDeserializer(typeId, () => { throw new Error("boom"); });
    expect(deserializeEditorInput(typeId)).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it("duplicate registration warns and overwrites with the new factory", () => {
    const typeId = "pin.t3";
    const a = { id: "a" } as any;
    const b = { id: "b" } as any;
    registerEditorInputDeserializer(typeId, () => a);
    registerEditorInputDeserializer(typeId, () => b);
    expect(deserializeEditorInput(typeId)).toBe(b);
    expect(console.warn).toHaveBeenCalled();
  });

  it("factory receives the data argument as passed to deserialize", () => {
    const typeId = "pin.t4";
    let receivedData: any = "untouched";
    registerEditorInputDeserializer(typeId, (data) => {
      receivedData = data;
      return null;
    });
    deserializeEditorInput(typeId, { hello: "world" });
    expect(receivedData).toEqual({ hello: "world" });
  });

  it("a factory returning null from deserialize is honoured (returns null, no throw)", () => {
    const typeId = "pin.t5";
    registerEditorInputDeserializer(typeId, () => null);
    expect(deserializeEditorInput(typeId)).toBeNull();
  });
});
