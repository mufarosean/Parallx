// plannerReminderScheduler.ts — minimal in-process reminder firing.
//
// On a 60s tick, asks the data service for tasks whose reminder_at has
// passed and reminder_fired = 0. Each such task: dispatch a notification
// via api.window.showInformationMessage with an "Open Planner" action,
// and stamp reminder_fired = 1 so the same reminder doesn't repeat.

import type { IDisposable } from '../../platform/lifecycle.js';
import type { PlannerDataService } from './plannerDataService.js';

interface SchedulerApi {
  commands: { executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T> };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
}

const TICK_MS = 60_000;

export class PlannerReminderScheduler implements IDisposable {
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _disposed = false;

  constructor(
    private readonly _data: PlannerDataService,
    private readonly _api: SchedulerApi,
  ) {}

  start(): void {
    if (this._timer || this._disposed) return;
    this._timer = setInterval(() => { void this._tick(); }, TICK_MS);
    // Fire once at startup so missed reminders from a long sleep surface immediately.
    void this._tick();
  }

  private async _tick(): Promise<void> {
    if (this._disposed) return;
    let due;
    try {
      due = await this._data.listDueReminders(Date.now());
    } catch (err) {
      console.warn('[Planner] reminder scheduler: listDueReminders failed', err);
      return;
    }
    for (const task of due) {
      try {
        await this._data.markReminderFired(task.id);
        const result = await this._api.window.showInformationMessage(
          `Reminder: ${task.title}`,
          { title: 'Open Planner' }, { title: 'Snooze 1h' }, { title: 'Dismiss' },
        );
        if (result?.title === 'Open Planner') {
          await this._api.commands.executeCommand('planner.open');
        } else if (result?.title === 'Snooze 1h') {
          await this._data.updateTask(task.id, {
            reminderAt: Date.now() + 60 * 60 * 1000,
          });
        }
      } catch (err) {
        console.warn('[Planner] reminder dispatch failed for task', task.id, err);
      }
    }
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
