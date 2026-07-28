// dashboardRefreshScheduler.ts — tiny, dashboard-local refresh scheduler.
//
// Why not ICronService? Its CronTurnExecutor signature fires agent turns
// (`(job, contextLines) => void`) and there's only one executor per
// service, owned by the chat tool. We need a generic "run this callback"
// scheduler, which is ~60 lines.
//
// What we reuse: parseDuration / parseCronField / computeNextCronRun
// from openclawCronService — same parsing surface, no duplicate parser.
//
// Guardrails:
//   - 60s minimum interval at scheduling time
//   - Single-flight per instanceId (overlap → no-op)
//   - AI-concurrency cap (queue the rest, FIFO). Live value comes from the
//     `dashboard.aiRefreshConcurrency` setting via the constructor getter;
//     falls back to DASHBOARD_LIMITS.MAX_CONCURRENT_AI_REFRESHES (M86 C4).
//   - Per-refresh timeout via Promise.race: 60s for query/static widgets,
//     5min for AI widgets (a background agent turn legitimately takes minutes)

import { Disposable, toDisposable, type IDisposable } from '../../platform/lifecycle.js';
import { parseDuration } from '../../openclaw/openclawCronService.js';
import type { WidgetRefreshPolicy, WidgetTypeRegistration } from './dashboardTypes.js';
import { DASHBOARD_LIMITS } from './dashboardTypes.js';

// computeNextCronRun is not exported from openclawCronService — only parseDuration
// and parseCronField are. We re-derive next-fire from parseCronField for now;
// the dashboard's cron support only needs "schedule the next fire timer", which
// the helpers below compute identically.

import { parseCronField } from '../../openclaw/openclawCronService.js';

function computeNextCronMs(expr: string, fromMs: number): number | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const minutes = new Set(parseCronField(parts[0], 0, 59));
  const hours = new Set(parseCronField(parts[1], 0, 23));
  const dom = new Set(parseCronField(parts[2], 1, 31));
  const months = new Set(parseCronField(parts[3], 1, 12));
  const dow = new Set(parseCronField(parts[4], 0, 6));

  const start = new Date(fromMs);
  start.setUTCSeconds(0, 0);
  start.setUTCMinutes(start.getUTCMinutes() + 1);
  const limit = fromMs + 366 * 86_400_000;

  const c = start;
  while (c.getTime() <= limit) {
    const mo = c.getUTCMonth() + 1;
    if (!months.has(mo)) { c.setUTCMonth(c.getUTCMonth() + 1, 1); c.setUTCHours(0, 0, 0, 0); continue; }
    const d = c.getUTCDate(); const wd = c.getUTCDay();
    if (!dom.has(d) || !dow.has(wd)) { c.setUTCDate(c.getUTCDate() + 1); c.setUTCHours(0, 0, 0, 0); continue; }
    const hr = c.getUTCHours();
    if (!hours.has(hr)) { c.setUTCHours(c.getUTCHours() + 1, 0, 0, 0); continue; }
    const mn = c.getUTCMinutes();
    if (!minutes.has(mn)) { c.setUTCMinutes(c.getUTCMinutes() + 1, 0, 0); continue; }
    return c.getTime();
  }
  return null;
}

// ─── Public types ────────────────────────────────────────────────────────────

