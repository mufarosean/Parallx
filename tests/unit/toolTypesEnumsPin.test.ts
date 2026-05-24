/**
 * Pin tests for the runtime enums exported from src/tools/toolTypes.ts.
 *
 * Pins (these string values are persisted to disk in registry state and
 * change events — must remain stable):
 *   - ToolState.* values exactly: discovered/registered/activating/activated/
 *     deactivating/deactivated/disposed.
 *   - ToolEnablementState.* values: EnabledGlobally/DisabledGlobally.
 *   - ActivationEventKind.* values: '*', onStartupFinished, onCommand, onView.
 */
import { describe, it, expect } from "vitest";
import { ToolState, ToolEnablementState, ActivationEventKind } from "../../src/tools/toolTypes";

describe("tools/toolTypes — ToolState", () => {
  it("pins all string values", () => {
    expect(ToolState.Discovered).toBe("discovered");
    expect(ToolState.Registered).toBe("registered");
    expect(ToolState.Activating).toBe("activating");
    expect(ToolState.Activated).toBe("activated");
    expect(ToolState.Deactivating).toBe("deactivating");
    expect(ToolState.Deactivated).toBe("deactivated");
    expect(ToolState.Disposed).toBe("disposed");
  });

  it("has exactly seven members", () => {
    const values = Object.values(ToolState).filter(v => typeof v === "string");
    expect(values.length).toBe(7);
  });
});

describe("tools/toolTypes — ToolEnablementState", () => {
  it("pins enabled/disabled string values", () => {
    expect(ToolEnablementState.EnabledGlobally).toBe("EnabledGlobally");
    expect(ToolEnablementState.DisabledGlobally).toBe("DisabledGlobally");
  });
});

describe("tools/toolTypes — ActivationEventKind", () => {
  it("pins event kind string values", () => {
    expect(ActivationEventKind.Star).toBe("*");
    expect(ActivationEventKind.OnStartupFinished).toBe("onStartupFinished");
    expect(ActivationEventKind.OnCommand).toBe("onCommand");
    expect(ActivationEventKind.OnView).toBe("onView");
  });
});
