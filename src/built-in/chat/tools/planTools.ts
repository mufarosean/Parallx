// planTools.ts — `plan_update` chat tool (M85 — the planning organ)
//
// The gap this closes: the agent's plan used to live only inside the context
// window, so it died at compaction / history trimming / session reload, and
// long multi-step tasks drifted. `plan_update` writes a durable plan onto the
// SESSION (persisted to SQLite with it), and the context engine re-injects it
// into EVERY assembly as its own section OUTSIDE conversation history — so it
// is compaction-immune by construction.
//
// Design mirrors the proven Claude Code TodoWrite shape: a one-line goal,
// a short step list with pending/active/done statuses, and a free-text
// current-state note. Hard caps keep it a mission statement, not a scratchpad
// (the same curation forcing-function as the MEMORY.md caps).

import type {
  IChatTool,
  IChatSessionPlan,
  IChatSessionPlanStep,
  IChatToolInvocationCallContext,
  ICancellationToken,
  IToolResult,
} from '../../../services/chatTypes.js';

// ── Caps (curation forcing function) ────────────────────────────────────────

export const PLAN_MAX_STEPS = 12;
export const PLAN_MAX_STEP_CHARS = 140;
export const PLAN_MAX_GOAL_CHARS = 160;
export const PLAN_MAX_NOTE_CHARS = 500;

const VALID_STATUSES = new Set(['pending', 'active', 'done']);

// ── Host contract ────────────────────────────────────────────────────────────

/**
 * Session plan accessors, provided by chat/main.ts from the ChatService.
 * The tool never touches sessions directly — the host owns mutation,
 * change-event firing, and persistence scheduling.
 */
export interface IPlanToolHost {
  readPlan(sessionId: string): IChatSessionPlan | undefined;
  writePlan(sessionId: string, plan: IChatSessionPlan | undefined): void;
}

// ── Prompt formatting (shared by the tool result and the context engine) ────

/**
 * Render a plan for model consumption. Used both as the tool result (so the
 * model sees exactly what was stored) and as the per-turn "## Active Plan"
 * context section.
 */
export function formatSessionPlan(plan: IChatSessionPlan): string {
  const lines: string[] = [`Goal: ${plan.goal}`];
  if (plan.steps.length > 0) {
    const marker = (s: IChatSessionPlanStep): string =>
      s.status === 'done' ? '[x]' : s.status === 'active' ? '[>]' : '[ ]';
    lines.push('Steps:');
    for (const step of plan.steps) {
      lines.push(`${marker(step)} ${step.text}`);
    }
  }
  if (plan.note) {
    lines.push(`Now: ${plan.note}`);
  }
  return lines.join('\n');
}

// ── Validation ───────────────────────────────────────────────────────────────

function validationError(message: string): IToolResult {
  return { content: message, isError: true };
}

function parseSteps(raw: unknown): { steps?: IChatSessionPlanStep[]; error?: string } {
  if (raw === undefined) return { steps: undefined };
  if (!Array.isArray(raw)) return { error: 'steps must be an array of { text, status } objects' };
  if (raw.length > PLAN_MAX_STEPS) {
    return { error: `Too many steps (${raw.length}). The plan is capped at ${PLAN_MAX_STEPS} steps — merge or drop the least important ones. A plan is a mission outline, not a transcript.` };
  }
  const steps: IChatSessionPlanStep[] = [];
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown>;
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    const status = typeof entry?.status === 'string' ? entry.status : 'pending';
    if (!text) return { error: `steps[${i}].text is required` };
    if (text.length > PLAN_MAX_STEP_CHARS) {
      return { error: `steps[${i}].text is ${text.length} chars (max ${PLAN_MAX_STEP_CHARS}). Shorten it to the essential action.` };
    }
    if (!VALID_STATUSES.has(status)) {
      return { error: `steps[${i}].status "${status}" is invalid — use pending, active, or done` };
    }
    steps.push({ text, status: status as IChatSessionPlanStep['status'] });
  }
  return { steps };
}

// ── Tool ─────────────────────────────────────────────────────────────────────

export function createPlanUpdateTool(host: IPlanToolHost | undefined): IChatTool {
  return {
    name: 'plan_update',
    displaySummary: 'Create or update your durable working plan for this session.',
    description: 'Create or update your durable working plan for this session. '
      + 'The plan survives context compaction and session reloads, and is shown back to you every turn — it is your mission anchor for multi-step work. '
      + 'Set `goal` once, keep `steps` short (max 12, statuses: pending/active/done), and keep `note` = what is in flight right now + the immediate next action. '
      + 'Update statuses AS YOU WORK, not at the end. Omitted fields keep their current value. Pass `clear: true` when the task is fully complete.',
    parameters: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: `One-line mission statement (max ${PLAN_MAX_GOAL_CHARS} chars). Required on first call.` },
        steps: {
          type: 'array',
          description: `Ordered step list (max ${PLAN_MAX_STEPS}). Replaces the existing steps entirely.`,
          items: {
            type: 'object',
            required: ['text', 'status'],
            properties: {
              text: { type: 'string', description: `Step description (max ${PLAN_MAX_STEP_CHARS} chars).` },
              status: { type: 'string', enum: ['pending', 'active', 'done'] },
            },
          },
        },
        note: { type: 'string', description: `Current state + immediate next action (max ${PLAN_MAX_NOTE_CHARS} chars). Empty string clears it.` },
        clear: { type: 'boolean', description: 'Remove the plan entirely (task complete).' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed',
    category: 'plan',
    source: 'built-in',
    handler: async (
      args: Record<string, unknown>,
      _token: ICancellationToken,
      invocation?: IChatToolInvocationCallContext,
    ): Promise<IToolResult> => {
      if (!host) return validationError('Plan host not available');
      const sessionId = invocation?.sessionId;
      if (!sessionId) return validationError('plan_update requires a session context (none provided for this invocation)');

      if (args.clear === true) {
        host.writePlan(sessionId, undefined);
        return { content: 'Plan cleared.' };
      }

      const existing = host.readPlan(sessionId);

      const rawGoal = typeof args.goal === 'string' ? args.goal.trim() : undefined;
      if (rawGoal !== undefined && rawGoal.length > PLAN_MAX_GOAL_CHARS) {
        return validationError(`goal is ${rawGoal.length} chars (max ${PLAN_MAX_GOAL_CHARS}).`);
      }
      const goal = rawGoal ?? existing?.goal;
      if (!goal) {
        return validationError('goal is required on the first plan_update call — state the mission in one line.');
      }

      const parsed = parseSteps(args.steps);
      if (parsed.error) return validationError(parsed.error);
      const steps = parsed.steps ?? existing?.steps ?? [];

      let note = existing?.note;
      if (typeof args.note === 'string') {
        const trimmed = args.note.trim();
        if (trimmed.length > PLAN_MAX_NOTE_CHARS) {
          return validationError(`note is ${trimmed.length} chars (max ${PLAN_MAX_NOTE_CHARS}). Keep it to current state + next action.`);
        }
        note = trimmed.length > 0 ? trimmed : undefined;
      }

      const plan: IChatSessionPlan = { goal, steps, note, updatedAt: Date.now() };
      host.writePlan(sessionId, plan);

      // Echo the stored plan verbatim — verification material for the model.
      return { content: `Plan updated.\n\n${formatSessionPlan(plan)}` };
    },
  };
}

export const PLAN_TOOL_NAMES = ['plan_update'] as const;
