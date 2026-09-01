// workflowGraph.ts — pure graph semantics: validation, execution order,
// placeholder interpolation. No services, no side effects — everything
// here is exhaustively unit-testable, and the runner trusts it.

import {
  isTriggerNode,
  MAX_NODES_PER_WORKFLOW,
  type WorkflowDoc,
  type WorkflowNode,
  type WorkflowTriggerContext,
} from './workflowTypes.js';

// ── Validation ──────────────────────────────────────────────────────────────

export interface WorkflowValidation {
  readonly ok: boolean;
  /** Structural corruption — the document must NOT be stored like this. */
  readonly errors: readonly string[];
  /** Quality issues — storable (you are mid-edit), surfaced in the UI,
   *  and honest at run time (an empty command simply fails its node). */
  readonly warnings: readonly string[];
  /** A workflow with no ACTIVE trigger is a draft, not a bug (n8n lesson). */
  readonly isDraft: boolean;
}

export function validateWorkflow(doc: WorkflowDoc): WorkflowValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const ids = new Set<string>();

  if (!doc.name.trim()) errors.push('The workflow needs a name.');
  if (doc.nodes.length === 0) warnings.push('The workflow has no nodes.');
  if (doc.nodes.length > MAX_NODES_PER_WORKFLOW) {
    errors.push(`Too many nodes (${doc.nodes.length}; the limit is ${MAX_NODES_PER_WORKFLOW}).`);
  }

  for (const n of doc.nodes) {
    if (!n.id) { errors.push('A node is missing its id.'); continue; }
    if (ids.has(n.id)) errors.push(`Duplicate node id "${n.id}".`);
    ids.add(n.id);
    const issue = validateNode(n);
    if (issue) warnings.push(`${n.label || n.id}: ${issue}`);
  }

  for (const e of doc.edges) {
    if (!ids.has(e.from)) errors.push(`Edge from unknown node "${e.from}".`);
    if (!ids.has(e.to)) errors.push(`Edge to unknown node "${e.to}".`);
    const target = doc.nodes.find((n) => n.id === e.to);
    if (target && isTriggerNode(target)) {
      errors.push(`"${target.label}" is a trigger. Nothing may point into a trigger.`);
    }
  }

  if (hasCycle(doc)) errors.push('The graph has a cycle. Workflows must flow forward.');

  const triggers = doc.nodes.filter(isTriggerNode);
  const isDraft = triggers.length === 0;

  // A non-trigger node unreachable from every trigger will never run —
  // normal mid-edit state (you add, then connect), so it WARNS.
  if (!isDraft && errors.length === 0) {
    const reachable = new Set<string>();
    for (const t of triggers) {
      for (const id of executionOrder(doc, t.id)) reachable.add(id);
    }
    for (const n of doc.nodes) {
      if (!isTriggerNode(n) && !reachable.has(n.id)) {
        warnings.push(`"${n.label}" is not connected to any trigger, so it will never run.`);
      }
    }
  }

  return { ok: errors.length === 0 && warnings.length === 0, errors, warnings, isDraft };
}

function validateNode(n: WorkflowNode): string | null {
  switch (n.kind) {
    case 'trigger.schedule':
      return n.spec ? null : 'schedule trigger has no schedule.';
    case 'trigger.manual':
      return null;
    case 'trigger.event':
      return (n.actor || n.verb || n.source)
        ? null
        : 'event trigger matches everything. Give it at least one filter.';
    case 'control.cooldown':
      // ≤0 hours runs as an OPEN gate (the runner's contract) — warn only.
      return Number.isFinite(n.hours) && n.hours > 0 ? null : 'cooldown has no duration, so the gate is always open.';
    case 'action.agentTurn':
      return n.prompt.trim() ? null : 'agent turn has an empty prompt.';
    case 'action.command':
      return n.commandId.trim() ? null : 'command action has no command id.';
    case 'action.tool':
      return n.toolName.trim() ? null : 'tool action has no tool name.';
    case 'action.notify':
      return n.message.trim() ? null : 'notify action has an empty message.';
  }
}

function hasCycle(doc: WorkflowDoc): boolean {
  const out = new Map<string, string[]>();
  for (const e of doc.edges) {
    const arr = out.get(e.from) ?? [];
    arr.push(e.to);
    out.set(e.from, arr);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const next of out.get(id) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const n of doc.nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE && visit(n.id)) return true;
  }
  return false;
}

// ── Execution order ─────────────────────────────────────────────────────────

/**
 * The node ids a run visits after `triggerId` fires, in deterministic
 * order: breadth-first along edges, branches in edge-declaration order,
 * each node at most once. The trigger itself is not included.
 */
export function executionOrder(doc: WorkflowDoc, triggerId: string): string[] {
  const out = new Map<string, string[]>();
  for (const e of doc.edges) {
    const arr = out.get(e.from) ?? [];
    arr.push(e.to);
    out.set(e.from, arr);
  }
  const order: string[] = [];
  const seen = new Set<string>([triggerId]);
  const queue: string[] = [...(out.get(triggerId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const next of out.get(id) ?? []) queue.push(next);
  }
  return order;
}

/** Node ids DOWNSTREAM of the given node (what a failed gate skips). */
export function downstreamOf(doc: WorkflowDoc, nodeId: string): Set<string> {
  return new Set(executionOrder(doc, nodeId));
}

// ── Placeholder interpolation ───────────────────────────────────────────────

/**
 * Replace `{{trigger.summary}}`, `{{trigger.kind}}` and `{{event.<field>}}`
 * in a template. Unknown placeholders are left VERBATIM — never silently
 * blanked, so a typo is visible in the delivered text instead of vanishing.
 */
export function interpolate(template: string, ctx: WorkflowTriggerContext): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (whole, path: string) => {
    if (path === 'trigger.summary') return ctx.summary;
    if (path === 'trigger.kind') return ctx.kind;
    if (path.startsWith('event.') && ctx.event) {
      const v = ctx.event[path.slice('event.'.length)];
      if (v === undefined || v === null) return whole;
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
    return whole;
  });
}

// ── Human summaries (rows in the panel) ─────────────────────────────────────

export function describeTriggerNode(n: WorkflowNode): string {
  switch (n.kind) {
    case 'trigger.manual': return 'Run manually';
    case 'trigger.schedule': {
      const s = n.spec;
      switch (s.kind) {
        case 'daily': return `Every day at ${s.time}`;
        case 'weekly': return `Weekly at ${s.time}`;
        case 'interval': return `Every ${s.every}`;
        case 'once': return `Once at ${s.at}`;
        case 'cron': return `Cron ${s.expr}`;
      }
      break;
    }
    case 'trigger.event': {
      const parts = [n.source, n.verb, n.actor].filter(Boolean);
      return `On ${parts.join(' · ') || 'any event'}`;
    }
    default: break;
  }
  return n.label;
}
