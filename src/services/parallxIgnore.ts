// parallxIgnore.ts — .parallxignore file parser (M11 Task 1.9)
//
// Git-style ignore patterns for excluding files from:
//   - Indexing pipeline (RAG embedding)
//   - AI file access tools (fs_read_file, fs_list_files)
//   - "Add Context" attachment picker
//
// Pattern syntax (subset of .gitignore):
//   - `#` comments
//   - `*` matches anything except /
//   - `**` matches any path segments
//   - `?` matches single char except /
//   - `!` negation (un-ignore)
//   - Trailing `/` matches directories only
//   - Leading `/` anchors to root
//   - Bare name matches at any depth
//
// VS Code reference:
//   `.copilotignore` — same concept, same syntax.
//
// Replaces the hardcoded SKIP_DIRS in indexingPipeline.ts.

// ── Default patterns ──

/**
 * Built-in ignore patterns applied even without a .parallxignore file.
 * These match the old hardcoded SKIP_DIRS set.
 */
const DEFAULT_PATTERNS = [
  '# Dependencies',
  'node_modules/',
  'vendor/',
  '.venv/',
  '__pycache__/',
  '',
  '# Build output',
  'dist/',
  'build/',
  'out/',
  'target/',
  '.next/',
  '.nuxt/',
  '',
  '# IDE / tool',
  '.git/',
  '.vscode/',
  '.idea/',
  '.cache/',
  '.turbo/',
  '',
  '# Coverage',
  'coverage/',
  '',
  '# Python runtime machinery (M94 — workspace-local venv).',
  '# The venv and its temp dir are app machinery, not user content: never',
  '# indexed, never watched, never visible to the AI file tools. Scripts and',
  '# their outputs live OUTSIDE this tree and stay fully visible.',
  '.parallx/venv/',
  '.parallx/tmp/',
  '.pytest_cache/',
  '.mypy_cache/',
  '.ruff_cache/',
  '.ipynb_checkpoints/',
  '*.egg-info/',
  '*.pyc',
  '*.pyo',
  '*.pyd',
  '',
  '# Secrets',
  '.env',
  '.env.*',
  '*.key',
  '*.pem',
  '*.p12',
  'secrets/',
  '',
  '# Parallx internal',
  '.parallx/permissions.json',
];

// ── Types ──

interface ParsedPattern {
  /** Original pattern line. */
  raw: string;
  /** Regex compiled from the pattern. */
  regex: RegExp;
  /** Whether this is a negation pattern (starts with !). */
  negated: boolean;
  /** Whether this matches only directories (ends with /). */
  directoryOnly: boolean;
}

// ── Pattern compiler ──

/**
 * Compile a single gitignore pattern to a regex.
 *
 * Rules:
 *   - Lines starting with # are comments
 *   - Empty lines are ignored
 *   - Leading/trailing whitespace is trimmed
 *   - `!` prefix negates (un-ignores)
 *   - Trailing `/` means directory-only match
 *   - Leading `/` anchors to root
 *   - `**` matches any path depth
 *   - `*` matches within a segment
 *   - `?` matches single char
 */
function compilePattern(line: string): ParsedPattern | null {
  let pattern = line.trim();

  // Skip empty lines and comments
  if (!pattern || pattern.startsWith('#')) {
    return null;
  }

  const negated = pattern.startsWith('!');
  if (negated) {
    pattern = pattern.slice(1);
  }

  const directoryOnly = pattern.endsWith('/');
  if (directoryOnly) {
    pattern = pattern.slice(0, -1);
  }

  // Determine if pattern is anchored (contains / anywhere except trailing)
  const anchored = pattern.includes('/');

  // Build regex
  let regexStr = '';

  if (anchored) {
    // Anchored: match from root
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }
    regexStr = '^';
  } else {
    // Unanchored: match at any depth
    regexStr = '(?:^|/)';
  }

  // Convert glob to regex
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        if (pattern[i + 2] === '/') {
          // **/ matches any directory depth
          regexStr += '(?:.+/)?';
          i += 3;
        } else if (i + 2 >= pattern.length) {
          // ** at end matches everything
          regexStr += '.*';
          i += 2;
        } else {
          regexStr += '.*';
          i += 2;
        }
      } else {
        // * matches within segment
        regexStr += '[^/]*';
        i++;
      }
    } else if (ch === '?') {
      regexStr += '[^/]';
      i++;
    } else if (ch === '.') {
      regexStr += '\\.';
      i++;
    } else if (ch === '[') {
      // Character class — pass through
      const closeIdx = pattern.indexOf(']', i + 1);
      if (closeIdx !== -1) {
        regexStr += pattern.slice(i, closeIdx + 1);
        i = closeIdx + 1;
      } else {
        regexStr += '\\[';
        i++;
      }
    } else {
      regexStr += ch;
      i++;
    }
  }

  regexStr += '(?:/|$)';

  try {
    return {
      raw: line.trim(),
      regex: new RegExp(regexStr),
      negated,
      directoryOnly,
    };
  } catch {
    // Invalid regex — skip this pattern
    return null;
  }
}

