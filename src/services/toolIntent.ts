// toolIntent.ts — HARNESS.md §2.1, the model's stated intent for a
// consequential call, as ONE contract.
//
// Five tools accept a `description` argument that means "what this action
// does and why"; the approval card, the transcript node, the activity
// journal, and the checkpoint store all show it as the INTENT line. That
// is a per-tool declaration, not a rule about argument names: memory_write
// also has a `description` parameter, and there it is DATA (the lesson's
// one-line index summary). Review fix 2026-09-02: four sites string-matched
// the argument name and mislabeled that data as intent, hiding it from the
// argument summary the user was approving.

export const INTENT_PARAM_NAME = 'description';

/** The schema property the intent-bearing tools share. */
export const INTENT_PARAM_SCHEMA = {
  type: 'string',
  description: 'One short sentence, active voice, saying what this action does and why. Shown to the user in the approval prompt and activity journal.',
} as const;

/** The tools whose `description` argument IS the intent line. */
const INTENT_TOOLS: ReadonlySet<string> = new Set([
  'fs_write_file',
  'fs_edit_file',
  'fs_delete_file',
  'terminal_run_command',
  'python_run_script',
]);

export function toolDeclaresIntent(toolName: string | undefined): boolean {
  return toolName !== undefined && INTENT_TOOLS.has(toolName);
}

/** The trimmed intent, or undefined when absent or not an intent tool. */
export function readToolIntent(toolName: string | undefined, args: Record<string, unknown> | undefined): string | undefined {
  if (!toolDeclaresIntent(toolName)) return undefined;
  const raw = args?.[INTENT_PARAM_NAME];
  const text = typeof raw === 'string' ? raw.trim() : '';
  return text ? text : undefined;
}

/** The arguments to SHOW once the intent line has claimed its own field. */
export function argsWithoutIntent(toolName: string | undefined, args: Record<string, unknown> | undefined): [string, unknown][] {
  const entries = Object.entries(args ?? {});
  return toolDeclaresIntent(toolName) ? entries.filter(([k]) => k !== INTENT_PARAM_NAME) : entries;
}
