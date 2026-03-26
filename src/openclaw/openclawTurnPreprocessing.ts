/**
 * OpenClaw turn preprocessing — M2 + M3 + M4 gap closure.
 *
 * M2: Mention resolution — extract @file/@folder/@workspace/@terminal mentions,
 *     resolve content, strip mentions from query text.
 * M3: Skill activation — detect skill slash commands, load manifest,
 *     perform $ARGUMENTS substitution.
 * M4: Semantic fallback — detect broad workspace summary prompts.
 *
 * These run before context assembly to influence what context gets included.
 */

import type { IContextPill } from '../services/chatTypes.js';
import type { IDefaultParticipantServices } from './openclawTypes.js';
import { isBroadWorkspaceSummaryPrompt } from './openclawResponseValidation.js';

// ---------------------------------------------------------------------------
// M2: Mention extraction + resolution
// ---------------------------------------------------------------------------

export interface IMention {
  readonly kind: 'file' | 'folder' | 'workspace' | 'terminal';
  readonly path?: string;
  readonly original: string;
  readonly start: number;
  readonly end: number;
}

export interface IMentionResolutionResult {
  /** User text with @-mentions stripped out. */
  readonly strippedText: string;
  /** Context blocks to inject into the assembled messages. */
  readonly contextBlocks: readonly string[];
  /** UI pills for the chat widget. */
  readonly pills: readonly IContextPill[];
}

const MENTION_RE = /@(file|folder):(?:"([^"]+)"|(\S+))|@(workspace|terminal)\b/g;

