/**
 * Pin: cronTools/surfaceTools/subagentTools — tool factory output for the
 * three remaining built-in chat tool bundles without dedicated tests. Pins
 * wire-protocol names, descriptions, and permission posture (the user-trust
 * contract). The permission decision for cron tools is delegated to
 * openclawToolPolicy.cronToolPermissionLevel, which is exercised here via
 * the factories themselves.
 */
import { describe, it, expect } from "vitest";
import {
  createCronStatusTool,
  createCronListTool,
  createCronAddTool,
  createCronUpdateTool,
  createCronRemoveTool,
  createCronRunTool,
  createCronRunsTool,
  createCronWakeTool,
  createCronTools,
  CRON_TOOL_NAMES,
} from "../../src/built-in/chat/tools/cronTools";
import {
  createSurfaceSendTool,
  createSurfaceListTool,
} from "../../src/built-in/chat/tools/surfaceTools";
import {
  createSessionsSpawnTool,
  SUBAGENT_TOOL_NAMES,
} from "../../src/built-in/chat/tools/subagentTools";

// ---------------------------------------------------------------------------
// cronTools
// ---------------------------------------------------------------------------

const cronAll = [
  createCronStatusTool(undefined),
  createCronListTool(undefined),
  createCronAddTool(undefined),
  createCronUpdateTool(undefined),
  createCronRemoveTool(undefined),
  createCronRunTool(undefined),
  createCronRunsTool(undefined),
  createCronWakeTool(undefined),
];

describe("cronTools — wire-protocol names", () => {
  it("pins CRON_TOOL_NAMES order: status/list/add/update/remove/run/runs/wake", () => {
    expect([...CRON_TOOL_NAMES]).toEqual([
      "cron_status",
      "cron_list",
      "cron_add",
      "cron_update",
      "cron_remove",
      "cron_run",
      "cron_runs",
      "cron_wake",
    ]);
  });

  it("createCronTools emits exactly the 8 tools in CRON_TOOL_NAMES order", () => {
    const tools = createCronTools(undefined);
    expect(tools.map((t) => t.name)).toEqual([...CRON_TOOL_NAMES]);
  });

  it("each factory emits the expected name in canonical order", () => {
    expect(cronAll.map((t) => t.name)).toEqual([...CRON_TOOL_NAMES]);
  });
});

describe("cronTools — descriptions", () => {
  it("pins exact one-line descriptions", () => {
    expect(cronAll[0].description).toBe("Cron scheduler status.");
    expect(cronAll[1].description).toBe("List scheduled cron jobs.");
    expect(cronAll[2].description).toBe(
      "Schedule a cron job. Exactly one of schedule.at/every/cron.",
    );
    expect(cronAll[3].description).toBe("Update a cron job.");
    expect(cronAll[4].description).toBe("Remove a cron job.");
    expect(cronAll[5].description).toBe("Fire a cron job immediately.");
    expect(cronAll[6].description).toBe("List cron fire history.");
    expect(cronAll[7].description).toBe("Check for due cron jobs now.");
  });
});

describe("cronTools — permission posture (M58 contract via cronToolPermissionLevel)", () => {
  it("MUTATIONS require approval + confirmation: add/update/remove", () => {
    for (const t of [cronAll[2], cronAll[3], cronAll[4]]) {
      expect(t.requiresConfirmation, t.name).toBe(true);
      expect(t.permissionLevel, t.name).toBe("requires-approval");
    }
  });

  it("READS + RUN + WAKE are always-allowed, no confirmation: status/list/run/runs/wake", () => {
    for (const t of [cronAll[0], cronAll[1], cronAll[5], cronAll[6], cronAll[7]]) {
      expect(t.requiresConfirmation, t.name).toBe(false);
      expect(t.permissionLevel, t.name).toBe("always-allowed");
    }
  });
});

