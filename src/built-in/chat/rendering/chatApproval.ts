// chatApproval.ts — the one way the chat asks for your OK.
//
// A tool that needs approval appears as a node on the same spine as every
// other step (see .parallx-chat-tool-node in chatWidget.css): an amber
// marker, the tool, what it means to do, a preview of the change, and three
// answers: Allow, Allow For This Chat, Reject. Always Allow is a quiet link;
// standing grants are managed in Settings. Used by the live approval prompt
// (chat/main.ts) and by confirmation parts kept in the transcript.

import { argsWithoutIntent, readToolIntent } from '../../../services/toolIntent.js';
import type { ToolGrantDecision } from '../../../services/chatTypes.js';

export interface IApprovalNodeOptions {
  readonly toolName: string;
  readonly args?: Record<string, unknown>;
  /** A line under the tool name; defaults to the model's stated intent. */
  readonly message?: string;
  /** Why approval is forced (a policy gate), shown under the preview. */
  readonly reason?: string;
  /** The grants offered. A command family (`npm`) scopes the standing ones. */
  readonly family?: string;
  /** Tools on the belt offer no standing grant at all. */
  readonly onBelt?: boolean;
  readonly onDecide: (decision: ToolGrantDecision) => void;
}

const DECIDED: Record<ToolGrantDecision, string> = {
  'allow-once': 'Allowed',
  'allow-session': 'Allowed for this chat',
  'always-allow': 'Always allowed',
  'reject': 'You said no',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** What the change looks like, for the tools whose arguments describe one. */
function previewLines(toolName: string, args: Record<string, unknown>): { kind: 'add' | 'cmd' | 'plain'; lines: string[] } {
  const md = typeof args['markdown'] === 'string' ? args['markdown'] as string
    : typeof args['content'] === 'string' ? args['content'] as string
      : typeof args['text'] === 'string' ? args['text'] as string : '';
  if (md && /canvas_|fs_write|fs_edit|create_page|edit_page|insert_block|edit_block/.test(toolName)) {
    const lines = md.split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
    const shown = lines.slice(0, 6);
    if (lines.length > 6) shown.push(`… ${lines.length - 6} more line${lines.length - 6 === 1 ? '' : 's'}`);
    return { kind: 'add', lines: shown };
  }
  if (typeof args['command'] === 'string') return { kind: 'cmd', lines: [String(args['command'])] };
  const entries = argsWithoutIntent(toolName, args);
  return {
    kind: 'plain',
    lines: entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? (v.length > 80 ? `${v.slice(0, 80)}…` : v) : JSON.stringify(v)}`),
  };
}

/** The settled form of an approval: one line on the spine. */
export function settleApprovalNode(root: HTMLElement, decision: ToolGrantDecision): void {
  root.classList.remove('parallx-chat-approval--asking');
  root.classList.add(decision === 'reject' ? 'parallx-chat-approval--rejected' : 'parallx-chat-approval--allowed');
  root.querySelector('.parallx-chat-approval-card')?.remove();
  const meta = root.querySelector('.parallx-chat-approval-meta');
  if (meta) meta.textContent = DECIDED[decision];
}

export function buildApprovalNode(opts: IApprovalNodeOptions): HTMLElement {
  const args = opts.args ?? {};
  const root = el('div', 'parallx-chat-tool-invocation parallx-chat-tool-node parallx-chat-approval parallx-chat-approval--asking');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `${opts.toolName} needs your OK`);

  const head = el('div', 'parallx-chat-tool-invocation-header');
  head.appendChild(el('span', 'parallx-chat-tool-node-marker'));
  head.appendChild(el('span', 'parallx-chat-tool-invocation-name', opts.toolName));
  head.appendChild(el('span', 'parallx-chat-approval-meta', 'needs your OK'));
  root.appendChild(head);

  const card = el('div', 'parallx-chat-approval-card');
  const intent = opts.message || readToolIntent(opts.toolName, args);
  if (intent) card.appendChild(el('div', 'parallx-chat-approval-intent', intent));

  const preview = previewLines(opts.toolName, args);
  if (preview.lines.length) {
    const box = el('div', `parallx-chat-approval-preview parallx-chat-approval-preview--${preview.kind}`);
    for (const line of preview.lines) {
      const row = el('div', 'parallx-chat-approval-line');
      row.textContent = preview.kind === 'add' && !line.startsWith('…') ? `+ ${line}` : preview.kind === 'cmd' ? `$ ${line}` : line;
      box.appendChild(row);
    }
    card.appendChild(box);
  }
  if (opts.reason) card.appendChild(el('div', 'parallx-chat-approval-reason', opts.reason));

  const bar = el('div', 'parallx-chat-approval-buttons');
  let decided = false;
  const decide = (d: ToolGrantDecision): void => {
    if (decided) return;
    decided = true;
    settleApprovalNode(root, d);
    opts.onDecide(d);
  };
  const button = (label: string, cls: string, d: ToolGrantDecision): HTMLButtonElement => {
    const b = el('button', `parallx-chat-approval-btn ${cls}`, label);
    b.type = 'button';
    b.addEventListener('click', () => decide(d));
    bar.appendChild(b);
    return b;
  };
  const allow = button('Allow', 'parallx-chat-approval-btn--primary', 'allow-once');
  if (!opts.onBelt) button(opts.family ? `Allow ${opts.family} For This Chat` : 'Allow For This Chat', 'parallx-chat-approval-btn--secondary', 'allow-session');
  button('Reject', 'parallx-chat-approval-btn--secondary', 'reject');
  if (!opts.onBelt) {
    const always = el('button', 'parallx-chat-approval-always', opts.family ? `Always Allow ${opts.family}` : 'Always Allow');
    always.type = 'button';
    always.title = 'Never ask again for this. Change it later in Settings.';
    always.addEventListener('click', () => decide('always-allow'));
    bar.appendChild(always);
  }
  card.appendChild(bar);
  root.appendChild(card);
  // Focus stays where the user is typing (an Enter meant for the composer
  // must never approve); inside the node, Escape answers Reject.
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); decide('reject'); }
  });
  void allow;
  return root;
}