export function extractMentions(text: string): IMention[] {
  const mentions: IMention[] = [];
  MENTION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION_RE.exec(text)) !== null) {
    if (match[4]) {
      mentions.push({
        kind: match[4] as 'workspace' | 'terminal',
        original: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    } else {
      mentions.push({
        kind: match[1] as 'file' | 'folder',
        path: match[2] ?? match[3],
        original: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }
  return mentions;
}

export function stripMentions(text: string, mentions: readonly IMention[]): string {
  if (mentions.length === 0) return text;
  let result = text;
  for (const m of [...mentions].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, m.start) + result.slice(m.end);
  }
  return result.replace(/\s{2,}/g, ' ').trim();
}

const FOLDER_CHAR_BUDGET = 100_000;

export async function resolveMentions(
  text: string,
  services: IDefaultParticipantServices,
): Promise<IMentionResolutionResult> {
  const mentions = extractMentions(text);
  if (mentions.length === 0) {
    return { strippedText: text, contextBlocks: [], pills: [] };
  }

  const blocks: string[] = [];
  const pills: IContextPill[] = [];

  for (const mention of mentions) {
    switch (mention.kind) {
      case 'file': {
        if (!mention.path || !services.readFileRelative) break;
        const content = await services.readFileRelative(mention.path).catch(() => null);
        if (content) {
          blocks.push(`[Mentioned file: ${mention.path}]\n\`\`\`\n${content}\n\`\`\``);
          pills.push({
            id: `mention-file:${mention.path}`,
            label: mention.path.split('/').pop() ?? mention.path,
            type: 'attachment',
            tokens: Math.ceil(content.length / 4),
            removable: true,
          });
        }
        break;
      }
      case 'folder': {
        if (!mention.path || !services.listFolderFiles) break;
        const files = await services.listFolderFiles(mention.path).catch(() => []);
        let charCount = 0;
        const parts: string[] = [`[Mentioned folder: ${mention.path}] (${files.length} files)`];
        let included = 0;
        for (const file of files) {
          if (charCount + file.content.length > FOLDER_CHAR_BUDGET) {
            parts.push(`\n... (${files.length - included} more files omitted)`);
            break;
          }
          parts.push(`\n--- ${file.relativePath} ---\n\`\`\`\n${file.content}\n\`\`\``);
          charCount += file.content.length;
          included++;
        }
        blocks.push(parts.join('\n'));
        pills.push({
          id: `mention-folder:${mention.path}`,
          label: `${mention.path}/ (${included} files)`,
          type: 'attachment',
          tokens: Math.ceil(charCount / 4),
          removable: true,
        });
        break;
      }
      case 'workspace': {
        // @workspace mention is a phrasing hint that doesn't inject new context
        // (RAG already searches the workspace). Report a pill for UI visibility.
        pills.push({
          id: 'mention-workspace',
          label: services.getWorkspaceName(),
          type: 'attachment',
          tokens: 0,
          removable: false,
        });
        break;
      }
      case 'terminal': {
        if (!services.getTerminalOutput) break;
        const output = await services.getTerminalOutput().catch(() => undefined);
        if (output) {
          blocks.push(`[Terminal output]\n\`\`\`\n${output}\n\`\`\``);
          pills.push({
            id: 'mention-terminal',
            label: 'Terminal',
            type: 'attachment',
            tokens: Math.ceil(output.length / 4),
            removable: true,
          });
        }
        break;
      }
    }
  }

  return {
    strippedText: stripMentions(text, mentions),
    contextBlocks: blocks,
    pills,
  };
}

// ---------------------------------------------------------------------------
// M3: Skill activation
// ---------------------------------------------------------------------------

export interface IActivatedSkill {
  readonly name: string;
  readonly resolvedBody: string;
}

/**
 * When a slash command's `specialHandler` is `'skill'`, load the skill manifest
 * and perform `$ARGUMENTS` substitution.
 */
export function activateSkill(
  commandName: string,
  userText: string,
  services: IDefaultParticipantServices,
): IActivatedSkill | undefined {
  if (!services.getSkillManifest) return undefined;

  const manifest = services.getSkillManifest(commandName) as { body?: string } | undefined;
  if (!manifest?.body) return undefined;

  const resolvedBody = manifest.body.replace(/\$ARGUMENTS/g, userText);
  return { name: commandName, resolvedBody };
}

// ---------------------------------------------------------------------------
// M4: Semantic fallback
// ---------------------------------------------------------------------------

export { isBroadWorkspaceSummaryPrompt } from './openclawResponseValidation.js';

export interface ISemanticFallbackResult {
  readonly kind: 'broad-workspace-summary';
  readonly coverageMode: 'exhaustive';
  readonly promptOverlay: string;
}

/**
 * Detect when the user's prompt implies exhaustive workspace coverage
 * (e.g., "summarize everything in here").
 */
export function detectSemanticFallback(text: string): ISemanticFallbackResult | undefined {
  if (isBroadWorkspaceSummaryPrompt(text)) {
    return {
      kind: 'broad-workspace-summary',
      coverageMode: 'exhaustive',
      promptOverlay: 'The user is asking for a comprehensive workspace summary. Cover every file and major section systematically. Do not skip any document.',
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// M43: Variable resolution — #activeFile, #file:path
// ---------------------------------------------------------------------------

export interface IVariableResolutionResult {
  /** User text with #variable references stripped out. */
  readonly strippedText: string;
  /** Context blocks to inject into the assembled messages. */
  readonly contextBlocks: readonly string[];
  /** UI pills for the chat widget. */
  readonly pills: readonly IContextPill[];
}

/**
 * Matches #file:"path with spaces" or #file:path (no spaces).
 * Also matches standalone #activeFile.
 */
const VARIABLE_FILE_RE = /#file:(?:"([^"]+)"|(\S+))/g;
const VARIABLE_ACTIVEFILE_RE = /#activeFile\b/g;

/**
 * Resolve #-prefixed variable references in user text.
 *
 * Supported variables:
 * - `#activeFile` — resolves to the currently-focused canvas document content
 * - `#file:"path"` or `#file:path` — resolves to file content by relative path
 *
 * Follows the same pattern as `resolveMentions()` — returns context blocks,
 * pills, and stripped text.
 */
export async function resolveVariables(
  text: string,
  services: IDefaultParticipantServices,
): Promise<IVariableResolutionResult> {
  const blocks: string[] = [];
  const pills: IContextPill[] = [];
  const replacements: { start: number; end: number }[] = [];

  // ── #file:path variables ──
  VARIABLE_FILE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = VARIABLE_FILE_RE.exec(text)) !== null) {
    const filePath = match[1] ?? match[2];
    if (!filePath || !services.readFileRelative) continue;

    const content = await services.readFileRelative(filePath).catch(() => null);
    if (content) {
      blocks.push(`[Variable #file: ${filePath}]\n\`\`\`\n${content}\n\`\`\``);
      pills.push({
        id: `var-file:${filePath}`,
        label: filePath.split('/').pop() ?? filePath,
        type: 'attachment',
        tokens: Math.ceil(content.length / 4),
        removable: true,
      });
    }
    replacements.push({ start: match.index, end: match.index + match[0].length });
  }

  // ── #activeFile variable ──
  VARIABLE_ACTIVEFILE_RE.lastIndex = 0;
  while ((match = VARIABLE_ACTIVEFILE_RE.exec(text)) !== null) {
    if (!services.getCurrentPageContent) continue;

    const pageResult = await services.getCurrentPageContent().catch(() => undefined);
    if (pageResult?.textContent) {
      blocks.push(`[Active document: "${pageResult.title}" (id: ${pageResult.pageId})]\n${pageResult.textContent}`);
      pills.push({
        id: 'var-activeFile',
        label: pageResult.title || 'Active Page',
        type: 'attachment',
        tokens: Math.ceil(pageResult.textContent.length / 4),
        removable: true,
      });
    }
    replacements.push({ start: match.index, end: match.index + match[0].length });
    break; // only resolve once even if mentioned multiple times
  }

  if (replacements.length === 0) {
    return { strippedText: text, contextBlocks: [], pills: [] };
  }

  // Strip variable references from text (reverse order to preserve indices)
  let stripped = text;
  for (const r of replacements.sort((a, b) => b.start - a.start)) {
    stripped = stripped.slice(0, r.start) + stripped.slice(r.end);
  }
  stripped = stripped.replace(/\s{2,}/g, ' ').trim();

  return { strippedText: stripped, contextBlocks: blocks, pills };
}
