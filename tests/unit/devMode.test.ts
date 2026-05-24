import { describe, it, expect, vi, afterEach } from "vitest";

describe("isDevMode (devMode.ts)", () => {
  const originalEnv = (globalThis as any).process?.env?.NODE_ENV;

  afterEach(() => {
    vi.resetModules();
    delete (globalThis as any).window;
    if (originalEnv !== undefined) {
      (globalThis as any).process.env.NODE_ENV = originalEnv;
    } else if ((globalThis as any).process?.env) {
      delete (globalThis as any).process.env.NODE_ENV;
    }
  });

  it("is true when window.parallxElectron.testMode is truthy", async () => {
    (globalThis as any).window = { parallxElectron: { testMode: true } };
    vi.resetModules();
    const mod = await import("../../src/platform/devMode");
    expect(mod.isDevMode).toBe(true);
  });

  it("is false when NODE_ENV === 'production' and no testMode flag", async () => {
    (globalThis as any).process.env.NODE_ENV = "production";
    vi.resetModules();
    const mod = await import("../../src/platform/devMode");
    expect(mod.isDevMode).toBe(false);
  });

  it("is true when NODE_ENV === 'development'", async () => {
    (globalThis as any).process.env.NODE_ENV = "development";
    vi.resetModules();
    const mod = await import("../../src/platform/devMode");
    expect(mod.isDevMode).toBe(true);
  });

  it("is true when NODE_ENV === 'test'", async () => {
    (globalThis as any).process.env.NODE_ENV = "test";
    vi.resetModules();
    const mod = await import("../../src/platform/devMode");
    expect(mod.isDevMode).toBe(true);
  });

  it("defaults to true when NODE_ENV is undefined and no window", async () => {
    delete (globalThis as any).process.env.NODE_ENV;
    vi.resetModules();
    const mod = await import("../../src/platform/devMode");
    expect(mod.isDevMode).toBe(true);
  });

  it("testMode wins even when NODE_ENV is production", async () => {
    (globalThis as any).process.env.NODE_ENV = "production";
    (globalThis as any).window = { parallxElectron: { testMode: true } };
    vi.resetModules();
    const mod = await import("../../src/platform/devMode");
    expect(mod.isDevMode).toBe(true);
  });
});
