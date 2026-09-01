// workflowTypes.ts — the workflow composition model (docs/WORKFLOWS_BRIEF.md).
//
// A workflow is a directed graph of typed nodes plus an arbitration class.
// This file is the vocabulary ONLY — pure types and constants, no services.
//
// The v1 node set is deliberately exactly what the runner executes end to
// end. Nothing is declared here that does not run: no speculative fields,
// no families without an implementation behind them (the lesson of the
// retired mindmap program: an optional rail is not a rail, and a schema
// that promises more than the runtime delivers is a lie in type form).
//
// v1 families:
//   trigger  — schedule (the shared AutomationScheduleSpec), manual,
//              event (a filtered activity-journal subscription)
//   control  — cooldown (the heartbeat ledger semantics, generalised:
//              stamp on downstream SUCCESS so a failure retries)
//   action   — agent-turn (the cron-parity ephemeral model turn),
//              command (origin-stamped command bus), tool (registered
//              tool via consent), notify (an attention entry in the
//              autonomy log)
//
// Deferred WITH INTENT (do not add fields for them until they run):
// judgment nodes with typed answers, read nodes, branch/mutex/priority,
// the attention budget. See the brief's D-numbers.

import type { AutomationScheduleSpec } from '../../openclaw/cronScheduleSpec.js';

// ── Nodes ───────────────────────────────────────────────────────────────────

export interface WorkflowNodeBase {
  readonly id: string;
  /** Short human label shown on rows and traces. */
  readonly label: string;
  /** Canvas position (the editor pane's concern; runner ignores it). */
  readonly x?: number;
  readonly y?: number;
}

export interface ScheduleTriggerNode extends WorkflowNodeBase {
  readonly kind: 'trigger.schedule';
  readonly spec: AutomationScheduleSpec;
}

export interface ManualTriggerNode extends WorkflowNodeBase {
  readonly kind: 'trigger.manual';
}

/** Fires when a matching activity-journal entry lands. Every filter field
 *  is optional; an omitted field matches anything. */
export interface EventTriggerNode extends WorkflowNodeBase {
  readonly kind: 'trigger.event';
  readonly actor?: string;
  readonly verb?: string;
  readonly source?: string;
}

/**
 * Context nodes: the "information" a mission prompt is BUILT from
 * (the prompt-compiler thesis). Each produces one labeled text block;
 * blocks from upstream context nodes are injected above the mission
 * text at compile time. Deterministic, consent-free reads only.
 */
export interface FactsContextNode extends WorkflowNodeBase {
  readonly kind: 'context.facts';
  /** Which fact blocks to gather (default: all). */
  readonly include?: {
    readonly planner?: boolean;
    readonly activity?: boolean;
    readonly sync?: boolean;
    readonly pages?: boolean;
  };
}

/** A canvas template or page injected as a FORMAT EXEMPLAR (markdown). */
export interface ExemplarContextNode extends WorkflowNodeBase {
  readonly kind: 'context.exemplar';
  readonly ref: { readonly kind: 'template' | 'page'; readonly id: string; readonly name?: string };
}

export interface CooldownControlNode extends WorkflowNodeBase {
  readonly kind: 'control.cooldown';
  /** Ledger key — defaults to the workflow id when omitted. */
  readonly key?: string;
  readonly hours: number;
}

export interface AgentTurnActionNode extends WorkflowNodeBase {
  readonly kind: 'action.agentTurn';
  /** The MISSION, in language. May name tools by their exact registered
   *  names; the model orchestrates. {{trigger.*}} placeholders apply. */
  readonly prompt: string;
  /** Recent chat messages injected as context (0-10, cron parity). */
  readonly contextMessages?: number;
}

export interface CommandActionNode extends WorkflowNodeBase {
  readonly kind: 'action.command';
  readonly commandId: string;
  readonly args?: readonly unknown[];
}

export interface ToolActionNode extends WorkflowNodeBase {
  readonly kind: 'action.tool';
  readonly toolName: string;
  readonly args?: Readonly<Record<string, unknown>>;
}

export interface NotifyActionNode extends WorkflowNodeBase {
  readonly kind: 'action.notify';
  /** May carry {{trigger.*}} placeholders — see interpolate(). */
  readonly message: string;
}

