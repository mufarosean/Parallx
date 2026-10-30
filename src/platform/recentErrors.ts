// recentErrors.ts — the last few errors and warnings, kept for a bug report.
//
// Help › Copy Diagnostics prints them. The log is small and in memory only:
// nothing is written to disk or sent anywhere. Installed first thing in the
// renderer (src/main.ts) so failures during start are caught too.
//
// What is kept is a short line per event: a console.error / console.warn
// call, an uncaught error, an unhandled promise rejection. Objects passed to
// console are never serialised (they may hold page or chat text); only
// strings, numbers and an Error's name and message are. Paths and keys are
// scrubbed when the report is made (scrubSensitive).

/** Longest message kept per entry, before scrubbing. */
const RAW_LIMIT = 2000;

/** Longest message printed per entry, after scrubbing. */
export const REPORT_MESSAGE_LIMIT = 300;

export type RecentErrorLevel = 'error' | 'warn' | 'uncaught' | 'rejection';

export interface RecentErrorEntry {
  readonly level: RecentErrorLevel;
  readonly message: string;
  /** Milliseconds after the log started. */
  readonly atMs: number;
  /** How many times in a row the same message arrived. */
  readonly count: number;
}

/**
 * A bounded log: when full, the oldest warning goes first (an error is worth
 * more to a report than a warning), then the oldest entry. The same message
 * twice in a row counts up instead of taking a second slot.
 */
export class RecentErrorLog {
  private readonly _entries: { level: RecentErrorLevel; message: string; atMs: number; count: number }[] = [];
  private readonly _start: number;

  constructor(
    readonly capacity = 20,
    private readonly _now: () => number = () => Date.now(),
  ) {
    this._start = _now();
  }

  record(level: RecentErrorLevel, message: string): void {
    const text = message.length > RAW_LIMIT ? message.slice(0, RAW_LIMIT) : message;
    const atMs = Math.max(0, this._now() - this._start);
    const last = this._entries[this._entries.length - 1];
    if (last && last.level === level && last.message === text) {
      last.count++;
      last.atMs = atMs;
      return;
    }
    if (this._entries.length >= this.capacity) {
      const warning = level === 'warn' ? -1 : this._entries.findIndex((e) => e.level === 'warn');
      this._entries.splice(Math.max(0, warning), 1);
    }
    this._entries.push({ level, message: text, atMs, count: 1 });
  }

  entries(): readonly RecentErrorEntry[] {
    return this._entries.map((e) => ({ ...e }));
  }

  clear(): void {
    this._entries.length = 0;
  }
}

/** One console argument as text, without serialising objects. */
export function describeArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return arg.message ? `${arg.name}: ${arg.message}` : arg.name;
  if (arg === null || arg === undefined || typeof arg === 'number' || typeof arg === 'boolean' || typeof arg === 'bigint') return String(arg);
  if (Array.isArray(arg)) return '[…]';
  return '{…}';
}

/** The console arguments as one line (format specifiers such as %d left as they are). */
export function describeArgs(args: readonly unknown[]): string {
  return args.map(describeArg).join(' ').replace(/\s+/g, ' ').trim();
}

// ─── Scrubbing ───────────────────────────────────────────────────────────────

const HOME_PARENT = /^(?:users|home|documents and settings)$/i;

/**
 * A path as `<path>/basename` (any :line:col kept). A home folder itself
 * (`/home/me`, `C:\Users\me`) is `<home>`, so the user name never shows.
 */
function shortPath(p: string): string {
  const segments = p.replace(/^file:\/+/i, '').split(/[\\/]+/).filter(Boolean);
  const base = segments[segments.length - 1];
  if (!base) return '<path>';
  if (segments.length >= 2 && HOME_PARENT.test(segments[segments.length - 2])) return '<home>';
  return `<path>/${base}`;
}

/** One path segment: no separator, quote, bracket or whitespace. */
const SEG = String.raw`[^\s\\/'"\x60()<>\[\]{},;|*?]`;
/** Folders end with a separator, so a space inside one is taken only when more path follows. */
const DIRS = String.raw`(?:${SEG}+(?: ${SEG}+)*[\\/]+)`;
/** What may come just before a path that starts with / or ~. */
const LEAD = String.raw`(^|[\s'"\x60(\[{=,;])`;

const SECRET_PATTERNS: readonly [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer <hidden>'],
  // key=value and key: value forms for anything named like a secret
  [/\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|authorization)["']?\s*[=:]\s*["']?)(?!<hidden>|Bearer <hidden>)[^\s"'&,;)]+/gi, '$1<hidden>'],
  // Well-known key shapes, wherever they appear
  [/\bsk-[A-Za-z0-9_-]{12,}/g, '<key>'],
  [/\bAIza[0-9A-Za-z_-]{20,}/g, '<key>'],
  [/\b(?:ghp|gho|github_pat|xox[abprs])_[A-Za-z0-9_-]{10,}/g, '<key>'],
];

