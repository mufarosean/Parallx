// chatRequestParser.ts — Input parsing (M9 Task 3.5)
//
// Regex-based extraction of @participant mentions, /commands, and
// #variable references from user input.
//
// VS Code reference:
//   src/vs/workbench/contrib/chat/common/requestParser/chatRequestParser.ts

import type { IChatParsedRequest, IChatParsedVariable } from './chatTypes.js';

// IChatParsedRequest, IChatParsedVariable — now defined in chatTypes.ts (M13 Phase 1)
export type { IChatParsedRequest, IChatParsedVariable } from './chatTypes.js';

// ── Regex Patterns ──

/** Matches @participantId at the start of the input. */
const PARTICIPANT_RE = /^@(\S+)\s*/;

/** Matches /command immediately after participant mention (or at start). */
const COMMAND_RE = /^\/(\S+)\s*/;

/** Matches #variableName anywhere in the remaining text. */
const VARIABLE_RE = /#(\w+)/g;

/**
 * Parse user input to extract @participant, /command, and #variables.
 *
 * Handles:
 * - "@workspace what is this project?" → participant: "workspace"
 * - "@workspace /search query" → participant: "workspace", command: "search"
 * - "#currentPage explain this" → variable: "currentPage"
 * - "just a plain message" → no extraction
 * - Escaped \@ and \/ are not treated as mentions/commands
 */
export function parseChatRequest(input: string): IChatParsedRequest {
  let remaining = input.trim();
  let participantId: string | undefined;
  let command: string | undefined;
  const variables: IChatParsedVariable[] = [];

  // 1. Extract @participantId from the beginning
  if (remaining.startsWith('@') && !remaining.startsWith('\\@')) {
    const match = PARTICIPANT_RE.exec(remaining);
    if (match) {
      participantId = match[1];
      remaining = remaining.slice(match[0].length);
    }
  }

  // 2. Extract /command from the beginning (after participant)
  if (remaining.startsWith('/') && !remaining.startsWith('\\/')) {
    const match = COMMAND_RE.exec(remaining);
    if (match) {
      command = match[1];
      remaining = remaining.slice(match[0].length);
    }
  }

  // 3. Extract #variables from the remaining text
  let varMatch: RegExpExecArray | null;
  VARIABLE_RE.lastIndex = 0;
  while ((varMatch = VARIABLE_RE.exec(remaining)) !== null) {
    variables.push({
      name: varMatch[1],
      original: varMatch[0],
    });
  }

  // 4. Clean variable references from the text
  let text = remaining;
  for (const v of variables) {
    text = text.replace(v.original, '').trim();
  }

  // Collapse multiple spaces
  text = text.replace(/\s{2,}/g, ' ').trim();

  return {
    participantId,
    command,
    variables,
    text,
  };
}
