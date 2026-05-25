/**
 * Pin: ViewLifecyclePhase enum — emitted by view manager state transitions.
 */
import { describe, it, expect } from "vitest";
import { ViewLifecyclePhase } from "../../src/views/viewTypes";

describe("ViewLifecyclePhase enum", () => {
  it("pins exact string values for each phase", () => {
    expect(ViewLifecyclePhase.Registered).toBe("registered");
    expect(ViewLifecyclePhase.Created).toBe("created");
    expect(ViewLifecyclePhase.Visible).toBe("visible");
    expect(ViewLifecyclePhase.Hidden).toBe("hidden");
    expect(ViewLifecyclePhase.Focused).toBe("focused");
    expect(ViewLifecyclePhase.Disposed).toBe("disposed");
  });

  it("has exactly 6 distinct phases", () => {
    const all = [
      ViewLifecyclePhase.Registered,
      ViewLifecyclePhase.Created,
      ViewLifecyclePhase.Visible,
      ViewLifecyclePhase.Hidden,
      ViewLifecyclePhase.Focused,
      ViewLifecyclePhase.Disposed,
    ];
    expect(new Set(all).size).toBe(6);
  });
});
