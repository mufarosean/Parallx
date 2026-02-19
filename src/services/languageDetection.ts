// languageDetection.ts — File extension → language name mapping
//
// Centralized map used by status bar, editor resolver, and any future
// consumers that need to display a human-readable language label for a
// given file name.
//
// VS Code reference: src/vs/editor/common/languages/modesRegistry.ts

// ── Extension → Language map ────────────────────────────────────────────────

const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript React',
  '.js': 'JavaScript', '.jsx': 'JavaScript React',
  '.json': 'JSON', '.jsonc': 'JSON with Comments',
  '.md': 'Markdown', '.markdown': 'Markdown',
  '.html': 'HTML', '.htm': 'HTML',
  '.css': 'CSS', '.scss': 'SCSS', '.less': 'Less',
  '.py': 'Python', '.rb': 'Ruby', '.rs': 'Rust',
  '.go': 'Go', '.java': 'Java', '.c': 'C', '.cpp': 'C++', '.h': 'C',
  '.cs': 'C#', '.swift': 'Swift', '.kt': 'Kotlin',
  '.sh': 'Shell Script', '.bash': 'Shell Script', '.zsh': 'Shell Script',
  '.ps1': 'PowerShell', '.bat': 'Batch',
  '.xml': 'XML', '.svg': 'XML', '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML', '.ini': 'INI', '.cfg': 'INI',
  '.sql': 'SQL',
  '.r': 'R', '.R': 'R',
  '.lua': 'Lua', '.php': 'PHP', '.pl': 'Perl',
  '.txt': 'Plain Text', '.log': 'Log',
  '.dockerfile': 'Dockerfile',
  '.gitignore': 'Ignore', '.env': 'Properties',
};

// ── Special filename matches ────────────────────────────────────────────────

const FILENAME_TO_LANGUAGE: Record<string, string> = {
  'dockerfile': 'Dockerfile',
  'makefile': 'Makefile',
  '.gitignore': 'Ignore',
  '.env': 'Properties',
};

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns a human-readable language name for the given file name.
 * Falls back to 'Plain Text' if no known extension or filename match.
 */
export function getLanguageForFileName(name: string): string {
  const lower = name.toLowerCase();

  // Check exact filename matches first
  const filenameMatch = FILENAME_TO_LANGUAGE[lower];
  if (filenameMatch) return filenameMatch;

  // Check extension
  const dotIdx = name.lastIndexOf('.');
  if (dotIdx >= 0) {
    const ext = name.substring(dotIdx).toLowerCase();
    return EXT_TO_LANGUAGE[ext] ?? 'Plain Text';
  }
  return 'Plain Text';
}

/**
 * Returns the known extension→language map for read-only consumers
 * (e.g., settings UI, language mode picker).
 */
export function getAllKnownLanguages(): ReadonlyMap<string, string> {
  return new Map(Object.entries(EXT_TO_LANGUAGE));
}
