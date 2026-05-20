// cronBridge.ts — bridges parallx.cron to CronService (M63 P0)
//
// Provides idempotent upsert keyed by a stable extension-provided id.
// The underlying CronService auto-generates internal ids (`cron-N`), so we
// match by `name` (which the bridge stamps with the user-supplied id) to
// decide insert-vs-update.

import type {
  CronService,
  ICronJob,
  ICronJobUpdateParams,
  ICronSchedule,
  ICronPayload,
  CronWakeMode,
} from '../../openclaw/openclawCronService.js';

function _scheduleEqual(a: ICronSchedule, b: ICronSchedule): boolean {
  return a.at === b.at && a.every === b.every && a.cron === b.cron;
}

/**
 * Public payload accepted by parallx.cron.upsertJob.
 * Stable string `id` is the extension-owned key. Collisions across extensions
 * are avoided by namespacing (e.g. `budget.sync.scheduled`).
 */
export interface IExtensionCronJob {
  readonly id: string;
  readonly schedule: ICronSchedule;
  readonly payload: ICronPayload;
  readonly wakeMode?: CronWakeMode;
  readonly contextMessages?: number;
  readonly description?: string;
  readonly enabled?: boolean;
}

export class CronBridge {
  constructor(
    _toolId: string,
    private readonly _service: CronService,
  ) {
    void _toolId;
  }

  /**
   * Idempotent upsert by stable id.
   *
   * - On insert: a new job is created with name == job.id.
   * - On update: only schedule/payload/description are mutated; user-edited
   *   fields (enabled, wakeMode, contextMessages) are preserved unless the
   *   caller passes them explicitly.
   */
  upsertJob(job: IExtensionCronJob): void {
    const existing = this._findByName(job.id);
    if (existing) {
      // Only forward `schedule` when it actually differs from the
      // currently-stored value. The user's complaint with budget
      // upserting on every app start: every restart was calling
      // updateJob with the same `every: 30m`, and updateJob recomputed
      // nextRunAt forward by 30m, so a user who closed the app within
      // any 30-min window would never see the cron fire. Defence-in-
      // depth — CronService.updateJob also short-circuits via
      // _schedulesEqual, but skipping the field here means schedule
      // changes are an opt-in event, not an accident.
      const scheduleChanged = !_scheduleEqual(job.schedule, existing.schedule);
      const update: ICronJobUpdateParams = {
        payload: job.payload,
        description: job.description,
        ...(scheduleChanged ? { schedule: job.schedule } : {}),
        ...(job.wakeMode !== undefined ? { wakeMode: job.wakeMode } : {}),
        ...(job.contextMessages !== undefined ? { contextMessages: job.contextMessages } : {}),
        ...(job.enabled !== undefined ? { enabled: job.enabled } : {}),
      };
      this._service.updateJob(existing.id, update);
      return;
    }
    this._service.addJob({
      name: job.id,
      schedule: job.schedule,
      payload: job.payload,
      wakeMode: job.wakeMode ?? 'next-heartbeat',
      contextMessages: job.contextMessages ?? 0,
      enabled: job.enabled ?? true,
      description: job.description,
    });
  }

  removeJob(id: string): boolean {
    const existing = this._findByName(id);
    if (!existing) return false;
    return this._service.removeJob(existing.id);
  }

  getJob(id: string): ICronJob | undefined {
    return this._findByName(id);
  }

  private _findByName(name: string): ICronJob | undefined {
    return this._service.jobs.find(j => j.name === name);
  }
}
