/**
 * Pin: toolTypes — ToolState, ToolEnablementState, ActivationEventKind enums
 * shaping the tool lifecycle, enablement service, and activation event parser.
 */
import { describe, it, expect } from "vitest";
import {
  ToolState,
  ToolEnablementState,
  ActivationEventKind,
} from "../../src/tools/toolTypes";

describe("ToolState enum — tool lifecycle phases", () => {
  it("pins exact string values for each phase", () => {
    expect(ToolState.Discovered).toBe("discovered");
    expect(ToolState.Registered).toBe("registered");
    expect(ToolState.Activating).toBe("activating");
    expect(ToolState.Activated).toBe("activated");
    expect(ToolState.Deactivating).toBe("deactivating");
    expect(ToolState.Deactivated).toBe("deactivated");
    expect(ToolState.Disposed).toBe("disposed");
  });

  it("has 7 distinct lifecycle states", () => {
    expect(
      new Set([
        ToolState.Discovered,
        ToolState.Registered,
        ToolState.Activating,
        ToolState.Activated,
        ToolState.Deactivating,
        ToolState.Deactivated,
        ToolState.Disposed,
      ]).size,
    ).toBe(7);
  });
});

describe("ToolEnablementState enum — VS Code subset", () => {
  it("pins exact string values (PascalCase, NOT lowercase)", () => {
    expect(ToolEnablementState.EnabledGlobally).toBe("EnabledGlobally");
    expect(ToolEnablementState.DisabledGlobally).toBe("DisabledGlobally");
  });

  it("has exactly 2 states (no workspace/remote scoping yet)", () => {
    expect(new Set([
      ToolEnablementState.EnabledGlobally,
      ToolEnablementState.DisabledGlobally,
    ]).size).toBe(2);
  });
});

describe("ActivationEventKind enum — M2 activation triggers", () => {
  it("Star === '*' (eager)", () => {
    expect(ActivationEventKind.Star).toBe("*");
  });

  it("OnStartupFinished, OnCommand, OnView pinned strings", () => {
    expect(ActivationEventKind.OnStartupFinished).toBe("onStartupFinished");
    expect(ActivationEventKind.OnCommand).toBe("onCommand");
    expect(ActivationEventKind.OnView).toBe("onView");
  });

  it("4 distinct activation event kinds", () => {
    expect(new Set([
      ActivationEventKind.Star,
      ActivationEventKind.OnStartupFinished,
      ActivationEventKind.OnCommand,
      ActivationEventKind.OnView,
    ]).size).toBe(4);
  });
});
