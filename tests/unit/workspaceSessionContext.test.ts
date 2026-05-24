/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { WorkspaceSessionContext } from "../../src/workspace/workspaceSessionContext";

const fakeUri = (path: string) => ({ fsPath: path, scheme: "file", path } as any);

describe("WorkspaceSessionContext", () => {
  it("captures workspaceId, sessionId, and roots", () => {
    const r1 = fakeUri("/a"); const r2 = fakeUri("/b");
    const ctx = new WorkspaceSessionContext("ws-id-12345678long", "sid-id-12345678long", [r1, r2]);
    expect(ctx.workspaceId).toBe("ws-id-12345678long");
    expect(ctx.sessionId).toBe("sid-id-12345678long");
    expect(ctx.roots).toEqual([r1, r2]);
    expect(ctx.primaryRoot).toBe(r1);
  });

  it("primaryRoot is undefined for an empty workspace", () => {
    const ctx = new WorkspaceSessionContext("w", "s", []);
    expect(ctx.primaryRoot).toBeUndefined();
  });

  it("builds the log prefix from short ids (8 chars each)", () => {
    const ctx = new WorkspaceSessionContext("abcdefghIJKLMNOP", "01234567ZZZZZZZZ", []);
    expect(ctx.logPrefix).toBe("[ws:abcdefgh sid:01234567]");
  });

  it("uses full id when shorter than 8 chars", () => {
    const ctx = new WorkspaceSessionContext("ws", "s", []);
    expect(ctx.logPrefix).toBe("[ws:ws sid:s]");
  });

  it("isActive() defaults to true, cancellationSignal mirrors AbortController.signal", () => {
    const ctx = new WorkspaceSessionContext("w", "s", []);
    expect(ctx.isActive()).toBe(true);
    expect(ctx.cancellationSignal).toBe(ctx.abortController.signal);
    expect(ctx.cancellationSignal.aborted).toBe(false);
  });

  it("invalidate() flips isActive() to false and aborts the controller exactly once", () => {
    const ctx = new WorkspaceSessionContext("w", "s", []);
    expect(ctx.isActive()).toBe(true);
    ctx.invalidate();
    expect(ctx.isActive()).toBe(false);
    expect(ctx.cancellationSignal.aborted).toBe(true);
    // Second invalidate is a no-op.
    expect(() => ctx.invalidate()).not.toThrow();
    expect(ctx.isActive()).toBe(false);
  });
});
