// heartbeatPurpose.ts — M87 S2: the heartbeat's PURPOSE FILE.
//
// `.parallx/HEARTBEAT.md` is where use cases live. The old heartbeat asked
// the model to divine helpfulness from nothing; upstream OpenClaw heartbeats
// work because the user STATES what to watch. This module owns the file
// format: a `## Watch` section of free-text bullet lines, each a standing
// concern the model evaluates against collected facts whenever a heartbeat
// review runs (event-driven reviews, noteworthy intervals, and the daily
// reflection — so every watch is evaluated at least daily).
//
// Deliberately NOT a system-prompt bootstrap file (OPENCLAW_BOOTSTRAP_FILES):
// watches are heartbeat-lane context only — injecting them into every chat
// turn would be prompt bloat with zero benefit.
//
// Pure module: parsing/editing/formatting only. IO lives with the callers
// (/init scaffolding, the heartbeat_watch tool, the executor's loader).

export const HEARTBEAT_PURPOSE_PATH = '.parallx/HEARTBEAT.md';

export const HEARTBEAT_PURPOSE_TEMPLATE = `# HEARTBEAT.md — standing watches

The heartbeat reads this file on every review. Each bullet under **Watch**
is a standing concern: when a review runs, the agent checks each watch
against the current workspace facts and speaks up ONLY when one clearly
triggers. Add watches yourself, or tell the AI "watch this for me".

Built-in checks (stalled plans, review-queue triage, overdue follow-ups,
digests) run automatically and are configured in Settings — they do not
need entries here.

## Watch

- (example) Warn me if a page titled "Exam 7" hasn't been edited in over a week.
`;

/** A parsed watch line (without its leading "- "). */
export interface IHeartbeatPurpose {
  readonly watches: readonly string[];
}

/**
 * Parse the `## Watch` section: every top-level `- ` bullet until the next
 * heading. Example bullets (containing "(example)") are ignored so the
 * scaffold template ships inert.
 */
export function parseHeartbeatPurpose(content: string): IHeartbeatPurpose {
  const lines = content.split(/\r?\n/);
  const watches: string[] = [];
  let inWatch = false;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      inWatch = /^watch\b/i.test(heading[1].trim());
      continue;
    }
    if (!inWatch) continue;
    const bullet = line.match(/^-\s+(.+)$/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (!text || /^\(example\)/i.test(text)) continue;
    watches.push(text);
  }
  return { watches };
}

/**
 * Append a watch line to the `## Watch` section (creating the section when
 * missing). Idempotent: an identical existing watch is not duplicated.
 */
export function addWatch(content: string, watch: string): string {
  const clean = watch.trim().replace(/^-\s+/, '');
  if (!clean) return content;
  const existing = parseHeartbeatPurpose(content);
  if (existing.watches.some((w) => w.toLowerCase() === clean.toLowerCase())) return content;

  const lines = content.split(/\r?\n/);
  // Find the Watch heading; insert after the section's last bullet (or
  // directly after the heading when it has none).
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,6}\s+(.*)$/);
    if (h && /^watch\b/i.test(h[1].trim())) { headingIdx = i; break; }
  }
  if (headingIdx === -1) {
    const suffix = content.endsWith('\n') || content === '' ? '' : '\n';
    return `${content}${suffix}\n## Watch\n\n- ${clean}\n`;
  }
  let insertAt = headingIdx + 1;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) break;
    if (/^-\s+/.test(lines[i]) || lines[i].trim() === '') insertAt = i + 1;
    else insertAt = i + 1;
  }
  lines.splice(insertAt, 0, `- ${clean}`);
  return lines.join('\n');
}

/**
 * Remove every watch whose text contains `match` (case-insensitive).
 * Returns the new content and how many lines were removed.
 */
export function removeWatch(content: string, match: string): { content: string; removed: number } {
  const needle = match.trim().toLowerCase();
  if (!needle) return { content, removed: 0 };
  const lines = content.split(/\r?\n/);
  const out: string[] = [];
  let inWatch = false;
  let removed = 0;
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) inWatch = /^watch\b/i.test(heading[1].trim());
    const bullet = inWatch ? line.match(/^-\s+(.+)$/) : null;
    if (bullet && bullet[1].trim().toLowerCase().includes(needle) && !/^\(example\)/i.test(bullet[1].trim())) {
      removed++;
      continue;
    }
    out.push(line);
  }
  return { content: out.join('\n'), removed };
}

/**
 * Render the watches as a heartbeat-seed block. Empty watches → '' so the
 * seed stays clean on workspaces that never wrote a purpose file.
 */
export function formatWatchesBlock(watches: readonly string[]): string {
  if (watches.length === 0) return '';
  const lines = [
    `The user's STANDING WATCHES (from ${HEARTBEAT_PURPOSE_PATH}) — check each against the context in this review; if one clearly triggers, respond with NOTE or ACT about THAT watch, otherwise they add nothing:`,
  ];
  for (const w of watches) lines.push(`- ${w}`);
  return lines.join('\n');
}
