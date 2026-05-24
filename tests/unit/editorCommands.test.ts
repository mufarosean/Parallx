/**
 * Pin-the-invariant: commands/editorCommands.ts — split/close/next/previous
 * behaviour, including the no-service / no-active-group guard rails.
 */
import { describe, it, expect, vi } from "vitest";
import {
  splitEditor,
  splitEditorOrthogonal,
  closeActiveEditor,
  nextEditor,
  previousEditor,
} from "../../src/commands/editorCommands";
import { GroupDirection } from "../../src/services/serviceTypes";

function makeCtx(svc: any) {
  return { workbench: {}, getService: (id: string) => (id === "IEditorGroupService" ? svc : undefined) } as any;
}

function makeGroupSvc(opts: {
  hasActive?: boolean;
  count?: number;
  activeIndex?: number;
  splitGroup?: ReturnType<typeof vi.fn>;
  closeEditor?: ReturnType<typeof vi.fn>;
  setActive?: ReturnType<typeof vi.fn>;
} = {}) {
  const hasActive = opts.hasActive ?? true;
  const count = opts.count ?? 0;
  const activeIndex = opts.activeIndex ?? -1;
  const closeEditor = opts.closeEditor ?? vi.fn().mockResolvedValue(undefined);
  const setActive = opts.setActive ?? vi.fn();
  const splitGroup = opts.splitGroup ?? vi.fn();
  const group = hasActive
    ? {
        id: "g1",
        model: { count, activeIndex, closeEditor, setActive },
      }
    : undefined;
  return {
    activeGroup: group,
    splitGroup,
    closeEditor,
    setActive,
  } as any;
}

describe("splitEditor / splitEditorOrthogonal", () => {
  it("splitEditor calls splitGroup(activeGroup.id, GroupDirection.Right)", () => {
    const svc = makeGroupSvc();
    splitEditor.handler!(makeCtx(svc));
    expect(svc.splitGroup).toHaveBeenCalledWith("g1", GroupDirection.Right);
  });

  it("splitEditorOrthogonal calls splitGroup(activeGroup.id, GroupDirection.Down)", () => {
    const svc = makeGroupSvc();
    splitEditorOrthogonal.handler!(makeCtx(svc));
    expect(svc.splitGroup).toHaveBeenCalledWith("g1", GroupDirection.Down);
  });

  it("splitEditor is a no-op when IEditorGroupService is missing", () => {
    const splitGroup = vi.fn();
    expect(() => splitEditor.handler!(makeCtx(undefined))).not.toThrow();
    expect(splitGroup).not.toHaveBeenCalled();
  });

  it("splitEditor is a no-op when there is no active group", () => {
    const svc = makeGroupSvc({ hasActive: false });
    splitEditor.handler!(makeCtx(svc));
    expect(svc.splitGroup).not.toHaveBeenCalled();
  });

  it("Ctrl+\\ is the pinned keybinding for splitEditor", () => {
    expect(splitEditor.keybinding).toBe("Ctrl+\\");
  });
});

describe("closeActiveEditor", () => {
  it("closes model.activeIndex when >= 0", async () => {
    const svc = makeGroupSvc({ activeIndex: 2 });
    await closeActiveEditor.handler!(makeCtx(svc));
    expect(svc.closeEditor).toHaveBeenCalledWith(2);
  });

  it("does NOT close when activeIndex is -1", async () => {
    const svc = makeGroupSvc({ activeIndex: -1 });
    await closeActiveEditor.handler!(makeCtx(svc));
    expect(svc.closeEditor).not.toHaveBeenCalled();
  });

  it("is bound to Ctrl+W", () => {
    expect(closeActiveEditor.keybinding).toBe("Ctrl+W");
  });
});

describe("nextEditor / previousEditor — modular tab cycling", () => {
  it("nextEditor wraps from count-1 → 0", () => {
    const svc = makeGroupSvc({ count: 3, activeIndex: 2 });
    nextEditor.handler!(makeCtx(svc));
    expect(svc.setActive).toHaveBeenCalledWith(0);
  });

  it("nextEditor advances by +1", () => {
    const svc = makeGroupSvc({ count: 3, activeIndex: 0 });
    nextEditor.handler!(makeCtx(svc));
    expect(svc.setActive).toHaveBeenCalledWith(1);
  });

  it("previousEditor wraps from 0 → count-1", () => {
    const svc = makeGroupSvc({ count: 3, activeIndex: 0 });
    previousEditor.handler!(makeCtx(svc));
    expect(svc.setActive).toHaveBeenCalledWith(2);
  });

  it("nextEditor / previousEditor are no-ops when count is 0", () => {
    const svc = makeGroupSvc({ count: 0, activeIndex: -1 });
    nextEditor.handler!(makeCtx(svc));
    previousEditor.handler!(makeCtx(svc));
    expect(svc.setActive).not.toHaveBeenCalled();
  });

  it("Ctrl+PageDown / Ctrl+PageUp keybindings", () => {
    expect(nextEditor.keybinding).toBe("Ctrl+PageDown");
    expect(previousEditor.keybinding).toBe("Ctrl+PageUp");
  });
});
