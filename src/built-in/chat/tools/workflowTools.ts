// workflowTools.ts — the agent's door into the Workflows panel (docs/WORKFLOWS_BRIEF.md, S2).
//
// When the model notices something worth automating (the same ask three
// times in chat, a moment it could prepare for, a check worth standing), it
// used to say so in prose, where the offer scrolled away or nagged. Now it
// files a SUGGESTED WORKFLOW: a disabled document in the Workflows panel, in
// the same row as the habit-derived ones, with Review, Add and Dismiss.
//
// The tool never enables anything. It dedupes on a key the model supplies,
// refuses keys the user has dismissed, and stops after a few suggestions a
// day so the panel never turns into a feed. The panel is the gate; this is
// only the letterbox.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';
import type { WorkflowDoc } from '../../../services/workflows/workflowTypes.js';
import { validateWorkflow } from '../../../services/workflows/workflowGraph.js';
import { WEEKDAY_LABELS, parseTimeOfDay } from '../../../openclaw/cronScheduleSpec.js';

/** Every agent-filed key carries this prefix, so habit keys and agent keys never collide. */
export const AGENT_SUGGESTION_PREFIX = 'agent:';
/** How many suggestions the agent may file per day before it has to hold its tongue. */
export const DEFAULT_AGENT_SUGGESTIONS_PER_DAY = 3;

/** The slice of WorkflowService the tool needs (kept narrow so tests pass a fake). */
export interface IWorkflowSuggestionSink {
  readonly workflows: readonly WorkflowDoc[];
  addWorkflow(doc: Omit<WorkflowDoc, 'id' | 'createdAt' | 'updatedAt'>): WorkflowDoc;
  isSuggestionDismissed(key: string): boolean;
}

export interface IWorkflowSuggestToolOptions {
  readonly maxPerDay?: number;
  readonly now?: () => number;
}

type SuggestedNode = WorkflowDoc['nodes'][number];

/** Normalise the model's key: one idea, one key, regardless of spacing or case. */
export function agentSuggestionKey(raw: string): string {
  return AGENT_SUGGESTION_PREFIX + raw.trim().toLowerCase().replace(/\s+/g, ' ');
}

