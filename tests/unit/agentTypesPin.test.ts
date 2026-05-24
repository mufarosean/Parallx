/**
 * Pin: agentTypes — frozen constant tuples for AGENT_* arrays.
 */
import { describe, it, expect } from "vitest";
import {
  AGENT_INTERACTION_MODES,
  AGENT_AUTONOMY_LEVELS,
  AGENT_TASK_STATUSES,
  AGENT_ACTION_CLASSES,
  AGENT_ACTION_POLICIES,
  AGENT_APPROVAL_STATUSES,
  AGENT_APPROVAL_RESOLUTIONS,
} from "../../src/agent/agentTypes";

describe("agent/agentTypes — constant tuples", () => {
  it("AGENT_INTERACTION_MODES", () => {
    expect(AGENT_INTERACTION_MODES).toEqual(["advisor", "researcher", "executor", "reviewer", "operator"]);
  });

  it("AGENT_AUTONOMY_LEVELS", () => {
    expect(AGENT_AUTONOMY_LEVELS).toEqual(["manual", "allow-readonly", "allow-safe-actions", "allow-policy-actions"]);
  });

  it("AGENT_TASK_STATUSES (order matters — lifecycle progression)", () => {
    expect(AGENT_TASK_STATUSES).toEqual([
      "pending", "planning", "awaiting-approval", "running", "blocked", "paused",
      "completed", "failed", "cancelled",
    ]);
  });

  it("AGENT_ACTION_CLASSES", () => {
    expect(AGENT_ACTION_CLASSES).toEqual([
      "read", "search", "write", "edit", "delete", "command",
      "task-state", "approval-sensitive", "unknown",
    ]);
  });

  it("AGENT_ACTION_POLICIES (strict ordering by permissiveness)", () => {
    expect(AGENT_ACTION_POLICIES).toEqual(["allow", "allow-with-notification", "require-approval", "deny"]);
  });

  it("AGENT_APPROVAL_STATUSES + AGENT_APPROVAL_RESOLUTIONS", () => {
    expect(AGENT_APPROVAL_STATUSES).toEqual(["pending", "approved-once", "approved-for-task", "denied", "cancelled"]);
    expect(AGENT_APPROVAL_RESOLUTIONS).toEqual(["approve-once", "approve-for-task", "deny", "cancel-task"]);
  });
});
