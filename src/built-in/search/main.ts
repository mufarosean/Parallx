// Search Built-In Tool — workspace-wide text search
//
// Implements:
//   • Find in Files (Ctrl+Shift+F) — text search across workspace files
//   • Results tree grouped by file with match context
//   • Case-sensitive, whole-word, regex toggle options
//   • Include/exclude glob patterns
//   • Click result → open file in editor
//
// VS Code reference:
//   src/vs/workbench/contrib/search/browser/searchView.ts
//   src/vs/workbench/services/search/common/textSearchManager.ts

import type { ToolContext } from '../../tools/toolModuleLoader.js';
import type { IDisposable } from '../../platform/lifecycle.js';
import { hide, show } from '../../ui/dom.js';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ParallxApi {
  views: {
    registerViewProvider(viewId: string, provider: { createView(container: HTMLElement): IDisposable }, options?: Record<string, unknown>): IDisposable;
  };
  commands: {
    registerCommand(id: string, handler: (...args: unknown[]) => unknown): IDisposable;
    executeCommand<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
  };
  workspace: {
    readonly workspaceFolders: readonly { uri: string; name: string; index: number }[] | undefined;
    readonly onDidChangeWorkspaceFolders: (listener: (e: { added: readonly { uri: string; name: string; index: number }[]; removed: readonly { uri: string; name: string; index: number }[] }) => void) => IDisposable;
    readonly onDidFilesChange: (listener: (events: { type: number; uri: string }[]) => void) => IDisposable;
    readonly fs?: {
      readFile(uri: string): Promise<{ content: string; encoding: string }>;
      readdir(uri: string): Promise<{ name: string; type: number }[]>;
      exists(uri: string): Promise<boolean>;
    };
    getConfiguration(section?: string): { get<T>(key: string, defaultValue?: T): T | undefined; has(key: string): boolean };
  };
  window: {
    showInformationMessage(message: string, ...actions: { title: string }[]): Promise<{ title: string } | undefined>;
  };
  editors: {
    openFileEditor(uri: string, options?: { pinned?: boolean }): Promise<void>;
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;
const MAX_RESULTS_PER_FILE = 999;
const FILE_SCAN_DEPTH = 10;
const SEARCH_DEBOUNCE_MS = 300;
const CONTEXT_CHARS = 60;

/** Directories excluded from recursive scanning. */
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '__pycache__', 'dist', 'build', '.next',
  '.svn', '.hg', 'coverage', '.nyc_output', 'out', '.cache',
]);

/** Binary file extensions to skip when reading content. */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp',
  '.mp3', '.mp4', '.wav', '.ogg', '.avi', '.mov', '.mkv', '.webm',
  '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.dat',
  '.sqlite', '.db', '.lock',
]);

// ─── Search Result Model ─────────────────────────────────────────────────────

interface SearchMatch {
  /** 0-based line index */
  line: number;
  /** 0-based column of match start */
  column: number;
  /** Length of the match */
  matchLength: number;
  /** The full line text (trimmed for display) */
  lineText: string;
}

interface FileResult {
  uri: string;
  relativePath: string;
  fileName: string;
  matches: SearchMatch[];
  expanded: boolean;
}

interface SearchOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  useRegex: boolean;
  includePattern: string;
  excludePattern: string;
}

// ─── State ───────────────────────────────────────────────────────────────────

let _api: ParallxApi;
let _context: ToolContext;

// Search state
let _query = '';
let _replaceText = '';
let _showReplace = false;
let _options: SearchOptions = {
  caseSensitive: false,
  wholeWord: false,
  useRegex: false,
  includePattern: '',
  excludePattern: '',
};
let _results: FileResult[] = [];
let _totalMatches = 0;
let _searchVersion = 0;

// DOM elements
let _queryInput: HTMLInputElement | null = null;
let _replaceInput: HTMLInputElement | null = null;
let _replaceRow: HTMLElement | null = null;
let _resultsContainer: HTMLElement | null = null;
let _messageEl: HTMLElement | null = null;
let _toggleReplaceBtn: HTMLElement | null = null;

// ─── Activation ──────────────────────────────────────────────────────────────

