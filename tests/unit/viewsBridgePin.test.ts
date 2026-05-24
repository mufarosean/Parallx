/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { ViewsBridge, type ToolViewProvider, type BadgeHost } from "../../src/api/bridges/viewsBridge";
import type { ViewManager } from "../../src/views/viewManager";
import type { IDisposable } from "../../src/platform/lifecycle";

function makeViewManager() {
  const registered: any[] = [];
  return {
    register: vi.fn((d: any) => { registered.push(d); }),
    unregister: vi.fn(() => {}),
    _registered: registered,
  } as unknown as ViewManager & {
    register: ReturnType<typeof vi.fn>;
    unregister: ReturnType<typeof vi.fn>;
    _registered: any[];
  };
}

function makeBadgeHost(): BadgeHost & { calls: any[] } {
  const calls: any[] = [];
  return {
    setBadge(iconId, badge) { calls.push({ iconId, badge }); },
    calls,
  };
}

describe("ViewsBridge pin", () => {
  let vm: ReturnType<typeof makeViewManager>;
  let subs: IDisposable[];

  beforeEach(() => {
    vm = makeViewManager();
    subs = [];
  });

  it("registerViewProvider creates descriptor with sane defaults", () => {
    const b = new ViewsBridge("tool.a", vm, subs);
    const provider: ToolViewProvider = { createView: () => ({ dispose: () => {} }) };
    const d = b.registerViewProvider("view.a", provider);
    expect(vm.register).toHaveBeenCalledTimes(1);
    const desc = vm._registered[0];
    expect(desc.id).toBe("view.a");
    expect(desc.name).toBe("view.a");
    expect(desc.containerId).toBe("workbench.parts.sidebar");
    expect(typeof desc.factory).toBe("function");
    expect(subs.length).toBe(1);
    d.dispose();
    expect(vm.unregister).toHaveBeenCalledWith("view.a");
  });

  it("registerViewProvider honours options (name, icon, containerId, when)", () => {
    const b = new ViewsBridge("tool.a", vm, subs);
    b.registerViewProvider("v", { createView: () => ({ dispose: () => {} }) }, {
      name: "Pretty",
      icon: "star",
      defaultContainerId: "workbench.parts.panel",
      when: "isLinux",
    });
    const desc = vm._registered[0];
    expect(desc.name).toBe("Pretty");
    expect(desc.icon).toBe("star");
    expect(desc.containerId).toBe("workbench.parts.panel");
    expect(desc.when).toBe("isLinux");
  });

  it("factory builds an IView that creates an element and disposes provider on view dispose", () => {
    const b = new ViewsBridge("tool.a", vm, subs);
    const providerDispose = vi.fn();
    let captured: HTMLElement | null = null;
    b.registerViewProvider("v", {
      createView: (host: HTMLElement) => {
        captured = host;
        return { dispose: providerDispose };
      },
    });
    const desc = vm._registered[0];
    const view = desc.factory();
    expect(view.id).toBe("v");
    const host = document.createElement("div");
    view.createElement(host);
    expect(captured).not.toBeNull();
    expect(host.querySelector(".tool-view-content")).not.toBeNull();
    view.dispose();
    expect(providerDispose).toHaveBeenCalledTimes(1);
  });

  it("setBadge delegates to BadgeHost; warns + no-op when no host", () => {
    const host = makeBadgeHost();
    const b = new ViewsBridge("tool.a", vm, subs, undefined, host);
    b.setBadge("sidebar", { count: 7 });
    expect(host.calls).toEqual([{ iconId: "sidebar", badge: { count: 7 } }]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bNoHost = new ViewsBridge("tool.b", vm, []);
    bNoHost.setBadge("sidebar", { dot: true });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("dispose() prevents further API access and disposes registrations", () => {
    const b = new ViewsBridge("tool.a", vm, subs);
    b.registerViewProvider("v", { createView: () => ({ dispose: () => {} }) });
    b.dispose();
    expect(() => b.registerViewProvider("w", { createView: () => ({ dispose: () => {} }) })).toThrow(/has been deactivated/);
    expect(() => b.setBadge("x", undefined)).toThrow(/has been deactivated/);
  });

  it("when a ViewContributionProcessor claims the view, registration delegates to processor.registerProvider", () => {
    const procDispose = vi.fn();
    const proc = {
      hasContributedView: (id: string) => id === "claimed",
      registerProvider: vi.fn(() => ({ dispose: procDispose })),
    } as any;
    const b = new ViewsBridge("tool.a", vm, subs, proc);
    const d = b.registerViewProvider("claimed", { createView: () => ({ dispose: () => {} }) });
    expect(proc.registerProvider).toHaveBeenCalledTimes(1);
    expect(vm.register).not.toHaveBeenCalled();
    d.dispose();
    expect(procDispose).toHaveBeenCalledTimes(1);
  });
});