export type WorkflowTriggerNode = ScheduleTriggerNode | ManualTriggerNode | EventTriggerNode;
export type WorkflowContextNode = FactsContextNode | ExemplarContextNode;
export type WorkflowActionNode = AgentTurnActionNode | CommandActionNode | ToolActionNode | NotifyActionNode;
export type WorkflowNode = WorkflowTriggerNode | WorkflowContextNode | CooldownControlNode | WorkflowActionNode;

export function isTriggerNode(n: WorkflowNode): n is WorkflowTriggerNode {
  return n.kind.startsWith('trigger.');
}

export function isActionNode(n: WorkflowNode): n is WorkflowActionNode {
  return n.kind.startsWith('action.');
}

export function isContextNode(n: WorkflowNode): n is WorkflowContextNode {
  return n.kind.startsWith('context.');
}

// ── Edges & the document ────────────────────────────────────────────────────

export interface WorkflowEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * The arbitration class — what a workflow may do without asking:
 *   quiet       — acts silently; consent dial still applies to its actions
 *   attention   — may interrupt (notify); same consent rules
 *   destructive — EVERY action node requires explicit approval, always
 */
export type WorkflowClass = 'quiet' | 'attention' | 'destructive';

export type WorkflowSource = 'user' | 'stock' | 'migrated-cron';

export interface WorkflowDoc {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly class: WorkflowClass;
  readonly enabled: boolean;
  readonly nodes: readonly WorkflowNode[];
  readonly edges: readonly WorkflowEdge[];
  readonly source: WorkflowSource;
  readonly createdAt: number;
  readonly updatedAt: number;
  /** For migrated-cron workflows: the cron job this replaced. */
  readonly migratedFromCronId?: string;
  /** Arbiter: firing order when several come due together (higher first). */
  readonly priority?: number;
  /** Arbiter: workflows sharing a group never run concurrently — the
   *  later firing is HELD (recorded, visible) rather than interleaved. */
  readonly mutexGroup?: string;
  /** Model for this workflow's agent turns (undefined = the active model).
   *  Parallx runs local models; the right model is a per-task choice. */
  readonly model?: string;
  /** num_ctx for this workflow's agent turns (undefined/0 = model default).
   *  A per-task VRAM budget: a 5am report does not need 160k context. */
  readonly contextWindow?: number;
}

// ── Runs (runs are documents — every run produces a trace) ──────────────────

/** `held` = the ARBITER stopped the firing before any node ran (mutex
 *  busy, or the attention budget was spent) — recorded, never silent. */
export type WorkflowRunStatus = 'running' | 'ok' | 'error' | 'gated' | 'cooldown' | 'held';
export type NodeRunStatus = 'ok' | 'error' | 'gated' | 'skipped';

export interface WorkflowNodeTrace {
  readonly nodeId: string;
  readonly label: string;
  readonly kind: WorkflowNode['kind'];
  readonly status: NodeRunStatus;
  readonly startedAt: number;
  readonly durationMs: number;
  /** One human line of what happened / what came back. */
  readonly summary?: string;
  readonly error?: string;
}

export interface WorkflowRun {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly startedAt: number;
  readonly finishedAt: number | null;
  readonly status: WorkflowRunStatus;
  /** Which trigger fired and one line of why. */
  readonly trigger: { readonly nodeId: string; readonly kind: string; readonly summary: string };
  readonly nodes: readonly WorkflowNodeTrace[];
  readonly error?: string;
  /** True for timer/event firings; false for the user's Run Now. The
   *  attention budget counts only automatic runs — the user acting is
   *  never an interruption. */
  readonly automatic?: boolean;
}

/** The fired trigger's payload, available to placeholder interpolation. */
export interface WorkflowTriggerContext {
  readonly kind: string;
  readonly summary: string;
  /** Event-trigger fields (actor/verb/source/detail), when applicable. */
  readonly event?: Readonly<Record<string, unknown>>;
}

// ── Limits ──────────────────────────────────────────────────────────────────

export const MAX_WORKFLOWS = 100;
export const MAX_NODES_PER_WORKFLOW = 40;
export const MAX_RUNS_RETAINED = 300;
export const MAX_AGENT_TURNS_PER_RUN = 3;
