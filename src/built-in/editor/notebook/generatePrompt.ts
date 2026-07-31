// generatePrompt.ts — build the messages for "Generate" in a notebook cell.
//
// Kept separate from the pane because the interesting part is not the streaming
// plumbing, it is WHAT the model is told. A notebook cell is never a blank page:
// it runs after the cells above it, against a kernel that already has their
// imports and variables. A model given only "read the csv" writes `import
// pandas as pd` again and invents a filename; the same model given the two cells
// above writes `df2 = pd.read_csv(path)` using the `path` that already exists.
//
// So the preceding cells ARE the prompt, and this module decides how many of
// them fit and in what shape.

import type { IChatMessage } from '../../../services/chatTypes.js';
import type { NotebookCell } from './notebookModel.js';

/**
 * Character budget for the preceding-cell context.
 *
 * Deliberately a character count, not a token count: the real limit lives in the
 * model's context window, which this module cannot see, and every provider
 * counts differently. A fixed conservative slice is honest about that — it never
 * claims to have measured what it hasn't.
 */
export const MAX_CONTEXT_CHARS = 6000;

/** Longest single cell included verbatim before it is elided in the middle. */
const MAX_CELL_CHARS = 1500;

export interface GenerateRequest {
  /** What the user typed. */
  readonly instruction: string;
  /** Cells that run BEFORE the target cell, in notebook order. */
  readonly preceding: readonly NotebookCell[];
  /** Kernel language, e.g. `python`. */
  readonly language: string;
  /** Existing content of the target cell, when regenerating rather than filling. */
  readonly existing?: string;
}

/**
 * The system message.
 *
 * "No fences, no prose" is asked for even though `stripCodeFences` exists,
 * because a model that complies produces a clean stream the user watches appear
 * — whereas one that wraps its answer shows a burst of prose that vanishes when
 * the fence closes. The stripper is the safety net, not the plan.
 */
function systemPrompt(language: string): string {
  return [
    `You write ${language} for a single Jupyter notebook cell.`,
    '',
    'Rules:',
    `- Reply with ${language} source only. No markdown fences, no backticks, no explanation before or after.`,
    '- The cells shown to you have ALREADY run in this kernel. Reuse their imports, variables and dataframes instead of redefining them.',
    '- Write only what this one cell needs. Do not restate earlier cells.',
    '- Use comments for anything you would otherwise have said in prose.',
    '- If the request is ambiguous, pick the most conventional reading and note the assumption in a comment.',
  ].join('\n');
}

/**
 * Render the cells above into a transcript the model can read.
 *
 * Walked newest-first so that when the budget runs out it is the OLDEST cells
 * that are dropped — the ones nearest the target cell are the ones whose
 * variables the new code is most likely to touch. The result is then flipped
 * back into notebook order, because a model reading cells out of order infers
 * the wrong execution sequence.
 */
export function buildNotebookContext(
  cells: readonly NotebookCell[],
  budget: number = MAX_CONTEXT_CHARS,
): string {
  const parts: string[] = [];
  let used = 0;
  let dropped = 0;

  for (let i = cells.length - 1; i >= 0; i--) {
    const cell = cells[i];
    const source = cell.source.trim();
    if (!source) continue;
    if (cell.cellType === 'raw') continue;

    const body = cell.cellType === 'markdown'
      ? `# [markdown cell]\n${source.split('\n').map((l) => `# ${l}`).join('\n')}`
      : elide(source);

    if (used + body.length > budget) { dropped = i + 1; break; }
    used += body.length;
    parts.push(body);
  }

  parts.reverse();
  if (dropped > 0) {
    parts.unshift(`# [${dropped} earlier cell${dropped === 1 ? '' : 's'} omitted]`);
  }
  return parts.join('\n\n');
}

/** Keep both ends of an over-long cell — the imports at the top and the result at the bottom. */
function elide(source: string): string {
  if (source.length <= MAX_CELL_CHARS) return source;
  const half = Math.floor(MAX_CELL_CHARS / 2);
  return `${source.slice(0, half)}\n# … ${source.length - MAX_CELL_CHARS} characters omitted …\n${source.slice(-half)}`;
}

/** Assemble the full request sent to the language model. */
export function buildGenerateMessages(req: GenerateRequest): IChatMessage[] {
  const messages: IChatMessage[] = [
    { role: 'system', content: systemPrompt(req.language) },
  ];

  const context = buildNotebookContext(req.preceding);
  if (context) {
    messages.push({
      role: 'user',
      content: `Cells already run in this kernel, in order:\n\n${context}`,
    });
    // A pre-filled acknowledgement keeps the transcript in strict
    // user/assistant alternation, which some local chat templates require and
    // will otherwise silently mangle.
    messages.push({ role: 'assistant', content: 'Understood. I have the notebook state.' });
  }

  const existing = req.existing?.trim();
  messages.push({
    role: 'user',
    content: existing
      ? `Rewrite this cell.\n\nCurrent cell:\n${existing}\n\nChange requested: ${req.instruction}`
      : req.instruction,
  });

  return messages;
}