export interface ScheduledRefresh {
  readonly instanceId: string;
  readonly typeId: string;
  readonly policy: WidgetRefreshPolicy;
  readonly invoke: () => Promise<void>;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export class DashboardRefreshScheduler extends Disposable {
  /** Active timer handles, keyed by instanceId. */
  private readonly _timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** In-flight refresh promises for single-flight enforcement. */
  private readonly _inFlight = new Map<string, Promise<void>>();
  /** Queue of pending AI refreshes when the AI-concurrency cap is reached. */
  private readonly _aiQueue: { invoke: () => Promise<void>; resolve: () => void; reject: (e: unknown) => void }[] = [];
  /** Currently active AI refresh count. */
  private _aiInFlight = 0;

  /** Map instanceId → registration kind (so we know whether AI-cap applies). */
  private readonly _instanceTypeMap = new Map<string, WidgetTypeRegistration<unknown>>();

  /**
   * @param getAiConcurrency Live AI-concurrency cap (the
   *   `dashboard.aiRefreshConcurrency` setting). Read at each admission
   *   decision so setting changes apply without restart. Clamped to 1-8.
   */
  constructor(private readonly _getAiConcurrency?: () => number) {
    super();
  }

  private _aiCap(): number {
    const raw = this._getAiConcurrency?.();
    const v = typeof raw === 'number' && Number.isFinite(raw)
      ? Math.floor(raw)
      : DASHBOARD_LIMITS.MAX_CONCURRENT_AI_REFRESHES;
    return Math.max(1, Math.min(8, v));
  }

  override dispose(): void {
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
    this._inFlight.clear();
    this._aiQueue.length = 0;
    super.dispose();
  }

  /**
   * Schedule periodic refreshes for a widget instance. Returns a disposable
   * that cancels the schedule. Idempotent — calling again with the same
   * instanceId cancels the previous schedule first.
   */
  schedule(
    instanceId: string,
    typeReg: WidgetTypeRegistration<unknown>,
    policy: WidgetRefreshPolicy,
    invoke: () => Promise<void>,
  ): IDisposable {
    this.cancel(instanceId);
    this._instanceTypeMap.set(instanceId, typeReg);

    if (policy.kind === 'manual') {
      // Nothing to schedule — manual refresh fires via runOnce() from the
      // mounted UI button.
      return toDisposable(() => { this.cancel(instanceId); });
    }

    if (policy.kind === 'interval') {
      const ms = Math.max(DASHBOARD_LIMITS.MIN_REFRESH_INTERVAL_MS, policy.ms);
      const tick = () => {
        if (this.isBackedOff(instanceId)) {
          console.info(`[Dashboard] refresh for ${instanceId} skipped (failure backoff)`);
        } else {
          void this.runOnce(instanceId, invoke).catch((err) => {
            console.warn(`[Dashboard] interval refresh failed for ${instanceId}:`, err);
          });
        }
        // Reschedule self — using setTimeout rather than setInterval so we never
        // overlap with our own previous tick if it takes longer than the interval.
        this._timers.set(instanceId, setTimeout(tick, ms));
      };
      this._timers.set(instanceId, setTimeout(tick, ms));
      return toDisposable(() => { this.cancel(instanceId); });
    }

    if (policy.kind === 'cron') {
      const scheduleNext = () => {
        const next = computeNextCronMs(policy.cron, Date.now());
        if (next === null) return; // unparseable / no future fire
        const delay = Math.max(DASHBOARD_LIMITS.MIN_REFRESH_INTERVAL_MS, next - Date.now());
        this._timers.set(instanceId, setTimeout(() => {
          if (this.isBackedOff(instanceId)) {
            console.info(`[Dashboard] cron refresh for ${instanceId} skipped (failure backoff)`);
          } else {
            void this.runOnce(instanceId, invoke).catch((err) => {
              console.warn(`[Dashboard] cron refresh failed for ${instanceId}:`, err);
            });
          }
          scheduleNext();
        }, delay));
      };
      scheduleNext();
      return toDisposable(() => { this.cancel(instanceId); });
    }

    return toDisposable(() => {});
  }

  /** Cancel any scheduled refreshes for an instance. */
  cancel(instanceId: string): void {
    const t = this._timers.get(instanceId);
    if (t) {
      clearTimeout(t);
      this._timers.delete(instanceId);
    }
    this._instanceTypeMap.delete(instanceId);
  }

  /**
   * Execute a single refresh now. Honors single-flight (overlapping calls
   * receive the same promise) and AI-concurrency caps.
   *
   * @param typeReg Optional registration for callers that never `schedule()`d
   *   this instance (headless page-schedule refreshes, M86 C4) — recorded so
   *   the AI cap and AI timeout apply, WITHOUT touching any timer an open
   *   editor may have installed for the same instance.
   */
  async runOnce(instanceId: string, invoke: () => Promise<void>, typeRegOverride?: WidgetTypeRegistration<unknown>): Promise<void> {
    const existing = this._inFlight.get(instanceId);
    if (existing) return existing;

    if (typeRegOverride && !this._instanceTypeMap.has(instanceId)) {
      this._instanceTypeMap.set(instanceId, typeRegOverride);
    }
    const typeReg = this._instanceTypeMap.get(instanceId);
    const isAI = typeReg?.category === 'ai';

    // Slot accounting is tied to the UNDERLYING work settling, not to the
    // timeout race: releasing on timeout let interval policies stack fresh
    // AI turns onto a provider still chewing the stalled one (amplification).
    // A generous backstop still frees the slot if the work truly wedges.
    let released = false;
    const releaseOnce = (claimedAiSlot: boolean) => {
      if (released) return;
      released = true;
      this._inFlight.delete(instanceId);
      if (claimedAiSlot) {
        this._aiInFlight--;
        this._drainAIQueue();
      }
    };

    const start = async (claimedAiSlot: boolean) => {
      const timeoutMs = isAI ? DASHBOARD_LIMITS.AI_REFRESH_TIMEOUT_MS : DASHBOARD_LIMITS.REFRESH_TIMEOUT_MS;
      const inner = invoke();
      const backstop = setTimeout(() => releaseOnce(claimedAiSlot), timeoutMs + 120_000);
      void inner.catch(() => { /* observed below */ }).finally(() => {
        clearTimeout(backstop);
        releaseOnce(claimedAiSlot);
      });
      let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<void>((_, reject) => {
        timeoutTimer = setTimeout(() => reject(new Error(`Refresh timed out after ${timeoutMs}ms`)), timeoutMs);
      });
      try {
        await Promise.race([inner, timeoutPromise]);
        this._recordOutcome(instanceId, true);
      } catch (err) {
        this._recordOutcome(instanceId, false);
        throw err;
      } finally {
        if (timeoutTimer) clearTimeout(timeoutTimer);
      }
    };

    if (isAI && this._aiInFlight >= this._aiCap()) {
      // Queue behind any in-flight AI refresh. The queued job claims its AI
      // slot when the drain starts it (drain increments; releaseOnce pairs).
      const promise = new Promise<void>((resolve, reject) => {
        this._aiQueue.push({
          invoke: async () => {
            try { await start(true); resolve(); } catch (e) { reject(e); }
          },
          resolve,
          reject,
        });
      });
      this._inFlight.set(instanceId, promise);
      return promise;
    }

    if (isAI) {
      this._aiInFlight++;
      const promise = start(true);
      this._inFlight.set(instanceId, promise);
      return promise;
    }

    const promise = start(false);
    this._inFlight.set(instanceId, promise);
    return promise;
  }

  private _drainAIQueue(): void {
    while (
      this._aiQueue.length > 0
      && this._aiInFlight < this._aiCap()
    ) {
      const job = this._aiQueue.shift()!;
      // The slot is claimed here; the job's start(true) releases it when the
      // underlying work settles.
      this._aiInFlight++;
      void Promise.resolve().then(job.invoke).catch(() => { /* job rejects to its caller */ });
    }
  }

  // ── Failure backoff ────────────────────────────────────────────────────────
  // Scheduled fires skip while a widget is in a failure streak: interval
  // policies used to re-hit a broken provider every tick, forever. Manual
  // Refresh clicks bypass the gate; any success resets the streak.

  private readonly _failures = new Map<string, { count: number; nextAllowedAt: number }>();

  private _recordOutcome(instanceId: string, ok: boolean): void {
    if (ok) {
      this._failures.delete(instanceId);
      return;
    }
    const prev = this._failures.get(instanceId);
    const count = (prev?.count ?? 0) + 1;
    const delayMs = Math.min(60_000 * 2 ** (count - 1), 30 * 60_000);
    this._failures.set(instanceId, { count, nextAllowedAt: Date.now() + delayMs });
  }

  /** True when scheduled fires should skip this instance (failure streak). */
  isBackedOff(instanceId: string): boolean {
    const f = this._failures.get(instanceId);
    return !!f && Date.now() < f.nextAllowedAt;
  }
}

/**
 * Lightweight validator for `WidgetRefreshPolicy` at registration time.
 * Rejects sub-60s intervals (rather than silently clamping at runtime).
 * Canonical implementation lives with the contribution contract in the
 * API bridge so extension-side and dashboard-side validation can't drift.
 */
export { validateWidgetRefreshPolicy as validateRefreshPolicy } from '../../api/bridges/dashboardBridge.js';

// Re-export parseDuration so widgets writing UIs that take "5m"-style strings
// can validate user input consistently with the scheduler.
export { parseDuration };