export function activate(api: ParallxApi, context: ToolContext): void {
  _api = api;
  _context = context;

  // Restore saved search options
  const saved = context.workspaceState.get<Partial<SearchOptions>>('search.options');
  if (saved) {
    _options = { ..._options, ...saved };
  }

  // Register view provider
  context.subscriptions.push(
    api.views.registerViewProvider('view.search', {
      createView(container: HTMLElement): IDisposable {
        return createSearchView(container);
      },
    }),
  );

  // Register commands
  context.subscriptions.push(
    api.commands.registerCommand('search.findInFiles', () => {
      // Focus the search view, then focus the query input
      api.commands.executeCommand('workbench.view.search').catch(() => {});
      setTimeout(() => _queryInput?.focus(), 100);
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('search.clearResults', () => {
      clearResults();
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('search.collapseAll', () => {
      for (const r of _results) r.expanded = false;
      renderResults();
    }),
  );

  context.subscriptions.push(
    api.commands.registerCommand('search.expandAll', () => {
      for (const r of _results) r.expanded = true;
      renderResults();
    }),
  );
}

export function deactivate(): void {
  _queryInput = null;
  _replaceInput = null;
  _replaceRow = null;
  _resultsContainer = null;
  _messageEl = null;
  _toggleReplaceBtn = null;
  _results = [];
}

// ─── View Creation ───────────────────────────────────────────────────────────

function createSearchView(container: HTMLElement): IDisposable {
  container.classList.add('search-view');

  // ── Header / Input Area ──
  const header = document.createElement('div');
  header.className = 'search-header';

  // Toggle replace button
  _toggleReplaceBtn = document.createElement('button');
  _toggleReplaceBtn.className = 'search-toggle-replace';
  _toggleReplaceBtn.title = 'Toggle Replace';
  _toggleReplaceBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M11 3.5L7.5 0 6 1.5 8 3.5H4.5A3.5 3.5 0 001 7v1h1.5V7A2 2 0 014.5 5H8l-2 2L7.5 8.5 11 5V3.5z" fill="currentColor"/></svg>';
  _toggleReplaceBtn.addEventListener('click', () => {
    _showReplace = !_showReplace;
    _toggleReplaceBtn!.classList.toggle('active', _showReplace);
    _showReplace ? show(_replaceRow!) : hide(_replaceRow!);
  });
  header.appendChild(_toggleReplaceBtn);

  // Input rows wrapper
  const inputRows = document.createElement('div');
  inputRows.className = 'search-input-rows';

  // Search row
  const searchRow = document.createElement('div');
  searchRow.className = 'search-input-row';

  _queryInput = document.createElement('input');
  _queryInput.type = 'text';
  _queryInput.className = 'search-input';
  _queryInput.placeholder = 'Search';
  _queryInput.spellcheck = false;
  _queryInput.value = _query;
  searchRow.appendChild(_queryInput);

  // Option toggles container
  const optionToggles = document.createElement('div');
  optionToggles.className = 'search-option-toggles';

  optionToggles.appendChild(
    createToggleButton('Aa', 'Match Case', _options.caseSensitive, (v) => {
      _options.caseSensitive = v;
      saveOptions();
      triggerSearch();
    }),
  );
  optionToggles.appendChild(
    createToggleButton('Ab|', 'Match Whole Word', _options.wholeWord, (v) => {
      _options.wholeWord = v;
      saveOptions();
      triggerSearch();
    }),
  );
  optionToggles.appendChild(
    createToggleButton('.*', 'Use Regular Expression', _options.useRegex, (v) => {
      _options.useRegex = v;
      saveOptions();
      triggerSearch();
    }),
  );

  searchRow.appendChild(optionToggles);
  inputRows.appendChild(searchRow);

  // Replace row
  _replaceRow = document.createElement('div');
  _replaceRow.className = 'search-input-row search-replace-row';
  _showReplace ? show(_replaceRow) : hide(_replaceRow);

  _replaceInput = document.createElement('input');
  _replaceInput.type = 'text';
  _replaceInput.className = 'search-input';
  _replaceInput.placeholder = 'Replace';
  _replaceInput.spellcheck = false;
  _replaceInput.value = _replaceText;
  _replaceRow.appendChild(_replaceInput);

  inputRows.appendChild(_replaceRow);
  header.appendChild(inputRows);

  container.appendChild(header);

  // ── Filters (include/exclude) ──
  const filtersSection = document.createElement('div');
  filtersSection.className = 'search-filters';

  const filtersToggle = document.createElement('button');
  filtersToggle.className = 'search-filters-toggle';
  filtersToggle.textContent = '⋯ files to include/exclude';
  filtersToggle.title = 'Toggle Search Details';

  const filtersBody = document.createElement('div');
  filtersBody.className = 'search-filters-body';
  hide(filtersBody);

  const includeInput = document.createElement('input');
  includeInput.type = 'text';
  includeInput.className = 'search-input search-filter-input';
  includeInput.placeholder = 'files to include (e.g. *.ts, src/**)';
  includeInput.value = _options.includePattern;
  includeInput.addEventListener('input', () => {
    _options.includePattern = includeInput.value;
    saveOptions();
    triggerSearch();
  });

  const excludeInput = document.createElement('input');
  excludeInput.type = 'text';
  excludeInput.className = 'search-input search-filter-input';
  excludeInput.placeholder = 'files to exclude (e.g. *.min.js)';
  excludeInput.value = _options.excludePattern;
  excludeInput.addEventListener('input', () => {
    _options.excludePattern = excludeInput.value;
    saveOptions();
    triggerSearch();
  });

  filtersBody.appendChild(includeInput);
  filtersBody.appendChild(excludeInput);
  filtersSection.appendChild(filtersToggle);
  filtersSection.appendChild(filtersBody);

  filtersToggle.addEventListener('click', () => {
    const visible = filtersBody.style.display !== 'none';
    visible ? hide(filtersBody) : show(filtersBody);
    filtersToggle.classList.toggle('active', !visible);
  });

  container.appendChild(filtersSection);

  // ── Message area ──
  _messageEl = document.createElement('div');
  _messageEl.className = 'search-message';
  container.appendChild(_messageEl);

  // ── Results ──
  _resultsContainer = document.createElement('div');
  _resultsContainer.className = 'search-results';
  container.appendChild(_resultsContainer);

  // ── Event handlers ──
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  _queryInput.addEventListener('input', () => {
    _query = _queryInput!.value;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => triggerSearch(), SEARCH_DEBOUNCE_MS);
  });

  _queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (debounceTimer) clearTimeout(debounceTimer);
      triggerSearch();
    }
    if (e.key === 'Escape') {
      _queryInput!.blur();
    }
  });

  _replaceInput!.addEventListener('input', () => {
    _replaceText = _replaceInput!.value;
  });

  // Render initial state
  updateMessage();

  return {
    dispose() {
      if (debounceTimer) clearTimeout(debounceTimer);
      _queryInput = null;
      _replaceInput = null;
      _replaceRow = null;
      _resultsContainer = null;
      _messageEl = null;
      _toggleReplaceBtn = null;
    },
  };
}

