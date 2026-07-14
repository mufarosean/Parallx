// mindTools.ts — the agent's tool for curating its OWN inner model (Build-5).
//
// Until now the MIND was written heuristically (the loop remembered NOTE/ACT
// outcomes and prediction surprises). This gives the model a deliberate way to
// record what it has come to believe about the user and their work during a
// review — the agent updating its own generative model, not just receiving
// writes. Every write is governed (provenance required, decays, forgettable) and
// audited (it lands in the tamper-evident ledger), so it is safe to leave
// always-allowed: the cost of a wrong belief is bounded (it fades, it's visible,
// the human can see it), and requiring approval would defeat autonomous self-modeling.

import type {
  IChatTool,
  IToolResult,
  ICancellationToken,
  ToolPermissionLevel,
} from '../../../services/chatTypes.js';

/** Narrow MIND surface the tool needs (satisfied by MindService). */
export interface IMindWriter {
  remember(kind: 'belief' | 'thread', content: string, confidence: number, provenance: readonly string[]): Promise<boolean>;
}

export function createMindRememberTool(mind: IMindWriter): IChatTool {
  return {
    name: 'mind_remember',
    displaySummary: 'Record a durable belief about the user or their work in your inner model.',
    description:
      'Records a belief or open thread in your persistent inner model (the MIND) — your own evolving ' +
      'understanding of the user, their patterns, their projects, and what you are tracking. Use it during ' +
      'a review when you form or update a durable understanding, so FUTURE reviews build on it instead of ' +
      'starting from scratch. `kind=belief` for a stable fact ("user works on design most weekday mornings"); ' +
      '`kind=thread` for something actively in-flight ("tracking: the planner migration is blocked on stakeholder ' +
      'feedback"). Set `confidence` 0–1. Every belief REQUIRES a `reason` (the evidence) — one with no reason is ' +
      'rejected. Beliefs decay unless you reaffirm them, so only record things worth carrying forward. Keep each ' +
      'to one line. This is YOUR model — the user can see it, but you maintain it. Do not record secrets or raw ' +
      'user content; record understanding. For HARD facts, conventions, or lessons the user should be able to ' +
      'rely on, use `memory_write` instead — the MIND is your softer, self-maintained model that decays.',
    parameters: {
      type: 'object',
      required: ['content', 'reason'],
      properties: {
        content: { type: 'string', description: 'One line: the belief or thread to remember.' },
        kind: { type: 'string', enum: ['belief', 'thread'], description: 'belief = a stable fact; thread = something you are actively tracking. Default belief.' },
        confidence: { type: 'number', description: '0..1 — how confident you are. Default 0.6.' },
        reason: { type: 'string', description: 'Why you believe this — the evidence (provenance). Required; a belief with no reason is rejected.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'memory',
    async handler(args: Record<string, unknown>, _token: ICancellationToken): Promise<IToolResult> {
      const content = typeof args['content'] === 'string' ? args['content'].trim() : '';
      const reason = typeof args['reason'] === 'string' ? args['reason'].trim() : '';
      const kind = args['kind'] === 'thread' ? 'thread' : 'belief';
      let confidence = typeof args['confidence'] === 'number' ? args['confidence'] : 0.6;
      if (!Number.isFinite(confidence)) confidence = 0.6;
      confidence = Math.max(0, Math.min(1, confidence));

      if (!content) return { content: '`content` is required.', isError: true };
      if (!reason) return { content: '`reason` (provenance) is required — a belief with no evidence is rejected by MIND governance.', isError: true };

      const ok = await mind.remember(kind, content, confidence, [reason]);
      return ok
        ? { content: `Remembered (${kind}, confidence ${confidence.toFixed(2)}): "${content}".` }
        : { content: 'MIND governance rejected the write (empty content or provenance).', isError: true };
    },
  };
}
