/**
 * Pin: secretStorageService — base64 round-trip across IPC, bridge-unavailable
 * error path, getString decode-failed branch, delete passthrough.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSecretStorageService, getSecretBridge } from "../../src/services/secretStorageService";

function makeBridge(overrides: Partial<{
  set: (k: string, v: string) => Promise<any>;
  get: (k: string) => Promise<any>;
  delete: (k: string) => Promise<any>;
}> = {}) {
  return {
    set: vi.fn(overrides.set ?? (async () => ({ ok: true }))),
    get: vi.fn(overrides.get ?? (async () => ({ ok: true, valueB64: "aGk=" /* "hi" */ }))),
    delete: vi.fn(overrides.delete ?? (async () => ({ ok: true }))),
  };
}

describe("services/secretStorageService", () => {
  beforeEach(() => { delete (globalThis as any).parallxElectron; });
  afterEach(() => { delete (globalThis as any).parallxElectron; });

  it("getSecretBridge returns undefined when window.parallxElectron is absent", () => {
    expect(getSecretBridge()).toBeUndefined();
  });

  it("getSecretBridge returns the bridge when present on globalThis.parallxElectron.secret", () => {
    const bridge = { set: vi.fn(), get: vi.fn(), delete: vi.fn() };
    (globalThis as any).parallxElectron = { secret: bridge };
    expect(getSecretBridge()).toBe(bridge);
  });

  it("available is true when a bridge is passed; false when undefined", () => {
    expect(createSecretStorageService(makeBridge() as any).available).toBe(true);
    expect(createSecretStorageService(undefined).available).toBe(false);
  });

  it("setString utf8-encodes to base64 before calling bridge.set", async () => {
    const bridge = makeBridge();
    const svc = createSecretStorageService(bridge as any);
    const r = await svc.setString("k", "hello");
    expect(r).toEqual({ ok: true });
    expect(bridge.set).toHaveBeenCalledWith("k", Buffer.from("hello", "utf8").toString("base64"));
  });

  it("setString handles non-ASCII UTF-8 (é, 中)", async () => {
    const bridge = makeBridge();
    const svc = createSecretStorageService(bridge as any);
    await svc.setString("k", "héllo中");
    const b64 = bridge.set.mock.calls[0][1];
    expect(Buffer.from(b64, "base64").toString("utf8")).toBe("héllo中");
  });

  it("getString decodes base64 → utf8 on success", async () => {
    const bridge = makeBridge({ get: async () => ({ ok: true, valueB64: Buffer.from("héllo中", "utf8").toString("base64") }) });
    const svc = createSecretStorageService(bridge as any);
    expect(await svc.getString("k")).toEqual({ ok: true, value: "héllo中" });
  });

  it("getString returns {ok:false, error} when bridge.get returns ok:false", async () => {
    const bridge = makeBridge({ get: async () => ({ ok: false, error: "not-allowed" }) });
    const svc = createSecretStorageService(bridge as any);
    expect(await svc.getString("k")).toEqual({ ok: false, error: "not-allowed" });
  });

  it("getString returns 'unknown-error' when bridge.get is ok but valueB64 missing", async () => {
    const bridge = makeBridge({ get: async () => ({ ok: true }) });
    const svc = createSecretStorageService(bridge as any);
    expect(await svc.getString("k")).toEqual({ ok: false, error: "unknown-error" });
  });

  it("delete passes the key through to bridge.delete", async () => {
    const bridge = makeBridge();
    const svc = createSecretStorageService(bridge as any);
    expect(await svc.delete("k")).toEqual({ ok: true });
    expect(bridge.delete).toHaveBeenCalledWith("k");
  });

  it("all methods return {ok:false, error:'bridge-unavailable'} when no bridge", async () => {
    const svc = createSecretStorageService(undefined);
    expect(await svc.setString("k", "v")).toEqual({ ok: false, error: "bridge-unavailable" });
    expect(await svc.getString("k")).toEqual({ ok: false, error: "bridge-unavailable" });
    expect(await svc.delete("k")).toEqual({ ok: false, error: "bridge-unavailable" });
  });
});
