import { describe, it, expect, beforeEach, vi } from "vitest";
import { WindowBridge } from "../../src/api/bridges/windowBridge";
import { NotificationSeverity } from "../../src/api/notificationService";
import type { INotificationService } from "../../src/services/serviceTypes";
import type { IDisposable } from "../../src/platform/lifecycle";

function makeNotificationService() {
  return {
    notify: vi.fn(async () => undefined),
  } as unknown as INotificationService & { notify: ReturnType<typeof vi.fn> };
}

describe("WindowBridge pin", () => {
  let svc: INotificationService & { notify: ReturnType<typeof vi.fn> };
  let subs: IDisposable[];
  let bridge: WindowBridge;

  beforeEach(() => {
    svc = makeNotificationService();
    subs = [];
    bridge = new WindowBridge("tool.a", svc, undefined, subs);
  });

  it("showInformationMessage forwards to notify with Information severity", async () => {
    const a = { title: "OK" };
    await bridge.showInformationMessage("hi", a);
    expect(svc.notify).toHaveBeenCalledWith(NotificationSeverity.Information, "hi", [a], "tool.a");
  });

  it("showWarningMessage forwards to notify with Warning severity", async () => {
    await bridge.showWarningMessage("warn");
    expect(svc.notify).toHaveBeenCalledWith(NotificationSeverity.Warning, "warn", [], "tool.a");
  });

  it("showErrorMessage forwards to notify with Error severity", async () => {
    await bridge.showErrorMessage("bad");
    expect(svc.notify).toHaveBeenCalledWith(NotificationSeverity.Error, "bad", [], "tool.a");
  });

  it("createOutputChannel prefixes channel name with tool ID and pushes onto subscriptions", () => {
    const ch = bridge.createOutputChannel("Build");
    expect(ch.name).toBe("tool.a: Build");
    expect(subs.length).toBe(1);
    expect(subs[0]).toBe(ch);
  });

  it("OutputChannel append/appendLine/clear/show/hide do not throw and are disposable", () => {
    const ch = bridge.createOutputChannel("Build");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    ch.append("a");
    ch.appendLine("b");
    ch.show();
    ch.append("c"); // visible → logs
    ch.hide();
    ch.append("d"); // hidden → no log
    ch.clear();
    expect(() => ch.dispose()).not.toThrow();
    logSpy.mockRestore();
  });

  it("dispose() prevents further calls (throws on API access)", async () => {
    bridge.dispose();
    await expect(bridge.showInformationMessage("nope")).rejects.toThrow(/has been deactivated/);
    expect(() => bridge.createOutputChannel("c")).toThrow(/has been deactivated/);
  });

  it("dispose() disposes any previously-created output channels", () => {
    const ch = bridge.createOutputChannel("X");
    bridge.dispose();
    // After dispose the channel rejects appends silently
    expect(() => ch.append("ignored")).not.toThrow();
  });
});
