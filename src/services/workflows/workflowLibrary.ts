// workflowLibrary.ts — templates and migrations: every workflow the app
// can hand you ready-made. Pure builders over workflowTypes; ids are
// stamped by the service at install time.
//
// The cron migration is the brief's compatibility promise: "an existing
// cron job migrates as a two-node graph (schedule → agent turn) and
// stays working. Nothing has to be rewritten to start."

import type { ICronJob } from '../../openclaw/openclawCronService.js';
import { specFromSchedule } from '../../openclaw/cronScheduleSpec.js';
import type { WorkflowDoc, WorkflowNode, WorkflowEdge, WorkflowClass } from './workflowTypes.js';

export interface WorkflowTemplate {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly class: WorkflowClass;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
}

/** The template gallery shown in the panel's empty state. */
export const WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  {
    key: 'morning-report',
    name: 'Morning Report',
    description: 'At 5am (or first launch of the day), the agent reads your planner and activity, then writes a report page.',
    class: 'attention',
    nodes: [
      { id: 't', label: '5am Or First Launch', kind: 'trigger.schedule', spec: { kind: 'daily', time: '05:00' }, x: 40, y: 80 },
      { id: 'c', label: 'Today\u2019s Facts', kind: 'context.facts', x: 280, y: 80 },
      {
        id: 'g', label: 'Write The Report', kind: 'action.agentTurn', x: 520, y: 80,
        prompt: 'Prepare my morning report from the context above. If email or news tools are available, check for anything new and important. '
          + 'Then create ONE canvas page titled "Morning Report" (canvas_create_page with markdown) containing: what is due today, anything overdue, '
          + 'notable new emails if you checked, and the single most important thing to start with. Concise, no filler.',
      },
    ],
    edges: [{ from: 't', to: 'c' }, { from: 'c', to: 'g' }],
  },
  {
    key: 'weekly-review-nudge',
    name: 'Weekly Review Nudge',
    description: 'Sunday evening, a reminder to review the week. A cooldown keeps it from doubling up.',
    class: 'attention',
    nodes: [
      { id: 't', label: 'Sunday Evening', kind: 'trigger.schedule', spec: { kind: 'weekly', day: 0, time: '18:00' }, x: 40, y: 80 },
      { id: 'c', label: '3-Day Cooldown', kind: 'control.cooldown', hours: 72, x: 280, y: 80 },
      { id: 'n', label: 'Nudge', kind: 'action.notify', message: 'Weekly review: look over what moved this week and set up the next one.', x: 520, y: 80 },
    ],
    edges: [{ from: 't', to: 'c' }, { from: 'c', to: 'n' }],
  },
  {
    key: 'scheduled-agent-task',
    name: 'Scheduled Agent Task',
    description: 'The blank scheduled turn: pick a time, write the task, the agent runs it.',
    class: 'quiet',
    nodes: [
      { id: 't', label: 'On Schedule', kind: 'trigger.schedule', spec: { kind: 'daily', time: '09:00' }, x: 40, y: 80 },
      { id: 'g', label: 'Run Task', kind: 'action.agentTurn', prompt: 'Describe the task here.', x: 280, y: 80 },
    ],
    edges: [{ from: 't', to: 'g' }],
  },
];

/** Instantiate a template as a (disabled) document the user then enables. */
export function instantiateTemplate(
  template: WorkflowTemplate,
  id: string,
  now: number = Date.now(),
): WorkflowDoc {
  return {
    id,
    name: template.name,
    description: template.description,
    class: template.class,
    enabled: false,
    nodes: template.nodes.map((n) => ({ ...n })),
    edges: template.edges.map((e) => ({ ...e })),
    source: 'stock',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * An existing cron job as a workflow document — the two-node migration.
 * A job with an agentTurn payload becomes schedule → agent turn; a bare
 * reminder becomes schedule → notify. The original enabled state and
 * context-message count carry over; the doc remembers its origin so the
 * panel can offer "remove the old cron job" once the user trusts it.
 */
export function cronJobToWorkflow(job: ICronJob, id: string, now: number = Date.now()): WorkflowDoc {
  const spec = specFromSchedule(job.schedule);
  const triggerNode: WorkflowNode = {
    id: 't', label: 'Schedule', kind: 'trigger.schedule', spec, x: 40, y: 80,
  };
  const agentTurn = job.payload.agentTurn?.trim();
  const actionNode: WorkflowNode = agentTurn
    ? {
        id: 'a', label: 'Agent Turn', kind: 'action.agentTurn', x: 280, y: 80,
        prompt: agentTurn,
        contextMessages: job.contextMessages,
      }
    : {
        id: 'a', label: 'Reminder', kind: 'action.notify', x: 280, y: 80,
        message: job.description?.trim() || `Reminder: ${job.name}`,
      };
  return {
    id,
    name: job.name,
    description: job.description,
    class: 'quiet',
    enabled: job.enabled,
    nodes: [triggerNode, actionNode],
    edges: [{ from: 't', to: 'a' }],
    source: 'migrated-cron',
    createdAt: now,
    updatedAt: now,
    migratedFromCronId: job.id,
  };
}
