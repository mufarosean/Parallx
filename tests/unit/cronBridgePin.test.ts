import { describe, it, expect, vi } from "vitest";
import { CronBridge, type IExtensionCronJob } from "../../src/api/bridges/cronBridge";
import type { ICronJob } from "../../src/openclaw/openclawCronService";

function makeService() {
  const jobs: ICronJob[] = [];
  let seq = 0;
  const addJob = vi.fn((args: any) => {
    const job: ICronJob = {
      id: `cron-${++seq}`,
      name: args.name,
      schedule: args.schedule,
      payload: args.payload,
      wakeMode: args.wakeMode,
      contextMessages: args.contextMessages,
      enabled: args.enabled,
      description: args.description,
      createdAt: 0,
      nextRunAt: 0,
    } as unknown as ICronJob;
    jobs.push(job);
    return job;
  });
  const updateJob = vi.fn((id: string, update: any) => {
    const j = jobs.find(j => j.id === id);
    if (j) Object.assign(j as any, update);
    return j;
  });
  const removeJob = vi.fn((id: string) => {
    const i = jobs.findIndex(j => j.id === id);
    if (i < 0) return false;
    jobs.splice(i, 1);
    return true;
  });
  return { addJob, updateJob, removeJob, get jobs() { return jobs; } } as any;
}

const baseJob: IExtensionCronJob = {
  id: "budget.sync",
  schedule: { every: "30m" } as any,
  payload: { kind: "noop" } as any,
};

describe("CronBridge pin", () => {
  it("upsertJob inserts a new job with name == job.id and default fields", () => {
    const svc = makeService();
    const bridge = new CronBridge("toolA", svc);
    bridge.upsertJob(baseJob);
    expect(svc.addJob).toHaveBeenCalledTimes(1);
    const args = svc.addJob.mock.calls[0][0];
    expect(args.name).toBe("budget.sync");
    expect(args.wakeMode).toBe("next-heartbeat");
    expect(args.contextMessages).toBe(0);
    expect(args.enabled).toBe(true);
    expect(svc.updateJob).not.toHaveBeenCalled();
  });

  it("upsertJob preserves caller-provided wakeMode/contextMessages/enabled on insert", () => {
    const svc = makeService();
    const bridge = new CronBridge("toolA", svc);
    bridge.upsertJob({
      ...baseJob,
      wakeMode: "wake-app" as any,
      contextMessages: 3,
      enabled: false,
      description: "hi",
    });
    const args = svc.addJob.mock.calls[0][0];
    expect(args.wakeMode).toBe("wake-app");
    expect(args.contextMessages).toBe(3);
    expect(args.enabled).toBe(false);
    expect(args.description).toBe("hi");
  });

  it("second upsert with identical schedule does NOT forward schedule (defence-in-depth against nextRunAt reset)", () => {
    const svc = makeService();
    const bridge = new CronBridge("t", svc);
    bridge.upsertJob(baseJob);
    bridge.upsertJob(baseJob);
    expect(svc.updateJob).toHaveBeenCalledTimes(1);
    const update = svc.updateJob.mock.calls[0][1];
    expect("schedule" in update).toBe(false);
    expect(update.payload).toBe(baseJob.payload);
  });

  it("upsert with changed schedule DOES forward schedule", () => {
    const svc = makeService();
    const bridge = new CronBridge("t", svc);
    bridge.upsertJob(baseJob);
    bridge.upsertJob({ ...baseJob, schedule: { every: "1h" } as any });
    const update = svc.updateJob.mock.calls[0][1];
    expect(update.schedule).toEqual({ every: "1h" });
  });

  it("upsert only forwards optional fields when caller provides them", () => {
    const svc = makeService();
    const bridge = new CronBridge("t", svc);
    bridge.upsertJob(baseJob);
    bridge.upsertJob({ ...baseJob, enabled: false });
    const update = svc.updateJob.mock.calls[0][1];
    expect(update.enabled).toBe(false);
    expect("wakeMode" in update).toBe(false);
    expect("contextMessages" in update).toBe(false);
  });

  it("removeJob returns false when no job matches the public id; true after delegating to service", () => {
    const svc = makeService();
    const bridge = new CronBridge("t", svc);
    expect(bridge.removeJob("nope")).toBe(false);
    bridge.upsertJob(baseJob);
    expect(bridge.removeJob("budget.sync")).toBe(true);
    expect(svc.removeJob).toHaveBeenCalledTimes(1);
    expect(svc.jobs.length).toBe(0);
  });

  it("getJob looks up by public id (== service-side name)", () => {
    const svc = makeService();
    const bridge = new CronBridge("t", svc);
    bridge.upsertJob(baseJob);
    const found = bridge.getJob("budget.sync");
    expect(found).toBeDefined();
    expect(found!.name).toBe("budget.sync");
    expect(bridge.getJob("nope")).toBeUndefined();
  });

  it("schedule equality is keyed on at/every/cron", () => {
    const svc = makeService();
    const bridge = new CronBridge("t", svc);
    bridge.upsertJob({ ...baseJob, schedule: { cron: "* * * * *" } as any });
    bridge.upsertJob({ ...baseJob, schedule: { cron: "* * * * *" } as any });
    expect("schedule" in svc.updateJob.mock.calls[0][1]).toBe(false);
    bridge.upsertJob({ ...baseJob, schedule: { at: 12345 } as any });
    expect(svc.updateJob.mock.calls[1][1].schedule).toEqual({ at: 12345 });
  });
});
