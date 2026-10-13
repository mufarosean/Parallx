// workflowPalette.ts — what the workflow editor can add: the palette
// entries, the kinds kept out of it, and the one-line summary a node
// card shows for its configuration.

import { describeTriggerNode } from '../../services/workflows/workflowGraph.js';
import { normalizeFactsInclude, isTriggerNode, type WorkflowDoc, type WorkflowNode } from '../../services/workflows/workflowTypes.js';

export interface PaletteEntry {
  readonly kind: WorkflowNode['kind'];
  readonly label: string;
  readonly icon: string;
  readonly family: 'trigger' | 'context' | 'control' | 'action';
  readonly make: (id: string, x: number, y: number) => WorkflowNode;
}

/** Kinds kept OUT of the palette (prompt-compiler thesis: tools live in
 *  the mission text, by exact name; prescriptive nodes are power-user
 *  compat only). Existing documents still render via HIDDEN_META. */
export const HIDDEN_META: readonly PaletteEntry[] = [
  {
    kind: 'action.command', label: 'Command', icon: 'terminal', family: 'action',
    make: (id, x, y) => ({ id, x, y, label: 'Command', kind: 'action.command', commandId: '' }),
  },
  {
    kind: 'action.tool', label: 'Tool', icon: 'wrench', family: 'action',
    make: (id, x, y) => ({ id, x, y, label: 'Tool', kind: 'action.tool', toolName: '' }),
  },
];

export const PALETTE: readonly PaletteEntry[] = [
  {
    kind: 'trigger.schedule', label: 'Schedule', icon: 'calendar-clock', family: 'trigger',
    make: (id, x, y) => ({ id, x, y, label: 'Schedule', kind: 'trigger.schedule', spec: { kind: 'daily', time: '09:00' } }),
  },
  {
    kind: 'trigger.manual', label: 'Manual', icon: 'play', family: 'trigger',
    make: (id, x, y) => ({ id, x, y, label: 'Manual', kind: 'trigger.manual' }),
  },
  {
    kind: 'trigger.event', label: 'Event', icon: 'radio', family: 'trigger',
    make: (id, x, y) => ({ id, x, y, label: 'Event', kind: 'trigger.event', source: 'tool' }),
  },
  {
    kind: 'context.facts', label: 'App Facts', icon: 'list-checks', family: 'context',
    make: (id, x, y) => ({ id, x, y, label: 'App Facts', kind: 'context.facts' }),
  },
  {
    kind: 'context.exemplar', label: 'Format', icon: 'layout-template', family: 'context',
    make: (id, x, y) => ({ id, x, y, label: 'Format', kind: 'context.exemplar', ref: { kind: 'template', id: '' } }),
  },
  {
    kind: 'control.cooldown', label: 'Cooldown', icon: 'timer', family: 'control',
    make: (id, x, y) => ({ id, x, y, label: 'Cooldown', kind: 'control.cooldown', hours: 24 }),
  },
  {
    kind: 'action.agentTurn', label: 'Agent Turn', icon: 'px-ai-mark', family: 'action',
    make: (id, x, y) => ({ id, x, y, label: 'Agent Turn', kind: 'action.agentTurn', prompt: 'Describe the task here.' }),
  },
  {
    kind: 'action.notify', label: 'Notify', icon: 'bell', family: 'action',
    make: (id, x, y) => ({ id, x, y, label: 'Notify', kind: 'action.notify', message: 'Something happened.' }),
  },
];

export const KIND_META = new Map([...PALETTE, ...HIDDEN_META].map((p) => [p.kind, p]));

/**
 * Where the node `fromId` can connect (the inspector's Connect To, the
 * keyboard's way to drag its dot onto another card): not itself, not a
 * trigger (nothing points into one), not a node it already points to.
 */
export function connectTargets(doc: WorkflowDoc, fromId: string): { value: string; label: string }[] {
  const linked = new Set(doc.edges.filter((e) => e.from === fromId).map((e) => e.to));
  return doc.nodes.filter((n) => n.id !== fromId && !isTriggerNode(n) && !linked.has(n.id))
    .map((n) => ({ value: n.id, label: n.label || KIND_META.get(n.kind)?.label || n.kind }));
}

/** One line of a node's configuration for the card face. */
export function nodeSummary(n: WorkflowNode): string {
  switch (n.kind) {
    case 'trigger.schedule': return describeTriggerNode(n);
    case 'trigger.manual': return 'Run manually';
    case 'trigger.event': {
      const parts = [n.source && `source ${n.source}`, n.verb && `verb ${n.verb}`, n.actor && `actor ${n.actor}`]
        .filter(Boolean);
      return parts.length ? parts.join(' · ') : 'Matches everything.';
    }
    case 'context.facts': {
      const inc = normalizeFactsInclude(n.include);
      const all = inc.schedule === undefined && inc.activity === undefined && inc.sync === undefined && inc.pages === undefined;
      const parts = all
        ? ['schedule', 'activity', 'sync', 'pages']
        : Object.entries(inc).filter(([, v]) => v).map(([k]) => k);
      return parts.length ? `injects ${parts.join(' · ')}` : 'Nothing selected.';
    }
    case 'context.exemplar':
      return n.ref?.id ? `format: ${n.ref.name ?? n.ref.id}` : 'no format picked';
    case 'control.cooldown': return n.hours > 0 ? `${n.hours}h between deliveries` : 'always open';
    case 'action.agentTurn': return oneLine(n.prompt, 64);
    case 'action.command': return n.commandId || 'no command set';
    case 'action.tool': return n.toolName || 'no tool set';
    case 'action.notify': return oneLine(n.message, 64);
  }
}

export function oneLine(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
