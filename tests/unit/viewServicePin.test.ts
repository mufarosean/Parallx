/**
 * Pin: viewService — minimal Disposable facade. The class is intentionally
 * empty in M1/M2; this pin guards against accidental over-extension and
 * ensures the DI registration still hands out a Disposable instance.
 */
import { describe, it, expect } from "vitest";
import { ViewService } from "../../src/services/viewService";

describe("services/viewService", () => {
  it("constructs without arguments", () => {
    const svc = new ViewService();
    expect(svc).toBeInstanceOf(ViewService);
  });

  it("is Disposable (inherits dispose())", () => {
    const svc = new ViewService();
    expect(typeof (svc as any).dispose).toBe("function");
    expect(() => svc.dispose()).not.toThrow();
  });

  it("dispose() is idempotent", () => {
    const svc = new ViewService();
    svc.dispose();
    expect(() => svc.dispose()).not.toThrow();
  });
});