// ─── Toggle Button Factory ───────────────────────────────────────────────────

function createToggleButton(
  label: string,
  title: string,
  initial: boolean,
  onToggle: (active: boolean) => void,
): HTMLElement {
  const btn = document.createElement('button');
  btn.className = 'search-option-btn';
  btn.title = title;
  btn.textContent = label;
  if (initial) btn.classList.add('active');

  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    onToggle(btn.classList.contains('active'));
  });

  return btn;
}

// ─── Search Execution ────────────────────────────────────────────────────────

let _debounceHandle: ReturnType<typeof setTimeout> | null = null;

function triggerSearch(): void {
  if (_debounceHandle) clearTimeout(_debounceHandle);

  if (!_query.trim()) {
    clearResults();
    return;
  }

  _debounceHandle = setTimeout(() => executeSearch(), 50);
}

async function executeSearch(): Promise<void> {
  const query = _query.trim();
  if (!query) {
    clearResults();
    return;
  }

  const version = ++_searchVersion;
  _results = [];
  _totalMatches = 0;
  updateMessage('Searching…');

  try {
    const regex = buildSearchRegex(query, _options);
    if (!regex) {
      updateMessage('Invalid regular expression');
      return;
    }

    const folders = _api.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      updateMessage('No workspace folder open');
      return;
    }

    // Build include/exclude matchers
    const includeMatcher = buildGlobMatcher(_options.includePattern);
    const excludeMatcher = buildGlobMatcher(_options.excludePattern);

    let totalFilesScanned = 0;

    for (const folder of folders) {
      if (_searchVersion !== version) return;
      await searchDirectory(
        folder.uri, folder.name, '', regex, includeMatcher, excludeMatcher,
        0, version, () => totalFilesScanned++,
      );
    }

    if (_searchVersion !== version) return;

    if (_results.length === 0) {
      updateMessage(`No results found for "${query}"`);
    } else {
      updateMessage(
        `${_totalMatches} result${_totalMatches !== 1 ? 's' : ''} in ${_results.length} file${_results.length !== 1 ? 's' : ''}`,
      );
    }

    renderResults();
  } catch (err) {
    if (_searchVersion !== version) return;
    console.error('[Search] Error:', err);
    updateMessage('Search failed — see console');
  }
}

