/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionLogger } from "../../src/workspace/sessionLogger";

let logSpy: any, warnSpy: any, errSpy: any;
beforeEach(() => {
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore(); warnSpy.mockRestore(); errSpy.mockRestore();
});

const ctx = (prefix: string) => ({ logPrefix: prefix } as any);

describe("SessionLogger", () => {
  it("uses the context logPrefix when supplied", () => {
    const log = new SessionLogger(ctx("[ws:abc sid:def]"));
    expect(log.prefix).toBe("[ws:abc sid:def]");
    log.info("hello", 1, 2);
    expect(logSpy).toHaveBeenCalledWith("[ws:abc sid:def] hello", 1, 2);
  });

  it("falls back to the unknown prefix when context is missing", () => {
    const log = new SessionLogger();
    expect(log.prefix).toBe("[ws:? sid:?]");
    log.warn("oops");
    expect(warnSpy).toHaveBeenCalledWith("[ws:? sid:?] oops");
  });

  it("setContext updates the prefix used by subsequent calls", () => {
    const log = new SessionLogger();
    log.setContext(ctx("[ws:x sid:y]"));
    log.error("boom");
    expect(errSpy).toHaveBeenCalledWith("[ws:x sid:y] boom");
    log.setContext(undefined);
    expect(log.prefix).toBe("[ws:? sid:?]");
  });

  it("never throws when the console method throws", () => {
    logSpy.mockImplementation(() => { throw new Error("io"); });
    const log = new SessionLogger();
    expect(() => log.info("a")).not.toThrow();
  });

  it("routes info → console.log, warn → console.warn, error → console.error", () => {
    const log = new SessionLogger(ctx("[p]"));
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(logSpy).toHaveBeenCalledWith("[p] i");
    expect(warnSpy).toHaveBeenCalledWith("[p] w");
    expect(errSpy).toHaveBeenCalledWith("[p] e");
  });
});
