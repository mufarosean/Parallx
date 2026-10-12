// Worksheets: review and discussion staged in the chat.

import type { WorksheetItemSummary } from './worksheetData.js';
import { buildReviewRequest } from './worksheetAi.js';
import { buildNotesDigest } from './worksheetChat.js';
import { state } from './state.js';

// ── API typings (structural — the tool API surface) ─────────────────────────

// ── Review in Chat ──────────────────────────────────────────────────────────
// The learner's cells and the model solution go to the chat as an attached
// context chip, with the review brief STAGED in the input, not sent: the user
// adds their own question under the brief and presses send, the same hand-off
// the flashcards' Discuss with AI uses (auto-sending asked only the
// question the code guessed, and the one-shot panel left nowhere to ask
// further). Returns 'inline' when the chat surface is not
// there, so the caller can fall back to the one-shot review. An empty sheet
// throws before anything is staged.
export async function reviewInChat(
  item: { title: string; questionMd: string; solutionJson: string; solutionNotesMd: string },
  itemId: number,
  cellsJson: string,
): Promise<'chat' | 'inline'> {
  const req = buildReviewRequest(item, cellsJson);
  const cmds = state.api?.commands;
  if (!cmds?.executeCommand) return 'inline';
  try {
    // chat.show is the idempotent reveal (never chat.focus, which toggles).
    await cmds.executeCommand('chat.show');
    await cmds.executeCommand('chat.addSelectionContext', {
      kind: 'selection',
      id: `worksheet:item/${itemId}/work/${Date.now()}`,
      name: `${item.title}: my work`,
      fullPath: `worksheet:item/${itemId}`,
      isImplicit: false,
      selectedText: req.context,
      surface: 'worksheet',
    });
    await cmds.executeCommand('chat.stagePrompt', { text: req.prompt });
  } catch {
    return 'inline';
  }
  // Staged, not sent: the journal must not claim a review that may never run.
  state.api?.activity?.note('staged', `worksheet attempt on "${item.title}"`, 'in the chat with the review brief, for a question and send');
  return 'chat';
}

/** Every note, staged in the chat ("have AI look at the
 *  whole bank, which problems have notes, gain some insights"). The digest
 *  is the text the worksheet.getNotes tool returns, so what he sees in the
 *  chip is what the model reads. Staged, never sent. */
export async function discussNotesInChat(items: WorksheetItemSummary[]): Promise<void> {
  const cmds = state.api?.commands;
  if (!cmds?.executeCommand) return;
  const noted = items.filter((it) => it.note);
  if (noted.length === 0) return;
  const noun = noted.length === 1 ? 'problem' : 'problems';
  try {
    await cmds.executeCommand('chat.show');
    await cmds.executeCommand('chat.addSelectionContext', {
      kind: 'selection',
      id: `worksheet:notes/${Date.now()}`,
      name: `My notes on ${noted.length} ${noun}`,
      fullPath: 'worksheet:notes',
      isImplicit: false,
      selectedText: buildNotesDigest(items),
      surface: 'worksheet',
    });
    await cmds.executeCommand('chat.stagePrompt', {
      text: [
        `Read my notes on ${noted.length} ${noun} in the attached context. I write them on the fly during quizzes, mostly about what I need to review.`,
        'Group them by topic, tell me what I keep flagging, and which problems to revisit first, naming each problem.',
      ].join(' ') + '\n\n',
    });
  } catch { /* no chat surface */ }
  state.api?.activity?.note('staged', `notes on ${noted.length} worksheet ${noun}`, 'in the chat, for a question and send');
}
