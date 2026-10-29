// answerFormSuggest.ts — the assistant offers to make a repeated task a tool.
//
// When the person keeps asking for the same kind of task, the assistant may
// say so once and offer a tool for it. It never builds one on its own: the
// card's buttons only put a request in the chat input (Make A Mini-App,
// Build An Extension…), where the person reads it and sends it or not, and
// Not Now puts the card away.

import { escapeHtml } from './format.js';
import { createButton } from './kit.js';
import { getIcon } from './iconRegistry.js';
import type { AnswerForm, AnswerFormContext, AnswerFormHydration } from './answerForms.js';

/** The command Not Now runs (chat registers it with the worked solution's). */
export const DISMISS_COMMAND = 'chat.answerFormStep';
const STAGE_COMMAND = 'chat.stagePrompt';

export function parseSuggestion(src: string): { text: string; task: string } | null {
  let task = '';
  const lines: string[] = [];
  for (const raw of src.split('\n')) {
    const m = /^\s*task\s*:\s*(.+)$/i.exec(raw);
    if (m) task = m[1].trim();
    else if (raw.trim()) lines.push(raw.trim());
  }
  const text = lines.join(' ');
  return text ? { text, task: task || text } : null;
}

let _keys = 0;

function renderSuggestion(src: string, _info: string, ctx: AnswerFormContext): string | null {
  const s = parseSuggestion(src);
  if (!s) return null;
  return `<div class="px-af-suggest" data-af-key="sg${++_keys}" role="note">`
    + `<p class="px-af-suggest__text"><span class="px-af-suggest__icon" aria-hidden="true">${getIcon('sparkles')}</span><span>${ctx.renderInline(s.text)}</span></p>`
    + `<div class="px-af-suggest__actions" data-af-task="${escapeHtml(s.task)}"></div></div>`;
}

function hydrateSuggestion(root: HTMLElement, _h: AnswerFormHydration): void {
  const box = root.querySelector<HTMLElement>('.px-af-suggest');
  const actions = box?.querySelector<HTMLElement>('.px-af-suggest__actions');
  if (!box || !actions) return;
  const task = actions.getAttribute('data-af-task') ?? '';
  createButton(actions, { id: null, label: 'Make A Mini-App', icon: 'sparkles', size: 'sm', command: STAGE_COMMAND, args: [{ text: `Make a mini-app for this: ${task}` }] });
  createButton(actions, { id: null, label: 'Build An Extension…', icon: 'puzzle', size: 'sm', command: STAGE_COMMAND, args: [{ text: `Build an extension for this: ${task}` }] });
  createButton(actions, { id: null, label: 'Not Now', kind: 'ghost', size: 'sm', command: DISMISS_COMMAND, args: [box.getAttribute('data-af-key'), 'dismiss'] });
}

const FENCE = '```';

export const SUGGEST_FORM: Omit<AnswerForm, 'ownerToolId'> = {
  name: 'suggest',
  hint: [
    `### ${FENCE}suggest: offer to make a repeated task a tool`,
    'When the person has asked for the same kind of task several times (in this chat, or as their past chats show), offer once,',
    'at the end of your answer, to make it a tool: one sentence saying what you noticed and asking, then `task:` naming the task.',
    'The person chooses a mini-app or an extension, or Not Now. Never build one they did not ask for, and do not offer again in the same chat.',
    `${FENCE}suggest`, 'You have asked me to convert a recipe to metric four times this month. Want a tool for it?', 'task: convert a recipe to metric', FENCE,
  ].join('\n'),
  render: renderSuggestion,
  hydrate: hydrateSuggestion,
};