describe("cronTools — required-fields contract", () => {
  it("cron_add requires [name, schedule, payload]", () => {
    const p = cronAll[2].parameters as any;
    expect(p.required).toEqual(["name", "schedule", "payload"]);
  });

  it("cron_update requires [id]", () => {
    const p = cronAll[3].parameters as any;
    expect(p.required).toEqual(["id"]);
  });

  it("cron_remove requires [id]", () => {
    const p = cronAll[4].parameters as any;
    expect(p.required).toEqual(["id"]);
  });

  it("cron_run requires [id]", () => {
    const p = cronAll[5].parameters as any;
    expect(p.required).toEqual(["id"]);
  });

  it("cron_status / cron_list / cron_wake take no parameters", () => {
    for (const t of [cronAll[0], cronAll[1], cronAll[7]]) {
      const p = t.parameters as any;
      expect(p.properties, t.name).toEqual({});
      expect(p.required, t.name).toBeUndefined();
    }
  });

  it("cron_runs has optional jobId filter only (no required fields)", () => {
    const p = cronAll[6].parameters as any;
    expect(p.required).toBeUndefined();
    expect(Object.keys(p.properties)).toEqual(["jobId"]);
  });

  it("cron_add wakeMode + cron_update wakeMode enum = [now, next-heartbeat]", () => {
    const addP = cronAll[2].parameters as any;
    const updP = cronAll[3].parameters as any;
    expect(addP.properties.wakeMode.enum).toEqual(["now", "next-heartbeat"]);
    expect(updP.properties.wakeMode.enum).toEqual(["now", "next-heartbeat"]);
  });
});

// ---------------------------------------------------------------------------
// surfaceTools
// ---------------------------------------------------------------------------

const surfaceSend = createSurfaceSendTool(undefined);
const surfaceList = createSurfaceListTool(undefined);

describe("surfaceTools — wire-protocol names + posture", () => {
  it("pins names: surface_send, surface_list", () => {
    expect(surfaceSend.name).toBe("surface_send");
    expect(surfaceList.name).toBe("surface_list");
  });

  it("pins display summaries", () => {
    expect(surfaceSend.displaySummary).toBe(
      "Send content to an output surface (approval).",
    );
    expect(surfaceList.displaySummary).toBe("List output surfaces.");
  });

  it("surface_send is uniform requires-approval + confirmation (M58)", () => {
    expect(surfaceSend.requiresConfirmation).toBe(true);
    expect(surfaceSend.permissionLevel).toBe("requires-approval");
  });

  it("surface_list is always-allowed, no confirmation", () => {
    expect(surfaceList.requiresConfirmation).toBe(false);
    expect(surfaceList.permissionLevel).toBe("always-allowed");
  });

  it("surface_send requires [surfaceId, content] with contentType enum [text, structured, binary, action]", () => {
    const p = surfaceSend.parameters as any;
    expect(p.required).toEqual(["surfaceId", "content"]);
    expect(p.properties.contentType.enum).toEqual([
      "text",
      "structured",
      "binary",
      "action",
    ]);
  });

  it("surface_list takes no parameters", () => {
    const p = surfaceList.parameters as any;
    expect(p.properties).toEqual({});
    expect(p.required).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// subagentTools (M58 W5)
// ---------------------------------------------------------------------------

const sessionsSpawn = createSessionsSpawnTool(undefined);

describe("subagentTools — sessions_spawn contract (privileged, always approval-gated)", () => {
  it("SUBAGENT_TOOL_NAMES pins exactly [sessions_spawn]", () => {
    expect([...SUBAGENT_TOOL_NAMES]).toEqual(["sessions_spawn"]);
  });

  it("name + description pinned", () => {
    expect(sessionsSpawn.name).toBe("sessions_spawn");
    expect(sessionsSpawn.description).toBe(
      "Spawn a subagent for a delegated task. Returns its final response. Max depth 1.",
    );
  });

  it("ALWAYS requires-approval + confirmation (no read-only / dev-mode bypass)", () => {
    expect(sessionsSpawn.requiresConfirmation).toBe(true);
    expect(sessionsSpawn.permissionLevel).toBe("requires-approval");
  });

  it("requires [task]; optional label/model/tools/timeoutMs", () => {
    const p = sessionsSpawn.parameters as any;
    expect(p.required).toEqual(["task"]);
    expect(Object.keys(p.properties).sort()).toEqual(
      ["label", "model", "task", "timeoutMs", "tools"],
    );
    expect(p.properties.tools.type).toBe("array");
    expect(p.properties.tools.items.type).toBe("string");
  });
});
