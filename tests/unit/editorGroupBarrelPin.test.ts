/**
 * Pin tests for src/editor/editorGroup.ts — barrel re-export surface guard.
 *
 * Pins:
 *   - The barrel exports all documented value names from its peer modules.
 */
import { describe, it, expect } from "vitest";
import * as barrel from "../../src/editor/editorGroup";

describe("editor/editorGroup — barrel re-export", () => {
  it("re-exports the documented value names", () => {
    expect(typeof (barrel as any).EditorGroupModel).toBe("function");
    expect(typeof (barrel as any).EditorGroupView).toBe("function");
    expect(typeof (barrel as any).EditorInput).toBe("function");
    expect(typeof (barrel as any).PlaceholderEditorInput).toBe("function");
    expect(typeof (barrel as any).EditorPane).toBe("function");
    expect(typeof (barrel as any).PlaceholderEditorPane).toBe("function");
    expect((barrel as any).EditorActivation).toBeDefined();
    expect((barrel as any).GroupDirection).toBeDefined();
    expect((barrel as any).EditorGroupChangeKind).toBeDefined();
    expect(typeof (barrel as any).EDITOR_TAB_DRAG_TYPE).toBe("string");
  });
});
