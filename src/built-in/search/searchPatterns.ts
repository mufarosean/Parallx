// searchPatterns.ts — the query and the glob fields as things that match.
//
// Find in Files takes a query (plain text, a whole word, or a regular
// expression) and two comma-separated glob lists (include, exclude). These
// turn each into a matcher; a pattern that does not parse gives null and the
// caller treats it as "no filter" or "no results".

/** The three query toggles. */
export interface SearchRegexOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
}

/** The query as a global RegExp, or null when it is not a valid expression. */
export function buildSearchRegex(query: string, opts: SearchRegexOptions): RegExp | null {
  try {
    let pattern: string;
    if (opts.useRegex) {
      pattern = query;
    } else {
      // Escape regex special characters
      pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    if (opts.wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }

    const flags = opts.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Converts a simple glob pattern (comma-separated) to a matcher function.
 * Supports: * (any chars), ** (any path segments), ? (one char)
 */
export function buildGlobMatcher(pattern: string): ((path: string) => boolean) | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;

  const parts = trimmed.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const regexes: RegExp[] = [];
  for (const part of parts) {
    const re = globToRegex(part);
    if (re) regexes.push(re);
  }

  if (regexes.length === 0) return null;

  return (path: string) => regexes.some((re) => re.test(path));
}

/** One glob as a case-insensitive RegExp, or null when it does not parse. */
export function globToRegex(glob: string): RegExp | null {
  try {
    let regex = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          regex += '.*';
          i++; // skip second *
          if (glob[i + 1] === '/') i++; // skip /
        } else {
          regex += '[^/]*';
        }
      } else if (c === '?') {
        regex += '[^/]';
      } else if (c === '.') {
        regex += '\\.';
      } else {
        regex += c;
      }
    }
    return new RegExp(regex, 'i');
  } catch {
    return null;
  }
}

/** The file's extension with its dot, lower-cased; '' when it has none. */
export function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}
