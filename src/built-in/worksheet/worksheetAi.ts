// worksheetAi.ts — Worksheets (M99): AI item generation + attempt review.
//
// Same LM discipline as the M98 flashcards work: page-tagged material so page
// attribution is real, a stall watchdog because the LM API has no
// AbortSignal, and structured JSON extracted by pure code (itemFormat.ts).

import { extractItemsJson, serializeWorkbookCells, type GeneratedItem } from './itemFormat.js';
import { ATHENA_ROWS, ATHENA_COLUMNS } from './worksheetConstants.js';
import type { WorksheetItem } from './worksheetData.js';

// ── LM plumbing (structural typings over api.lm) ────────────────────────────

export interface LmApiLike {
  sendChatRequest(
    modelId: string,
    messages: { role: string; content: string }[],
    options?: { temperature?: number },
  ): AsyncIterable<{ content?: string; done?: boolean }>;
  getActiveModel?(): string | undefined;
  getModels?(): Promise<{ id: string }[]>;
}

async function pickModel(lm: LmApiLike): Promise<string | null> {
  try {
    const active = lm.getActiveModel?.();
    if (active) return active;
  } catch { /* fall through */ }
  try {
    const models = await lm.getModels?.();
    if (models && models.length > 0) return models[0].id;
  } catch { /* fall through */ }
  return null;
}

/** Consume an LM stream with a stall watchdog (no chunk for `stallMs` → throw). */
async function streamWithStall(
  stream: AsyncIterable<{ content?: string }>,
  onChunk: (chunk: { content?: string }) => void,
  stallMs = 90_000,
): Promise<void> {
  const it = stream[Symbol.asyncIterator]();
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stall = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(
        `The model stopped responding (no output for ${Math.round(stallMs / 1000)}s). Check that the model backend is running.`,
      )), stallMs);
    });
    let step: IteratorResult<{ content?: string }>;
    try {
      step = await Promise.race([it.next(), stall]);
    } finally {
      clearTimeout(timer);
    }
    if (step.done) return;
    onChunk(step.value);
  }
}

// ── Item generation ─────────────────────────────────────────────────────────

const WS_GENERATE_SYSTEM = [
  'You create spreadsheet practice items for exam study, mimicking constructed-response items on the Pearson VUE Athena driver.',
  'Each item: a worked calculation problem with GIVEN data pre-populated in cells and a fully WORKED solution.',
  'Rules:',
  '- Base every item strictly on the material. Never invent facts, methods, or numbers not supported by it.',
  `- The grid is ${ATHENA_COLUMNS} columns (A..AN) by ${ATHENA_ROWS} rows. Keep items compact: givens in roughly A1:H20.`,
  '- "givens" cells hold ONLY input data and labels (values, no formulas). Bold the labels.',
  '- "solution" cells show the complete worked answer: intermediate steps as formulas referencing the given cells (e.g. "=B4*C4"), with labels. Every formula must reference real cells that hold values.',
  '- "question" is Markdown (KaTeX allowed: $...$ for formulas). State the task the way an exam would.',
  '- "solution_notes" is Markdown explaining the method step by step.',
  '- When the material carries [Page N] markers, add "page": N for the page the item comes from.',
  '- Never use em dashes.',
  'Output ONLY a JSON array, no prose, in this exact shape:',
  '[{"title": "...", "question": "...", "tags": ["topic"],',
  '  "givens": [{"cell": "B2", "value": "Earned Premium", "bold": true}, {"cell": "C2", "value": 1250.5}],',
  '  "solution": [{"cell": "B8", "value": "Loss Ratio", "bold": true}, {"cell": "C8", "formula": "=C4/C2"}],',
  '  "solution_notes": "...", "page": 1}]',
].join('\n');

export interface GenerateItemsOptions {
  count?: number;
  focus?: string;
  pageTexts?: string[] | null;
}

