// chatMentionResolver.ts — Mention extraction + resolution (M11 Tasks 3.2–3.4)
//
// Extracts @file:, @folder:, and @workspace mentions from user input text.
// Resolves them to file content / RAG results and injects into context.
//
// Design:
//   1. extractMentions() — parse raw text, return mention descriptors
//   2. resolveMentions() — read file/folder content, query RAG, assemble context
//
// These are standalone functions called from defaultParticipant.ts during
// context injection, after history but before composing the final user message.

import type { IContextPill } from '../../../services/chatTypes.js';
import type { IChatMention, IMentionResolutionResult, IMentionResolutionServices } from '../chatTypes.js';

// IChatMention, IMentionResolutionResult, IMentionResolutionServices — now defined in chatTypes.ts (M13 Phase 1)
export type { IChatMention, IMentionResolutionResult, IMentionResolutionServices } from '../chatTypes.js';

// ── Regex: matches @file:path, @folder:path, @workspace, @terminal ──
// Path can be quoted ("path with spaces") or unquoted (terminated by whitespace).
const MENTION_RE = /@(file|folder):(?:"([^"]+)"|(\S+))|@(workspace|terminal)\b/g;

/**
 * Extract all mentions from user input text.
 */
export function extractMentions(text: string): IChatMention[] {
  const mentions: IChatMention[] = [];
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = MENTION_RE.exec(text)) !== null) {
    if (match[4]) {
      // @workspace or @terminal (no path argument)
      mentions.push({
        kind: match[4] as 'workspace' | 'terminal',
        original: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    } else {
      // @file:path or @folder:path
      const kind = match[1] as 'file' | 'folder';
      const path = match[2] ?? match[3]; // quoted or unquoted
      mentions.push({
        kind,
        path,
        original: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return mentions;
}

/**
 * Strip mention texts from the user's message to produce clean text.
 */
export function stripMentions(text: string, mentions: readonly IChatMention[]): string {
  if (mentions.length === 0) { return text; }

  let result = text;
  // Remove in reverse order to preserve offsets
  const sorted = [...mentions].sort((a, b) => b.start - a.start);
  for (const m of sorted) {
    result = result.substring(0, m.start) + result.substring(m.end);
  }

  // Collapse multiple spaces
  return result.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Resolve mentions to context blocks + pills.
 *
 * Called from defaultParticipant's context injection phase.
 */
export async function resolveMentions(
  text: string,
  mentions: readonly IChatMention[],
  services: IMentionResolutionServices,
  /** Maximum total characters for folder expansion. */
  folderCharBudget: number = 100_000,
): Promise<IMentionResolutionResult> {
  const contextBlocks: string[] = [];
  const pills: IContextPill[] = [];
  const cleanText = stripMentions(text, mentions);

  for (const mention of mentions) {
    switch (mention.kind) {
      case 'file': {
        if (!mention.path || !services.readFileContent) { break; }
        try {
          const content = await services.readFileContent(mention.path);
          const tokens = Math.ceil(content.length / 4);
          contextBlocks.push(
            `[Mentioned file: ${mention.path}]\n\`\`\`\n${content}\n\`\`\``,
          );
          pills.push({
            id: `mention-file:${mention.path}`,
            label: mention.path.split('/').pop() ?? mention.path,
            type: 'attachment',
            tokens,
            removable: true,
          });
        } catch {
          contextBlocks.push(`[Mentioned file: ${mention.path}]\n[Could not read file]`);
        }
        break;
      }

      case 'folder': {
        if (!mention.path || !services.listFolderFiles) { break; }
        try {
          const files = await services.listFolderFiles(mention.path);
          let charCount = 0;
          let includedCount = 0;
          const parts: string[] = [];
          parts.push(`[Mentioned folder: ${mention.path}] (${files.length} files)`);

          for (const f of files) {
            if (charCount + f.content.length > folderCharBudget) {
              parts.push(`\n... (${files.length - includedCount} more files omitted — token budget)`);
              break;
            }
            parts.push(`\n--- ${f.relativePath} ---\n\`\`\`\n${f.content}\n\`\`\``);
            charCount += f.content.length;
            includedCount++;
          }

          const block = parts.join('\n');
          contextBlocks.push(block);
          pills.push({
            id: `mention-folder:${mention.path}`,
            label: `${mention.path}/ (${includedCount} files)`,
            type: 'attachment',
            tokens: Math.ceil(charCount / 4),
            removable: true,
          });
        } catch {
          contextBlocks.push(`[Mentioned folder: ${mention.path}]\n[Could not read folder]`);
        }
        break;
      }

      case 'workspace': {
        if (!services.retrieveContext) { break; }
        try {
          // Use the clean text (without mentions) as the RAG query
          const result = await services.retrieveContext(cleanText);
          if (result) {
            contextBlocks.push(result.text);
            for (const src of result.sources) {
              pills.push({
                id: `mention-workspace:${src.uri}`,
                label: src.label,
                type: 'rag',
                tokens: 0, // filled later
                removable: true,
              });
            }
          }
        } catch {
          // RAG is best-effort
        }
        break;
      }

      case 'terminal': {
        if (!services.getTerminalOutput) { break; }
        try {
          const output = await services.getTerminalOutput();
          if (output) {
            const tokens = Math.ceil(output.length / 4);
            contextBlocks.push(`[Terminal output]\n\`\`\`\n${output}\n\`\`\``);
            pills.push({
              id: 'mention-terminal',
              label: 'Terminal output',
              type: 'attachment',
              tokens,
              removable: true,
            });
          }
        } catch {
          // Terminal is best-effort
        }
        break;
      }
    }
  }

  return { contextBlocks, pills, cleanText };
}
