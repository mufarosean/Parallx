// parallxIgnore.ts — .parallxignore file parser (M11 Task 1.9)
//
// Git-style ignore patterns for excluding files from:
//   - Indexing pipeline (RAG embedding)
//   - AI file access tools (read_file, list_files)
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
