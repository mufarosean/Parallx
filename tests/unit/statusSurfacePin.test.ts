// statusSurfacePin.test.ts — pin StatusSurfacePlugin contract (node env).

import { describe, it, expect, vi } from "vitest";
import { StatusSurfacePlugin } from "../../src/workbench/surfaces/statusSurface";
import {
  SURFACE_STATUS,
  type ISurfaceDelivery,
} from "../../src/openclaw/openclawSurfacePlugin";
import { StatusBarAlignment } from "../../src/services/serviceTypes";

function makeStatusBar() {
  const updates: any[] = [];
  let disposed = false;
  let added: any = null;
  const accessor = {
    update: (e: any) => { updates.push(e); },
    dispose: () => { disposed = true; },
  };
  const bar = {
    addEntry: vi.fn((entry: any) => { added = entry; return accessor; }),
  };
  return { bar, get added() { return added; }, updates, get disposed() { return disposed; } };
}

function delivery(content: unknown, metadata: Record<string, unknown> = {}): ISurfaceDelivery {
  return {
    id: "d1",
    surfaceId: SURFACE_STATUS,
    contentType: "text",
    content,
    metadata,
    createdAt: 0,
    status: "pending",
    retries: 0,
    error: null,
  };
}

describe("StatusSurfacePlugin", () => {
  it("id is SURFACE_STATUS and capabilities allow only text", () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    expect(p.id).toBe(SURFACE_STATUS);
    expect(p.capabilities.supportsText).toBe(true);
    expect(p.capabilities.supportsStructured).toBe(false);
    expect(p.capabilities.supportsBinary).toBe(false);
    expect(p.capabilities.supportsActions).toBe(false);
  });

  it("registers a right-aligned status bar entry on construction", () => {
    const sb = makeStatusBar();
    new StatusSurfacePlugin(sb.bar as any);
    expect(sb.bar.addEntry).toHaveBeenCalledTimes(1);
    expect(sb.added.id).toBe("parallx.surface.status");
    expect(sb.added.alignment).toBe(StatusBarAlignment.Right);
    expect(sb.added.priority).toBe(50);
    expect(sb.added.name).toBe("Agent Status");
    expect(sb.added.text).toBe("");
  });

  it("isAvailable returns true before dispose, false after", () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    expect(p.isAvailable()).toBe(true);
    p.dispose();
    expect(p.isAvailable()).toBe(false);
  });

  it("deliver with a string updates entry text and returns true", async () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    const ok = await p.deliver(delivery("indexing 5/10"));
    expect(ok).toBe(true);
    expect(sb.updates[0].text).toBe("indexing 5/10");
  });

  it("deliver coerces non-string content via String()", async () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    const ok = await p.deliver(delivery(42));
    expect(ok).toBe(true);
    expect(sb.updates[0].text).toBe("42");
  });

  it("deliver with null content returns false and does not update", async () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    const ok = await p.deliver(delivery(null));
    expect(ok).toBe(false);
    expect(sb.updates.length).toBe(0);
  });

  it("deliver forwards metadata.tooltip when present (string only)", async () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    await p.deliver(delivery("hi", { tooltip: "Some help" }));
    expect(sb.updates[0].tooltip).toBe("Some help");
  });

  it("deliver omits tooltip when metadata.tooltip is not a string", async () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    await p.deliver(delivery("hi", { tooltip: 123 as any }));
    expect("tooltip" in sb.updates[0]).toBe(false);
  });

  it("deliver after dispose returns false and does not update", async () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    p.dispose();
    const ok = await p.deliver(delivery("x"));
    expect(ok).toBe(false);
    expect(sb.updates.length).toBe(0);
  });

  it("dispose disposes the accessor; second dispose is a no-op", () => {
    const sb = makeStatusBar();
    const p = new StatusSurfacePlugin(sb.bar as any);
    p.dispose();
    expect(sb.disposed).toBe(true);
    expect(() => p.dispose()).not.toThrow();
  });
});
