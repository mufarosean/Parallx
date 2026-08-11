// worksheetChat.ts — the AI's read surface over Worksheets (M99).
//
// Two chat tools make the practice bank and the user's ACTUAL sheet work
// visible to any chat/autonomous turn, mirroring how flashcards exposes
// getDue. Both are read-only (no confirmation): the AI can discuss "where
// am I weak" or "look at my work on the Brosius item" with real cells in
// front of it instead of guessing.

import {
  listItems, getItem, findItemByTitle, getLatestAttempt,
  type WorksheetItem, type WorksheetItemSummary, type WorksheetAttempt,
} from './worksheetData.js';
import { serializeWorkbookCells } from './itemFormat.js';

interface ChatApiLike {
  chat?: {
    registerTool(name: string, tool: {
      description: string;
      parameters: Record<string, unknown>;
      handler: (args: Record<string, unknown>, token: unknown) => Promise<{ content: string; isError?: boolean }>;
      requiresConfirmation: boolean;
    }): { dispose(): void };
  };
}

function gradeWord(grade: string): string {
  switch (grade) {
    case 'nailed': return 'nailed';
    case 'partial': return 'partial';
    case 'missed': return 'missed';
    default: return grade || 'ungraded';
  }
}

function itemTags(tags: string): string[] {
  return tags.split(',').map((t) => t.trim()).filter(Boolean);
}