async function searchDirectory(
  dirUri: string,
  folderName: string,
  relativePath: string,
  regex: RegExp,
  includeMatcher: ((path: string) => boolean) | null,
  excludeMatcher: ((path: string) => boolean) | null,
  depth: number,
  version: number,
  onFile: () => void,
): Promise<void> {
  if (depth >= FILE_SCAN_DEPTH || _searchVersion !== version) return;

  const fs = _api.workspace.fs;
  if (!fs) return;

  try {
    const entries = await fs.readdir(dirUri);

    for (const entry of entries) {
      if (_searchVersion !== version) return;

      const childRelative = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      const childUri = dirUri.endsWith('/')
        ? `${dirUri}${entry.name}`
        : `${dirUri}/${entry.name}`;

      if (entry.type === FILE_TYPE_DIRECTORY) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        await searchDirectory(
          childUri, folderName, childRelative, regex,
          includeMatcher, excludeMatcher, depth + 1, version, onFile,
        );
      } else if (entry.type === FILE_TYPE_FILE) {
        // Skip binary files
        const ext = getExtension(entry.name);
        if (BINARY_EXTENSIONS.has(ext)) continue;

        // Apply include/exclude filters
        if (includeMatcher && !includeMatcher(childRelative)) continue;
        if (excludeMatcher && excludeMatcher(childRelative)) continue;

        onFile();

        // Search file content
        await searchFile(childUri, childRelative, entry.name, regex, version);
      }
    }
  } catch (err) {
    // Silently skip directories we can't read
    console.warn('[Search] readdir failed:', dirUri, err);
  }
}

async function searchFile(
  uri: string,
  relativePath: string,
  fileName: string,
  regex: RegExp,
  version: number,
): Promise<void> {
  if (_searchVersion !== version) return;

  const fs = _api.workspace.fs;
  if (!fs) return;

  try {
    const { content } = await fs.readFile(uri);
    if (_searchVersion !== version) return;

    // Skip files that appear to be binary (null bytes in first 512 chars)
    if (content.length > 0 && content.slice(0, 512).includes('\0')) return;

    const lines = content.split('\n');
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length && matches.length < MAX_RESULTS_PER_FILE; i++) {
      const line = lines[i];
      // Reset regex for each line (for global flag)
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;

      // eslint-disable-next-line no-cond-assign
      while ((match = regex.exec(line)) !== null && matches.length < MAX_RESULTS_PER_FILE) {
        matches.push({
          line: i,
          column: match.index,
          matchLength: match[0].length,
          lineText: line,
        });

        // Avoid infinite loop with zero-length matches
        if (match[0].length === 0) {
          regex.lastIndex++;
        }
      }
    }

    if (matches.length > 0 && _searchVersion === version) {
      _totalMatches += matches.length;
      _results.push({
        uri,
        relativePath,
        fileName,
        matches,
        expanded: true,
      });

      // Progressive rendering: render every few files
      if (_results.length <= 10 || _results.length % 5 === 0) {
        updateMessage(
          `${_totalMatches} result${_totalMatches !== 1 ? 's' : ''} in ${_results.length} file${_results.length !== 1 ? 's' : ''} (searching…)`,
        );
        renderResults();
      }
    }
  } catch (err) {
    // Skip files we can't read
  }
}

// ─── Regex Builder ───────────────────────────────────────────────────────────