// ── ParallxIgnore ──

/**
 * ParallxIgnore — parses and evaluates .parallxignore patterns.
 *
 * Usage:
 *   const ignore = new ParallxIgnore();
 *   ignore.loadDefaults();
 *   ignore.loadFromContent(fileContent); // from .parallxignore
 *   ignore.isIgnored('node_modules/foo.js', true) // → true
 *   ignore.isIgnored('src/main.ts', false) // → false
 */
export class ParallxIgnore {
  private _patterns: ParsedPattern[] = [];

  /** Load the built-in default patterns. */
  loadDefaults(): void {
    for (const line of DEFAULT_PATTERNS) {
      const p = compilePattern(line);
      if (p) this._patterns.push(p);
    }
  }

  /**
   * Load patterns from a .parallxignore file's content.
   * Patterns are APPENDED to existing patterns (defaults + file).
   */
  loadFromContent(content: string): void {
    for (const line of content.split('\n')) {
      const p = compilePattern(line);
      if (p) this._patterns.push(p);
    }
  }

  /** Clear all patterns. */
  clear(): void {
    this._patterns = [];
  }

  /**
   * Check if a path should be ignored.
   *
   * @param relativePath Path relative to workspace root (forward slashes).
   * @param isDirectory Whether the path is a directory.
   * @returns true if the path should be ignored.
   */
  isIgnored(relativePath: string, isDirectory: boolean): boolean {
    // Normalize path
    const normPath = relativePath.replace(/\\/g, '/').replace(/^\//, '');

    let ignored = false;

    for (const pattern of this._patterns) {
      // Directory-only patterns skip files
      if (pattern.directoryOnly && !isDirectory) {
        continue;
      }

      // Test the path (with trailing / for directories)
      const testPath = isDirectory ? normPath + '/' : normPath;
      if (pattern.regex.test(testPath)) {
        ignored = !pattern.negated;
      }
    }

    return ignored;
  }

  /**
   * Ancestor-aware ignore check.
   *
   * `isIgnored` answers "does this exact path match a pattern", which is the
   * right question for a tree WALK — the walk never descends into an ignored
   * directory, so it never asks about the files underneath. Event-driven
   * callers get no such luxury: the watcher hands them
   * `node_modules/foo/bar.js` with no memory of having skipped
   * `node_modules/`, and a directory-only pattern (`node_modules/`) is
   * skipped outright for files. So the exact-match check returns false and
   * the file sails through.
   *
   * This walks every ancestor segment as a directory, then tests the path
   * itself. Use it anywhere paths arrive out of the blue rather than from a
   * top-down traversal.
   */
  isPathIgnored(relativePath: string, isDirectory: boolean): boolean {
    const normPath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normPath) return false;

    const segments = normPath.split('/').filter(Boolean);
    // Every ancestor directory, shallowest first. An ignored ancestor ignores
    // everything beneath it.
    for (let i = 1; i < segments.length; i++) {
      if (this.isIgnored(segments.slice(0, i).join('/'), true)) {
        return true;
      }
    }
    return this.isIgnored(normPath, isDirectory);
  }

  /**
   * Check if a directory name should be skipped during tree walking.
   * This is a fast-path for the common case of checking just a directory name
   * (e.g., "node_modules") without needing the full relative path.
   */
  isDirectoryIgnored(dirName: string): boolean {
    return this.isIgnored(dirName, true);
  }

  /**
   * Get all pattern strings (for display/debugging).
   */
  getPatterns(): readonly string[] {
    return this._patterns.map((p) => p.raw);
  }
}

/**
 * Path segments whose subtrees must never produce a file-watch event.
 *
 * This is a COARSE pre-filter applied in the main process, before events
 * cross IPC — not a replacement for `.parallxignore`, which stays the real
 * policy and is evaluated in the renderer. Its whole job is volume: a
 * `pip install` into the workspace venv, or an `npm install`, writes tens of
 * thousands of files, and the recursive `fs.watch` in the main process has
 * no filter at all today — every one of those becomes a debounced IPC message
 * and an indexer wake-up.
 *
 * Kept deliberately tiny and name-based (not pattern-based) so the main
 * process needs no glob engine. THE single source: passed down through
 * `IFileService.watch(uri, { ignoreSegments })`, never re-declared in
 * main.cjs.
 */
export const WATCH_IGNORE_SEGMENTS: readonly string[] = [
  'node_modules',
  '.git',
  'venv',
  '.venv',
  '__pycache__',
  'site-packages',
  'dist',
  'build',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
];

/**
 * Create a ParallxIgnore instance loaded with defaults.
 * Optionally load from a .parallxignore file content.
 */
export function createParallxIgnore(fileContent?: string): ParallxIgnore {
  const ignore = new ParallxIgnore();
  ignore.loadDefaults();
  if (fileContent) {
    ignore.loadFromContent(fileContent);
  }
  return ignore;
}
