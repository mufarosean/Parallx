// m70CommandPolicy.ts — M70 App Command Control policy
//
// Gate 2 of M70: a hardcoded denylist of command IDs that may NOT be
// AI-invoked regardless of `aiInvocable` on their descriptor. This is the
// belt-and-braces enforcement point — even if a future contributor sets
// `aiInvocable: true` on an excluded ID, this list blocks it at runtime
// inside the `app__run_command` tool.
//
// The list is derived from docs/M70_DEDUP_AUDIT.md (signed off). Keep that
// doc and this file in sync when adding new commands.

import type { CommandDescriptor, ICommandRegistry } from './commandTypes.js';

/**
 * Permanently excluded command IDs. AI invocation is refused regardless
 * of `aiInvocable`. Categories:
 *   - AI settings / model selection (don't let the AI rewrite its policy)
 *   - Workspace lifecycle (open/close/switch/rename/save/duplicate)
 *   - Config import / reset (wipes preferences)
 *   - Install or destructive content operations (irreversible)
 *   - Secret-touching surfaces
 */
export const M70_EXCLUDED_COMMANDS: ReadonlySet<string> = new Set([
  // AI settings & model selection
  'ai-settings.open',
  'ai-settings.scrollToSection',
  'aiSettings.manageTools',
  'aiSettings.manageMcp',
  'aiSettings.manageAgents',
  'aiSettings.manageCron',
  'chat.selectModel',
  'chat.switchMode',
  // Installs
  'parallx.installDocling',
  // Workspace lifecycle
  'workspace.resetConfig',
  'workspace.importConfig',
  'workspace.closeFolder',
  'workspace.removeFolderFromWorkspace',
  'workspace.closeWindow',
  'workspace.duplicateWorkspace',
  'workspace.openFolder',
  'workspace.openRecent',
  'workspace.switch',
  'workspace.save',
  'workspace.saveAs',
  'workspace.rename',
  'workspace.addFolderToWorkspace',
  'workspace.exportToFile',
  'workspace.importFromFile',
  // File destructive
  'file.revert',
  'file.saveAll',
  // Destructive content
  'explorer.delete',
  'canvas.deletePage',
  'budget.importCsv',
  'media-organizer.emptyTrash',
  'media-organizer.moveToTrash',
  // Memory editor surfaces (the AI navigates its own memory tooling)
  'memory.openDurable',
  'memory.openTodayLog',
]);

/**
 * True iff `commandId` is on the hardcoded denylist. Use at the
 * `app__run_command` boundary BEFORE checking `aiInvocable`.
 */
export function isCommandExcludedForAI(commandId: string): boolean {
  return M70_EXCLUDED_COMMANDS.has(commandId);
}

/**
 * True iff the AI may invoke `descriptor` via `app__run_command`. The
 * policy is the conjunction of "opted in" and "not on the denylist".
 */
export function isCommandAIInvocable(
  descriptor: Readonly<CommandDescriptor> | undefined,
): boolean {
  if (!descriptor) return false;
  if (isCommandExcludedForAI(descriptor.id)) return false;
  return descriptor.aiInvocable === true;
}

/**
 * Lightweight DTO returned by `app__find_commands`. We deliberately omit
 * the handler and any UI-only fields — only data the AI can act on.
 */
export interface AICommandSummary {
  readonly id: string;
  readonly title: string;
  readonly aiDescription: string;
  readonly category?: string;
}

function _summarize(d: Readonly<CommandDescriptor>): AICommandSummary {
  return {
    id: d.id,
    title: d.title,
    aiDescription: d.aiDescription ?? d.title,
    category: d.category,
  };
}

/**
 * All currently registered commands that satisfy `isCommandAIInvocable`.
 * The result is computed at call time so newly registered commands (e.g.
 * from extensions activating after the registry boot) are visible.
 */
export function listAIInvocableCommands(
  registry: Pick<ICommandRegistry, 'getCommands'>,
): AICommandSummary[] {
  const out: AICommandSummary[] = [];
  for (const d of registry.getCommands().values()) {
    if (isCommandAIInvocable(d)) out.push(_summarize(d));
  }
  return out;
}

// ─── Search ────────────────────────────────────────────────────────────────

/**
 * Tokenize a query string into lowercase non-empty terms. Hyphens,
 * underscores, and dot separators count as boundaries so a query like
 * "workspace graph" finds `workspaceGraph.open`.
 */
function _tokenize(q: string): string[] {
  return q
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Score a command summary against a tokenized query. Higher = better.
 * Cheap text scoring — no fancy ranking. Each query token contributes:
 *   • +3 if it appears in the id
 *   • +2 if it appears in the title (case-insensitive substring)
 *   • +1 if it appears in the aiDescription
 * Returns 0 if no token matches anywhere — the command is not surfaced.
 */
function _score(summary: AICommandSummary, tokens: readonly string[]): number {
  if (tokens.length === 0) return 0;
  const id = summary.id.toLowerCase();
  const title = summary.title.toLowerCase();
  const desc = summary.aiDescription.toLowerCase();
  let total = 0;
  for (const t of tokens) {
    let matched = false;
    if (id.includes(t)) { total += 3; matched = true; }
    if (title.includes(t)) { total += 2; matched = true; }
    if (desc.includes(t)) { total += 1; matched = true; }
    if (!matched) return 0; // every token must hit something
  }
  return total;
}

/**
 * Search opt-in commands by free-text query. Returns up to `limit`
 * results (default 5), sorted by score desc then by id for stability.
 */
export function findAIInvocableCommands(
  registry: Pick<ICommandRegistry, 'getCommands'>,
  query: string,
  limit = 5,
): AICommandSummary[] {
  const tokens = _tokenize(query);
  if (tokens.length === 0) {
    // No query → return the first `limit` opt-in commands so a "show me
    // what you can do" call still returns something useful.
    return listAIInvocableCommands(registry).slice(0, limit);
  }
  const scored: { score: number; summary: AICommandSummary }[] = [];
  for (const d of registry.getCommands().values()) {
    if (!isCommandAIInvocable(d)) continue;
    const summary = _summarize(d);
    const score = _score(summary, tokens);
    if (score > 0) scored.push({ score, summary });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.summary.id.localeCompare(b.summary.id);
  });
  return scored.slice(0, limit).map(s => s.summary);
}
