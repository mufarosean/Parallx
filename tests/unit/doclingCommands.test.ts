/**
 * Pin-the-invariant: commands/doclingCommands.ts installDocling flow.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { installDocling } from "../../src/commands/doclingCommands";

beforeEach(() => {
  delete (globalThis as any).parallxElectron;
});
afterEach(() => {
  delete (globalThis as any).parallxElectron;
});

function ctxWith(notifications: any) {
  return {
    workbench: {},
    getService: (id: string) =>
      id === "INotificationService" ? notifications : undefined,
  } as any;
}

describe("installDocling", () => {
  it("has id parallx.installDocling, category Parallx", () => {
    expect(installDocling.id).toBe("parallx.installDocling");
    expect(installDocling.category).toBe("Parallx");
    expect(installDocling.title).toBe("Install Docling");
  });

  it("warns when Electron API is missing", async () => {
    const warn = vi.fn();
    await installDocling.handler!(ctxWith({ warn }));
    expect(warn).toHaveBeenCalledOnce();
  });

  it("notifies + bails when status says installed + available", async () => {
    const info = vi.fn();
    (globalThis as any).parallxElectron = {
      docling: {
        status: vi.fn().mockResolvedValue({
          status: "available",
          port: 7700,
          pythonPath: "py",
          doclingInstalled: true,
        }),
        start: vi.fn(),
        install: vi.fn(),
      },
    };
    await installDocling.handler!(ctxWith({ info }));
    expect(info).toHaveBeenCalledOnce();
    expect((globalThis as any).parallxElectron.docling.install).not.toHaveBeenCalled();
  });

  it("errors when no python path found", async () => {
    const error = vi.fn();
    (globalThis as any).parallxElectron = {
      docling: {
        status: vi.fn().mockResolvedValue({
          status: "missing",
          port: null,
          pythonPath: null,
          doclingInstalled: false,
        }),
        start: vi.fn(),
        install: vi.fn(),
      },
    };
    await installDocling.handler!(ctxWith({ error }));
    expect(error).toHaveBeenCalledOnce();
  });

  it("when doclingInstalled but service down: tries start()", async () => {
    const info = vi.fn().mockResolvedValue({ title: "OK" });
    const start = vi.fn().mockResolvedValue({ ok: true });
    (globalThis as any).parallxElectron = {
      docling: {
        status: vi.fn().mockResolvedValue({
          status: "stopped",
          port: null,
          pythonPath: "py",
          doclingInstalled: true,
        }),
        start,
        install: vi.fn(),
      },
    };
    await installDocling.handler!(ctxWith({ info, warn: vi.fn(), error: vi.fn() }));
    expect(start).toHaveBeenCalledOnce();
  });

  it("cancel on install prompt: install is NOT called", async () => {
    const info = vi.fn().mockResolvedValue({ title: "Cancel" });
    const install = vi.fn();
    (globalThis as any).parallxElectron = {
      docling: {
        status: vi.fn().mockResolvedValue({
          status: "missing",
          port: null,
          pythonPath: "py",
          doclingInstalled: false,
        }),
        start: vi.fn(),
        install,
      },
    };
    await installDocling.handler!(ctxWith({ info, warn: vi.fn(), error: vi.fn() }));
    expect(install).not.toHaveBeenCalled();
  });
});