function startOfDay(nowMs: number): number {
  const d = new Date(nowMs);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Build the trigger node from the model's `trigger` argument, or explain what is wrong with it. */
function buildTrigger(raw: unknown): { node: SuggestedNode; summary: string } | { error: string } {
  const t = (raw && typeof raw === 'object' ? raw : { kind: 'manual' }) as Record<string, unknown>;
  const kind = str(t['kind']) || 'manual';
  switch (kind) {
    case 'manual':
      return { node: { id: 't', label: 'Run Manually', kind: 'trigger.manual', x: 40, y: 80 }, summary: 'from a button in the Workflows panel' };
    case 'daily': {
      const time = str(t['time']);
      if (!parseTimeOfDay(time)) return { error: '`trigger.time` must be "HH:MM" (24-hour) for a daily trigger.' };
      return { node: { id: 't', label: `Daily At ${time}`, kind: 'trigger.schedule', spec: { kind: 'daily', time }, x: 40, y: 80 }, summary: `daily at ${time}` };
    }
    case 'weekly': {
      const time = str(t['time']);
      const day = typeof t['day'] === 'number' ? Math.round(t['day']) : NaN;
      if (!parseTimeOfDay(time)) return { error: '`trigger.time` must be "HH:MM" (24-hour) for a weekly trigger.' };
      if (!(day >= 0 && day <= 6)) return { error: '`trigger.day` must be 0 (Sunday) to 6 (Saturday) for a weekly trigger.' };
      const label = WEEKDAY_LABELS[day] ?? String(day);
      return { node: { id: 't', label: `Weekly On ${label} At ${time}`, kind: 'trigger.schedule', spec: { kind: 'weekly', day, time }, x: 40, y: 80 }, summary: `every ${label} at ${time}` };
    }
    case 'interval': {
      const every = str(t['every']);
      if (!/^\d+(m|h|d)$/.test(every)) return { error: '`trigger.every` must look like "30m", "2h" or "1d" for an interval trigger.' };
      return { node: { id: 't', label: `Every ${every}`, kind: 'trigger.schedule', spec: { kind: 'interval', every }, x: 40, y: 80 }, summary: `every ${every}` };
    }
    case 'event': {
      const actor = str(t['actor']);
      const verb = str(t['verb']);
      const source = str(t['source']);
      if (!actor && !verb && !source) return { error: 'An event trigger needs at least one of `trigger.actor`, `trigger.verb`, `trigger.source`.' };
      const parts = [actor, verb, source].filter(Boolean).join(' ');
      return {
        node: { id: 't', label: `On ${parts}`, kind: 'trigger.event', ...(actor ? { actor } : {}), ...(verb ? { verb } : {}), ...(source ? { source } : {}), x: 40, y: 80 },
        summary: `whenever the activity journal records "${parts}"`,
      };
    }
    default:
      return { error: '`trigger.kind` must be one of manual, daily, weekly, interval, event.' };
  }
}

export function createWorkflowSuggestTool(
  getSink: () => IWorkflowSuggestionSink | null,
  opts: IWorkflowSuggestToolOptions = {},
): IChatTool {
  const maxPerDay = Math.max(0, opts.maxPerDay ?? DEFAULT_AGENT_SUGGESTIONS_PER_DAY);
  const now = opts.now ?? (() => Date.now());
  return {
    name: 'workflow_suggest',
    displaySummary: 'File a workflow the user can approve in the Workflows panel, instead of offering it in prose.',
    description:
      'Files a SUGGESTED WORKFLOW: a disabled draft in the Workflows panel that the user can Review, Add or Dismiss. ' +
      'Use it when you notice something worth automating: the user has asked for the same thing more than once, a moment ' +
      'recurs that you could prepare for, or a check is worth standing. Do NOT describe the automation in your reply and ' +
      'do not ask permission first; file it, then mention it once in one sentence. Nothing runs until the user adds it. ' +
      'One idea, one `key`: the same key is never filed twice and a dismissed key stays dismissed, so do not retry. ' +
      'The `mission` is what the agent turn will do when the workflow runs: write it complete enough to run without a ' +
      'conversation, in the user\'s own words where you have them. `trigger` defaults to manual (a button); use daily, weekly, ' +
      'interval or event only when the timing is clearly part of the ask. You may file only a few per day.',
    parameters: {
      type: 'object',
      required: ['key', 'name', 'why', 'mission'],
      properties: {
        key: { type: 'string', description: 'Short stable id for the idea, e.g. "weekly budget summary". Same idea, same key, every time.' },
        name: { type: 'string', description: 'Title Case name for the row, e.g. "Weekly Budget Summary".' },
        why: { type: 'string', description: 'One sentence the user will read: what you noticed. "You asked for a spending summary three Fridays in a row."' },
        mission: { type: 'string', description: 'The instructions the agent turn follows when the workflow runs. Complete, specific, no questions.' },
        trigger: {
          type: 'object',
          description: 'When it runs. Default {"kind":"manual"}. Also {"kind":"daily","time":"HH:MM"}, {"kind":"weekly","day":0-6,"time":"HH:MM"}, {"kind":"interval","every":"30m|2h|1d"}, or {"kind":"event","actor"?,"verb"?,"source"?} (an activity-journal match; give at least one filter).',
          properties: {
            kind: { type: 'string', enum: ['manual', 'daily', 'weekly', 'interval', 'event'] },
            time: { type: 'string' },
            day: { type: 'number' },
            every: { type: 'string' },
            actor: { type: 'string' },
            verb: { type: 'string' },
            source: { type: 'string' },
          },
        },
        attention: { type: 'boolean', description: 'true if a run may interrupt the user (attention class, counted against the daily budget). Default false: quiet.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'cron',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      const rawKey = str(args['key']);
      const name = str(args['name']);
      const why = str(args['why']);
      const mission = str(args['mission']);
      if (!rawKey) return { content: '`key` is required: a short stable id for the idea.', isError: true };
      if (!name) return { content: '`name` is required.', isError: true };
      if (!why) return { content: '`why` is required: one sentence the user will read about what you noticed.', isError: true };
      if (!mission) return { content: '`mission` is required: what the agent turn does when the workflow runs.', isError: true };

      const sink = getSink();
      if (!sink) return { content: 'Workflows are not available in this workspace, so nothing can be suggested. Mention the idea in one sentence instead.', isError: true };

      const key = agentSuggestionKey(rawKey);
      if (sink.isSuggestionDismissed(key)) {
        return { content: `The user dismissed "${name}" before. It is not offered again; do not mention it.` };
      }
      const existing = sink.workflows.find((w) => w.suggestedFrom === key);
      if (existing) {
        const state = existing.source === 'suggested' ? 'waiting for the user in the Workflows panel' : 'already one of the user\'s workflows';
        return { content: `Already filed as "${existing.name}" (${state}). Do not suggest it again.` };
      }
      const since = startOfDay(now());
      const filedToday = sink.workflows.filter((w) => (w.suggestedFrom ?? '').startsWith(AGENT_SUGGESTION_PREFIX) && w.createdAt >= since).length;
      if (filedToday >= maxPerDay) {
        return { content: `Enough suggestions for today (${maxPerDay}). If this one matters right now, say it in one sentence; otherwise let it go.` };
      }

      const trigger = buildTrigger(args['trigger']);
      if ('error' in trigger) return { content: trigger.error, isError: true };

      const doc: Omit<WorkflowDoc, 'id' | 'createdAt' | 'updatedAt'> = {
        name,
        description: why,
        class: args['attention'] === true ? 'attention' : 'quiet',
        enabled: false,
        source: 'suggested',
        suggestedFrom: key,
        nodes: [
          trigger.node,
          { id: 'c', label: 'Today’s Facts', kind: 'context.facts', x: 280, y: 80 },
          { id: 'g', label: 'Do The Work', kind: 'action.agentTurn', prompt: mission, x: 520, y: 80 },
        ],
        edges: [{ from: 't', to: 'c' }, { from: 'c', to: 'g' }],
      };
      const check = validateWorkflow({ ...doc, id: 'wf-draft', createdAt: 0, updatedAt: 0 });
      if (check.errors.length > 0) return { content: `The draft is not a valid workflow: ${check.errors.join(' ')}`, isError: true };

      try {
        const added = sink.addWorkflow(doc);
        return {
          content: `Suggested "${added.name}" in the Workflows panel (runs ${trigger.summary}). It stays off until the user adds it. ` +
            'Tell them once, in one sentence, and do not bring it up again.',
        };
      } catch (err) {
        return { content: `Could not file the suggestion: ${err instanceof Error ? err.message : String(err)}`, isError: true };
      }
    },
  };
}