/** Build the material block, page-tagged when per-page text exists (M98). */
export function buildItemMaterial(sourceText: string, pageTexts: string[] | null | undefined, maxChars: number): { material: string; paged: boolean } {
  if (!Array.isArray(pageTexts) || pageTexts.length === 0) {
    return { material: sourceText.slice(0, maxChars), paged: false };
  }
  const parts: string[] = [];
  let used = 0;
  for (let i = 0; i < pageTexts.length; i++) {
    const text = String(pageTexts[i] || '').trim();
    if (!text) continue;
    const block = `[Page ${i + 1}]\n${text}`;
    if (used + block.length > maxChars) break;
    parts.push(block);
    used += block.length + 2;
  }
  return { material: parts.join('\n\n'), paged: true };
}

export async function generateItems(
  lm: LmApiLike,
  sourceText: string,
  { count = 3, focus = '', pageTexts = null }: GenerateItemsOptions = {},
): Promise<GeneratedItem[]> {
  const modelId = await pickModel(lm);
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const { material, paged } = buildItemMaterial(sourceText, pageTexts, 60_000);
  const user = [
    `Create ${Math.min(6, Math.max(1, count))} practice item(s) from the material below.`,
    paged ? 'The material is tagged with [Page N] markers. Add "page": N to each item. Never invent a page number.' : '',
    focus ? `Guidance from the learner (follow it): ${focus}` : '',
    '',
    '--- MATERIAL ---',
    material,
  ].filter(Boolean).join('\n');

  let output = '';
  const stream = lm.sendChatRequest(modelId, [
    { role: 'system', content: WS_GENERATE_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.3 });
  await streamWithStall(stream, (chunk) => { if (chunk.content) output += chunk.content; });

  const { items, error } = extractItemsJson(output);
  if (error && items.length === 0) {
    console.warn('[WorksheetAI] generation failed. Raw output head:', output.slice(0, 400));
    throw new Error(`${error} (model: ${modelId}; raw output logged to console)`);
  }
  if (!paged) return items.map((i) => ({ ...i, page: undefined }));
  return items;
}

// ── Attempt review ──────────────────────────────────────────────────────────

const WS_REVIEW_SYSTEM = [
  'You review a learner\'s spreadsheet work on an exam practice item, comparing it against the model solution.',
  'This exam grades METHOD as well as the final answer. Give feedback, never a score:',
  '- Say what the learner got right (method steps, correct intermediate values).',
  '- Pinpoint each divergence: which cell, what they did, what the solution does, and why it matters.',
  '- If the method differs but is also valid, say so plainly.',
  '- Be concise and concrete. Markdown; KaTeX ($...$) for formulas. Never use em dashes.',
].join('\n');

export async function reviewAttempt(
  lm: LmApiLike,
  item: Pick<WorksheetItem, 'title' | 'questionMd' | 'solutionJson' | 'solutionNotesMd'>,
  attemptCellsJson: string,
  onChunk: (text: string) => void,
): Promise<string> {
  const modelId = await pickModel(lm);
  if (!modelId) throw new Error('No language model available. Configure a model in AI settings.');
  const attempt = serializeWorkbookCells(attemptCellsJson);
  if (!attempt.trim()) throw new Error('There is no work on the sheet to review yet.');
  const user = [
    `ITEM: ${item.title}`,
    `QUESTION:\n${item.questionMd}`,
    '',
    'MODEL SOLUTION CELLS:',
    serializeWorkbookCells(item.solutionJson) || '(none)',
    item.solutionNotesMd ? `\nMODEL SOLUTION NOTES:\n${item.solutionNotesMd}` : '',
    '',
    'LEARNER\'S WORK (cells):',
    attempt,
    '',
    'Review the learner\'s work.',
  ].filter(Boolean).join('\n');

  let output = '';
  const stream = lm.sendChatRequest(modelId, [
    { role: 'system', content: WS_REVIEW_SYSTEM },
    { role: 'user', content: user },
  ], { temperature: 0.3 });
  await streamWithStall(stream, (chunk) => {
    if (chunk.content) {
      output += chunk.content;
      onChunk(output);
    }
  });
  return output.trim();
}
