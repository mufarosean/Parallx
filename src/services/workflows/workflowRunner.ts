// workflowRunner.ts — one run of one workflow: walk the graph from the
// fired trigger, gate, act, and record EVERYTHING. Runs are documents
// (docs/WORKFLOWS_BRIEF.md): the trace this produces is the debugger.
//
// Execution deps are INJECTED (the CronService attachExecution pattern) —
// this module knows nothing about chat sessions, the command bus, or the
// tool registry. Wiring provides them; tests script them.

import {
  MAX_AGENT_TURNS_PER_RUN,
  isActionNode,
  type WorkflowDoc,
  type WorkflowNode,
  type WorkflowNodeTrace,
  type WorkflowRun,
  type WorkflowTriggerContext,
  type NodeRunStatus,
} from './workflowTypes.js';
import { downstreamOf, executionOrder, interpolate } from './workflowGraph.js';

// ── Injected execution surface ──────────────────────────────────────────────

export interface WorkflowExecutionDeps {
  /** Run an isolated agent turn (the background-prompt-runner seam);
   *  resolves the final assistant text, throws on failure. `initiator`
   *  decides the consent posture: automatic firings are 'autonomous'
   *  (the M90 dial), Run Now is 'user'. */
  readonly runAgentTurn: (req: {
    readonly workflowId: string;
    readonly workflowName: string;
    readonly prompt: string;
    readonly contextMessages: number;
    readonly initiator: 'user' | 'autonomous';
    readonly model?: string;
    readonly contextWindow?: number;
  }) => Promise<string>;
  /** Gather the deterministic facts bundle as one prompt block. */
  readonly gatherFacts?: (include: {
    planner?: boolean; activity?: boolean; sync?: boolean; pages?: boolean;
  }) => Promise<string>;
  /** A template's or page's content as markdown (format exemplar). */
  readonly getExemplar?: (ref: { kind: 'template' | 'page'; id: string }) => Promise<string | null>;
  /** Execute a workbench command, origin-stamped as this workflow. */
  readonly runCommand: (commandId: string, args: readonly unknown[], origin: string) => Promise<unknown>;
  /** Execute a registered tool; the normal enablement/consent path applies. */
  readonly runTool: (toolName: string, args: Readonly<Record<string, unknown>>, origin: string) => Promise<{ content: string; isError?: boolean }>;
  /** Deliver an attention entry (the autonomy log). */
  readonly notify: (message: string, workflow: { id: string; name: string }) => void;
  /** Ask the user to approve one action (destructive-class gate). Absent
   *  approver ⇒ destructive actions are GATED, never silently run. */
  readonly requestApproval?: (description: string, workflowName: string) => Promise<boolean>;
}

/** Cooldown ledger surface — owned by the service, consulted per run. */
export interface CooldownLedger {
  /** Milliseconds since the key was last stamped, or null if never. */
  sinceStamp(key: string): number | null;
  stamp(key: string): void;
}

// ── The run ─────────────────────────────────────────────────────────────────

let _runCounter = 0;

