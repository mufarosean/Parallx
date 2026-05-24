import { describe, it, expect, vi } from "vitest";
import { NotificationsSurfacePlugin } from "../../src/workbench/surfaces/notificationSurface";
import { StatusSurfacePlugin } from "../../src/workbench/surfaces/statusSurface";
import { SURFACE_NOTIFICATIONS, SURFACE_STATUS } from "../../src/openclaw/openclawSurfacePlugin";

function makeNotifService() {
  return {
    info: vi.fn(async () => undefined),
    warn: vi.fn(async () => undefined),
    error: vi.fn(async () => undefined),
    notify: vi.fn(async () => undefined),
  };
}

describe("NotificationsSurfacePlugin pin", () => {
  it("id and capabilities are pinned (text-only, no structured/binary/actions)", () => {
    const p = new NotificationsSurfacePlugin(makeNotifService() as any);
    expect(p.id).toBe(SURFACE_NOTIFICATIONS);
    expect(p.capabilities).toEqual({
      supportsText: true,
      supportsStructured: false,
      supportsBinary: false,
      supportsActions: false,
    });
    expect(p.isAvailable()).toBe(true);
  });

  it("severity routing: warn → warn(), error → error(), default info → notify('information', text, [], source)", async () => {
    const svc = makeNotifService();
    const p = new NotificationsSurfacePlugin(svc as any);

    expect(await p.deliver({ content: "hi", metadata: {} } as any)).toBe(true);
    expect(svc.notify).toHaveBeenCalledWith("information", "hi", [], "agent");

    expect(await p.deliver({ content: "watch", metadata: { severity: "warn" } } as any)).toBe(true);
    expect(svc.warn).toHaveBeenCalledWith("watch");

    expect(await p.deliver({ content: "boom", metadata: { severity: "error" } } as any)).toBe(true);
    expect(svc.error).toHaveBeenCalledWith("boom");
  });

  it("'warning' maps to warn; metadata.source forwarded to notify(); unknown severity → info", async () => {
    const svc = makeNotifService();
    const p = new NotificationsSurfacePlugin(svc as any);

    await p.deliver({ content: "w", metadata: { severity: "warning" } } as any);
    expect(svc.warn).toHaveBeenCalledWith("w");

    await p.deliver({ content: "i", metadata: { source: "tool.web" } } as any);
    expect(svc.notify).toHaveBeenCalledWith("information", "i", [], "tool.web");

    await p.deliver({ content: "x", metadata: { severity: "weird" } } as any);
    expect(svc.notify).toHaveBeenLastCalledWith("information", "x", [], "agent");
  });

  it("non-string content is coerced via String(); null/undefined rejected with false", async () => {
    const svc = makeNotifService();
    const p = new NotificationsSurfacePlugin(svc as any);

    expect(await p.deliver({ content: 42, metadata: {} } as any)).toBe(true);
    expect(svc.notify).toHaveBeenCalledWith("information", "42", [], "agent");

    expect(await p.deliver({ content: null, metadata: {} } as any)).toBe(false);
    expect(await p.deliver({ content: undefined, metadata: {} } as any)).toBe(false);
  });

  it("dispose is a no-op (service is owned by workbench)", () => {
    const svc = makeNotifService();
    const p = new NotificationsSurfacePlugin(svc as any);
    expect(() => p.dispose()).not.toThrow();
  });
});

function makeStatusBar() {
  const accessor = { update: vi.fn(), dispose: vi.fn() };
  const addEntry = vi.fn(() => accessor);
  return { bar: { addEntry } as any, accessor, addEntry };
}

describe("StatusSurfacePlugin pin", () => {
  it("registers a single status-bar entry on construction with pinned id/alignment/priority", () => {
    const { bar, addEntry } = makeStatusBar();
    const p = new StatusSurfacePlugin(bar);

    expect(addEntry).toHaveBeenCalledTimes(1);
    const initial = addEntry.mock.calls[0][0];
    expect(initial.id).toBe("parallx.surface.status");
    expect(initial.name).toBe("Agent Status");
    expect(initial.text).toBe("");
    expect(initial.priority).toBe(50);
    expect(initial.tooltip).toBe("Parallx agent status");
    expect(p.id).toBe(SURFACE_STATUS);
    expect(p.capabilities.supportsText).toBe(true);
    expect(p.capabilities.supportsStructured).toBe(false);
    expect(p.isAvailable()).toBe(true);
  });

  it("deliver() forwards text and optional tooltip to accessor.update()", async () => {
    const { bar, accessor } = makeStatusBar();
    const p = new StatusSurfacePlugin(bar);

    expect(await p.deliver({ content: "tick", metadata: {} } as any)).toBe(true);
    expect(accessor.update).toHaveBeenLastCalledWith({ text: "tick" });

    expect(await p.deliver({ content: "busy", metadata: { tooltip: "syncing" } } as any)).toBe(true);
    expect(accessor.update).toHaveBeenLastCalledWith({ text: "busy", tooltip: "syncing" });
  });

  it("null/undefined content rejected (returns false), update() not called", async () => {
    const { bar, accessor } = makeStatusBar();
    const p = new StatusSurfacePlugin(bar);
    const before = accessor.update.mock.calls.length;

    expect(await p.deliver({ content: null, metadata: {} } as any)).toBe(false);
    expect(await p.deliver({ content: undefined, metadata: {} } as any)).toBe(false);

    expect(accessor.update.mock.calls.length).toBe(before);
  });

  it("dispose() releases the accessor; subsequent deliver() returns false and isAvailable() is false", async () => {
    const { bar, accessor } = makeStatusBar();
    const p = new StatusSurfacePlugin(bar);

    p.dispose();
    expect(accessor.dispose).toHaveBeenCalledTimes(1);
    expect(p.isAvailable()).toBe(false);
    expect(await p.deliver({ content: "x", metadata: {} } as any)).toBe(false);

    // idempotent
    p.dispose();
    expect(accessor.dispose).toHaveBeenCalledTimes(1);
  });
});
