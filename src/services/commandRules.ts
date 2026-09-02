// commandRules.ts — shell-command permission rules, pure.
//
// Why: terminal_run_command sits on the destruction belt (it always asks),
// and the belt also defeated the tool-level "Always allow" grant, so in
// Agent mode every single command prompted. The frontier shape (Claude
// Code's Bash permission rules) is finer than a tool-level switch:
//
//   * a COMMAND FAMILY the user allowed once ("always allow `npm`
//     commands") runs without a prompt — persisted per workspace;
//   * a READ-ONLY command (`git status`, `ls`, `cat`) never prompts;
//   * a compound command is allowed only when EVERY segment is, and
//     redirections / substitutions disqualify it outright;
//   * the hard blocklist and Careful Mode sit above all of this, and
//     autonomous turns still defer to the log.

const SEGMENT_SPLIT = /\s*(?:&&|\|\||;|\|)\s*/;

/** Shell syntax that can turn a harmless-looking command into a write. */
const DANGER = /[<>`]|\$\(|--output|\n/;

/** Single-word commands that only read. */
const READ_ONLY_WORDS: ReadonlySet<string> = new Set([
  'ls', 'dir', 'pwd', 'cat', 'type', 'head', 'tail', 'wc', 'echo', 'which',
  'where', 'tree', 'whoami', 'date', 'grep', 'rg', 'stat', 'file',
]);

/** Two-word commands (program + subcommand / flag) that only read. */
const READ_ONLY_PAIRS: ReadonlySet<string> = new Set([
  'git status', 'git log', 'git diff', 'git show', 'git branch', 'git remote',
  'node -v', 'node --version', 'npm -v', 'npm --version', 'npm ls', 'npm list',
  'python --version', 'python -v', 'pip list', 'pip show', 'npx --version',
]);

function normalize(segment: string): string[] {
  return segment.trim().toLowerCase().replace(/^\.[\\/]/, '').split(/\s+/).filter(Boolean);
}

/** The command's segments (split on &&, ||, ;, |), each as tokens. */
export function commandSegments(command: string): string[][] {
  return String(command ?? '').split(SEGMENT_SPLIT).map(normalize).filter((t) => t.length > 0);
}

/** The command family: the first token of the first segment (`npm`, `git`). */
export function commandPrefix(command: string): string {
  return commandSegments(command)[0]?.[0] ?? '';
}

export function hasShellDanger(command: string): boolean {
  return DANGER.test(String(command ?? ''));
}

/** True when every segment is a known read-only command and nothing redirects. */
export function isReadOnlyCommand(command: string): boolean {
  if (hasShellDanger(command)) return false;
  const segments = commandSegments(command);
  if (segments.length === 0) return false;
  return segments.every((tokens) =>
    READ_ONLY_WORDS.has(tokens[0]) || (tokens.length >= 2 && READ_ONLY_PAIRS.has(`${tokens[0]} ${tokens[1]}`)));
}

/** True when every segment's family is in `rules` and nothing redirects. */
export function commandMatchesRules(command: string, rules: ReadonlySet<string>): boolean {
  if (rules.size === 0 || hasShellDanger(command)) return false;
  const segments = commandSegments(command);
  if (segments.length === 0) return false;
  return segments.every((tokens) => rules.has(tokens[0]));
}