export async function executeWorkflowRun(
  doc: WorkflowDoc,
  triggerNode: WorkflowNode,
  ctx: WorkflowTriggerContext,
  deps: WorkflowExecutionDeps,
  ledger: CooldownLedger,
  opts: { automatic: boolean } = { automatic: true },
): Promise<WorkflowRun> {
  const startedAt = Date.now();
  const runId = `wfrun-${startedAt}-${++_runCounter}`;
  const origin = `workflow:${doc.id}`;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const order = executionOrder(doc, triggerNode.id);

  const traces: WorkflowNodeTrace[] = [];
  const skipped = new Set<string>();
  /** Context-node outputs: labeled blocks compiled into mission prompts. */
  const contextBlocks = new Map<string, string>();
  const inbound = new Map<string, string[]>();
  for (const e of doc.edges) {
    const arr = inbound.get(e.to) ?? [];
    arr.push(e.from);
    inbound.set(e.to, arr);
  }
  /** Every context block reachable UPSTREAM of a node, in stable order. */
  const upstreamContext = (nodeId: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    const walk = (id: string): void => {
      for (const from of inbound.get(id) ?? []) {
        if (seen.has(from)) continue;
        seen.add(from);
        walk(from);
        const block = contextBlocks.get(from);
        if (block) out.push(block);
      }
    };
    walk(nodeId);
    return out;
  };
  /** Cooldown gates that let the run through — stamped only if some
   *  downstream action SUCCEEDS (heartbeat ledger semantics: a failed
   *  delivery retries on the next firing instead of burning the window). */
  const pendingStamps: { key: string; downstream: Set<string> }[] = [];
  let agentTurns = 0;
  let sawCooldownHold = false;

  const record = (node: WorkflowNode, status: NodeRunStatus, t0: number, summary?: string, error?: string): void => {
    traces.push({
      nodeId: node.id,
      label: node.label,
      kind: node.kind,
      status,
      startedAt: t0,
      durationMs: Date.now() - t0,
      summary,
      error,
    });
  };

  for (const id of order) {
    const node = byId.get(id);
    if (!node) continue;
    const t0 = Date.now();

    if (skipped.has(id)) {
      record(node, 'skipped', t0, 'upstream gate held or failed');
      continue;
    }

    try {
      switch (node.kind) {
        case 'context.facts': {
          const text = deps.gatherFacts
            ? await deps.gatherFacts(node.include ?? {})
            : '';
          if (text.trim()) contextBlocks.set(node.id, text.trim());
          record(node, 'ok', t0, text.trim() ? `${text.trim().split('\n').length} lines gathered` : 'nothing to gather');
          break;
        }

        case 'context.exemplar': {
          const md = deps.getExemplar ? await deps.getExemplar(node.ref) : null;
          if (md?.trim()) {
            contextBlocks.set(node.id,
              `FORMAT EXEMPLAR (follow this structure for any page or report you produce):\n${md.trim()}`);
            record(node, 'ok', t0, `${node.ref.name ?? node.ref.id} injected`);
          } else {
            record(node, 'error', t0, undefined, `could not load ${node.ref.kind} "${node.ref.name ?? node.ref.id}"`);
            for (const d of downstreamOf(doc, id)) skipped.add(d);
          }
          break;
        }

        case 'control.cooldown': {
          const key = `${doc.id}:${node.key ?? 'default'}`;
          const since = ledger.sinceStamp(key);
          // A non-positive duration is an OPEN gate (the editor warns).
          const windowMs = Number.isFinite(node.hours) && node.hours > 0 ? node.hours * 3_600_000 : 0;
          if (windowMs > 0 && since !== null && since < windowMs) {
            sawCooldownHold = true;
            for (const d of downstreamOf(doc, id)) skipped.add(d);
            const remainingH = Math.ceil((windowMs - since) / 3_600_000);
            record(node, 'gated', t0, `held: ${node.hours}h cooldown, about ${remainingH}h left`);
          } else {
            pendingStamps.push({ key, downstream: downstreamOf(doc, id) });
            record(node, 'ok', t0, 'open');
          }
          break;
        }

        case 'action.agentTurn': {
          if (++agentTurns > MAX_AGENT_TURNS_PER_RUN) {
            throw new Error(`agent-turn budget exceeded (${MAX_AGENT_TURNS_PER_RUN} per run)`);
          }
          if (!(await approved(node, doc, deps))) {
            gateNode(node, id);
            break;
          }
          // COMPILE the mission: upstream context blocks, then the task.
          const blocks = upstreamContext(id);
          const mission = interpolate(node.prompt, ctx);
          const prompt = blocks.length > 0
            ? `${blocks.join('\n\n')}\n\nTask: ${mission}`
            : mission;
          const text = await deps.runAgentTurn({
            workflowId: doc.id,
            workflowName: doc.name,
            prompt,
            contextMessages: clamp(node.contextMessages ?? 0, 0, 10),
            initiator: opts.automatic ? 'autonomous' : 'user',
            model: doc.model,
            contextWindow: doc.contextWindow,
          });
          record(node, 'ok', t0, oneLine(text) || 'turn completed');
          break;
        }

        case 'action.command': {
          if (!(await approved(node, doc, deps))) {
            gateNode(node, id);
            break;
          }
          await deps.runCommand(node.commandId, node.args ?? [], origin);
          record(node, 'ok', t0, node.commandId);
          break;
        }

        case 'action.tool': {
          if (!(await approved(node, doc, deps))) {
            gateNode(node, id);
            break;
          }
          const res = await deps.runTool(node.toolName, node.args ?? {}, origin);
          if (res.isError) throw new Error(oneLine(res.content) || `${node.toolName} failed`);
          record(node, 'ok', t0, oneLine(res.content) || node.toolName);
          break;
        }

        case 'action.notify': {
          // Notify is never approval-gated — telling the user is always
          // allowed; it is the OPPOSITE of acting behind their back.
          deps.notify(interpolate(node.message, ctx), { id: doc.id, name: doc.name });
          record(node, 'ok', t0, 'delivered');
          break;
        }

        default:
          // A trigger reachable mid-graph is a validation failure upstream;
          // tolerate it as a skip rather than crash the run.
          record(node, 'skipped', t0, 'not executable mid-run');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      record(node, 'error', t0, undefined, msg);
      for (const d of downstreamOf(doc, id)) skipped.add(d);
    }
  }

  function gateNode(node: WorkflowNode, id: string): void {
    record(node, 'gated', Date.now(), 'awaiting approval, not run');
    for (const d of downstreamOf(doc, id)) skipped.add(d);
  }

  // Stamp cooldowns whose protected actions actually delivered.
  for (const { key, downstream } of pendingStamps) {
    const delivered = traces.some(
      (t) => downstream.has(t.nodeId) && t.status === 'ok' && t.kind.startsWith('action.'),
    );
    if (delivered) ledger.stamp(key);
  }

  const anyError = traces.some((t) => t.status === 'error');
  const anyGatedAction = traces.some((t) => t.status === 'gated' && t.kind.startsWith('action.'));
  const anyActionRan = traces.some((t) => t.status === 'ok' && t.kind.startsWith('action.'));
  const status = anyError ? 'error'
    : anyGatedAction ? 'gated'
    : (!anyActionRan && sawCooldownHold) ? 'cooldown'
    : 'ok';

  return {
    id: runId,
    workflowId: doc.id,
    workflowName: doc.name,
    startedAt,
    finishedAt: Date.now(),
    status,
    trigger: { nodeId: triggerNode.id, kind: triggerNode.kind, summary: ctx.summary },
    nodes: traces,
    error: anyError ? traces.find((t) => t.status === 'error')?.error : undefined,
  };
}

async function approved(node: WorkflowNode, doc: WorkflowDoc, deps: WorkflowExecutionDeps): Promise<boolean> {
  if (doc.class !== 'destructive') return true;
  if (!deps.requestApproval) return false; // no approver ⇒ gated, never silent
  if (!isActionNode(node)) return true;
  return deps.requestApproval(`${doc.name}: ${node.label}`, doc.name);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function oneLine(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}
