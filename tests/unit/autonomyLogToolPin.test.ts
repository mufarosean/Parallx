/**
 * Pin: createAutonomyLogTool — schema + handler dispatch into IAutonomyLogReader.
 * Pins: tool metadata (name, source, permission), unavailable-log fail path,
 * default limit=50 + clamping (1..200), origin/onlyUnread/markRead args,
 * entry summarization (metadata whitelist), unreadCount math after markRead.
 */
import { describe, it, expect, vi } from "vitest";
import { createAutonomyLogTool } from "../../src/built-in/chat/tools/autonomyLogTool";

function makeReader(entries: any[] = [], unread = 0) {
  return {
    getEntries: vi.fn((_q: any) => entries),
    getUnreadCount: vi.fn(() => unread),
    markRead: vi.fn((_ids: string[]) => _ids.length),
  };
}

const token: any = { isCancellationRequested: false };

describe("built-in/chat/tools/autonomyLogTool/createAutonomyLogTool", () => {
  it("tool metadata: name, source='built-in', permissionLevel='always-allowed', requiresConfirmation=false", () => {
    const tool = createAutonomyLogTool(undefined);
    expect(tool.name).toBe("autonomy_log");
    expect(tool.source).toBe("built-in");
    expect(tool.permissionLevel).toBe("always-allowed");
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.parameters.type).toBe("object");
    expect(Object.keys(tool.parameters.properties)).toEqual(
      expect.arrayContaining(["origin", "limit", "onlyUnread", "markRead"]),
    );
  });

  it("handler returns ok:false isError:true when log is undefined", async () => {
    const tool = createAutonomyLogTool(undefined);
    const r = await tool.handler({}, token);
    expect(r.isError).toBe(true);
    expect(JSON.parse(r.content)).toEqual({ ok: false, error: "autonomy log service unavailable" });
  });

  it("default limit=50 when limit arg absent", async () => {
    const log = makeReader();
    const tool = createAutonomyLogTool(log as any);
    await tool.handler({}, token);
    expect(log.getEntries).toHaveBeenCalledWith({ limit: 50, origin: undefined, onlyUnread: false });
  });

  it("limit is clamped to [1..200] and floored", async () => {
    const log = makeReader();
    const tool = createAutonomyLogTool(log as any);
    await tool.handler({ limit: 0.4 }, token);    // floor(0.4)=0 → max(1, ..)=1
    expect(log.getEntries).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 1 }));
    await tool.handler({ limit: 5000 }, token);   // capped at 200
    expect(log.getEntries).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 200 }));
    await tool.handler({ limit: 27.9 }, token);   // floored to 27
    expect(log.getEntries).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 27 }));
  });

  it("origin + onlyUnread args forwarded to getEntries", async () => {
    const log = makeReader();
    const tool = createAutonomyLogTool(log as any);
    await tool.handler({ origin: "heartbeat", onlyUnread: true }, token);
    expect(log.getEntries).toHaveBeenCalledWith({ limit: 50, origin: "heartbeat", onlyUnread: true });
  });

  it("non-string origin / non-number limit / non-boolean flags fall back to defaults", async () => {
    const log = makeReader();
    const tool = createAutonomyLogTool(log as any);
    await tool.handler({ origin: 123, limit: "ten", onlyUnread: "yes", markRead: 1 } as any, token);
    expect(log.getEntries).toHaveBeenCalledWith({ limit: 50, origin: undefined, onlyUnread: false });
    expect(log.markRead).not.toHaveBeenCalled();
  });

  it("summarize: metadata whitelist (reason/jobName/path/eventType) only; meta omitted when none present", async () => {
    const e1 = {
      id: "e1",
      timestamp: 100,
      origin: "cron",
      requestText: "go",
      content: "did it",
      read: false,
      metadata: { reason: "alpha", jobName: "j", path: "/p", eventType: "et", extra: "DROP", more: { x: 1 } },
    };
    const e2 = { id: "e2", timestamp: 101, origin: "cron", requestText: "g2", content: "c2", read: true };
    const log = makeReader([e1, e2], 1);
    const tool = createAutonomyLogTool(log as any);
    const r = await tool.handler({}, token);
    const out = JSON.parse(r.content);
    expect(out.ok).toBe(true);
    expect(out.returned).toBe(2);
    expect(out.entries[0]).toEqual({
      id: "e1", timestamp: 100, origin: "cron", requestText: "go", content: "did it", read: false,
      meta: { reason: "alpha", jobName: "j", path: "/p", eventType: "et" },
    });
    expect(out.entries[1].meta).toBeUndefined();
  });

  it("markRead=true calls markRead with ALL returned ids and adjusts unreadCount", async () => {
    const entries = [{ id: "a", timestamp: 0, origin: "cron", requestText: "", content: "" }, { id: "b", timestamp: 1, origin: "cron", requestText: "", content: "" }];
    const log = makeReader(entries, 5);
    log.markRead.mockReturnValueOnce(2);
    const tool = createAutonomyLogTool(log as any);
    const r = await tool.handler({ markRead: true }, token);
    const out = JSON.parse(r.content);
    expect(log.markRead).toHaveBeenCalledWith(["a", "b"]);
    expect(out.markedRead).toBe(2);
    expect(out.unreadCount).toBe(3); // 5 - 2
  });

  it("markRead=true with zero returned entries does NOT call markRead and keeps unreadCount", async () => {
    const log = makeReader([], 4);
    const tool = createAutonomyLogTool(log as any);
    const r = await tool.handler({ markRead: true }, token);
    const out = JSON.parse(r.content);
    expect(log.markRead).not.toHaveBeenCalled();
    expect(out.markedRead).toBe(0);
    expect(out.unreadCount).toBe(4);
  });

  it("unreadCount math never goes negative even if markRead returns more than unread", async () => {
    const entries = [{ id: "a", timestamp: 0, origin: "cron", requestText: "", content: "" }];
    const log = makeReader(entries, 0);
    log.markRead.mockReturnValueOnce(1);
    const tool = createAutonomyLogTool(log as any);
    const r = await tool.handler({ markRead: true }, token);
    const out = JSON.parse(r.content);
    expect(out.unreadCount).toBe(0);
  });
});
