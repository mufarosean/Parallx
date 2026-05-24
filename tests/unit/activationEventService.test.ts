import { describe, it, expect, vi } from "vitest";
import {
  ActivationEventService,
  ActivationEventKind,
  parseActivationEvent,
} from "../../src/tools/activationEventService";
import type { ActivationRequest, ParsedActivationEvent } from "../../src/tools/activationEventService";

describe("parseActivationEvent", () => {
  it("parses the * wildcard", () => {
    expect(parseActivationEvent("*")).toEqual({ kind: ActivationEventKind.Star, raw: "*" });
  });

  it("parses onStartupFinished", () => {
    expect(parseActivationEvent("onStartupFinished")).toEqual({
      kind: ActivationEventKind.OnStartupFinished,
      raw: "onStartupFinished",
    });
  });

  it("parses onCommand:<id> with the qualifier separated", () => {
    expect(parseActivationEvent("onCommand:foo.bar")).toEqual({
      kind: ActivationEventKind.OnCommand,
      qualifier: "foo.bar",
      raw: "onCommand:foo.bar",
    });
  });

  it("parses onView:<id> with the qualifier separated", () => {
    expect(parseActivationEvent("onView:explorer")).toEqual({
      kind: ActivationEventKind.OnView,
      qualifier: "explorer",
      raw: "onView:explorer",
    });
  });

  it("returns undefined for empty qualifiers and unknown events", () => {
    expect(parseActivationEvent("onCommand:")).toBeUndefined();
    expect(parseActivationEvent("onView:")).toBeUndefined();
    expect(parseActivationEvent("onSomethingElse")).toBeUndefined();
    expect(parseActivationEvent("")).toBeUndefined();
  });
});

describe("ActivationEventService — registration", () => {
  it("registerToolEvents warns on unrecognized events but still processes the rest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const svc = new ActivationEventService();
    svc.registerToolEvents("t", ["onView:v", "garbage"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unrecognized activation event"));
    expect(svc.getToolsForEvent("onView:v")).toEqual(["t"]);
    expect(svc.getToolsForEvent("garbage")).toEqual([]);
    warn.mockRestore();
  });

  it("disposing the registration handle removes the tool from the event map", () => {
    const svc = new ActivationEventService();
    const d = svc.registerToolEvents("t", ["onCommand:x"]);
    expect(svc.getToolsForEvent("onCommand:x")).toEqual(["t"]);
    d.dispose();
    expect(svc.getToolsForEvent("onCommand:x")).toEqual([]);
  });
});

describe("ActivationEventService — firing events", () => {
  it("fireCommand routes to tools listening on onCommand:<id>", () => {
    const svc = new ActivationEventService();
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["onCommand:foo"]);
    svc.fireCommand("foo");
    expect(reqs).toHaveLength(1);
    expect(reqs[0].toolId).toBe("t");
    expect(reqs[0].event.raw).toBe("onCommand:foo");
  });

  it("fireView routes to tools listening on onView:<id>", () => {
    const svc = new ActivationEventService();
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["onView:explorer"]);
    svc.fireView("explorer");
    expect(reqs.map((r) => r.toolId)).toEqual(["t"]);
  });

  it("fireStartupFinished fires both * and onStartupFinished and is idempotent", () => {
    const svc = new ActivationEventService();
    const fired: ParsedActivationEvent[] = [];
    svc.onDidFireEvent((e) => fired.push(e));
    svc.fireStartupFinished();
    svc.fireStartupFinished(); // idempotent
    expect(fired.map((e) => e.raw)).toEqual(["*", "onStartupFinished"]);
    expect(svc.startupFinished).toBe(true);
  });

  it("fires onDidFireEvent for observability whether or not any tool is listening", () => {
    const svc = new ActivationEventService();
    const fired: ParsedActivationEvent[] = [];
    svc.onDidFireEvent((e) => fired.push(e));
    svc.fireCommand("noone-listens");
    expect(fired).toHaveLength(1);
    expect(fired[0].raw).toBe("onCommand:noone-listens");
  });
});

describe("ActivationEventService — replay", () => {
  it("queues events that fire before any tool registers and replays them on registration", () => {
    const svc = new ActivationEventService();
    svc.fireCommand("foo"); // no listener yet
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["onCommand:foo"]);
    expect(reqs.map((r) => r.toolId)).toEqual(["t"]);
  });

  it("a tool registering * after startup is immediately requested", () => {
    const svc = new ActivationEventService();
    svc.fireStartupFinished();
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["*"]);
    expect(reqs.map((r) => r.event.kind)).toEqual([ActivationEventKind.Star]);
  });

  it("a tool registering onStartupFinished after startup is immediately requested", () => {
    const svc = new ActivationEventService();
    svc.fireStartupFinished();
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["onStartupFinished"]);
    expect(reqs.map((r) => r.event.kind)).toEqual([ActivationEventKind.OnStartupFinished]);
  });

  it("a tool registering * before startup is NOT activated until startup fires", () => {
    const svc = new ActivationEventService();
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["*"]);
    expect(reqs).toHaveLength(0);
    svc.fireStartupFinished();
    expect(reqs.map((r) => r.event.kind)).toEqual([ActivationEventKind.Star]);
  });
});

describe("ActivationEventService — deduplication", () => {
  it("markActivated prevents subsequent activation requests for the same tool", () => {
    const svc = new ActivationEventService();
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["onCommand:foo"]);
    svc.fireCommand("foo");
    svc.markActivated("t");
    svc.fireCommand("foo");
    expect(reqs).toHaveLength(1);
    expect(svc.isActivated("t")).toBe(true);
  });

  it("clearActivated re-enables activation requests", () => {
    const svc = new ActivationEventService();
    const reqs: ActivationRequest[] = [];
    svc.onDidRequestActivation((e) => reqs.push(e));
    svc.registerToolEvents("t", ["onCommand:foo"]);
    svc.markActivated("t");
    svc.fireCommand("foo");
    expect(reqs).toHaveLength(0);
    svc.clearActivated("t");
    expect(svc.isActivated("t")).toBe(false);
    svc.fireCommand("foo");
    expect(reqs).toHaveLength(1);
  });
});

describe("ActivationEventService — getToolsForEvent", () => {
  it("aggregates multiple tools listening to the same event", () => {
    const svc = new ActivationEventService();
    svc.registerToolEvents("a", ["onView:x"]);
    svc.registerToolEvents("b", ["onView:x"]);
    expect([...svc.getToolsForEvent("onView:x")].sort()).toEqual(["a", "b"]);
  });
});