/** Per-tag rollup + full item listing, compact enough to drop into a prompt. */
export function buildProgressReport(items: WorksheetItemSummary[]): string {
  if (items.length === 0) {
    return 'The practice bank is empty — no worksheet items exist yet. The user can generate some from a PDF or pasted material (Worksheets sidebar → Generate Items).';
  }
  const attempted = items.filter((i) => i.attemptCount > 0 || i.attemptState === 'open');

  const byTag = new Map<string, { items: number; attempted: number; grades: Map<string, number> }>();
  for (const item of items) {
    const tags = itemTags(item.tags);
    for (const tag of tags.length ? tags : ['(untagged)']) {
      let entry = byTag.get(tag);
      if (!entry) { entry = { items: 0, attempted: 0, grades: new Map() }; byTag.set(tag, entry); }
      entry.items += 1;
      if (item.attemptCount > 0 || item.attemptState === 'open') entry.attempted += 1;
      if (item.attemptState && item.attemptState !== 'open') {
        entry.grades.set(item.attemptState, (entry.grades.get(item.attemptState) ?? 0) + 1);
      }
    }
  }

  const lines: string[] = [];
  lines.push(`Practice bank: ${items.length} ${items.length === 1 ? 'item' : 'items'}, ${attempted.length} attempted.`);
  lines.push('');
  lines.push('By tag (latest grade per item):');
  const tags = [...byTag.entries()].sort((a, b) => b[1].items - a[1].items);
  for (const [tag, entry] of tags) {
    const grades = [...entry.grades.entries()].map(([g, n]) => `${n} ${gradeWord(g)}`).join(', ');
    lines.push(`- ${tag === '(untagged)' ? tag : `#${tag}`}: ${entry.items} items, ${entry.attempted} attempted${grades ? ` (${grades})` : ''}`);
  }
  lines.push('');
  lines.push('Items (newest first):');
  for (const item of items) {
    const bits: string[] = [];
    const tagStr = itemTags(item.tags).map((t) => `#${t}`).join(' ');
    if (tagStr) bits.push(tagStr);
    if (item.sourceLabel) bits.push(item.sourcePage > 0 ? `${item.sourceLabel} p.${item.sourcePage}` : item.sourceLabel);
    if (item.attemptState === 'open') bits.push('IN PROGRESS');
    else if (item.attemptState) bits.push(`latest: ${gradeWord(item.attemptState)}`);
    if (item.attemptCount > 0) bits.push(`${item.attemptCount} completed ${item.attemptCount === 1 ? 'attempt' : 'attempts'}`);
    if (!item.attemptState && item.attemptCount === 0) bits.push('never attempted');
    lines.push(`- [id ${item.id}] "${item.title}" — ${bits.join(' · ')}`);
  }
  return lines.join('\n');
}

/** The user's real cells, the model solution, and grading context for one item. */
export function buildUserWorkReport(item: WorksheetItem, attempt: WorksheetAttempt | null): string {
  const lines: string[] = [];
  const src = item.sourceLabel
    ? ` (source: ${item.sourceLabel}${item.sourcePage > 0 ? ` p.${item.sourcePage}` : ''})`
    : '';
  lines.push(`Item [id ${item.id}] "${item.title}"${src}`);
  lines.push('');
  lines.push('QUESTION:');
  lines.push(item.questionMd || '(no question text)');
  lines.push('');

  if (!attempt || !attempt.cellsJson.trim()) {
    lines.push("USER'S WORK: none yet — the user has not started this item.");
  } else {
    const state = attempt.completed
      ? `completed, self-graded "${gradeWord(attempt.selfGrade)}"`
      : 'in progress';
    lines.push(`USER'S WORK (${state}, cell format "REF: value (formula)"):`);
    lines.push(serializeWorkbookCells(attempt.cellsJson) || '(sheet is empty)');
  }
  lines.push('');
  lines.push('MODEL SOLUTION CELLS:');
  lines.push(serializeWorkbookCells(item.solutionJson) || '(no solution cells)');
  if (item.solutionNotesMd) {
    lines.push('');
    lines.push('SOLUTION NOTES:');
    lines.push(item.solutionNotesMd);
  }
  if (attempt?.aiReviewMd) {
    lines.push('');
    lines.push('PRIOR AI REVIEW OF THIS ATTEMPT:');
    lines.push(attempt.aiReviewMd);
  }
  return lines.join('\n');
}

/** Register both tools. No-op when the chat surface is absent (tests, minimal builds). */
export function registerWorksheetChatTools(
  api: ChatApiLike,
  subscriptions: { push(d: { dispose(): void }): void },
): void {
  if (!api.chat?.registerTool) return;

  subscriptions.push(api.chat.registerTool('worksheet.getProgress', {
    description: 'Read the Worksheets practice bank: every practice item with its tags, source, attempt count, and latest self-grade, plus per-tag progress rollups. Use this to answer questions about what the user has practiced, what exists in the bank, or where they are weak.',
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    handler: async () => {
      try {
        return { content: buildProgressReport(await listItems()) };
      } catch (err) {
        return { content: `Could not read the practice bank: ${(err as Error).message}`, isError: true };
      }
    },
  }));

  subscriptions.push(api.chat.registerTool('worksheet.getUserWork', {
    description: "See the user's actual spreadsheet work on a practice item: the question, every cell the user entered (values and formulas), the model solution, and any prior AI review. Use this whenever the user asks about their work on an item, wants help mid-attempt, or asks how their answer compares to the solution. Identify the item by id (from worksheet.getProgress) or by title.",
    parameters: {
      type: 'object',
      properties: {
        itemId: { type: 'number', description: 'The item id, as listed by worksheet.getProgress.' },
        title: { type: 'string', description: 'Full or partial item title, when the id is unknown.' },
      },
    },
    requiresConfirmation: false,
    handler: async (args) => {
      try {
        const id = typeof args.itemId === 'number' && Number.isFinite(args.itemId) ? args.itemId : null;
        const title = typeof args.title === 'string' ? args.title : '';
        const item = id != null ? await getItem(id) : title ? await findItemByTitle(title) : null;
        if (!item) {
          return {
            content: id != null || title
              ? `No practice item matched ${id != null ? `id ${id}` : `"${title}"`}. Call worksheet.getProgress to list the bank.`
              : 'Pass itemId or title. Call worksheet.getProgress to list the bank.',
            isError: true,
          };
        }
        const attempt = await getLatestAttempt(item.id);
        return { content: buildUserWorkReport(item, attempt) };
      } catch (err) {
        return { content: `Could not read the item: ${(err as Error).message}`, isError: true };
      }
    },
  }));
}
