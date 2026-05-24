/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  NotificationService,
  NotificationSeverity,
} from "../../src/api/notificationService";

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom requestAnimationFrame uses setTimeout under fake timers
});
afterEach(() => {
  vi.useRealTimers();
});

describe("NotificationService pin", () => {
  it("severity enum values are pinned", () => {
    expect(NotificationSeverity.Information).toBe("information");
    expect(NotificationSeverity.Warning).toBe("warning");
    expect(NotificationSeverity.Error).toBe("error");
  });

  it("starts with zero active notifications, empty history", () => {
    const svc = new NotificationService();
    expect(svc.activeCount).toBe(0);
    expect(svc.history).toEqual([]);
    svc.dispose();
  });

  it("attach() creates two top-level overlay containers and is idempotent", () => {
    const svc = new NotificationService();
    const host = document.createElement("div");
    svc.attach(host);
    expect(host.querySelector(".parallx-notifications-container")).not.toBeNull();
    expect(host.querySelector(".parallx-notification-prompts-container")).not.toBeNull();
    const before = host.children.length;

    svc.attach(host);
    expect(host.children.length).toBe(before);
    svc.dispose();
  });

  it("info()/warn()/error() prepend into the toast container with severity-tagged event", async () => {
    const svc = new NotificationService();
    const host = document.createElement("div");
    svc.attach(host);

    const shown: any[] = [];
    svc.onDidShowNotification(n => shown.push(n));

    void svc.info("a");
    void svc.warn("b");
    void svc.error("c");

    expect(shown.map(n => n.severity)).toEqual([
      NotificationSeverity.Information,
      NotificationSeverity.Warning,
      NotificationSeverity.Error,
    ]);
    expect(svc.activeCount).toBe(3);

    const toasts = host.querySelector(".parallx-notifications-container")!;
    expect(toasts.children.length).toBe(3);

    svc.dispose();
  });

  it("notify() with actions routes to the prompt container (centered prompt) instead of toasts", async () => {
    const svc = new NotificationService();
    const host = document.createElement("div");
    svc.attach(host);

    void svc.notify(NotificationSeverity.Information, "pick", [{ title: "OK" }], "src", 0);

    const prompts = host.querySelector(".parallx-notification-prompts-container")!;
    const toasts = host.querySelector(".parallx-notifications-container")!;
    expect(prompts.children.length).toBe(1);
    expect(toasts.children.length).toBe(0);
    svc.dispose();
  });

  it("dismiss(id) drops the entry, fires onDidCloseNotification and updates count", async () => {
    const svc = new NotificationService();
    svc.attach(document.createElement("div"));

    const closed: string[] = [];
    svc.onDidCloseNotification(id => closed.push(id));

    void svc.notify(NotificationSeverity.Information, "x", [], "src", 0);
    expect(svc.activeCount).toBe(1);
    // dismiss the only active
    const ids = (svc as any)._activeNotifications.keys() as IterableIterator<string>;
    const id = ids.next().value as string;
    svc.dismiss(id);
    vi.advanceTimersByTime(500);

    expect(svc.activeCount).toBe(0);
    expect(closed).toEqual([id]);
    svc.dispose();
  });

  it("dismissAll() clears every active notification", async () => {
    const svc = new NotificationService();
    svc.attach(document.createElement("div"));
    void svc.info("a", { title: "" });
    void svc.warn("b");
    void svc.error("c");
    expect(svc.activeCount).toBeGreaterThan(0);
    svc.dismissAll();
    vi.advanceTimersByTime(500);
    expect(svc.activeCount).toBe(0);
    svc.dispose();
  });

  it("history is bounded to MAX_HISTORY=50 with newest first", async () => {
    const svc = new NotificationService();
    svc.attach(document.createElement("div"));

    for (let i = 0; i < 55; i++) {
      void svc.notify(NotificationSeverity.Information, `m${i}`, [], undefined, 0);
    }
    expect(svc.history.length).toBe(50);
    expect(svc.history[0].message).toBe("m54");
    expect(svc.history[49].message).toBe("m5");
    svc.dispose();
  });

  it("clearHistory() empties the history but leaves active count alone", async () => {
    const svc = new NotificationService();
    svc.attach(document.createElement("div"));
    void svc.info("a");
    void svc.info("b");
    expect(svc.history.length).toBe(2);
    svc.clearHistory();
    expect(svc.history.length).toBe(0);
    expect(svc.activeCount).toBe(2);
    svc.dispose();
  });

  it("notify() with no attached container and timeoutMs=0 resolves immediately with undefined", async () => {
    const svc = new NotificationService();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const p = svc.notify(NotificationSeverity.Information, "ghost", [], undefined, 0);
    await vi.advanceTimersByTimeAsync(500);
    const result = await p;
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    svc.dispose();
  });

  it("onDidChangeCount fires on each show + dismiss with current activeCount", async () => {
    const svc = new NotificationService();
    svc.attach(document.createElement("div"));
    const counts: number[] = [];
    svc.onDidChangeCount(n => counts.push(n));

    void svc.notify(NotificationSeverity.Information, "a", [], undefined, 0);
    void svc.notify(NotificationSeverity.Information, "b", [], undefined, 0);
    svc.dismissAll();
    vi.advanceTimersByTime(500);

    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(2);
    expect(counts[counts.length - 1]).toBe(0);
    svc.dispose();
  });
});