/** Patterns whose whole match is a path. */
const WHOLE_PATH_PATTERNS: readonly RegExp[] = [
  // file:// URLs (stack frames in the renderer)
  new RegExp(String.raw`file:\/\/\/?(?:[A-Za-z]:[\\/]+)?${DIRS}*${SEG}*`, 'gi'),
  // Windows UNC paths: \\server\share\...
  new RegExp(String.raw`(?<![\\\w])\\\\${DIRS}+${SEG}*`, 'g'),
  // Windows drive paths: C:\... or C:/...
  new RegExp(String.raw`(?<![\w/])[A-Za-z]:[\\/]+${DIRS}*${SEG}*`, 'g'),
];

/** Patterns with a lead-in group, then the path. */
const LED_PATH_PATTERNS: readonly RegExp[] = [
  // Home-relative: ~/...
  new RegExp(String.raw`${LEAD}(~[\\/]+${DIRS}*${SEG}*)`, 'g'),
  // POSIX absolute paths with at least two segments: /home/me/x
  new RegExp(String.raw`${LEAD}(\/${DIRS}+${SEG}*)`, 'g'),
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove what a bug report must not carry: absolute and home paths become
 * `<path>/basename`, things shaped like keys and tokens become `<hidden>` or
 * `<key>`. `knownPaths` (the workspace folders, the app's own folders) are
 * replaced wherever they appear, with whatever path follows them, before the
 * generic patterns run.
 */
export function scrubSensitive(text: string, knownPaths: readonly string[] = []): string {
  let out = text;
  const known = [...knownPaths].filter((p) => p && p.length > 2).sort((a, b) => b.length - a.length);
  for (const p of known) {
    for (const variant of new Set([p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')])) {
      const re = new RegExp(escapeRegExp(variant.replace(/[\\/]+$/, '')) + String.raw`([\\/]+${DIRS}*${SEG}*)?(?![\w.-])`, 'g');
      out = out.replace(re, (_m, tail: string | undefined) => (tail ? shortPath(tail) : '<path>'));
    }
  }
  for (const [re, replacement] of SECRET_PATTERNS) out = out.replace(re, replacement);
  for (const re of WHOLE_PATH_PATTERNS) out = out.replace(re, (m: string) => shortPath(m));
  for (const re of LED_PATH_PATTERNS) out = out.replace(re, (_m, lead: string, path: string) => lead + shortPath(path));
  return out;
}

/** Scrub, then shorten to the report's limit. */
export function scrubForReport(text: string, knownPaths: readonly string[] = [], limit = REPORT_MESSAGE_LIMIT): string {
  const clean = scrubSensitive(text, knownPaths);
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

// ─── Capture ─────────────────────────────────────────────────────────────────

let _log: RecentErrorLog | undefined;

/** The app's log (empty until installRecentErrorCapture runs). */
export function getRecentErrorLog(): RecentErrorLog {
  return (_log ??= new RecentErrorLog());
}

/** What capture needs from the window: its console and two events. */
export interface RecentErrorCaptureTarget {
  console: Pick<Console, 'error' | 'warn'>;
  addEventListener(type: 'error', listener: (e: ErrorEvent) => void): void;
  addEventListener(type: 'unhandledrejection', listener: (e: PromiseRejectionEvent) => void): void;
}

/**
 * Start recording console.error, console.warn, uncaught errors and unhandled
 * rejections into `log`. Console output itself is unchanged. Installing twice
 * on the same target does nothing the second time.
 */
export function installRecentErrorCapture(
  target: RecentErrorCaptureTarget = globalThis as unknown as RecentErrorCaptureTarget,
  log: RecentErrorLog = getRecentErrorLog(),
): void {
  const marked = target as RecentErrorCaptureTarget & { __pxRecentErrors?: true };
  if (marked.__pxRecentErrors) return;
  marked.__pxRecentErrors = true;

  const wrap = (level: 'error' | 'warn'): void => {
    const original = target.console[level].bind(target.console);
    target.console[level] = (...args: unknown[]) => {
      try { log.record(level, describeArgs(args)); } catch { /* the log never breaks logging */ }
      original(...args);
    };
  };
  wrap('error');
  wrap('warn');

  target.addEventListener('error', (e: ErrorEvent) => {
    const err = e.error instanceof Error ? describeArg(e.error) : (e.message || 'Unknown error');
    const where = e.filename ? ` (${e.filename}:${e.lineno ?? 0})` : '';
    log.record('uncaught', `${err}${where}`);
  });
  target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    log.record('rejection', describeArg(e.reason));
  });
}
