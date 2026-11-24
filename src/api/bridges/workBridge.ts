// workBridge.ts — the `parallx.work` namespace: time worked, counted one way and reported to whoever keeps a record
//
// Two things, both the core's and neither naming a tool:
//   the clock      `createClock` runs the core's idle-aware clock
//                  (services/workClock.ts) against a surface of the tool's;
//                  `createClockStatus` is the line that says it has stopped
//   the providers  a tool reports its work by day and group
//                  (`registerProvider`), and a tool that keeps a record
//                  reads every provider (`providers`)
// Everything a tool starts here stops when the tool does: its clocks (their
// last seconds handed over first), its provider, what it listens to.

import type { IDisposable } from '../../platform/lifecycle.js';
import { createWorkClock, getIdleMinutes, workDayOf, type IWorkClock, type IWorkClockOptions } from '../../services/workClock.js';
import { cleanWorkEntries, listWorkProviders, onDidChangeWorkProviders, registerWorkProvider, type IWorkProvider } from '../../services/workProviders.js';
import { createClockStatus } from '../../ui/clockStatus.js';

/** What `api.work` is: the object `createWorkApi` builds, typed once here. */
export type WorkApi = ReturnType<typeof createWorkApi>;

export function createWorkApi(toolId: string, subscriptions: IDisposable[]) {
  const keep = <T extends IDisposable>(d: T): T => { subscriptions.push(d); return d; };
  return Object.freeze({
    /** The idle time as it is set now, in minutes (one setting for the whole app). */
    get idleMinutes(): number { return getIdleMinutes(); },
    /** The person's local day of a moment, 'YYYY-MM-DD': the day the clock credits time to. */
    dayOf: (ms: number = Date.now()): string => workDayOf(ms),
    /** The core's clock against a surface of this tool. Disposed with the tool, its last seconds handed to `credit` first. */
    createClock: (options: IWorkClockOptions): IWorkClock => keep(createWorkClock(options)),
    /** The line that says a clock stopped for idleness and that it goes on again: seen, and spoken politely. */
    createClockStatus: (container: HTMLElement | null, clock: IWorkClock, options?: { readonly bar?: boolean }) => keep(createClockStatus(container, clock, options)),
    /** Report this tool's work by day and group. Gone when the tool stops. */
    registerProvider: (provider: Omit<IWorkProvider, 'toolId'>): IDisposable => keep(registerWorkProvider({
      id: provider.id,
      displayName: provider.displayName,
      kind: provider.kind,
      toolId,
      work: async (since?: string) => cleanWorkEntries(await provider.work(since)),
      onDidChange: (listener) => provider.onDidChange(listener),
    })),
    /** Every tool's provider, as registered now. */
    providers: (): readonly IWorkProvider[] => listWorkProviders(),
    onDidChangeProviders: (listener: () => void): IDisposable => keep(onDidChangeWorkProviders(() => listener())),
  });
}
