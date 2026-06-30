// openclawHeartbeatContext.ts — assembles the app-wide "situational snapshot"
// the heartbeat hands the model on each review.
//
// This is what turns the heartbeat from a file-change reflex into the app's
// awareness loop: instead of "a .ts file changed," the model is told the state
// of the whole app — which background diagnostics are failing, what activity
// happened since the last review — so it can decide whether anything actually
// needs the user's attention. Senses are additive; Phase 1 wires diagnostics +
// workspace activity, later phases add tasks/planner/canvas/extension signals.
//
// Pure by design (snapshot + formatting are testable without a running app);
// the executor supplies the live inputs.

import type { IHeartbeatSystemEvent } from './openclawHeartbeatRunner.js';

/** A compact, model-facing view of app state at review time. */
export interface IHeartbeatAppSnapshot {
  /** Pending workspace events since the last review, grouped by type. */
  readonly events: readonly { readonly type: string; readonly count: number }[];
  /** Total pending events across all types. */
  readonly eventCount: number;
}

/** Build the snapshot from the live inputs. Pure. */
export function buildHeartbeatSnapshot(
  events: readonly IHeartbeatSystemEvent[],
): IHeartbeatAppSnapshot {
  const byType = new Map<string, number>();
  for (const e of events) byType.set(e.type, (byType.get(e.type) ?? 0) + 1);

  return {
    events: [...byType.entries()].map(([type, count]) => ({ type, count })),
    eventCount: events.length,
  };
}

/** True when the snapshot contains anything worth the model's attention. */
export function hasNoteworthySignals(s: IHeartbeatAppSnapshot): boolean {
  return s.eventCount > 0;
}

export interface IWorkspacePageInfo {
  readonly title: string;
  readonly updatedAt?: string;
}

/**
 * Render the user's ACTUAL canvas pages so a review knows their real work — not
 * just that "an event happened." Most-recently-edited first. This is the
 * difference between an agent that can say "you have Q3 Planning and Q3 Budget —
 * link them?" and one that's blind to everything but diagnostics.
 */
export function buildWorkspaceContext(pages: readonly IWorkspacePageInfo[], maxPages = 15): string {
  if (pages.length === 0) return '';
  const sorted = [...pages]
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
    .slice(0, maxPages);
  const lines = [`The user's workspace has ${pages.length} canvas page(s) (most recently worked-on first):`];
  for (const p of sorted) lines.push(`- ${p.title?.trim() || 'Untitled'}`);
  return lines.join('\n');
}

export interface IWorkspaceTaskInfo {
  readonly title: string;
  readonly dueAt?: number | null;
}

/**
 * Render the user's OPEN planner tasks so the review knows their commitments —
 * the second surface the agent should help with ("4 tasks due today, no time
 * blocks — schedule them?").
 */
export function buildTasksContext(tasks: readonly IWorkspaceTaskInfo[], nowMs = Date.now(), maxTasks = 12): string {
  if (tasks.length === 0) return '';
  const soon = nowMs + 24 * 60 * 60 * 1000;
  const dueSoon = tasks.filter(t => typeof t.dueAt === 'number' && (t.dueAt as number) <= soon).length;
  const header = `The user has ${tasks.length} open task(s)${dueSoon > 0 ? ` (${dueSoon} due within a day)` : ''}:`;
  const lines = [header];
  for (const t of tasks.slice(0, maxTasks)) lines.push(`- ${t.title?.trim() || 'Untitled task'}`);
  return lines.join('\n');
}

/**
 * Render one pending event as a human line for the review seed — so the model
 * reads "signal from budget: over monthly cap", not a raw JSON blob. Falls back
 * to type + JSON for event kinds without a friendly form.
 */
export function formatEventLine(ev: IHeartbeatSystemEvent): string {
  const p = (ev.payload ?? {}) as Record<string, unknown>;
  switch (ev.type) {
    case 'extension-signal': {
      const src = typeof p.source === 'string' ? p.source : 'extension';
      const title = typeof p.title === 'string' ? p.title : 'signal';
      const detail = typeof p.detail === 'string' && p.detail ? ` — ${p.detail}` : '';
      const sev = p.severity === 'urgent' || p.severity === 'warn' ? ` [${p.severity}]` : '';
      return `signal from ${src}${sev}: ${title}${detail}`;
    }
    case 'prediction-surprise': {
      const path = typeof p.path === 'string' ? p.path : '(unknown)';
      const pressure = typeof p.pressure === 'number' ? ` (accumulated surprise ${p.pressure})` : '';
      return `prediction surprise${pressure}: reality diverged from my forecast — you touched ${path}. Review what's changed in the user's focus; update beliefs if the pattern has shifted.`;
    }
    case 'habit-confirmed': {
      // A focused decision the agent is GUARANTEED to make — code routes it here;
      // the JUDGMENT (whether/how to offer automation) is the model's, and trusted.
      const action = typeof p.action === 'string' ? p.action : 'a recurring action';
      const when = typeof p.typicalTime === 'string' ? ` around ${p.typicalTime}` : '';
      const cron = typeof p.cron === 'string' ? p.cron : '';
      return `A daily habit just confirmed: "${action}"${when}. Decide, with judgment, whether to OFFER to automate it for the user — and if so, what automation actually helps (a straight repeat? a digest? a reminder?). If it's worth it, propose it in one clear sentence and, on their approval, schedule it with cron_create (a sensible daily schedule is "${cron}"). If automating it would be unhelpful, intrusive, or premature, just respond NOOP. Your call.`;
    }
    case 'file-change':
      return `file changed: ${typeof p.path === 'string' ? p.path : '(unknown)'}`;
    default: {
      let json: string;
      try { json = JSON.stringify(ev.payload); } catch { json = '[unserializable]'; }
      return `${ev.type} · ${json}`;
    }
  }
}

/**
 * Render the snapshot as a compact block for the heartbeat seed. Kept terse —
 * the model gets state, not prose. Always communicates the diagnostics posture
 * (even "all clear") so the model can confidently report nothing-to-do.
 */
export function formatAppContext(s: IHeartbeatAppSnapshot): string {
  const lines: string[] = [];

  // LEAD with what the user has actually been doing — that's what you can help
  // with. (The detailed, human-readable event lines are added by the seed via
  // formatEventLine; this is the at-a-glance summary.)
  if (s.eventCount === 0) {
    lines.push('Recent activity: nothing new since the last review.');
  } else {
    const parts = s.events.map(e => `${e.count} ${e.type}`).join(', ');
    lines.push(`Recent activity: ${parts}.`);
  }

  return lines.join('\n');
}
