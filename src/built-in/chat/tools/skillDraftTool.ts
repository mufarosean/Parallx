// skillDraftTool.ts — the AI drafts a skill; you decide whether it is one.
//
// docs/SKILL_AUTHORING_BRIEF.md step 1 ("We do need a self-authoring for
// skills system"). skill_draft writes `.parallx/skills/_drafts/<name>/SKILL.md`.
// The skill loader reads only `.parallx/skills/<name>/SKILL.md`, so a draft
// is never callable: it waits for Add, Review or Dismiss from whichever view
// lists drafts (the parallx.skills.* commands, chat/utilities/skillDraftCommands.ts). The draft says it was written by
// the agent and which chat it came from; that mark stays after Add.

import type { IChatTool, IChatToolInvocationCallContext, IToolResult, ICancellationToken, ToolPermissionLevel } from '../../../services/chatTypes.js';
import type { IBuiltInToolFileWriter } from '../chatTypes.js';

export const SKILL_DRAFTS_DIR = '.parallx/skills/_drafts';
const NAME = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** A YAML scalar on one line, quoted when it needs to be. */
function scalar(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return /[:#[\]{}"']|^[-?!&*|>%@`]/.test(one) ? `"${one.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : one;
}

/** The SKILL.md a draft is written as. */
export function draftSkillFile(input: { name: string; description: string; steps: string; allowedTools?: readonly string[]; sessionId?: string }): string {
  const lines = [
    '---',
    `name: ${input.name}`,
    `description: ${scalar(input.description)}`,
    'version: 0.1.0',
    'author: agent',
    'source: agent',
    ...(input.sessionId ? [`derived-from: ${input.sessionId}`] : []),
    'kind: workflow',
    'user-invocable: true',
    ...(input.allowedTools?.length ? [`allowed-tools: [${input.allowedTools.join(', ')}]`] : []),
    '---',
    '',
    input.steps.trim(),
    '',
  ];
  return lines.join('\n');
}

export function createSkillDraftTool(writer: IBuiltInToolFileWriter | undefined): IChatTool {
  return {
    name: 'skill_draft',
    displaySummary: 'Draft a reusable skill for the user to review.',
    description: 'Draft a reusable skill: the steps for a task the user will want done again. '
      + 'Use when the user asks you to remember how to do something, or after a long task they are likely to repeat. '
      + 'It is saved as a draft for the user to review; it cannot be used until they add it. '
      + '`description` is when to use it (it is what makes the skill come up), so name the situations and words that call for it. '
      + '`steps` is Markdown: numbered steps, general (three rows done means "every row"), with the fixed values written as {{name}} placeholders the user fills in. '
      + 'Mark each step that changes something (writes, sends, deletes) with "(changes things)".',
    parameters: {
      type: 'object',
      required: ['name', 'description', 'steps'],
      properties: {
        name: { type: 'string', description: 'kebab-case, 2 to 40 characters, e.g. weekly-budget-review.' },
        description: { type: 'string', description: 'When to use it, in one or two sentences.' },
        steps: { type: 'string', description: 'The procedure, in Markdown.' },
        allowedTools: { type: 'array', items: { type: 'string' }, description: 'The tools the steps need, by exact name.' },
      },
    },
    requiresConfirmation: false,
    permissionLevel: 'always-allowed' as ToolPermissionLevel,
    category: 'memory', // a learned procedure, kept for review
    async handler(args: Record<string, unknown>, _token: ICancellationToken, invocation?: IChatToolInvocationCallContext): Promise<IToolResult> {
      if (!writer) return { content: 'skill_draft needs a workspace folder, and none is open.', isError: true };
      const name = typeof args.name === 'string' ? args.name.trim() : '';
      const description = typeof args.description === 'string' ? args.description.trim() : '';
      const steps = typeof args.steps === 'string' ? args.steps : '';
      if (!NAME.test(name)) return { content: '`name` must be kebab-case, 2 to 40 characters (a-z, 0-9, -).', isError: true };
      if (!description) return { content: '`description` is required: when to use the skill.', isError: true };
      if (!steps.trim()) return { content: '`steps` is required: the procedure, in Markdown.', isError: true };
      const allowedTools = Array.isArray(args.allowedTools) ? args.allowedTools.filter((t): t is string => typeof t === 'string' && /^[\w.-]+$/.test(t)) : undefined;
      const path = `${SKILL_DRAFTS_DIR}/${name}/SKILL.md`;
      await writer.writeFile(path, draftSkillFile({ name, description, steps, allowedTools, sessionId: invocation?.sessionId }));
      return { content: `Drafted the skill "${name}" (${path}). It waits for the user to review it and decide whether to add it; until then it cannot be used. Tell them a draft is waiting for their review.` };
    },
  };
}
