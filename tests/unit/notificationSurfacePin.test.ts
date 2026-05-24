// notificationSurfacePin.test.ts — pin NotificationsSurfacePlugin contract (node env).

import { describe, it, expect, vi } from "vitest";
import { NotificationsSurfacePlugin } from "../../src/workbench/surfaces/notificationSurface";
import {
  SURFACE_NOTIFICATIONS,
  type ISurfaceDelivery,
} from "../../src/openclaw/openclawSurfacePlugin";

function makeNotifSvc() {
  return {
    info: vi.fn(async () => {}),
    warn: vi.fn(async () => {}),
    error: vi.fn(async () => {}),
    notify: vi.fn(() => {}),
  };
}

function delivery(content: unknown, metadata: Record<string, unknown> = {}): ISurfaceDelivery {
  return {
    id: "d1",
    surfaceId: SURFACE_NOTIFICATIONS,
    contentType: "text",
    content,
    metadata,
    createdAt: 0,
    status: "pending",
    retries: 0,
    error: null,
  };
}

describe("NotificationsSurfacePlugin", () => {
  it("id is SURFACE_NOTIFICATIONS and only text capability is true", () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    expect(p.id).toBe(SURFACE_NOTIFICATIONS);
    expect(p.capabilities.supportsText).toBe(true);
    expect(p.capabilities.supportsStructured).toBe(false);
    expect(p.capabilities.supportsBinary).toBe(false);
    expect(p.capabilities.supportsActions).toBe(false);
  });

  it("isAvailable always returns true", () => {
    const p = new NotificationsSurfacePlugin(makeNotifSvc() as any);
    expect(p.isAvailable()).toBe(true);
  });

  it("default severity routes to notify(information, ...) with default source 'agent'", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    const ok = await p.deliver(delivery("hello"));
    expect(ok).toBe(true);
    expect(svc.notify).toHaveBeenCalledTimes(1);
    expect(svc.notify.mock.calls[0][0]).toBe("information");
    expect(svc.notify.mock.calls[0][1]).toBe("hello");
    expect(svc.notify.mock.calls[0][2]).toEqual([]);
    expect(svc.notify.mock.calls[0][3]).toBe("agent");
  });

  it("metadata.source string overrides default agent source on info path", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    await p.deliver(delivery("hello", { source: "indexer" }));
    expect(svc.notify.mock.calls[0][3]).toBe("indexer");
  });

  it("severity 'warn' routes to notificationService.warn(text)", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    await p.deliver(delivery("careful", { severity: "warn" }));
    expect(svc.warn).toHaveBeenCalledWith("careful");
    expect(svc.notify).not.toHaveBeenCalled();
  });

  it("severity 'warning' is normalised to warn", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    await p.deliver(delivery("x", { severity: "warning" }));
    expect(svc.warn).toHaveBeenCalledWith("x");
  });

  it("severity 'error' routes to notificationService.error(text)", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    await p.deliver(delivery("boom", { severity: "error" }));
    expect(svc.error).toHaveBeenCalledWith("boom");
    expect(svc.notify).not.toHaveBeenCalled();
  });

  it("unknown severity falls back to info path (notify)", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    await p.deliver(delivery("x", { severity: "critical" }));
    expect(svc.notify).toHaveBeenCalledTimes(1);
    expect(svc.warn).not.toHaveBeenCalled();
    expect(svc.error).not.toHaveBeenCalled();
  });

  it("null content returns false without calling any notification method", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    const ok = await p.deliver(delivery(null));
    expect(ok).toBe(false);
    expect(svc.notify).not.toHaveBeenCalled();
    expect(svc.warn).not.toHaveBeenCalled();
    expect(svc.error).not.toHaveBeenCalled();
  });

  it("non-string content coerced via String() then routed", async () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    await p.deliver(delivery(7, { severity: "warn" }));
    expect(svc.warn).toHaveBeenCalledWith("7");
  });

  it("dispose is a no-op (notification service is workbench-owned)", () => {
    const svc = makeNotifSvc();
    const p = new NotificationsSurfacePlugin(svc as any);
    expect(() => p.dispose()).not.toThrow();
  });
});