function buildSearchRegex(query: string, opts: SearchOptions): RegExp | null {
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

// ─── Glob Matcher ────────────────────────────────────────────────────────────

/**
 * Converts a simple glob pattern (comma-separated) to a matcher function.
 * Supports: * (any chars), ** (any path segments), ? (one char)
 */
function buildGlobMatcher(pattern: string): ((path: string) => boolean) | null {
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

function globToRegex(glob: string): RegExp | null {
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
}

function saveOptions(): void {
  _context.workspaceState.update('search.options', _options);
}

function clearResults(): void {
  _results = [];
  _totalMatches = 0;
  _searchVersion++;
  renderResults();
  updateMessage();
}

function updateMessage(text?: string): void {
  if (!_messageEl) return;

  if (text) {
    _messageEl.textContent = text;
    show(_messageEl);
  } else if (!_query.trim()) {
    _messageEl.textContent = '';
    hide(_messageEl);
  } else {
    hide(_messageEl);
  }
}

// ─── Results Rendering ───────────────────────────────────────────────────────

function renderResults(): void {
  if (!_resultsContainer) return;
  _resultsContainer.innerHTML = '';

  for (const fileResult of _results) {
    const fileGroup = document.createElement('div');
    fileGroup.className = 'search-file-group';

    // File header
    const fileHeader = document.createElement('div');
    fileHeader.className = 'search-file-header';
    fileHeader.addEventListener('click', () => {
      fileResult.expanded = !fileResult.expanded;
      chevron.textContent = fileResult.expanded ? '▾' : '▸';
      fileResult.expanded ? show(matchList) : hide(matchList);
    });

    const chevron = document.createElement('span');
    chevron.className = 'search-file-chevron';
    chevron.textContent = fileResult.expanded ? '▾' : '▸';
    fileHeader.appendChild(chevron);

    const fileIcon = document.createElement('span');
    fileIcon.className = 'search-file-icon';
    fileIcon.textContent = getFileIcon(fileResult.fileName);
    fileHeader.appendChild(fileIcon);

    const filePath = document.createElement('span');
    filePath.className = 'search-file-path';
    fileHeader.appendChild(filePath);

    // File name (bold) + directory (dim)
    const nameSpan = document.createElement('span');
    nameSpan.className = 'search-file-name';
    nameSpan.textContent = fileResult.fileName;
    filePath.appendChild(nameSpan);

    const dirSpan = document.createElement('span');
    dirSpan.className = 'search-file-dir';
    const dir = fileResult.relativePath.slice(0, -(fileResult.fileName.length + 1));
    if (dir) {
      dirSpan.textContent = ` ${dir}`;
    }
    filePath.appendChild(dirSpan);

    // Match count badge
    const badge = document.createElement('span');
    badge.className = 'search-file-badge';
    badge.textContent = String(fileResult.matches.length);
    fileHeader.appendChild(badge);

    fileGroup.appendChild(fileHeader);

    // Match list
    const matchList = document.createElement('div');
    matchList.className = 'search-match-list';
    fileResult.expanded ? show(matchList) : hide(matchList);

    for (const match of fileResult.matches) {
      const matchEl = document.createElement('div');
      matchEl.className = 'search-match-item';
      matchEl.addEventListener('click', (e) => {
        e.stopPropagation();
        openResult(fileResult.uri, match.line, match.column);
      });

      // Render line text with match highlighting
      renderMatchLine(matchEl, match);

      matchList.appendChild(matchEl);
    }

    fileGroup.appendChild(matchList);
    _resultsContainer.appendChild(fileGroup);
  }
}

function renderMatchLine(container: HTMLElement, match: SearchMatch): void {
  const lineText = match.lineText;
  const start = match.column;
  const end = start + match.matchLength;

  // Determine visible window around the match
  const contextStart = Math.max(0, start - CONTEXT_CHARS);
  const contextEnd = Math.min(lineText.length, end + CONTEXT_CHARS);

  const prefix = (contextStart > 0 ? '…' : '') +
    lineText.slice(contextStart, start);
  const matched = lineText.slice(start, end);
  const suffix = lineText.slice(end, contextEnd) +
    (contextEnd < lineText.length ? '…' : '');

  // Line number
  const lineNum = document.createElement('span');
  lineNum.className = 'search-match-line-num';
  lineNum.textContent = String(match.line + 1);
  container.appendChild(lineNum);

  // Text before match
  if (prefix) {
    const pre = document.createElement('span');
    pre.className = 'search-match-context';
    pre.textContent = prefix;
    container.appendChild(pre);
  }

  // Highlighted match
  const hl = document.createElement('span');
  hl.className = 'search-match-highlight';
  hl.textContent = matched;
  container.appendChild(hl);

  // Text after match
  if (suffix) {
    const post = document.createElement('span');
    post.className = 'search-match-context';
    post.textContent = suffix;
    container.appendChild(post);
  }
}

function getFileIcon(fileName: string): string {
  const ext = getExtension(fileName);
  const iconMap: Record<string, string> = {
    '.ts': '📄', '.tsx': '📄', '.js': '📄', '.jsx': '📄',
    '.json': '📋', '.md': '📝', '.css': '🎨', '.html': '🌐',
    '.yml': '⚙️', '.yaml': '⚙️', '.toml': '⚙️',
    '.py': '🐍', '.rs': '⚙️', '.go': '⚙️',
    '.sh': '💻', '.bash': '💻', '.zsh': '💻',
    '.gitignore': '🔧', '.env': '🔧',
  };
  return iconMap[ext] ?? '📄';
}

async function openResult(uri: string, _line: number, _column: number): Promise<void> {
  try {
    await _api.editors.openFileEditor(uri, { pinned: false });
    // TODO: scroll to line when editor supports it
  } catch (err) {
    console.error('[Search] Failed to open file:', err);
  }
}
